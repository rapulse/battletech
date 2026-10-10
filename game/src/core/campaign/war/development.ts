import type { Rng } from '../../rng/index.js';
import { FACTION_LIST, GALAXY, GALAXY_RULES } from '../galaxy/catalog.js';
import { developmentOf, focusOf, withDelta, type GalaxyDeltas } from '../galaxy/delta.js';
import { worldProfile } from '../galaxy/profile.js';
import type { WorldFocus } from '../galaxy/schema.js';
import type { ReputationState } from '../reputation/state.js';
import { economyOf, withEconomy, worldContributionAt, type WarState } from './economy.js';
import { frontSectors, ownerArray, shiftRuin } from './front.js';
import {
  clearedOf,
  frontierField,
  pirateRisk,
  regrowPirates,
} from '../contracts/pirates.js';
import { CONTRACTS } from '../contracts/schema.js';
import { WAR } from './schema.js';

/**
 * Экономика планет (шаг 23, часть A) — звено круга, которого не было вовсе.
 *
 * **Что было не так.** `galaxy/profile.ts::systemProfile` — чистая функция от
 * сида мира: население, промышленность, техуровень и класс рынка выводились и
 * НЕ МЕНЯЛИСЬ НИКОГДА. Подвижным во всём профиле было ровно одно — разорение, и
 * то заживало обратно к исходному. Мир, простоявший сто декад в достатке и
 * покое, ничем не отличался от себя же в первый день кампании.
 *
 * **Почему это нельзя было чинить в лоб.** Выводимость профиля — опора решения
 * 4 §2 пайплайна: снимок не растёт вместе с галактикой ровно потому, что две
 * тысячи профилей нигде не хранятся.
 *
 * **Как обойдено.** Хранится не профиль, а ОТКЛОНЕНИЕ от него — одно целое
 * число ступеней в дельте системы (`galaxy/delta.ts::development`), тем же
 * приёмом, каким уже живут владелец и разорение. Профиль остаётся выводимым,
 * дельта остаётся разрежённой.
 *
 * **Это же и сток казны.** Замер круга до шага 23 (`pnpm worldstat`, 2 сида ×
 * 100 декад) показал, что казна фракций растёт линейно и без конца: 5.8 такта
 * дохода на старте, 18.6 к концу и ни признака равновесия. Тратить её было не
 * на что — армия упирается в целевую численность, а других расходов у
 * государства не существовало. Стройка и есть тот расход, ради которого казна
 * вообще нужна, и равновесие она находит сама: казна растёт, пока
 * `investShare × казна` не сравняется с притоком.
 *
 * **Ни одного лишнего профиля за такт.** Проход по каталогу здесь ровно один и
 * дешёвый — владельцы (`ownerArray`), — а `worldProfile` зовётся только для тех
 * нескольких миров, которые выбраны под стройку. То же правило, по которому
 * `pickSector` считает вес участка по деньгам, а не по профилю.
 */

const D = WAR.development;
/** Пиратский тыл (шаг 37a): зачистка, заращивание и набеги. */
const PIR = CONTRACTS.pirates;
const FOC = WAR.focus;
const DEV = GALAXY_RULES.profile.development;

/** Что сдвинул один такт развития. Из этого собираются и сводка, и замер. */
export interface DevelopmentMove {
  readonly systemId: string;
  readonly owner: string;
  readonly from: number;
  readonly to: number;
  /** `built` — отстроен на деньги владельца, `decayed` — сведён войной. */
  readonly kind: 'built' | 'decayed';
}

/** Что сдвинула смена фокуса (шаг 25, часть A): начатая переделка или доведённая. */
export interface FocusMove {
  readonly systemId: string;
  readonly owner: string;
  readonly from: WorldFocus;
  readonly to: WorldFocus;
  /** `started` — переделка начата и оплачена, `done` — доведена до конца. */
  readonly kind: 'started' | 'done';
}

/** Прорвавшийся пиратский набег: кого сожгли и насколько (шаг 37a). */
export interface PirateRaid {
  readonly systemId: string;
  readonly owner: string;
  readonly ruined: number;
  /** Вольница вывезла ступень развития, а не только сожгла (шаг 37a). */
  readonly sacked: boolean;
}

export interface DevelopmentTickResult {
  readonly war: WarState;
  readonly deltas: GalaxyDeltas;
  readonly moves: readonly DevelopmentMove[];
  readonly focusMoves: readonly FocusMove[];
  readonly raids: readonly PirateRaid[];
}

/**
 * Сдвинуть развитие одного мира на `to` ступеней и поправить экономику владельца
 * ПРИРАЩЕНИЕМ.
 *
 * Приращением, а не пересчётом, по той же причине, что у захвата
 * (`front.ts::capture`): полный проход по каталогу дал бы то же число ценой двух
 * тысяч профилей. Сумму с приращением сверяет тот же тест, что и у фронта, —
 * `makeWarState` читает развитие из дельт и обязан сойтись побайтово.
 */
function shift(
  war: WarState,
  deltas: GalaxyDeltas,
  worldSeed: number,
  i: number,
  owner: string,
  to: number,
  cost: number,
): { war: WarState; deltas: GalaxyDeltas } {
  const id = GALAXY.id(i);

  const before = worldContributionAt(worldSeed, deltas, i);
  // Ноль ступеней из дельты УДАЛЯЕТСЯ: мир, вернувшийся к канону, ничем от него
  // не отличается, и запись «отклонения нет» протекла бы через разрежённость
  // так же, как зажившее разорение. Та же дисциплина, что у `withFund`.
  const nextDeltas = withDelta(deltas, id, { development: to === 0 ? undefined : to });
  const after = worldContributionAt(worldSeed, nextDeltas, i);

  const eco = economyOf(war, owner);
  return {
    war: withEconomy(war, owner, {
      income: eco.income + after.income - before.income,
      upkeep: eco.upkeep + after.upkeep - before.upkeep,
      // Ступень развития двигает и МОЩНОСТЬ (шаг 25): она поднимает гражданскую
      // промышленность, та тянет военную, а мощность считается из военной.
      // Заодно ступень может сменить миру ЕСТЕСТВЕННЫЙ фокус — и это учтено
      // само собой, потому что обе стороны считает `worldContributionAt`.
      capacity: eco.capacity + after.capacity - before.capacity,
      treasury: eco.treasury - cost,
    }),
    deltas: nextDeltas,
  };
}

/**
 * Сменить фокус мира и поправить экономику владельца ПРИРАЩЕНИЕМ.
 *
 * Ровно тот же приём, что у `shift` выше: обе стороны считает
 * `worldContributionAt`, поэтому доход, содержание и мощность не могут
 * разойтись между собой, а сумма — с пересчётом.
 *
 * Фокус, совпавший с естественным, из дельты УДАЛЯЕТСЯ: мир, занятый тем, чем
 * его занял бы профиль сам, ничем от него не отличается. Та же дисциплина
 * разрежённости, что у зажившего разорения и нулевого развития.
 */
export function setFocus(
  war: WarState,
  deltas: GalaxyDeltas,
  worldSeed: number,
  i: number,
  owner: string,
  to: WorldFocus,
  cost: number,
): { war: WarState; deltas: GalaxyDeltas } {
  const id = GALAXY.id(i);
  const natural = worldProfile(worldSeed, deltas, i).naturalFocus;

  const before = worldContributionAt(worldSeed, deltas, i);
  const nextDeltas = withDelta(deltas, id, {
    focus: to === natural ? undefined : to,
    focusTo: undefined,
    focusUntil: undefined,
  });
  const after = worldContributionAt(worldSeed, nextDeltas, i);

  const eco = economyOf(war, owner);
  return {
    war: withEconomy(war, owner, {
      income: eco.income + after.income - before.income,
      upkeep: eco.upkeep + after.upkeep - before.upkeep,
      capacity: eco.capacity + after.capacity - before.capacity,
      treasury: eco.treasury - cost,
    }),
    deltas: nextDeltas,
  };
}

/**
 * Такт развития планет (задача очереди `developmentTick`, раз в декаду).
 *
 * Идёт СЛЕДОМ за тактом фронта того же дня, и это порядок самого круга: границы
 * сперва двигаются, и только потом хозяин считает, что ему досталось и что он
 * готов отстроить. Порядок держится номером постановки в очередь (`state.ts`),
 * а не совпадением.
 *
 * **Броски есть, и их два вида**: какой из своих миров фракция берётся строить и
 * добьёт ли война уже выжженный мир. Больше случайности здесь нет: сколько
 * фракция строит, решает её казна, а не кубик.
 *
 * Порядок бросков закреплён, как у фронта и профиля системы: фракции
 * перебираются в порядке `FACTION_LIST`, а любой новый бросок дописывается В
 * КОНЕЦ. Иначе весь мир на старых сохранениях пошёл бы по другой ветке при
 * неизменных данных.
 */
export function developmentTick(
  war: WarState,
  deltas: GalaxyDeltas,
  rep: ReputationState,
  worldSeed: number,
  day: number,
  rng: Rng,
): DevelopmentTickResult {
  let nextWar = war;
  let nextDeltas = deltas;
  const moves: DevelopmentMove[] = [];

  const owners = ownerArray(nextDeltas);

  // Кто чем владеет — один проход по каталогу без единого профиля. Дальше из
  // этих списков и берутся кандидаты под стройку.
  const byOwner = new Map<string, number[]>();
  for (let i = 0; i < GALAXY.count; i++) {
    const owner = owners[i] as string;
    const list = byOwner.get(owner);
    if (list === undefined) byOwner.set(owner, [i]);
    else list.push(i);
  }

  // Фронтовые миры. «Фронтовой мир не строят, его удерживают» — и определение
  // фронта здесь ровно то же, что у войны: участок фронта есть у МЕСТА, и место
  // это — тот, на кого давят. Второго определения фронта не заводится.
  const atFront = new Set<number>();
  for (const s of frontSectors(nextWar, rep, nextDeltas, day, owners)) atFront.add(s.system);

  // --- стройка ---------------------------------------------------------------
  for (const f of FACTION_LIST) {
    const eco = economyOf(nextWar, f.id);
    const mine = byOwner.get(f.id);
    if (mine === undefined || mine.length === 0 || eco.treasury <= 0) continue;

    // ДРОБНАЯ ЧАСТЬ РАЗЫГРЫВАЕТСЯ БРОСКОМ, а не отбрасывается, и это не
    // придирка к округлению — на ней держатся оба свойства такта разом.
    //
    // При простом округлении вниз мелкая фракция не строит НИКОГДА: порог
    // `stepCost` абсолютный, и Ляо с казной вшестеро меньше дэвионской не
    // доходит до него ни за какой срок. А сток казны становится зависим от
    // цены ступени: чем дороже стройка, тем реже она случается и тем больше
    // денег остаётся лежать.
    //
    // С броском ожидаемая трата равна ровно `казна × investShare` при любой
    // цене ступени. Отсюда и разделение двух рычагов, которые иначе тянули бы
    // один за другой: `investShare` задаёт равновесие казны, `stepCost` —
    // темп развития, и настраиваются они независимо.
    const budget = eco.treasury * D.investShare;
    const want = budget / Math.max(1, D.stepCost);
    let steps = Math.min(D.maxStepsPerTick, Math.floor(want));
    if (steps < D.maxStepsPerTick && rng.next() < want - Math.floor(want)) steps += 1;
    for (let n = 0; n < steps; n++) {
      const i = mine[rng.int(0, mine.length - 1)] as number;
      const id = GALAXY.id(i);
      const from = developmentOf(nextDeltas, id);
      // Попытка СГОРАЕТ, а не переигрывается, — тем же правилом, что у
      // наступления, опоздавшего к уже занятому миру: подряд, упёршийся в
      // фронт или в пожарище, это обычное дело, и второй бесплатный бросок за
      // него выдавать не за что.
      if (atFront.has(i)) continue;
      if ((nextDeltas[id]?.ruined ?? 0) > D.ruinBlock) continue;
      if (from >= DEV.max) continue;

      const applied = shift(nextWar, nextDeltas, worldSeed, i, f.id, from + 1, D.stepCost);
      nextWar = applied.war;
      nextDeltas = applied.deltas;
      moves.push({ systemId: id, owner: f.id, from, to: from + 1, kind: 'built' });
    }
  }

  // --- упадок ----------------------------------------------------------------
  //
  // Идёт по разрежённой карте дельт, а не по каталогу: выжженных миров десятки,
  // и перебирать ради них две тысячи систем незачем — тем же приёмом, что
  // заживление разорения (`front.ts::healRuin`).
  //
  // Отличие от разорения принципиальное: разорение ЗАЖИВАЕТ, а упадок — нет.
  // Свежий пожар проходит за годы; то, чем мир СТАЛ за десятилетие войны, само
  // назад не отрастает. Ровно это и даёт войне долгий след, которого у неё до
  // шага 23 не было вовсе.
  for (const id of Object.keys(nextDeltas).sort()) {
    const ruined = nextDeltas[id]?.ruined ?? 0;
    if (ruined < D.declineRuinFrom) continue;
    const from = developmentOf(nextDeltas, id);
    if (from <= DEV.min) continue;
    if (rng.next() >= D.declineChance) continue;

    const i = GALAXY.index(id);
    if (i < 0) continue;
    const owner = owners[i] as string;
    const applied = shift(nextWar, nextDeltas, worldSeed, i, owner, from - 1, 0);
    nextWar = applied.war;
    nextDeltas = applied.deltas;
    moves.push({ systemId: id, owner, from, to: from - 1, kind: 'decayed' });
  }

  // --- фокус миров (шаг 25, часть A) -----------------------------------------
  const focusMoves: FocusMove[] = [];

  // Сперва ДОВОДЯТСЯ начатые переделки: год прошёл — мир стал тем, чем его
  // переделывали. Идёт по разрежённой карте, а не по каталогу: переделок в
  // работе единицы, и перебирать ради них две тысячи систем незачем.
  for (const id of Object.keys(nextDeltas).sort()) {
    const d = nextDeltas[id];
    const to = d?.focusTo;
    if (to === undefined || d?.focusUntil === undefined || day < d.focusUntil) continue;
    const i = GALAXY.index(id);
    if (i < 0) continue;
    const owner = owners[i] as string;
    const from = focusOf(nextDeltas, id, worldProfile(worldSeed, nextDeltas, i).naturalFocus);
    // Переделка уже оплачена в день начала: доводить её бесплатно.
    const applied = setFocus(nextWar, nextDeltas, worldSeed, i, owner, to, 0);
    nextWar = applied.war;
    nextDeltas = applied.deltas;
    focusMoves.push({ systemId: id, owner, from, to, kind: 'done' });
  }

  // Затем государства НАЧИНАЮТ новые. Доктрина одна и простая: приграничный мир
  // переделывают в крепость. Это единственное, что государство решает о фокусе
  // само, — остальное оставлено естественному фокусу и игроку.
  //
  // ЗАЦИКЛИВАНИЕ ИСКЛЮЧЕНО ПРАВИЛОМ, А НЕ ЧИСЛОМ: берётся только мир, у
  // которого фокуса в дельте ещё нет, то есть каждый мир переделывается не
  // более одного раза за кампанию. Гонять приграничный мир между крепостью и
  // арсеналом при этом физически нечем, и ни лишнего числа в таблице, ни
  // лишнего поля в дельте для этого не нужно.
  for (const f of FACTION_LIST) {
    const eco = economyOf(nextWar, f.id);
    const mine = byOwner.get(f.id);
    if (mine === undefined || mine.length === 0 || eco.treasury <= FOC.cost) continue;

    // Дробная часть разыгрывается броском — тем же приёмом и по той же причине,
    // что у стройки выше: иначе мелкая фракция не переделала бы ни одного мира
    // никогда, а ожидаемая трата зависела бы от цены переделки.
    const want = (eco.treasury * FOC.investShare) / Math.max(1, FOC.cost);
    // Не больше одного мира за декаду: «одна планета — одно решение в год»
    // (§2 дорожной карты Части 3) относится и к государству, а не только к игроку.
    if (rng.next() >= Math.min(1, want)) continue;

    const i = mine[rng.int(0, mine.length - 1)] as number;
    const id = GALAXY.id(i);
    const d = nextDeltas[id];
    if (d?.focus !== undefined || d?.focusTo !== undefined) continue;
    if (!atFront.has(i)) continue;
    if ((d?.ruined ?? 0) > D.ruinBlock) continue;
    const from = worldProfile(worldSeed, nextDeltas, i).naturalFocus;
    if (from === 'fortress') continue;

    nextWar = withEconomy(nextWar, f.id, { treasury: eco.treasury - FOC.cost });
    nextDeltas = withDelta(nextDeltas, id, { focusTo: 'fortress', focusUntil: day + FOC.changeDays });
    focusMoves.push({ systemId: id, owner: f.id, from, to: 'fortress', kind: 'started' });
  }

  // --- ПИРАТСКИЙ ТЫЛ (шаг 37a) -----------------------------------------------
  //
  // Идёт ПОСЛЕДНИМ в такте, и это не вкус: правило порядка бросков в этом файле
  // — любой новый бросок дописывается В КОНЕЦ, иначе весь мир на старых
  // сохранениях пойдёт по другой ветке при неизменных данных.
  //
  // Сперва вычищенное ЗАРАСТАЕТ. По разрежённой карте, как заживает разорение:
  // вычищенных миров десятки, и перебирать ради них две тысячи систем незачем.
  nextDeltas = regrowPirates(nextDeltas);

  // Затем НАБЕГИ. Проверять каждую из двух тысяч систем нельзя — это ровно тот
  // процент времени мира, который шаг 37 обязался не потратить. Разыгрывается
  // фиксированное число попыток тем же приёмом, каким выше разыгрывается
  // стройка: цель выбирается броском, а попытка, упёршаяся в сильный гарнизон,
  // СГОРАЕТ, а не переигрывается.
  //
  // Фронтовой индекс здесь берётся ОПТОМ — одним обходом в ширину из уже
  // посчитанного множества фронтовых систем (`atFront` собран выше для стройки).
  // Поштучный обход вокруг каждой системы дал бы то же число ценой двух тысяч
  // обходов на такт.
  const raids: PirateRaid[] = [];
  if (PIR.raidsPerTick > 0) {
    const frontier = frontierField(atFront);
    // Кандидаты — глубокий тыл: там, где фронтового индекса нет вовсе. Отбор
    // идёт по числу, которое уже посчитано, без единого профиля мира: профиль
    // стоит дорого, и звать его на тысячу с лишним систем ради шести набегов
    // было бы той же ошибкой, от которой уходит весь этот файл.
    //
    // ЦЕЛЬ ВЫБИРАЕТСЯ НЕ РАВНОВЕРОЯТНО: чем богаче мир, тем чаще к нему приходят.
    // Богатство здесь — ступени развития из дельты, то есть ровно то, что мир
    // НАРАСТИЛ сверх канона, и читается оно без профиля, за O(1).
    //
    // Отсюда же и петля обратной связи, ради которой весь шаг: чем сильнее тыл
    // отстраивается, тем притягательнее он для вольницы, и тем чаще стройка
    // упирается в свежее разорение (`ruinBlock`). Первая версия выбирала цель
    // равновероятно из тысячи с лишним тыловых систем — и один визит раз в
    // двести декад не сдерживал ничего: замер показал 835 отстроенных миров за
    // десять лет против 852 без набегов вовсе.
    const pool: number[] = [];
    for (let i = 0; i < GALAXY.count; i++) {
      if (frontier[i] !== 0) continue;
      pool.push(i);
      // Богатый мир стоит в списке несколько раз — это и есть его вес. Способ
      // грубый, зато без второго прохода и без сортировки: ступеней развития
      // мало (`profile.development`), и длина списка от этого не взрывается.
      const built = Math.max(0, developmentOf(nextDeltas, GALAXY.id(i)));
      for (let k = 0; k < built; k++) pool.push(i);
    }

    for (let n = 0; n < PIR.raidsPerTick && pool.length > 0; n++) {
      const i = pool[rng.int(0, pool.length - 1)] as number;
      const id = GALAXY.id(i);
      const owner = owners[i] as string;
      const profile = worldProfile(worldSeed, nextDeltas, i);
      const wasRuined = nextDeltas[id]?.ruined ?? 0;
      const risk = pirateRisk(0, {
        marketClass: profile.marketClass,
        garrison: profile.garrison,
        ruined: wasRuined,
        owner,
        blackMarket: GALAXY.hasFlag(i, 'blackMarket'),
        cleared: clearedOf(nextDeltas, id),
      });
      // Гарнизон отбил — следа не осталось. Именно этим тыл и держится: набеги
      // идут постоянно, а разоряет мир только прорвавшийся.
      if (rng.next() >= risk * PIR.raidSuccess) continue;

      const strike = raidStrike(nextWar, nextDeltas, worldSeed, i, owner, rng);
      if (strike === null) continue;
      nextWar = strike.war;
      nextDeltas = strike.deltas;
      raids.push({ systemId: id, owner, ruined: strike.ruined, sacked: strike.sacked });
    }
  }

  return { war: nextWar, deltas: nextDeltas, moves, focusMoves, raids };
}

/**
 * Удар прорвавшегося набега по миру: разорение и, с шансом, разграбление ступени развития. ОДИН на всех, кто
 * жжёт мир набегом, — вольницу (такт развития) и соседа, которому держава отказала в дани (`demands.ts`): два
 * определения «что делает набег» разошлись бы молча. `null` — разорение уже полное, жечь нечего.
 */
export function raidStrike(
  war: WarState,
  deltas: GalaxyDeltas,
  worldSeed: number,
  i: number,
  owner: string,
  rng: Rng,
): { war: WarState; deltas: GalaxyDeltas; ruined: number; sacked: boolean } | null {
  const id = GALAXY.id(i);
  const wasRuined = deltas[id]?.ruined ?? 0;
  const burn = PIR.raidRuinMin + rng.next() * (PIR.raidRuinMax - PIR.raidRuinMin);
  const ruined = Math.round(Math.min(1, wasRuined + burn) * 1000) / 1000;
  if (ruined === wasRuined) return null;
  let nextWar = shiftRuin(war, deltas, owner, worldSeed, i, wasRuined, ruined);
  let nextDeltas = withDelta(deltas, id, { ruined });

  // РАЗГРАБЛЕНИЕ. Одного разорения мало, и это показал замер: свежий пожар
  // только БЛОКИРУЕТ стройку (`ruinBlock`), а стройка выбирает мир случайно
  // из двух тысяч и почти никогда не попадает в заблокированный. Двадцать
  // набегов за декаду с весом по богатству дали 824 отстроенных мира за
  // десять лет против 852 без набегов вовсе — то есть не сдерживали ничего.
  //
  // Поэтому прорвавшийся набег на ОТСТРОЕННЫЙ мир сбивает ступень: набег
  // вывозит то, что мир нарастил. Это и есть противовес стройке в тех же
  // единицах, в каких она считается, — и единственное, что вообще способно
  // её уравновесить. На канонический мир (ступеней нет) это не действует:
  // грабить там нечего сверх того, что уже сожжено разорением.
  const built = developmentOf(nextDeltas, id);
  let sacked = false;
  if (built > DEV.min && rng.next() < PIR.raidSackChance) {
    const applied = shift(nextWar, nextDeltas, worldSeed, i, owner, built - 1, 0);
    nextWar = applied.war;
    nextDeltas = applied.deltas;
    sacked = true;
  }
  return { war: nextWar, deltas: nextDeltas, ruined: Math.round((ruined - wasRuined) * 1000) / 1000, sacked };
}

/**
 * Сколько миров фракции отстроено сверх канона и сколько сведено ниже него.
 *
 * Считается по разрежённой карте, а не по каталогу, — для экрана и для замера.
 */
export function developmentShareOf(
  deltas: GalaxyDeltas,
  factionId: string,
  owners?: readonly string[],
): { readonly built: number; readonly decayed: number } {
  let built = 0;
  let decayed = 0;
  for (const id of Object.keys(deltas)) {
    const dev = deltas[id]?.development ?? 0;
    if (dev === 0) continue;
    const i = GALAXY.index(id);
    if (i < 0) continue;
    const owner = owners === undefined ? (deltas[id]?.owner ?? GALAXY.ownerId(i)) : (owners[i] as string);
    if (owner !== factionId) continue;
    if (dev > 0) built++;
    else decayed++;
  }
  return { built, decayed };
}

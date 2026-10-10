import { Rng } from '../../rng/index.js';
import { FACTION_LIST, GALAXY } from '../galaxy/catalog.js';
import { ownerOf, tributeOf, withDelta, type GalaxyDeltas } from '../galaxy/delta.js';
import {
  liveEnemiesOf,
  liveEnmity,
  relationOf,
  withRelation,
  type ReputationState,
} from '../reputation/state.js';
import { RELATIONS } from '../contracts/schema.js';
import { PLAYER_ACTOR_ID, isPlayerActor } from './actors.js';
import { actorWorlds } from './domain.js';
import {
  armyReadiness,
  boundByProtectorate,
  conquestOf,
  decayConquests,
  economyOf,
  fundOf,
  pactHolds,
  pactOf,
  planOf,
  suzerainOf,
  theaterOf,
  vassalsOf,
  withFund,
  withPact,
  withVassal,
  worldContributionAt,
  type Pact,
  type WarState,
} from './economy.js';
import type { FrontSector } from './front.js';
import type { FrontShares } from './logistics.js';
import { WAR } from './schema.js';
import { bordersOf, growthOf, politicalActor, threatOf } from './threat.js';

/**
 * Дипломатия (шаг 26) — три ступени подчинения и правила, по которым державы
 * их применяют.
 *
 * **Правила, а не состояние.** Само состояние — дань (поле дельты системы),
 * протекторат и договоры (`WarState.vassals`, `WarState.pacts`) — лежит там же,
 * где остальное состояние войны, ровно по тому же разделению, что у `plans.ts`
 * и `economy.ts`: разложи их иначе — и модуль правил стал бы импортировать
 * состояние, а состояние правила, кольцом.
 *
 * **Живая вражда живёт НЕ здесь, а в `reputation/state.ts`**, и это второе
 * отступление от плана шага 26 (первое — в `economy.ts::tributeFlows`). План
 * называл домом `liveEnmity` этот модуль. Так нельзя: раскладку военного фонда
 * по направлениям делает `economy.ts::accrue`, и он звал бы отсюда, а отсюда
 * зовётся `economy.ts` — кольцо. Настоящий дом у `liveEnmity` и без того один:
 * она точное обращение `initialRelation`, лежит рядом с ней и читает ту же
 * карту.
 *
 * **Три вещи, которые здесь держатся сознательно.**
 *
 * 1. **Ни одного броска.** Выбор «захват или дань» — веса и порог; предложение
 *    протектората — пороги; разрыв — пороги. Тикер остаётся весовыми правилами
 *    (`ai.md` §3), и порядок бросков потока `camp.war`, закреплённый с 21b, не
 *    сдвигается ни на один вызов: старые сохранения обязаны идти той же веткой.
 * 2. **Один и тот же код зовут фон и игрок.** Дань, наложенная Куритой, и дань,
 *    наложенная ротой, проходят через `imposeTribute`, договор — через
 *    `signPact`, признание сюзеренитета — через `canSubmit`. Различается только
 *    то, кто их вызвал (правило «фальши нет нигде», шаг 22c).
 * 3. **Всё конечно.** Дань истекает, договор истекает, протекторат разрывается.
 *    Без этого первый же сюзерен собрал бы карту за десять лет, и кампания
 *    кончилась бы сама собой без участия игрока.
 */

const D = WAR.diplomacy;
const M = RELATIONS.moves;

/** Что случилось с подчинением за такт. Из этого собирается сводка новостей. */
export interface DiplomacyMove {
  readonly kind:
    | 'tribute'
    | 'tributeLapsed'
    | 'protectorate'
    | 'protectorateBroken'
    | 'pact'
    | 'pactLapsed'
    | 'war'
    | 'peaceOffer'
    | 'coalition';
  /**
   * Кто сильнее в этой паре: сюзерен, получатель дани, инициатор договора. У
   * войны роты (шаг 76) — кто объявил; у предложения мира — кто предлагает.
   */
  readonly over: string;
  /** Кто подчинился или с кем договорились. */
  readonly under: string;
  /** Мир, о котором речь, — только у дани. */
  readonly systemId?: string;
  /** Род договора — только у договоров. */
  readonly pact?: Pact['kind'];
  /** Против кого коалиция (шаг 83) — только у `coalition`. */
  readonly against?: string;
  /** Кто ведёт коалицию против державы роты (шаг 91) — только у `war`, объявленной вслед за ведущим. */
  readonly leader?: string;
}

// --- ступень 1: дань ------------------------------------------------------------

/**
 * Тянет ли победителя к дани сильнее, чем к захвату.
 *
 * Веса, а не бросок, и все шесть слагаемых — из `war.json` → `diplomacy.choice`.
 * Положительные тянут к дани, отрицательные — к захвату:
 *
 * | Тянет к дани | Тянет к захвату |
 * |---|---|
 * | мир убыточен (доход ниже содержания) | мир промышленный: арсенал или рудник |
 * | держава уже большая — содержание давит | замысел объявлен именно на него |
 * | мир далеко от столицы победителя | отношение на самом дне: данника надо кому-то платить |
 *
 * Последняя строка и есть то, что удерживает механику от вырождения в «все всех
 * обложили»: с тем, кого ненавидят до дна, договориться нельзя, и Мисери
 * остаётся Мисери.
 */
export function tributePull(
  war: WarState,
  rep: ReputationState,
  worldSeed: number,
  deltas: GalaxyDeltas,
  sector: FrontSector,
): number {
  const C = D.choice;
  const i = sector.system;
  const contribution = worldContributionAt(worldSeed, deltas, i);

  let pull = 0;
  if (contribution.income <= contribution.upkeep) pull += C.unprofitable;
  pull += C.size * (economyOf(war, sector.attacker).worlds / GALAXY.count);
  const far = GALAXY.distanceToCapitalOf(i, sector.attacker);
  pull += C.distance * Math.min(1, (Number.isFinite(far) ? far : C.distanceLy) / C.distanceLy);
  pull -= C.capacity * Math.min(1, contribution.capacity / C.capacityMid);
  // РАЗБИТОГО СОСЕДА НЕ ДОБИВАЮТ, а превращают в клиента, — и это то самое
  // слагаемое, ради которого шаг взялся за долг §5в. Малая держава гибнет не
  // оттого, что её армия мала, а оттого, что у победителя нет другого способа
  // распорядиться победой, кроме как отнять мир. Чем меньше обороняющийся
  // относительно нападающего, тем сильнее тянет к дани.
  const strong = economyOf(war, sector.attacker).worlds;
  const weak = economyOf(war, sector.defender).worlds;
  if (strong > 0) pull += C.weak * Math.max(0, Math.min(1, 1 - weak / strong));
  const plan = planOf(war, sector.attacker);
  if (plan !== undefined && plan.against === sector.defender) pull -= C.plan;
  pull -= C.hate * Math.max(0, -relationOf(rep, sector.attacker, sector.defender));
  return pull;
}

export function prefersTribute(
  war: WarState,
  rep: ReputationState,
  worldSeed: number,
  deltas: GalaxyDeltas,
  sector: FrontSector,
): boolean {
  return tributePull(war, rep, worldSeed, deltas, sector) >= D.choice.threshold;
}

export interface TributeResult {
  readonly war: WarState;
  readonly deltas: GalaxyDeltas;
  readonly reputation: ReputationState;
  readonly move: DiplomacyMove;
}

/**
 * Обложить мир данью. Владелец НЕ меняется — в том и весь смысл ступени.
 *
 * Наложение стоит фонда направления (`diplomacy.tributeCost`) сверх обычной цены
 * наступления: подчинение дешевле захвата, но не бесплатно. Повторная победа над
 * тем же миром ПРОДЛЕВАЕТ срок — это и есть «дань требует подтверждения силой»,
 * и ровно поэтому срок конечен.
 *
 * Отношение пары идёт ВВЕРХ, а не вниз, и это не описка: подчинение — способ не
 * воевать. Такт фронта тут же уводит ту же пару вниз на `relationPerMove` за
 * само наступление, и суммарно дань всё равно теплее захвата.
 */
export function imposeTribute(
  war: WarState,
  deltas: GalaxyDeltas,
  rep: ReputationState,
  to: string,
  system: number,
  day: number,
): TributeResult {
  const id = GALAXY.id(system);
  const owner = ownerOf(deltas, system);
  const nextWar = spendFund(war, to, owner, D.tributeCost);
  return {
    war: nextWar,
    deltas: withDelta(deltas, id, {
      tribute: to,
      tributeUntil: day + D.tributeDecades * WAR.front.tickDays,
    }),
    reputation: shift(rep, to, owner, M.tribute),
    move: { kind: 'tribute', over: to, under: owner, systemId: id },
  };
}

/** Сколько миров державы `under` платит дань державе `over`. */
export function tributeCount(deltas: GalaxyDeltas, over: string, under: string, day: number): number {
  let n = 0;
  for (const id of Object.keys(deltas)) {
    if (tributeOf(deltas, id, day) !== over) continue;
    if (ownerOf(deltas, id) === under) n++;
  }
  return n;
}

// --- ступень 2: протекторат -----------------------------------------------------

/**
 * Может ли `under` признать сюзеренитет `over` — четыре порога и три
 * предохранителя.
 *
 * **Протекторат вырастает из дани.** Отдельного счётчика «взял несколько миров
 * подряд» не заводится: дань и есть тот счётчик, и он уже лежит в состоянии.
 * Держава признаёт сюзеренитет, когда сосед держит `vassalFromTributes` её миров
 * под данью, её собственная армия просела ниже `vassalMaxReadiness`, сосед
 * крупнее её в `vassalSizeRatio` раз, а отношение к нему не на самом дне.
 *
 * Три предохранителя от каскада, и все три обязательны — без них первый же
 * сюзерен собрал бы карту за десять лет:
 * 1. вассала вассала не бывает, и сюзерен сам не может быть чьим-то вассалом;
 * 2. у сюзерена не больше `vassalMax` вассалов;
 * 3. разрыв (`shouldBreak`) существует и срабатывает.
 */
export function canSubmit(
  war: WarState,
  rep: ReputationState,
  deltas: GalaxyDeltas,
  over: string,
  under: string,
  day: number,
): boolean {
  if (over === under) return false;
  if (suzerainOf(war, under) !== undefined) return false;
  if (suzerainOf(war, over) !== undefined) return false;
  if (vassalsOf(war, over).length >= D.vassalMax) return false;

  // Территория считается через `actorWorlds`, а не через `economyOf`: у державы
  // игрока записи в `FactionEconomy` нет вовсе, и прямое чтение молча отвергало
  // бы роту на любом пороге размера.
  // Держава роты (шаг 90): ничейные миры — не государство и вассалом её не становятся, а размер державы
  // меряется вместе с её вассалами (`realmBloc`). У фракций правило прежнее.
  if (isPlayerActor(over) && !politicalActor(under)) return false;
  const weak = actorWorlds(war, deltas, under);
  const strong = isPlayerActor(over) ? realmBloc(war, deltas) : actorWorlds(war, deltas, over);
  if (weak <= 0 || strong < weak * D.vassalSizeRatio) return false;
  if (relationOf(rep, over, under) < D.breakRelation) return false;
  // Два условия на одну и ту же дань, и оба обязательны: сколько миров и какая
  // это ДОЛЯ. Без числа протекторат вырастал бы из одного случайного данника;
  // без доли два мира под данью у Дэвиона с его четырьмя сотнями значили бы
  // столько же, сколько два у Nova Cat с пятнадцатью.
  const held = tributeCount(deltas, over, under, day);
  return held >= D.vassalFromTributes && held >= weak * D.vassalTributeShare;
}

/**
 * Размер державы роты вместе с вассалами (шаг 90, `notes.md` §10zu, ответ игрока на вопрос 2 шага 90): протекторат
 * растит державу не только захватом — вассал засчитывается в размер для следующего.
 */
export function realmBloc(war: WarState, deltas: GalaxyDeltas): number {
  let n = actorWorlds(war, deltas, PLAYER_ACTOR_ID);
  for (const v of vassalsOf(war, PLAYER_ACTOR_ID)) n += actorWorlds(war, deltas, v);
  return n;
}

/**
 * ПРОТЕКТОРАТ КАК УСЛОВИЕ МИРА (шаг 90). Фракция, уставшая от войны с державой и сама предложившая мир, может вместо
 * цели признать сюзеренитет — если она ведёт политику (не вольница и не ничейные миры), ничей не вассал, у державы
 * есть место под вассала (`vassalMax`) и держава с вассалами не меньше её в `diplomacy.peaceVassalRatio` раз. Это
 * мягче `vassalSizeRatio` мирного протектората: условие выбито войной. Предложение мира проверяет вызывающий.
 */
export function protectorateByPeace(war: WarState, deltas: GalaxyDeltas, factionId: string): boolean {
  if (!politicalActor(factionId) || suzerainOf(war, factionId) !== undefined) return false;
  if (vassalsOf(war, PLAYER_ACTOR_ID).length >= D.vassalMax) return false;
  const foe = actorWorlds(war, deltas, factionId);
  return foe > 0 && realmBloc(war, deltas) >= foe * D.peaceVassalRatio;
}

/**
 * Пора ли вассалу уходить.
 *
 * Сюзерен ослаб (армия просела ниже `breakReadiness` либо он сам стал меньше
 * вассала), отношение упало ниже `breakRelation`, или у сюзерена не осталось ни
 * одного данника из миров вассала — держать его больше нечем.
 *
 * Последнее условие и даёт естественную текучесть: дань истекает сама, и
 * протекторат, не подтверждённый силой, распадается без отдельного правила.
 */
export function shouldBreak(
  war: WarState,
  rep: ReputationState,
  deltas: GalaxyDeltas,
  under: string,
  over: string,
  day: number,
): boolean {
  if (armyReadiness(war, over) < D.breakReadiness) return true;
  if (relationOf(rep, over, under) < D.breakRelation) return true;
  if (actorWorlds(war, deltas, over) <= actorWorlds(war, deltas, under)) return true;
  return tributeCount(deltas, over, under, day) === 0;
}

// --- ступень 3: договоры пары ----------------------------------------------------

/** Заключить договор. Стоит фонда обеим сторонам и поднимает отношение пары. */
export function signPact(
  war: WarState,
  rep: ReputationState,
  a: string,
  b: string,
  kind: Pact['kind'],
  day: number,
): { war: WarState; reputation: ReputationState } {
  let next = withPact(war, a, b, { kind, untilDay: day + D.pactDecades * WAR.front.tickDays });
  next = spendFund(next, a, b, D.pactCost);
  next = spendFund(next, b, a, D.pactCost);
  return { war: next, reputation: shift(rep, a, b, M.pact) };
}

// --- такт ------------------------------------------------------------------------

export interface DiplomacyTickResult {
  readonly war: WarState;
  readonly deltas: GalaxyDeltas;
  readonly reputation: ReputationState;
  readonly moves: readonly DiplomacyMove[];
}

/**
 * Такт дипломатии — первое, что делает такт фронта, ещё до замыслов.
 *
 * Порядок здесь и есть порядок круга: *истекло и распалось → кто кому подчинён
 * сегодня → государства выбирают цель → наступления*. Подчинение, посчитанное
 * ПОСЛЕ наступлений той же декады, опоздало бы на декаду ко всему, на что оно
 * влияет, — прежде всего к списку участков фронта.
 *
 * **Отдельной задачи очереди у дипломатии нет, и это осознанно.** Она часть
 * такта войны, а не пятый календарь: новая задача означала бы новую запись в
 * схеме снимка и новый номер постановки, то есть другой порядок исполнения на
 * равных днях у всех старых кампаний, — ради бухгалтерии, которая и так идёт
 * раз в декаду вместе с фронтом.
 */
export function diplomacyTick(
  war: WarState,
  deltas: GalaxyDeltas,
  rep: ReputationState,
  day: number,
): DiplomacyTickResult {
  let nextWar = war;
  let nextDeltas = deltas;
  let nextRep = rep;
  const moves: DiplomacyMove[] = [];

  // 1. Истёкшая дань уходит из карты ЦЕЛИКОМ — иначе разрежённость протекла бы
  // через первую же закончившуюся войну (та же дисциплина, что у заживления
  // разорения и у обнулившегося направления фонда).
  for (const id of Object.keys(nextDeltas).sort()) {
    const d = nextDeltas[id];
    if (d?.tribute === undefined) continue;
    const i = GALAXY.index(id);
    const owner = i < 0 ? undefined : ownerOf(nextDeltas, i);
    // Смена владельца, в том числе переход к самому получателю, снимает дань сразу (`withDelta`).
    const lapsed = (d.tributeUntil ?? 0) <= day || owner === undefined;
    if (!lapsed) continue;
    moves.push({ kind: 'tributeLapsed', over: d.tribute, under: owner ?? d.tribute, systemId: id });
    nextDeltas = withDelta(nextDeltas, id, { tribute: undefined, tributeUntil: undefined });
  }

  // 2. Удержание данников стоит фонда КАЖДУЮ ДЕКАДУ, и это второй сток из трёх
  // (первый — сама подвижка вражды через роспуск, третий — цена наложения).
  // Гарнизон наблюдения, перехват караванов и администрация сбора не бесплатны;
  // держава, которой нечем платить, данников просто теряет по сроку.
  if (D.enforceCost > 0) {
    const held = new Map<string, Set<string>>();
    for (const id of Object.keys(nextDeltas)) {
      const to = tributeOf(nextDeltas, id, day);
      if (to === undefined) continue;
      const i = GALAXY.index(id);
      if (i < 0) continue;
      const from = ownerOf(nextDeltas, i);
      if (from === to) continue;
      const row = held.get(to);
      if (row === undefined) held.set(to, new Set([from]));
      else row.add(from);
    }
    for (const to of [...held.keys()].sort()) {
      for (const from of [...(held.get(to) as Set<string>)].sort()) {
        nextWar = spendFund(nextWar, to, from, D.enforceCost);
      }
    }
  }

  // 3. Истёкшие договоры.
  for (const pair of Object.keys(nextWar.pacts).sort()) {
    const p = nextWar.pacts[pair] as Pact;
    if (p.untilDay > day) continue;
    const [a, b] = pair.split('|') as [string, string];
    nextWar = withPact(nextWar, a, b, undefined);
    moves.push({ kind: 'pactLapsed', over: a, under: b, pact: p.kind });
  }

  // 4. Разрыв протектората. Идёт ПЕРЕД установлением: освободившийся вассал
  // имеет право в ту же декаду признать другого сюзерена, и это не поблажка —
  // ровно так и распадаются протектораты в пользу соседа посильнее.
  for (const under of Object.keys(nextWar.vassals).sort()) {
    const over = nextWar.vassals[under]?.suzerain;
    if (over === undefined) continue;
    if (!shouldBreak(nextWar, nextRep, nextDeltas, under, over, day)) continue;
    nextWar = withVassal(nextWar, under, undefined);
    nextRep = shift(nextRep, over, under, -M.protectorate);
    moves.push({ kind: 'protectorateBroken', over, under });
  }

  // 5. Признание сюзеренитета. Кандидаты — те, кто уже платит дань: обход идёт
  // по данникам, а не по всем парам акторов, и потому стоит десятков сравнений,
  // а не четырёхсот.
  const pressure = new Map<string, Map<string, number>>();
  for (const id of Object.keys(nextDeltas)) {
    const to = tributeOf(nextDeltas, id, day);
    if (to === undefined) continue;
    const i = GALAXY.index(id);
    if (i < 0) continue;
    const from = ownerOf(nextDeltas, i);
    if (from === to || isPlayerActor(from)) continue;
    const row = pressure.get(from) ?? new Map<string, number>();
    row.set(to, (row.get(to) ?? 0) + 1);
    pressure.set(from, row);
  }
  for (const under of [...pressure.keys()].sort()) {
    for (const over of [...(pressure.get(under) as Map<string, number>).keys()].sort()) {
      if (!canSubmit(nextWar, nextRep, nextDeltas, over, under, day)) continue;
      nextWar = withVassal(nextWar, under, { suzerain: over, sinceDay: day });
      nextRep = shift(nextRep, over, under, M.protectorate);
      moves.push({ kind: 'protectorate', over, under });
      break;
    }
  }

  // 6. МИРА ПРОСЯТ, КОГДА ПРОИГРЫВАЮТ. Держава, воюющая не меньше чем на
  // `pactMinFronts` направлениях и просевшая армией, покупает перемирие у того,
  // кого ненавидит меньше всех. Это второй способ распорядиться военным фондом
  // помимо наступления — и в отличие от дани он доступен даже тому, кто ни разу
  // не победил.
  //
  // Число фронтов считается по ЖИВОЙ вражде, а не по участкам карты: обход
  // участков стоил бы второго прохода по каталогу за декаду, а вопрос здесь не
  // «где граница», а «со сколькими воюем».
  for (const f of FACTION_LIST) {
    const id = f.id;
    if (suzerainOf(nextWar, id) !== undefined) continue;
    if (armyReadiness(nextWar, id) >= D.pactReadiness) continue;
    // ОДНА ДЕРЖАВА — ОДНО ПЕРЕМИРИЕ ЗА РАЗ, и это не косметическое ограничение.
    // Без него обескровленная фракция подписывала бы договор КАЖДУЮ ДЕКАДУ,
    // пока не выкупится из всех своих войн разом: замер дал 32 действующих
    // договора на карте из примерно шестидесяти враждующих пар, то есть половина
    // Сферы переставала воевать за первые же годы. Купить мир у одного соседа
    // можно; у всех сразу — это уже не дипломатия, а выход из игры.
    //
    // Считаются только ПЕРЕМИРИЯ (шаг 83): торговый договор с мирным соседом не мешает купить мир у
    // врага — до торговли ИИ других договоров у фракций и не бывало.
    if (holdsTruce(nextWar, id)) continue;
    const foes = liveEnemiesOf(nextRep, id, WAR.economy.fundMinEnmity).filter(
      (e) => !boundOrTruced(nextWar, id, e.id, day) && economyOf(nextWar, e.id).worlds > 0,
    );
    if (foes.length < D.pactMinFronts) continue;

    // Партнёр — тот, кого ненавидят МЕНЬШЕ ВСЕХ: договориться можно не со
    // всяким, и с Мисери за спиной не договариваются вовсе.
    let best: string | undefined;
    let bestRelation = D.pactMinRelation;
    for (const e of foes) {
      if (planOf(nextWar, id)?.against === e.id) continue;
      const r = relationOf(nextRep, id, e.id);
      if (r <= bestRelation) continue;
      bestRelation = r;
      best = e.id;
    }
    if (best === undefined) continue;

    const signed = signPact(nextWar, nextRep, id, best, 'truce', day);
    nextWar = signed.war;
    nextRep = signed.reputation;
    moves.push({ kind: 'pact', over: id, under: best, pact: 'truce' });
  }

  return { war: nextWar, deltas: nextDeltas, reputation: nextRep, moves };
}

// --- общее ------------------------------------------------------------------------

/**
 * Сдвинуть отношение пары. Единственная запись в матрицу за пределами такта
 * фронта, и она тоже идёт из такта войны — правило «матрицу двигает мир, а не
 * рота» остаётся в силе.
 */
export function shift(rep: ReputationState, a: string, b: string, delta: number): ReputationState {
  if (delta === 0) return rep;
  return withRelation(rep, a, b, relationOf(rep, a, b) + delta);
}

/** Списать долю фонда направления. Тот же приём, что у `front.ts::spend`. */
function spendFund(war: WarState, from: string, against: string, share: number): WarState {
  const have = fundOf(war, from, against);
  if (have <= 0 || share <= 0) return war;
  return withFund(war, from, against, have * (1 - Math.min(1, share)));
}

/**
 * Общий враг: обе стороны наступали на третью в одну декаду.
 *
 * Та самая сеть, ради которой матрица и заводилась, — только теперь она работает
 * не на репутацию отряда, а на политическую карту. Подвижка мелкая
 * (`moves.commonEnemy`) намеренно: событие частое, и крупный шаг схлопнул бы
 * половину карты в союз за пару лет.
 */
export function commonEnemyPairs(
  moves: readonly { readonly attacker: string; readonly defender: string }[],
): readonly (readonly [string, string])[] {
  const byTarget = new Map<string, Set<string>>();
  for (const m of moves) {
    const row = byTarget.get(m.defender);
    if (row === undefined) byTarget.set(m.defender, new Set([m.attacker]));
    else row.add(m.attacker);
  }
  const out: (readonly [string, string])[] = [];
  for (const target of [...byTarget.keys()].sort()) {
    const list = [...(byTarget.get(target) as Set<string>)].sort();
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) out.push([list[i] as string, list[j] as string]);
    }
  }
  return out;
}

/** Живая вражда пары с оглядкой на подчинение: сюзерен и вассал не воюют. */
export function warEnmity(war: WarState, rep: ReputationState, a: string, b: string, day: number): number {
  if (boundOrTruced(war, a, b, day)) return 0;
  return liveEnmity(rep, a, b);
}

/**
 * Связаны ли двое так, что участка фронта между ними не бывает: протекторат
 * (сюзерен с вассалом либо два вассала одного сюзерена) или действующее
 * перемирие.
 */
export function boundOrTruced(war: WarState, a: string, b: string, day: number): boolean {
  return boundByProtectorate(war, a, b) || pactHolds(war, a, b, 'truce', day);
}

/** Есть ли у фракции действующее перемирие с кем-нибудь: одна держава — одно перемирие за раз. */
function holdsTruce(war: WarState, id: string): boolean {
  return Object.keys(war.pacts).some((pair) => war.pacts[pair]?.kind === 'truce' && pair.split('|').includes(id));
}

// --- мир в конце такта (шаг 83) ----------------------------------------------------

/**
 * Дипломатия мира в конце такта фронта (шаг 83): угроза, коалиции, второй фронт, торговля — и память
 * захватов тает. В конце, а не в `diplomacyTick`: второму фронту нужны доли направлений и театры после
 * боёв этой декады, угрозе — её захваты. Подписанное здесь снимает участки фронта со следующей декады.
 *
 * Бросок один — торговый договор, и он не из потока `camp.war`, а из сида мира, дня и пары (тот же
 * приём, что у боя фронта, `battle.ts::battleSeed`): порядок бросков фронта на старых сохранениях не
 * сдвигается.
 *
 * Порядок внутри — порядок причин: угроза двигает отношения → по ним и по угрозе складываются
 * коалиции → проигрывающий на двух фронтах покупает мир → мирные соседи торгуют.
 */
export function worldDiplomacy(
  war: WarState,
  rep: ReputationState,
  deltas: GalaxyDeltas,
  worldSeed: number,
  day: number,
  shares: FrontShares,
): { war: WarState; reputation: ReputationState; moves: DiplomacyMove[] } {
  let nextWar = war;
  let nextRep = rep;
  const moves: DiplomacyMove[] = [];
  const borders = bordersOf(deltas);
  const growth = growthOf(war);

  // 1. УГРОЗА. Кому и насколько угрожает каждый растущий. Грубый отсев до обхода соседей: доля границы
  // не больше единицы, и рост, который не дотягивает до порога даже при `powerMax`, угрозы не даёт.
  const threatened = new Map<string, { readonly id: string; readonly threat: number }[]>();
  for (const j of [...growth.keys()].sort()) {
    if ((growth.get(j) ?? 0) * D.powerMax < D.threatMin) continue;
    const row: { id: string; threat: number }[] = [];
    for (const i of [...(borders.touching.get(j)?.keys() ?? [])].sort()) {
      if (!politicalActor(i)) continue;
      const threat = threatOf(nextWar, borders, growth, i, j);
      if (threat < D.threatMin) continue;
      row.push({ id: i, threat });
      // Пары с державой роты угроза не двигает: иначе фронт с ней открывался бы без объявления, а
      // войну державе объявляют явно (`playerWar.ts`, `aiDeclareThreat`).
      if (!isPlayerActor(j)) nextRep = shift(nextRep, i, j, -Math.min(D.threatRelationMax, D.threatRelation * threat));
    }
    if (row.length > 0) threatened.set(j, row);
  }

  // 2. КОАЛИЦИЯ. Те, кому угрожает один и тот же, сближаются; если между ними самими живая вражда —
  // покупают перемирие друг у друга, чтобы не воевать на два фронта против общего врага.
  for (const j of [...threatened.keys()].sort()) {
    const row = threatened.get(j) as { id: string; threat: number }[];
    for (let x = 0; x < row.length; x++) {
      for (let y = x + 1; y < row.length; y++) {
        const a = row[x] as { id: string; threat: number };
        const b = row[y] as { id: string; threat: number };
        nextRep = shift(nextRep, a.id, b.id, Math.min(D.threatBondMax, D.threatBond * Math.min(a.threat, b.threat)));
        if (liveEnmity(nextRep, a.id, b.id) < WAR.front.minEnmity) continue;
        if (boundOrTruced(nextWar, a.id, b.id, day) || pactOf(nextWar, a.id, b.id) !== undefined) continue;
        if (relationOf(nextRep, a.id, b.id) <= D.pactMinRelation) continue;
        if (holdsTruce(nextWar, a.id) || holdsTruce(nextWar, b.id)) continue;
        const signed = signPact(nextWar, nextRep, a.id, b.id, 'truce', day);
        nextWar = signed.war;
        nextRep = signed.reputation;
        moves.push({ kind: 'coalition', over: a.id, under: b.id, pact: 'truce', against: j });
      }
    }
  }

  // 3. ВТОРОЙ ФРОНТ. Держава, у которой враг перевешивает театром на `secondFrontMin` направлениях и
  // больше, покупает перемирие у того, кто отнял у неё больше всего миров по памяти захватов. Нет
  // чистой потери — мир не нужен: перевес по машинам без потерянных миров не поражение.
  for (const f of FACTION_LIST) {
    const id = f.id;
    if (!politicalActor(id) || suzerainOf(nextWar, id) !== undefined || holdsTruce(nextWar, id)) continue;
    const outnumbered = Object.keys(shares[id] ?? {}).filter(
      (e) =>
        !isPlayerActor(e) &&
        !boundOrTruced(nextWar, id, e, day) &&
        theaterOf(nextWar, e, id) > theaterOf(nextWar, id, e),
    ).length;
    if (outnumbered < D.secondFrontMin) continue;
    // Враги отсортированы по id: при равной потере берётся первый.
    let best: string | undefined;
    let bestLoss = 0;
    for (const e of liveEnemiesOf(nextRep, id, WAR.economy.fundMinEnmity)) {
      if (!politicalActor(e.id) || boundOrTruced(nextWar, id, e.id, day)) continue;
      if (planOf(nextWar, id)?.against === e.id) continue;
      if (relationOf(nextRep, id, e.id) <= D.pactMinRelation) continue;
      const loss = conquestOf(nextWar, e.id, id) - conquestOf(nextWar, id, e.id);
      if (loss < D.secondFrontLossMin || (best !== undefined && loss <= bestLoss)) continue;
      bestLoss = loss;
      best = e.id;
    }
    if (best === undefined) continue;
    const signed = signPact(nextWar, nextRep, id, best, 'truce', day);
    nextWar = signed.war;
    nextRep = signed.reputation;
    moves.push({ kind: 'pact', over: id, under: best, pact: 'truce' });
  }

  // 4. ТОРГОВЛЯ. Соседи без живой вражды и с отношением не ниже `tradeMinRelation` подписывают
  // торговый договор с шансом от отношения — теми же числами, что договор роты.
  for (const a of [...borders.touching.keys()].sort()) {
    if (!politicalActor(a)) continue;
    for (const b of [...(borders.touching.get(a) as ReadonlyMap<string, number>).keys()].sort()) {
      if (b <= a || !politicalActor(b)) continue;
      if (pactOf(nextWar, a, b) !== undefined || boundByProtectorate(nextWar, a, b)) continue;
      if (liveEnmity(nextRep, a, b) >= WAR.front.minEnmity) continue;
      const r = relationOf(nextRep, a, b);
      if (r < D.tradeMinRelation) continue;
      const chance = (D.tradeChanceMax * (r - D.tradeMinRelation)) / (1 - D.tradeMinRelation);
      if (chance <= 0 || new Rng(tradeSeed(worldSeed, a, b, day)).next() >= chance) continue;
      const signed = signPact(nextWar, nextRep, a, b, 'trade', day);
      nextWar = signed.war;
      nextRep = signed.reputation;
      moves.push({ kind: 'pact', over: a, under: b, pact: 'trade' });
    }
  }

  // 5. Память захватов тает — последней: захваты этой декады вошли в угрозу целиком.
  return { war: decayConquests(nextWar), reputation: nextRep, moves };
}

/** Сид броска торгового договора: мир, пара, день — тот же хэш, что у сида боя фронта. */
function tradeSeed(worldSeed: number, a: string, b: string, day: number): number {
  let h = (worldSeed >>> 0) ^ 0x7f4a7c15;
  const text = `trade|${a}|${b}|${day}`;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

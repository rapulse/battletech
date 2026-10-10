import { FACTION_LIST, GALAXY } from '../galaxy/catalog.js';
import type { GalaxyDeltas } from '../galaxy/delta.js';
import { liveEnmity, type ReputationState } from '../reputation/state.js';
import { PLAYER_ACTOR_ID, isPlayerActor } from './actors.js';
import {
  armyReference,
  domainCapitalIndex,
  economyOf,
  theaterOf,
  theatersOf,
  totalArmy,
  withEconomy,
  withTheater,
  type WarState,
} from './economy.js';
import { WAR } from './schema.js';

/**
 * ЛОГИСТИКА И ДВА ЭШЕЛОНА (шаг 27, фаза 4 Части 3) — правила, а не состояние.
 *
 * Само состояние (`WarState.theaters`, `FactionEconomy.lift`) лежит в
 * `war/economy.ts` рядом с военным фондом и мощностью; здесь только то, что его
 * двигает. То же разделение, что у `plans.ts` и `diplomacy.ts`, и заведено оно
 * не ради аккуратности: разложи их иначе — и модуль правил стал бы
 * импортировать состояние, а состояние правила, кольцом.
 *
 * ## Чего здесь нет и не будет
 *
 * **Ни одного вызова `findRoute` и `jumpDistance`.** Первый — A\* по каталогу,
 * второй — обход в ширину по всем 2000 системам, а участков фронта около
 * пятисот за такт. Перелёт моделируется ЗАДЕРЖКОЙ и ПОТОЛКОМ ПРОПУСКНОЙ
 * СПОСОБНОСТИ, а не движущимся объектом (решение §6 дорожной карты Части 3), и
 * всё расстояние здесь считает `GALAXY.distance` — две выборки из массивов
 * координат.
 *
 * **Нет состояния «полк в пути».** Ушедшее из резерва приходит в театр в том же
 * такте: задержка выражена потолком, а не очередью. Третье состояние ради того
 * же эффекта не заводится.
 *
 * ## Два эшелона
 *
 * | Эшелон | Что это | Где хранится | Летает |
 * |---|---|---|---|
 * | 1. Ополчение | `profile.garrison`, побитый разорением | выводится из сида | нет |
 * | 2. Полевые полки | театр «откуда → против кого» | `WarState.theaters` | да, через подъёмную силу |
 *
 * Ополчение держит оборону мира снизу и в наступлении не участвует вовсе.
 * Полевые полки множат и наступление, и оборону — но только на СВОЁМ
 * направлении, в чём и весь смысл шага: до него один пул одинаково множил и
 * оборону Твайкросса, и наступление за триста световых лет оттуда.
 */

const LOG = WAR.logistics;
const E = WAR.economy;

// --- чтение -------------------------------------------------------------------

/**
 * Доли направлений во фронте фракции: `откуда → против кого → доля`.
 *
 * Нормированные `frontWeights`, и они же — знаменатель готовности театра.
 * Считаются ОДИН РАЗ на такт из уже построенного списка участков: звать их на
 * каждый участок значило бы пересчитывать весь фронт пятьсот раз за декаду.
 */
export type FrontShares = Readonly<Record<string, Readonly<Record<string, number>>>>;

export function frontShares(
  weights: Readonly<Record<string, Readonly<Record<string, number>>>>,
): FrontShares {
  const out: Record<string, Record<string, number>> = {};
  for (const from of Object.keys(weights)) {
    const row = weights[from] as Readonly<Record<string, number>>;
    let total = 0;
    for (const k of Object.keys(row)) total += row[k] as number;
    if (total <= 0) continue;
    const share: Record<string, number> = {};
    for (const k of Object.keys(row)) share[k] = (row[k] as number) / total;
    out[from] = share;
  }
  return out;
}

/**
 * ПЛЕЧО НАПРАВЛЕНИЯ в прыжках: от столицы владельца до БЛИЖАЙШЕГО участка
 * этого направления.
 *
 * Ближайшего, а не среднего: снабжают фронт через ближний плацдарм, а не через
 * центр тяжести чужой границы. Считается один раз на такт проходом по уже
 * построенному списку участков — `GALAXY.distance` за O(1) на каждый, поэтому
 * пятьсот участков стоят пятисот вычитаний, а не пятисот обходов каталога.
 *
 * Плечо есть у ОБОИХ: у нападающего — до мира, который он берёт, у
 * обороняющегося — до своего же мира, который он держит. У обороняющегося оно
 * обычно короче, и это верно по существу: воевать у себя дома дешевле.
 */
export type TheaterJumps = Readonly<Record<string, Readonly<Record<string, number>>>>;

export function theaterJumps(
  deltas: GalaxyDeltas,
  sectors: readonly { readonly system: number; readonly attacker: string; readonly defender: string }[],
): TheaterJumps {
  const out: Record<string, Record<string, number>> = {};
  const capital = playerCapitalOf(deltas);
  for (const s of sectors) {
    for (const [from, against] of [
      [s.attacker, s.defender],
      [s.defender, s.attacker],
    ] as const) {
      const j = jumpsFromCapital(s.system, from, capital);
      const row = out[from] ?? (out[from] = {});
      const prev = row[against];
      if (prev === undefined || j < prev) row[against] = j;
    }
  }
  return out;
}

function playerCapitalOf(deltas: GalaxyDeltas): number | undefined {
  return domainCapitalIndex(deltas);
}

function jumpsFromCapital(system: number, actor: string, playerCapital: number | undefined): number {
  const ly = isPlayerActor(actor)
    ? playerCapital === undefined
      ? 0
      : GALAXY.distance(system, playerCapital)
    : GALAXY.distanceToCapitalOf(system, actor);
  if (!Number.isFinite(ly)) return LOG.jumpsMax;
  return Math.max(1, Math.min(LOG.jumpsMax, Math.round(ly / GALAXY.jumpRangeLy)));
}

/**
 * Сколько машин направлению ПОЛАГАЕТСЯ — знаменатель готовности театра.
 *
 * Территориальная норма фракции, разделённая по доле направления во фронте.
 * Два решения в одной строке, и оба перенесены из шага 25 сознательно.
 *
 * **Норма территориальная, а не от мощности** (`armyReference`, а не
 * `armyTarget`): готовность множит силу стороны на участке, то есть величина
 * относительная. Считай её от мощности — у державы, которой сожгли арсеналы,
 * вместе с мощностью упала бы и цель, отношение осталось бы прежним, и
 * выжженная держава дралась бы ровно как целая.
 *
 * **Делится по доле ФРОНТА, а не поровну между врагами.** Поровну — и деление
 * ничего не значило бы: держава, стянувшая всё на одно направление, читалась бы
 * там ровно такой же, как держава, размазавшая армию по всем шести. Доля фронта
 * же говорит, чего направление стоит: половина границы заслуживает половины
 * армии.
 */
export function theaterReference(war: WarState, from: string, against: string, shares: FrontShares): number {
  const share = shares[from]?.[against] ?? 0;
  if (share <= 0) return 0;
  return armyReference(economyOf(war, from).worlds) * share;
}

/**
 * ГОТОВНОСТЬ ТЕАТРА — то, чем `armyReadiness` была до шага 27, но по одному
 * направлению.
 *
 * Единица — направление укомплектовано по норме, ниже — обескровлено. Отсюда и
 * главное свойство, невыразимое до этого шага: **разбитый театр обваливает одно
 * направление, а держава остаётся жива.** До шага 27 у державы был один пул на
 * всю Сферу, и потерять фронт, оставшись сильной, она не могла по построению.
 *
 * Направление, у которого нет доли во фронте (граница с этим врагом пропала),
 * даёт единицу, а не ноль: у фракции, потерявшей приграничный мир, наступление
 * не обязано становиться бесплатным, но и обваливаться ему не с чего.
 */
export function theaterReadiness(
  war: WarState,
  from: string,
  against: string,
  shares: FrontShares,
): number {
  const reference = theaterReference(war, from, against, shares);
  if (reference <= 0) return 1;
  return Math.max(E.armyMinShare, Math.min(1.5, theaterOf(war, from, against) / reference));
}

/**
 * Множитель обороны от полевых полков — второй эшелон поверх ополчения.
 *
 * `militiaShare` держит ополчение: гарнизон мира, выведенный из населения и
 * военной промышленности, никуда не летающий. Остальное даёт театр.
 *
 * **При полной готовности театра множитель равен ровно единице**, то есть
 * оборона побитово та же, что до шага 27, — и это не совпадение, а условие, по
 * которому число и выбрано: восемь коридоров §6 калиброваны на прежней формуле,
 * и шаг обязан менять то, что происходит при РАЗБИТОМ театре, а не то, что
 * происходит при целом. Разбитый театр даёт 0.30 вместо прежних 0.10 — мир
 * держится ополчением, а не сдаётся первому же наступлению.
 */
export function militiaBacked(readiness: number): number {
  return LOG.militiaShare + (1 - LOG.militiaShare) * readiness;
}

// --- такт ---------------------------------------------------------------------

/**
 * Такт логистики — звено внутри такта экономики, сразу после пополнения армии.
 *
 * Порядок внутри такта и есть порядок круга: заводы построили → расформировали
 * то, против чего больше не воюют → отвели лишнее → отправили недостающее.
 *
 * ```
 * резерв (army) --подъёмная сила / плечо--> театр(против врага X)
 * ```
 *
 * **Порядок обхода закреплён явно** — `FACTION_LIST`, внутри — сортировка
 * ключей направлений: переброска не бросает кубик, но зависит от порядка, в
 * котором направления вычерпывают общую подъёмную силу, и «как получилось в
 * карте» означало бы другой мир на том же сиде после загрузки.
 */
export function logisticsTick(
  war: WarState,
  rep: ReputationState,
  shares: FrontShares,
  jumps: TheaterJumps,
  actors: readonly string[] = FACTION_LIST.map((f) => f.id),
): WarState {
  let next = war;
  for (const id of actors) next = actorLogistics(next, rep, id, shares, jumps);
  return next;
}

function actorLogistics(
  war: WarState,
  rep: ReputationState,
  id: string,
  shares: FrontShares,
  jumps: TheaterJumps,
): WarState {
  const player = isPlayerActor(id);
  const row = player ? realmRow(war, shares[id] ?? {}) : foeRow(war, id, shares[id] ?? {});
  let next = disband(war, rep, id, player ? row : undefined);

  const eco = economyOf(next, id);
  const total = totalArmy(next, id);
  if (total <= 0) return next;

  // РЕЗЕРВ НЕ ОПУСКАЕТСЯ НИЖЕ ДОЛИ ОТ АРМИИ — тот же приём, что `armyMinShare`
  // у армии, и тот же предохранитель: без него держава заперла бы весь кулак на
  // одном направлении и рассыпалась бы от второго врага, не имея чем ответить.
  const deployable = total * (1 - LOG.reserveShare);
  const directions = Object.keys(row).sort();

  // 1. Отвести лишнее. Направление, чья доля во фронте упала (границу отодвинули
  //    или сосед перестал быть врагом), возвращает избыток в резерв — и платит
  //    за это по цене `crossCost`, вчетверо дороже отправки. Это и есть
  //    единственный предохранитель от того, чтобы один и тот же кулак гонялся по
  //    всей границе каждую декаду.
  let budget = eco.lift;
  for (const against of directions) {
    const target = Math.round(deployable * (row[against] as number));
    const have = theaterOf(next, id, against);
    if (have <= target) continue;
    const leg = jumps[id]?.[against] ?? LOG.jumpsMax;
    const can = Math.floor(budget / (leg * LOG.crossCost));
    const move = Math.min(have - target, can);
    if (move < LOG.minMove) continue;
    budget -= move * leg * LOG.crossCost;
    next = withTheater(next, id, against, have - move);
    next = withEconomy(next, id, { army: economyOf(next, id).army + move });
  }

  // 2. Отправить недостающее. Подъёмная сила делится между направлениями
  //    пропорционально НЕХВАТКЕ, а не поровну и не по вражде: флот идёт туда,
  //    где не хватает, — и это то же правило, по которому фонд идёт туда, где
  //    фронт, а не туда, где просто не любят.
  const need: { against: string; want: number; leg: number }[] = [];
  let wanted = 0;
  for (const against of directions) {
    const target = Math.round(deployable * (row[against] as number));
    const want = target - theaterOf(next, id, against);
    if (want <= 0) continue;
    need.push({ against, want, leg: jumps[id]?.[against] ?? LOG.jumpsMax });
    wanted += want;
  }
  if (need.length === 0 || wanted <= 0) return next;

  for (const n of need) {
    const reserve = economyOf(next, id).army;
    if (reserve <= 0) break;
    // Доля подъёмной силы — по нехватке; потолок за такт — `доля / плечо`.
    // Дальний фронт питается медленнее, и никакого отдельного множителя
    // расстояния для этого не нужно: единица подъёмной силы и есть
    // машино-прыжок.
    const shareOfLift = (budget * n.want) / wanted;
    const move = Math.min(n.want, reserve, Math.floor(shareOfLift / n.leg));
    if (move < LOG.minMove) continue;
    next = withTheater(next, id, n.against, theaterOf(next, id, n.against) + move);
    next = withEconomy(next, id, { army: reserve - move });
  }
  return next;
}

/**
 * ДОЛИ НАПРАВЛЕНИЙ ДЕРЖАВЫ РОТЫ (шаг 90, `notes.md` §10zu п. 5): направление, где у державы запись войны, весит в
 * `domain.warFrontWeight` раз больше фронта одной вражды (кланы и вольница — враги «от рождения»). Партия: при войне
 * с Соколами логистика держала 46 машин из 85 против Гадюк, с которыми войны не было. Доли — только для раскладки
 * армии; готовность театра и эталон считаются от общих долей фронта, как у всех.
 */
function realmRow(war: WarState, row: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
  const weighted: Record<string, number> = {};
  let total = 0;
  for (const k of Object.keys(row).sort()) {
    const w = (row[k] as number) * (war.playerWars?.[k] !== undefined ? WAR.domain.warFrontWeight : 1);
    weighted[k] = w;
    total += w;
  }
  if (total <= 0) return row;
  for (const k of Object.keys(weighted)) weighted[k] = (weighted[k] as number) / total;
  return weighted;
}

/**
 * ДОЛЯ НАПРАВЛЕНИЯ НА ДЕРЖАВУ У ФРАКЦИИ В ВОЙНЕ С НЕЙ (шаг 91) — зеркало `realmRow`: фракция с записью войны против
 * державы роты тянет туда полки в `domain.warFrontWeight` раз сильнее, чем по числу участков. Без этого направление на
 * державу в два-три мира получало у Дома с сотнями участков долю в проценты, и войны, объявленные державе, кончались
 * её победой всухую (зонд шага 91: 9 войн Дэвиона и Таурианцев за 10 лет — 9 побед державы). Мир без державы не
 * задет: записей войны нет.
 */
function foeRow(war: WarState, id: string, row: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
  if (war.playerWars?.[id] === undefined || row[PLAYER_ACTOR_ID] === undefined) return row;
  const weighted: Record<string, number> = {};
  let total = 0;
  for (const k of Object.keys(row).sort()) {
    const w = (row[k] as number) * (k === PLAYER_ACTOR_ID ? WAR.domain.warFrontWeight : 1);
    weighted[k] = w;
    total += w;
  }
  for (const k of Object.keys(weighted)) weighted[k] = (weighted[k] as number) / total;
  return weighted;
}

/**
 * РОСПУСК ТЕАТРА — зеркало роспуска военного фонда (`economy.ts::demobilize`).
 *
 * Направление, переставшее быть враждебным (договор, дань, протекторат или
 * просто годы без войны), расформировывается: полки уходят в резерв. **Даром и
 * мимо подъёмной силы**, и это не поблажка — расформирование не переброска, у
 * него нет плеча: части снимают с довольствия там, где они стоят.
 *
 * Без этого правила театр против помирившегося соседа держал бы машины вечно, и
 * держава с одним старым врагом и одним новым воевала бы новому одной третью
 * армии.
 */
function disband(war: WarState, rep: ReputationState, id: string, realm?: Readonly<Record<string, number>>): WarState {
  let next = war;
  for (const t of theatersOf(war, id)) {
    // Держава роты (шаг 90): направление без доли во фронте — перемирие, договор, граница пропала — тоже
    // расформировывается. Партия 2026-10-07: полки годами стояли против соседей под перемирием с эталоном 0.
    const idle = realm !== undefined && !((realm[t.against] ?? 0) > 0);
    if (!idle && liveEnmity(rep, id, t.against) >= E.fundMinEnmity) continue;
    if (t.mechs <= 0) continue;
    next = withTheater(next, id, t.against, 0);
    next = withEconomy(next, id, { army: economyOf(next, id).army + t.mechs });
  }
  return next;
}

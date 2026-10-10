import {
  CampaignState,
  FACTIONS,
  FACTION_LIST,
  GALAXY,
  WAR,
  armyReadiness,
  armyTarget,
  developmentShareOf,
  economyOf,
  forceSize,
  frontSectors,
  fundsOf,
  makeWarState,
  ownerOf,
  planList,
  sectorForces,
  frontShares,
  frontWeights,
  theaterJumps,
  theaterReference,
  theatersOf,
  totalArmy,
  capitalJumps,
  tensionOf,
  type CampaignEvent,
} from '../src/core/campaign/index.js';
import { dateOf } from '../src/core/campaign/clock.js';
import { EVENTS, eventWindow } from '../src/core/campaign/war/index.js';
import { RIVALS } from '../src/core/campaign/rivals/schema.js';
import { advanceAnswering } from '../src/sim/campaign/worldEvents.js';
import { CONTRACTS, contractBoard, frontierIndexAt, PIRATE_FACTION } from '../src/core/campaign/contracts/index.js';

/**
 * Прогон живого мира БЕЗ игрока — `pnpm worldstat` (шаг 23, часть C).
 *
 * **Зачем отдельный инструмент, когда есть `frontstat` и `econstat`.** Те двое
 * меряют по одному звену: `econstat` — как достаток раскладывается по акторам,
 * `frontstat` — как двигается граница. Оба зовут такты РУКАМИ, в своём порядке,
 * и оба ничего не знают ни про полки, ни про соперников, ни про развитие миров.
 * Баланс же шага 22c подбирался не по звену, а по КРУГУ — и подбирался вручную,
 * одним прогоном на глаз. Это работает ровно один раз.
 *
 * **Здесь мир крутится ровно тем же кодом, что в игре**: `execute` с
 * `advanceTo`, декада за декадой, вся очередь задач в её настоящем порядке
 * (экономика → фронт → события мира → развитие → соперники). Ни одного такта, вызванного
 * вручную, — потому что порядок тактов и есть половина того, что меряется, и
 * скрипт, зовущий их по-своему, замерил бы не игру, а себя.
 *
 * Рота игрока при этом СТОИТ: она в мире присутствует (соперники читают её
 * рейтинг), но ничего не делает. Это и есть «мир без игрока» — не мир без роты,
 * а мир, которому рота не помогает.
 *
 * Ключи:
 *   --seeds 1..3     сиды мира
 *   --ticks 100      декад на сид (100 декад ≈ 2.7 года)
 *   --years          срез по годам вместо одной сводки
 *   --set путь=знач  правка таблицы на лету: `--set front.attemptsMax=9`; биржа — `contracts.board.…`
 *   --compare        прогнать ДВАЖДЫ — без правок и с `--set` — и показать рядом
 *
 * **Про потолок в 1400 боёв (CLAUDE.md).** Он про ТАКТИЧЕСКИЕ бои `runBattle`,
 * каждый из которых стоит около 130 мс; их здесь ноль. Все бои прогона —
 * быстрые (`fastResolve`, около 2 мс), и они не батч замера, а часть такта
 * самого мира: ровно столько же их случится у игрока, просто сидящего в ангаре
 * сто декад. Число всё равно печатается — замер не имеет права умалчивать, во
 * что он обошёлся, — но считается отдельной строкой, а не под тем же потолком.
 * Стоимость: около 70 мс на декаду, то есть 3 сида × 100 декад ≈ 20 секунд.
 */

interface Args {
  readonly seeds: readonly number[];
  readonly ticks: number;
  readonly years: boolean;
  readonly sets: readonly (readonly [string, number])[];
  readonly compare: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  let seeds = '1..3';
  let ticks = 100;
  let years = false;
  let compare = false;
  const sets: (readonly [string, number])[] = [];
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--years') {
      years = true;
      continue;
    }
    if (key === '--compare') {
      compare = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined) continue;
    if (key === '--seeds') {
      seeds = value;
      i++;
    } else if (key === '--ticks') {
      ticks = Number(value);
      i++;
    } else if (key === '--set') {
      const eq = value.indexOf('=');
      if (eq > 0) sets.push([value.slice(0, eq), Number(value.slice(eq + 1))] as const);
      i++;
    }
  }
  const m = /^(\d+)\.\.(\d+)$/.exec(seeds);
  const list = m === null ? [Number(seeds)] : range(Number(m[1]), Number(m[2]));
  return { seeds: list, ticks, years, sets, compare };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/**
 * Правка таблицы на лету — то, ради чего вообще существует `--compare`.
 *
 * Пишет ПРЯМО В РАЗОБРАННУЮ таблицу (`WAR`, `RIVALS`), а не в JSON на диске:
 * модули держат ссылку на тот же объект (`const F = WAR.front`), поэтому правка
 * видна всем, кто читает её после. Возвращает функцию отката — без неё второй
 * прогон `--compare` считал бы уже с чужими числами.
 */
function applySets(sets: readonly (readonly [string, number])[]): () => void {
  const undo: (() => void)[] = [];
  for (const [path, value] of sets) {
    // `contracts.*` — таблица биржи (`CONTRACTS`), путь без приставки.
    const contracts = path.startsWith('contracts.');
    const parts = (contracts ? path.slice('contracts.'.length) : path).split('.');
    const root: Record<string, unknown> = contracts
      ? (CONTRACTS as unknown as Record<string, unknown>)
      : parts[0] === 'regiment' || parts[0] === 'tiers' || parts[0] === 'formation'
        ? (RIVALS as unknown as Record<string, unknown>)
        : (WAR as unknown as Record<string, unknown>);
    let node = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const next = node[parts[i] as string];
      if (typeof next !== 'object' || next === null) throw new Error(`нет такого пути: ${path}`);
      node = next as Record<string, unknown>;
    }
    const leaf = parts[parts.length - 1] as string;
    if (!(leaf in node)) throw new Error(`нет такого ключа: ${path}`);
    const was = node[leaf];
    node[leaf] = value;
    undo.push(() => {
      node[leaf] = was;
    });
  }
  return () => {
    for (const f of undo.reverse()) f();
  };
}

// --- что снимается с мира ------------------------------------------------------

/** Срез мира на конец декады. Из него собирается и сводка, и разрез по годам. */
interface Sample {
  readonly tick: number;
  readonly captures: number;
  readonly raids: number;
  /**
   * Наложений дани за декаду (шаг 26).
   *
   * Считается в «события за декаду» наравне с захватом и набегом, и это не
   * подгонка под коридор: выигранное наступление, кончившееся данью, — такое же
   * движение мира, как выигранное наступление, кончившееся флагом. Не считать
   * его значило бы объявить застывшей карту, на которой полтора десятка миров
   * сменили подданство.
   */
  readonly tributes: number;
  /** Средняя готовность армий Домов и кланов: 1.0 — армия в целевой численности. */
  readonly readiness: number;
  /** Подъёмная сила державы (шаг 27), машино-прыжков за декаду. */
  readonly lift: number;
  /** Сколько записей театров держится на карте: приёмка требует десятков, не тысяч. */
  readonly theaterRows: number;
  /** Медиана заполненности театра к его норме: полоса приёмки 0.4–1.2. */
  readonly theaterFill: number;
  /** Какая доля армий стоит на направлениях, а не в резерве. */
  readonly deployedShare: number;
  /** Среднее плечо направления в прыжках. */
  readonly meanLeg: number;
  /** Доля миров, до которых держава дотягивается с трудом: рычаг подъёмной силы. */
  readonly unreachableShare: number;
  /** Казна средней фракции, в тактах её же дохода. Мера «копится ли без стока». */
  readonly treasuryTicks: number;
  readonly fundTicks: number;
  readonly ruinedWorlds: number;
  readonly regimentShare: number;
  readonly rivals: number;
  /** Сколько государств прямо сейчас ведёт объявленное наступление (шаг 23, часть B). */
  readonly plans: number;
  /**
   * Медиана напряжённости участков фронта — единственное число, которым круг
   * СВЯЗАН С БИРЖЕЙ: из напряжённости берутся и опасность работы, и её цена
   * (`war/front.ts::tensionOf`). Уползи она к потолку — и биржа перестанет
   * отличать горячую границу от тихой, а мир снаружи этого не покажет.
   */
  readonly tension: number;
  /** Промышленная мощность всей Сферы (шаг 25): растёт стройкой, падает пожарами. */
  readonly capacity: number;
  /** Доля целевой численности, которую армии фракций фактически держат. */
  readonly armyFill: number;
  /** Миров под данью и держав в вассалитете (шаг 26). */
  readonly tributaries: number;
  /** Держав под чужой рукой: данники и вассалы, каждая считается один раз. */
  readonly subdued: number;
  readonly vassals: number;
  readonly pacts: number;
  /**
   * Доля пар, съехавших ниже −0.9, — главный предохранитель части A.
   *
   * Канал вниз работает на каждое наступление, каналы вверх — только по
   * событиям. Расти монотонно весь прогон эта доля не имеет права: иначе карта
   * уезжает в тотальную войну, фронт загорается везде разом, и мир становится
   * однороднее, а не живее.
   */
  readonly hostilePairs: number;
  /** Записей в матрице отношений: мера того, что разрежённость держится. */
  readonly relations: number;
}

interface Run {
  readonly seed: number;
  readonly samples: readonly Sample[];
  readonly battles: number;
  readonly changed: ReadonlySet<string>;
  readonly state: CampaignState;
  /** Сколько наступлений объявлено за прогон и сколько из них дошло до цели. */
  readonly declared: number;
  readonly achieved: number;
  /** Ступеней развития построено и просело за прогон. */
  readonly built: number;
  readonly decayed: number;
  /** Переделок фокуса начато и доведено до конца за прогон (шаг 25). */
  readonly focusStarted: number;
  readonly focusDone: number;
  /** Дипломатия за прогон (шаг 26): наложено дани, установлено и разорвано протекторатов. */
  readonly tributesImposed: number;
  readonly protectorates: number;
  readonly breaks: number;
  /**
   * Сколько машин выводят стороны на участках фронта — по ВСЕМ участкам, а не
   * только по тем, где наступление удалось.
   *
   * Считается по срезам, а не по событиям, и это принципиально: событие
   * `frontMoved` рождается только у ВЫИГРАННОГО боя, поэтому по событиям видны
   * одни удачные наступления, а они крупнее среднего. Вопрос «сколько машин
   * выходит на фоновую карту» требует ответа по всему фронту.
   */
  readonly forces: readonly number[];
}

/** Фракции, у которых есть армия и территория: по ним и меряется вырождение. */
const POWERS = FACTION_LIST.filter((f) => {
  const kind = FACTIONS.get(f.id)?.kind;
  return kind === 'house' || kind === 'clan' || kind === 'periphery';
});

/** Медиана списка. Пустой список даёт ноль — так его и читают все сводки. */
function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] as number;
}

/** Медиана напряжённости по всем участкам фронта на сегодня. */
function medianTension(state: CampaignState): number {
  const values: number[] = [];
  for (const s of frontSectors(state.war, state.reputation, state.deltas, state.day)) {
    values.push(tensionOf(state.war, state.reputation, s.attacker, s.defender, 1));
  }
  if (values.length === 0) return 0;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] as number;
}

function sample(
  state: CampaignState,
  tick: number,
  captures: number,
  raids: number,
  tributes: number,
): Sample {
  let readiness = 0;
  let treasuryTicks = 0;
  let fundTicks = 0;
  let counted = 0;
  let capacity = 0;
  let army = 0;
  let armyTargetTotal = 0;
  let lift = 0;
  for (const f of POWERS) {
    const eco = economyOf(state.war, f.id);
    if (eco.worlds === 0) continue;
    counted++;
    readiness += armyReadiness(state.war, f.id);
    let fund = 0;
    for (const row of fundsOf(state.war, f.id)) fund += row.amount;
    const income = Math.max(1, eco.income);
    treasuryTicks += eco.treasury / income;
    fundTicks += fund / income;
    capacity += eco.capacity;
    // ВСЯ армия, а не резерв (шаг 27): `eco.army` рядом с театрами означает уже
    // только то, что ещё не уехало на фронт.
    army += totalArmy(state.war, f.id);
    armyTargetTotal += armyTarget(eco.capacity);
    lift += eco.lift;
  }

  // ЛОГИСТИКА (шаг 27). Заполненность театра — сколько в нём машин против того,
  // сколько ему полагается по доле направления во фронте: приёмка требует
  // медианы в полосе 0.4–1.2, то есть чтобы театры не пустовали и не
  // переполнялись.
  const sectors = frontSectors(state.war, state.reputation, state.deltas, state.day);
  const shares = frontShares(frontWeights(sectors));
  const fills: number[] = [];
  const legs: number[] = [];
  let theaterRows = 0;
  let deployed = 0;
  let reserve = 0;
  for (const f of POWERS) {
    const eco = economyOf(state.war, f.id);
    if (eco.worlds === 0) continue;
    reserve += eco.army;
    for (const t of theatersOf(state.war, f.id)) {
      theaterRows++;
      deployed += t.mechs;
      const reference = theaterReference(state.war, f.id, t.against, shares);
      if (reference > 0) fills.push(t.mechs / reference);
    }
  }
  const jumpsByDir = theaterJumps(state.deltas, sectors);
  for (const from of Object.keys(jumpsByDir)) {
    const row = jumpsByDir[from] as Record<string, number>;
    for (const k of Object.keys(row)) legs.push(row[k] as number);
  }

  // Доля миров ВНЕ ДОСЯГАЕМОСТИ — главный рычаг шага: если ноль, подъёмная сила
  // избыточна, если выше трети, она задушила фронт. Мир считается недосягаемым,
  // когда плечо до столицы его владельца больше половины потолка.
  let unreachable = 0;
  let owned = 0;
  for (let i = 0; i < GALAXY.count; i++) {
    const owner = ownerOf(state.deltas, i);
    if (economyOf(state.war, owner).worlds === 0) continue;
    owned++;
    if (capitalJumps(state.deltas, i, owner) > WAR.logistics.jumpsMax / 2) unreachable++;
  }

  let ruinedWorlds = 0;
  for (const id of Object.keys(state.deltas)) if ((state.deltas[id]?.ruined ?? 0) > 0) ruinedWorlds++;

  let mechs = 0;
  let full = 0;
  for (const r of state.rivals.regiments) {
    mechs += r.mechs;
    full += r.fullMechs;
  }

  let tributaries = 0;
  // «Акторов в подчинении» — не миров, а ДЕРЖАВ: приёмка шага 26 спрашивает,
  // сколько государств живёт под чужой рукой, и один данник с десятью мирами и
  // десять данников с одним миром — это разные миры, а не одно число.
  const subdued = new Set<string>(Object.keys(state.war.vassals));
  for (const id of Object.keys(state.deltas)) {
    if ((state.deltas[id]?.tributeUntil ?? 0) <= state.day) continue;
    tributaries++;
    subdued.add(ownerOf(state.deltas, id));
  }
  let hostile = 0;
  const relations = Object.keys(state.reputation.relations);
  for (const key of relations) {
    if ((state.reputation.relations[key] as number) < -0.9) hostile++;
  }

  const n = Math.max(1, counted);
  return {
    tick,
    captures,
    raids,
    tributes,
    tributaries,
    subdued: subdued.size,
    vassals: Object.keys(state.war.vassals).length,
    pacts: Object.keys(state.war.pacts).length,
    hostilePairs: relations.length === 0 ? 0 : hostile / relations.length,
    relations: relations.length,
    readiness: readiness / n,
    lift: lift / n,
    theaterRows,
    theaterFill: fills.length === 0 ? 0 : median(fills),
    deployedShare: deployed + reserve === 0 ? 0 : deployed / (deployed + reserve),
    meanLeg: legs.length === 0 ? 0 : legs.reduce((a, b) => a + b, 0) / legs.length,
    unreachableShare: owned === 0 ? 0 : unreachable / owned,
    treasuryTicks: treasuryTicks / n,
    fundTicks: fundTicks / n,
    ruinedWorlds,
    regimentShare: full === 0 ? 1 : mechs / full,
    rivals: state.rivals.list.length,
    plans: planList(state.war).length,
    tension: medianTension(state),
    capacity,
    armyFill: armyTargetTotal === 0 ? 1 : army / armyTargetTotal,
  };
}

/**
 * Сколько быстрых боёв стоила декада.
 *
 * Считается по событиям, а не прикидкой: потолок CLAUDE.md — правило про БОИ, и
 * замер, который его нарушает, обязан сказать об этом сам, а не молчать.
 */
function battlesIn(events: readonly CampaignEvent[]): number {
  let n = 0;
  for (const e of events) {
    if (e.kind === 'frontMoved' || e.kind === 'rivalContract' || e.kind === 'regimentCommission') n++;
  }
  return n;
}

function run(seed: number, ticks: number): Run {
  const state = new CampaignState(seed);
  const samples: Sample[] = [];
  const changed = new Set<string>();
  const forces: number[] = [];
  let battles = 0;
  let declared = 0;
  let achieved = 0;
  let built = 0;
  let decayed = 0;
  let focusStarted = 0;
  let focusDone = 0;
  let tributesImposed = 0;
  let protectorates = 0;
  let breaks = 0;

  for (let tick = 1; tick <= ticks; tick++) {
    const result = advanceAnswering(state, tick * WAR.economy.tickDays);
    if (!result.ok) throw new Error(`такт ${tick} отклонён: ${String(result.reason)}`);
    let captures = 0;
    let raids = 0;
    let tributes = 0;
    for (const e of result.events) {
      if (e.kind === 'warPlan') {
        if (e.result === 'declared') declared++;
        else if (e.result === 'done') achieved++;
        continue;
      }
      if (e.kind === 'worldDeveloped') {
        if (e.built) built++;
        else decayed++;
        continue;
      }
      if (e.kind === 'worldFocus') {
        if (e.started) focusStarted++;
        else focusDone++;
        continue;
      }
      if (e.kind === 'diplomacyMoved') {
        if (e.move === 'tribute') {
          tributesImposed++;
          tributes++;
        }
        else if (e.move === 'protectorate') protectorates++;
        else if (e.move === 'protectorateBroken') breaks++;
        continue;
      }
      if (e.kind !== 'frontMoved') continue;
      if (e.kindOfMove === 'raid') raids++;
      else {
        captures++;
        changed.add(e.systemId);
      }
    }
    battles += battlesIn(result.events);
    // Срез сил — раз в десять декад: полный обход участков стоит дороже самого
    // такта, а распределение за декаду не меняется.
    if (tick % 10 === 0) {
      const sectors = frontSectors(state.war, state.reputation, state.deltas, state.day);
      const shares = frontShares(frontWeights(sectors));
      for (const s of sectors) {
        const f = sectorForces(state.war, state.worldSeed, state.deltas, s, shares);
        forces.push(forceSize(f.attack), forceSize(f.defence));
      }
    }
    samples.push(sample(state, tick, captures, raids, tributes));
  }
  return {
    seed,
    samples,
    battles,
    changed,
    state,
    declared,
    achieved,
    built,
    decayed,
    focusStarted,
    focusDone,
    tributesImposed,
    protectorates,
    breaks,
    forces,
  };
}

// --- сводка --------------------------------------------------------------------

function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

function sum(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0);
}

/** Квантиль по возрастанию. Для распределения сил медианы мало: важен и верх. */
function quantile(xs: readonly number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] as number;
}

/** Сколько миров стоит под ЧУЖИМ флагом относительно канона 3053 года. */
function underForeignFlag(deltas: Run['state']['deltas']): number {
  let n = 0;
  for (let i = 0; i < GALAXY.count; i++) if (ownerOf(deltas, i) !== GALAXY.ownerId(i)) n++;
  return n;
}

/** Итоги одного набора чисел: то, по чему круг и признаётся сошедшимся. */
interface Verdict {
  readonly rows: readonly (readonly [string, string])[];
}

function verdict(runs: readonly Run[], ticks: number): Verdict {
  const last = (r: Run): Sample => r.samples[r.samples.length - 1] as Sample;
  const opening = (r: Run): Sample => r.samples[0] as Sample;
  const early = (r: Run): readonly Sample[] => r.samples.slice(0, Math.max(1, Math.round(ticks * 0.2)));
  const late = (r: Run): readonly Sample[] => r.samples.slice(-Math.max(1, Math.round(ticks * 0.2)));

  // Вырождение карты: какую долю ВСЕХ обитаемых миров держит крупнейший актор и
  // насколько это больше, чем было на старте. Один Дом, съевший всех, виден
  // именно здесь и больше нигде.
  const dominance: number[] = [];
  const dominanceShift: number[] = [];
  const wiped: number[] = [];
  for (const r of runs) {
    const start = new CampaignState(r.seed).war;
    let total = 0;
    let top = 0;
    let topStart = 0;
    let totalStart = 0;
    let lost = 0;
    for (const f of FACTION_LIST) {
      const now = economyOf(r.state.war, f.id).worlds;
      const was = economyOf(start, f.id).worlds;
      total += now;
      totalStart += was;
      if (now > top) top = now;
      if (was > topStart) topStart = was;
      if (was >= 10 && now < was * 0.5) lost++;
    }
    dominance.push(total === 0 ? 0 : top / total);
    dominanceShift.push((total === 0 ? 0 : top / total) - (totalStart === 0 ? 0 : topStart / totalStart));
    wiped.push(lost);
  }

  // Застыла ли граница: события последней пятой прогона против первой.
  const borderEarly = mean(runs.map((r) => mean(early(r).map((s) => s.captures + s.raids + s.tributes))));
  const borderLate = mean(runs.map((r) => mean(late(r).map((s) => s.captures + s.raids + s.tributes))));

  return {
    rows: [
      ['событий за декаду', `${mean(runs.flatMap((r) => r.samples.map((s) => s.captures + s.raids + s.tributes))).toFixed(2)} (из них дань ${mean(runs.flatMap((r) => r.samples.map((s) => s.tributes))).toFixed(2)})`],
      ['захватов за прогон', `${mean(runs.map((r) => sum(r.samples.map((s) => s.captures)))).toFixed(1)}`],
      ['набегов за прогон', `${mean(runs.map((r) => sum(r.samples.map((s) => s.raids)))).toFixed(1)}`],
      ['разных миров сменило флаг', `${mean(runs.map((r) => r.changed.size)).toFixed(1)} из ${GALAXY.count} (${((mean(runs.map((r) => r.changed.size)) / GALAXY.count) * 100).toFixed(1)} % карты)`],
      ['из них стоит под чужим флагом к концу', `${mean(runs.map((r) => underForeignFlag(r.state.deltas))).toFixed(1)} (остальные отбиты обратно)`],
      ['машин на сторону: медиана / 90-й / верх', `${quantile(runs.flatMap((r) => r.forces), 0.5)} / ${quantile(runs.flatMap((r) => r.forces), 0.9)} / ${quantile(runs.flatMap((r) => r.forces), 1)} (потолок таблицы ${WAR.front.forceMax})`],
      ['граница: начало → конец', `${borderEarly.toFixed(2)} → ${borderLate.toFixed(2)} событий/декаду`],
      ['доля карты у крупнейшего', `${(mean(dominance) * 100).toFixed(1)} % (сдвиг ${(mean(dominanceShift) * 100 >= 0 ? '+' : '')}${(mean(dominanceShift) * 100).toFixed(1)} п.п.)`],
      ['фракций потеряло половину', `${mean(wiped).toFixed(1)}`],
      ['готовность армий: начало → конец', `${mean(runs.map((r) => mean(early(r).map((s) => s.readiness)))).toFixed(2)} → ${mean(runs.map((r) => mean(late(r).map((s) => s.readiness)))).toFixed(2)}`],
      ['казна, тактов дохода: начало → конец', `${mean(runs.map((r) => mean(early(r).map((s) => s.treasuryTicks)))).toFixed(1)} → ${mean(runs.map((r) => mean(late(r).map((s) => s.treasuryTicks)))).toFixed(1)}`],
      ['напряжённость участков: начало → конец', `${mean(runs.map((r) => mean(early(r).map((s) => s.tension)))).toFixed(3)} → ${mean(runs.map((r) => mean(late(r).map((s) => s.tension)))).toFixed(3)}`],
      ['военный фонд, тактов дохода', `${mean(runs.map((r) => mean(late(r).map((s) => s.fundTicks)))).toFixed(2)}`],
      ['фонд: начало → конец', `${mean(runs.map((r) => mean(early(r).map((s) => s.fundTicks)))).toFixed(2)} → ${mean(runs.map((r) => mean(late(r).map((s) => s.fundTicks)))).toFixed(2)} тактов дохода`],
      ['дань: наложено за прогон / держится к концу', `${mean(runs.map((r) => r.tributesImposed)).toFixed(1)} / ${mean(runs.map((r) => last(r).tributaries)).toFixed(1)} миров`],
      ['держав в подчинении к концу', `${mean(runs.map((r) => last(r).subdued)).toFixed(1)} (минимум по прогону ${Math.min(...runs.map((r) => Math.min(...late(r).map((s) => s.subdued))))})`],
      ['протектораты: установлено / разорвано / держится', `${mean(runs.map((r) => r.protectorates)).toFixed(1)} / ${mean(runs.map((r) => r.breaks)).toFixed(1)} / ${mean(runs.map((r) => last(r).vassals)).toFixed(1)}`],
      ['договоров пар к концу', `${mean(runs.map((r) => last(r).pacts)).toFixed(1)}`],
      ['записей матрицы отношений к концу', `${mean(runs.map((r) => last(r).relations)).toFixed(0)}`],
      ['доля пар ниже −0.9: начало → конец', `${(mean(runs.map((r) => mean(early(r).map((s) => s.hostilePairs)))) * 100).toFixed(1)} % → ${(mean(runs.map((r) => mean(late(r).map((s) => s.hostilePairs)))) * 100).toFixed(1)} %`],
      ['разорённых миров к концу', `${mean(runs.map((r) => last(r).ruinedWorlds)).toFixed(1)}`],
      ['полки: доля состава к концу', `${mean(runs.map((r) => last(r).regimentShare)).toFixed(2)}`],
      ['отрядов-соперников к концу', `${mean(runs.map((r) => last(r).rivals)).toFixed(1)}`],
      ['наступлений объявлено / достигло цели', `${mean(runs.map((r) => r.declared)).toFixed(1)} / ${mean(runs.map((r) => r.achieved)).toFixed(1)}`],
      ['наступлений идёт разом', `${mean(runs.flatMap((r) => r.samples.map((s) => s.plans))).toFixed(1)}`],
      ['ступеней построено / просело', `${mean(runs.map((r) => r.built)).toFixed(1)} / ${mean(runs.map((r) => r.decayed)).toFixed(1)}`],
      ['переделок фокуса начато / готово', `${mean(runs.map((r) => r.focusStarted)).toFixed(1)} / ${mean(runs.map((r) => r.focusDone)).toFixed(1)}`],
      ['театров на карте: начало → конец', `${mean(runs.map((r) => opening(r).theaterRows)).toFixed(0)} → ${mean(runs.map((r) => last(r).theaterRows)).toFixed(0)}`],
      ['заполненность театра (медиана): конец', `${mean(runs.map((r) => last(r).theaterFill)).toFixed(2)} (полоса приёмки 0.40–1.20)`],
      ['доля армии на направлениях: конец', `${mean(runs.map((r) => last(r).deployedShare)).toFixed(2)}`],
      ['среднее плечо направления, прыжков', `${mean(runs.map((r) => last(r).meanLeg)).toFixed(1)}`],
      ['подъёмная сила державы, машино-прыжков', `${mean(runs.map((r) => last(r).lift)).toFixed(0)}`],
      ['доля миров вне досягаемости', `${mean(runs.map((r) => last(r).unreachableShare)).toFixed(3)}`],
      ['мощность Сферы: начало → конец', `${mean(runs.map((r) => opening(r).capacity)).toFixed(0)} → ${mean(runs.map((r) => last(r).capacity)).toFixed(0)}`],
      ['армия к цели от мощности: конец', `${mean(runs.map((r) => last(r).armyFill)).toFixed(2)}`],
      ['разорилось / сформировалось', `${mean(runs.map((r) => r.state.rivals.bankrupt)).toFixed(1)} / ${mean(runs.map((r) => r.state.rivals.formed)).toFixed(1)}`],
      ['дельт в снимке к концу', `${mean(runs.map((r) => Object.keys(r.state.deltas).length)).toFixed(1)}`],
    ],
  };
}

/**
 * Расхождение приращения с полным пересчётом.
 *
 * Та же проверка, что в `frontstat`, и держится она здесь по той же причине:
 * экономика фракций правится приращением, а `makeWarState` считает её полным
 * проходом по каталогу. Разойдись они — и весь остальной отчёт будет про мир,
 * которого нет.
 */
function drift(runs: readonly Run[]): number {
  let total = 0;
  for (const r of runs) {
    const rebuilt = makeWarState(r.state.worldSeed, r.state.deltas);
    for (const f of FACTION_LIST) {
      const a = economyOf(r.state.war, f.id);
      const b = economyOf(rebuilt, f.id);
      total += Math.abs(a.income - b.income) + Math.abs(a.upkeep - b.upkeep) + Math.abs(a.worlds - b.worlds);
    }
  }
  return total;
}

function printVerdict(v: Verdict): void {
  for (const [label, value] of v.rows) console.log(`  ${label.padEnd(42)}${value}`);
}

function printCompare(a: Verdict, b: Verdict): void {
  console.log(`  ${'показатель'.padEnd(42)}${'без правок'.padEnd(30)}с правками`);
  for (let i = 0; i < a.rows.length; i++) {
    const left = a.rows[i] as readonly [string, string];
    const right = b.rows[i] as readonly [string, string];
    console.log(`  ${left[0].padEnd(42)}${left[1].padEnd(30)}${right[1]}`);
  }
}

// --- прогон --------------------------------------------------------------------

const args = parseArgs(process.argv.slice(2));

function measure(label: string): { runs: Run[]; ms: number } {
  const t0 = Date.now();
  const runs = args.seeds.map((s) => run(s, args.ticks));
  const ms = Date.now() - t0;
  console.log(`${label}: ${args.seeds.length} сидов × ${args.ticks} декад за ${(ms / 1000).toFixed(1)} с`);
  return { runs, ms };
}

console.log(
  `мир без игрока: сиды ${args.seeds[0]}..${args.seeds[args.seeds.length - 1]}, ` +
    `${args.ticks} декад (${(args.ticks / 36.5).toFixed(1)} года)\n`,
);

// Без `--compare` правка действует на единственный прогон и ставится ДО него: раньше она ставилась после
// замера, и прогон молча шёл по исходной таблице (нашлось 2026-10-04).
if (!args.compare && args.sets.length > 0) {
  applySets(args.sets);
  console.log(`правки: ${args.sets.map(([k, v]) => `${k}=${v}`).join(', ')}\n`);
}
const base = measure('прогон');
const battles = sum(base.runs.map((r) => r.battles));
console.log(`быстрых боёв мира: ${battles} (тактических — ни одного, потолок CLAUDE.md о них)\n`);

if (args.compare && args.sets.length > 0) {
  const restore = applySets(args.sets);
  const other = measure('прогон с правками');
  // СВЕРКА СЧИТАЕТСЯ ДО ОТКАТА ТАБЛИЦЫ. `drift` пересчитывает мир с нуля
  // (`makeWarState`), и после `restore()` он считал бы его по ДРУГИМ числам,
  // чем те, которыми жил прогон, — расхождение выходило бы из ниоткуда. Ловушку
  // нашёл шаг 27: правка `logistics.upkeepPerJump` дала 748 млн расхождения там,
  // где обязан быть ноль, и виноват был замер, а не приращение.
  const driftBase = drift(base.runs);
  const driftOther = drift(other.runs);
  restore();
  console.log(`\nправки: ${args.sets.map(([k, v]) => `${k}=${v}`).join(', ')}\n`);
  printCompare(verdict(base.runs, args.ticks), verdict(other.runs, args.ticks));
  console.log(`\n  расхождение приращения с пересчётом: ${driftBase} / ${driftOther} (обязано быть 0)`);
} else {
  printVerdict(verdict(base.runs, args.ticks));
  console.log(`\n  расхождение приращения с пересчётом: ${drift(base.runs)} (обязано быть 0)`);
}

// Кто вырос и кто просел — миры, а не проценты: «Курита взял четырнадцать миров»
// читается, «Курита вырос на 3.5 %» нет.
const first = base.runs[0] as Run;
const start = new CampaignState(first.seed).war;
console.log(`\nпо фракциям (сид ${first.seed}):`);
const rows = FACTION_LIST.map((f) => {
  const was = economyOf(start, f.id).worlds;
  const now = economyOf(first.state.war, f.id).worlds;
  const eco = economyOf(first.state.war, f.id);
  return {
    id: f.id,
    was,
    now,
    delta: now - was,
    // ВСЯ армия, а не резерв (шаг 27): резерв — это только то, что ещё не уехало.
    army: totalArmy(first.state.war, f.id),
    target: armyTarget(eco.capacity),
  };
})
  .filter((r) => r.delta !== 0)
  .sort((a, b) => b.delta - a.delta);
for (const r of rows) {
  console.log(
    `  ${r.id.padEnd(16)}${String(r.was).padStart(4)} → ${String(r.now).padStart(4)} ` +
      `(${r.delta > 0 ? '+' : ''}${r.delta})   армия ${String(r.army).padStart(5)} / ${String(r.target).padStart(5)}`,
  );
}

// ПОЛКИ — ПО ВСЕМ СИДАМ, а не по первому (2026-09-07, диагностика шага 36).
//
// Печать по одному сиду показывала картину, из которой нельзя сделать вывод:
// один полк вышел богатым, другой просевшим — и непонятно, свойство это
// механики или частный случай сида. А шаг 36 собирается ПРАВИТЬ содержание
// полков, и править его по одному наблюдению значило бы чинить то, что, может
// быть, работает.
//
// Поэтому здесь среднее по сидам и РАЗБРОС между ними: полк, у которого
// укомплектованность 1.00 на всех сидах, и полк, у которого она гуляет от 0.3
// до 1.0, — это две разные болезни, и лечатся они по-разному.
const regimentIds = first.state.rivals.regiments.map((r) => r.id);
console.log(`\nполки (среднее по ${base.runs.length} сидам, разброс в скобках):`);
console.log(`  ${'полк'.padEnd(28)}${'штат'.padStart(5)}${'укомплект.'.padStart(12)}${'касса, млн'.padStart(20)}${'подрядов'.padStart(10)}${'побед'.padStart(8)}`);
for (const id of regimentIds) {
  const rows = base.runs
    .map((run) => run.state.rivals.regiments.find((r) => r.id === id))
    .filter((r): r is NonNullable<typeof r> => r !== undefined);
  if (rows.length === 0) continue;
  const shares = rows.map((r) => r.mechs / r.fullMechs);
  const cash = rows.map((r) => r.cbills / 1e6);
  const contracts = rows.map((r) => r.contracts);
  const wins = rows.map((r) => (r.contracts === 0 ? 0 : r.wins / r.contracts));
  const row = rows[0] as NonNullable<(typeof rows)[0]>;
  console.log(
    `  ${row.name.padEnd(28)}${String(row.fullMechs).padStart(5)}` +
      `${mean(shares).toFixed(2).padStart(7)}${` (${Math.min(...shares).toFixed(2)}-${Math.max(...shares).toFixed(2)})`.padStart(14)}` +
      `${mean(cash).toFixed(1).padStart(8)}${` (${Math.min(...cash).toFixed(1)}-${Math.max(...cash).toFixed(1)})`.padStart(18)}` +
      `${mean(contracts).toFixed(1).padStart(10)}${(mean(wins) * 100).toFixed(0).padStart(7)}%`,
  );
}

if (args.years) {
  console.log(`\nпо годам (сид ${first.seed}):`);
  console.log(`  год    события  готовность  казна,тактов  фонд  напряж  разорено  полки  отряды  замыслы`);
  for (let y = 0; y * 36 < first.samples.length; y++) {
    const slice = first.samples.slice(y * 36, (y + 1) * 36);
    if (slice.length === 0) break;
    const tail = slice[slice.length - 1] as Sample;
    console.log(
      `  ${String(3053 + y).padEnd(7)}${sum(slice.map((s) => s.captures + s.raids)).toString().padStart(7)}` +
        `${mean(slice.map((s) => s.readiness)).toFixed(2).padStart(12)}` +
        `${mean(slice.map((s) => s.treasuryTicks)).toFixed(1).padStart(14)}` +
        `${mean(slice.map((s) => s.fundTicks)).toFixed(2).padStart(6)}` +
        `${mean(slice.map((s) => s.tension)).toFixed(3).padStart(8)}` +
        `${String(tail.ruinedWorlds).padStart(10)}` +
        `${tail.regimentShare.toFixed(2).padStart(7)}` +
        `${String(tail.rivals).padStart(8)}` +
        `${mean(slice.map((s) => s.plans)).toFixed(1).padStart(9)}`,
    );
  }
}

// ФРОНТ И ТЫЛ (шаг 37) — поделилась ли карта на самом деле.
//
// Меряется НЕ «сколько на карте пиратов», а то, ради чего шаг делался: зависит
// ли состав биржи от МЕСТА. Поэтому системы разложены по полосам фронтового
// индекса, и в каждой полосе показана доля пиратской работы. До шага 37 все
// строки этой таблицы были бы одинаковыми — в этом и была вся болезнь.
//
// Выборка, а не вся карта: биржа считается броском на систему, и две тысячи
// бирж стоили бы дороже самого прогона. Шаг выборки фиксирован, чтобы таблица
// была воспроизводима.
{
  const state = first.state;
  const bands: { name: string; from: number; to: number; systems: number; offers: number; pirate: number }[] = [
    // Полос три, а не четыре, и это свойство самой величины, а не выбора:
    // близость врага бывает 1.0 (за соседней звездой) и `proximityFalloff`
    // (в двух прыжках), дальше биржа не смотрит вовсе. Промежуточных значений
    // между тылом и приграничьем не существует — их не из чего сложить.
    { name: 'фронт (>0.7)', from: 0.7, to: 1.01, systems: 0, offers: 0, pirate: 0 },
    { name: 'приграничье', from: 0.01, to: 0.7, systems: 0, offers: 0, pirate: 0 },
    { name: 'тыл (0)', from: -0.01, to: 0.01, systems: 0, offers: 0, pirate: 0 },
  ];
  const STEP = 7;
  for (let i = 0; i < GALAXY.count; i += STEP) {
    const fi = frontierIndexAt(state.deltas, state.reputation, state.war, i);
    const band = bands.find((b) => fi >= b.from && fi < b.to);
    if (band === undefined) continue;
    band.systems += 1;
    const offers = contractBoard(state.worldSeed, state.deltas, GALAXY.id(i), state.day, state.reputation, state.war);
    band.offers += offers.length;
    for (const o of offers) if (o.target === PIRATE_FACTION) band.pirate += 1;
  }
  console.log(`\nфронт и тыл (сид ${first.seed}, каждая ${STEP}-я система):`);
  console.log(`  ${'полоса'.padEnd(18)}${'систем'.padStart(8)}${'предложений'.padStart(13)}${'из них пиратских'.padStart(18)}`);
  for (const b of bands) {
    const share = b.offers === 0 ? 0 : b.pirate / b.offers;
    console.log(
      `  ${b.name.padEnd(18)}${String(b.systems).padStart(8)}${(b.offers / Math.max(1, b.systems)).toFixed(2).padStart(13)}` +
        `${(share * 100).toFixed(1).padStart(17)}%`,
    );
  }
}

// Развитие миров (часть A) и замыслы государств (часть B) — два звена, которые
// шаг 23 и добавил в круг. Печатаются по фракциям: «Марик отстроил сорок миров»
// читается, «развитых миров 145» — нет.
console.log(`\nразвитие и замыслы (сид ${first.seed}):`);
let totalBuilt = 0;
let totalDecayed = 0;
for (const f of FACTION_LIST) {
  const share = developmentShareOf(first.state.deltas, f.id);
  totalBuilt += share.built;
  totalDecayed += share.decayed;
  if (share.built === 0 && share.decayed === 0) continue;
  console.log(
    `  ${f.id.padEnd(16)}отстроено ${String(share.built).padStart(4)}, просело ${String(share.decayed).padStart(3)} ` +
      `из ${String(economyOf(first.state.war, f.id).worlds).padStart(4)} миров`,
  );
}
console.log(`  ${'всего'.padEnd(16)}отстроено ${totalBuilt}, просело ${totalDecayed} из ${GALAXY.count} миров`);

const plans = planList(first.state.war);
if (plans.length > 0) {
  console.log(`\nнаступления, идущие на конец прогона (сид ${first.seed}):`);
  for (const p of plans) {
    const i = GALAXY.index(p.target);
    console.log(
      `  ${p.factionId.padEnd(16)}против ${p.against.padEnd(14)}` +
        `цель ${(i < 0 ? p.target : GALAXY.name(i)).padEnd(20)}взято ${p.taken}, до дня ${p.untilDay}`,
    );
  }
}

// События мира (шаг 84): какая веха сработала и в какой день, какая отменена по условию — по сидам.
console.log(`\nсобытия мира (по сидам):`);
for (const r of base.runs) {
  const cells = EVENTS.events.map((e) => {
    const fired = r.state.war.events[e.id];
    if (fired !== undefined) {
      const d = dateOf(fired.day);
      return `${e.id} ${String(d.day).padStart(2, '0')}.${String(d.month).padStart(2, '0')}.${d.year}`;
    }
    return `${e.id} ${r.state.day > eventWindow(e).until ? 'отменено' : '—'}`;
  });
  console.log(`  сид ${r.seed}: ${cells.join('; ')}`);
}

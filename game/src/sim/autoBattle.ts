import { enumerateLegalCommands, execute, type BattleEvent, type Command } from '../core/commands/index.js';
import { buildOutcome, type BattleOutcome } from '../core/campaign/bridge/fromBattle.js';
import { battleOver, judgeBattle } from '../core/rules/objective.js';
import { CombatLog, lineText, namesFrom } from '../core/log/index.js';
import { distance } from '../core/hex/index.js';
import { MoveMode } from '../core/map/index.js';
import {
  ContactLevel,
  hashBattleState,
  HitZone,
  isLeg,
  Phase,
  zoneState,
  type BattleState,
  type Side,
} from '../core/model/index.js';
import { Rng } from '../core/rng/index.js';
import { mpBudget } from '../core/rules/index.js';
import { chooseAction, chooseSideAction, type BotOptions } from './bot.js';
import { BattleTally } from './tally.js';
import { makeBattle, type ScenarioOptions, type UnitSpec } from './scenario.js';

/**
 * Автобой: то же ядро, прогнанное с ботом с обеих сторон и без отрисовки
 * (game_core.md §12, шаг 2).
 *
 * Это не отдельная подсистема, а проверка архитектуры: если автобой перестал
 * собираться, значит ядро где-то потянуло за собой слой показа.
 */

export interface BattleStats {
  shots: number;
  /** Выстрелов по конкретному оружию (шаг 9h) — какие стволы реально стреляли в замере. */
  weaponShots: Record<string, number>;
  hits: number;
  /** Попал на кубике, но сорвал исполнение. */
  botches: number;
  /** Собранность вытянула промах ровно на единицу. */
  poiseSaves: number;
  /**
   * Сумма целевых чисел по всем выстрелам, выстрелов с целью 11-12, выстрелов,
   * у которых сумма модификаторов упёрлась в потолок, и суммарный срезанный
   * перебор (шаг 29).
   *
   * Без этих четырёх чисел «попадания на выстрел» не отвечают на вопрос ПОЧЕМУ:
   * низкий винрейт одинаково выглядит и при честной сложной стрельбе, и при
   * стрельбе, где модификаторы сложились выше потолка и разница пропала молча.
   */
  toHitTargetSum: number;
  shotsHardTarget: number;
  /** Выстрелов, где обстановка упёрлась в свой потолок — нормальное правило. */
  shotsSituationalCapped: number;
  /** Выстрелов, вышедших за край шкалы 2d6, — вот это и есть патология. */
  shotsCapped: number;
  toHitOverflowSum: number;
  /** Бросков на равновесие и падений — прямая мерка спама проверок (шаг 30). */
  pilotingChecks: number;
  falls: number;
  /**
   * Броски на равновесие от урона за ход (`piloting.massiveDamage`) и падения
   * от них — по весовому классу, индекс `WeightClass`. Знаменатель — ходы
   * машины класса в строю: без него лёгкие выглядят устойчивыми просто потому,
   * что выбывают раньше. Мерка порогов `piloting.fallDamageByClass`
   * (2026-09-15, критерий — `wiki/overview/corridors.md`).
   */
  damageChecksByClass: ByClass;
  damageFallsByClass: ByClass;
  unitTurnsByClass: ByClass;
  damage: number;
  headHits: number;
  /**
   * Попаданий и разрушений по зоне, индекс — `HitZone` (шаг 9e: замер брони по
   * зонам, а не только агрегат «конечности»). Нужно свериться с замыслом
   * таблицы долей (`wiki/design/combat/rules.md` → «Как подбирается броня»):
   * запланированная доля попаданий против фактической доли разрушений зоны.
   */
  zoneHits: [number, number, number, number, number, number];
  zoneDestroyed: [number, number, number, number, number, number];
  injuries: number;
  pilotsOut: number;
  pilotsEjected: number;
  pilotsLost: number;
  unitsDestroyed: number;
  /** Криты, которые куда-то попали (шаг 4). */
  criticals: number;
  /** Из них те, что не ушли в пустую или уже разбитую ячейку. */
  criticalsEffective: number;
  ammoExplosions: number;
  /** Установки, потерянные и отрывом конечности, и критом. */
  weaponsLost: number;
  /** Разрушенные руки и ноги. */
  limbsLost: number;
  /** Из них ноги отдельно (шаг 6, часть F): руки — limbsLost - legsLost. */
  legsLost: number;
  shutdowns: number;
  standUps: number;
  /** Прыжки за бой (шаг 6, часть F) — проверка, что часть C случается вообще. */
  jumps: number;
  /** Пиковый нагрев, дошедший до конца хода, по всем машинам боя. */
  maxHeat: number;
  /** Сумма нагрева и число замеров: средний нагрев за ход на машину. */
  heatSum: number;
  heatSamples: number;
  /** Сумма MP ходьбы (`mpBudget`, с учётом повреждений) и число замеров. */
  walkMpSum: number;
  walkMpSamples: number;
  /**
   * Машины, выведенные из боя с целыми торсом и кокпитом: пилот ушёл, гироскоп
   * или реактор разбиты, но каркас цел. Для наёмника это не обломки, а трофей —
   * ровно та выгода, ради которой криты и заводились.
   */
  trophies: number;
  /**
   * Обездвиженные навсегда (оторвана нога или второй крит гироскопа, шаг 6,
   * части A/E) — узкое подмножество трофеев: реактор в maxHits тоже даёт
   * трофей, но это не обездвиженность.
   */
  immobilized: number;
  /** Пробитий кокпита (бросок 1d6 на остекление, шаг 6). */
  cockpitBreaches: number;
  /** Из них закончившихся потерей пилота — выстрел прошёл сквозь стекло. */
  cockpitBreachesLost: number;
  /**
   * Ход, на котором хоть одна сторона впервые получила контакт, и ход первого
   * выстрела (шаг 7). Если они совпадают — обнаружение не дало ни одного хода
   * на решение, и дальность сенсоров мала.
   */
  firstContactTurn: number;
  firstShotTurn: number;
  /**
   * Сколько раз за бой сторона смотрела на чужую машину и видела её на этом
   * уровне. Считается по концам ходов: доказательство, что засветка и силуэт
   * существуют не только в теории.
   */
  contactSamples: [number, number, number, number];
  /** Выстрелов по неопознанным целям: по засветке и по силуэту. */
  shotsAtBlip: number;
  shotsAtSilhouette: number;
  /**
   * Выстрелы и попадания импульсным оружием (шаг 8, A3) — `toHit.weapon` в
   * разборе целевого числа сейчас ставится только импульсникам, это
   * единственная прибавка к наводке в игре (attack.ts). Без этих чисел
   * нельзя сказать, стал ли `−1` выбором или импульсник остался дорогим
   * лазером с короткой рукой.
   */
  pulseShots: number;
  pulseHits: number;
  /**
   * Метрики личности (шаг 8, часть B): без них разница между `aggressive` и
   * `cautious` не подтверждена ни одним числом, только весами в таблице.
   */
  /** Сумма дистанций выстрелов и число замеров — средняя дистанция боя. */
  rangeSum: number;
  rangeSamples: number;
  /** Все команды движения и те из них, что бегом — доля ходов бегом. */
  moveActions: number;
  runMoves: number;
  /**
   * Возможностей стрелять всем, чем можно дотянуться (машина имела хотя бы
   * один законный выстрел в фазе), и сколько раз использованы ВСЕ такие
   * установки — доля «полного залпа».
   */
  volleyOpportunities: number;
  fullVolleys: number;
  /** Из добровольных катапультирований (`trigger: 'voluntary'`) успешных. */
  voluntaryEjections: number;
  /**
   * Сколько раз сторона объявляла отход и сколько машин ушло с поля целыми
   * (шаг 43). Без этих двух чисел нельзя сказать, случается ли мораль вообще:
   * порог, при котором никто не уходит, и выключенное правило выглядят
   * одинаково.
   */
  sidesWithdrawn: number;
  unitsWithdrawn: number;
  /**
   * Доля концов хода, когда живая машина стоит от ближайшего живого союзника
   * не дальше `FORMATION_TOGETHER_RANGE` — проверка строя (шаг 8, часть C).
   * Осторожность из плана: не давать этой доле уехать выше половины — иначе
   * звено сбивается в кучу, где один залп накрывает всех.
   */
  formationTogether: number;
  /** Замеров всего — машины без живых союзников (последняя в звене) не считаются. */
  formationSamples: number;
  /**
   * Сколько раз контакт стороны с чужой машиной поднялся с `None` до чего-то
   * (шаг 8, часть D) — случается ли разведка вообще, а не просто «не ноль».
   * Читается из `contactChanged`, который уже пишет ядро, а не считается заново.
   */
  newContactsOpened: number;
  /**
   * И обратное: сколько раз контакт падал обратно до `None`. Без этого числа
   * про память о последнем контакте нельзя сказать, была ли у неё вообще
   * причина сработать: она вступает в дело ровно тогда, когда сторона кого-то
   * видела и потеряла. Ноль здесь — не поломка памяти, а сценарий, в котором
   * терять контакт негде (шаг 8, часть D).
   */
  contactsLost: number;
  /**
   * Сколько раз контакт падал НИЖЕ силуэта, уже побывав силуэтом или опознанным
   * (решение пользователя 2026-09-19, `detection.contactFloorAtSilhouette`).
   * По задумке — ноль всегда: класс машины, раз разглядев, сторона не
   * забывает, контакт мигает только между силуэтом и опознанием. Число здесь —
   * не баланс, а проверка себя: если оно вдруг не ноль, пол сломан.
   */
  contactDroppedBelowSilhouette: number;
}

export interface BattleReport {
  readonly seed: number;
  readonly turns: number;
  readonly winner: Side | 'draw';
  readonly survivors: Readonly<Record<string, number>>;
  readonly stats: BattleStats;
  /** Хэш финального состояния — основа golden-replay. */
  readonly hash: string;
  /** Журнал команд: сид плюс он дают точное повторение боя. */
  readonly commands: readonly Command[];
  readonly log: readonly string[];
  /**
   * Итог боя данными — мост в кампанию (шаг 12). Не заменяет `stats`: на нём стоит весь
   * замер баланса Части 1, а `outcome` читает послебоевой разбор кампании.
   */
  readonly outcome: BattleOutcome;
}

export interface AutoBattleOptions {
  readonly seed: number;
  readonly units?: readonly UnitSpec[];
  readonly width?: number;
  readonly height?: number;
  /** Настройки генератора карты: биом и ручки плотности. */
  readonly map?: ScenarioOptions['map'];
  /** Обмен стартовыми зонами: инструмент замера честности карты. */
  readonly swapZones?: boolean;
  readonly maxTurns?: number;
  /** Личности ботов по стороне. */
  readonly personalities?: Readonly<Record<string, string>>;
  /** Копить текстовый журнал. В батч-прогоне выключается: он дороже самого боя. */
  readonly keepLog?: boolean;
}

/** Счётчик по весовому классу: ровно четыре ячейки, индекс — `WeightClass`. */
export type ByClass = [number, number, number, number];

function emptyStats(): BattleStats {
  return {
    shots: 0, weaponShots: {}, hits: 0, botches: 0, poiseSaves: 0, damage: 0,
    toHitTargetSum: 0, shotsHardTarget: 0, shotsSituationalCapped: 0, shotsCapped: 0, toHitOverflowSum: 0,
    pilotingChecks: 0, falls: 0,
    damageChecksByClass: [0, 0, 0, 0], damageFallsByClass: [0, 0, 0, 0], unitTurnsByClass: [0, 0, 0, 0],
    headHits: 0, zoneHits: [0, 0, 0, 0, 0, 0], zoneDestroyed: [0, 0, 0, 0, 0, 0],
    injuries: 0, pilotsOut: 0, pilotsEjected: 0, pilotsLost: 0, unitsDestroyed: 0,
    criticals: 0, criticalsEffective: 0, ammoExplosions: 0, weaponsLost: 0, limbsLost: 0, legsLost: 0,
    shutdowns: 0, standUps: 0, jumps: 0, trophies: 0, maxHeat: 0, heatSum: 0, heatSamples: 0,
    walkMpSum: 0, walkMpSamples: 0, immobilized: 0,
    cockpitBreaches: 0, cockpitBreachesLost: 0,
    firstContactTurn: 0, firstShotTurn: 0,
    contactSamples: [0, 0, 0, 0], shotsAtBlip: 0, shotsAtSilhouette: 0,
    pulseShots: 0, pulseHits: 0,
    rangeSum: 0, rangeSamples: 0, moveActions: 0, runMoves: 0,
    volleyOpportunities: 0, fullVolleys: 0, voluntaryEjections: 0,
    sidesWithdrawn: 0, unitsWithdrawn: 0,
    formationTogether: 0, formationSamples: 0, newContactsOpened: 0, contactsLost: 0,
    contactDroppedBelowSilhouette: 0,
  };
}

function collect(
  stats: BattleStats,
  events: readonly BattleEvent[],
  turn: number,
  state: BattleState,
): void {
  for (const e of events) {
    switch (e.kind) {
      case 'shot':
        stats.shots += 1;
        stats.weaponShots[e.weapon] = (stats.weaponShots[e.weapon] ?? 0) + 1;
        if (e.hit) stats.hits += 1;
        if (e.botched) stats.botches += 1;
        if (e.poiseSaved) stats.poiseSaves += 1;
        // Уровень контакта читается из разбора целевого числа, а не считается
        // заново: разбор — то же самое, что видел стрелок, когда решался.
        if (e.factors.some((f) => f.key === 'toHit.blip')) stats.shotsAtBlip += 1;
        if (e.factors.some((f) => f.key === 'toHit.silhouette')) stats.shotsAtSilhouette += 1;
        // `toHit.weapon` — единственный маркер импульсного оружия в разборе
        // (см. attack.ts): читать его отсюда, а не заново решать по id ствола.
        if (e.factors.some((f) => f.key === 'toHit.weapon')) {
          stats.pulseShots += 1;
          if (e.hit) stats.pulseHits += 1;
        }
        if (stats.firstShotTurn === 0) stats.firstShotTurn = turn;
        stats.toHitTargetSum += e.toHitTarget;
        if (e.toHitTarget >= 11) stats.shotsHardTarget += 1;
        if (e.toHitSituationalCut > 0) stats.shotsSituationalCapped += 1;
        if (e.toHitOverflow > 0) {
          stats.shotsCapped += 1;
          stats.toHitOverflowSum += e.toHitOverflow;
        }
        stats.rangeSum += e.range;
        stats.rangeSamples += 1;
        break;
      case 'pilotingCheck':
        stats.pilotingChecks += 1;
        if (!e.passed) stats.falls += 1;
        if (e.reason === 'piloting.massiveDamage') {
          const cls = state.getUnit(e.unitId)?.weightClass;
          if (cls !== undefined) {
            stats.damageChecksByClass[cls] += 1;
            if (!e.passed) stats.damageFallsByClass[cls] += 1;
          }
        }
        break;
      case 'moved':
        stats.moveActions += 1;
        if (e.mode === MoveMode.Run) stats.runMoves += 1;
        if (e.mode === MoveMode.Jump) stats.jumps += 1;
        break;
      case 'damaged':
        stats.damage += e.amount;
        if (e.zone === 0) stats.headHits += 1;
        stats.zoneHits[e.zone] += 1;
        if (e.zoneDestroyed) {
          stats.zoneDestroyed[e.zone] += 1;
          if (e.zone !== HitZone.Head && e.zone !== HitZone.Torso) {
            stats.limbsLost += 1;
            if (isLeg(e.zone)) stats.legsLost += 1;
          }
        }
        break;
      case 'pilotInjured':
        stats.injuries += 1;
        if (e.status === 'out') stats.pilotsOut += 1;
        break;
      case 'pilotEjected':
        if (e.success) {
          stats.pilotsEjected += 1;
          if (e.trigger === 'voluntary') stats.voluntaryEjections += 1;
        }
        break;
      case 'pilotLost':
        // Считаются все поводы: потеря пилота — событие кампании, а не боя.
        stats.pilotsLost += 1;
        break;
      case 'unitDestroyed':
        stats.unitsDestroyed += 1;
        // Обездвиженность (шаг 6, части A/E) — узкое подмножество трофеев:
        // отрыв ноги и второй крит гироскопа, не любая гибель с целым торсом.
        if (e.reason === 'leg' || e.reason === 'gyro') stats.immobilized += 1;
        break;
      case 'cockpitBreach':
        stats.cockpitBreaches += 1;
        if (e.pilotLost) stats.cockpitBreachesLost += 1;
        break;
      case 'critical':
        stats.criticals += 1;
        if (e.effect !== 'empty') stats.criticalsEffective += 1;
        if (e.effect === 'weaponDestroyed') stats.weaponsLost += 1;
        break;
      case 'ammoExplosion':
        stats.ammoExplosions += 1;
        break;
      case 'weaponLost':
        // Оторванная рука уносит установку так же безвозвратно, как и крит.
        stats.weaponsLost += 1;
        break;
      case 'shutdown':
        stats.shutdowns += 1;
        break;
      case 'stoodUp':
        stats.standUps += 1;
        break;
      case 'sideWithdrawing':
        stats.sidesWithdrawn += 1;
        break;
      case 'unitWithdrew':
        stats.unitsWithdrawn += 1;
        break;
      case 'contactChanged':
        if (e.from === ContactLevel.None && e.to > ContactLevel.None) {
          stats.newContactsOpened += 1;
        }
        if (e.from > ContactLevel.None && e.to === ContactLevel.None) {
          stats.contactsLost += 1;
        }
        if (e.from >= ContactLevel.Silhouette && e.to < ContactLevel.Silhouette) {
          stats.contactDroppedBelowSilhouette += 1;
        }
        break;
      default:
        break;
    }
  }
}

/** Порог «рядом» для замера строя — диагностическое число, не связано с поводком в оценке хода. */
const FORMATION_TOGETHER_RANGE = 3;

/**
 * То, что `runOn` требует сверх уже готового `BattleState` — подмножество `AutoBattleOptions`
 * без параметров сборки боя (`units`/`width`/`height`/`map`/`swapZones`), которые нужны только
 * `makeBattle`.
 */
export type RunOptions = Pick<AutoBattleOptions, 'seed' | 'maxTurns' | 'personalities' | 'keepLog'>;

/**
 * Один бой до конца — на уже готовом `BattleState`.
 *
 * Вынесено из `runBattle`, чтобы бот-driven цикл боя переиспользовался кампанией
 * (`sim/campaign/cli.ts`, замер шага 12): `makeBattleFromBrief` строит бой с накопленными
 * повреждениями отряда, `makeBattle` — с нуля по `UnitSpec`, а сам цикл ходов один и тот же.
 *
 * Ограничение по ходам обязательно: два осторожных бота на большой карте могут
 * кружить бесконечно, и без потолка батч-прогон просто зависнет.
 */
export function runOn(state: BattleState, opts: RunOptions): BattleReport {
  const maxTurns = opts.maxTurns ?? 40;
  // Отдельный ГПСЧ бота: он выводится из того же сида, поэтому автобой
  // воспроизводим, но в состояние боя не входит и реплею не мешает.
  const ai = new Rng((opts.seed ^ 0x5bf03635) >>> 0);
  const stats = emptyStats();
  const commands: Command[] = [];
  const log = opts.keepLog === true ? new CombatLog() : null;
  const names = namesFrom(state);
  const tally = new BattleTally();

  const run = (command: Command): void => {
    const result = execute(state, command);
    commands.push(command);
    if (!result.ok) return;
    collect(stats, result.events, state.turn, state);
    tally.collect(result.events, state);
    log?.push(result.events, names);
  };

  // Условие конца боя спрашивается у ПРАВИЛА ЗАДАЧИ (шаг 19b), а не считается
  // здесь: оборона кончается по сроку, рейд — по числу выбитых машин, и оба
  // ответа обязаны совпадать с теми, что даёт быстрый расчёт. Потолок ходов
  // остаётся сверх задачи: два осторожных бота на большой карте могут кружить
  // бесконечно, и без него батч-прогон просто зависнет.
  while (state.turn <= maxTurns && !battleOver(state)) {
    // Инициатива бросается ядром при завершении фазы: порядок хода — состояние,
    // а состояние меняется только командами.
    run({ kind: 'endPhase' });

    const turnPlayed = state.turn;

    // РЕШЕНИЕ СТОРОНЫ (шаг 43) — раз в ход, в начале фазы движения, до первого
    // хода машины. Мораль — свойство ситуации, а не отдельного выстрела:
    // спрашивать её после каждого попадания значило бы получать разное решение
    // внутри одного хода. Порядок сторон явный — детерминизм обхода.
    for (const side of ['opfor', 'player'] as const) {
      const decision = chooseSideAction(state, side);
      if (decision !== null) run(decision);
    }

    // Движение и стрельба идут одинаково: бот выбирает команду, ядро её исполняет.
    for (const phase of [Phase.Movement, Phase.Attack]) {
      if (state.phase !== phase) break;
      for (const unit of state.unitsInOrder()) {
        const live = state.getUnit(unit.id);
        if (live === undefined || live.destroyed || live.withdrawn) continue;
        if (live.pilot.status !== 'active') continue;

        const botOpts: BotOptions = {};
        const key = opts.personalities?.[live.side];
        const options = key !== undefined ? { personality: key } : botOpts;

        // В фазе стрельбы бот спрашивается столько раз, сколько у него стволов:
        // залп собирается повторными выстрелами, и решение «хватит» принимается
        // после каждого, уже с накопленным теплом. Потолок — число установок:
        // каждая стреляет не больше раза, но полагаться на это в цикле нельзя.
        const attempts = phase === Phase.Attack ? live.mounts.length : 1;

        // Доля «полного залпа» (шаг 8, часть B): установки, законные на НАЧАЛО
        // фазы, против того, сколько из них реально выстрелило. Считается по
        // мountIndex, а не по числу выстрелов — залп бьёт из каждой установки
        // не больше раза (game_core.md), но одну и ту же установку можно было
        // бы выбрать против разных целей, и это не должно задваивать счёт.
        let legalMounts: Set<number> | null = null;
        const firedMounts = new Set<number>();
        if (phase === Phase.Attack) {
          legalMounts = new Set(
            enumerateLegalCommands(state, live.id)
              .filter((c): c is Extract<Command, { kind: 'attack' }> => c.kind === 'attack')
              .map((c) => c.mountIndex),
          );
        }

        for (let i = 0; i < attempts; i++) {
          const now = state.getUnit(live.id);
          if (now === undefined || now.destroyed || now.withdrawn) break;
          if (now.pilot.status !== 'active') break;
          const action = chooseAction(state, live.id, ai, options);
          if (action.kind === 'endPhase') break;
          if (action.kind === 'attack') firedMounts.add(action.mountIndex);
          run(action);
        }

        if (legalMounts !== null && legalMounts.size > 0) {
          stats.volleyOpportunities += 1;
          if (firedMounts.size >= legalMounts.size) stats.fullVolleys += 1;
        }
      }
      run({ kind: 'endPhase' });
    }

    // Тепло
    run({ kind: 'endPhase' });

    // Проба нагрева по концу хода. Без неё нельзя сказать, стал ли залп
    // решением: если машины ходят холодными, значит бот не рискует, и чинить
    // надо оценку, а не пороги в данных.
    // Проба контактов: сколько раз сторона видела чужую машину на каждом
    // уровне. Столбец, который всегда ноль, — найденная ошибка, а не скучная
    // строка: так проверяется, что засветка и силуэт вообще случаются (шаг 7).
    for (const side of ['player', 'opfor'] as const) {
      for (const u of state.units) {
        if (u.side === side || u.destroyed || u.withdrawn) continue;
        const level = state.contact(side, u.id);
        stats.contactSamples[level] += 1;
        // Ход берётся тот, что только что отыгран: фаза тепла его уже
        // увеличила, и без поправки контакт «случался» на ход позже выстрела.
        if (level > 0 && stats.firstContactTurn === 0) stats.firstContactTurn = turnPlayed;
      }
    }

    // Перегрев считает копилка сводки: он не событие, а положение, в котором
    // машина простояла ход (`sim/tally.ts`).
    tally.sampleHeat(state);

    for (const u of state.active) {
      stats.heatSum += u.heat;
      stats.heatSamples += 1;
      if (u.heat > stats.maxHeat) stats.maxHeat = u.heat;

      // MP ходьбы — с учётом повреждений (шаг 6, часть F): подтверждает, что
      // часть B подключилась и что подбитые машины ходят медленнее целых.
      stats.walkMpSum += mpBudget(u, MoveMode.Walk);
      stats.walkMpSamples += 1;
      stats.unitTurnsByClass[u.weightClass] += 1;

      // Строй (шаг 8, часть C): ближайший живой союзник, а не центроид —
      // мерим то же самое интуитивное «стоят рядом», по которому судит
      // осторожность из плана, а не внутреннюю механику оценки хода.
      let nearestAlly = Infinity;
      for (const other of state.active) {
        if (other.id === u.id || other.side !== u.side) continue;
        const d = distance(u.hex, other.hex);
        if (d < nearestAlly) nearestAlly = d;
      }
      if (Number.isFinite(nearestAlly)) {
        stats.formationSamples += 1;
        if (nearestAlly <= FORMATION_TOGETHER_RANGE) stats.formationTogether += 1;
      }
    }
  }

  // Победитель — тот же вердикт правила задачи, что остановил цикл. Считать его
  // здесь заново по числу живых сторон значило бы завести второе правило
  // победы: оборона, отбитая по сроку, кончается с живыми машинами у обеих
  // сторон и по старому счёту читалась бы ничьёй.
  const winner: Side | 'draw' = judgeBattle(state) ?? 'draw';

  const survivors: Record<string, number> = {};
  for (const u of state.active) survivors[u.side] = (survivors[u.side] ?? 0) + 1;

  // Трофеи считаются по финальному состоянию, а не по событиям: важно не то,
  // как машина выбыла, а что от неё осталось, когда бой кончился.
  for (const u of state.units) {
    if (!u.destroyed) continue;
    if (zoneState(u, HitZone.Torso).destroyed || zoneState(u, HitZone.Head).destroyed) continue;
    stats.trophies += 1;
  }

  return {
    seed: opts.seed,
    turns: state.turn - 1,
    winner,
    survivors,
    stats,
    hash: hashBattleState(state),
    commands,
    log: log?.all.map(lineText) ?? [],
    outcome: buildOutcome(state, tally.map),
  };
}

/** Бой из сценария `UnitSpec[]` — `runOn` поверх `makeBattle`, как раньше. */
export function runBattle(opts: AutoBattleOptions): BattleReport {
  const state: BattleState = makeBattle({
    seed: opts.seed,
    ...(opts.width !== undefined ? { width: opts.width } : {}),
    ...(opts.height !== undefined ? { height: opts.height } : {}),
    ...(opts.units !== undefined ? { units: opts.units } : {}),
    ...(opts.map !== undefined ? { map: opts.map } : {}),
    ...(opts.swapZones !== undefined ? { swapZones: opts.swapZones } : {}),
  });
  return runOn(state, opts);
}

/**
 * Повтор боя по журналу команд. Основа golden-replay: тот же сид и тот же журнал
 * обязаны дать тот же хэш финального состояния.
 */
export function replayBattle(opts: AutoBattleOptions, commands: readonly Command[]): string {
  const state = makeBattle({
    seed: opts.seed,
    ...(opts.width !== undefined ? { width: opts.width } : {}),
    ...(opts.height !== undefined ? { height: opts.height } : {}),
    ...(opts.units !== undefined ? { units: opts.units } : {}),
  });
  for (const command of commands) execute(state, command);
  return hashBattleState(state);
}

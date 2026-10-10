import { Direction, hexToOffset, offsetToHex, key as hexKey } from '../../core/hex/index.js';
import {
  execute,
  refreshContacts,
  type BattleEvent,
  type Command,
} from '../../core/commands/index.js';
import {
  CombatLog,
  buildReport,
  namesFrom,
  reportToJson,
  reportToText,
  tr,
  shotStats,
  type BattleMeta,
  type LogPart,
  type ShotStats,
} from '../../core/log/index.js';
import {
  MoveMode,
  pathTo,
  reachable,
  terrainInfo,
  TERRAIN_IDS,
  type MapDescriptor,
  type TerrainId,
  type MapMetrics,
  type ReachResult,
} from '../../core/map/index.js';
import {
  availableMounts,
  cleanChassisCode,
  ContactLevel,
  Phase,
  WEIGHT_CLASS_KEYS,
  ZONE_IDS,
  ZONE_KEYS,
  type BattleState,
  type MechUnit,
  type Side,
} from '../../core/model/index.js';
import {
  battleOver,
  crippleNeed,
  exitReading,
  heatLimits,
  hitProbability,
  judgeBattle,
  mpBudget,
  progressOf,
  toHitBreakdown,
  wouldShutDown,
  arcingWeapon,
  zoneTableName,
  type HeatLimits,
  type ToHitBreakdown,
} from '../../core/rules/index.js';
import { weapon, CHASSIS_CATALOG, DEFAULT_PAINT } from '../../core/data/index.js';
import { Rng } from '../../core/rng/index.js';
import { battleLogName } from '../../platform/download.js';
import { hasKey, t, tn } from '../i18n/index.js';
import { chooseAction, chooseSideAction } from '../../sim/bot.js';
import { makeBattle, makeMap, scenarioByName, type ScenarioOptions } from '../../sim/scenario.js';
import { BattleTally } from '../../sim/tally.js';
import { battleUnitId, makeBattleFromBrief, type BattleBrief } from '../../core/campaign/bridge/toBattle.js';
import { paintOfFaction, paintOfRecord } from '../components/mechArt.js';
import { buildOutcome, type BattleOutcome } from '../../core/campaign/bridge/fromBattle.js';
import { generateMap } from '../../core/map/index.js';
import { buildMapView, key as viewKey, type HexView, type MapView } from '../../render/mapView.js';
import { angleToFacing, buildScene, facingAngle } from '../../render/scene.js';
import type { RenderScene, RenderWeapon } from '../../render/tacticalRenderer.js';
import { biome } from '../../core/data/tables.js';

/**
 * Состояние интерфейса боя.
 *
 * Держит НАСТОЯЩИЙ `BattleState` и меняет его ТОЛЬКО командами через
 * `execute`. Своей копии брони, тепла или позиции здесь нет и не будет: любое
 * поле, продублированное сюда, разойдётся с ядром на первом же исключении.
 *
 * Всё, что здесь есть своего, — это выбор игрока (кого выбрал, чем целится,
 * каким режимом идёт) и то, что относится к показу (какие слои включены, где
 * курсор). Ровно то, чего в правилах нет.
 */

/**
 * Строка журнала на экране. Строки боя приходят из ядра готовыми данными
 * (`core/log/combatLog.ts::LogLine`): вид и куски фразы с тоном подсветки.
 * `sys` — свои строки экрана (генерация карты, отказ команды).
 */
export interface LogLine {
  readonly parts: readonly LogPart[];
  readonly kind: 'sys' | 'info' | 'turn' | 'sub' | 'out';
}

export interface ZoneLine {
  readonly id: string;
  readonly label: string;
  readonly armor: number;
  /** Паспорт машины: до этого доводит ремонт. У недоукомплектованной он НИЖЕ потолка корпуса. */
  readonly maxArmor: number;
  readonly structure: number;
  readonly maxStructure: number;
  readonly destroyed: boolean;
  /**
   * Сколько брони эта зона держит по КОРПУСУ (шаг 17).
   *
   * Разница с `maxArmor` — это и есть недокомплект: броню на машину навесили не
   * всю, и ремонт её не добавит, потому что ремонт доводит до паспорта, а
   * паспорт у такой машины неполный (`mech/outfit.ts`). Заполняется только в
   * ангаре: в бою потолок корпуса не значит ничего — там воюют тем, что есть.
   */
  readonly hullArmor?: number;
  /** Установлено ли в этой зоне оборудование или оружие. */
  readonly hasItems?: boolean;
}

export interface WeaponLine {
  readonly index: number;
  readonly name: string;
  readonly ready: boolean;
  readonly ammo: number | null;
  readonly heat: number;
  readonly damage: number;
  readonly range: RenderWeapon;
}

/** Разбор целевого числа: то же, что ядро кладёт в событие выстрела. */
export interface AimView {
  readonly targetId: string;
  readonly targetName: string;
  readonly possible: boolean;
  readonly reason: string;
  readonly target: number;
  readonly chance: number;
  readonly base: number;
  readonly factors: readonly { label: string; amount: number }[];
  readonly distance: number;
  readonly band: string;
  readonly zoneTable: 'Above' | 'Below' | 'Main';
}

export interface GeneratorOptions {
  size: number;
  biome: string;
  forestDensity: number;
  roughness: number;
  rivers: boolean;
  lakes: boolean;
  roads: boolean;
  ruins: boolean;
  /** Сид карты: рельеф, старты. */
  seed: number;
  /**
   * Сид боя: инициатива, попадания, зоны, криты, пилотирование, броски бота —
   * отдельно от карты (`sim/scenario.ts`), чтобы «начать бой заново» на той же
   * карте давало другую партию, а не побитово тот же бой.
   */
  battleSeed: number;
}

/** Ключи словаря по значению `Phase` (порядок enum). */
const PHASE_KEYS = ['initiative', 'movement', 'attack', 'heat'] as const;

const MODE_KEYS: Readonly<Record<MoveMode, string>> = {
  [MoveMode.Walk]: 'walk',
  [MoveMode.Run]: 'run',
  [MoveMode.Jump]: 'jump',
};

/** Название рельефа; вид без перевода показывается своим id — видно, что ключа нет. */
function terrainName(id: string): string {
  const key = `battle.terrain.${id}`;
  return hasKey(key) ? t(key) : id.toUpperCase();
}

/** Всплывающая надпись над гексом: урон, крит, обесточен, падение, промах. */
export interface TextFxEvent {
  readonly type: 'text';
  readonly col: number;
  readonly row: number;
  readonly text: string;
  readonly color: string;
}

/**
 * Выстрел. Надписи, которые породил сам этот выстрел (урон, крит, падение
 * цели), едут вместе с ним в `followups` и показываются в момент попадания —
 * иначе при очереди показа цифры урона обгоняют луч или летящую ракету.
 */
export interface BeamFxEvent {
  readonly type: 'beam';
  /** Цель: пока выстрел не долетел, показ держит её целой. */
  readonly targetId: string;
  readonly fromCol: number;
  readonly fromRow: number;
  readonly toCol: number;
  readonly toRow: number;
  readonly weapon?: string;
  readonly miss: boolean;
  /** Косвенный огонь ракетами по наводке союзника: рисуется навесом. */
  readonly indirect: boolean;
  readonly followups: TextFxEvent[];
}

export interface CombatTickerItem {
  readonly id: string;
  readonly kind: 'hit' | 'miss' | 'shutdown' | 'fell' | 'crit' | 'destroyed' | 'restart' | 'info';
  readonly badge: string;
  readonly badgeClass: 'hit' | 'miss' | 'danger' | 'warning' | 'info' | 'purple';
  readonly shooter?: string | undefined;
  readonly target?: string | undefined;
  readonly weaponName?: string | undefined;
  readonly summary: string;
  readonly damageSummary?: string | undefined;
  readonly details: readonly string[];
  readonly timestamp: number;
}

class BattleUi {
  // --- то, что принадлежит показу ------------------------------------------
  selectedId = $state<string | null>(null);
  hover = $state<{ col: number; row: number } | null>(null);
  hoveredWeapon = $state<RenderWeapon | null>(null);
  mode = $state<'move' | 'los'>('move');
  moveMode = $state<MoveMode>(MoveMode.Walk);
  mountIndex = $state(0);
  logs = $state<LogLine[]>([]);
  tickerItems = $state<CombatTickerItem[]>([]);
  tickerCollapsed = $state(true);
  fps = $state(60);
  minimapCollapsed = $state(true);
  mapTheme = $state('classic');
  /** Ход противника проигрывается по шагам; здесь — идёт ли он сейчас. */
  botThinking = $state(false);
  botSpeed = $state(1);
  /** Автоход для машин игрока (ход + стрельба под управлением ИИ). */
  autoPlaying = $state(false);

  /**
   * Бой по контракту, а не песочница (шаг 17).
   *
   * Различие не косметическое: в бою по контракту карта задана контрактом
   * (биом планеты, сид вылета из состояния кампании), и перегенерировать её
   * значило бы переиграть контракт. Поэтому генератор в этом режиме не
   * рисуется вовсе, а не выключается кнопкой — выключенная кнопка обещает, что
   * когда-нибудь заработает.
   */
  contractMode = $state(false);
  /**
   * Подсвечивать ли зону выхода (шаг 65): включается, только когда раскрыт блок
   * «Исход боя» в контракте и видна кнопка отвода звена.
   */
  showExitZone = $state(false);
  /** Раскраска юнита по id боя — заполняется `startFromBrief` (шаг 50). */

  private paints: ReadonlyMap<string, string> = new Map();

  layers = $state({
    grid: true,
    numbers: true,
    elevations: true,
    organicForest: true,
    treesDetail: true,
    waterAnim: true,
    fogAnim: true,
    weaponRanges: true,
    movementTrails: true,
  });

  options = $state<GeneratorOptions>({
    size: 24,
    biome: 'temperate',
    forestDensity: 0.5,
    roughness: 0.5,
    rivers: true,
    lakes: true,
    roads: true,
    ruins: true,
    // Карта — фиксированный узнаваемый номер: игрок должен уметь вернуться на
    // ту же карту после перезагрузки страницы, ничего для этого не нажимая.
    seed: 38491,
    // Бой — наоборот, свежий при каждой загрузке (`Date.now()`, не `Math.random`:
    // тот запрещён линтером во всём `src/*.ts`, кроме `.svelte`), иначе
    // «Автоход» с первого кадра играет одну и ту же вчерашнюю партию.
    battleSeed: Math.floor(Date.now() % 900_000) + 100_000,
  });

  scenario = $state('lance');
  /** Сторона игрока. Вторую ведёт бот. */
  readonly viewer: Side = 'player';

  // --- то, что принадлежит бою ----------------------------------------------
  // Версия бумкается после каждой команды: `BattleState` не реактивен, и это
  // ЕДИНСТВЕННЫЙ честный способ сказать интерфейсу «перечитай». Копировать
  // поля боя в руны нельзя — появится вторая правда.
  private version = $state(0);
  private battle!: BattleState;
  private view!: MapView;
  private metricsValue!: MapMetrics;
  private descriptorValue!: MapDescriptor;
  private log = new CombatLog();
  /**
   * Сырые события боя целиком — для выгрузки отчёта (шаг 29).
   *
   * `CombatLog` держит уже отформатированные строки и режет их по пределу в
   * две тысячи: для чтения на экране этого хватает, для разбора «почему двадцать
   * промахов подряд» — нет. Здесь лежит то, из чего строки собраны.
   */
  private allEvents: BattleEvent[] = [];
  /**
   * Состав сторон НА НАЧАЛО боя — для отладочной выгрузки (шаг 29).
   *
   * Снимается один раз при высадке и больше не трогается: к концу боя `battle
   * .units` рассказывает, чем машина ОСТАЛАСЬ, а вопрос обычно в том, с чем она
   * ВЫШЛА — какое оружие в какой зоне, какой пилот, сколько брони.
   */
  private roster: readonly MechUnit[] = [];
  private botRng = new Rng(1);
  /** Сводка боя по юниту: без неё послебоевой разбор кампании не начислит опыт. */
  private tally = new BattleTally();
  private reach: ReachResult | null = null;
  private unitFacingAngles = $state(new Map<string, number>());
  private moveTrails = $state(
    new Map<
      string,
      {
        readonly path: readonly { readonly col: number; readonly row: number }[];
        readonly mode: MoveMode;
        readonly turn: number;
      }
    >(),
  );
  /**
   * За какую фазу бот уже отходил: «ход:фаза». Без этой отметки бот ходил бы
   * дважды за фазу — один раз по инициативе, второй при её закрытии.
   */
  private botPlayedFor: string | null = null;

  constructor() {
    this.newBattle();
  }

  // --- Сборка боя -----------------------------------------------------------

  private scenarioOptions(): ScenarioOptions {
    const o = this.options;
    return {
      seed: o.seed,
      battleSeed: o.battleSeed,
      width: o.size,
      height: o.size,
      units: scenarioByName(this.scenario),
      map: {
        biome: o.biome,
        forestDensity: o.forestDensity,
        roughness: o.roughness,
        rivers: o.rivers,
        lakes: o.lakes,
        roads: o.roads,
        ruins: o.ruins,
      },
    };
  }

  newBattle(): void {
    const opts = this.scenarioOptions();
    const generated = makeMap(opts);
    this.battle = makeBattle(opts);
    this.descriptorValue = generated.descriptor;
    this.metricsValue = generated.metrics;
    this.view = buildMapView(
      this.battle.map,
      generated.descriptor,
      biome(generated.descriptor.biome).hydrology.frozen,
    );
    this.botRng = new Rng((this.options.battleSeed ^ 0x5bf03635) >>> 0);
    this.tally = new BattleTally();
    this.log = new CombatLog();
    this.allEvents = [];
    this.roster = this.battle.units.map((u) => u);
    this.logs = [];
    this.tickerItems = [];
    this.unitFacingAngles.clear();
    this.moveTrails.clear();
    this.selectedId = this.battle.units.find((u) => this.commands(u))?.id ?? null;
    this.mountIndex = 0;
    this.mode = 'move';
    this.moveMode = MoveMode.Walk;
    this.botPlayedFor = null;
    this.showExitZone = false;
    this.recomputeReach();
    this.version++;

    const d = generated.descriptor;
    this.addLog(
      t('battle.sysLog.generated', { w: d.width, h: d.height, biome: d.biome.toUpperCase(), seed: d.seed }),
      'sys',
    );
    this.addLog(
      t('battle.sysLog.mapMetrics', {
        cover: (this.metricsValue.coverShare * 100).toFixed(0),
        patch: this.metricsValue.avgPatchSize.toFixed(1),
        unreachable: this.metricsValue.unreachable,
      }),
      'info',
    );

    // Бой начинается в фазе инициативы, где игроку делать нечего: все кнопки
    // хода в ней выключены, и первое, что он видит, — экран, на котором ничего
    // нельзя. Бросаем инициативу сразу и входим в движение той же командой,
    // которой это делает автобой, а не выставлением фазы руками.
    void this.openingPhase();
  }

  private async openingPhase(): Promise<void> {
    this.run({ kind: 'endPhase' });
    await this.botIfFirst();
  }

  /**
   * `seed` — новая карта (рельеф, старты); `battleSeed` — новая партия на той
   * же карте (инициатива, попадания, зоны, броски бота). Раздельные аргументы,
   * потому что «перезапустить бой» и «перегенерировать карту» — разные кнопки
   * с разным ожиданием игрока.
   */
  regenerate(seed?: number, battleSeed?: number): void {
    if (seed !== undefined) this.options.seed = seed;
    if (battleSeed !== undefined) this.options.battleSeed = battleSeed;
    this.newBattle();
  }

  /**
   * Бой по брифингу кампании (шаг 17, п. 4).
   *
   * Экран боя получает `BattleBrief`, а не сценарий из адресной строки: состав
   * звена, противник, биом и оба сида приходят из состояния кампании
   * (`contracts/active.ts::contractBrief`). Ничего боевого этот путь не меняет
   * — бой собирает то же самое ядро (`makeBattleFromBrief`), что и headless-прогон.
   *
   * Карта генерируется ВТОРОЙ раз намеренно: `makeBattleFromBrief` строит её у
   * себя внутри, а слою показа нужны ещё описание и метрики. Генерация чистая
   * и детерминированная — по тому же описанию выходит та же карта, — а
   * повторить здесь её параметры значило бы завести вторую копию умолчаний,
   * которая однажды разойдётся с первой.
   */
  startFromBrief(brief: BattleBrief): void {
    this.battle = makeBattleFromBrief(brief);
    // Раскраски юнитов запоминаются здесь, пока записи под рукой: боевой юнит
    // происхождения не несёт, а ядру боя оно и не нужно (шаг 50).
    this.paints = new Map([
      ...brief.company.map((p) => [battleUnitId('player', p.record.id), paintOfRecord(p.record)] as const),
      ...brief.enemy.map((p) => [battleUnitId('opfor', p.record.id), paintOfRecord(p.record)] as const),
    ]);
    const descriptor = this.battle.mapDescriptor;
    if (descriptor === null) throw new Error('Бой из брифинга собран без описания карты');
    const generated = generateMap(descriptor);
    this.descriptorValue = generated.descriptor;
    this.metricsValue = generated.metrics;
    this.view = buildMapView(
      this.battle.map,
      generated.descriptor,
      biome(generated.descriptor.biome).hydrology.frozen,
    );

    this.contractMode = true;
    this.options.seed = brief.mapSeed;
    this.options.battleSeed = brief.battleSeed;
    this.botRng = new Rng((brief.battleSeed ^ 0x5bf03635) >>> 0);
    this.tally = new BattleTally();
    this.log = new CombatLog();
    this.allEvents = [];
    this.roster = this.battle.units.map((u) => u);
    this.logs = [];
    this.tickerItems = [];
    this.unitFacingAngles.clear();
    this.moveTrails.clear();
    this.selectedId = this.battle.units.find((u) => this.commands(u))?.id ?? null;
    this.mountIndex = 0;
    this.mode = 'move';
    this.moveMode = MoveMode.Walk;
    this.botPlayedFor = null;
    this.autoPlaying = false;
    this.recomputeReach();
    this.version++;

    const d = generated.descriptor;
    this.addLog(
      t('battle.sysLog.deployed', {
        w: d.width,
        h: d.height,
        biome: d.biome.toUpperCase(),
        ours: brief.company.length,
        theirs: brief.enemy.length,
      }),
      'sys',
    );
    void this.openingPhase();
  }

  /**
   * Итог боя для кампании.
   *
   * Собирается ядром моста (`buildOutcome`) из финального состояния и сводки —
   * ровно так же, как в автобое. Экран не решает, кто победил: он спрашивает.
   */
  outcome(): BattleOutcome {
    void this.version;
    return buildOutcome(this.battle, this.tally.map);
  }

  /**
   * Отчёт о бое двумя видами (шаг 29): текст для чтения и JSON для `tools/`.
   *
   * Ядро собирает оба (`core/log/battleReport.ts`), экран только сохраняет
   * файл. Правило «ядро не знает о показе» этим не нарушено: сохранение делает
   * слой показа, а содержимое считает ядро.
   */
  private reportMeta(): BattleMeta {
    return {
      mapSeed: this.options.seed,
      battleSeed: this.options.battleSeed,
      biome: this.options.biome,
      mapSize: `${this.battle.map.w}×${this.battle.map.h}`,
      roster: this.roster,
    };
  }

  reportText(): string {
    void this.version;
    return reportToText(buildReport(this.allEvents, namesFrom(this.battle)), this.reportMeta());
  }

  reportJson(): string {
    void this.version;
    return JSON.stringify(
      reportToJson(this.allEvents, namesFrom(this.battle), this.reportMeta()),
      null,
      2,
    );
  }

  /** Имя файла отладочной выгрузки: несёт оба сида (см. `platform/download.ts`). */
  reportFileName(ext: string): string {
    return battleLogName(t('battle.log.filePrefix'), this.options.seed, this.options.battleSeed, ext);
  }

  /** Четыре числа сводки — их же показывает панель журнала. */
  get shots(): ShotStats {
    void this.version;
    return shotStats(this.allEvents);
  }

  /**
   * Держит ли экран боя ИМЕННО этот бой контракта.
   *
   * Сравниваются оба сида вылета: карта и партия. Перегенерировать их в режиме
   * контракта нельзя (`contractMode` прячет генератор целиком), поэтому равенство
   * сидов и означает «это тот самый бой». После перезагрузки страницы стор боя
   * поднимается с песочницей из конструктора — тогда здесь `false`, и экран
   * обязан пересобрать бой по брифингу, а не показать учебную стычку.
   */
  matchesContract(brief: BattleBrief): boolean {
    void this.version;
    return (
      this.contractMode &&
      this.options.seed === brief.mapSeed &&
      this.options.battleSeed === brief.battleSeed
    );
  }

  /** Вернуть песочницу: свободный бой снова генерирует карту сам. */
  leaveContract(): void {
    this.contractMode = false;
    this.showExitZone = false;
  }

  // --- Чтение боя -----------------------------------------------------------

  get mapView(): MapView {
    void this.version;
    return this.view;
  }

  /**
   * Карта ядра. Нужна ровно там, где показ обязан СПРОСИТЬ правило, а не
   * посчитать самому: боковой профиль линии огня зовёт `los()` на ней.
   */
  get rawMap() {
    void this.version;
    return this.battle.map;
  }

  get metrics(): MapMetrics {
    void this.version;
    return this.metricsValue;
  }

  get descriptor(): MapDescriptor {
    void this.version;
    return this.descriptorValue;
  }

  get turn(): number {
    void this.version;
    return this.battle.turn;
  }

  get phase(): Phase {
    void this.version;
    return this.battle.phase;
  }

  get phaseName(): string {
    void this.version;
    const key = PHASE_KEYS[this.battle.phase];
    return key === undefined ? '?' : t(`battle.phase.${key}`);
  }

  get modeLabel(): string {
    return t(`battle.mode.${MODE_KEYS[this.moveMode]}`);
  }

  /**
   * Кончен ли бой.
   *
   * **В бою по контракту экран кончает бой ПОЗЖЕ, чем автобой, и это решение
   * пользователя (2026-09-08), а не рассогласование.** Выполненная задача
   * (`hold` по сроку, `cripple` по числу подбитых) больше не выдёргивает игрока
   * с поля: он вправе доигрывать ради трофеев и второго гонорара за разгром
   * (`contracts.json` -> `beyond`) и уйти победителем в любой момент кнопкой в
   * боковой панели. Автоматически бой кончается только выбиванием одной из
   * сторон.
   *
   * Автобой (`sim/autoBattle.ts`) и быстрый расчёт при этом остаются на
   * `battleOver`: замер обязан мерить ЗАДАЧУ контракта, а не то, сколько игрок
   * решил добивать сверх неё. Расхождение записано в `wiki/overview/notes.md`
   * — «сводить к одному правилу» его не надо.
   *
   * Само определение «машина в строю» при этом ОДНО на игру: считает его
   * `progressOf` из ядра, а не переписанная здесь копия, — разойдись они, экран
   * и разбор считали бы конец боя по разным правилам.
   */
  get finished(): boolean {
    void this.version;
    if (this.contractMode) {
      // Ходы здесь не нужны: спрашивается только, осталась ли у сторон машина
      // в строю, а срок задачи разбирает `objectiveMet`.
      const p = progressOf(this.battle.units, 0);
      return p.playerActive === 0 || p.opforActive === 0;
    }
    return battleOver(this.battle);
  }

  /**
   * Что будет, если отвести звено сейчас: сколько машин в зоне выхода, сколько останется
   * и будет потеряно. Считает ядро (`exitReading`), экран только показывает.
   */
  get exitReading(): { readonly inZone: number; readonly stranded: number } {
    void this.version;
    const r = exitReading(this.battle, this.viewer);
    return { inZone: r.inZone.length, stranded: r.stranded.length };
  }

  /** Звено выходит из боя сейчас: стоящие в зоне уходят, остальные теряются (шаг 65). */
  evacuate(): boolean {
    return this.run({ kind: 'evacuate', side: this.viewer });
  }

  /** Выполнена ли задача контракта (победа уже обеспечена по условиям нанимателя). */
  get objectiveMet(): boolean {
    void this.version;
    if (!this.contractMode) return false;
    const winner = judgeBattle(this.battle);
    return winner === 'player';
  }

  /**
   * Очерёдность сторон в текущей фазе — для плашки на карте (решение
   * пользователя 2026-09-15).
   *
   * Порядок бросается перед каждой из двух фаз — движением и стрельбой. Первым
   * действует проигравший бросок, и если это противник, бот отыгрывает фазу
   * сразу при входе в неё (`botIfFirst`). Игроку поэтому важен один ответ:
   * противник уже действовал или ещё будет, — его и даёт `text`.
   */
  get initiative(): { readonly weFirst: boolean; readonly text: string } | null {
    void this.version;
    const phase = this.battle.phase;
    if (phase !== Phase.Movement && phase !== Phase.Attack) return null;
    const moving = phase === Phase.Movement;
    const weFirst = this.battle.order[0] === this.viewer;
    if (weFirst) {
      const next = t(moving ? 'battle.initiative.toFire' : 'battle.initiative.nextTurn');
      return {
        weFirst,
        text: t(moving ? 'battle.initiative.weMoveFirst' : 'battle.initiative.weFireFirst', { next }),
      };
    }
    if (this.botThinking) {
      return { weFirst, text: t(moving ? 'battle.initiative.enemyMovesFirst' : 'battle.initiative.enemyFiresFirst') };
    }
    return {
      weFirst,
      text: t(moving ? 'battle.initiative.enemyMoved' : 'battle.initiative.enemyFired'),
    };
  }

  /** Задача этого боя и то, как она выполняется. `null` — обычный бой на выбывание. */
  get objective(): { readonly text: string; readonly done: boolean } | null {
    void this.version;
    const task = this.battle.objective;
    if (task.kind === 'destroy') return null;
    const p = progressOf(this.battle.units, Math.max(0, this.battle.turn - 1));
    if (task.kind === 'hold') {
      return {
        text: t('battle.objectiveHold', {
          done: Math.min(p.roundsCompleted, task.rounds),
          total: task.rounds,
        }),
        done: p.roundsCompleted >= task.rounds,
      };
    }
    // Объекты задачи (шаг 73d): сколько разрушено у противника, сколько цело у роты.
    if (task.kind === 'destroyTargets') {
      const done = p.opforTargetsTotal - p.opforTargets;
      return {
        text: t('battle.objectiveDestroyTargets', { done, total: p.opforTargetsTotal }),
        done: p.opforTargetsTotal > 0 && p.opforTargets === 0,
      };
    }
    if (task.kind === 'protectTargets') {
      return {
        text: t('battle.objectiveProtectTargets', {
          done: Math.min(p.roundsCompleted, task.rounds),
          total: task.rounds,
          alive: p.playerTargets,
          targets: p.playerTargetsTotal,
        }),
        done: p.roundsCompleted >= task.rounds && p.playerTargets > 0,
      };
    }
    // Число задаёт контракт (`quota`) и не растёт вместе с составом на поле; в бою без контракта
    // считается от состава.
    const need = crippleNeed(task, p.opforTotal);
    const out = p.opforTotal - p.opforActive;
    return {
      text: t('battle.objectiveCripple', {
        target: tn('count.mechsAcc', need),
        done: Math.min(out, need),
      }),
      done: out >= need,
    };
  }

  get selected(): MechUnit | undefined {
    void this.version;
    return this.selectedId === null ? undefined : this.battle.getUnit(this.selectedId);
  }

  /**
   * Раскраска юнита на портрете (шаг 50). В бою по контракту — по записи машины;
   * вне кампании записей нет, и противник идёт в раскраске по умолчанию.
   */
  paintOf(unit: MechUnit): string {
    const known = this.contractMode ? this.paints.get(unit.id) : undefined;
    return known ?? (unit.side === 'player' ? paintOfFaction(undefined) : DEFAULT_PAINT);
  }

  /** Машины, которые игрок вправе выбирать: свои. */
  get ownUnits(): MechUnit[] {
    void this.version;
    return this.battle.units.filter((u) => this.commands(u) && !u.destroyed);
  }

  /**
   * Командует ли игрок этой машиной: своя сторона и не звено нанимателя
   * (шаг 73b). Союзника видно и можно осмотреть, но ходит за него бот — тем же
   * проходом, что и за противника (`stepBotSide`).
   */
  commands(unit: MechUnit): boolean {
    return unit.side === this.viewer && !unit.ally;
  }

  unitAt(col: number, row: number): MechUnit | undefined {
    void this.version;
    return this.battle.unitAt(offsetToHex(col, row));
  }

  contactOf(unit: MechUnit): ContactLevel {
    void this.version;
    if (unit.side === this.viewer) return ContactLevel.Identified;
    return this.battle.contact(this.viewer, unit.id);
  }

  get selectedWeapon(): RenderWeapon | null {
    void this.version;
    const unit = this.selected;
    if (unit === undefined || unit.destroyed) return null;
    if (!this.commands(unit)) return null;
    let mount = unit.mounts[this.mountIndex];
    if (!mount || mount.destroyed) {
      mount = unit.mounts.find((m) => !m.destroyed);
    }
    if (!mount) return null;
    const w = weapon(mount.weapon);
    return {
      name: tr(w.key),
      minR: w.minRange,
      shortR: w.short,
      medR: w.medium,
      maxR: w.long,
    };
  }

  get scene(): RenderScene {
    void this.version;
    return buildScene({
      state: this.battle,
      viewer: this.viewer,
      mapView: this.view,
      selectedId: this.selectedId,
      hover: this.hover,
      hoveredWeapon: this.hoveredWeapon,
      selectedWeapon: this.selectedWeapon,
      mode: this.mode,
      reach: this.reach,
      unitAngles: this.unitFacingAngles,
      // Зона выхода видна, только когда раскрыт блок отхода («Исход боя») в контракте (шаг 65).
      showExitZone: this.showExitZone && this.contractMode && !this.finished,
      moveTrails: this.moveTrails,
    });
  }

  get hoverHex(): HexView | null {
    void this.version;
    if (this.hover === null) return null;
    return this.view.hexes.get(viewKey(this.hover.col, this.hover.row)) ?? null;
  }

  /** Подпись рельефа под курсором. Числа берутся из данных, не из кода. */
  terrainLabel(h: HexView): string {
    const name = terrainName(h.terrain);
    return h.depth > 0 ? t('battle.terrainDepth', { name, depth: h.depth }) : name;
  }

  /** Цена входа в клетку под курсором — из результата Дейкстры, а не своя. */
  hoverCost(): number | null {
    if (this.hover === null || this.reach === null) return null;
    const cell = this.reach.byHex.get(hexKey(offsetToHex(this.hover.col, this.hover.row)));
    return cell?.cost ?? null;
  }

  // --- Лист машины ----------------------------------------------------------

  /**
   * Броня и структура по зонам. Только по ОПОЗНАННОЙ машине: по силуэту
   * повреждений не разглядеть, и показывать их значило бы отдать игроку
   * знание, которого у него нет.
   */
  zonesOf(unit: MechUnit | undefined): ZoneLine[] {
    void this.version;
    if (unit === undefined) return [];
    if (this.contactOf(unit) < ContactLevel.Identified) return [];
    const itemKinds = ['weapon', 'ammo', 'heatsink', 'jump_jet', 'equipment'];
    return unit.zones.map((z, i) => ({
      id: ZONE_IDS[i] ?? String(i),
      label: tr(ZONE_KEYS[i as keyof typeof ZONE_KEYS] ?? ''),
      armor: z.armor,
      maxArmor: z.maxArmor,
      structure: z.structure,
      maxStructure: z.maxStructure,
      destroyed: z.destroyed,
      hasItems: unit.mounts.some((m) => m.zone === i) ||
        (unit.slots[i]?.some((s) => itemKinds.includes(s.kind)) ?? false),
    }));
  }

  weaponsOf(unit: MechUnit | undefined): WeaponLine[] {
    void this.version;
    if (unit === undefined) return [];
    if (this.contactOf(unit) < ContactLevel.Identified) return [];
    const ready = new Set(availableMounts(unit).map((m) => unit.mounts.indexOf(m)));
    return unit.mounts.map((m, index) => {
      const w = weapon(m.weapon);
      return {
        index,
        name: tr(w.key),
        ready: ready.has(index),
        ammo: m.ammo,
        heat: w.heat,
        damage: w.damage * w.shots,
        range: {
          name: tr(w.key),
          minR: w.minRange,
          shortR: w.short,
          medR: w.medium,
          maxR: w.long,
        },
      };
    });
  }

  /**
   * Предел нагрева машины: отвод за ход + запас корпуса — та же цифра, что в
   * наряде цеха. Тепло выше предела в фазе тепла глушит реактор (`core/rules/heat.ts`).
   */
  heatLimitsOf(unit: MechUnit): HeatLimits {
    void this.version;
    return heatLimits(unit);
  }

  /**
   * Мигать ли шкале нагрева выбранной машины: выстрел выбранным стволом (или
   * уже набранное тепло) уведёт реактор в отключение в этой фазе тепла.
   * Считает ядро (`wouldShutDown`), а не показ: «не мигает — не отключится»
   * обязано совпадать с правилом, включая защиту от петли перезапуска.
   */
  get heatAlarm(): boolean {
    void this.version;
    const unit = this.selected;
    if (unit === undefined || unit.destroyed || !this.commands(unit)) return false;
    if (wouldShutDown(unit)) return true;
    if (this.battle.phase !== Phase.Attack) return false;
    const mount = unit.mounts[this.mountIndex];
    if (mount === undefined || !availableMounts(unit).includes(mount)) return false;
    return wouldShutDown(unit, unit.heat + weapon(mount.weapon).heat);
  }

  /**
   * Разбор целевого числа ДО броска. Берётся готовым у ядра: если показ начнёт
   * считать шанс сам, появится вторая правда, и она разойдётся с ядром на
   * первом же исключении (шаг 9, часть B).
   */
  aimAt(target: MechUnit | undefined): AimView | null {
    void this.version;
    const shooter = this.selected;
    if (shooter === undefined || target === undefined) return null;
    if (target.side === shooter.side) return null;
    const mount = shooter.mounts[this.mountIndex];
    if (mount === undefined) return null;

    const bd: ToHitBreakdown = toHitBreakdown(
      this.battle.map,
      shooter,
      target,
      mount.weapon,
      mount.zone,
      this.battle.contact(shooter.side, target.id),
      this.battle.units,
    );

    const known = this.contactOf(target);
    const cleanCode = cleanChassisCode(target.chassis);
    const mechName = CHASSIS_CATALOG.get(cleanCode)?.canonName || cleanCode;
    return {
      targetId: target.id,
      targetName:
        known >= ContactLevel.Identified
          ? `${mechName} (${cleanCode}) [${target.pilot.callsign}]`
          : known === ContactLevel.Silhouette
            ? `${tr(WEIGHT_CLASS_KEYS[target.weightClass]).toUpperCase()} [${target.pilot.callsign}]`
            : t('battle.aim.blip'),
      possible: !bd.impossible,
      reason: bd.impossible
        ? bd.band === 'out'
          ? t('battle.aim.outOfRange')
          : // Ракеты бьют навесом, но только по силуэту: на «?» причина своя,
            // иначе «нет линии» читается как «навес не работает».
            weapon(mount.weapon).category === 'missile' && known < ContactLevel.Silhouette
            ? t('battle.aim.indirectNeedsSilhouette')
            : // Флаг `indirectRequiresSpotter` (`combat.json`) включён и ни один
              // союзник цель прямо сейчас не видит — своя причина, а не общее
              // «нет линии огня».
              weapon(mount.weapon).category === 'missile' && bd.los.blocked && !bd.indirect
              ? t('battle.aim.indirectNeedsSpotter')
              : t('battle.aim.noLineOfSight')
        : '',
      target: bd.target,
      chance: hitProbability(bd.target),
      base: bd.base,
      factors: bd.factors.map((f) => ({ label: tr(f.key), amount: f.amount })),
      distance: bd.distance,
      band: bd.band,
      zoneTable: zoneTableName({
        levelAdvantage: bd.los.levelAdvantage,
        partialCover: bd.los.partialCover,
        distance: bd.distance,
        arcing: arcingWeapon(weapon(mount.weapon).category),
      }),
    };
  }

  /** Разбор по цели под курсором — то, что видно в доке линии огня. */
  get aim(): AimView | null {
    void this.version;
    if (this.hover === null) return null;
    const target = this.battle.unitAt(offsetToHex(this.hover.col, this.hover.row));
    if (target === undefined) return null;
    if (this.contactOf(target) === ContactLevel.None) return null;
    return this.aimAt(target);
  }

  // --- Команды --------------------------------------------------------------

  private run(command: Command): boolean {
    const result = execute(this.battle, command);
    if (!result.ok) {
      this.addLog(t('battle.sysLog.rejected', { reason: t(`battle.reject.${result.reason}`) }), 'info');
      return false;
    }
    // Сводка считается ТЕМ ЖЕ кодом, что и в автобое (`sim/tally.ts`): опыт,
    // добивания и перегрев после боя, отыгранного руками, обязаны считаться
    // одинаково — иначе кампания зависит от того, кто вёл звено.
    this.tally.collect(result.events, this.battle);
    if (command.kind === 'endPhase' && this.battle.phase === Phase.Initiative) {
      this.tally.sampleHeat(this.battle);
    }
    this.absorb(result.events);
    return true;
  }

  onFX: ((fx: BeamFxEvent | TextFxEvent) => void) | null = null;
  /**
   * Идёт ли ещё показ выстрелов: очередь эффектов не пуста или снаряд в полёте.
   * Ставит холст. Луч рисуется по клеткам, запомненным в момент выстрела, а
   * машины — по текущему состоянию; без ожидания этого показа бот успевал
   * сдвинуть цель, и выстрел приходил в пустую клетку.
   */
  fxBusy: (() => boolean) | null = null;

  clearTicker(): void {
    this.tickerItems = [];
  }

  private absorb(events: readonly BattleEvent[]): void {
    this.allEvents.push(...events);
    const newItems = buildTickerItems(events, this.battle);
    if (newItems.length > 0) {
      this.tickerItems = [...this.tickerItems, ...newItems];
    }

    // Надписи, пришедшие после выстрела в той же пачке событий, — его
    // последствия: они уходят в `followups` и показываются при попадании.
    const fx: Array<BeamFxEvent | TextFxEvent> = [];
    let lastShot: BeamFxEvent | null = null;
    const text = (hex: Parameters<typeof hexToOffset>[0], label: string, color: string): void => {
      const { col, row } = hexToOffset(hex);
      const item: TextFxEvent = { type: 'text', col, row, text: label, color };
      if (lastShot !== null) lastShot.followups.push(item);
      else fx.push(item);
    };

    for (const e of events) {
      if (e.kind === 'moved') {
        this.unitFacingAngles.delete(e.unitId);
        if (e.path.length >= 2) {
          const pathOffsets = e.path.map((h) => hexToOffset(h));
          this.moveTrails.set(e.unitId, {
            path: pathOffsets,
            mode: e.mode,
            turn: this.battle.turn,
          });
        }
        lastShot = null;
      } else if (e.kind === 'shot') {
        lastShot = null;
        const shooter = this.battle.getUnit(e.unitId);
        const target = this.battle.getUnit(e.targetId);
        if (shooter !== undefined && target !== undefined) {
          const sOff = hexToOffset(shooter.hex);
          const tOff = hexToOffset(target.hex);
          lastShot = {
            type: 'beam',
            targetId: e.targetId,
            fromCol: sOff.col,
            fromRow: sOff.row,
            toCol: tOff.col,
            toRow: tOff.row,
            weapon: e.weapon,
            // `hit`, не `intentHit`: у ракетной пачки (шаг 66b) намерение может
            // удаться у одной ракеты из многих и всё равно ничего не долететь
            // (та единственная потом сорвалась) — луч обязан гаснуть промахом
            // ровно тогда, когда цель ничего не получила, а не раньше.
            miss: !e.hit,
            indirect: e.factors.some((f) => f.key === 'toHit.indirect'),
            followups: [],
          };
          fx.push(lastShot);
        }
      } else if (e.kind === 'damaged') {
        const target = this.battle.getUnit(e.unitId);
        if (target !== undefined) {
          const zName = tr(ZONE_KEYS[e.zone]);
          text(target.hex, `-${e.amount} [${zName}]`, e.zoneDestroyed ? '#ff1744' : '#ff7043');
        }
      } else if (e.kind === 'critical') {
        const target = this.battle.getUnit(e.unitId);
        if (target !== undefined) text(target.hex, t('battle.fx.crit'), '#bc8cff');
      } else if (e.kind === 'shutdown') {
        const u = this.battle.getUnit(e.unitId);
        if (u !== undefined) text(u.hex, t('battle.fx.shutdown'), '#ff1744');
      } else if (e.kind === 'ambushWoke') {
        const u = this.battle.getUnit(e.unitId);
        if (u !== undefined) text(u.hex, t('battle.fx.ambush'), '#ff1744');
      } else if (e.kind === 'ambushSpotted' && e.side === this.viewer) {
        const u = this.battle.getUnit(e.unitId);
        if (u !== undefined) text(u.hex, t('battle.fx.ambushSpotted'), '#ffd54f');
      } else if (e.kind === 'fell') {
        const u = this.battle.getUnit(e.unitId);
        if (u !== undefined) text(u.hex, t('battle.fx.fell'), '#ffd54f');
      }
    }
    for (const item of fx) this.onFX?.(item);
    // Вид строки называет ядро, а не угадывает экран по тексту (шаг 52).
    const added = this.log.push(events, namesFrom(this.battle));
    if (added.length > 0) this.logs = [...this.logs, ...added];
    this.recomputeReach();
    this.version++;
  }

  addLog(text: string, kind: LogLine['kind'] = 'info'): void {
    this.logs = [...this.logs, { parts: [{ text }], kind }];
  }

  select(unitId: string | null): void {
    this.selectedId = unitId;
    this.mountIndex = 0;
    const unit = unitId === null ? undefined : this.battle.getUnit(unitId);
    if (unit !== undefined && this.moveMode === MoveMode.Jump && mpBudget(unit, MoveMode.Jump) <= 0) {
      this.moveMode = MoveMode.Walk;
    }
    this.recomputeReach();
    this.version++;
  }

  setMode(mode: 'move' | 'los'): void {
    this.mode = mode;
    this.version++;
  }

  setMoveMode(mode: MoveMode): void {
    const unit = this.selected;
    if (unit !== undefined && mode === MoveMode.Jump && mpBudget(unit, MoveMode.Jump) <= 0) {
      return;
    }
    this.moveMode = mode;
    this.recomputeReach();
    this.version++;
  }

  setMount(index: number): void {
    this.mountIndex = index;
    this.version++;
  }

  private recomputeReach(): void {
    const unit = this.selectedId === null ? undefined : this.battle.getUnit(this.selectedId);
    // Зона хода — только в фазе движения. В стрельбе подсвеченные клетки под
    // своей машиной читались как «сейчас ход», и фаза на миг путалась
    // (решение пользователя 2026-09-15).
    if (
      unit === undefined ||
      !this.commands(unit) ||
      unit.moveMode !== null ||
      this.battle.phase !== Phase.Movement
    ) {
      this.reach = null;
      return;
    }
    this.reach = reachable(this.battle.map, unit.hex, {
      mode: this.moveMode,
      mpBudget: mpBudget(unit, this.moveMode),
      startFacing: unit.facing,
      blocked: this.knownOccupied(unit.id),
    });
  }

  /**
   * Клетки, занятые машинами, о которых сторона игрока ЗНАЕТ (шаг 73a).
   *
   * Подсветка хода вырезала клетки всех машин, включая невидимые, и незамеченный
   * противник проступал на карте «дырой» в подсветке — для засады это раскрытие
   * до срока. Теперь вырезаются только свои и те, с кем есть контакт. Ход через
   * клетку незамеченной машины ядро по-прежнему отклонит («клетка занята»), но
   * такая клетка всегда соседняя с машиной, а в двух гексах засада и так видна к
   * стрельбе.
   */
  private knownOccupied(exceptId: string): Set<number> {
    const out = new Set<number>();
    for (const u of this.battle.units) {
      if (u.id === exceptId) continue;
      // Выбывшая и ушедшая машины из таблицы контактов уходят, но их клетка
      // занята по-прежнему, и это знание публично: прятать нечего.
      const hidden =
        u.side !== this.viewer &&
        !u.destroyed &&
        !u.withdrawn &&
        this.battle.contact(this.viewer, u.id) === ContactLevel.None;
      if (hidden) continue;
      out.add(hexKey(u.hex));
    }
    return out;
  }

  /** Клик по клетке: выбрать машину, пойти или выстрелить. */
  clickHex(col: number, row: number): void {
    if (this.botThinking) return;
    const target = offsetToHex(col, row);
    const unit = this.battle.unitAt(target);

    if (unit !== undefined) {
      if (unit.side === this.viewer) {
        this.select(unit.id);
        return;
      }
      if (this.contactOf(unit) !== ContactLevel.None) {
        if (this.battle.phase === Phase.Attack) {
          let shooter = this.selected;
          if (shooter === undefined || !this.commands(shooter) || shooter.destroyed) {
            shooter = this.ownUnits.find((u) => !u.destroyed && u.pilot.status === 'active');
            if (shooter !== undefined) this.select(shooter.id);
          }
          if (shooter !== undefined && this.commands(shooter)) {
            this.fireAt(unit.id);
            return;
          }
        }
        this.select(unit.id);
        return;
      }
    }

    if (this.mode === 'move') {
      if (this.battle.phase !== Phase.Movement) return;
      if (this.selectedId === null || this.reach === null) return;
      const path = pathTo(this.reach, target).map((c) => c.hex);
      if (path.length < 2) return;
      this.run({ kind: 'move', unitId: this.selectedId, path, mode: this.moveMode });
    }
  }

  selectFirstOwn(): void {
    const own = this.ownUnits[0];
    if (own !== undefined) this.select(own.id);
  }

  fireAt(targetId: string): void {
    if (this.selectedId === null) return;
    if (this.battle.phase !== Phase.Attack) {
      this.addLog(t('battle.sysLog.fireWrongPhase'), 'info');
      return;
    }
    this.run({
      kind: 'attack',
      unitId: this.selectedId,
      targetId,
      mountIndex: this.mountIndex,
    });
  }

  /** Поворот на месте — дискретный шаг 30° (12 положений, как в исходном макете). */
  turnTo(facingAngleRad: number): void {
    const unit = this.selected;
    if (unit === undefined || !this.commands(unit)) return;
    const ROT_STEP = Math.PI / 6;
    const curIdx = Math.round(facingAngleRad / ROT_STEP);
    let newAngle = curIdx * ROT_STEP;
    while (newAngle > Math.PI) newAngle -= Math.PI * 2;
    while (newAngle <= -Math.PI) newAngle += Math.PI * 2;

    this.unitFacingAngles.set(unit.id, newAngle);
    const targetFacing = angleToFacing(newAngle);
    if (targetFacing !== unit.facing) {
      this.rotate(targetFacing);
    }
    this.version++;
  }

  /** Поворот кнопками Q / E или стрелками: шаг 30° (12 направлений вместо 6). */
  rotateBy(steps: number): void {
    const unit = this.selected;
    if (unit === undefined || !this.commands(unit)) return;
    const ROT_STEP = Math.PI / 6;
    const curAngle = this.unitFacingAngles.get(unit.id) ?? facingAngle(unit.facing);
    let curIdx = Math.round(curAngle / ROT_STEP);
    curIdx += (steps > 0 ? 1 : -1);
    let newAngle = curIdx * ROT_STEP;
    while (newAngle > Math.PI) newAngle -= Math.PI * 2;
    while (newAngle <= -Math.PI) newAngle += Math.PI * 2;

    this.unitFacingAngles.set(unit.id, newAngle);
    const targetFacing = angleToFacing(newAngle);
    if (targetFacing !== unit.facing) {
      this.rotate(targetFacing);
    }
    this.version++;
  }

  private rotate(facing: Direction): void {
    const unit = this.selected;
    if (unit === undefined || !this.commands(unit)) return;
    if (facing === unit.facing) return;
    this.run({ kind: 'turn', unitId: unit.id, facing });
  }

  /**
   * Завершить фазу.
   *
   * Порядок важен и повторяет автобой: сначала бот доигрывает ТЕКУЩУЮ фазу,
   * если ещё не ходил в ней, потом фаза закрывается, потом бот ходит снова,
   * если по инициативе он идёт первым. Без первой половины бот всегда ходил бы
   * после игрока, и выигранная инициатива не значила бы ничего.
   */
  async endPhase(): Promise<void> {
    if (this.botThinking) return;
    await this.playBotTurn();
    this.run({ kind: 'endPhase' });

    // Фазы Тепла и Инициативы полностью автоматические — рассчитываем их сразу,
    // чтобы плавно перейти к фазе движения следующего раунда.
    while (this.battle.phase === Phase.Heat || this.battle.phase === Phase.Initiative) {
      this.run({ kind: 'endPhase' });
    }
    // Фаза сменилась — зона хода либо гаснет (стрельба), либо появляется
    // заново (новый ход). Ход бота пересчитывает её сам, но если в фазе первыми
    // идём мы, бот не ходит, и зона осталась бы от прошлой фазы.
    this.recomputeReach();

    await this.botIfFirst();
  }

  /** Бот ходит немедленно, если по инициативе он первый в этой фазе. */
  private async botIfFirst(): Promise<void> {
    const phase = this.battle.phase;
    if (phase !== Phase.Movement && phase !== Phase.Attack) return;
    if (this.battle.order[0] === this.viewer) return;
    await this.playBotTurn();
  }

  // --- Ход противника -------------------------------------------------------

  /**
   * Ход бота проигрывается ПО ШАГАМ: одна команда — одна перерисовка.
   * Иначе четыре машины перескакивают одновременно, и понять, что произошло,
   * нельзя. Пауза живёт здесь, в показе, а не внутри `chooseAction`.
   */
  async playBotTurn(): Promise<void> {
    if (this.botThinking || this.finished) return;
    const phase = this.battle.phase;
    if (phase !== Phase.Movement && phase !== Phase.Attack) return;

    const stamp = `${this.battle.turn}:${phase}`;
    if (this.botPlayedFor === stamp) return;
    this.botPlayedFor = stamp;

    this.botThinking = true;
    try {
      // Бот действует только после того, как показ уже сделанных выстрелов
      // закончен: иначе его машина уходит из клетки, куда ещё летит луч.
      await this.waitForFx();
      // РЕШЕНИЕ СТОРОНЫ (шаг 43) — раз в ход, до первого хода машины. Тот же
      // вызов, что и в цикле автобоя: второй копии условия «пора уходить» в
      // проекте нет. Сторона игрока мораль не проверяет — это делает сам
      // `chooseSideAction`.
      if (phase === Phase.Movement) {
        for (const side of this.battle.order) {
          if (side === this.viewer) continue;
          const decision = chooseSideAction(this.battle, side);
          if (decision === null) continue;
          const result = execute(this.battle, decision);
          if (result.ok) this.absorb(result.events);
        }
      }

      let guard = 0;
      while (guard++ < 200 && !this.finished) {
        if (this.battle.phase !== phase) break;
        const acted = await this.stepBotSide(phase);
        if (!acted) break;
      }
    } finally {
      this.botThinking = false;
      this.recomputeReach();
      this.version++;
    }
  }

  private async stepBotSide(phase: Phase): Promise<boolean> {
    let acted = false;
    for (const unit of this.battle.unitsInOrder()) {
      const live = this.battle.getUnit(unit.id);
      if (live === undefined) continue;
      // Звено нанимателя (шаг 73b) ходит тем же проходом, что и противник.
      if (this.commands(live)) continue;
      if (live.destroyed || live.withdrawn || live.pilot.status !== 'active') continue;

      const attempts = phase === Phase.Attack ? Math.max(1, live.mounts.length) : 1;
      for (let i = 0; i < attempts; i++) {
        const current = this.battle.getUnit(unit.id);
        if (current === undefined || current.destroyed || current.withdrawn) break;
        const command = chooseAction(this.battle, unit.id, this.botRng);
        if (command.kind === 'endPhase') break;
        const result = execute(this.battle, command);
        if (!result.ok) break;
        this.absorb(result.events);
        acted = true;
        await this.pause();
        if (command.kind === 'move') break;
      }
    }
    return acted;
  }

  /**
   * Дождаться конца показа выстрелов. Без холста (тесты) и при мгновенном боте
   * не ждёт. Потолок по времени — на случай фоновой вкладки: там кадры не идут,
   * очередь не разбирается, и ожидание без потолка остановило бы бой.
   */
  private async waitForFx(): Promise<void> {
    if (this.botSpeed <= 0) return;
    const deadline = performance.now() + 5000;
    while (this.fxBusy?.() === true && performance.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }

  private pause(): Promise<void> {
    const ms = this.botSpeed <= 0 ? 0 : 260 / this.botSpeed;
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Полный цикл автохода для машин игрока:
   * 1. В фазе движения — ИИ рассчитывает и делает ходы каждым роботом игрока.
   * 2. Переход к фазе стрельбы (бот делает свое движение).
   * 3. В фазе стрельбы — ИИ стреляет каждым роботом игрока по лучшим целям.
   * 4. Завершение фазы стрельбы (бот стреляет, расчет охлаждения и переход к новому ходу).
   */
  async playAutoTurn(): Promise<void> {
    if (this.botThinking || this.autoPlaying || this.finished) return;
    this.autoPlaying = true;
    try {
      // 1. Если сейчас фаза движения — выполняем маневры своими роботами
      if (this.battle.phase === Phase.Movement) {
        // Выстрелы прошлой фазы могли ещё лететь — свои машины не уходят из-под них.
        await this.waitForFx();
        for (const unit of this.battle.unitsInOrder()) {
          const live = this.battle.getUnit(unit.id);
          if (live === undefined || !this.commands(live)) continue;
          if (live.destroyed || live.pilot.status !== 'active' || live.moveMode !== null) continue;

          const command = chooseAction(this.battle, unit.id, this.botRng);
          if (command.kind === 'move' || command.kind === 'turn') {
            this.select(unit.id);
            const result = execute(this.battle, command);
            if (result.ok) {
              this.absorb(result.events);
              await this.pause();
            }
          }
        }
        // Завершаем фазу движения -> бот ходит и переходим к фазе стрельбы
        await this.endPhase();
      }

      // 2. Если сейчас фаза стрельбы — выполняем прицельные залпы своими роботами
      if (this.battle.phase === Phase.Attack) {
        for (const unit of this.battle.unitsInOrder()) {
          const live = this.battle.getUnit(unit.id);
          if (live === undefined || !this.commands(live)) continue;
          if (live.destroyed || live.pilot.status !== 'active') continue;

          const attempts = Math.max(1, live.mounts.length);
          for (let i = 0; i < attempts; i++) {
            const current = this.battle.getUnit(unit.id);
            if (current === undefined || current.destroyed) break;
            const command = chooseAction(this.battle, unit.id, this.botRng);
            if (command.kind === 'endPhase') break;
            if (command.kind === 'attack') {
              this.select(unit.id);
              const result = execute(this.battle, command);
              if (result.ok) {
                this.absorb(result.events);
                await this.pause();
              } else {
                break;
              }
            }
          }
        }
        // Свои выстрелы долетают до того, как бот начнёт фазу закрывать.
        await this.waitForFx();
        // Завершаем фазу стрельбы -> бот стреляет, охлаждение и переходим к следующему ходу!
        await this.endPhase();
      }
    } finally {
      this.autoPlaying = false;
      this.recomputeReach();
      this.version++;
    }
  }

  /** Обновить контакты вручную — нужно после смены карты вне хода. */
  refresh(): void {
    refreshContacts(this.battle);
    this.version++;
  }

  /**
   * Легенда штрафов. Числа берутся из `data/terrain.json` через ядро, а не
   * переписываются в разметку: переписанное число живёт своей жизнью и
   * однажды разойдётся с правилом, которое оно описывает.
   */
  terrainLegend(): { key: string; name: string; mp: number; cover: number }[] {
    const shown: TerrainId[] = ['plain', 'lightWoods', 'heavyWoods', 'rough', 'water'];
    return shown.map((id) => {
      const info = terrainInfo(TERRAIN_IDS.indexOf(id));
      return { key: id, name: terrainName(id), mp: info.enterCost, cover: info.toHitMod };
    });
  }
}

let tickerSeq = 0;

/**
 * Что сломал крит — по виду эффекта (`CriticalEffect`). До шага 52 здесь стояла
 * цепочка сравнений с `'weaponDamaged'`, которого в ядре нет: уничтоженное
 * оружие, охладитель и разрушенные реактор с гироскопом показывались пустым
 * слотом. Ключ по имени вида такой ошибки не допускает, а неизвестный вид
 * честно падает на пустой слот.
 */
function critText(sub: Extract<BattleEvent, { kind: 'critical' }>): string {
  if (sub.effect === 'actuatorHit') {
    return t(sub.slotKind === 'arm_actuator' ? 'battle.ticker.crit.actuatorArm' : 'battle.ticker.crit.actuatorLeg');
  }
  if (sub.effect === 'equipmentDamaged') {
    return t('battle.ticker.crit.equipmentDamaged', { item: sub.itemId ? tr(`equipment.${sub.itemId}`) : '' });
  }
  const key = `battle.ticker.crit.${sub.effect}`;
  return hasKey(key) ? t(key) : t('battle.ticker.crit.empty');
}

function buildTickerItems(events: readonly BattleEvent[], state: BattleState): CombatTickerItem[] {
  const names = namesFrom(state);
  const items: CombatTickerItem[] = [];

  for (let i = 0; i < events.length; i++) {
    const e = events[i]!;

    if (e.kind === 'shot') {
      const shooter = names.unit(e.unitId);
      const target = names.unit(e.targetId);
      const wpn = tr(weapon(e.weapon).key);
      const parts = e.factors.map((f) => `${tr(f.key)} ${f.amount >= 0 ? '+' : ''}${f.amount}`);
      const detailMod = parts.length > 0 ? ` [${parts.join(', ')}]` : '';
      // Ракетная пачка (шаг 66b): у каждой ракеты свой бросок, «бросок/
      // попал-промах» одной строкой уже не описывает выстрел — вместо этого
      // «долетело N из M». Судьба каждой ракеты по отдельности (Собранность,
      // срыв) в тикер не выносится — до двадцати строк на один залп были бы
      // шумом, а не подсказкой.
      const isCluster = e.clusterTotal !== undefined;
      const landed = e.clusterLanded ?? 0;
      const total = e.clusterTotal ?? 0;
      const result = isCluster
        ? t('battle.ticker.clusterResult', { landed, total })
        : t(e.intentHit ? 'battle.ticker.hit' : 'battle.ticker.miss');
      const details: string[] = [
        t('battle.ticker.toHit', { need: e.toHitTarget, mods: detailMod }),
        isCluster
          ? t('battle.ticker.clusterRoll', { landed, total })
          : t('battle.ticker.roll', { roll: e.roll, result }),
      ];
      if (!isCluster && e.poiseSaved) {
        details.push(t('battle.ticker.poise', { composure: e.composure }));
      }
      if (!isCluster && e.botched) {
        details.push(t('battle.ticker.botched'));
      }

      let damageSummary = '';
      let k = i + 1;
      while (k < events.length && events[k]!.kind !== 'shot' && events[k]!.kind !== 'moved') {
        const sub = events[k]!;
        if (sub.kind === 'damaged') {
          const zName = tr(ZONE_KEYS[sub.zone]);
          const outcome = sub.zoneDestroyed
            ? t('battle.ticker.zoneDestroyed')
            : sub.armorHeld
              ? t('battle.ticker.armorLeft', { n: sub.armorAfter })
              : t('battle.ticker.structureLeft', { n: sub.structureAfter });
          damageSummary = t('battle.ticker.damageSummary', { amount: sub.amount, zone: zName, outcome });
          details.push(t('battle.ticker.damageDetail', { amount: sub.amount, zone: zName, outcome }));
        } else if (sub.kind === 'critical') {
          const zName = tr(ZONE_KEYS[sub.zone]);
          details.push(t('battle.ticker.critDetail', { zone: zName, slot: sub.slotIndex + 1, desc: critText(sub) }));
        } else if (sub.kind === 'fell') {
          details.push(t('battle.ticker.fellDetail'));
        }
        k++;
      }

      const tbl = e.zoneTable ?? 'Main';
      const tblTag = ` · [${tbl}]`;
      details.push(t('battle.ticker.zoneTable', { table: tbl }));
      const summary = isCluster
        ? t('battle.ticker.clusterShotSummary', {
            shooter,
            target,
            weapon: wpn,
            result,
            need: e.toHitTarget,
            tag: tblTag,
          })
        : t('battle.ticker.shotSummary', {
            shooter,
            target,
            weapon: wpn,
            result,
            roll: e.roll,
            need: e.toHitTarget,
            tag: tblTag,
          });

      if (isCluster) {
        items.push({
          id: `shot-${Date.now()}-${i}-${++tickerSeq}`,
          kind: landed > 0 ? 'hit' : 'miss',
          badge: t('battle.ticker.badgeCluster', { landed, total }),
          badgeClass: landed === 0 ? 'miss' : landed === total ? 'hit' : 'warning',
          shooter,
          target,
          weaponName: wpn,
          summary,
          damageSummary: damageSummary || undefined,
          details,
          timestamp: Date.now(),
        });
      } else if (e.intentHit) {
        items.push({
          id: `shot-${Date.now()}-${i}-${++tickerSeq}`,
          kind: 'hit',
          badge: t('battle.ticker.badgeHit'),
          badgeClass: 'hit',
          shooter,
          target,
          weaponName: wpn,
          summary,
          damageSummary: damageSummary || undefined,
          details,
          timestamp: Date.now(),
        });
      } else {
        items.push({
          id: `shot-${Date.now()}-${i}-${++tickerSeq}`,
          kind: 'miss',
          badge: t('battle.ticker.badgeMiss'),
          badgeClass: 'miss',
          shooter,
          target,
          weaponName: wpn,
          summary,
          details,
          timestamp: Date.now(),
        });
      }
    } else if (e.kind === 'shutdown') {
      const unit = names.unit(e.unitId);
      items.push({
        id: `shutdown-${Date.now()}-${i}-${++tickerSeq}`,
        kind: 'shutdown',
        badge: t('battle.ticker.badgeShutdown'),
        badgeClass: 'danger',
        shooter: unit,
        summary: t('battle.ticker.shutdownSummary', { unit, heat: e.heat }),
        details: [
          t('battle.ticker.shutdownOverheat', { heat: e.heat, limit: e.limit }),
          t('battle.ticker.shutdownAuto'),
        ],
        timestamp: Date.now(),
      });
    } else if (e.kind === 'restarted') {
      const unit = names.unit(e.unitId);
      items.push({
        id: `restart-${Date.now()}-${i}-${++tickerSeq}`,
        kind: 'restart',
        badge: t('battle.ticker.badgeRestart'),
        badgeClass: 'info',
        shooter: unit,
        summary: t('battle.ticker.restartSummary', { unit }),
        details: [t('battle.ticker.restartDetail')],
        timestamp: Date.now(),
      });
    } else if (e.kind === 'fell') {
      const unit = names.unit(e.unitId);
      items.push({
        id: `fell-${Date.now()}-${i}-${++tickerSeq}`,
        kind: 'fell',
        badge: t('battle.ticker.badgeFell'),
        badgeClass: 'warning',
        shooter: unit,
        summary: t('battle.ticker.fellSummary', { unit }),
        details: [t('battle.ticker.fellProne')],
        timestamp: Date.now(),
      });
    } else if (e.kind === 'ammoExplosion') {
      const unit = names.unit(e.unitId);
      items.push({
        id: `ammo-${Date.now()}-${i}-${++tickerSeq}`,
        kind: 'crit',
        badge: t('battle.ticker.badgeAmmo'),
        badgeClass: 'danger',
        shooter: unit,
        summary: t('battle.ticker.ammoSummary', { unit, damage: e.damage }),
        details: [t('battle.ticker.ammoDetail', { zone: tr(ZONE_KEYS[e.zone]) })],
        timestamp: Date.now(),
      });
    }
  }

  return items;
}

export const battle = new BattleUi();

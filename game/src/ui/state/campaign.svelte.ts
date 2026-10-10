import {
  CAMPAIGN_RULES_VERSION,
  CampaignState,
  type CampaignMode,
  CONTRACTS,
  GALAXY,
  IncompatibleSaveError,
  availableContracts,
  availableMechs,
  availableStock,
  blockedOffers,
  canExecute,
  campaignProgress,
  companyRating,
  clearedOf,
  frontSectors,
  frontShares,
  frontWeights,
  theaterOf,
  theaterReference,
  type WarState,
  pirateRisk,
  MRBC_REGISTRY,
  ratingTable,
  contractBrief,
  contractReputation,
  effectiveStanding,
  ownerOf,
  economyList,
  economyOf,
  ownerArray,
  fundsOf,
  isPlayerRealm,
  truceDaysAfterPeace,
  protectorateByPeace,
  offensiveCost,
  planOffensive,
  orderLance,
  realmWarFund,
  placeWarFund,
  pushOf,
  planList,
  ruinShareOf,
  tensionOf,
  warBand,
  prosperityOf,
  standingList,
  standingOf,
  systemIncome,
  systemProfile,
  makeBattleFromBrief,
  contractDecadeOf,
  decadeOf,
  contractIntel,
  contractSimpleThreat,
  alliesSimpleThreat,
  landingQuote,
  type LandingQuote,
  dateOf,
  execute,
  findMech,
  foundingInit,
  installPlan,
  isRefittable,
  isSurveyed,
  isVisited,
  isWarehousePart,
  type WarehousePart,
  lanceSimpleThreat,
  MARKET,
  marketProfile,
  nodeCost,
  makeSaveFile,
  maxZones,
  itemCost,
  mechValue,
  nodeValue,
  parseSaveFile,
  worldPrice,
  WAR,
  loyaltyDrift,
  loyaltyPressure,
  type LoyaltyPressure,
  realmMarketOf,
  BUILDING_KINDS,
  atSite,
  baySite,
  buildEtaDecades,
  buildPoints,
  buildingCost,
  buildingRefund,
  buildingUpkeep,
  domainBuildingsUpkeep,
  buildingWork,
  builtOn,
  constructionOf,
  depotCapOf,
  workshopBaysAt,
  developCostAt,
  developmentMaxAt,
  depotCount,
  garrisonCapOf,
  garrisonCount,
  type BuildingKind,
  type MarketClass,
  type RepairWork,
  loyaltyFactor,
  startLoyalty,
  type LoyaltyOrigin,
  revoltDeadline,
  WORLD_FOCUSES,
  PLAYER_ACTOR_ID,
  realmArmyCap,
  realmArmyUpkeep,
  type RealmArmyCap,
  type RealmArmyUpkeep,
  atWarWithPlayer,
  eventDef,
  inviteTerms,
  pendingEvents,
  bordersOf,
  growthOf,
  realmAlarm,
  demandForceRatio,
  domainBorder,
  peaceOutcome,
  peaceTerms,
  playerWarOf,
  type PeaceTerms,
  capitalMoveReadyDay,
  domainCapitalIndex,
  domainTally,
  realmOutlook,
  domainWorlds,
  focusOf,
  pactOf,
  RIVALS,
  spawnCandidates,
  pactPrice,
  protectoratePrice,
  regimentPrice,
  regimentRefund,
  suzerainOf,
  syncDomainEconomy,
  theatersOf,
  totalArmy,
  tributeCount,
  tributeFlows,
  tributeOf,
  tributePrice,
  vassalsOf,
  worldContributionAt,
  FACTIONS,
  frontierIndexAt,
  denBounty,
  memoryOf,
  type WorldFocus,
  orderPrice,
  isInsolvent,
  payrollAmount,
  recordChassisDef,
  recordQuality,
  recordNodeSpec,
  salvagedNode,
  type OrderSpec,
  WEAR_NODES,
  refitPlan,
  sellPrice,
  restore,
  salvageOffer,
  snapshot,
  treatmentDays,
  developmentOf,
  systemKnowledge,
  zoneRepairPlan,
  type CampaignCommand,
  type CampaignEvent,
  type RatingRow,
  type RegistryRow,
  type Regiment,
  type Rival,
  type CampaignRejectReason,
  type Contract,
  type MechRecord,
  type ReputationState,
  type SalvageOffer,
  type MechLot,
  type RefitPlan,
  type StockLot,
  type WarehouseEntry,
  type WearNode,
  type AchievementsState,
  type CampaignProgress,
} from '../../core/campaign/index.js';
import {
  realmBonuses,
  sectorLimit,
  sectorMap,
  stanceOf,
  stanceTarget,
  governorBonus,
  isGovernor,
  type FrontStance,
  type GovernorBonus,
  type GovernorPriority,
  greatHirePrice,
  nextTitle,
  titleBonusOf,
  titleOf,
  type TitleBonus,
} from '../../core/campaign/index.js';
import { GALAXY_RULES } from '../../core/campaign/galaxy/catalog.js';
import { ECONOMY } from '../../core/data/index.js';
import { findRoute, type Route } from '../../core/campaign/galaxy/navigation.js';
import type { QualityClass } from '../../core/model/QualityClass.js';
import { levelCost } from '../../core/rules/skills.js';
import { PILOTS, WEAPONS, equipment, weapon } from '../../core/data/tables.js';
import { clampEmblem, COMPANY_EMBLEM_COUNT, dropshipDefOf, mechCapacityOf } from '../../core/campaign/company/types.js';
import {
  garrisonAt,
  isStationed,
  policyOf,
  shipboardMechs,
  type GarrisonPolicy,
  type GarrisonPost,
} from '../../core/campaign/company/garrison.js';
import { fitLance } from '../../core/campaign/war/orderLance.js';
import { nextBayStep, nextDropshipId, nextHangarStep } from '../../core/campaign/commands/execute.js';
import { isShipyard, worldProfile } from '../../core/campaign/galaxy/profile.js';
import { scaleOutlook } from '../../core/campaign/contracts/board.js';
import { intelSurprise, type IntelSurprise } from '../../core/campaign/contracts/intel.js';
import { runOn } from '../../sim/autoBattle.js';
import type { ScaleId } from '../../core/campaign/contracts/schema.js';
import type { DropshipDef, DropshipId } from '../../core/data/schema.js';
import {
  allocateByZone,
  getChassisCatalogEntry,
  validateAssembly,
  type MechAssembly,
} from '../../core/rules/construction.js';
import { CHASSIS_CATALOG } from '../../core/data/index.js';
import { HitZone, ZONE_IDS, zoneFromId, type ZoneId } from '../../core/model/HitZone.js';
import { bayStands, type BayStand } from './bays.js';
import type { BattleOutcome } from '../../core/campaign/bridge/fromBattle.js';
import { skillLevel, type Pilot } from '../../core/model/Pilot.js';
import { IndexedDbStorage } from '../../platform/IndexedDbStorage.js';
import type { Storage } from '../../platform/Storage.js';
import {
  loadCachedLogs,
  LOG_LIMIT,
  REP_LOG_LIMIT,
  saveCachedLogs,
  WAR_LOG_LIMIT,
  type LogLine,
  type RepLine,
  type WarLine,
} from './logStorage.js';
import { tr } from '../../core/log/index.js';
import { cbills, days as daysText, formatDate, t, tn } from '../i18n/index.js';
import { factionShortName, mercName } from '../i18n/names.js';
import type { ZoneLine } from './battle.svelte.js';
import type { SkipReason } from './lanceGroups.js';

/**
 * Состояние интерфейса кампании (шаг 17).
 *
 * Устроено так же, как боевой стор (`battle.svelte.ts`), и по той же причине:
 * держит НАСТОЯЩИЙ `CampaignState` и меняет его ТОЛЬКО командами через
 * `execute`. Ни брони, ни денег, ни дня своей копией здесь нет — любое поле,
 * продублированное сюда, разойдётся с ядром на первом же исключении.
 *
 * Своего здесь ровно то, чего в правилах нет: какой экран открыт, что выбрано
 * щелчком, что писать в бегущий журнал и висит ли на экране окно. Ни одной
 * проверки доступности кнопки тут тоже нет — их отвечает `canExecute`
 * (`commands/canExecute.ts`), и второй копии правил доступности в компонентах
 * быть не должно: это ловушка 2 шага 17 в её худшем виде.
 *
 * Изменение состояния — ТОЛЬКО через `run()`. Присваивания в `state.company`,
 * `state.day` и прочее в этом файле нет и быть не может: если оно тут появится,
 * шаг не принят.
 */

export type Screen =
  | 'hangar'
  | 'realm'
  | 'mechlab'
  | 'starmap'
  | 'contracts'
  | 'relations'
  | 'war'
  | 'market'
  | 'barracks'
  | 'rating'
  | 'battle'
  | 'debrief'
  | 'company'
  | 'setup';

export type Mode = 'menu' | 'campaign' | 'sandbox' | 'settings';
export type Scope = 'company' | 'realm';
/** Вкладки экрана державы (шаг 93): Штаб с картой, миры, армия и фронты, дипломатия и прежний экран «(А)». */
export type RealmTab = 'hq' | 'worlds' | 'forces' | 'diplomacy' | 'legacy';

/** Что выбрано в державе — общее для её вкладок: «Подробнее» и «На карте» открывают тот же мир, сектор, соседа. */
export type RealmPick = { readonly kind: 'world' | 'foreign' | 'sector'; readonly id: string } | null;

/** Экраны, которые есть и у роты, и у державы: карта и война. */
export type SharedScreen = 'starmap' | 'war';
export function isSharedScreen(screen: Screen): screen is SharedScreen {
  return screen === 'starmap' || screen === 'war';
}

export type { LogLine, RepLine, WarLine };

/** Слот кампании в хранилище браузера. Один: несколько слотов — это не шаг 17. */
const SLOT = 'campaign';

/** Столичный прилавок — эталон ширины ассортимента для слоя «Снаряжение» на звёздной карте. */
const GEAR_HEAT_FULL_LOTS = MARKET.classes.capital.lots;
/** Ниже этого мир на слое не подсвечивается (см. `marketHeatBySystem`). */
const GEAR_HEAT_MIN = 0.5;

// --- чтение записи машины для показа --------------------------------------------

/**
 * Зоны машины в том виде, в каком их рисует кукла брони.
 *
 * Считается по паспорту (`maxZones`) и состоянию — обе величины у ядра, ни
 * одного числа брони этот слой не выдумывает. Тип общий с боевым стором
 * намеренно: кукла одна на бой и на ангар (ловушка 1 шага 17).
 */
export function zoneLinesOf(record: MechRecord): ZoneLine[] {
  const chassis = recordChassisDef(record);
  const limits = maxZones(chassis);
  // Потолок корпуса — не новое правило, а то же число, которым `validateAssembly`
  // проверяет сборку («Превышен максимум брони»), разложенное по зонам той же
  // таблицей долей, что и всё остальное. Считать его здесь своей формулой было
  // бы второй копией правила конструирования.
  const validation = validateAssembly(record.assembly);
  const hull = allocateByZone(validation.maxArmor);
  return ZONE_IDS.map((id) => {
    const i = zoneFromId(id);
    const now = record.condition.zones[i];
    const max = limits[i];
    const hasItems = record.assembly.items?.some((it) => it.zone === id) ?? false;
    return {
      id,
      label: t(`zone.${id}`),
      armor: Math.round(now?.armor ?? 0),
      maxArmor: Math.round(max?.armor ?? 0),
      structure: Math.round(now?.structure ?? 0),
      maxStructure: Math.round(max?.structure ?? 0),
      destroyed: now?.destroyed === true,
      hullArmor: Math.round(hull[id]),
      hasItems,
    };
  });
}

/**
 * Комплектность машины: чего на ней НЕ хватает против того, что держит корпус.
 *
 * Вторая ось после класса исполнения (решение 2026-09-02, шаг 16a). Отличается
 * от повреждений тем, что ремонтом не лечится: ремонт доводит до ПАСПОРТА, а
 * паспорт у недоукомплектованной машины и есть неполный. Лечится мехлабом
 * (шаг 19a) — то есть переоснащением.
 *
 * Все числа берутся у `validateAssembly` — той самой функции, которой ядро
 * проверяет любую сборку. Ни одного своего расчёта здесь нет: своя формула
 * «сколько ещё влезет» разошлась бы с той, что запрещает перегруз.
 */
export interface Completeness {
  /** Броня: несёт / держит корпус, в очках. */
  readonly armor: number;
  readonly armorMax: number;
  /** Грузоподъёмность: занято / доступно, в тоннах. */
  readonly mass: number;
  readonly massMax: number;
  readonly freeMass: number;
  /** Ячейки оборудования по зонам: занято / всего. */
  readonly slotsUsed: Readonly<Record<string, number>>;
  readonly slotsTotal: Readonly<Record<string, number>>;
  /** Залп против охлаждения: больше единицы — машина греется быстрее, чем остывает. */
  readonly heatRatio: number;
  /** Доля комплекта, 0..1. Полная машина — 1. */
  readonly share: number;
}

export function completenessOf(record: MechRecord): Completeness {
  const report = validateAssembly(record.assembly);
  return {
    armor: report.totalArmor,
    armorMax: report.maxArmor,
    mass: report.totalMass,
    massMax: report.maxMass,
    freeMass: report.freeMass,
    slotsUsed: report.slotsUsed,
    slotsTotal: report.slotsAvailable,
    heatRatio: report.heatRatio,
    share: report.maxArmor === 0 ? 1 : report.totalArmor / report.maxArmor,
  };
}

/** Машина не на ходу: разрушен торс или голова. Такая запись — не машина, а лом. */
export function isWreck(record: MechRecord): boolean {
  const z = record.condition.zones;
  return z[HitZone.Torso]?.destroyed === true || z[HitZone.Head]?.destroyed === true;
}

export type MechStatus = 'ready' | 'damaged' | 'critical' | 'wreck' | 'inWork' | 'noPilot';

/** Ключ строки состояния машины для списка парка. Порядок проверок — от худшего. */
export function mechStatusOf(state: CampaignState, record: MechRecord): MechStatus {
  if (isWreck(record)) return 'wreck';
  if (jobOf(state, record.id) !== null) return 'inWork';
  if (record.condition.zones.some((z) => z.destroyed)) return 'critical';
  const limits = maxZones(recordChassisDef(record));
  const hurt = record.condition.zones.some((z, i) => {
    const max = limits[i];
    return max !== undefined && (z.armor < max.armor || z.structure < max.structure);
  });
  if (hurt) return 'damaged';
  return 'ready';
}

/** Незавершённая работа цеха по машине, если она есть. */
export function jobOf(
  state: CampaignState,
  recordId: string,
): { readonly day: number; readonly jobId: string; readonly work: string; readonly cost: number } | null {
  for (const e of state.queue) {
    if (e.task.kind !== 'repairJob' || e.task.recordId !== recordId) continue;
    return { day: e.day, jobId: e.task.jobId, work: e.task.work, cost: e.task.cost };
  }
  return null;
}

// --- журнал ---------------------------------------------------------------------

/**
 * Событие ядра → строка журнала.
 *
 * Показ ничего не пересчитывает: он проигрывает то, что произошло (то же
 * правило, что и в бою). Здесь только перевод события в текст словаря.
 * Событий, которым в журнале не место (`taskScheduled`, `taskDue`), нет
 * намеренно: журнал читает игрок, а не отладчик.
 */
function lineOf(state: CampaignState, e: CampaignEvent): LogLine | null {
  const day = state.day;
  const info = (text: string): LogLine => ({ text, kind: 'info', day });
  const money = (text: string): LogLine => ({ text, kind: 'money', day });
  const warn = (text: string): LogLine => ({ text, kind: 'warn', day });

  switch (e.kind) {
    case 'payrollPaid':
      // По кассе после выплаты, а не по историческому флагу: иначе после первого
      // ухода в минус каждая следующая выплата писала «неплатёжеспособна».
      return e.cbillsAfter < 0
        ? warn(t('event.bankrupt', { sum: cbills(e.amount), left: cbills(e.cbillsAfter) }))
        : money(t('event.payrollPaid', { sum: cbills(e.amount), left: cbills(e.cbillsAfter) }));
    case 'jobScheduled':
      return money(
        t('event.jobScheduled', {
          work: t(`hangar.job.${e.work}`),
          mech: nameOfMech(state, e.recordId),
          sum: cbills(e.cost),
          days: daysText(e.days),
        }),
      );
    case 'jobCompleted':
      return e.success
        ? info(t('event.jobCompleted', { work: t(`hangar.job.${e.work}`), mech: nameOfMech(state, e.recordId) }))
        : warn(t('event.jobFailed', { mech: nameOfMech(state, e.recordId) }));
    case 'jobCancelled':
      return money(
        t('event.jobCancelled', {
          work: t(`hangar.job.${e.work}`),
          mech: nameOfMech(state, e.recordId),
          sum: cbills(e.refund),
        }),
      );
    case 'pilotRecovered':
      return info(t('event.pilotRecovered', { pilot: nameOfPilot(state, e.pilotId) }));
    case 'salvageCompensated':
      return info(
        t('event.salvageCompensated', {
          sum: cbills(e.amount),
          percent: Math.round(e.share * 100),
        }),
      );
    case 'pilotRested':
      return info(
        t('event.pilotRested', { pilot: nameOfPilot(state, e.pilotId), injuries: e.injuries }),
      );
    case 'pilotAdmitted':
      return warn(t('event.pilotAdmitted', { pilot: nameOfPilot(state, e.pilotId), days: daysText(e.days) }));
    case 'pilotLost':
      return warn(t('event.pilotLost', { pilot: e.pilotId }));
    case 'pilotAssigned':
      return e.pilotId === null
        ? info(t('event.pilotUnassigned', { mech: nameOfMech(state, e.recordId) }))
        : info(
            t('event.pilotAssigned', {
              pilot: nameOfPilot(state, e.pilotId),
              mech: nameOfMech(state, e.recordId),
            }),
          );
    case 'mechScrapped':
      return info(t('event.mechScrapped', { mech: e.recordId }));
    case 'contractTaken':
      return money(
        t('event.contractTaken', {
          sum: cbills(e.advance),
          date: formatDate(dateOf(e.deadlineDay)),
        }),
      );
    case 'contractAbandoned':
      return warn(t('event.contractAbandoned', { sum: cbills(e.charged) }));
    case 'contractFailed':
      return warn(t('event.contractFailed', { sum: cbills(e.penalty) }));
    case 'contractResolved':
      return money(
        t('event.contractResolved', {
          result: t(`debrief.result.${e.result}`),
          sum: cbills(e.settlement),
        }),
      );
    case 'deployed':
      return info(t('event.deployed', { count: e.recordIds.length, enemy: e.enemyUnits }));
    case 'sandboxLoanTaken':
      return money(t('event.sandboxLoanTaken', { sum: cbills(e.amount), debt: cbills(e.debt) }));
    case 'sandboxLoanRepaid':
      return money(t('event.sandboxLoanRepaid', { sum: cbills(e.amount), debt: cbills(e.debt) }));
    case 'landingPaid':
      return money(
        t('event.landingPaid', { sum: cbills(e.amount), ratio: e.feeRatio.toFixed(2), left: cbills(e.cbillsAfter) }),
      );
    case 'travelStarted':
      return money(
        t('event.travelStarted', {
          system: nameOfSystem(e.toSystemId),
          jumps: tn('count.jumps', e.jumps),
          days: daysText(e.days),
          sum: cbills(e.cost),
        }),
      );
    case 'arrived':
      return info(t('event.arrived', { system: nameOfSystem(e.systemId) }));
    case 'surveyed':
      return info(t('event.surveyed', { system: nameOfSystem(e.systemId) }));
    case 'mechRepainted':
      return info(t('event.mechRepainted', { mech: nameOfMech(state, e.recordId) }));
    case 'baysUpgraded':
      return info(t('event.baysUpgraded', { count: e.to }));
    case 'hangarUpgraded':
      return info(t('event.hangarUpgraded', { count: e.to }));
    case 'mechBought':
      return money(t('event.mechBought', { mech: nameOfMech(state, e.recordId), sum: cbills(e.cost) }));
    case 'mechSold':
      return money(t('event.mechSold', { sum: cbills(e.price) }));
    case 'partOrdered': {
      // Связка «реактор + каркас» — один заказ и одна строка журнала, хотя
      // событий по числу позиций: пишем её от первой позиции, остальные молчат.
      const parts = state.queue.flatMap((q) =>
        q.task.kind === 'deliveryArrived' && q.task.orderId === e.orderId ? [q.task.part] : [],
      );
      if (parts.length === 0 || parts[0]!.id !== e.partId) return null;
      return money(
        t('event.partOrdered', {
          parts: parts.map(nodePartLabel).join(', '),
          sum: cbills(e.cost),
          date: formatDate(dateOf(e.arrivalDay)),
        }),
      );
    }
    case 'partBought': {
      const part = state.company.warehouse.find((w) => w.id === e.partId);
      if (part === undefined) return null;
      const name = isWarehousePart(part)
        ? nodePartLabel(part)
        : WEAPONS.has(part.itemId)
          ? tr(weapon(part.itemId).key)
          : tr(equipment(part.itemId).key);
      return money(t('event.partBought', { part: name, sum: cbills(e.cost) }));
    }
    case 'partDelivered': {
      const part = state.company.warehouse.find((w) => w.id === e.partId);
      return part !== undefined && isWarehousePart(part)
        ? info(t('event.partDelivered', { part: nodePartLabel(part) }))
        : null;
    }
    case 'worldGranted':
      return info(
        t('event.worldGranted', {
          system: nameOfSystem(e.systemId),
          faction: nameOfFaction(e.from),
          date: formatDate(dateOf(e.tributeUntil)),
        }),
      );
    case 'worldConquered':
      return info(
        e.loot === undefined
          ? t('event.worldConquered', { system: nameOfSystem(e.systemId) })
          : `${t('event.worldConquered', { system: nameOfSystem(e.systemId) })} ${t('event.realmLoot', { sum: cbills(e.loot) })}`,
      );
    case 'worldBought':
      return money(t('event.worldBought', { system: nameOfSystem(e.systemId), sum: cbills(e.price) }));
    // --- держава (шаг 72): только то, что касается миров и армии роты --------------
    case 'domainTicked': {
      const line =
        e.fund > 0
          ? t('event.domainTickedFund', { income: cbills(e.income), upkeep: cbills(e.upkeep), army: cbills(e.army), fund: cbills(e.fund) })
          : t('event.domainTicked', { income: cbills(e.income), upkeep: cbills(e.upkeep), army: cbills(e.army) });
      // Содержание построек (шаг 87) — второй фразой, только когда они есть.
      return money(e.buildings > 0 ? `${line} ${t('event.domainTickedBuildings', { sum: cbills(e.buildings) })}` : line);
    }
    case 'buildingStarted':
      return money(
        t('event.buildingStarted', {
          system: nameOfSystem(e.systemId),
          building: t(`realm.world.building.${e.building}`),
          sum: cbills(e.cost),
          days: tn('count.days', e.decades * WAR.front.tickDays),
        }),
      );
    case 'buildingCancelled':
      return money(
        t('event.buildingCancelled', {
          system: nameOfSystem(e.systemId),
          building: t(`realm.world.building.${e.building}`),
          sum: cbills(e.refund),
        }),
      );
    case 'buildingDone':
      return info(t('event.buildingDone', { system: nameOfSystem(e.systemId), building: t(`realm.world.building.${e.building}`) }));
    case 'buildingsLost': {
      const list = (kinds: readonly string[]): string =>
        kinds.length === 0 ? t('event.buildingsNone') : kinds.map((k) => t(`realm.world.building.${k}`)).join(', ');
      const line = t('event.buildingsLost', { system: nameOfSystem(e.systemId), lost: list(e.lost), kept: list(e.kept) });
      return warn(
        e.construction === undefined
          ? line
          : `${line} ${t('event.buildingsLostConstruction', { building: t(`realm.world.building.${e.construction}`) })}`,
      );
    }
    case 'warFunded':
      return money(t('event.warFunded', { sum: cbills(e.amount) }));
    case 'warBudgetSet':
      return info(t('event.warBudgetSet', { percent: Math.round(e.share * 100) }));
    case 'frontClash': {
      // В журнал роты идёт приказ армии (у него есть цена); бои такта с державой — в сводке войны
      // (шаг 78), а захват и потеря мира такта — строками `frontMoved` ниже. Исключение — бой гарнизона
      // (шаг 86b): машины роты дрались, и урон в ангаре должен быть объяснён в журнале роты. Отход
      // гарнизона — своей строкой `garrisonWithdrawn`.
      if (e.cost === undefined) {
        if (e.garrison === undefined || e.garrison.withdrew) return null;
        const text = t('event.garrisonClash', {
          system: nameOfSystem(e.systemId),
          faction: nameOfFaction(e.attacker),
          mechs: tn('count.mechs', e.garrison.mechs),
          detachment: e.garrison.detachment,
          knocked: e.garrison.knocked,
          lost: e.garrison.lostRecordIds.length,
        });
        return e.outcome === 'repelled' ? info(text) : warn(text);
      }
      const params = {
        system: nameOfSystem(e.systemId),
        faction: nameOfFaction(e.defender),
        ours: e.attackerSize,
        theirs: e.defenderSize,
        oursLost: e.attackerLost,
        theirsLost: e.defenderLost,
        sum: cbills(e.cost),
      };
      const won = t(e.outcome === 'captured' ? 'event.offensiveWon' : 'event.offensiveLost', params);
      const main = e.loot === undefined ? won : `${won} ${t('event.realmLoot', { sum: cbills(e.loot) })}`;
      // Звено роты в приказе (шаг 86) — второй фразой той же строки: одна строка на оба столкновения.
      const text =
        e.company === undefined
          ? main
          : `${main} ${t('event.offensiveCompany', {
              mechs: tn('count.mechs', e.company.mechs),
              detachment: e.company.detachment,
              knocked: e.company.knocked,
              lost: e.company.lostRecordIds.length,
            })}`;
      return e.outcome === 'captured' ? info(text) : warn(text);
    }
    case 'regimentRaised':
      return e.mechs > 0
        ? money(t('event.regimentRaised', { mechs: tn('count.mechsAcc', e.mechs), sum: cbills(e.price), army: e.armyAfter }))
        : money(t('event.regimentDisbanded', { mechs: tn('count.mechsAcc', -e.mechs), sum: cbills(-e.price), army: e.armyAfter }));
    case 'worldFocus':
      if (e.owner !== PLAYER_ACTOR_ID) return null;
      return e.started
        ? money(t('event.worldFocusStarted', { system: nameOfSystem(e.systemId), focus: t(`focus.${e.to}`) }))
        : info(t('event.worldFocusDone', { system: nameOfSystem(e.systemId), focus: t(`focus.${e.to}`) }));
    case 'worldDeveloped':
      if (e.owner !== PLAYER_ACTOR_ID) return null;
      return e.built
        ? money(t('event.worldBuilt', { system: nameOfSystem(e.systemId), level: e.to }))
        : warn(t('event.worldDeclined', { system: nameOfSystem(e.systemId), level: e.to }));
    case 'pirateRaid':
      if (e.owner !== PLAYER_ACTOR_ID) return null;
      return warn(
        t(e.sacked ? 'event.domainSacked' : 'event.domainRaided', {
          system: nameOfSystem(e.systemId),
          percent: Math.round(e.ruined * 100),
        }),
      );
    case 'frontMoved':
      if (e.defender !== PLAYER_ACTOR_ID && e.attacker !== PLAYER_ACTOR_ID) return null;
      if (e.attacker === PLAYER_ACTOR_ID) {
        return info(t('event.realmCaptured', { system: nameOfSystem(e.systemId), faction: nameOfFaction(e.defender) }));
      }
      return warn(
        t(e.kindOfMove === 'capture' ? 'event.domainLost' : 'event.domainFrontRaid', {
          system: nameOfSystem(e.systemId),
          faction: nameOfFaction(e.attacker),
        }),
      );
    case 'peaceMade': {
      // Срок перемирия — договор фракций плюс надбавка за взятые миры (шаг 3b): из события, не из таблицы.
      const days = daysText(e.truceUntil - state.day);
      const faction = nameOfFaction(e.factionId);
      const names = (ids: readonly string[]): string => ids.map(nameOfSystem).join(', ');
      // Исход мира шага 81 — отдельными фразами за главной: цель, данники, унижение, возвращённое.
      const parts = [
        // Мир на цели фракции (шаг 83) — ни «без условий», ни «как есть»: держава платит мирами.
        e.yielded !== undefined
          ? t('event.peaceOnTerms', { faction, days })
          : e.forced !== undefined
            ? t(e.forced === 'realm' ? 'event.peaceForcedRealm' : 'event.peaceForcedFoe', { faction, days })
            : e.ceded !== undefined
              ? t('event.peaceCeded', { faction, system: nameOfSystem(e.ceded), days })
              : e.cost > 0
                ? t('event.peacePaid', { faction, sum: cbills(e.cost), days })
                : t('event.peaceFree', { faction, days }),
        ...(e.gained === undefined ? [] : [t('event.peaceGained', { systems: names(e.gained) })]),
        ...(e.tributaries === undefined ? [] : [t('event.peaceTributaries', { systems: names(e.tributaries) })]),
        ...(e.humiliated === undefined ? [] : [t('event.peaceHumiliated', { faction })]),
        ...(e.protectorate === undefined ? [] : [t('event.peaceProtectorate', { faction })]),
        ...(e.returned === undefined ? [] : [t('event.peaceReturned', { faction, systems: names(e.returned) })]),
        ...(e.yielded === undefined ? [] : [t('event.peaceYielded', { faction, systems: names(e.yielded) })]),
      ];
      return e.yielded === undefined ? info(parts.join(' ')) : warn(parts.join(' '));
    }
    case 'garrisonUnloaded':
      return info(t('event.garrisonUnloaded', { system: nameOfSystem(e.systemId), mechs: tn('count.mechs', e.recordIds.length) }));
    case 'garrisonLoaded':
      return info(t('event.garrisonLoaded', { system: nameOfSystem(e.systemId), mechs: tn('count.mechs', e.recordIds.length) }));
    case 'garrisonPolicySet':
      return null;
    case 'garrisonWithdrawn':
      return warn(
        t(e.reason === 'policy' ? 'event.garrisonWithdrawn' : 'event.garrisonEvacuated', {
          from: nameOfSystem(e.from),
          to: nameOfSystem(e.to),
          mechs: tn('count.mechs', e.recordIds.length),
          date: formatDate(dateOf(e.arrives)),
        }),
      );
    case 'garrisonPilotHired':
      return money(
        t('event.garrisonPilotHired', {
          system: nameOfSystem(e.systemId),
          mech: nameOfMech(state, e.recordId),
          sum: cbills(e.cost),
        }),
      );
    case 'garrisonLost':
      return warn(t('event.garrisonLost', { system: nameOfSystem(e.systemId), mechs: tn('count.mechs', e.recordIds.length) }));
    case 'garrisonRevoltBattle': {
      const params = {
        system: nameOfSystem(e.systemId),
        mechs: tn('count.mechs', e.mechs),
        enemy: e.enemy,
        lost: e.lostRecordIds.length,
      };
      return e.won ? info(t('event.garrisonRevoltWon', params)) : warn(t('event.garrisonRevoltLost', params));
    }
    case 'realmTitleChanged': {
      // Основание и падение державы — строкой `realmChanged`; здесь только смена титула у живой державы.
      if (e.from === null || e.to === null) return null;
      const up = WAR.realm.titles.findIndex((x) => x.id === e.to) > WAR.realm.titles.findIndex((x) => x.id === e.from);
      const line = t(up ? 'event.realmTitleUp' : 'event.realmTitleDown', { title: t(`realm.title.name.${e.to}`) });
      return up ? info(line) : warn(line);
    }
    case 'garrisonRaidBattle': {
      const params = {
        system: nameOfSystem(e.systemId),
        mechs: tn('count.mechs', e.mechs),
        enemy: e.enemy,
        lost: e.lostRecordIds.length,
      };
      return e.won ? info(t('event.garrisonRaidWon', params)) : warn(t('event.garrisonRaidLost', params));
    }
    case 'homeRaidPosted':
      return warn(t('event.homeRaidPosted', { system: nameOfSystem(e.systemId), date: formatDate(dateOf(e.until)) }));
    case 'homeRaidRepelled':
      return e.by === 'company' ? info(t('event.homeRaidRepelled', { system: nameOfSystem(e.systemId) })) : null;
    case 'worldAbandoned':
      return warn(t('event.worldAbandoned', { system: nameOfSystem(e.systemId), faction: nameOfFaction(e.to) }));
    case 'worldRevolt':
      return warn(
        t('event.worldRevolt', {
          system: nameOfSystem(e.systemId),
          faction: nameOfFaction(e.formerOwner),
          days: daysText(WAR.loyalty.revoltDecades * WAR.front.tickDays),
        }),
      );
    case 'worldRevoltSuppressed':
      return e.by === 'army'
        ? info(t('event.worldRevoltSuppressedArmy', { system: nameOfSystem(e.systemId), mechs: tn('count.mechs', e.mechs ?? 0) }))
        : info(t('event.worldRevoltSuppressed', { system: nameOfSystem(e.systemId) }));
    case 'worldSeceded':
      return warn(t('event.worldSeceded', { system: nameOfSystem(e.systemId), faction: nameOfFaction(e.to) }));
    case 'capitalMoved':
      return money(t('event.capitalMoved', { system: nameOfSystem(e.systemId), sum: cbills(e.price) }));
    case 'realmChanged':
      // Оба перехода — предупреждения: основание державы выводит миры роты на
      // фронт, падение — значит, последний мир отняли.
      return warn(t(e.realm ? 'event.realmFounded' : 'event.realmFallen'));
    case 'tributeBought':
      return money(
        t('event.tributeBought', {
          system: nameOfSystem(e.systemId),
          faction: nameOfFaction(e.from),
          sum: cbills(e.price),
        }),
      );
    case 'diplomacyMoved': {
      // Сводка войны пишет дипломатию всей Сферы; в журнал роты — только её
      // собственные договоры, дань и вассалы. У договора стороны равны, у дани
      // и протектората — нет: «мы обложили» и «нас обложили» разные строки.
      const ours = e.over === PLAYER_ACTOR_ID;
      if (!ours && e.under !== PLAYER_ACTOR_ID) return null;
      const params = {
        faction: nameOfFaction(ours ? e.under : e.over),
        system: e.systemId === undefined ? '' : nameOfSystem(e.systemId),
        pact: e.pact === undefined ? '' : t(`realm.pact.${e.pact}`),
      };
      if (e.move === 'pact') return info(t('event.realm.pact', params));
      // Война и предложение мира (шаг 76): объявила рота — строка-сведение,
      // объявили роте — предупреждение; мира просят только у роты.
      if (e.move === 'war') {
        if (ours) return info(t('event.realm.war.over', params));
        // Коалиция против державы (шаг 91): вступивший объявляет войну вслед за ведущим.
        return warn(e.leader === undefined ? t('event.realm.war.under', params) : t('event.realm.war.coalition', { ...params, leader: nameOfFaction(e.leader) }));
      }
      if (e.move === 'peaceOffer') {
        return info(t('event.realm.peaceOffer', { ...params, days: daysText(WAR.playerWar.offerDays) }));
      }
      if (e.move === 'pactLapsed') return warn(t('event.realm.pactLapsed', params));
      // Хорошая новость — когда подчинение растёт в нашу пользу или спадает с нас.
      const line = t(`event.realm.${e.move}.${ours ? 'over' : 'under'}`, params);
      const gained = e.move === 'tribute' || e.move === 'protectorate';
      return ours === gained ? info(line) : warn(line);
    }
    // --- наём великого полка (шаг 89): подряды полка — строками сводки войны, здесь — наём и его конец ---------
    case 'greatRegimentHired':
      return info(
        t('event.greatRegimentHired', {
          regiment: mercName(e.regimentId, e.regimentName),
          faction: factionShortName(e.against),
          sum: cbills(e.price),
          system: nameOfSystem(e.systemId),
          date: formatDate(dateOf(e.until)),
        }),
      );
    case 'demandIssued':
      return warn(t('event.demandIssued', { faction: factionShortName(e.from), system: nameOfSystem(e.systemId) }));
    case 'demandAnswered': {
      const names = { faction: factionShortName(e.from), system: nameOfSystem(e.systemId) };
      if (e.punishment?.kind === 'raid') {
        const ruin = Math.round(e.punishment.ruined * 100);
        return warn(t(e.punishment.sacked ? 'event.demandRaidSacked' : 'event.demandRaid', { ...names, ruin }));
      }
      const delta = e.punishment?.kind === 'standing' ? e.punishment.delta : 0;
      const standing = delta > 0 ? `+${delta}` : String(delta);
      return (e.outcome === 'refused' ? warn : info)(t(`event.demandAnswered.${e.outcome}`, { ...names, standing }));
    }
    case 'greatRegimentHireEnded':
      return warn(
        t(`event.greatRegimentHireEnded.${e.how}`, {
          regiment: mercName(e.regimentId, e.regimentName),
          faction: factionShortName(e.against),
        }),
      );
    // --- секторы и губернаторы (шаг 88): команды политик — строками сводки войны, здесь — назначения -----------
    case 'governorAppointed':
      return info(
        t('event.governorAppointed', {
          pilot: nameOfPilot(state, e.pilotId),
          system: nameOfSystem(e.centerId),
          priority: t(`realm.sector.priority.${e.priority}`),
        }),
      );
    case 'sectorPrioritySet':
      return info(t('event.sectorPrioritySet', { system: nameOfSystem(e.centerId), priority: t(`realm.sector.priority.${e.priority}`) }));
    case 'sectorDissolved':
      return e.reason === 'command'
        ? info(t('event.sectorDissolved', { system: nameOfSystem(e.centerId) }))
        : warn(t('event.sectorLost', { system: nameOfSystem(e.centerId) }));
    case 'governorLeft':
      return warn(t('event.governorLeft', { system: nameOfSystem(e.centerId) }));
    case 'worldPinned':
    case 'realmReserveSet':
    case 'frontStanceSet':
    case 'stanceTargetSet':
    case 'worldSectorAssigned':
    case 'realmPolicy':
      return null;
    case 'achievementUnlocked':
      return info(t('event.achievement', { name: t(`achievement.${e.id}.name`) }));
    default:
      return null;
  }
}

/** «Реактор R3 · Армейский»: узел, тир и класс — то, чем заказ отличается от соседнего. */
function nodePartLabel(part: WarehousePart): string {
  return `${t(`hangar.${part.node}`)} ${part.node === 'reactor' ? 'R' : 'F'}${part.tier} · ${t(`quality.${part.quality}`)}`;
}

function nameOfMech(state: CampaignState, recordId: string): string {
  return state.company.mechs.find((m) => m.id === recordId)?.name ?? recordId;
}

function nameOfPilot(state: CampaignState, pilotId: string): string {
  const p = state.company.pilots.find((x) => x.id === pilotId);
  return p === undefined ? pilotId : p.callsign;
}

function nameOfSystem(systemId: string): string {
  return GALAXY.name(GALAXY.require(systemId));
}

/** Короткое имя фракции для журнала — тем же словарём, что на экранах (`relations.ts::factionName`). */
function nameOfFaction(id: string): string {
  return factionShortName(id, id);
}

/** Одно условие пути к миру: что есть и что нужно (шаг 72). */
export interface ClaimTerm {
  readonly key: string;
  /** Как показывать число: целое, доля 0..1, проценты, деньги или «да/нет». */
  readonly unit: 'num' | 'frac' | 'pct' | 'money' | 'flag';
  readonly have: number;
  readonly need: number;
  readonly ok: boolean;
}

export interface ClaimPath {
  readonly path: 'grant' | 'conquer' | 'buy';
  readonly command: CampaignCommand;
  readonly terms: readonly ClaimTerm[];
  readonly price?: number;
}

/** Роль системы на слое «Держава» звёздной карты (шаг 72a). */
export type RealmMapRole = 'capital' | 'own' | 'tributary' | 'vassal' | 'border';

/** Сводка державы для экрана (шаг 72). */
export interface RealmSummary {
  readonly worlds: number;
  readonly income: number;
  readonly upkeep: number;
  /** Дань, доля вассалов и торговые договоры за такт: плюс — нам, минус — с нас. */
  readonly flows: number;
  /** Содержание полевой армии за такт (проект державы, шаг 1). */
  readonly army: number;
  /** Содержание построек миров за такт (шаг 87) — из итога до доли войны, как у такта. */
  readonly buildings: number;
  /** Отчисление в военный фонд за такт по бюджету державы (проект державы, шаг 2). */
  readonly fund: number;
  /** Что ляжет в кассу: итог минус отчисление в фонд. */
  readonly net: number;
}

/** Гарнизон мира державы для экрана (шаг 86b, `CampaignUi.garrisonView`). */
export interface GarrisonView {
  /** Рота стоит в этой системе — можно выгрузить и забрать. */
  readonly here: boolean;
  readonly policy: GarrisonPolicy;
  /** Машины на мире и в пути: `arrives` — день прибытия, если ещё в пути; `fit` — годна к бою; `depot` — на складе. */
  readonly mechs: readonly {
    readonly id: string;
    readonly name: string;
    readonly arrives: number | null;
    readonly fit: boolean;
    readonly depot: boolean;
  }[];
  /** Машины на корабле, которые можно выгрузить, если рота здесь: с пилотом — в гарнизон, без — на склад (шаг 87). */
  readonly aboard: readonly { readonly id: string; readonly name: string; readonly depot: boolean }[];
  /** Гарнизон и склад мира против их пределов (шаг 87). */
  readonly count: number;
  readonly cap: number;
  readonly depotCount: number;
  readonly depotCap: number;
}

/** Строка постройки на карточке мира (шаг 87): цена, трудоёмкость, срок на этом мире, содержание. */
export interface BuildingRow {
  readonly kind: BuildingKind;
  readonly built: boolean;
  readonly cost: number;
  readonly work: number;
  /** Срок на этом мире при нынешних очках, в днях. */
  readonly etaDays: number;
  readonly upkeep: number;
  /** Содержание за 10 лет. */
  readonly upkeep10: number;
}

/** Постройки мира державы для экрана (шаг 87, `CampaignUi.buildingsView`). */
export interface BuildingsView {
  readonly points: number;
  readonly rows: readonly BuildingRow[];
  readonly construction: {
    readonly kind: BuildingKind;
    readonly progress: number;
    readonly work: number;
    readonly etaDays: number;
    readonly refund: number;
  } | null;
  /** Работы на стапелях цеха этого мира. */
  readonly workshopJobs: readonly { readonly jobId: string; readonly mech: string; readonly daysLeft: number }[];
  /** Класс лавки мира без космопорта и с ним. */
  readonly marketFrom: MarketClass;
  readonly marketTo: MarketClass;
  /** Скидка завода на армию державы нынешнего размера — против содержания завода. */
  readonly factoryArmy: number;
  readonly factorySaving: number;
}

/** Декад в 10 годах — горизонт «сток или вложение» на карточке постройки (план шага 87). */
const DECADES_10Y = Math.round(3652.5 / WAR.front.tickDays);

export interface RealmWorld {
  readonly id: string;
  readonly name: string;
  readonly biome: string;
  readonly capital: boolean;
  readonly income: number;
  readonly upkeep: number;
  readonly capacity: number;
  readonly lift: number;
  readonly development: number;
  readonly developmentMax: number;
  /** Цена следующей ступени: с космопортом — со скидкой. */
  readonly developCost: number;
  readonly focus: WorldFocus;
  readonly naturalFocus: WorldFocus;
  readonly focusTo: WorldFocus | null;
  readonly focusUntil: number | null;
  readonly ruined: number;
  readonly tributeTo: string | null;
  readonly tributeUntil: number | null;
  /** Кто держит против мира участок фронта (шаг 72c/72d: набегов на миры роты нет). */
  readonly threats: readonly { readonly attacker: string }[];
  /**
   * Лояльность мира (шаг 85), 0..100, множитель дохода и мощности и сдвиг за декаду. `null` — у мира
   * нет записи (снимок, где владельца поставили руками): правило его не видит.
   */
  readonly loyalty: number | null;
  readonly loyaltyFactor: number;
  readonly loyaltyDrift: number;
  /** Что тянет лояльность вниз (шаг 91): война с прежним владельцем, его подстрекательство; `null` — ничего. */
  readonly loyaltyPressure: LoyaltyPressure;
  /** У кого мир получен: его ополчение восстаёт, ему мир отходит. */
  readonly formerOwner: string | null;
  /** Восстание: последний день — с него мир отходит прежнему владельцу. `null` — восстания нет. */
  readonly revoltUntil: number | null;
  /** Центр сектора, куда входит мир (шаг 88); `null` — мир вне секторов. */
  readonly sector: string | null;
  /** Мир закреплён игроком: губернатор по нему команд не отдаёт (шаг 88). */
  readonly pinned: boolean;
}

/** Сектор державы для экрана (шаг 88, `CampaignUi.realmSectors`). */
export interface SectorView {
  readonly center: string;
  readonly centerName: string;
  readonly priority: GovernorPriority;
  /** Губернатор; `null` — пост пуст. Бонус — числами ядра (`governorBonus`). */
  readonly governor: {
    readonly id: string;
    readonly name: string;
    readonly callsign: string;
    readonly presence: number;
    readonly tech: number;
    readonly tactics: number;
    readonly bonus: GovernorBonus;
  } | null;
  readonly worlds: readonly { readonly id: string; readonly name: string; readonly pinned: boolean }[];
}

export interface RealmSectors {
  readonly sectors: readonly SectorView[];
  /** Предел секторов и сколько назначено. */
  readonly limit: number;
  readonly used: number;
  readonly reserve: number;
  readonly reserveSteps: readonly number[];
  /** Пилоты, которых можно назначить: в строю и не губернаторы. */
  readonly pilots: readonly { readonly id: string; readonly callsign: string; readonly presence: number; readonly tech: number; readonly tactics: number }[];
  /** Свои миры — кандидаты в центр (центр назначенного сектора — смена губернатора). */
  readonly centers: readonly { readonly id: string; readonly name: string }[];
}

export interface FocusPreview {
  readonly focus: WorldFocus;
  readonly income: number;
  readonly upkeep: number;
  readonly capacity: number;
  readonly defence: number;
}

export interface RealmArmy {
  readonly total: number;
  readonly reserve: number;
  readonly capacity: number;
  readonly cap: number;
  /** Из чего сложен потолок (шаг 90, `realm/army.ts`): мощность, призыв, постройки, доля титула. */
  readonly capParts: RealmArmyCap;
  /** Содержание армии за декаду (шаг 90, ступень 8): резерв по доле цены, скидка построек. */
  readonly upkeep: RealmArmyUpkeep;
  /**
   * Театры против каждого врага на фронте и их норма (`logistics.ts::theaterReference`, шаг 80):
   * сверх полутора норм готовность театра не растёт, и армия там силы не прибавляет.
   */
  readonly theaters: readonly { readonly against: string; readonly mechs: number; readonly reference: number }[];
  readonly mechPrice: number;
  /** Содержание одной машины за декаду (проект державы, шаг 1). */
  readonly mechUpkeep: number;
  /** Военный бюджет (проект державы, шаг 2): доля итога в фонд и её шаги. */
  readonly warShare: number;
  readonly warSteps: readonly number[];
  /** Военный фонд по врагам и напор на участках против них (`front.ts::pushOf`). */
  readonly funds: readonly { readonly against: string; readonly amount: number; readonly push: number }[];
}

export interface RealmNeighbour {
  readonly factionId: string;
  readonly standing: number;
  readonly pact: { readonly kind: 'truce' | 'trade'; readonly untilDay: number } | null;
  readonly vassal: boolean;
  /** Сколько миров соседа платит дань роте. */
  readonly payingUs: number;
  /** Воюет ли держава роты с соседом (шаг 76): объявленная война или вражда выше порога фронта. */
  readonly atWar: boolean;
  /** Тревога соседа (шаг 91): на сколько его отношение к роте падает за декаду от роста державы; 0 — не падает. */
  readonly alarm: number;
  readonly systems: readonly {
    readonly id: string;
    readonly name: string;
    readonly capital: boolean;
    readonly tributeTo: string | null;
  }[];
}

// --- сам стор -------------------------------------------------------------------

/** Война державы роты с фракцией (шаг 76) — строка блока «Войны державы». */
export interface RealmWar {
  readonly factionId: string;
  readonly since: number;
  readonly won: number;
  readonly lost: number;
  /** До какого дня действует предложение мира от фракции; `null` — предложения нет. */
  readonly offerUntil: number | null;
  /** Условия мира — те же, по которым команда `makePeace` его заключит. */
  readonly terms: PeaceTerms;
  /** Сколько суток продлится перемирие, если заключить мир сейчас (шаг 3b). */
  readonly truceDays: number;
  /** Можно ли миром взять протекторат вместо цели (шаг 90, `protectorateByPeace`). */
  readonly protectorate: boolean;
  /** Цель роты (шаг 81), миры — названиями; `null` — цели нет. */
  readonly goal: { readonly kind: 'worlds' | 'tribute' | 'humiliation'; readonly systems: readonly string[] } | null;
  /** Цель фракции (шаг 83) — миры державы, которые она требует, названиями; пусто — не требует. */
  readonly foeGoal: readonly string[];
  /** То же id систем — для стрелок на карте державы (шаг 93). */
  readonly goalIds: readonly string[];
  readonly foeGoalIds: readonly string[];
  /** Усталость державы и фракции, 0–1 (шаг 81). */
  readonly fatigue: number;
  readonly foeFatigue: number;
  /**
   * Что перенесёт мир на нынешних условиях — `peaceOutcome`, тот же, что исполнит команда (шаг 81);
   * миры — названиями.
   */
  readonly outcome: {
    readonly gained: readonly string[];
    readonly tributaries: readonly string[];
    readonly humiliation: boolean;
    readonly returned: readonly string[];
    /** Миры цели фракции, которые держава отдаст (шаг 83). */
    readonly ceded: readonly string[];
  };
  /** Стойка фронта (шаг 88) и участок, на который «наступать» отдаст приказ сейчас (`null` — некуда). */
  readonly stance: FrontStance;
  readonly stanceTarget: string | null;
  readonly stanceTargetId: string | null;
  /** Цель стойки, выбранная игроком (шаг 93); `null` — цель выбирает ядро. */
  readonly stanceFocusId: string | null;
}

/** Титул державы (шаг 89) для экрана. */
export interface RealmTitleInfo {
  readonly id: string;
  readonly bonus: TitleBonus;
  /** Следующий титул и сколько миров до него; `null` — вершина. */
  readonly next: { readonly id: string; readonly worlds: number } | null;
}

/** Требование соседа к державе (шаг 89) — для карточки. */
export interface PendingDemand {
  readonly from: string;
  readonly systemId: string;
  readonly system: string;
  readonly day: number;
  /** Дань за декаду — доля дохода мира. */
  readonly perDecade: number;
  readonly decades: number;
  /** Во сколько раз сосед сильнее на общей границе; `Infinity` — у державы там нет армии. */
  readonly ratio: number;
  readonly standing: number;
}

/** Великий полк для найма державой (шаг 89): состав, цена найма и, если нанят, против кого и до какого дня. */
export interface GreatRegimentOffer {
  readonly id: string;
  readonly name: string;
  /** Герб отряда в атласе `mercenaries` (реестр MRBC, `rivals.json → emblem`); −1 — герба нет. */
  readonly emblem: number;
  readonly mechs: number;
  readonly price: number;
  readonly hire: { readonly against: string; readonly until: number; readonly system: string } | null;
}

/** Приказ армии (проект державы, шаг 3): цена, военный фонд державы и цели по фракциям. */
export interface RealmOffensives {
  /** Весь военный фонд державы — приказ платит из него. */
  readonly fund: number;
  readonly fronts: readonly RealmOffensiveFront[];
}

export interface RealmOffensiveFront {
  readonly factionId: string;
  /** Цена приказа на этом направлении (шаг 90): за каждую машину армии, что пойдёт в бой. */
  readonly cost: number;
  /** Машин армии державы на направлении. */
  readonly mechs: number;
  readonly targets: readonly {
    readonly id: string;
    readonly name: string;
    /** Соотношение сил до боя — то, по которому команда соберёт стороны. */
    readonly odds: number;
    /** Причина отказа словами ядра; `null` — приказ пройдёт. */
    readonly why: string | null;
    /** С какого дня откат кончится; `null` — отката нет. */
    readonly readyDay: number | null;
    /** Сколько машин роты пойдёт с армией (шаг 86, `orderLance`); 0 — рота не в прыжке от цели. */
    readonly lance: number;
  }[];
}

export interface NewCampaignOptions {
  readonly name: string;
  readonly commander: string;
  readonly emblem: number;
  readonly seed: number;
  /** Режим кампании (шаг 74): выбирается при основании и дальше не меняется. По умолчанию `standard`. */
  readonly mode?: CampaignMode;
}

/** Машина звена ДО боя: с чем сравнивать то, что вернулось. */
export interface SortieBefore {
  readonly name: string;
  readonly armor: number;
  readonly structure: number;
  readonly pilot: string | null;
}

/** Что показывает экран разбора между боем и командой `ResolveContract`. */
export interface PendingBattle {
  readonly outcome: BattleOutcome;
  readonly withdrew: boolean;
  /** Контракт, по которому вышли: после `ResolveContract` его в состоянии уже нет. */
  readonly contract: Contract;
  /** Опыт пилотов до разбора — чтобы показать прирост, а не абсолютные числа. */
  readonly xpBefore: ReadonlyMap<string, number>;
  /**
   * Состояние звена до вылета.
   *
   * Снимается в момент `Deploy`, а не выводится потом: после боя записи уже
   * изменены, и «сколько брони потеряно» иначе не с чем сравнивать. В
   * сохранение это не попадает и попадать не должно — незаконченный бой
   * кампания не хранит вовсе.
   */
  readonly before: ReadonlyMap<string, SortieBefore>;
  /** Ошиблась ли разведка в этом вылете (шаг 61): после разбора сортие в состоянии уже нет. */
  readonly intelSurprise: IntelSurprise | null;
  /** Бой рассчитан штабом, а не отыгран (шаг 69): такой боевых достижений не даёт. */
  readonly auto: boolean;
}

/** Итог закрытого контракта: то, что действительно произошло, событиями ядра. */
export interface ResolvedReport {
  readonly result: 'won' | 'withdrawn' | 'lost';
  readonly settlement: number;
  readonly salvagePoints: number;
  readonly salvageAvailable: number;
  readonly trophies: readonly string[];
  readonly lost: readonly string[];
  readonly admitted: readonly { readonly pilot: string; readonly days: number }[];
  readonly lostPilots: readonly string[];
  readonly xpGain: readonly { readonly pilot: string; readonly xp: number }[];
  /** Навыки, выросшие сами после разбора. `skill` — ключ названия (`skill.gunnery`). */
  readonly levelUps: readonly { readonly pilot: string; readonly skill: string; readonly level: number }[];
  /** То же, что в `PendingBattle`: строка разбора живёт и после закрытия контракта. */
  readonly intelSurprise: IntelSurprise | null;
  /** Достижения, открытые этим расчётом (шаг 69), id в порядке открытия. */
  readonly achievements: readonly string[];
}

/**
 * Название соперника для строки сводки войны: отряд реестра MRBC называется по-своему на каждом языке
 * (`ui/i18n/names.ts`), вольный — как записан. Отряд ищется по id в списке соперников; распущенного там
 * уже может не быть — тогда остаётся записанное имя.
 */
function rivalLabel(state: CampaignState, rivalId: string, name: string): string {
  return mercName(state.rivals.list.find((r) => r.id === rivalId)?.unitId ?? '', name);
}

/** Карточка события мира для экрана (шаг 84). */
export interface PendingWorldEvent {
  readonly id: string;
  readonly day: number;
  readonly realm: boolean;
  /** Путь к картинке из `data/events.json`; нет — на карточке пустое место под неё. */
  readonly image?: string;
  /** Приглашение державы в коалицию: против кого, союзники и что даёт ответ. */
  readonly invite: {
    readonly against: string;
    readonly allies: readonly string[];
    readonly accept: number;
    readonly decline: number;
  } | null;
}

/** Дождаться, пока браузер нарисует кадр: два `requestAnimationFrame` — изменение уже на экране. Без браузера — сразу. */
function nextPaint(): Promise<void> {
  if (typeof requestAnimationFrame !== 'function') return Promise.resolve();
  return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

class CampaignUi {
  private readonly storage: Storage;

  constructor(storage: Storage = new IndexedDbStorage()) {
    this.storage = storage;
  }

  // --- то, что принадлежит показу -------------------------------------------
  mode = $state<Mode>('menu');
  private screenState = $state<Screen>('hangar');
  /** Открытый экран кампании. Уход роты в державу запоминается — см. `setScope`. */
  get screen(): Screen {
    return this.screenState;
  }
  set screen(next: Screen) {
    if (next === 'realm' && this.screenState !== 'realm' && this.scope === 'company') this.companyReturn = this.screenState;
    this.screenState = next;
  }
  /** Вкладка экрана державы: шапка выбирает её, экран показывает. */
  realmTab = $state<RealmTab>('hq');
  realmPick = $state<RealmPick>(null);
  /**
   * Чьи сейчас карта и война: они нужны и роте, и державе, поэтому для них режим шапки
   * запоминается — по тому, из какого набора вкладок их открыли.
   */
  private sharedScope = $state<Scope>('company');
  /** Куда вернуть роту из державы: последний её экран, а не всегда ангар. */
  private companyReturn = $state<Screen>('hangar');
  crt = $state(false);
  logs = $state<LogLine[]>([]);
  /** Журнал репутации: почему изменилось отношение (шаг 20). Отдельно от бегущего журнала. */
  repLog = $state<RepLine[]>([]);
  /** Сводка войны: как двигался фронт (шаг 21b). Тоже из событий, а не из состояния. */
  warLog = $state<WarLine[]>([]);
  /** Последний отказ команды: показывается подсказкой у кнопки, а не молча глотается. */
  lastReject = $state<CampaignRejectReason | null>(null);
  notice = $state<string | null>(null);

  selectedMechId = $state<string | null>(null);
  /** Сколько дней прокручивает кнопка шапки прямо сейчас; `null` — прокрутки нет. Только показ. */
  advancing = $state<number | null>(null);
  /** Чьи машины показывает список ангара: `null` — корабль, иначе мир гарнизона. Только показ. */
  hangarPlace = $state<string | null>(null);
  selectedZone = $state<ZoneId>('torso');
  selectedContractId = $state<string | null>(null);
  selectedSystemId = $state<string | null>(null);
  selectedPartId = $state<string | null>(null);
  selectedPilotId = $state<string | null>(null);

  /** Есть ли сохранение в браузере — знает главное меню. */
  hasSave = $state(false);
  saving = $state(false);
  /** Идёт авторасчёт боя: поток занят, экран показывает подпись. */
  resolving = $state(false);
  /** Хранилище отказало (приватное окно, кончилась квота). Игрок обязан это увидеть. */
  storageFailed = $state(false);

  // --- то, что принадлежит кампании -----------------------------------------
  // Версия бумкается после каждой команды: `CampaignState` не реактивен, и это
  // единственный честный способ сказать интерфейсу «перечитай».
  private version = $state(0);
  private campaign: CampaignState | null = null;

  /** Бой отыгран, контракт ещё не закрыт: между ними стоит экран разбора. */
  private pending = $state<PendingBattle | null>(null);
  /** Что получилось, когда контракт закрыли. Вторая половина экрана разбора. */
  private report = $state<ResolvedReport | null>(null);
  /** Что игрок отметил к вывозу. Пустое множество — законный выбор «ничего». */
  salvagePicked = $state<Set<string>>(new Set());
  /**
   * Трофеи, помеченные к РАЗБОРУ НА ПОЛЕ (шаг 34).
   *
   * Отдельное множество, а не флаг внутри `salvagePicked`: забрать целиком и
   * разобрать — два разных решения об одной машине, и одна не может быть
   * помечена обоими сразу (команда такое отклоняет).
   */
  salvageScrapped = $state<Set<string>>(new Set());
  /** Звено на момент вылета: снимается `Deploy`, читается разбором. */
  private sortieBefore = new Map<string, SortieBefore>();

  // --- жизненный цикл --------------------------------------------------------

  get state(): CampaignState {
    // Подписка на версию обязательна, как и у остальных геттеров: сам объект
    // состояния не реактивен, команды меняют его на месте. Без этой строки
    // `$derived(campaign.state.systemId)` считался один раз и не обновлялся —
    // после прилёта звёздная карта продолжала считать местом стоянки прежнюю
    // систему и писала «Пути прыжками сюда нет» вместо кнопки разведки, пока
    // экран не пересобирали переходом на соседнюю вкладку (2026-09-16).
    void this.version;
    const c = this.campaign;
    if (c === null) throw new Error('Кампания не начата');
    return c;
  }

  get started(): boolean {
    void this.version;
    return this.campaign !== null;
  }

  /** Проверить хранилище на старте: есть ли что продолжать. */
  async probe(): Promise<void> {
    try {
      this.hasSave = (await this.storage.load(SLOT)) !== null;
    } catch {
      this.hasSave = false;
      this.storageFailed = true;
    }
  }

  newCampaign(opts: NewCampaignOptions): void {
    const seed = opts.seed >>> 0;
    // Пустой позывной ядро заменит на `names.json → defaults.commander` — и у
    // роты (`makeCompany`), и у пилота-командира: имя собственное, в сохранение
    // уходит не на языке интерфейса.
    const commander = opts.commander.trim();
    const founded = foundingInit(seed, { commander });
    this.campaign = new CampaignState(seed, {
      companyName: opts.name.trim() || t('company.unnamed'),
      mode: opts.mode ?? 'standard',
      company: {
        ...founded,
        emblem: clampEmblem(opts.emblem),
        commander,
      },
    });
    this.logs = [];
    this.repLog = [];
    this.warLog = [];
    this.pending = null;
    this.report = null;
    this.selectedMechId = this.campaign.company.mechs[0]?.id ?? null;
    this.selectedContractId = null;
    this.mode = 'campaign';
    this.screen = 'hangar';
    this.realmTab = 'hq';
    this.realmPick = null;
    this.sharedScope = 'company';
    this.companyReturn = 'hangar';
    this.version++;
    void this.save();
  }

  /** Продолжить кампанию из хранилища браузера. */
  async continueCampaign(): Promise<boolean> {
    try {
      const bytes = await this.storage.load(SLOT);
      if (bytes === null) return false;
      const restored = restore(parseSaveFile(JSON.parse(new TextDecoder().decode(bytes))));
      this.adopt(restored);
      const cached = await loadCachedLogs(this.storage, restored.seed, restored.day, restored.companyName);
      if (cached !== null) {
        this.logs = cached.logs;
        this.warLog = cached.warLog;
        this.repLog = cached.repLog;
        this.version++;
      }
      return true;
    } catch (err) {
      this.notice = err instanceof IncompatibleSaveError ? t('app.menu.incompatible') : t('save.badFile');
      return false;
    }
  }

  private adopt(state: CampaignState): void {
    this.campaign = state;
    this.logs = [];
    this.repLog = [];
    this.warLog = [];
    this.pending = null;
    this.report = null;
    this.selectedMechId = state.company.mechs[0]?.id ?? null;
    this.selectedContractId = null;
    this.mode = 'campaign';
    this.screen = 'hangar';
    this.realmTab = 'hq';
    this.realmPick = null;
    this.sharedScope = 'company';
    this.companyReturn = 'hangar';
    this.version++;
  }

  toMenu(): void {
    this.mode = 'menu';
  }

  openSandbox(): void {
    this.mode = 'sandbox';
  }

  /** Откуда открыли настройки (меню или кампания): туда же из них и возвращаются. */
  private settingsReturn: Mode = 'menu';

  openSettings(): void {
    if (this.mode !== 'settings') this.settingsReturn = this.mode;
    this.mode = 'settings';
  }

  closeSettings(): void {
    this.mode = this.settingsReturn;
  }

  /**
   * Режим шапки — рота или держава. Выводится из открытого экрана, а не хранится рядом с
   * ним: экран меняют и кнопки внутри экранов (разбор → ангар, карта → держава), и режим
   * обязан идти следом. Без мира державы режим всегда — рота.
   */
  get scope(): Scope {
    if (!this.hasRealm) return 'company';
    if (this.screen === 'realm') return 'realm';
    if (isSharedScreen(this.screen)) return this.sharedScope;
    return 'company';
  }

  /**
   * Переключить режим шапки. На карте и войне экран остаётся, меняется набор вкладок вокруг.
   * Иначе держава открывается на последней своей вкладке, рота — на последнем своём экране;
   * бой, разбор и создание роты к тому времени могли закрыться, поэтому вместо них — ангар.
   */
  setScope(scope: Scope): void {
    if (scope === this.scope) return;
    if (isSharedScreen(this.screen)) {
      this.sharedScope = scope;
      return;
    }
    if (scope === 'realm') {
      this.screen = 'realm';
      return;
    }
    const back = this.companyReturn;
    if (isSharedScreen(back)) {
      this.openShared(back, 'company');
    } else {
      this.screen = back === 'battle' || back === 'debrief' || back === 'setup' ? 'hangar' : back;
    }
  }

  /** Открыть карту или войну из вкладок роты или державы. */
  openShared(screen: SharedScreen, scope: Scope): void {
    this.sharedScope = scope;
    this.screen = screen;
  }

  setRealmTab(tab: RealmTab): void {
    this.realmTab = tab;
    this.screen = 'realm';
  }

  /** Открыть вкладку державы на выбранном: мир во «Мирах», сектор или сосед на карте Штаба. */
  openRealm(tab: RealmTab, pick: RealmPick): void {
    this.realmPick = pick;
    this.setRealmTab(tab);
  }

  // --- команды ----------------------------------------------------------------

  /**
   * Исполнить команду кампании. ЕДИНСТВЕННЫЙ способ что-либо изменить.
   *
   * Возвращает `true`, если ядро команду приняло. Отказ не бросает исключение и
   * не молчит: причина ложится в `lastReject`, и экран показывает её словами.
   */
  /**
   * Прокрутка кнопкой шапки (2026-10-04). Расчёт мира с державой идёт заметное время и держит поток, поэтому
   * кнопка сперва помечается занятой, браузеру даётся нарисовать это, и только потом считается; повторные нажатия
   * во время расчёта отбрасываются — без этого игрок жал ещё раз, думая, что клик не прошёл.
   */
  async advanceDays(days: number): Promise<void> {
    if (this.advancing !== null) return;
    this.advancing = days;
    try {
      await nextPaint();
      this.run({ kind: 'advance', days });
    } finally {
      this.advancing = null;
    }
  }

  run(command: CampaignCommand): boolean {
    const state = this.state;
    const result = execute(state, command);
    if (!result.ok) {
      this.lastReject = result.reason;
      return false;
    }
    this.lastReject = null;
    const added: LogLine[] = [];
    for (const e of result.events) {
      const line = lineOf(state, e);
      if (line !== null) added.push(line);
    }
    if (added.length > 0) this.logs = [...added.reverse(), ...this.logs].slice(0, LOG_LIMIT);
    this.noteReputation(state, result.events);
    this.noteWar(state, result.events);
    this.version++;
    void this.save();
    return true;
  }

  /**
   * Собрать журнал репутации из событий (шаг 20).
   *
   * Зовётся ОБОИМИ путями исполнения команд — и общим `run`, и закрытием
   * контракта (`resolve`), у которого свой обход событий ради отчёта разбора.
   * Один сборщик на два пути намеренно: два одинаковых цикла разошлись бы, и
   * разошлись бы молча — журнал просто оказался бы пустым ровно там, где
   * репутация и меняется.
   */
  private noteReputation(state: CampaignState, events: readonly CampaignEvent[]): void {
    const rep: RepLine[] = [];
    for (const e of events) {
      if (e.kind !== 'reputationChanged') continue;
      rep.push({
        day: state.day,
        factionId: e.factionId,
        delta: e.delta,
        after: e.after,
        reason: e.reason,
        source: e.source,
      });
    }
    // Порядок ВНУТРИ пачки сохраняется, новее — выше пачками: у одного
    // контракта прямые стороны идут первыми, и переворачивать их значило бы
    // прятать нанимателя под отголосками сети.
    if (rep.length > 0) this.repLog = [...rep, ...this.repLog].slice(0, REP_LOG_LIMIT);
  }

  /**
   * Собрать сводку войны из событий (шаг 21b).
   *
   * Зовётся обоими путями исполнения команд — общим `run` и закрытием контракта
   * — по той же причине, что и сборщик журнала репутации: вклад роты в войну
   * приходит именно с закрытием контракта, и один из двух путей остался бы без
   * него молча.
   */
  /**
   * Перелёт полка — в сводку, только если он касается роты (шаг 82): полк уходит из её
   * сектора или приходит в него (`spawnJumps` прыжков — тот же сектор, что у соперников),
   * либо новый наниматель воюет с державой роты или связан с ней договором. Семь полков
   * переходят раз в десяток декад каждый, и без отбора лента тонула бы в чужих перелётах.
   */
  private regimentMoveMatters(state: CampaignState, from: string, to: string, employer: string): boolean {
    if (playerWarOf(state.war, employer) !== undefined) return true;
    const pact = pactOf(state.war, PLAYER_ACTOR_ID, employer);
    if (pact !== undefined && pact.untilDay > state.day) return true;
    const sector = new Set(spawnCandidates(state.systemId, RIVALS.spawnJumps).map((i) => GALAXY.id(i)));
    return sector.has(from) || sector.has(to);
  }

  private noteWar(state: CampaignState, events: readonly CampaignEvent[]): void {
    const lines: WarLine[] = [];
    // Дата берётся у ЗАДАЧИ, а не у состояния: одна прокрутка «+30 суток»
    // исполняет три такта фронта, и `state.day` к моменту сборки сводки уже
    // равен последнему дню отрезка. Без этого вся война за месяц ложилась в
    // сводку одним днём — видно на первом же скриншоте экрана.
    let day = state.day;
    // Захват такта, у которого есть бой с державой (шаг 78), идёт в сводку строкой боя, а не второй
    // строкой «смена флага»: у боя те же стороны и мир, плюс исход и потери.
    const clashed = new Set<string>();
    for (const e of events) {
      if (e.kind === 'frontClash') clashed.add(`${e.systemId}|${e.attacker}|${e.defender}`);
    }
    for (const e of events) {
      if (e.kind === 'taskDue') day = e.day;
      if (e.kind === 'frontClash') {
        lines.push({
          day,
          kind: 'clash',
          systemId: e.systemId,
          attacker: e.attacker,
          defender: e.defender,
          ruined: e.ruined ?? 0,
          clash: {
            outcome: e.outcome,
            attackerSize: e.attackerSize,
            defenderSize: e.defenderSize,
            attackerLost: e.attackerLost,
            defenderLost: e.defenderLost,
            lostWorld: e.defender === PLAYER_ACTOR_ID && e.outcome !== 'repelled',
            ...(e.company === undefined
              ? {}
              : {
                  company: {
                    mechs: e.company.mechs,
                    detachment: e.company.detachment,
                    knocked: e.company.knocked,
                    lost: e.company.lostRecordIds.length,
                  },
                }),
            ...(e.garrison === undefined
              ? {}
              : {
                  garrison: {
                    mechs: e.garrison.mechs,
                    detachment: e.garrison.detachment,
                    knocked: e.garrison.knocked,
                    lost: e.garrison.lostRecordIds.length,
                    withdrew: e.garrison.withdrew,
                  },
                }),
          },
        });
      } else if (e.kind === 'realmFrontTally') {
        lines.push({
          day,
          kind: 'realmLoss',
          systemId: '',
          attacker: PLAYER_ACTOR_ID,
          defender: PLAYER_ACTOR_ID,
          ruined: 0,
          size: e.battles,
          lost: Math.max(0, e.armyBefore - e.armyAfter),
          army: e.armyAfter,
        });
      } else if (e.kind === 'peaceMade' || e.kind === 'warEnded') {
        // Конец войны державы (шаг 79) — одной строкой, чем бы он ни был: мир командой или то, что
        // войну кончило в такте (договор, подчинение, падение державы, потеря границы).
        const ceded = e.kind === 'peaceMade' ? e.ceded : undefined;
        lines.push({
          day,
          kind: 'warEnded',
          systemId: ceded ?? '',
          attacker: PLAYER_ACTOR_ID,
          defender: e.factionId,
          ruined: 0,
          ended:
            e.kind === 'warEnded'
              ? e.how
              : e.yielded !== undefined
                ? 'yielded'
                : e.forced !== undefined
                ? 'forced'
                : ceded !== undefined
                  ? 'ceded'
                  : e.cost > 0
                    ? 'paid'
                    : e.gained !== undefined || e.tributaries !== undefined || e.humiliated !== undefined
                      ? 'goal'
                      : 'free',
        });
      } else if (e.kind === 'diplomacyMoved' && (e.move === 'coalition' || (e.move === 'pact' && e.pact !== undefined))) {
        // Договоры и коалиции Сферы (шаг 83) — строки дипломатии: ради них ИИ и перестал знать одни
        // перемирия. Договор роты помечается «держава» общим правилом ниже, как любая её строка.
        lines.push({
          day,
          kind: e.move,
          systemId: '',
          attacker: e.over,
          defender: e.under,
          ruined: 0,
          ...(e.pact === undefined ? {} : { pact: e.pact }),
          ...(e.against === undefined ? {} : { against: e.against }),
        });
      } else if (e.kind === 'diplomacyMoved' && e.move === 'war' && (e.over === PLAYER_ACTOR_ID || e.under === PLAYER_ACTOR_ID)) {
        // Война державы объявлена (после шага 93): строкой сводки, чтобы «Бои державы» и поворот с картинкой её видели.
        lines.push({ day, kind: 'warDeclared', systemId: '', attacker: e.over, defender: e.under, ruined: 0 });
      } else if (e.kind === 'realmPolicy') {
        // Команда политики державы (шаг 88): кто отдал — губернатор (позывной и центр) или стойка против врага.
        const a = e.act;
        lines.push({
          day,
          kind: 'policy',
          systemId: a.kind === 'peace' ? '' : a.systemId,
          attacker: PLAYER_ACTOR_ID,
          defender: e.by.kind === 'stance' ? e.by.factionId : '',
          ruined: 0,
          ...(e.by.kind === 'governor' ? { who: nameOfPilot(state, e.by.pilotId) } : {}),
          policy: {
            by: e.by.kind,
            act: a.kind,
            ...(e.by.kind === 'governor' ? { center: e.by.centerId } : {}),
            ...(a.kind === 'build' ? { building: a.building } : {}),
            ...(a.kind === 'focus' ? { focus: a.focus } : {}),
          },
        });
      } else if (e.kind === 'worldEvent') {
        // Веха эпохи (шаг 84) — строкой в сводке; метка «держава», если событие её касается.
        lines.push({
          day,
          kind: 'event',
          systemId: '',
          attacker: '',
          defender: '',
          ruined: 0,
          eventId: e.id,
          ...(e.realm ? { realm: true as const } : {}),
        });
      } else if (e.kind === 'worldRevolt' || e.kind === 'worldSeceded') {
        // Восстание и отпадение мира роты (шаг 85): нападает ополчение прежнего владельца.
        lines.push({
          day,
          kind: e.kind === 'worldRevolt' ? 'revolt' : 'seceded',
          systemId: e.systemId,
          attacker: e.kind === 'worldRevolt' ? e.formerOwner : e.to,
          defender: PLAYER_ACTOR_ID,
          ruined: 0,
        });
      } else if (e.kind === 'worldRevoltSuppressed' || (e.kind === 'garrisonRevoltBattle' && e.won)) {
        // Восстание подавлено — работой роты или гарнизоном в такте (шаг 86b): строка та же.
        lines.push({
          day,
          kind: 'revolt',
          systemId: e.systemId,
          attacker: state.deltas[e.systemId]?.formerOwner ?? '',
          defender: PLAYER_ACTOR_ID,
          ruined: 0,
          detail: 'won',
        });
      } else if (e.kind === 'frontMoved' && clashed.has(`${e.systemId}|${e.attacker}|${e.defender}`)) {
        continue;
      } else if (e.kind === 'frontMoved') {
        lines.push({
          day,
          kind: e.kindOfMove,
          systemId: e.systemId,
          attacker: e.attacker,
          defender: e.defender,
          ruined: e.ruined,
        });
      } else if (e.kind === 'warPlan') {
        // Объявленное наступление идёт в сводку ВСЕГДА, где бы оно ни началось,
        // — в отличие от гарнизонной работы соперника за три прыжка. Это и есть
        // половина ответа на «где искать войну»: до замысла фракция давила всюду
        // понемногу, и лететь было некуда конкретно.
        lines.push({
          day,
          kind: e.result === 'declared' ? 'planDeclared' : e.result === 'done' ? 'planDone' : 'planSpent',
          systemId: e.systemId,
          attacker: e.factionId,
          defender: e.against,
          ruined: 0,
        });
      } else if (e.kind === 'warEffort') {
        lines.push({
          day,
          kind: 'effort',
          systemId: state.systemId,
          attacker: e.employer,
          defender: e.target,
          ruined: 0,
        });
      } else if (e.kind === 'rivalContract' && e.systemId === state.systemId) {
        // В сводку идёт только работа, взятая ТАМ, ГДЕ СТОИТ РОТА, — и это
        // редакторское решение, а не экономия строк. Соперников восемь, такт
        // декадный, и без отбора экран получал бы по восемь строк «где-то в
        // секторе кто-то отработал контракт» на каждую смену флага: настоящая
        // война тонула бы в них с первого же месяца (видно на первом
        // скриншоте). Чем заняты дальние отряды, показывает таблица рейтинга —
        // там это столбец, а не лента.
        lines.push({
          day,
          kind: 'rivalHere',
          systemId: e.systemId,
          attacker: e.employer,
          defender: e.target,
          ruined: 0,
          who: rivalLabel(state, e.rivalId, e.rivalName),
        });
      } else if (e.kind === 'regimentCommission') {
        // Полковой подряд идёт в сводку ВСЕГДА, где бы он ни случился, — в
        // отличие от гарнизонной работы ротного отряда за три прыжка. Полковая
        // операция редка (раз в четыре декады на полк) и крупна: это новость про
        // войну, а не про чужие заботы.
        lines.push({
          day,
          kind: 'commission',
          systemId: e.systemId,
          attacker: e.employer,
          defender: e.target,
          ruined: 0,
          who: mercName(e.regimentId, e.regimentName),
          detail: e.won ? 'won' : 'lost',
          size: e.size,
          lost: e.lost,
        });
      } else if (e.kind === 'regimentMoved' && this.regimentMoveMatters(state, e.from, e.to, e.employer)) {
        lines.push({
          day,
          kind: 'regimentMoved',
          systemId: e.to,
          attacker: e.employer,
          defender: '',
          ruined: 0,
          who: mercName(e.regimentId, e.regimentName),
        });
      } else if (e.kind === 'rivalGone') {
        // Два разных события, а не одно с подстановкой: канонический отряд
        // ВОЗВРАЩАЕТСЯ под своим именем (из реестра MRBC не выбывают), а
        // безымянный распускается насовсем. «На их место пришли «Всегда
        // Верные»» вместо «Всегда Верных» читалось бы как поломка, а пустые
        // кавычки — как она и есть.
        lines.push({
          day,
          kind: e.replacedById === '' ? 'rivalGone' : 'rivalBack',
          systemId: e.systemId,
          attacker: rivalLabel(state, e.replacedById, e.replacedByName),
          defender: rivalLabel(state, e.rivalId, e.rivalName),
          ruined: 0,
          who: rivalLabel(state, e.rivalId, e.rivalName),
        });
      }
    }
    if (lines.length === 0) return;
    // Метка «держава» (шаг 78) — у каждой строки, где рота одна из сторон: захваты, дань, бои,
    // замыслы против неё. Считается здесь один раз, а не на экране при каждой отрисовке.
    const marked = lines.map((l): WarLine =>
      l.attacker === PLAYER_ACTOR_ID || l.defender === PLAYER_ACTOR_ID ? { ...l, realm: true } : l,
    );
    // Новые сверху, как журнал роты (`added.reverse()`): пачка прокрутки идёт по дням вперёд, и без разворота внутри
    // «+30 д» строки стояли по возрастанию даты, а «Бои державы» (первые 10) показывали начало месяца (отладка 2026-10-03).
    this.warLog = [...marked.reverse(), ...this.warLog].slice(0, WAR_LOG_LIMIT);
  }

  /**
   * Можно ли исполнить команду — без её исполнения.
   *
   * Прямая передача в `canExecute`: экран спрашивает ядро, а не считает сам.
   */
  can(command: CampaignCommand): boolean {
    void this.version;
    if (this.campaign === null) return false;
    return canExecute(this.campaign, command) === null;
  }

  /** Причина отказа словами — подсказка у выключенной кнопки. */
  /**
   * СМЕТА ПАКЕТНОГО РЕМОНТА (шаг 39): что стоит привести звено в паспорт.
   *
   * **Боль, ради которой шаг делается.** После боя 3–4 машины возвращаются с
   * мелкими повреждениями на разных зонах. Чтобы восстановить боеспособность,
   * игрок открывает карточку машины, жмёт «Латать зону» на голове, на торсе, на
   * полуторсе, на руке, на ноге — и повторяет для следующей машины. На звено из
   * четырёх машин выходит от десяти до двадцати одинаковых кликов после каждого
   * вылета.
   *
   * **Ограничение, которое нельзя нарушать.** Оторванные конечности
   * (`structure <= 0`, требующие `replacePart` с шансом провала и понижением
   * класса каркаса) эта смета не трогает НИКОГДА. Оторванный узел — отдельное
   * взвешенное решение игрока, и превращать его в побочный эффект пакетной
   * кнопки нельзя. Считаются они отдельной строкой, чтобы кнопка могла честно
   * сказать: «а вот здесь я не помогу».
   *
   * `recordIds` не задан — смета на весь парк; задан — только на эти машины (ангар
   * передаёт показанный список: корабль или один мир гарнизона).
   */
  repairAllPlan(recordIds?: readonly string[]): {
    readonly cost: number;
    readonly days: number;
    readonly zones: readonly { recordId: string; zone: ZoneId }[];
    readonly tornLimbs: number;
  } {
    void this.version;
    const company = this.state.company;
    const only = recordIds === undefined ? null : new Set(recordIds);
    const zones: { recordId: string; zone: ZoneId }[] = [];
    let cost = 0;
    let days = 0;
    let tornLimbs = 0;

    for (const mech of company.mechs) {
      if (only !== null && !only.has(mech.id)) continue;
      for (const zone of ZONE_IDS) {
        const idx = zoneFromId(zone);
        // Признак оторванной зоны — ФЛАГ `destroyed`: его читает и карточка зоны
        // в ангаре, и `repairPlan` в ядре, и второго признака «зоны нет» в игре
        // не заводится. Проверка здесь не лишняя, хотя `zoneRepairPlan` для
        // такой зоны и так вернёт ноль работ: пакет обязан не просто пропустить
        // оторванное, но и СОСЧИТАТЬ его — иначе кнопке нечем предупредить, что
        // часть повреждений она не закроет.
        if (mech.condition.zones[idx]?.destroyed === true) {
          tornLimbs += 1;
          continue;
        }
        const inQueue = this.state.queue.some(
          (e) =>
            e.task.kind === 'repairJob' &&
            e.task.recordId === mech.id &&
            (e.task.work === 'repairZone' || e.task.work === 'replacePart') &&
            e.task.zone === zone,
        );
        if (inQueue) continue;
        const plan = zoneRepairPlan(mech, zone);
        if (plan.jobCount === 0) continue;
        zones.push({ recordId: mech.id, zone });
        // Цена там, где работа встанет (шаг 87): цех мира дешевле и быстрее.
        const quote = this.jobQuote(mech.id, 'repairZone', plan.cost, plan.days);
        cost += quote.cost;
        // Дни берутся МАКСИМУМОМ, а не складываются. Раньше здесь была сумма с
        // объяснением «цех один, наряды идут очередью», но очереди внутри цеха
        // нет: `scheduleJob` ставит каждую работу в очередь суток на свой
        // собственный день готовности, и все они идут разом. Три ремонта зоны
        // по дню — это завтра, а не через три дня, и сумма врала игроку ровно
        // так же, как полоса стапелей, рисовавшая одну машину на трёх ячейках
        // (плейтест 2026-09-16). Пропускную способность цеха ограничивает не
        // срок, а число стапелей — машин в работе одновременно.
        days = Math.max(days, quote.days);
      }
    }
    return { cost, days: Math.round(days * 2) / 2, zones, tornLimbs };
  }

  /**
   * Поставить наряды на все повреждённые уцелевшие зоны.
   *
   * **N команд `repairZone`, а не одна команда «почини всё».** Правило 2
   * `game_core.md` («состояние меняется только командами») здесь соблюдается
   * буквально: экран ставит те же наряды, которые игрок поставил бы руками, и
   * ядро о существовании кнопки не знает вовсе. Ни одного нового правила
   * ремонта пакетная кнопка не заводит.
   *
   * Идёт, ПОКА ХВАТАЕТ ДЕНЕГ, и не откатывается: наряд, который уже приняли, —
   * это работа, начатая в цеху. Возвращает, сколько зон удалось поставить.
   */
  repairAll(recordIds?: readonly string[]): number {
    const plan = this.repairAllPlan(recordIds);
    let done = 0;
    for (const { recordId: id, zone } of plan.zones) {
      if (!this.run({ kind: 'repairZone', recordId: id, zone })) break;
      done += 1;
    }
    return done;
  }

  why(command: CampaignCommand): string | null {
    void this.version;
    if (this.campaign === null) return null;
    const reason = canExecute(this.campaign, command);
    return reason === null ? null : t(`reject.${reason}`);
  }

  get rejectText(): string | null {
    return this.lastReject === null ? null : t(`reject.${this.lastReject}`);
  }

  // --- чтение состояния --------------------------------------------------------

  get day(): number {
    void this.version;
    return this.state.day;
  }

  get date(): string {
    void this.version;
    return formatDate(dateOf(this.state.day));
  }

  /** Дата произвольных суток — для сроков доставки и работ, которых на экране ещё нет. */
  dateText(day: number): string {
    return formatDate(dateOf(day));
  }

  get companyName(): string {
    void this.version;
    return this.state.companyName;
  }

  get commander(): string {
    void this.version;
    return this.state.company.commander;
  }

  get emblem(): number {
    void this.version;
    return this.state.company.emblem;
  }

  get cbills(): number {
    void this.version;
    return this.state.company.cbills;
  }

  get upkeep(): number {
    void this.version;
    return payrollAmount(this.state.company);
  }

  /**
   * Рота в минусе СЕЙЧАС (`isInsolvent`), а не «хоть раз уходила в минус»:
   * исторический флаг `company.bankrupt` не снимается, и надпись по нему висела
   * при любой кассе (плейтест 2026-09-15).
   */
  get bankrupt(): boolean {
    void this.version;
    return isInsolvent(this.state.company);
  }

  get mechs(): readonly MechRecord[] {
    void this.version;
    return this.state.company.mechs;
  }

  get pilots(): readonly Pilot[] {
    void this.version;
    return this.state.company.pilots;
  }

  get bays(): number {
    void this.version;
    return this.state.company.bays;
  }

  /**
   * Полоса стапелей ангара: ячейка — МАШИНА в работе, а не отдельный наряд.
   * Разбор и причина — `state/bays.ts`, там же живёт тест на это правило.
   */
  get bayStands(): readonly (BayStand | null)[] {
    void this.version;
    return bayStands(this.state);
  }

  get selectedMech(): MechRecord | null {
    void this.version;
    if (this.selectedMechId === null) return null;
    return this.state.company.mechs.find((m) => m.id === this.selectedMechId) ?? null;
  }

  pilotOf(record: MechRecord): Pilot | null {
    void this.version;
    if (record.pilotId === null) return null;
    return this.state.company.pilots.find((p) => p.id === record.pilotId) ?? null;
  }

  /**
   * Незавершённая работа цеха по машине — ЧЕРЕЗ СТОР, а не свободной функцией.
   *
   * Свободный `jobOf(campaign.state, id)` в `$derived` читает `state.queue`,
   * который не реактивен, и потому пересчитывается только когда меняется
   * ЗАПИСЬ МАШИНЫ. Работе это ничем не обязано: полевая замена, которая не
   * удалась, возвращает ту же самую запись (`jobs.ts::attemptReplacePart`), и
   * карточка «работа идёт» висела до перехода на другую вкладку. Здесь
   * читается `version`, и очередь перечитывается после любой команды.
   */
  jobOf(recordId: string): ReturnType<typeof jobOf> {
    void this.version;
    return jobOf(this.state, recordId);
  }

  /**
   * Переоснащение, которое машина сейчас проходит на стапеле: сборка, за которую
   * заплачено, и день готовности. Сборка лежит в задаче целиком (`clock.ts`).
   *
   * Мехлаб показывает её вместо текущей. Без этого после «Поставить в цех»
   * черновик сбрасывался к сборке машины — а она до конца работы прежняя, — и
   * экран выглядел так, будто изменения не применились.
   */
  pendingRefit(recordId: string) {
    void this.version;
    for (const e of this.state.queue) {
      const task = e.task;
      if (task.kind !== 'repairJob' || task.recordId !== recordId || task.work !== 'refitMech') continue;
      if (task.assembly === undefined) continue;
      return { assembly: task.assembly, day: e.day, jobId: task.jobId };
    }
    return null;
  }

  valueOf(record: MechRecord): number {
    return mechValue(record);
  }

  zoneRepair(record: MechRecord, zone: ZoneId): { cost: number; days: number; jobCount: number } {
    return zoneRepairPlan(record, zone);
  }

  get system(): ReturnType<typeof systemKnowledge> {
    void this.version;
    const state = this.state;
    return systemKnowledge(
      state.worldSeed,
      state.systemId,
      isSurveyed(state.deltas, state.systemId),
      state.deltas[state.systemId]?.owner,
      developmentOf(state.deltas, state.systemId),
    );
  }

  get travelling(): boolean {
    void this.version;
    return this.state.travel !== null;
  }

  /**
   * Куда рота летит. `null` — стоит на месте.
   *
   * Не то же, что `system`: `state.systemId` в пути — это система, ИЗ которой
   * ушла последняя пройденная нога. Показывать её как «где мы» посреди
   * перелёта значит врать игроку ровно в тот момент, когда он ждёт прибытия.
   */
  get destination(): { readonly name: string; readonly daysLeft: number } | null {
    void this.version;
    const travel = this.state.travel;
    if (travel === null) return null;
    const last = travel.path[travel.path.length - 1];
    return {
      name: last === undefined ? '' : nameOfSystem(last),
      daysLeft: Math.max(0, travel.arrivalDay - this.state.day),
    };
  }

  get rating(): ReturnType<typeof companyRating> {
    void this.version;
    return companyRating(this.state.company);
  }

  /**
   * Таблица MRBC (шаг 22): рота игрока и живые соперники по силе.
   *
   * Экран ничего не считает — таблицу собирает ядро (`rivals/rating.ts`), той
   * же формулой, что и силу роты. Экран рейтинга был заведён шагом 17b с одной
   * честной строкой именно ради этой минуты: приклеенная позже вкладка стоила
   * бы перекройки навигации, а сила, посчитанная самим экраном, — спора с этим
   * шагом о том, чья формула правильная.
   */
  get ratingTable(): readonly RatingRow[] {
    void this.version;
    return ratingTable(this.state);
  }

  /** Сколько отрядов-соперников уже разорилось за кампанию. Для подписи под таблицей. */
  get rivalsBankrupt(): number {
    void this.version;
    return this.state.rivals.bankrupt;
  }

  /**
   * Верх реестра MRBC: великие полки Сферы (шаг 22).
   *
   * Не состояние и не соперники — канон, посчитанный ядром той же формулой, что
   * и сила роты (`rivals/registry.ts`). Экран ничего не считает и здесь.
   */
  get mrbcRegistry(): readonly RegistryRow[] {
    return MRBC_REGISTRY;
  }

  /** Соперник по id — для досье в таблице рейтинга. */
  rivalOf(id: string): Rival | undefined {
    void this.version;
    return this.state.rivals.list.find((r) => r.id === id);
  }

  /** Полк по id: у него своё досье — состав в машинах, а не парк роты. */
  regimentOf(id: string): Regiment | undefined {
    void this.version;
    return this.state.rivals.regiments.find((r) => r.id === id);
  }

  // --- контракты ---------------------------------------------------------------

  get contracts(): readonly Contract[] {
    void this.version;
    const state = this.state;
    const delta = state.deltas[state.systemId];
    const taken =
      delta !== undefined && delta.takenDecade === contractDecadeOf(state.day) ? (delta.taken ?? []) : [];
    return availableContracts(
      state.worldSeed,
      state.deltas,
      state.systemId,
      state.day,
      taken,
      state.reputation,
      // Пятый вход биржи (шаг 21a): экономика фракций. Ею снаряжена часть
      // противника, и разорённый Ляо выставляет уже не то же, что богатый Дэвион.
      state.war,
    );
  }

  /**
   * Что биржа НЕ показала и почему (шаг 20).
   *
   * Порог, который молча стирает половину списка, читается игроком как пустая
   * биржа, а не как последствие выбора стороны. Экран обязан сказать: работа
   * здесь есть, но этот наниматель её вам не даст — и назвать, чего не хватает.
   */
  get blocked(): ReturnType<typeof blockedOffers> {
    void this.version;
    const state = this.state;
    return blockedOffers(
      state.worldSeed,
      state.deltas,
      state.systemId,
      state.day,
      state.reputation,
      state.war,
    );
  }

  // --- репутация (шаг 20) -------------------------------------------------------

  /** Три оси разом: отношения по фракциям, известность, надёжность. */
  get reputation(): ReputationState {
    void this.version;
    return this.state.reputation;
  }

  /** Отношение одной фракции к отряду. Экран спрашивает ядро, а не пересчитывает. */
  standingWith(factionId: string): number {
    void this.version;
    return standingOf(this.state.reputation, factionId);
  }

  /** Фракции по отношению, от лучшего к худшему. Список полный — ноль тоже ответ. */
  get standings(): ReturnType<typeof standingList> {
    void this.version;
    return standingList(this.state.reputation);
  }

  // --- экономика фракций (шаг 21a, часть D) -------------------------------------

  /**
   * Достаток фракций — от богатых к бедным, с полосой для показа.
   *
   * Экран не считает ничего: и достаток, и его полоса приходят из ядра
   * (`core/campaign/war/`). Числа казны наружу не отдаются намеренно —
   * см. `prosperityOf` ниже.
   */
  get economies(): readonly {
    id: string;
    prosperity: number;
    band: ReturnType<typeof warBand>;
    worlds: number;
  }[] {
    void this.version;
    const state = this.state;
    return economyList(state.war).map((row) => ({
      id: row.id,
      prosperity: row.prosperity,
      // Полоса — достаток, перекрытый ВОЙНОЙ (шаг 21b): «разорена» означает
      // выжженные миры, а не низ шкалы достатка.
      band: warBand(row.prosperity, ruinShareOf(state.deltas, row.id, row.economy.worlds)),
      worlds: row.economy.worlds,
    }));
  }

  /**
   * Полоса достатка одной фракции — то, что видно без разведки (решение 6,
   * `wiki/decisions.md`).
   *
   * Именно полоса, а не казна: наёмник читает сводки MRBC, а не казначейские
   * книги Дэвиона. Тот же приём, что `garrisonBand` у гарнизона.
   */
  prosperityBandOf(factionId: string): ReturnType<typeof warBand> {
    void this.version;
    const state = this.state;
    return warBand(
      prosperityOf(state.war, factionId),
      ruinShareOf(state.deltas, factionId, economyOf(state.war, factionId).worlds),
    );
  }

  // --- война (шаг 21b, часть D) -------------------------------------------------

  /**
   * Владельцы всех систем на сегодня — одним массивом, для слоя владения на
   * канвасе (шаг 21b).
   *
   * Канвас перебирает две тысячи систем на каждую перерисовку, и спрашивать
   * `ownerOf` для каждой значило бы делать две тысячи поисков по разрежённой
   * карте за кадр протяжки. Массив пересобирается, только когда сдвинулось
   * состояние кампании.
   */
  get owners(): readonly string[] {
    void this.version;
    return ownerArray(this.state.deltas);
  }

  /**
   * Куда фракция стягивает силы: направления военного фонда, от крупного к
   * мелкому.
   *
   * Мера — ТАКТЫ СОБСТВЕННОГО ДОХОДА, а не C-Bills, и это не косметика: казна
   * фракции ни у кого не тратится и растёт линейно всю кампанию, поэтому
   * абсолютное число к третьему году перестаёт что-либо значить. «Соколы
   * отложили против Волков четыре декады дохода» читается и через десять лет.
   */
  /**
   * Объявленные наступления (шаг 23, часть B): кто, против кого и куда.
   *
   * Читается прямо из состояния войны и ничего не считает — как и весь остальной
   * экран войны: сводка приходит из ядра, а показ её не пересчитывает.
   */
  get warPlans(): ReturnType<typeof planList> {
    void this.version;
    return planList(this.state.war);
  }

  warFrontsOf(factionId: string): readonly { against: string; ticks: number }[] {
    void this.version;
    const income = Math.max(1, economyOf(this.state.war, factionId).income);
    return fundsOf(this.state.war, factionId).map((r) => ({
      against: r.against,
      ticks: Math.round((r.amount / income) * 10) / 10,
    }));
  }

  /**
   * Насколько горячо у этой системы и с кем — то, что игрок видит в досье.
   *
   * Полосой и без разведки, тем же приёмом, что достаток владельца: где стоят
   * армии, наёмник знает из сводок MRBC, а не из штабных карт. Пустой список —
   * тыл: соседей-врагов рядом нет, и работа здесь будет полицейской.
   */
  /**
   * Насколько горяча каждая система, 0..1 — слой фронта для звёздной карты
   * (шаг 22d).
   *
   * **Зачем.** Тикер войны сделал фронт местом, куда за работой надо ЛЕТЕТЬ, а
   * найти его на карте было нечем: система красилась только цветом владельца, и
   * напряжённость открывалась лишь щелчком по досье. Две тысячи систем не
   * прокликать — значит, самое важное, что дал шаг 21b, игрок увидеть не мог.
   *
   * **Почему картой, а не числом в списке.** Фронт — это ЛИНИЯ, свойство
   * соседства; его смысл в том, где он проходит, а не в том, сколько его.
   *
   * Считается по `frontSectors` — один проход по каталогу, около миллисекунды, —
   * и пересчитывается вместе с состоянием, а не на каждый кадр отрисовки.
   */
  get heatBySystem(): ReadonlyMap<number, number> {
    void this.version;
    const out = new Map<number, number>();
    const state = this.state;
    for (const sector of frontSectors(state.war, state.reputation, state.deltas, state.day)) {
      // Участок фронта всегда между соседями, поэтому близость единичная —
      // та же, что берёт биржа для соседней звезды (`contracts/board.ts`).
      const heat = tensionOf(state.war, state.reputation, sector.defender, sector.attacker, 1);
      if (heat <= 0) continue;
      const prev = out.get(sector.system) ?? 0;
      if (heat > prev) out.set(sector.system, heat);
    }
    return out;
  }

  /**
   * СЛОЙ МАСШТАБА РАБОТЫ (шаг 44c) — третья карта рядом с фронтовой и пиратской.
   *
   * Отвечает на вопрос «где брать работу крупнее копья»: две тысячи систем не
   * прокликать, а биржа видна только там, где рота стоит. Фронт и вольница
   * получили свои карты по этой же причине — здесь ровно та же болезнь.
   *
   * Ступень выводится теми же двумя числами, что и на бирже: гарнизон мира и
   * напряжённость участка (`board.ts::scaleOutlook`). Значение карты — ДОЛЯ
   * ЛЕСТНИЦЫ, чтобы рисовать одним градиентом: усиленный отряд, рота, батальон.
   * Копьё и патруль в карту не попадают — они есть везде, и подсвечивать их
   * значило бы закрасить всю Сферу.
   */
  get workScaleBySystem(): ReadonlyMap<number, number> {
    void this.version;
    const state = this.state;
    const heat = this.heatBySystem;
    const out = new Map<number, number>();
    const weight: Partial<Record<ScaleId, number>> = { reinforced: 0.45, company: 0.75, battalion: 1 };
    for (let i = 0; i < GALAXY.count; i++) {
      const profile = worldProfile(state.worldSeed, state.deltas, i);
      const ruined = state.deltas[GALAXY.id(i)]?.ruined ?? 0;
      const garrison = profile.garrison * Math.max(0, 1 - Math.min(1, ruined));
      const step = scaleOutlook(garrison, heat.get(i) ?? 0);
      const w = weight[step];
      if (w !== undefined) out.set(i, w);
    }
    return out;
  }

  /**
   * СЛОЙ ПИРАТСКОЙ УГРОЗЫ (шаг 41) — вторая тепловая карта рядом с фронтовой.
   *
   * **Зачем.** Шаг 37 поделил карту на фронт и тыл, и от этого у работы впервые
   * появилось МЕСТО: у горячей границы дерутся регулярные части Домов, в
   * глубоком тылу хозяйничает вольница. Но узнать, где что, было нечем — две
   * тысячи систем не прокликать, а биржа видна только там, где рота стоит.
   * Ровно та же болезнь, которую шаг 22d вылечил для фронта, и лечится она тем
   * же способом.
   *
   * **Ради чего именно эта карта.** После шага 37a биржа мира вправе опустеть
   * целиком, и стартовый Аутрич как раз такой: гарнизон Драгун, столица, фронта
   * рядом нет. Стартовый цикл поэтому стал «снарядился на Аутриче → посмотрел,
   * где очаг → полетел», и без этого слоя второй шаг игроку выполнить нечем.
   *
   * **Считается ТОЙ ЖЕ функцией, что и биржа** (`contracts/pirates.ts`). Карта,
   * которая рисует не то, что считает мир, хуже отсутствия карты: игрок полетит
   * туда, где ему обещали работу, и не найдёт её.
   *
   * Один проход по каталогу на пересчёт состояния, не на кадр отрисовки, — как
   * и фронтовой слой. Фронтовой индекс — ПОШТУЧНО, тем же `frontierIndexAt`, что
   * у биржи (около 20 мс на каталог). Оптовый `frontierField` из фронтовых
   * участков считался тем же числом, но не был им: индексы расходились у 439
   * систем из 2000, и карта обещала тишину там, где биржа выставляла пиратов
   * (нашлось 2026-10-04 с работой новичку).
   */
  get pirateHeatBySystem(): ReadonlyMap<number, number> {
    void this.version;
    const state = this.state;
    const out = new Map<number, number>();
    for (let i = 0; i < GALAXY.count; i++) {
      const id = GALAXY.id(i);
      const profile = worldProfile(state.worldSeed, state.deltas, i);
      const risk = pirateRisk(frontierIndexAt(state.deltas, state.reputation, state.war, i), {
        marketClass: profile.marketClass,
        garrison: profile.garrison,
        ruined: state.deltas[id]?.ruined ?? 0,
        owner: ownerOf(state.deltas, i),
        blackMarket: GALAXY.hasFlag(i, 'blackMarket'),
        cleared: clearedOf(state.deltas, id),
      });
      // Мир самой вольницы — очаг, если за его логово кто-то платит (шаг 72f):
      // та же вероятность, с которой биржа выставляет награду.
      const heat = Math.max(risk, denBounty(state.deltas, i));
      if (heat > 0) out.set(i, heat);
    }
    return out;
  }

  /**
   * СЛОЙ СНАРЯЖЕНИЯ — где выгодно и есть из чего выбирать.
   *
   * Класс и наценка рынка видны всегда, без разведки (`marketProfile`, решение
   * 2026-09-01), но чтобы понять, где ХОРОШО закупаться оружием, игроку
   * приходилось прокликивать досье системы за системой — та же болезнь, которую
   * фронт, вольница и масштаб работы лечат каждый своей картой.
   *
   * С 2026-09-20 узлов на прилавке нет, поэтому класс исполнения слой больше не
   * решает: значение — ширина ассортимента (число позиций лавки) против наценки
   * системы. Столичный прилавок без наценки даёт 1, глушь с двумя позициями и
   * наценкой ×1.6 — 0.16. Ниже `GEAR_HEAT_MIN` мир не подсвечивается: слабое
   * свечение на всех двух тысячах систем не отвечало бы на «сюда лететь или
   * нет».
   */
  get marketHeatBySystem(): ReadonlyMap<number, number> {
    void this.version;
    const state = this.state;
    const out = new Map<number, number>();
    for (let i = 0; i < GALAXY.count; i++) {
      const id = GALAXY.id(i);
      const profile = marketProfile(state.worldSeed, id, 0, developmentOf(state.deltas, id), realmMarketOf(state.deltas, id));
      const heat = Math.min(1, profile.lots / GEAR_HEAT_FULL_LOTS / profile.priceFactor);
      if (heat >= GEAR_HEAT_MIN) out.set(i, heat);
    }
    return out;
  }

  /**
   * Какого масштаба работа бывает на этой планете (шаг 44c).
   *
   * Свойство МИРА, а не сегодняшней биржи: гарнизон и напряжённость участка
   * видны на карте и без разведки, и по ним игрок понимает, куда лететь за
   * ротной работой. Само содержимое биржи по-прежнему открывается только на
   * месте — досье обещает «здесь такое бывает», а не «здесь такое лежит».
   */
  scaleOutlookAt(systemId: string): ScaleId {
    void this.version;
    const state = this.state;
    const i = GALAXY.require(systemId);
    const profile = worldProfile(state.worldSeed, state.deltas, i);
    const ruined = state.deltas[GALAXY.id(i)]?.ruined ?? 0;
    // Тот же гарнизон, что видит биржа: разорение снимает с него столько же.
    const garrison = profile.garrison * Math.max(0, 1 - Math.min(1, ruined));
    const hottest = this.tensionAt(systemId)[0]?.tension ?? 0;
    return scaleOutlook(garrison, hottest);
  }

  /** Пиратская угроза одной системы — для досье. */
  pirateRiskAt(systemId: string): number {
    void this.version;
    return this.pirateHeatBySystem.get(GALAXY.require(systemId)) ?? 0;
  }

  /**
   * Насколько система вычищена от вольницы, 0..1 (шаг 37a).
   *
   * След работы наёмников — чьей угодно, роты или соперника. Показывается
   * отдельной строкой, а не растворяется в угрозе: «здесь тихо, потому что тут
   * поработали» и «здесь тихо, потому что стоит гарнизон» — разные вещи, и
   * планировать по ним надо по-разному. Вычищенное зарастает.
   */
  clearedAt(systemId: string): number {
    void this.version;
    return clearedOf(this.state.deltas, systemId);
  }

  tensionAt(systemId: string): readonly { against: string; tension: number }[] {
    void this.version;
    const state = this.state;
    const i = GALAXY.require(systemId);
    const owner = ownerOf(state.deltas, i);
    const out: { against: string; tension: number }[] = [];
    // Только соседи за один прыжок: досье планеты — про эту планету, а не про
    // сектор вокруг неё. Биржа смотрит на два прыжка, потому что работу
    // выставляют и соседи; фронт у САМОЙ системы там, где чужой флаг видно.
    const seen = new Set<string>();
    for (const j of GALAXY.neighbors(i)) {
      const other = ownerOf(state.deltas, j);
      if (other === owner || seen.has(other)) continue;
      seen.add(other);
      const tension = tensionOf(state.war, state.reputation, owner, other, 1);
      if (tension > 0) out.push({ against: other, tension });
    }
    return out.sort((a, b) => (a.tension !== b.tension ? b.tension - a.tension : a.against < b.against ? -1 : 1));
  }

  /**
   * Что этот мир даёт своему владельцу за декаду и насколько он разорён.
   *
   * `null` до разведки: точные числа вклада в бюджет — ровно та же тайна, что
   * население и промышленность, из которых они и складываются.
   */
  worldEconomy(systemId: string): { income: number; ruined: number } | null {
    void this.version;
    const state = this.state;
    if (!isSurveyed(state.deltas, systemId)) return null;
    const i = GALAXY.require(systemId);
    const ruined = state.deltas[systemId]?.ruined ?? 0;
    return {
      income: Math.round(systemIncome(systemProfile(state.worldSeed, i), GALAXY.hasFlag(i, 'capital'), ruined)),
      ruined,
    };
  }

  /**
   * Как контракт повлияет на ОБЕ стороны, если его выполнить, — ДО подписи.
   *
   * Принципиально, а не удобно: игрок должен выбирать сторону осознанно, а не
   * узнавать о последствиях постфактум (`reputation.md`). Считается той же
   * функцией, что и настоящее начисление, и потому не может с ним разойтись;
   * состояния она не трогает, поэтому спрашивать её можно сколько угодно раз.
   *
   * Показывается исход `won` — то, на что игрок подписывается. Что бывает при
   * провале и разрыве, он узнаёт из журнала, а не из обещания.
   */
  previewOf(contract: Contract): readonly { readonly factionId: string; readonly delta: number }[] {
    void this.version;
    const rep = this.state.reputation;
    const deltas = contractReputation(
      rep,
      'won',
      contract.mission,
      contract.employer,
      contract.target,
      contract.atonement === true,
    );
    // Работа дома (шаг 85): наниматель — сама держава, и строка «Рота игрока +12» читалась как отношение к себе (отладка 2026-10-03).
    return deltas.standing
      .filter((c) => c.reason !== 'network' && c.factionId !== PLAYER_ACTOR_ID)
      .map((c) => ({ factionId: c.factionId, delta: effectiveStanding(rep, c) }))
      .filter((c) => c.delta !== 0);
  }

  /**
   * Открытая карточка события мира (шаг 84): прокрутка времени стоит, пока на неё не ответят.
   * Карточек за декаду может быть несколько — показывается первая, следующая — после ответа.
   */
  get pendingWorldEvent(): PendingWorldEvent | null {
    void this.version;
    const id = pendingEvents(this.state.war)[0];
    if (id === undefined) return null;
    const record = this.state.war.events[id];
    if (record === undefined) return null;
    const image = eventDef(id)?.image;
    const terms = inviteTerms(id);
    return {
      id,
      day: record.day,
      realm: record.realm,
      ...(image === undefined ? {} : { image }),
      invite:
        record.invite === undefined || terms === undefined
          ? null
          : { against: record.invite.against, allies: record.invite.allies, accept: terms.accept, decline: terms.decline },
    };
  }

  /**
   * Открытая карточка требования соседа (шаг 89): кто, с какого мира, сколько уйдёт дани за декаду и на сколько декад,
   * во сколько раз он сильнее на общей границе и каково его отношение к роте сейчас. Числа — те же, что исполнит ответ.
   */
  get pendingDemand(): PendingDemand | null {
    void this.version;
    const state = this.state;
    const card = state.war.demands?.pending;
    if (card === undefined) return null;
    const income = worldContributionAt(state.worldSeed, state.deltas, GALAXY.require(card.systemId)).income;
    return {
      from: card.from,
      systemId: card.systemId,
      system: nameOfSystem(card.systemId),
      day: card.day,
      perDecade: Math.round(income * WAR.diplomacy.tributeShare),
      decades: WAR.diplomacy.tributeDecades,
      ratio: demandForceRatio(state.war, bordersOf(state.deltas), card.from),
      standing: standingOf(state.reputation, card.from),
    };
  }

  answerDemand(accept: boolean): boolean {
    return this.run({ kind: 'answerDemand', accept });
  }

  /** Ответить на карточку события: закрыть или — на приглашение — вступить (`accept`) либо отказать. */
  answerWorldEvent(id: string, accept?: boolean): boolean {
    return this.run({ kind: 'answerEvent', id, ...(accept === undefined ? {} : { accept }) });
  }

  get activeContract(): Contract | null {
    void this.version;
    return this.state.contract?.contract ?? null;
  }

  get deadlineDay(): number | null {
    void this.version;
    return this.state.contract?.deadlineDay ?? null;
  }

  get deployed(): boolean {
    void this.version;
    return this.state.contract?.sortie != null;
  }

  /** Машины, годные к вылету: на корабле (не в гарнизоне, шаг 86b), целы в торсе и голове, с пилотом в строю. */
  get deployable(): readonly MechRecord[] {
    void this.version;
    const state = this.state;
    const active = new Set(state.company.pilots.filter((p) => p.status === 'active').map((p) => p.id));
    return shipboardMechs(state.company, state.garrison).filter(
      (m) => m.pilotId !== null && active.has(m.pilotId) && !isWreck(m) && jobOf(state, m.id) === null,
    );
  }

  /** Машин на корабле — их считает место в ангаре; гарнизон его не занимает (шаг 86b). */
  get aboardCount(): number {
    void this.version;
    return shipboardMechs(this.state.company, this.state.garrison).length;
  }

  /** Где стоит машина вне корабля (шаг 86b): мир и день прибытия; `null` — на корабле. */
  postOf(recordId: string): GarrisonPost | null {
    void this.version;
    return this.state.garrison.posts[recordId] ?? null;
  }

  /**
   * Гарнизон мира державы (шаг 86b): машины на мире и в пути, годность к бою, политика; что можно выгрузить,
   * если рота стоит здесь. Доступность кнопок — из `why`, то есть из того же `execute`.
   */
  garrisonView(systemId: string): GarrisonView {
    void this.version;
    const state = this.state;
    const fit = new Set(
      fitLance(state, garrisonAt(state.company, state.garrison, systemId, state.day)).map((p) => p.record.id),
    );
    const here = state.travel === null && state.systemId === systemId;
    const posted = state.company.mechs.filter((m) => state.garrison.posts[m.id]?.systemId === systemId);
    const depotCap = depotCapOf(state.deltas, systemId);
    return {
      here,
      policy: policyOf(state.garrison, systemId),
      mechs: posted.map((m) => {
        const post = state.garrison.posts[m.id];
        const arrives = post?.arrives ?? state.day;
        return {
          id: m.id,
          name: m.name,
          arrives: arrives > state.day ? arrives : null,
          fit: fit.has(m.id),
          depot: post?.depot === true,
        };
      }),
      aboard: here
        ? shipboardMechs(state.company, state.garrison)
            .filter((m) => m.pilotId !== null || depotCap > 0)
            .map((m) => ({ id: m.id, name: m.name, depot: m.pilotId === null }))
        : [],
      count: garrisonCount(state.garrison, systemId),
      cap: garrisonCapOf(state.deltas, systemId),
      depotCount: depotCount(state.garrison, systemId),
      depotCap,
    };
  }

  /**
   * Постройки мира державы (шаг 87): что построено, что строится, цена и срок каждой на этом мире, работы цеха.
   * Числа — функциями ядра (`war/buildings.ts`), кнопки — из `why`, то есть из того же `execute`.
   */
  buildingsView(systemId: string): BuildingsView {
    void this.version;
    const state = this.state;
    const i = GALAXY.require(systemId);
    const built = builtOn(state.deltas, i);
    const c = constructionOf(state.deltas, i);
    const days = (decades: number): number => decades * WAR.front.tickDays;
    const names = new Map(state.company.mechs.map((m) => [m.id, m.name]));
    const market = marketProfile(state.worldSeed, systemId, 0, developmentOf(state.deltas, systemId));
    const up = marketProfile(state.worldSeed, systemId, 0, developmentOf(state.deltas, systemId), {
      classUp: true,
      factory: false,
    });
    const army = totalArmy(state.war, PLAYER_ACTOR_ID);
    // Бонус губернатора (шаг 88, tech) — тот же, что у такта стройки.
    const bonuses = realmBonuses(state.deltas, state.realm, state.company.pilots);
    return {
      points: buildPoints(state.worldSeed, state.deltas, i, bonuses),
      rows: BUILDING_KINDS.map((kind) => ({
        kind,
        built: built.includes(kind),
        cost: buildingCost(kind),
        work: buildingWork(kind),
        etaDays: days(buildEtaDecades(state.worldSeed, state.deltas, i, kind, 0, bonuses)),
        upkeep: buildingUpkeep(kind),
        upkeep10: buildingUpkeep(kind) * DECADES_10Y,
      })),
      construction:
        c === undefined
          ? null
          : {
              kind: c.kind,
              progress: c.progress,
              work: buildingWork(c.kind),
              etaDays: days(buildEtaDecades(state.worldSeed, state.deltas, i, c.kind, c.progress, bonuses)),
              refund: buildingRefund(c.kind),
            },
      workshopJobs: state.queue.flatMap((e) =>
        e.task.kind === 'repairJob' && e.task.workshop === systemId
          ? [{ jobId: e.task.jobId, mech: names.get(e.task.recordId) ?? e.task.recordId, daysLeft: Math.max(0, e.day - state.day) }]
          : [],
      ),
      marketFrom: market.marketClass,
      marketTo: up.marketClass,
      factoryArmy: army,
      factorySaving: Math.round(army * WAR.economy.mechCost * WAR.buildings.factoryArmyCut),
    };
  }

  /**
   * Цена и срок работы по машине там, где она встанет (шаг 87): в наземном цехе ремонт дешевле и быстрее. Та же
   * функция места, что у команды (`bays.ts`); места нет — цена прежняя, а отказ скажет кнопка.
   */
  jobQuote(recordId: string, work: RepairWork, cost: number, days: number): { cost: number; days: number } {
    void this.version;
    const site = baySite(this.state, recordId);
    return typeof site === 'string' ? { cost, days } : atSite(site, work, cost, days);
  }

  /**
   * Почему машина не годна к вылету, если не годна (`null` — годна). Годность решает
   * `deployable`, здесь она только называется словом для подписи под кнопкой звена.
   */
  skipReasonOf(record: MechRecord): SkipReason | null {
    if (this.deployable.some((d) => d.id === record.id)) return null;
    if (isStationed(this.state.garrison, record.id)) return 'stationed';
    if (isWreck(record)) return 'wreck';
    if (jobOf(this.state, record.id) !== null) return 'inWork';
    return 'noPilot';
  }

  /** Копьё как единица измерения: им меряется звено по умолчанию на экране. */
  get lanceSize(): number {
    return CONTRACTS.lanceSize;
  }

  /** Сколько машин поднимает десантное судно роты — потолок вылета (шаг 44d). */
  get maxDeploy(): number {
    return mechCapacityOf(this.state.company);
  }

  intelOf(contract: Contract): ReturnType<typeof contractIntel> {
    void this.version;
    const state = this.state;
    return contractIntel(contract, isSurveyed(state.deltas, state.systemId));
  }

  /**
   * Оценка сил на экране: наша и противника по ПРОСТОЙ формуле
   * (`threat.ts::lanceSimpleThreat`, решения пользователя 2026-09-23). Та же мера,
   * по которой считается плата за высадку: выбор вооружения и пилот игрока в
   * число не входят и дают перевес в самом бою.
   */
  /**
   * Оценка сил до боя: звено роты, звено нанимателя (шаг 73b, 0 — нет) и
   * противник. Сравнивать противника экран обязан с суммой `ours + allies`:
   * союзники дерутся рядом, и сложность работы с ними ниже.
   */
  odds(contract: Contract, lance: readonly MechRecord[]): { ours: number; allies: number; theirs: number } {
    void this.version;
    return {
      ours: Math.round(lanceSimpleThreat(lance) * 100) / 100,
      allies: Math.round(alliesSimpleThreat(contract) * 100) / 100,
      theirs: Math.round(contractSimpleThreat(contract) * 100) / 100,
    };
  }

  /** Цена высадки звена на эту работу (шаг 67): считает ядро, экран только показывает. */
  landing(contract: Contract, lance: readonly MechRecord[]): LandingQuote {
    void this.version;
    return landingQuote(contract, lance, this.state.mode);
  }

  // --- звёздная карта (шаг 17b) -------------------------------------------------

  /** Что рота знает о системе: грубо всегда, точно — после разведки. */
  /**
   * Снабжение мира: срок доставки заказа и наценка (шаг 45).
   *
   * Отдельным методом, а не полем `knowledgeOf`: снабжение выводится из класса
   * рынка и развития, разведки не требует и в «знание о системе» не входит —
   * это свойство рынка, а не то, что рота о нём выяснила. `days: 0` означает
   * «отсюда не возят вовсе» (периферия).
   */
  supplyOf(systemId: string): { readonly days: number; readonly factor: number } {
    void this.version;
    const profile = marketProfile(
      this.state.worldSeed,
      systemId,
      standingOf(this.state.reputation, GALAXY.ownerId(GALAXY.require(systemId))),
      developmentOf(this.state.deltas, systemId),
      realmMarketOf(this.state.deltas, systemId),
    );
    return { days: profile.orderDays, factor: profile.orderFactor };
  }

  knowledgeOf(systemId: string): ReturnType<typeof systemKnowledge> {
    void this.version;
    const state = this.state;
    return systemKnowledge(
      state.worldSeed,
      systemId,
      isSurveyed(state.deltas, systemId),
      state.deltas[systemId]?.owner,
      developmentOf(state.deltas, systemId),
    );
  }

  /** Цена выкупа мира для роты: окупаемость за 200 декад (шаг 25). */
  worldPriceAt(systemId: string): number {
    void this.version;
    const state = this.state;
    const i = GALAXY.require(systemId);
    return worldPrice(state.worldSeed, state.deltas, i);
  }

  /**
   * Условия трёх путей к миру (шаг 72) — что у роты есть и что нужно, для
   * списка на карточке системы.
   *
   * Это ПОКАЗ условий, а не их проверка: включает кнопку по-прежнему
   * `why()`, то есть сам `execute`. Пороги берутся из `data/war.json` — те же,
   * что читает команда, — а значения из тех же функций ядра (память мира,
   * вычищенность, фронтовой индекс). Разойтись с командой список может только
   * при правке правила в `execute.ts`, и тогда кнопка скажет правду словами ядра.
   */
  claimTerms(systemId: string): readonly ClaimPath[] {
    void this.version;
    const state = this.state;
    const D = WAR.domain;
    const i = GALAXY.require(systemId);
    const owner = ownerOf(state.deltas, i);
    const kind = FACTIONS.get(owner)?.kind;
    const standing = standingOf(state.reputation, owner);
    const fame = state.reputation.fame;
    const memory = memoryOf(state.deltas, systemId);
    const won = memory?.won ?? 0;
    const capital = GALAXY.hasFlag(i, 'capital');
    const flag = (key: string, ok: boolean): ClaimTerm => ({ key, unit: 'flag', have: ok ? 1 : 0, need: 1, ok });
    const atLeast = (key: string, unit: ClaimTerm['unit'], have: number, need: number): ClaimTerm => ({
      key,
      unit,
      have,
      need,
      ok: have >= need,
    });

    const grant: ClaimTerm[] = [
      flag('notCapital', !capital),
      atLeast('standing', 'num', standing, D.grantStanding),
      atLeast('fame', 'num', fame, D.grantFame),
      atLeast('wins', 'num', won, D.grantWins),
      flag('lastForOwner', memory?.forWhom === owner),
      atLeast('frontier', 'frac', frontierIndexAt(state.deltas, state.reputation, state.war, i), D.grantFrontier),
    ];
    const conquer: ClaimTerm[] = [
      flag('ownerFree', kind === 'pirates' || kind === 'independent'),
      atLeast('wins', 'num', won, D.conquerWins),
    ];
    if (kind === 'pirates') conquer.push(atLeast('cleared', 'pct', clearedOf(state.deltas, systemId), D.conquerCleared));
    const contested = frontSectors(state.war, state.reputation, state.deltas, state.day).some((sec) => sec.system === i);
    const price = worldPrice(state.worldSeed, state.deltas, i);
    const buy: ClaimTerm[] = [
      flag('notCapital', !capital),
      flag('notContested', !contested),
      atLeast('standing', 'num', standing, D.minStanding),
      atLeast('funds', 'money', state.company.cbills, price),
    ];
    return [
      { path: 'grant', command: { kind: 'claimGrant' }, terms: grant },
      { path: 'conquer', command: { kind: 'conquerWorld' }, terms: conquer },
      { path: 'buy', command: { kind: 'buyWorld' }, terms: buy, price },
    ];
  }

  /**
   * Итог мира для державы роты за декаду, если его взять (проект державы, шаг 1): доход,
   * содержание с плечом от столицы роты и — для лена — доход за вычетом дани жалующему Дому
   * на срок `diplomacy.tributeDecades`. Считает ядро (`war/domain.ts::realmOutlook`). Доход — со
   * стартовой лояльностью пути (шаг 85): купленный и лен — `startBought`/`startGrant`, взятый силой —
   * `startForce`.
   */
  claimOutlook(systemId: string): { readonly net: number; readonly grantNet: number; readonly forceNet: number } {
    void this.version;
    const state = this.state;
    const i = GALAXY.require(systemId);
    const at = (origin: LoyaltyOrigin) => realmOutlook(state.worldSeed, state.deltas, i, startLoyalty(origin));
    const bought = at('bought');
    const grant = at('grant');
    const force = at('force');
    return {
      net: bought.income - bought.upkeep,
      grantNet: grant.income - grant.upkeep - Math.round(grant.income * WAR.diplomacy.grantTributeShare),
      forceNet: force.income - force.upkeep,
    };
  }

  /**
   * Чужой мир на карте державы (после шага 93): тип планеты и итог за декаду, если мир станет державы, — силой и
   * покупкой, те же числа, что у досье системы (`claimOutlook`).
   */
  systemGlance(systemId: string): { readonly biome: string; readonly force: number; readonly bought: number } {
    const i = GALAXY.require(systemId);
    const outlook = this.claimOutlook(systemId);
    return { biome: worldProfile(this.state.worldSeed, this.state.deltas, i).biome, force: outlook.forceNet, bought: outlook.net };
  }

  // --- держава (шаг 72) --------------------------------------------------------

  /**
   * Владеет ли рота хоть одним миром — с этого открывается вкладка державы.
   *
   * Экран державы здесь ничего не считает сам: доход, мощность, цены и ступень
   * приходят из `core/campaign/war/`, теми же функциями, которыми их считает
   * такт и списывает команда. Иначе цифра на экране разошлась бы с кассой.
   */
  get hasRealm(): boolean {
    void this.version;
    return domainWorlds(this.state.deltas).length > 0;
  }

  /** Сводка державы: доход и содержание миров и потоки дани. */
  get realm(): RealmSummary {
    void this.version;
    const state = this.state;
    const tally = domainTally(state.worldSeed, state.deltas);
    const flows = tributeFlows(state.war, state.worldSeed, state.deltas, state.day)[PLAYER_ACTOR_ID] ?? 0;
    const army = realmArmyUpkeep(state.war, state.deltas, state.realm).total;
    const buildings = domainBuildingsUpkeep(state.deltas);
    const net = tally.income - tally.upkeep - army - buildings + flows;
    // Отчисление в военный фонд — той же функцией и той же долей, что возьмёт такт
    // (`applyEconomyTask`): без живого врага она не кладёт ничего, и строка показывает ноль.
    // Участки фронта двигают только раскладку по врагам, не сумму, — поэтому здесь их нет.
    const share = state.war.realmWarShare ?? 0;
    const fund =
      net > 0 && share > 0
        ? placeWarFund(state.war, state.reputation, PLAYER_ACTOR_ID, Math.round(net * share)).placed
        : 0;
    return {
      worlds: tally.worlds.length,
      income: tally.income,
      upkeep: tally.upkeep,
      flows,
      army,
      buildings,
      fund,
      net: net - fund,
    };
  }

  /** Миры роты — в порядке каталога; первый из них столица (`economy.ts::capitalJumps`). */
  get realmWorlds(): readonly RealmWorld[] {
    void this.version;
    const state = this.state;
    const own = domainWorlds(state.deltas);
    if (own.length === 0) return [];
    // Угрозы — участки фронта, где мир роты стоит обороняющимся
    // (`war/front.ts::frontSectors`). Набегов на миры роты нет: держава с
    // первого мира (72c), и перемирие Тукайида её не касается (72d).
    const threats = new Map<number, { attacker: string }[]>();
    for (const sec of frontSectors(state.war, state.reputation, state.deltas, state.day)) {
      if (sec.defender !== PLAYER_ACTOR_ID) continue;
      const list = threats.get(sec.system) ?? [];
      list.push({ attacker: sec.attacker });
      threats.set(sec.system, list);
    }
    const capital = domainCapitalIndex(state.deltas);
    const bonuses = realmBonuses(state.deltas, state.realm, state.company.pilots);
    const sectors = sectorMap(state.deltas, state.realm);
    return own.map((i) => {
      const id = GALAXY.id(i);
      const profile = worldProfile(state.worldSeed, state.deltas, i);
      const c = worldContributionAt(state.worldSeed, state.deltas, i);
      const d = state.deltas[id];
      const tributeTo = tributeOf(state.deltas, id, state.day) ?? null;
      return {
        id,
        name: GALAXY.name(i),
        biome: profile.biome,
        capital: i === capital,
        income: c.income,
        upkeep: c.upkeep,
        capacity: c.capacity,
        lift: c.lift,
        development: developmentOf(state.deltas, id),
        developmentMax: developmentMaxAt(state.deltas, i),
        developCost: developCostAt(state.deltas, i),
        focus: focusOf(state.deltas, id, profile.naturalFocus),
        naturalFocus: profile.naturalFocus,
        focusTo: d?.focusTo ?? null,
        focusUntil: d?.focusUntil ?? null,
        ruined: d?.ruined ?? 0,
        tributeTo,
        tributeUntil: tributeTo === null ? null : (d?.tributeUntil ?? null),
        threats: threats.get(i) ?? [],
        loyalty: d?.loyalty ?? null,
        loyaltyFactor: loyaltyFactor(state.deltas, id),
        loyaltyDrift: loyaltyDrift(state.deltas, state.war, state.reputation, id, state.day, bonuses),
        loyaltyPressure: d?.loyalty === undefined ? null : loyaltyPressure(state.deltas, state.war, state.reputation, id, state.day),
        formerOwner: d?.formerOwner ?? null,
        revoltUntil: d?.revoltSince === undefined ? null : revoltDeadline(d.revoltSince),
        sector: sectors.get(id) ?? null,
        pinned: state.realm.pinned.includes(id),
      };
    });
  }

  /**
   * Что мир давал бы с каждым из фокусов — для выбора переделки.
   *
   * Числа из той же `worldContributionAt`, что кормит такт, поэтому предпросмотр
   * показывает и то, чего фокус НЕ меняет (см. `wiki/overview/notes.md` §7a).
   */
  focusPreview(systemId: string): readonly FocusPreview[] {
    void this.version;
    const state = this.state;
    const i = GALAXY.require(systemId);
    const defence = WAR.industry.focusDefence as Readonly<Record<WorldFocus, number>>;
    return WORLD_FOCUSES.map((focus) => {
      const c = worldContributionAt(state.worldSeed, state.deltas, i, focus);
      return { focus, income: c.income, upkeep: c.upkeep, capacity: c.capacity, defence: defence[focus] };
    });
  }

  /** Цены решений державы, которые не зависят от мира. `null` — миров нет, и решать нечего. */
  get realmPrices(): {
    readonly pact: number;
    readonly protectorate: number;
    readonly focus: number;
    readonly develop: number;
    readonly capital: number;
    /** С какого дня столицу можно перенести снова; `null` — хоть сегодня. */
    readonly capitalReadyDay: number | null;
  } | null {
    void this.version;
    const state = this.state;
    if (domainWorlds(state.deltas).length === 0) return null;
    return {
      pact: pactPrice(state.worldSeed, state.deltas),
      protectorate: protectoratePrice(state.worldSeed, state.deltas),
      focus: WAR.focus.cost,
      develop: WAR.development.stepCost,
      capital: WAR.domain.capitalMoveCost,
      capitalReadyDay: capitalMoveReadyDay(state.deltas) ?? null,
    };
  }

  /** Дань — наложить на мир соседа или выкупить со своего. */
  tributePriceAt(systemId: string): number {
    void this.version;
    const state = this.state;
    return tributePrice(state.worldSeed, state.deltas, GALAXY.require(systemId));
  }

  /**
   * Полевая армия державы: резерв, театры и потолок.
   *
   * Экономика роты синхронизируется НА КОПИИ тем же `syncDomainEconomy`, что
   * зовёт команда перед проверкой потолка: между тактами мощность домена могла
   * вырасти (куплен мир), и без этого экран показывал бы вчерашний потолок.
   */
  get realmArmy(): RealmArmy {
    void this.version;
    const state = this.state;
    const war = syncDomainEconomy(state.war, state.worldSeed, state.deltas, state.company.cbills);
    const eco = war.economy[PLAYER_ACTOR_ID];
    const capacity = eco?.capacity ?? 0;
    return {
      total: totalArmy(war, PLAYER_ACTOR_ID),
      reserve: eco?.army ?? 0,
      capacity,
      cap: realmArmyCap(state.deltas, capacity).total,
      capParts: realmArmyCap(state.deltas, capacity),
      upkeep: realmArmyUpkeep(war, state.deltas, state.realm),
      theaters: this.realmTheaters(war),
      mechPrice: regimentPrice(1, state.deltas),
      mechUpkeep: WAR.domain.armyUpkeep,
      warShare: war.realmWarShare ?? 0,
      warSteps: WAR.domain.warBudgetSteps,
      funds: fundsOf(war, PLAYER_ACTOR_ID).map((r) => ({
        against: r.against,
        amount: r.amount,
        push: pushOf(war, PLAYER_ACTOR_ID, r.against),
      })),
    };
  }

  /** Театры державы и их норма: все направления с долей фронта плюс те, где полки ещё стоят. */
  private realmTheaters(war: WarState): RealmArmy['theaters'] {
    const state = this.state;
    const shares = frontShares(frontWeights(frontSectors(war, state.reputation, state.deltas, state.day)));
    const ids = new Set<string>(Object.keys(shares[PLAYER_ACTOR_ID] ?? {}));
    for (const th of theatersOf(war, PLAYER_ACTOR_ID)) ids.add(th.against);
    return [...ids].sort().map((against) => ({
      against,
      mechs: theaterOf(war, PLAYER_ACTOR_ID, against),
      reference: Math.round(theaterReference(war, PLAYER_ACTOR_ID, against, shares)),
    }));
  }

  /** Цена полка из `mechs` машин — та же функция, что у команды (заводы державы её режут, шаг 87). */
  regimentPriceOf(mechs: number): number {
    void this.version;
    return regimentPrice(mechs, this.state.deltas);
  }

  /** Сколько вернёт роспуск `mechs` машин — та же функция, что у команды. */
  regimentRefundOf(mechs: number): number {
    void this.version;
    return regimentRefund(mechs, this.state.deltas);
  }

  /** Соседи державы: с кем она граничит, что с ними подписано и чьи миры под чьей данью. */
  get realmNeighbours(): readonly RealmNeighbour[] {
    void this.version;
    const state = this.state;
    const borders = bordersOf(state.deltas);
    const growth = growthOf(state.war);
    return domainBorder(state.deltas).map((b) => {
      const pact = pactOf(state.war, PLAYER_ACTOR_ID, b.owner);
      return {
        factionId: b.owner,
        standing: standingOf(state.reputation, b.owner),
        pact: pact === undefined || pact.untilDay <= state.day ? null : pact,
        vassal: suzerainOf(state.war, b.owner) === PLAYER_ACTOR_ID,
        payingUs: tributeCount(state.deltas, PLAYER_ACTOR_ID, b.owner, state.day),
        atWar: atWarWithPlayer(state.war, state.reputation, b.owner, state.day),
        alarm: realmAlarm(state.war, borders, growth, b.owner),
        systems: b.systems.map((j) => {
          const id = GALAXY.id(j);
          return {
            id,
            name: GALAXY.name(j),
            capital: GALAXY.hasFlag(j, 'capital'),
            tributeTo: tributeOf(state.deltas, id, state.day) ?? null,
          };
        }),
      };
    });
  }

  /**
   * Куда армия державы может наступать по приказу (проект державы, шаг 3): участки, где рота —
   * нападающая, по фракциям. Не по записи войны, а по фронту: с пиратами и кланами держава воюет от
   * рождения, записи войны у них может не быть. Числа — из `war/offensive.ts::planOffensive`.
   */
  /** Секторы и губернаторы державы (шаг 88): что назначено, предел, резерв, кого и куда можно назначить. */
  get realmSectors(): RealmSectors {
    void this.version;
    const state = this.state;
    const r = state.realm;
    const map = sectorMap(state.deltas, r);
    const skill = (p: Pilot, id: string): number => skillLevel(p, id);
    const sectors = r.sectors.map((x): SectorView => {
      const pilot = x.governor === null ? undefined : state.company.pilots.find((p) => p.id === x.governor);
      return {
        center: x.center,
        centerName: nameOfSystem(x.center),
        priority: x.priority,
        governor:
          pilot === undefined
            ? null
            : {
                id: pilot.id,
                name: pilot.name,
                callsign: pilot.callsign,
                presence: skill(pilot, 'presence'),
                tech: skill(pilot, 'tech'),
                tactics: skill(pilot, 'tactics'),
                bonus: governorBonus(pilot),
              },
        worlds: [...map]
          .filter(([, c]) => c === x.center)
          .map(([id]) => ({ id, name: nameOfSystem(id), pinned: r.pinned.includes(id) })),
      };
    });
    return {
      sectors,
      limit: sectorLimit(state.deltas),
      used: r.sectors.length,
      reserve: r.reserve,
      reserveSteps: WAR.realm.reserveSteps,
      pilots: state.company.pilots
        .filter((p) => p.status === 'active' && !isGovernor(r, p.id))
        .map((p) => ({ id: p.id, callsign: p.callsign, presence: skill(p, 'presence'), tech: skill(p, 'tech'), tactics: skill(p, 'tactics') })),
      // Все свои миры: центр уже назначенного сектора — смена губернатора тем же назначением.
      centers: domainWorlds(state.deltas).map((i) => ({ id: GALAXY.id(i), name: GALAXY.name(i) })),
    };
  }

  get realmOffensives(): RealmOffensives {
    void this.version;
    const state = this.state;
    const fund = realmWarFund(state.war);
    if (!isPlayerRealm(state.deltas)) return { fund, fronts: [] };
    const byFaction = new Map<string, number[]>();
    for (const s of frontSectors(state.war, state.reputation, state.deltas, state.day)) {
      if (s.attacker !== PLAYER_ACTOR_ID) continue;
      const list = byFaction.get(s.defender) ?? [];
      list.push(s.system);
      byFaction.set(s.defender, list);
    }
    const fronts = [...byFaction.keys()].sort().map((factionId) => ({
      factionId,
      cost: offensiveCost(state.war, factionId),
      mechs: theaterOf(state.war, PLAYER_ACTOR_ID, factionId),
      targets: (byFaction.get(factionId) ?? []).map((i) => {
        const check = planOffensive(state.war, state.reputation, state.deltas, state.worldSeed, i, state.day);
        const id = GALAXY.id(i);
        return {
          id,
          name: GALAXY.name(i),
          odds: check.ok ? check.forces.odds : (check.forces?.odds ?? 0),
          why: this.why({ kind: 'orderOffensive', systemId: id }),
          readyDay: !check.ok && check.block.kind === 'cooldown' ? check.block.readyDay : null,
          lance: orderLance(state, i).length,
        };
      }),
    }));
    return { fund, fronts };
  }

  /** Титул державы (шаг 89): нынешний, прибавки всех достигнутых, следующий и миров до него; `null` — миров нет. */
  get realmTitle(): RealmTitleInfo | null {
    void this.version;
    const worlds = domainWorlds(this.state.deltas).length;
    const now = titleOf(worlds);
    if (now === null) return null;
    const next = nextTitle(worlds);
    return { id: now.id, bonus: titleBonusOf(worlds), next: next === null ? null : { id: next.id, worlds: next.worlds - worlds } };
  }

  /** Великие полки реестра MRBC для найма державой (шаг 89) — в порядке реестра. */
  get greatRegiments(): readonly GreatRegimentOffer[] {
    void this.version;
    return this.state.rivals.regiments.map((r) => ({
      id: r.id,
      name: mercName(r.id, r.name),
      emblem: RIVALS.registry.find((u) => u.id === r.id)?.emblem ?? -1,
      mechs: r.mechs,
      price: greatHirePrice(r),
      hire: r.hire === undefined ? null : { against: r.hire.against, until: r.hire.until, system: GALAXY.name(GALAXY.require(r.systemId)) },
    }));
  }

  /** Войны державы роты (шаг 76) с условиями мира — по записи войны, от давней к свежей. */
  get realmWars(): readonly RealmWar[] {
    void this.version;
    const state = this.state;
    return Object.keys(state.war.playerWars ?? {})
      .map((factionId) => {
        const w = playerWarOf(state.war, factionId) as NonNullable<ReturnType<typeof playerWarOf>>;
        const terms = peaceTerms(state.war, state.deltas, state.worldSeed, factionId, state.day);
        const outcome = peaceOutcome(state.war, state.deltas, factionId, terms.kind === 'free' && terms.offered);
        return {
          factionId,
          since: w.since,
          won: w.won,
          lost: w.lost,
          offerUntil: w.offerUntil !== undefined && w.offerUntil >= state.day ? w.offerUntil : null,
          terms,
          truceDays: truceDaysAfterPeace(state.war, factionId),
          protectorate: terms.kind === 'free' && terms.offered && protectorateByPeace(state.war, state.deltas, factionId),
          goal:
            w.goal === undefined
              ? null
              : { kind: w.goal.kind, systems: w.goal.kind === 'humiliation' ? [] : w.goal.systems.map(nameOfSystem) },
          foeGoal: (w.foeGoal ?? []).map(nameOfSystem),
          goalIds: w.goal === undefined || w.goal.kind === 'humiliation' ? [] : [...w.goal.systems],
          foeGoalIds: [...(w.foeGoal ?? [])],
          fatigue: w.fatigue ?? 0,
          foeFatigue: w.foeFatigue ?? 0,
          outcome: {
            gained: outcome.gained.map(nameOfSystem),
            tributaries: outcome.tributaries.map(nameOfSystem),
            humiliation: outcome.humiliation,
            returned: outcome.returned.map(nameOfSystem),
            ceded: outcome.ceded.map(nameOfSystem),
          },
          stance: stanceOf(state.realm, factionId),
          ...((): { stanceTarget: string | null; stanceTargetId: string | null } => {
            const target = stanceTarget(state, factionId);
            return target === undefined
              ? { stanceTarget: null, stanceTargetId: null }
              : { stanceTarget: GALAXY.name(target), stanceTargetId: GALAXY.id(target) };
          })(),
          stanceFocusId: state.realm.targets?.[factionId] ?? null,
        };
      })
      .sort((a, b) => a.since - b.since || (a.factionId < b.factionId ? -1 : 1));
  }

  /**
   * Роли миров для слоя «Держава» на звёздной карте (шаг 72a): свои, столица,
   * данники роты, миры вассалов, граница. Пустая карта — у роты нет миров.
   *
   * Порядок ролей — от сильной к слабой: мир вассала на границе рисуется как
   * вассальный, данник — как данник.
   */
  get realmMap(): ReadonlyMap<number, RealmMapRole> {
    void this.version;
    const state = this.state;
    const out = new Map<number, RealmMapRole>();
    const own = domainWorlds(state.deltas);
    if (own.length === 0) return out;
    for (const b of domainBorder(state.deltas)) for (const j of b.systems) out.set(j, 'border');
    const vassals = new Set(vassalsOf(state.war, PLAYER_ACTOR_ID));
    if (vassals.size > 0) {
      const owners = ownerArray(state.deltas);
      owners.forEach((o, i) => {
        if (vassals.has(o)) out.set(i, 'vassal');
      });
    }
    for (const id of Object.keys(state.deltas)) {
      if (tributeOf(state.deltas, id, state.day) === PLAYER_ACTOR_ID) out.set(GALAXY.require(id), 'tributary');
    }
    for (const i of own) out.set(i, 'own');
    const capital = domainCapitalIndex(state.deltas);
    if (capital !== undefined) out.set(capital, 'capital');
    return out;
  }

  /**
   * Просьба к звёздной карте «покажи эту систему» (шаг 72a) — одноразовая:
   * карта выбирает систему, центрирует на ней, включает слой державы и
   * гасит просьбу. Одноразовая, а не постоянная: иначе карта при каждом
   * открытии прыгала бы к миру, который смотрели неделю назад.
   */
  mapRequest = $state<string | null>(null);

  /** Гарнизон мира в ангаре: список парка переключается на этот мир, выбрана его первая машина. */
  /** Есть ли на мире наземный цех (шаг 87): там переоснащают и чинят машины гарнизона. */
  hasWorkshop(systemId: string): boolean {
    void this.version;
    return workshopBaysAt(this.state.deltas, systemId) > 0;
  }

  showGarrison(systemId: string): void {
    this.hangarPlace = systemId;
    const first = this.state.company.mechs.find((m) => this.state.garrison.posts[m.id]?.systemId === systemId);
    if (first !== undefined) this.selectedMechId = first.id;
    this.screen = 'hangar';
  }

  showOnMap(systemId: string): void {
    this.selectedSystemId = systemId;
    this.mapRequest = systemId;
    this.screen = 'starmap';
  }

  /** Вассалы державы — могут и не граничить с ней, если граница с тех пор сдвинулась. */
  get realmVassals(): readonly string[] {
    void this.version;
    return vassalsOf(this.state.war, PLAYER_ACTOR_ID);
  }

  /**
   * Насколько мир отстроен сверх канона или сведён войной (шаг 23, часть A).
   *
   * Ноль — мир ровно такой, каким его вывел сид. Видно БЕЗ разведки, как класс
   * рынка и полоса гарнизона: что мир отстроили или выжгли, читается из сводок,
   * а не из переписи населения.
   */
  developmentOf(systemId: string): number {
    void this.version;
    return developmentOf(this.state.deltas, systemId);
  }

  visited(systemId: string): boolean {
    void this.version;
    return isVisited(this.state.deltas, systemId);
  }

  /**
   * Маршрут отсюда туда. `null` — пути прыжками нет.
   *
   * Считает ЯДРО (`galaxy/navigation.ts::findRoute`, A* по прыжкам ≤ 30 св. лет).
   * Экран не складывает ни сутки, ни цену: и то и другое зависит от спектра
   * звезды, у которой заряжается парус, и своя формула разошлась бы с той, по
   * которой команда спишет деньги.
   */
  routeTo(systemId: string): Route | null {
    void this.version;
    const from = GALAXY.index(this.state.systemId);
    const to = GALAXY.index(systemId);
    if (from < 0 || to < 0 || from === to) return null;
    return findRoute(from, to);
  }

  /** Цена и срок разведки — из данных галактики, не из головы. */
  get surveyPlan(): { readonly cost: number; readonly days: number } {
    return { cost: GALAXY_RULES.survey.cost, days: Math.max(1, Math.ceil(GALAXY_RULES.survey.days)) };
  }

  get surveyedHere(): boolean {
    void this.version;
    return isSurveyed(this.state.deltas, this.state.systemId);
  }

  // --- рынок и склад (шаг 17b) --------------------------------------------------

  /** Профиль лавки: наценка, спред, какие классы тут бывают, срок доставки. */
  get market(): ReturnType<typeof marketProfile> {
    void this.version;
    return marketProfile(
      this.state.worldSeed,
      this.state.systemId,
      this.standingHere,
      developmentOf(this.state.deltas, this.state.systemId),
      realmMarketOf(this.state.deltas, this.state.systemId),
    );
  }

  /**
   * Отношение владельца этой системы к отряду (шаг 20) — вход в цены лавки.
   * Экран обязан показывать ровно те цены, по которым команда спишет деньги,
   * поэтому число берётся здесь, а не выводится вёрсткой.
   */
  get standingHere(): number {
    void this.version;
    const state = this.state;
    return standingOf(state.reputation, ownerOf(state.deltas, GALAXY.require(state.systemId)));
  }

  /**
   * Владелец системы, где стоит рота, с учётом завоеваний (шаг 50). Лоты рынка
   * показываются в его цветах — в них же машина и приедет после покупки
   * (`executeBuyMech` пишет то же самое в `originFaction`).
   */
  get ownerHere(): string {
    void this.version;
    const state = this.state;
    return ownerOf(state.deltas, GALAXY.require(state.systemId));
  }

  /**
   * Ассортимент на сегодня за вычетом уже купленного.
   *
   * Выводится, а не хранится (решение 2026-09-02): в дельте системы лежит
   * только факт покупки, сам список считается из сида мира и декады.
   */
  get stock(): readonly StockLot[] {
    void this.version;
    const state = this.state;
    const delta = state.deltas[state.systemId];
    const bought = delta !== undefined && delta.boughtDecade === decadeOf(state.day) ? (delta.bought ?? []) : [];
    return availableStock(
      state.worldSeed,
      state.systemId,
      state.day,
      bought,
      this.standingHere,
      developmentOf(state.deltas, state.systemId),
      realmMarketOf(state.deltas, state.systemId),
    );
  }

  /**
   * Машины на прилавке (шаг 19a) — выводятся ровно так же, как узлы, и тем же
   * списком купленного вычёркиваются: у прилавков один делец и одна декада.
   */
  get mechStock(): readonly MechLot[] {
    void this.version;
    const state = this.state;
    const delta = state.deltas[state.systemId];
    const bought = delta !== undefined && delta.boughtDecade === decadeOf(state.day) ? (delta.bought ?? []) : [];
    return availableMechs(
      state.worldSeed,
      state.systemId,
      state.day,
      bought,
      this.standingHere,
      developmentOf(state.deltas, state.systemId),
      realmMarketOf(state.deltas, state.systemId),
    );
  }

  get warehouse(): readonly WarehouseEntry[] {
    void this.version;
    return this.state.company.warehouse;
  }

  // --- мехлаб (шаг 19a) ----------------------------------------------------------

  /**
   * План переоснащения для чертежа, который игрок собрал на экране.
   *
   * Считает ЯДРО (`company/refit.ts`), а экран показывает: цена, срок, что
   * снимут, что поставят и чего не хватает — всё оттуда. Занятые другими
   * работами складские записи ядру передаёт `reservedPartIds`, иначе мехлаб
   * предложил бы поставить ствол, уже уехавший в другую работу.
   */
  refit(record: MechRecord, target: MechAssembly): RefitPlan {
    void this.version;
    return refitPlan(this.state.company, record, target, this.reservedPartIds);
  }

  /** Складские записи, занятые незавершёнными работами цеха. */
  get reservedPartIds(): ReadonlySet<string> {
    void this.version;
    const out = new Set<string>();
    for (const e of this.state.queue) {
      if (e.task.kind !== 'repairJob') continue;
      if (e.task.partId !== undefined) out.add(e.task.partId);
      for (const id of e.task.partIds ?? []) out.add(id);
    }
    return out;
  }

  /** Годна ли машина к переоснащению: правило ядра, а не проверка экрана. */
  refittable(record: MechRecord): boolean {
    void this.version;
    return isRefittable(record);
  }

  /** Класс десантного судна роты. */
  get dropship(): DropshipId {
    void this.version;
    return this.state.company.dropship;
  }

  /** Параметры текущего десантного судна. */
  get dropshipDef(): DropshipDef {
    void this.version;
    return dropshipDefOf(this.state.company);
  }

  /** Вместимость ангара по роботам для текущего судна. */
  get mechCapacity(): number {
    void this.version;
    return mechCapacityOf(this.state.company);
  }

  /** Идентификатор следующего корабля или null. */
  get nextDropshipId(): DropshipId | null {
    void this.version;
    return nextDropshipId(this.state.company.dropship);
  }

  /** Параметры следующего десантного корабля или null. */
  get nextDropshipDef(): DropshipDef | null {
    void this.version;
    const id = this.nextDropshipId;
    return id === null ? null : ECONOMY.dropships[id];
  }

  /** Есть ли в текущей системе верфь для модернизации корабля. */
  get isAtShipyard(): boolean {
    void this.version;
    if (this.state.travel !== null) return false;
    const profile = worldProfile(this.state.worldSeed, this.state.deltas, this.state.systemId);
    return isShipyard(profile);
  }

  /** Следующая ступень лестницы цеха. `null` — цех уже наверху или упёрся в потолок корабля. */
  get nextBayStep(): { readonly to: number; readonly cost: number; readonly days: number } | null {
    void this.version;
    return nextBayStep(this.state.company.bays, this.state.company.dropship);
  }

  /** Идёт ли перестройка цеха прямо сейчас и сколько до конца. */
  get bayUpgradeDaysLeft(): number | null {
    void this.version;
    const event = this.state.queue.find((e) => e.task.kind === 'baysUpgraded');
    return event === undefined ? null : Math.max(0, event.day - this.state.day);
  }

  /** Следующая ячейка ангара (шаг 75) или `null`, если ангар открыт до потолка корабля. */
  get nextHangarStep(): { readonly to: number; readonly cost: number; readonly days: number } | null {
    void this.version;
    return nextHangarStep(this.state.company.hangar, this.state.company.dropship);
  }

  /** Открывается ли ячейка ангара прямо сейчас и сколько до конца. */
  get hangarUpgradeDaysLeft(): number | null {
    void this.version;
    const event = this.state.queue.find((e) => e.task.kind === 'hangarUpgraded');
    return event === undefined ? null : Math.max(0, event.day - this.state.day);
  }

  /**
   * Сколько даст скупщик за складскую запись.
   *
   * Спред — правило, а не настройка: продажа заметно ниже покупки, иначе возка
   * узлов между системами становится бесконечным доходом (ловушка 3 шага 15).
   */
  sellPriceOf(entry: WarehouseEntry): number {
    void this.version;
    const state = this.state;
    const value = isWarehousePart(entry)
      ? nodeValue(
          { node: entry.node, tonnage: entry.sourceTonnage, tier: entry.tier },
          entry.quality,
          entry.wear,
        )
      : itemCost(entry.itemId);
    const key = isWarehousePart(entry) ? entry.node : entry.kind;
    return sellPrice(value, this.market, state.worldSeed, state.day, key);
  }

  /** Сколько даст скупщик за машину целиком (с учётом спреда и спроса рынка). */
  sellPriceOfMech(record: MechRecord): number {
    void this.version;
    const state = this.state;
    return sellPrice(mechValue(record), this.market, state.worldSeed, state.day, 'mech');
  }

  /** Подходит ли узел со склада этой машине: тот же тоннаж и тот же тир. */
  fitsMech(entry: WarehouseEntry, record: MechRecord): boolean {
    if (!isWarehousePart(entry)) return false;
    const spec = recordNodeSpec(record, entry.node);
    // Тоннаж обязан совпасть: реактор с другой машины физически не встанет.
    if (spec.tonnage !== entry.sourceTonnage) return false;
    // ТИР совпадать НЕ обязан — ядро разрешает смену тира с шага 32 (реактор) и
    // шага 45 (каркас). Здесь это условие держалось до шага 45 и в одиночку
    // выключало всю механику тиров: ядро замену разрешало, а интерфейс её
    // просто не предлагал, поэтому найденный на прилавке R3 поставить было
    // некуда. Проверяется то же, что проверяет ядро: соберётся ли машина.
    if (spec.tier === entry.tier) return true;
    return this.tierFits(record, entry.node, entry.tier);
  }

  /**
   * Соберётся ли машина, если у неё сменить тир одного узла.
   *
   * Тир каркаса меняет число ячеек, тир реактора — массу; загруженная машина в
   * тесный каркас не помещается. Ровно эту проверку делает `installPart` перед
   * тем, как занять стапель, — интерфейс обязан знать ответ раньше, чем игрок
   * нажмёт кнопку.
   */
  tierFits(record: MechRecord, node: WearNode, tier: number): boolean {
    const entry = getChassisCatalogEntry(record.assembly.chassisCode);
    const code =
      node === 'reactor'
        ? entry.code.replace(/R\d+F/, `R${tier}F`)
        : entry.code.replace(/F\d+$/, `F${tier}`);
    if (code === entry.code) return true;
    if (!CHASSIS_CATALOG.has(code)) return false;
    return validateAssembly({ ...record.assembly, chassisCode: code }).valid;
  }

  /** Работа цеха по установке узла со склада: сам узел уже куплен, платится труд. */
  installCost(entry: WarehouseEntry, record: MechRecord): { readonly cost: number; readonly days: number } {
    if (!isWarehousePart(entry)) return { cost: 0, days: 0 };
    return installPlan(recordNodeSpec(record, entry.node), entry.quality);
  }

  /**
   * Счёт за связку узлов, собранную игроком в ангаре (шаг 45).
   *
   * Всё, что нужно решить, — в одном месте: сколько стоит, когда привезут,
   * влезет ли навеска в новый каркас и что вернётся на склад со снятого. Ровно
   * этого не хватало, чтобы механика тиров была играбельной: цена и срок были
   * рассыпаны по экрану рынка, а годность связки выяснялась отказом уже после
   * оплаты.
   *
   * Позиции, совпадающие с тем, что уже стоит на машине, в счёт не попадают:
   * заказывать реактор, который и так стоит, незачем.
   */
  orderQuote(
    record: MechRecord,
    want: Readonly<Record<WearNode, { readonly tier: number; readonly cls: QualityClass }>>,
  ): {
    /** Вся связка целиком: и то, что надо заказать, и то, что уже есть. */
    readonly items: readonly OrderSpec[];
    /** Чего нет ни на складе, ни в пути — это и уедет в заказ. */
    readonly toOrder: readonly OrderSpec[];
    /** Уже заказано и едет: повторно платить за то же незачем, а срок игроку нужен. */
    readonly inTransit: readonly { readonly node: WearNode; readonly day: number }[];
    /** Что уже лежит на складе и ставится прямо сейчас. */
    readonly ready: readonly { readonly node: WearNode; readonly partId: string }[];
    /** Цена всей связки, как если бы заказывали всё. */
    readonly price: number;
    /** Цена того, чего нет на складе. */
    readonly orderCost: number;
    readonly days: number;
    readonly deliverable: boolean;
    /** Влезет ли навеска в новый каркас: тир меняет число ячеек. */
    readonly fits: boolean;
    /** Что ляжет на склад со снятого — по одной записи на заменяемый узел. */
    readonly stowed: readonly { readonly node: WearNode; readonly quality: QualityClass }[];
  } {
    void this.version;
    const market = this.market;
    const installed = recordQuality(record);
    const items: OrderSpec[] = [];
    const stowed: { node: WearNode; quality: QualityClass }[] = [];

    for (const node of WEAR_NODES) {
      const spec = recordNodeSpec(record, node);
      const target = want[node];
      if (target.tier === spec.tier && target.cls === installed[node]) continue;
      items.push({ node, tonnage: spec.tonnage, tier: target.tier, targetClass: target.cls });
      stowed.push({ node, quality: salvagedNode(record, node).quality });
    }

    const price = items.reduce(
      (sum, item) =>
        sum +
        orderPrice(
          nodeCost({ node: item.node, tonnage: item.tonnage, tier: item.tier }, item.targetClass),
          market,
        ),
      0,
    );

    // Что из нужного уже лежит на складе: доехавший заказ, снятый с другой
    // машины узел, трофей с разбора. Заказывать это повторно незачем — круг
    // «заказал → привезли → поставил» обязан замыкаться в одном месте.
    const ready: { node: WearNode; partId: string }[] = [];
    const toOrder: OrderSpec[] = [];
    for (const item of items) {
      const have = this.state.company.warehouse.find(
        (w) =>
          isWarehousePart(w) &&
          w.node === item.node &&
          w.sourceTonnage === item.tonnage &&
          w.tier === item.tier &&
          w.quality === item.targetClass &&
          !ready.some((r) => r.partId === w.id),
      );
      if (have === undefined) toOrder.push(item);
      else ready.push({ node: item.node, partId: have.id });
    }

    // Заказ, который уже оформлен, но ещё не доехал: та же позиция сидит в
    // очереди суток. Без этого кнопка после оплаты остаётся живой, и игрок
    // либо не верит, что заказ прошёл, либо платит второй раз.
    const inTransit: { node: WearNode; day: number }[] = [];
    const claimed = new Set<number>();
    for (let i = toOrder.length - 1; i >= 0; i--) {
      const item = toOrder[i]!;
      const hit = this.state.queue.find(
        (e) =>
          e.task.kind === 'deliveryArrived' &&
          !claimed.has(e.seq) &&
          e.task.part.node === item.node &&
          e.task.part.sourceTonnage === item.tonnage &&
          e.task.part.tier === item.tier &&
          e.task.part.quality === item.targetClass,
      );
      if (hit === undefined) continue;
      claimed.add(hit.seq);
      inTransit.push({ node: item.node, day: hit.day });
      toOrder.splice(i, 1);
    }

    const orderCost = toOrder.reduce(
      (sum, item) =>
        sum +
        orderPrice(
          nodeCost({ node: item.node, tonnage: item.tonnage, tier: item.tier }, item.targetClass),
          market,
        ),
      0,
    );

    return {
      items,
      toOrder,
      inTransit,
      ready,
      price,
      orderCost,
      days: market.orderDays,
      deliverable: market.orderDays > 0,
      fits: this.assemblyFits(record, want),
      stowed,
    };
  }

  /**
   * Соберётся ли машина с этой связкой тиров.
   *
   * Тир каркаса меняет число ячеек (у 60 тонн 37 / 32 / 24), а тир реактора —
   * массу, и загруженная машина в тесный каркас не помещается. Игрок обязан
   * узнать это ДО оплаты, а не отказом работы после.
   */
  private assemblyFits(
    record: MechRecord,
    want: Readonly<Record<WearNode, { readonly tier: number }>>,
  ): boolean {
    const entry = getChassisCatalogEntry(record.assembly.chassisCode);
    const code = entry.code
      .replace(/R\d+F/, `R${want.reactor.tier}F`)
      .replace(/F\d+$/, `F${want.frame.tier}`);
    if (!CHASSIS_CATALOG.has(code)) return false;
    return validateAssembly({ ...record.assembly, chassisCode: code }).valid;
  }

  // --- казармы (шаг 17b) ---------------------------------------------------------

  /**
   * Навыки, которые казармы показывают и дают учить: те, у которых есть источник
   * опыта (`pilots.json → progression.xp`).
   *
   * Отбор по опыту, а не по группе «кокпит», и это правка 2026-09-10.
   * Выносливость лежит в личной группе, но правило за ней есть (множитель к
   * вероятности ранения, `rules/injury.ts`) и опыт за возвращение с поля
   * начисляется — прятать её означало копить опыт, которого игрок не видит.
   * Сила, Рукопашный бой, Воля и Присутствие не показываются по той же причине
   * с другим знаком: за ними пока нет ни одного правила и ни одного источника
   * опыта, и строка «учить» обещала бы то, чего нет.
   */
  get skills(): readonly { readonly id: string; readonly key: string }[] {
    const grows = new Set(Object.values(PILOTS.progression.xp).flatMap((row) => row.skills));
    return PILOTS.skills.filter((s) => grows.has(s.id));
  }

  /** Сколько опыта стоит следующий уровень навыка. Считает ядро (`rules/skills.ts`). */
  trainCost(pilot: Pilot, skillId: string): number {
    return levelCost(pilot.skills[skillId] ?? 1);
  }

  /** Сколько суток займёт лечение этого пилота. Срок считает ядро (`company/medbay.ts`). */
  treatmentDays(pilot: Pilot): number {
    void this.version;
    return Math.max(1, Math.ceil(treatmentDays(pilot.injuries)));
  }

  /** Машина, за рычагами которой сидит пилот. */
  mechOf(pilot: Pilot): MechRecord | null {
    void this.version;
    return this.state.company.mechs.find((m) => m.pilotId === pilot.id) ?? null;
  }

  /**
   * Свободный id для нового наёмника.
   *
   * Не случайный: `HirePilot` отказывает на повторе id, и случайное имя однажды
   * совпало бы молча. Тот же приём, что у бот-менеджера (`sim/campaign/manager.ts`).
   */
  freePilotId(): string {
    void this.version;
    let n = this.state.company.pilots.length + 1;
    // i18n-ignore: id пилота записан в сохранения, игрок его не видит
    while (this.state.company.pilots.some((p) => p.id === `наёмник-${n}`)) n += 1;
    return `наёмник-${n}`; // i18n-ignore: см. строку выше
  }

  // --- найм (переработан 2026-09-10) ------------------------------------------

  /** Плата за ПОПЫТКУ поиска. Отказ её не возвращает — числа в `economy.json`. */
  get searchFee(): number {
    return ECONOMY.hiring.searchFee;
  }

  /** Раз в сколько суток даётся попытка. Показывается в подсказке казарм. */
  get searchIntervalDays(): number {
    return ECONOMY.hiring.searchIntervalDays;
  }

  /** Сколько суток ждать до следующей попытки. Ноль — можно искать сейчас. */
  get hireWaitDays(): number {
    void this.version;
    return Math.max(0, this.state.hireReadyDay - this.state.day);
  }

  /** Кандидат, по которому ещё не решили. `null` — объявление не давали. */
  get recruit(): Pilot | null {
    void this.version;
    return this.state.recruit;
  }

  // --- бой ---------------------------------------------------------------------

  /**
   * Брифинг боя, который СЕЙЧАС идёт: звено выведено, итог ещё не отдан.
   *
   * Нужен, чтобы вернуться на поле после перезагрузки страницы. Вылет
   * (`ActiveContract.sortie`) лежит в сохранении, а бой — нет: закрыв окно
   * посреди боя, игрок возвращается в кампанию, где звено на поле, но экрана
   * боя не существует. Брифинг — чистая функция от состояния и оба сида взяты
   * из вылета, поэтому по нему собирается ТОТ ЖЕ бой: та же карта, тот же
   * противник (`contracts/active.ts::contractBrief`). Отыгранные ходы при этом
   * теряются — бой начинается заново, — но это тот же самый бой, а не другой.
   *
   * `null`, когда возвращаться некуда: контракта нет, звено не выходило или бой
   * уже отыгран и ждёт разбора. Последнее важнее всего: пересобрать брифинг
   * отыгранного боя значило бы дать переиграть его заново.
   */
  get sortieBrief(): ReturnType<typeof contractBrief> | null {
    void this.version;
    if (this.campaign === null) return null;
    const active = this.state.contract;
    if (active === null || active.sortie === null) return null;
    // Только `pending`, НЕ `report`. Отчёт появляется, когда контракт уже закрыт
    // (`sortie` к этому моменту обнулён), и живёт до кнопки «закрыть» на
    // разборе. Уйди игрок с разбора вкладкой и возьми следующий контракт —
    // проверка отчёта глушила брифинг НОВОГО вылета, и `enterBattleScreen`
    // открывал прошлый бой вместо нового.
    if (this.pending !== null) return null;
    return contractBrief(this.state);
  }

  /**
   * Ошиблась ли разведка в ТЕКУЩЕМ вылете: на поле не столько машин, сколько обещала
   * сводка (шаг 61). `null` — сошлось, или вылета нет. Читается только в бою и на разборе:
   * до вылета факта нет, и показать его раньше значило бы убить разведку как механику.
   */
  get intelSurprise(): IntelSurprise | null {
    void this.version;
    if (this.campaign === null) return null;
    const active = this.state.contract;
    if (active === null || active.sortie === null) return null;
    return intelSurprise(active.contract, active.sortie.battleSeed);
  }

  /**
   * Вывести звено и уйти в бой.
   *
   * Команда фиксирует состав и сид, а состав боя собирает `contractBrief` —
   * чистая функция от состояния. Экран боя получает БРИФИНГ, а не сценарий из
   * адресной строки (п. 4 шага 17).
   */
  deploy(recordIds: readonly string[], auto = false): ReturnType<typeof contractBrief> | null {
    if (!this.run(auto ? { kind: 'deploy', recordIds, auto } : { kind: 'deploy', recordIds })) return null;
    this.sortieBefore = new Map(
      recordIds.map((id) => {
        const m = this.state.company.mechs.find((x) => x.id === id);
        const zones = m?.condition.zones ?? [];
        return [
          id,
          {
            name: m?.name ?? id,
            armor: zones.reduce((n, z) => n + z.armor, 0),
            structure: zones.reduce((n, z) => n + z.structure, 0),
            pilot: this.state.company.pilots.find((p) => p.id === m?.pilotId)?.callsign ?? null,
          },
        ];
      }),
    );
    return contractBrief(this.state);
  }

  /**
   * Рассчитать бой, не выходя на поле, — фича M10 «авто-расчёт боя» (шаг 18).
   *
   * Звено выводится той же командой `Deploy`, что и на поле: контракт не должен
   * знать, отыграли бой руками или посчитали. Итог идёт тем же путём, что итог
   * настоящего боя, — через выбор трофеев к `ResolveContract`.
   *
   * **С 2026-09-09 бой отыгрывается ПОЛНОСТЬЮ (`sim/autoBattle.ts::runOn`), а не
   * считается быстрым расчётом,** и это решение пользователя. Быстрый расчёт
   * появился шагом 18 ради ДВУХ задач разом: кнопки «не хочу отыгрывать эту
   * стычку» и потолка замера кампании. Вторая задача никуда не делась — фон и
   * батч-прогоны по-прежнему считаются им, и иначе нельзя: `pnpm worldstat`
   * гоняет десять тысяч боёв за прогон. А вот первой задаче цена другая: игрок
   * ждёт ОДИН бой, и секунда против сотой доли секунды ему безразлична.
   *
   * Замер 2026-09-09 показал, чего стоила экономия (`notes.md` §10b): у быстрого
   * расчёта нет карты, а значит нет и фазы сближения, и задачу «продержаться
   * одиннадцать ходов» он считает одиннадцатью раундами перестрелки в упор —
   * там, где отыгранный бой даёт победу почти без потерь. Полный бой этого
   * расхождения не имеет по построению: это тот же движок, та же карта и тот же
   * бот, что и когда игрок смотрит бой сам.
   *
   * Цена — время. Замер (та же машина, те же бои): звено против звена — доли
   * секунды, восемь на восемь — около двух секунд, двенадцать на двенадцать —
   * шесть, двадцать четыре на двадцать четыре — около сорока. Поэтому расчёт
   * идёт асинхронно: экран успевает нарисовать «штаб отыгрывает бой», и только
   * потом поток занимает бой.
   *
   * Отход здесь невозможен по определению: отвести звено с поля — это решение,
   * принимаемое ПО ХОДУ боя, а расчёт боя как раз означает, что игрок этот бой
   * штабу и отдал. Отказаться от работы можно до вылета (`AbandonContract`).
   */
  async autoResolve(recordIds: readonly string[]): Promise<boolean> {
    const brief = this.deploy(recordIds, true);
    if (brief === null) return false;
    this.resolving = true;
    this.version++;
    // Кадр на отрисовку подписи: дальше поток занят боем целиком.
    await new Promise((resolve) => setTimeout(resolve, 16));
    try {
      const units = brief.company.length + brief.enemy.length;
      const report = runOn(makeBattleFromBrief(brief), {
        seed: brief.battleSeed,
        // Потолок ходов — предохранитель от «два осторожных бота кружат по
        // большой карте», а не правило: у отыгранного контрактного боя потолка
        // ходов нет вовсе. Замер длины: 4 на 4 — 37 ходов, 12 на 12 — 53,
        // 24 на 24 — 83, то есть примерно ход на машину плюс тридцать. Четыре
        // хода на машину оставляют запас втрое.
        maxTurns: Math.max(60, units * 4),
      });
      this.battleFinished(report.outcome, false, true);
    } finally {
      this.resolving = false;
      this.version++;
    }
    return true;
  }

  /**
   * Бой отыгран. Здесь контракт ещё НЕ закрывается: между боем и
   * `ResolveContract` стоит выбор трофеев, и делает его игрок.
   */
  battleFinished(outcome: BattleOutcome, withdrew: boolean, auto = false): void {
    const active = this.state.contract;
    if (active === null) return;
    const xpBefore = new Map(this.state.company.pilots.map((p) => [p.id, totalXp(p)]));
    this.pending = {
      outcome,
      withdrew,
      contract: active.contract,
      xpBefore,
      before: this.sortieBefore,
      intelSurprise: this.intelSurprise,
      auto,
    };
    this.report = null;
    // Умолчание — то же, что сделал бы движок: самые дорогие, сколько
    // позволяют очки. Игрок вправе снять любую отметку.
    const offer = this.salvage;
    this.salvagePicked = new Set(offer === null ? [] : offer.trophies.slice(0, offer.points).map((m) => m.id));
    this.salvageScrapped = new Set();
    this.screen = 'debrief';
    this.version++;
  }

  get pendingBattle(): PendingBattle | null {
    void this.version;
    return this.pending;
  }

  /**
   * Что лежит на поле и сколько можно увезти.
   *
   * `salvageOffer` — чистая функция, состояния не трогает, поэтому её можно
   * звать при каждой перерисовке. Своего списка трофеев экран не считает.
   */
  get salvage(): SalvageOffer | null {
    void this.version;
    const p = this.pending;
    if (p === null || this.campaign === null) return null;
    return salvageOffer(this.campaign, p.outcome, p.withdrew);
  }

  toggleSalvage(recordId: string): void {
    const next = new Set(this.salvagePicked);
    if (next.has(recordId)) next.delete(recordId);
    else next.add(recordId);
    this.salvagePicked = next;
    // Забрать и разобрать одну машину нельзя: отметка снимается с другой
    // стороны сама, чтобы игрок не собирал заведомо отклоняемый выбор.
    if (this.salvageScrapped.has(recordId)) {
      const other = new Set(this.salvageScrapped);
      other.delete(recordId);
      this.salvageScrapped = other;
    }
  }

  /** Пометить трофей к разбору на поле: корпус остаётся, железо идёт на склад. */
  toggleScrap(recordId: string): void {
    const next = new Set(this.salvageScrapped);
    if (next.has(recordId)) next.delete(recordId);
    else next.add(recordId);
    this.salvageScrapped = next;
    if (this.salvagePicked.has(recordId)) {
      const other = new Set(this.salvagePicked);
      other.delete(recordId);
      this.salvagePicked = other;
    }
  }

  /**
   * Сколько очков утиля останется невостребованными и уйдёт в денежный выкуп.
   *
   * Показывается игроку до решения: очко, не потраченное ни на машину, ни на
   * разбор, не пропадает, а выкупается нанимателем (шаг 34).
   */
  /** Непогашенный заём Гильдии, если он есть (шаг 35). */
  get loan(): { readonly debt: number; readonly installment: number } | undefined {
    return this.state.company.loan;
  }

  /** Готова ли Гильдия дать заём: касса бедственная и прежний долг погашен. */
  get canTakeLoan(): boolean {
    return this.state.company.loan === undefined && this.state.company.cbills < ECONOMY.loan.eligibleBelow;
  }

  get loanPrincipal(): number {
    return ECONOMY.loan.principal;
  }

  get salvageUnused(): number {
    const offer = this.salvage;
    if (offer === null) return 0;
    return Math.max(0, offer.points - this.salvagePicked.size - this.salvageScrapped.size);
  }

  /** Отметить самые дорогие, сколько позволяют очки, — умолчание движка. */
  salvageDefault(): void {
    const offer = this.salvage;
    if (offer === null) return;
    this.salvagePicked = new Set(offer.trophies.slice(0, offer.points).map((m) => m.id));
    this.salvageScrapped = new Set();
  }

  /**
   * Закрыть контракт по итогам боя — тот самый шов боя в роту.
   *
   * Трофеи уходят полем `salvage`; движок по-прежнему умеет выбрать сам, если
   * поля нет, но экран выбор задаёт всегда — иначе кнопка «взять по умолчанию»
   * означала бы одно, а бездействие игрока другое.
   */
  resolve(): boolean {
    const p = this.pending;
    if (p === null) return false;
    const before = new Map(this.state.company.pilots.map((x) => [x.id, x]));
    const names = new Map(this.state.company.mechs.map((m) => [m.id, m.name]));
    const callsigns = new Map(this.state.company.pilots.map((x) => [x.id, x.callsign]));

    const state = this.state;
    const result = execute(state, {
      kind: 'resolveContract',
      outcome: p.outcome,
      withdrew: p.withdrew,
      salvage: [...this.salvagePicked],
      salvageScrap: [...this.salvageScrapped],
      auto: p.auto,
    });
    if (!result.ok) {
      this.lastReject = result.reason;
      return false;
    }
    this.lastReject = null;

    let resolved: ResolvedReport | null = null;
    const admitted: { pilot: string; days: number }[] = [];
    const lostPilots: string[] = [];
    const achievements: string[] = [];
    for (const e of result.events) {
      const line = lineOf(state, e);
      if (line !== null) this.logs = [line, ...this.logs].slice(0, LOG_LIMIT);
      if (e.kind === 'pilotAdmitted') admitted.push({ pilot: callsigns.get(e.pilotId) ?? e.pilotId, days: e.days });
      if (e.kind === 'pilotLost') lostPilots.push(callsigns.get(e.pilotId) ?? e.pilotId);
      if (e.kind === 'achievementUnlocked') achievements.push(e.id);
      if (e.kind === 'contractResolved') {
        resolved = {
          result: e.result,
          settlement: e.settlement,
          salvagePoints: e.salvagePoints,
          salvageAvailable: e.salvageAvailable,
          trophies: e.trophyRecordIds.map((id) => nameOfMech(state, id)),
          lost: e.lostRecordIds.map((id) => names.get(id) ?? id),
          admitted: [],
          lostPilots: [],
          xpGain: [],
          levelUps: [],
          intelSurprise: p.intelSurprise,
          achievements: [],
        };
      }
    }

    // Опыт уходит в уровни сам (`rules/skills.ts::settleTraining`), поэтому
    // заработанное — это остаток на счету ПЛЮС потраченное на выросшие уровни.
    // Голая разность остатков ушла бы в минус у того, кто вырос, и такой пилот
    // пропал бы из разбора ровно тогда, когда ему есть чем похвастаться.
    const xpGain: { pilot: string; xp: number }[] = [];
    const levelUps: { pilot: string; skill: string; level: number }[] = [];
    for (const x of state.company.pilots) {
      const was = before.get(x.id);
      if (was === undefined) continue;
      let spent = 0;
      for (const s of PILOTS.skills) {
        const from = was.skills[s.id] ?? 0;
        const to = x.skills[s.id] ?? 0;
        for (let l = from; l < to; l++) spent += levelCost(l);
        if (to > from) levelUps.push({ pilot: x.callsign, skill: s.key, level: to });
      }
      const xp = totalXp(x) + spent - totalXp(was);
      if (xp > 0) xpGain.push({ pilot: x.callsign, xp });
    }

    this.noteReputation(state, result.events);
    this.noteWar(state, result.events);
    this.report =
      resolved === null ? null : { ...resolved, admitted, lostPilots, xpGain, levelUps, achievements };
    this.pending = null;
    this.version++;
    void this.save();
    return true;
  }

  /** Достижения роты (шаг 69): открытые с днями и счёт добиваний. */
  get achievements(): AchievementsState {
    void this.version;
    return this.state.achievements;
  }

  /** Главы кампании (шаг 70): выводятся из состояния заново, в сохранении их нет. */
  get progress(): CampaignProgress {
    void this.version;
    return campaignProgress(this.state);
  }

  get resolvedReport(): ResolvedReport | null {
    void this.version;
    return this.report;
  }

  /**
   * Ждёт ли разбор полётов: отыгранный бой (pending) или уже закрытый отчёт (resolvedReport).
   */
  get hasDebrief(): boolean {
    void this.version;
    return this.pending !== null || this.report !== null;
  }

  /** Разбор закрыт: вернуться в ангар и забыть отчёт. */
  closeDebrief(): void {
    this.report = null;
    this.pending = null;
    this.screen = 'hangar';
    this.version++;
  }

  // --- сохранение ---------------------------------------------------------------

  /**
   * Запись в хранилище браузера.
   *
   * Молча провалиться она не имеет права: в приватном окне квота может быть
   * нулевой, и игрок обязан узнать об этом до того, как потеряет кампанию
   * (game_core.md §9, п. 3).
   */
  async save(): Promise<void> {
    if (this.campaign === null) return;
    this.saving = true;
    try {
      const file = makeSaveFile(snapshot(this.campaign));
      await this.storage.save(SLOT, new TextEncoder().encode(JSON.stringify(file)));
      this.hasSave = true;
      this.storageFailed = false;
      await saveCachedLogs(this.storage, {
        seed: this.campaign.seed,
        day: this.campaign.day,
        companyName: this.campaign.companyName,
        logs: this.logs,
        warLog: this.warLog,
        repLog: this.repLog,
      }).catch(() => {});
    } catch {
      this.storageFailed = true;
    } finally {
      this.saving = false;
    }
  }

  /**
   * Выгрузка кампании в файл.
   *
   * Поставка сайтом означает, что кампания живёт в IndexedDB и пропадает вместе
   * с очисткой данных сайта. Это две кнопки, а не механика (шаг 17, п. 3).
   */
  exportFile(): void {
    const file = makeSaveFile(snapshot(this.state));
    const blob = new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = t('save.fileName', {
      company: this.state.companyName.replace(/[^\p{L}\p{N}-]+/gu, '-'),
      day: this.state.day,
    });
    a.click();
    URL.revokeObjectURL(url);
  }

  /** Загрузка кампании из файла. Заменяет текущую целиком. */
  async importFile(file: File): Promise<boolean> {
    try {
      const json: unknown = JSON.parse(await file.text());
      this.adopt(restore(parseSaveFile(json)));
      this.notice = null;
      await this.save();
      return true;
    } catch (err) {
      this.notice =
        err instanceof IncompatibleSaveError
          ? t('save.wrongVersion', { file: err.fileVersion, game: CAMPAIGN_RULES_VERSION })
          : t('save.badFile');
      return false;
    }
  }
}

/** Сумма опыта по всем навыкам — им меряется прирост после боя. */
function totalXp(pilot: Pilot): number {
  return Object.values(pilot.xp).reduce((sum, v) => sum + v, 0);
}

export const campaign = new CampaignUi();

export { CampaignUi, COMPANY_EMBLEM_COUNT, findMech };

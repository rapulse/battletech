import { ECONOMY } from '../../data/index.js';
import { applyRealmPolicies, isFrontTarget } from '../realm/policy.js';
import { realmTitle } from '../realm/titles.js';
import { realmArmyCap, realmArmyUpkeep } from '../realm/army.js';
import {
  isGovernor,
  realmBonuses,
  sectorAt,
  sectorLimit,
  realmIsDefault,
  sectorJumps,
  sectorLive,
  type FrontStance,
  type RealmState,
} from '../realm/sectors.js';
import type { GovernorPriority } from '../war/schema.js';
import { isVital, zoneFromId, type ZoneId } from '../../model/HitZone.js';
import type { QualityClass } from '../../model/QualityClass.js';
import { awardXp, trainSkill } from '../../rules/skills.js';
import { rollRecruit } from '../company/recruit.js';
import {
  dateOf,
  insertScheduled,
  nextDue,
  type RepairWork,
  type ScheduledEvent,
  type ScheduledTask,
} from '../clock.js';
import { attemptReplacePart, replacePartPlan, zoneRepairPlan, applyZoneRepair } from '../company/jobs.js';
import { applyRefit, isRefittable, isStripOnly, refitPlan } from '../company/refit.js';
import { isPaintId, repaintCost, REPAINT_DAYS, withPaint } from '../mech/repaint.js';
import { admitToMedbay, dischargeFromMedbay, restPilot, REST_DAYS } from '../company/medbay.js';
import { applyPayroll, chargeUnavoidable, payrollAmount } from '../company/payroll.js';
import {
  garrisonAt,
  garrisonRevoltSeed,
  garrisonWorlds,
  isStationed,
  policyOf,
  prunePosts,
  retreatTarget,
  shipboardMechs,
  withPolicy,
  withPosts,
  relocatePosts,
  garrisonCount,
  depotCount,
  type GarrisonPolicy,
} from '../company/garrison.js';
import {
  mechCapacityOf,
  withMech,
  withPilot,
  type Company,
  type WarehouseEntry,
  type WarehousePart,
} from '../company/types.js';
import type { DropshipId } from '../../data/schema.js';
import type { Pilot } from '../../model/Pilot.js';
import { FACTIONS, FACTION_LIST } from '../galaxy/catalog.js';
import {
  GALAXY,
  GALAXY_RULES,
  TRANSIT_DAYS,
  findRoute,
  isAdjacent,
  isShipyard,
  isSurveyed,
  developmentOf,
  focusOf,
  memoryOf,
  ownerOf,
  tributeOf,
  worldProfile,
  developmentMaxAt,
  developmentStepMatters,
  rechargeDays,
  withDelta,
  withWorldMemory,
  type Route,
  type WorldFocus,
} from '../galaxy/index.js';
import { debrief, survivingCompanyIds } from '../debrief/index.js';
import { fastResolve } from '../bridge/fastResolve.js';
import { awardBattle, awardState } from '../achievements/index.js';
import type { BattleOutcome } from '../bridge/fromBattle.js';
import { RELATIONS } from '../contracts/schema.js';
import {
  CONTRACTS,
  availableContracts,
  briefFor,
  companyRating,
  contractResultOf,
  revoltContract,
  homeRaidContract,
  postHomeRaids,
  contractBrief,
  contractDecadeOf,
  clearedOf,
  factionKind,
  fieldOnly,
  frontierIndexAt,
  landingQuote,
  opforCount,
  reputationOutcomeOf,
  salvageOffer,
  withPirateClearing,
  PIRATE_FACTION,
  type Contract,
} from '../contracts/index.js';
import {
  REPUTATION,
  applyReputation,
  contractReputation,
  decayReputation,
  diplomacyReputation,
  hireTierBonus,
  relationOf,
  standingOf,
  withRelation,
  withStanding,
  type ReputationDeltas,
  type ReputationOutcome,
} from '../reputation/index.js';
import { hasIntactStructure, hasPatches, isWreck, withQuality, type MechRecord, type WearNode } from '../mech/MechRecord.js';
import {
  getChassisCatalogEntry,
  validateAssembly,
  FRAME_TIER_COUNT,
  REACTOR_TIER_COUNT,
  type MechAssembly,
} from '../../rules/construction.js';
import { CHASSIS_CATALOG, CHASSIS_CATALOG_LIST } from '../../data/index.js';
import { nodeCost, recordNodeSpec, restoreJob, replaceJob } from '../mech/repair.js';
import {
  availableMechs,
  availableStock,
  decadeOf,
  installPlan,
  itemCost,
  itemKindOf,
  marketProfile,
  mechValue,
  nodeValue,
  salvagedNode,
  orderPrice,
  scrapPlan,
  scrapSalvage,
  sellPrice,
  sellsClass,
  type DemandKey,
  type MarketProfile,
} from '../market/index.js';
import { rivalTick } from '../rivals/tick.js';
import { greatHirePrice, hireBlocker, hiredRegiment, hireStation, type HireBlocker } from '../rivals/hire.js';
import type { CampaignState } from '../state.js';
import { nextEconomyTickDay } from '../state.js';
import { atSite, baySite, type BaySite } from '../bays.js';
import {
  WAR,
  canSubmit,
  protectorateByPeace,
  economyOf,
  placeWarFund,
  developmentTick,
  domainBorder,
  bordersOf,
  growthOf,
  realmAlarm,
  capitalMoveReadyDay,
  domainCapitalIndex,
  withPlayerCapitalPinned,
  applyPlayerPeace,
  atWarWithPlayer,
  applyOffensive,
  foeOffensives,
  orderLance,
  planOffensive,
  boundOrTruced,
  declarePlayerWar,
  exhaustedSide,
  peaceOutcome,
  peaceTerms,
  warGoalValid,
  type WarGoal,
  playerWarOf,
  holdPlayerWars,
  notePlayerCapture,
  domainTally,
  domainWorlds,
  nextToDomain,
  pactPrice,
  protectoratePrice,
  isPlayerRealm,
  regimentPrice,
  regimentRefund,
  tributePrice,
  imposeTribute,
  pactOf,
  signPact,
  shift,
  suzerainOf,
  tributeFlows,
  withVassal,
  worldPrice,
  PLAYER_ACTOR_ID,
  worldContributionAt,
  withEconomy,
  withConquest,
  economyTick,
  frontSectors,
  frontTick,
  eventTick,
  inviteTerms,
  cardOpen,
  demandTick,
  answerDemand,
  frontWeights,
  frontShares,
  theaterJumps,
  warActors,
  syncDomainEconomy,
  totalArmy,
  theatersOf,
  withTheater,
  fundOf,
  withFund,
  fundsOf,
  withCompanyEffort,
  applySystemCapture,
  notePlanCapture,
  withTheaterLoss,
  withPlayerWar,
  notePlayerLosses,
  isPlayerActor,
  acquiredPatch,
  LOYALTY_CLEARED,
  buildingsLostPatch,
  buildingsLostSince,
  realmMarketOf,
  developCostAt,
  depotCapOf,
  garrisonCapOf,
  garrisonHireFee,
  buildBlocker,
  buildEtaDecades,
  buildTick,
  buildingCost,
  buildingRefund,
  constructionOf,
  CONSTRUCTION_CLEARED,
  domainBuildingsUpkeep,
  startPatch,
  type BuildBlocker,
  type BuildingKind,
  realmBuildSnapshot,
  type RealmBuildSnapshot,
  loyaltyTick,
  withLoyaltyWin,
  armyQuellRevolts,
  inRevolt,
  fitLance,
  type FrontClash,
  type GarrisonClash,
  type GarrisonSource,
  type LoyaltyOrigin,
} from '../war/index.js';
import {
  ok,
  reject,
  CampaignRejectReason,
  type CampaignCommand,
  type CampaignCommandResult,
  type CampaignEvent,
  type OrderSpec,
} from './types.js';

/**
 * Единственная точка изменения состояния кампании.
 *
 * Зеркало `core/commands/execute.ts`. Отклонённая команда не имеет права
 * оставить след: ни в состоянии, ни в ГПСЧ, ни в очереди. Иначе повтор по
 * журналу разойдётся с оригиналом на первом же отказе — в бою это правило
 * закреплено тестом, здесь оно закреплено тем же способом.
 *
 * Шаг 13 добавляет ангар: ремонт, склад, казармы, деньги — команды и их
 * применение по сроку (`applyTask`), когда задача из очереди подошла. Шаг 14
 * добавляет место: перелёт по маршруту, прыжок и разведка системы.
 */
/**
 * Исполнить команду кампании.
 *
 * Обёртка над разбором команд ради одного: держава (шаг 72c — рота хотя бы с
 * одним миром) не хранится, а рождает её и снимает что угодно — покупка,
 * захват, лен, потеря последнего мира на фронте. Поэтому событие рождается
 * здесь, сравнением до и после, а не в каждой из команд и тактов.
 */
export function execute(state: CampaignState, command: CampaignCommand): CampaignCommandResult {
  const realmBefore = isPlayerRealm(state.deltas);
  const titleBefore = realmTitle(state.deltas)?.id ?? null;
  const hadLoan = state.company.loan !== undefined;
  const result = executeCommand(state, command);
  if (!result.ok) return result;
  const extra: CampaignEvent[] = [];
  const realmAfter = isPlayerRealm(state.deltas);
  if (realmAfter !== realmBefore) extra.push({ kind: 'realmChanged', realm: realmAfter });
  // Титул державы (шаг 89) — из числа миров сейчас; сменился любой командой или тактом — одна строка журнала.
  const titleAfter = realmTitle(state.deltas)?.id ?? null;
  if (titleAfter !== titleBefore) extra.push({ kind: 'realmTitleChanged', from: titleBefore, to: titleAfter });
  // Достижения из состояния роты (шаг 69): касса, корабль, парк, слава. Здесь,
  // а не в каждой команде, которая может их дать, — таких команд полтора
  // десятка, и забытая однажды молча не открыла бы значок.
  for (const id of awardState(state, { hadLoan })) extra.push({ kind: 'achievementUnlocked', id });
  return extra.length === 0 ? result : ok([...result.events, ...extra]);
}

function executeCommand(state: CampaignState, command: CampaignCommand): CampaignCommandResult {
  switch (command.kind) {
    case 'advance':
      return executeAdvance(state, state.day + command.days);
    case 'advanceTo':
      return executeAdvance(state, command.day);
    case 'schedule':
      return executeSchedule(state, command.day, command.task);
    case 'setCompanyName':
      return executeRename(state, command.name);
    case 'repairZone':
      return executeRepairZone(state, command.recordId, command.zone);
    case 'upgradeClass':
      return executeUpgradeClass(state, command.recordId, command.node, command.targetClass);
    case 'restoreWorn':
      return executeRestoreWorn(state, command.recordId, command.node);
    case 'replacePart':
      return executeReplacePart(state, command.recordId, command.zone);
    case 'scrapMech':
      return executeScrapMech(state, command.recordId);
    case 'assignPilot':
      return executeAssignPilot(state, command.recordId, command.pilotId);
    case 'reorderMechs':
      return executeReorderMechs(state, command.order);
    case 'searchRecruit':
      return executeSearchRecruit(state, command.id);
    case 'hireRecruit':
      return executeHireRecruit(state);
    case 'rejectRecruit':
      return executeRejectRecruit(state);
    case 'dismissPilot':
      return executeDismissPilot(state, command.pilotId);
    case 'trainPilot':
      return executeTrainPilot(state, command.pilotId, command.skillId);
    case 'treatPilot':
      return executeTreatPilot(state, command.pilotId);
    case 'cancelJob':
      return executeCancelJob(state, command.jobId);
    case 'travel':
      return executeTravel(state, command.systemId, false);
    case 'jump':
      return executeTravel(state, command.systemId, true);
    case 'survey':
      return executeSurvey(state);
    case 'proposePact':
      return executeProposePact(state, command.factionId, command.pact);
    case 'declareWar':
      return executeDeclareWar(state, command.factionId, command.goal);
    case 'answerEvent':
      return executeAnswerEvent(state, command.id, command.accept);
    case 'makePeace':
      return executeMakePeace(state, command.factionId, command.cede === true, command.protectorate === true);
    case 'buyOffTribute':
      return executeBuyOffTribute(state, command.systemId);
    case 'demandTribute':
      return executeDemandTribute(state, command.systemId);
    case 'offerProtectorate':
      return executeOfferProtectorate(state, command.factionId);
    case 'buyWorld':
      return executeBuyWorld(state);
    case 'conquerWorld':
      return executeConquerWorld(state);
    case 'claimGrant':
      return executeClaimGrant(state);
    case 'setWorldFocus':
      return executeSetWorldFocus(state, command.systemId, command.focus);
    case 'abandonWorld':
      return executeAbandonWorld(state, command.systemId);
    case 'moveCapital':
      return executeMoveCapital(state, command.systemId);
    case 'developWorld':
      return executeDevelopWorld(state, command.systemId);
    case 'raiseRegiment':
      return executeRaiseRegiment(state, command.mechs);
    case 'setWarBudget':
      return executeSetWarBudget(state, command.share);
    case 'fundWar':
      return executeFundWar(state, command.amount);
    case 'orderOffensive':
      return executeOrderOffensive(state, command.systemId);
    case 'garrisonUnload':
      return executeGarrisonUnload(state, command.recordIds);
    case 'garrisonLoad':
      return executeGarrisonLoad(state, command.recordIds);
    case 'setGarrisonPolicy':
      return executeSetGarrisonPolicy(state, command.systemId, command.policy);
    case 'startBuilding':
      return executeStartBuilding(state, command.systemId, command.building);
    case 'cancelBuilding':
      return executeCancelBuilding(state, command.systemId);
    case 'appointGovernor':
      return executeAppointGovernor(state, command.centerId, command.pilotId, command.priority);
    case 'setSectorPriority':
      return executeSetSectorPriority(state, command.centerId, command.priority);
    case 'releaseGovernor':
      return executeReleaseGovernor(state, command.centerId);
    case 'pinWorld':
      return executePinWorld(state, command.systemId, command.pinned);
    case 'setRealmReserve':
      return executeSetRealmReserve(state, command.amount);
    case 'setFrontStance':
      return executeSetFrontStance(state, command.factionId, command.stance);
    case 'setStanceTarget':
      return executeSetStanceTarget(state, command.factionId, command.systemId);
    case 'assignWorldSector':
      return executeAssignWorldSector(state, command.systemId, command.center);
    case 'hireGreatRegiment':
      return executeHireGreatRegiment(state, command.regimentId, command.against);
    case 'answerDemand':
      return executeAnswerDemand(state, command.accept);
    case 'buyPart':
      return executeBuyPart(state, command.lotId);
    case 'sellPart':
      return executeSellPart(state, command.partId);
    case 'orderPart':
      return executeOrderPart(state, command.items);
    case 'installPart':
      return executeInstallPart(state, command.recordId, command.partId);
    case 'sellMech':
      return executeSellMech(state, command.recordId);
    case 'refitMech':
      return executeRefitMech(state, command.recordId, command.assembly);
    case 'repaintMech':
      return executeRepaintMech(state, command.recordId, command.paint);
    case 'upgradeBays':
      return executeUpgradeBays(state);
    case 'upgradeHangar':
      return executeUpgradeHangar(state);
    case 'upgradeDropship':
      return executeUpgradeDropship(state);
    case 'buyMech':
      return executeBuyMech(state, command.lotId);
    case 'takeContract':
      return executeTakeContract(state, command.contractId);
    case 'abandonContract':
      return executeAbandonContract(state);
    case 'deploy':
      return executeDeploy(state, command.recordIds, command.auto === true);
    case 'takeLoan':
      return executeTakeLoan(state);
    case 'takeSandboxLoan':
      return executeTakeSandboxLoan(state);
    case 'repaySandboxLoan':
      return executeRepaySandboxLoan(state);
    case 'resolveContract':
      return executeResolveContract(
        state,
        command.outcome,
        command.withdrew === true,
        command.salvage,
        command.salvageScrap,
        command.auto === true,
      );
  }
}

/**
 * Предохранитель от задачи, которая ставит саму себя на тот же день.
 *
 * Такая петля — ошибка в правилах, а не решение игрока, поэтому она бросает
 * исключение с внятным текстом, а не молча вешает прогон. Порог заведомо выше
 * любого осмысленного числа работ: десять лет ежедневных задач на весь отряд
 * не наберут и десятой доли.
 */
const MAX_TASKS_PER_ADVANCE = 100_000;

/**
 * Отказ прокрутки до дня `target` — без самой прокрутки.
 *
 * Прокрутка отказывает только на входе: дальше она идёт задача за задачей и
 * встаёт сама (карточка события), но не отклоняется. Поэтому `canExecute` спрашивает
 * её здесь, а не прогоном на копии: прогон пробных 1 + 7 + 30 дней для трёх кнопок
 * шапки шёл на каждое изменение состояния и с державой стоил дороже самой
 * прокрутки (2026-10-04).
 */
export function advanceRejection(state: CampaignState, target: number): CampaignRejectReason | null {
  if (target <= state.day) return CampaignRejectReason.NonPositiveSpan;
  if (cardOpen(state.war)) return CampaignRejectReason.EventPending;
  return null;
}

/**
 * Прокрутка времени.
 *
 * Время доходит до каждой задачи, а не перепрыгивает её: задача, назначенная
 * на 5-й день, исполняется, когда `state.day` уже равен пяти. Это важно для
 * шагов 13–16 — работа, поставленная другой работой, обязана считать сроки от
 * своего дня, а не от конца прокрутки.
 */
function executeAdvance(state: CampaignState, target: number): CampaignCommandResult {
  const refused = advanceRejection(state, target);
  if (refused !== null) return reject(refused);

  const from = state.day;
  const events: CampaignEvent[] = [];

  let guard = 0;
  for (;;) {
    const due = nextDue(state.queue, target);
    if (due === undefined) break;

    if (++guard > MAX_TASKS_PER_ADVANCE) {
      throw new RangeError(
        `Очередь задач не исчерпалась за ${MAX_TASKS_PER_ADVANCE} шагов: ` +
          `похоже, задача «${due.task.kind}» ставит саму себя на тот же день`,
      );
    }

    state.day = Math.max(state.day, due.day);
    state.queue = state.queue.slice(1);

    events.push({ kind: 'taskDue', day: due.day, seq: due.seq, task: due.task });
    events.push(...applyTask(state, due));
    // КАРТОЧКА СОБЫТИЯ ОСТАНАВЛИВАЕТ ВРЕМЯ (шаг 84): прокрутка встаёт в день события, остальные
    // задачи того же дня ждут в очереди и исполнятся следующей прокруткой, после ответа. Требование соседа
    // (шаг 89) — такая же карточка.
    if (cardOpen(state.war)) {
      events.push({ kind: 'dayAdvanced', from, to: state.day });
      return ok(events);
    }
  }

  state.day = target;
  events.push({ kind: 'dayAdvanced', from, to: target });
  return ok(events);
}

/**
 * Что происходит, когда задача подошла по сроку: содержание роты, возвращение
 * пилота из лазарета, завершение работы стапеля. Задача имеет право поставить
 * новую (зарплата переставляет сама себя) — `advance` подхватит её в том же
 * прокруте, если срок уже подошёл.
 */
function applyTask(state: CampaignState, event: ScheduledEvent): CampaignEvent[] {
  switch (event.task.kind) {
    case 'debug':
      return [];
    case 'payroll':
      return applyPayrollTask(state, event.day);
    case 'medbayDone':
      return applyMedbayTask(state, event.task.pilotId);
    case 'restTick':
      return applyRestTask(state, event.day);
    case 'repairJob':
      return applyRepairJobTask(state, event.task);
    case 'travelLeg':
      return applyTravelLegTask(state, event.task.leg);
    case 'surveyDone':
      return applySurveyTask(state, event.task.systemId);
    case 'deliveryArrived':
      return applyDeliveryTask(state, event.task.orderId, event.task.part);
    case 'contractExpired':
      return applyContractExpiredTask(state, event.task.contractId, event.day);
    case 'baysUpgraded':
      return applyBaysUpgradedTask(state, event.task.to);
    case 'hangarUpgraded':
      return applyHangarUpgradedTask(state, event.task.to);
    case 'decayTick':
      return applyDecayTask(state, event.day);
    case 'economyTick':
      return applyEconomyTask(state, event.day);
    case 'frontTick':
      return applyFrontTask(state, event.day);
    case 'developmentTick':
      return applyDevelopmentTask(state, event.day);
    case 'eventTick':
      return applyEventTask(state, event.day);
    case 'rivalTick':
      return applyRivalTask(state, event.day);
  }
}

/**
 * Такт соперников (шаг 22): их содержание, ремонт, найм, работа и их бои.
 *
 * Идёт СЛЕДОМ за тактом фронта того же дня: фракции сперва копят и воюют, потом
 * наёмники разбирают то, что из этого вышло. Порядок держит номер постановки в
 * очередь (`state.ts`), а не совпадение.
 *
 * Такт правит ТРИ поля состояния разом — соперников, дельты систем и войну, — и
 * это не расползание: работа, взятая соперником, вычёркивается из биржи тем же
 * швом, что и работа, взятая ротой (`taken` в дельте системы), а выигранный
 * соперником контракт кладёт нанимателю в военный фонд ровно так же, как
 * выигранный ротой (`war/front.ts::withCompanyEffort`). Второго способа
 * «контракт занят» и второго способа «рота повлияла на войну» в игре нет.
 */
function applyRivalTask(state: CampaignState, day: number): CampaignEvent[] {
  const result = rivalTick({
    rivals: state.rivals,
    deltas: state.deltas,
    war: state.war,
    worldRep: state.reputation,
    worldSeed: state.worldSeed,
    day,
    playerSystemId: state.systemId,
    playerRating: companyRating(state.company).total,
    rngs: state.rng,
  });
  state.rivals = result.rivals;
  state.deltas = result.deltas;
  state.war = result.war;

  const events: CampaignEvent[] = [];
  for (const c of result.contracts) events.push({ kind: 'rivalContract', ...c });
  for (const m of result.moves) events.push({ kind: 'rivalMoved', ...m });
  for (const g of result.gone) events.push({ kind: 'rivalGone', ...g });
  for (const c of result.commissions) events.push({ kind: 'regimentCommission', ...c });
  for (const m of result.regimentMoves) events.push({ kind: 'regimentMoved', ...m });
  for (const e of result.regimentHireEnds) events.push({ kind: 'greatRegimentHireEnded', ...e });

  const seq = state.nextSeq;
  state.nextSeq = seq + 1;
  const nextDay = nextEconomyTickDay(day);
  state.queue = insertScheduled(state.queue, { day: nextDay, seq, task: { kind: 'rivalTick' } });
  events.push({ kind: 'taskScheduled', day: nextDay, seq, task: { kind: 'rivalTick' } });
  return events;
}

/**
 * Вернуть в кассу роты то, что роспуск фонда положил в казну державы (проект державы, шаг 2).
 *
 * Казна державы роты — отражение кассы (`war/domain.ts::syncDomainEconomy`), и два стока военного
 * фонда, общие для всех держав, кладут распущенное именно в казну: `demobilize` (враг перестал быть
 * врагом) и `releaseIdleFunds` (на направлении не воевали). У фракции это деньги в её казне; у роты
 * без этой строки они пропали бы при ближайшей синхронизации. Отражение сдвигается вместе с кассой,
 * чтобы «казна равна кассе» оставалось правдой и между синхронизациями.
 */
function returnRealmFunds(state: CampaignState, treasuryBefore: number): void {
  const eco = state.war.economy[PLAYER_ACTOR_ID];
  if (eco === undefined) return;
  const back = eco.treasury - treasuryBefore;
  if (back <= 0) return;
  state.company = { ...state.company, cbills: state.company.cbills + back };
}

/**
 * Такт экономики фракций (шаг 21a).
 *
 * Самопереставляющаяся задача, как содержание роты и затухание репутации, — и
 * по той же причине: мир обязан жить, пока рота чинится, летит и стоит без
 * работы. Следующий такт назначается на границу декады, а не «через десять дней
 * от сегодня»: биржа читает экономику, и такт посреди декады менял бы состав
 * предложений при неизменном сиде биржи (`state.ts::nextEconomyTickDay`).
 */
function applyEconomyTask(state: CampaignState, day: number): CampaignEvent[] {
  // ДЕРЖАВА ИГРОКА ОБНОВЛЯЕТСЯ ПЕРВОЙ (шаг 27, часть C): её экономика — не
  // приращение, а пересчёт по сорока мирам домена, и логистике с фронтом она
  // нужна уже сегодняшней. Разбор, почему пересчёт здесь законен, а для
  // фракций нет, — `war/domain.ts::syncDomainEconomy`.
  const before = syncDomainEconomy(state.war, state.worldSeed, state.deltas, state.company.cbills);
  state.war = before;
  // Фонд расходится по направлениям с оглядкой на ФРОНТ (шаг 21b): участки
  // считаются здесь, а не хранятся, — они и есть владение, прочитанное по
  // соседям. Проход по каталогу стоит около миллисекунды раз в декаду.
  //
  // Потоки подчинения (шаг 26) считаются ЗДЕСЬ ЖЕ и передаются тактом внутрь.
  // Они не входят в `income` фракции и не правятся приращением намеренно: доход
  // означает «со своих миров», и на этом стоит тест, сверяющий приращение с
  // полным пересчётом по каталогу. Разбор — `war/economy.ts::tributeFlows`.
  const flows = tributeFlows(before, state.worldSeed, state.deltas, day);
  // Участки считаются здесь ОДИН РАЗ и служат обоим звеньям такта: раскладке
  // военного фонда (шаг 21b) и переброске полков (шаг 27). Логистике от них
  // нужны две производные — доли направлений во фронте и плечо до ближайшего
  // участка каждого направления, — и обе O(число участков) по уже готовому
  // списку. Ни `findRoute`, ни `jumpDistance` здесь нет и быть не может: они
  // стоят обхода каталога, а участков около пятисот за декаду.
  const sectors = frontSectors(before, state.reputation, state.deltas, day);
  const weights = frontWeights(sectors);
  state.war = economyTick(before, state.reputation, weights, flows, {
    shares: frontShares(weights),
    jumps: theaterJumps(state.deltas, sectors),
    actors: warActors(state.deltas),
  });
  // Распущенный военный фонд роты (`economy.ts::demobilize`) лёг в казну державы, а она у роты —
  // отражение кассы, и синхронизация ниже его перезаписала бы (проект державы, шаг 2).
  returnRealmFunds(state, economyOf(before, PLAYER_ACTOR_ID).treasury);

  const events: CampaignEvent[] = [];
  for (const f of FACTION_LIST) {
    const was = economyOf(before, f.id);
    const now = economyOf(state.war, f.id);
    // Событие пишется, только если такт что-то изменил: у фракции, чей доход в
    // точности равен содержанию, ничего не произошло, и строка в сводке о ней
    // была бы шумом. Двадцать строк на каждую декаду забили бы журнал целиком.
    let fund = 0;
    for (const row of fundsOf(state.war, f.id)) fund += row.amount;
    let fundBefore = 0;
    for (const row of fundsOf(before, f.id)) fundBefore += row.amount;
    if (now.treasury === was.treasury && fund === fundBefore) continue;
    events.push({
      kind: 'factionEconomyTicked',
      factionId: f.id,
      surplus: now.income - now.upkeep,
      treasuryAfter: now.treasury,
      warFundAfter: fund,
    });
  }

  // Домен роты (шаг 25, часть C) кормится тем же тактом, что и державы, и теми
  // же функциями дохода и содержания. Разница одна: деньги идут в КАССУ, а не в
  // казну фракции, — у роты нет ни военного фонда, ни замысла, ни фронта.
  const domain = domainTally(state.worldSeed, state.deltas);
  if (domain.worlds.length > 0) {
    // Дань с миров роты и дань, которую рота собирает, идут той же строкой, что
    // у держав: карта потоков возвращается по ВСЕМ акторам, и здесь берётся её
    // строка (`war/economy.ts::tributeFlows`). Содержание полевой армии (проект
    // державы, шаг 1) — отдельной строкой: у фракций оно своё, `economy.armyUpkeep`.
    const army = realmArmyUpkeep(state.war, state.deltas, state.realm).total;
    // ПОСТРОЙКИ (шаг 87): содержание — из итога до доли войны, как содержание армии; очки стройки — каждому миру.
    const buildings = domainBuildingsUpkeep(state.deltas);
    const net = domain.income - domain.upkeep - army - buildings + (flows[PLAYER_ACTOR_ID] ?? 0);
    // ВОЕННЫЙ БЮДЖЕТ (проект державы, шаг 2): назначенная игроком доля итога уходит в военный
    // фонд той же раскладкой, что у фракций (`placeWarFund`), только из положительного итога —
    // убыток державы фонд не трогает, его покрывает касса. Без живых врагов не ложится ничего.
    const share = state.war.realmWarShare ?? 0;
    let fund = 0;
    if (net > 0 && share > 0) {
      const placed = placeWarFund(
        state.war,
        state.reputation,
        PLAYER_ACTOR_ID,
        Math.round(net * share),
        weights[PLAYER_ACTOR_ID],
      );
      state.war = placed.war;
      fund = placed.placed;
    }
    state.company = { ...state.company, cbills: Math.max(0, state.company.cbills + net - fund) };
    events.push({
      kind: 'domainTicked',
      worlds: domain.worlds.length,
      income: domain.income,
      upkeep: domain.upkeep,
      army,
      fund,
      buildings,
    });
    const built = buildTick(state.worldSeed, state.deltas, realmBonuses(state.deltas, state.realm, state.company.pilots));
    state.deltas = built.deltas;
    for (const d of built.done) events.push({ kind: 'buildingDone', systemId: d.systemId, building: d.kind });
  }

  // И ЕЩЁ РАЗ В КОНЦЕ ТАКТА: доход домена только что лёг в кассу, а казна
  // державы игрока — её проекция. Без второй строки снимок хранил бы казну
  // на декаду отстающей от кассы, и «казна равна кассе» перестало бы быть
  // проверяемым утверждением.
  state.war = syncDomainEconomy(state.war, state.worldSeed, state.deltas, state.company.cbills);

  const seq = state.nextSeq;
  state.nextSeq = seq + 1;
  const nextDay = nextEconomyTickDay(day);
  state.queue = insertScheduled(state.queue, { day: nextDay, seq, task: { kind: 'economyTick' } });
  events.push({ kind: 'taskScheduled', day: nextDay, seq, task: { kind: 'economyTick' } });
  return events;
}

/**
 * Такт фронта (шаг 21b): наступления по участкам, смена владельцев, клановые
 * набеги, заживление разорения.
 *
 * Единственное место, где мир меняет владельца системы, — и ровно поэтому
 * `SystemDelta.owner`, заведённое шагом 14 с пометкой «шаг 21», до сих пор никем
 * не писалось.
 *
 * Броски идут из потока `camp.war` состояния, а не из выведенного из сида мира,
 * и это отличие от биржи: биржа — свойство МИРА (одна и та же система на одном и
 * том же сиде выглядит одинаково, сколько на неё ни смотри), а фронт — свойство
 * КАМПАНИИ, он идёт вперёд и обязан продолжиться с того же места после загрузки.
 */
function applyFrontTask(state: CampaignState, day: number): CampaignEvent[] {
  // Гарнизон без пилота нанимает его сам (шаг 86b): до боёв декады, чтобы машина могла драться.
  const crewEvents = crewGarrison(state, day);
  const builtBefore = realmBuildSnapshot(state.deltas);
  const treasuryBefore = economyOf(state.war, PLAYER_ACTOR_ID).treasury;
  const armyBefore = totalArmy(state.war, PLAYER_ACTOR_ID);
  // Губернатор сектора (шаг 88, tactics) крепит оборону миров роты; без губернаторов — пустая карта.
  const defenceBonuses = realmBonuses(state.deltas, state.realm, state.company.pilots);
  const result = frontTick(
    state.war,
    state.deltas,
    state.reputation,
    state.worldSeed,
    day,
    state.rng.stream('camp.war'),
    garrisonSource(state, day),
    defenceBonuses.size === 0 ? undefined : (system) => defenceBonuses.get(GALAXY.id(system))?.defence ?? 1,
  );
  state.war = result.war;
  // Роспуск по бездействию (`economy.ts::releaseIdleFunds`) вернул долю фонда роты в казну державы —
  // деньги роты, и лежать им место в кассе (проект державы, шаг 2).
  returnRealmFunds(state, treasuryBefore);
  state.deltas = result.deltas;

  // Матрица отношений ФРАКЦИЙ друг к другу — единственное поле репутации,
  // которое двигает не рота, а мир. Шаг 20 завёл её и читает (по ней расходится
  // «враг моего врага», `reputation/accrual.ts`), а пишет её только такт войны:
  // ровно ради этого порядок шагов 20 → 21 и не менялся.
  //
  // До шага 26 подвижка была одна и её считали ЗДЕСЬ, перебирая ходы. Теперь
  // родов подвижки шесть, четыре из них рождаются внутри такта дипломатии и
  // сюда не долетают вовсе, — поэтому матрицу двигает сам такт и возвращает уже
  // сдвинутой. Правило «пишет только такт войны» от этого не ослабло, а стало
  // проверяемым: второго места, где она меняется, в коде больше нет.
  state.reputation = result.reputation;

  const events: CampaignEvent[] = [...crewEvents];
  events.push(...result.plans.map((p): CampaignEvent => ({
    kind: 'warPlan',
    factionId: p.factionId,
    against: p.against,
    systemId: p.systemId,
    result: p.kind,
  })));
  for (const m of result.moves) events.push({
    kind: 'frontMoved',
    systemId: m.systemId,
    kindOfMove: m.kind,
    attacker: m.attacker,
    defender: m.defender,
    ruined: m.ruined,
    odds: m.odds,
    attackerSize: m.attackerSize,
    defenderSize: m.defenderSize,
    attackerLost: m.attackerLost,
    defenderLost: m.defenderLost,
  });
  // Бои с державой роты при любом исходе и их итог за такт (шаг 78). Итог — одной строкой, даже
  // когда самих боёв много: «армия потеряла N машин в M боях» — то, по чему игрок решает, сколько
  // держать под ружьём.
  for (const c of result.clashes) {
    const { garrison, ...line } = c;
    if (garrison === undefined) events.push({ kind: 'frontClash', ...line });
    else events.push(...settleGarrisonClash(state, line, garrison, day));
  }
  for (const w of result.warsEnded) events.push({ kind: 'warEnded', factionId: w.factionId, how: w.how });
  // НАСТУПЛЕНИЯ ФРАКЦИЙ ПО ЦЕЛИ (шаг 91) — после такта, до мира на пределе: взятое ими ложится в усталость этой декады.
  const foe = foeOffensives(
    state.war,
    state.reputation,
    state.deltas,
    state.worldSeed,
    day,
    garrisonSource(state, day),
    defenceBonuses.size === 0 ? undefined : (system) => defenceBonuses.get(GALAXY.id(system))?.defence ?? 1,
  );
  state.war = foe.war;
  state.deltas = foe.deltas;
  state.reputation = foe.reputation;
  for (const m of foe.moves) {
    events.push({
      kind: 'frontMoved',
      systemId: m.systemId,
      kindOfMove: m.kind,
      attacker: m.attacker,
      defender: m.defender,
      ruined: m.ruined,
      odds: m.odds,
      attackerSize: m.attackerSize,
      defenderSize: m.defenderSize,
      attackerLost: m.attackerLost,
      defenderLost: m.defenderLost,
    });
  }
  for (const c of foe.clashes) {
    const { garrison, ...line } = c;
    if (garrison === undefined) events.push({ kind: 'frontClash', ...line });
    else events.push(...settleGarrisonClash(state, line, garrison, day));
  }
  // МИР НА ПРЕДЕЛЕ УСТАЛОСТИ (шаг 81; правило Stellaris) — в конце такта, когда потери его боёв уже
  // легли в усталость: «как есть», без отступных и без цели, лишнее взятое — назад.
  for (const f of Object.keys(state.war.playerWars ?? {}).sort()) {
    const side = exhaustedSide(state.war, f);
    if (side !== undefined) events.push(concludePeace(state, f, false, 0, undefined, side));
  }
  if (result.clashes.length + foe.clashes.length > 0) {
    events.push({
      kind: 'realmFrontTally',
      battles: result.clashes.length + foe.clashes.length,
      armyBefore,
      armyAfter: totalArmy(state.war, PLAYER_ACTOR_ID),
    });
  }
  // ЛОЯЛЬНОСТЬ МИРОВ РОТЫ (шаг 85) — после мира на пределе: война декады уже решена. Восставший мир, не
  // подавленный в срок, отходит прежнему владельцу тем же швом, что отказ и уступка.
  // ГАРНИЗОН ПРОТИВ ВОССТАНИЯ (шаг 86b) — до такта лояльности: подавленное восстание не отходит в срок.
  events.push(...applyGarrisonRevolts(state, day));
  // АРМИЯ ПРОТИВ ВОССТАНИЯ (шаг 90) — после гарнизона и до такта лояльности: последний шанс до отпадения.
  const quell = armyQuellRevolts(state.deltas, state.war, day);
  state.deltas = quell.deltas;
  state.war = quell.war;
  for (const systemId of quell.quelled) {
    events.push({ kind: 'worldRevoltSuppressed', systemId, by: 'army', mechs: WAR.loyalty.armyQuellLoss });
  }
  const loyal = loyaltyTick(state.deltas, state.war, state.reputation, day, realmBonuses(state.deltas, state.realm, state.company.pilots));
  state.deltas = loyal.deltas;
  for (const systemId of loyal.revolts) {
    events.push({ kind: 'worldRevolt', systemId, formerOwner: state.deltas[systemId]?.formerOwner ?? '' });
  }
  for (const s of loyal.seceded) {
    handWorldFromPlayer(state, GALAXY.require(s.systemId), s.to);
    events.push({ kind: 'worldSeceded', systemId: s.systemId, to: s.to });
  }
  // Миры, ушедшие от роты за такт (взяты, отпали, отданы по миру на пределе усталости), — гарнизон уходит,
  // постройки снесены или спят (шаг 87).
  events.push(...evacuateLostWorlds(state, day));
  events.push(...buildingLossEvents(builtBefore, state));

  for (const d of result.diplomacy) {
    events.push({
      kind: 'diplomacyMoved',
      move: d.kind,
      over: d.over,
      under: d.under,
      ...(d.systemId === undefined ? {} : { systemId: d.systemId }),
      ...(d.pact === undefined ? {} : { pact: d.pact }),
      ...(d.against === undefined ? {} : { against: d.against }),
      ...(d.leader === undefined ? {} : { leader: d.leader }),
    });
  }

  // ПОЛИТИКИ ДЕРЖАВЫ (шаг 88) — последними: война, мир и лояльность декады решены. Сперва убрать то, что
  // потеряло опору (стойка без войны, сектор без центра), затем стойки и губернаторы отдают команды тем же
  // диспетчером, что у игрока.
  // ТРЕБОВАНИЕ СОСЕДА (шаг 89) — после войны, мира и лояльности декады: карточка останавливает прокрутку.
  const demanded = demandTick(state.war, state.reputation, state.deltas, state.worldSeed, day);
  state.war = demanded.war;
  if (demanded.card !== undefined) events.push({ kind: 'demandIssued', from: demanded.card.from, systemId: demanded.card.systemId });
  events.push(...settleRealm(state));
  events.push(
    ...applyRealmPolicies(state, (command) => {
      const r = executeCommand(state, command);
      return r.ok ? r.events : null;
    }),
  );

  const seq = state.nextSeq;
  state.nextSeq = seq + 1;
  const nextDay = nextEconomyTickDay(day);
  state.queue = insertScheduled(state.queue, { day: nextDay, seq, task: { kind: 'frontTick' } });
  events.push({ kind: 'taskScheduled', day: nextDay, seq, task: { kind: 'frontTick' } });
  return events;
}

/**
 * Гарнизоны миров роты для боя такта (шаг 86b): годные прибывшие машины мира и можно ли отойти — политика
 * «отходить» и свой мир в прыжке на карте этого боя.
 */
function garrisonSource(state: CampaignState, day: number): GarrisonSource {
  return (system, deltas) => {
    const systemId = GALAXY.id(system);
    // Рота на корабле в этой системе, без контракта, дерётся вместе с гарнизоном (шаг 86b, по итогам замера).
    const aboard =
      state.travel === null && state.contract === null && state.systemId === systemId
        ? shipboardMechs(state.company, state.garrison)
        : [];
    const lance = fitLance(state, [...garrisonAt(state.company, state.garrison, systemId, day), ...aboard]);
    if (lance.length === 0) return undefined;
    const mayWithdraw = policyOf(state.garrison, systemId) === 'withdraw' && retreatTarget(deltas, system, day) !== null;
    return { lance, mayWithdraw };
  };
}

/** Машина на корабле или на мире той системы, где стоит рота (шаг 86b): до неё можно дотянуться. */
function withinReach(state: CampaignState, recordId: string): boolean {
  const post = state.garrison.posts[recordId];
  if (post === undefined) return true;
  return state.travel === null && state.systemId === post.systemId && post.arrives <= state.day;
}

/**
 * Гарнизон без пилота нанимает его сам (шаг 86b, решение пользователя 2026-10-01 после замера): каждая прибывшая
 * машина на мире без пилота получает новичка по цене поиска (`hiring.searchFee`), если касса позволяет. Ждать роту
 * не нужно — иначе машина, потерявшая пилота в бою, стояла бы на мире без дела. Срок поиска игрока не трогается.
 * Бросок — поток `camp.events`, как у поиска; без гарнизона поток не сдвигается.
 */
function crewGarrison(state: CampaignState, day: number): CampaignEvent[] {
  const events: CampaignEvent[] = [];
  for (const m of state.company.mechs) {
    const post = state.garrison.posts[m.id];
    // Склад (шаг 87) — машины без пилота по замыслу: автонайм их не трогает.
    if (post === undefined || post.depot === true || post.arrives > day || m.pilotId !== null || isWreck(m)) continue;
    // Казармы мира (шаг 87) удешевляют автонайм.
    const cost = garrisonHireFee(state.deltas, post.systemId, ECONOMY.hiring.searchFee);
    const spent = spend(state.company, cost);
    if (spent === null) break;
    const id = `garrison-${m.id}-${day}`;
    const pilot = rollRecruit(state.rng.stream('camp.events'), id, hireTierBonus(state.reputation.fame));
    state.company = {
      ...spent,
      pilots: [...spent.pilots, pilot],
      mechs: spent.mechs.map((x) => (x.id === m.id ? { ...x, pilotId: pilot.id } : x)),
    };
    events.push({ kind: 'garrisonPilotHired', systemId: post.systemId, recordId: m.id, pilotId: pilot.id, cost });
  }
  return events;
}

/** Посты машин на мире (прибывшие и в пути), в порядке ангара. */
function postedAt(state: CampaignState, systemId: string): string[] {
  return state.company.mechs.filter((m) => state.garrison.posts[m.id]?.systemId === systemId).map((m) => m.id);
}

/**
 * Разбор гарнизона в бою такта (шаг 86b, решение пользователя 2026-10-01 п. 5) — как у роты в приказе
 * (шаг 86): урон в записях ангара, выбывшие на потерянном поле теряются, ранения и опыт — `debrief`, опыт за
 * работу — только за выигранное столкновение. Отход по политике — на свой мир в прыжке (п. 8).
 */
function settleGarrisonClash(
  state: CampaignState,
  line: Omit<FrontClash, 'garrison'>,
  g: GarrisonClash,
  day: number,
): CampaignEvent[] {
  if (g.withdrew || g.clash === undefined) {
    const moved = postedAt(state, line.systemId);
    const target = retreatTarget(state.deltas, GALAXY.require(line.systemId), day);
    const events: CampaignEvent[] = [
      {
        kind: 'frontClash',
        ...line,
        garrison: { mechs: moved.length, detachment: g.detachment, knocked: 0, lostRecordIds: [], withdrew: true },
      },
    ];
    // Свой мир в прыжке пропал посреди такта — гарнизон остаётся; ушёл мир — его уведёт `evacuateLostWorlds`.
    if (target !== null) {
      state.garrison = relocatePosts(state.garrison, moved, target);
      events.push({
        kind: 'garrisonWithdrawn',
        from: line.systemId,
        to: target.systemId,
        arrives: target.arrives,
        recordIds: moved,
        reason: 'policy',
      });
    }
    return events;
  }
  const c = g.clash;
  const debriefed = debrief({ brief: c.brief, outcome: c.outcome, rng: state.rng, contractDone: c.outcome.heldField });
  const inClash = new Set(c.brief.company.map((p) => p.record.id));
  const company: Company = { ...state.company, mechs: inPlace(state.company.mechs, inClash, debriefed.company) };
  const pilotEvents = settlePilots(state, company, debriefed.pilots);
  state.garrison = prunePosts(state.garrison, state.company);
  return [
    {
      kind: 'frontClash',
      ...line,
      garrison: {
        mechs: c.brief.company.length,
        detachment: c.detachment,
        knocked: c.knocked,
        lostRecordIds: [...debriefed.lostRecordIds],
        withdrew: false,
      },
    },
    ...pilotEvents,
  ];
}

/**
 * Бой гарнизона с восстанием (шаг 86b, решение пользователя 2026-10-01 п. 6): восставший мир роты с годным
 * гарнизоном даёт бой в такте — против того же противника, что у работы «подавить восстание» этой декады.
 * Разбор — как у авторасчёта контракта без гонорара и трофеев; победа — как победа в этой работе.
 */
function applyGarrisonRevolts(state: CampaignState, day: number): CampaignEvent[] {
  const events: CampaignEvent[] = [];
  for (const systemId of garrisonWorlds(state.garrison)) {
    if (!inRevolt(state.deltas, systemId) || !isPlayerActor(ownerOf(state.deltas, systemId))) continue;
    const lance = fitLance(state, garrisonAt(state.company, state.garrison, systemId, day));
    if (lance.length === 0) continue;
    const contract = revoltContract(state.worldSeed, state.deltas, systemId, day, state.reputation, state.war);
    if (contract === undefined) continue;
    const seed = garrisonRevoltSeed(state.worldSeed, systemId, day);
    const brief = briefFor(contract, lance, seed, seed);
    const outcome = fastResolve(brief);
    const won = contractResultOf(outcome, false) === 'won';
    const debriefed = debrief({
      brief,
      outcome: { ...outcome, heldField: won && outcome.heldField },
      rng: state.rng,
      contractDone: won,
    });
    const inClash = new Set(lance.map((p) => p.record.id));
    const company: Company = { ...state.company, mechs: inPlace(state.company.mechs, inClash, debriefed.company) };
    const pilotEvents = settlePilots(state, company, debriefed.pilots);
    state.garrison = prunePosts(state.garrison, state.company);
    if (won) state.deltas = withLoyaltyWin(state.deltas, systemId, true);
    events.push(
      {
        kind: 'garrisonRevoltBattle',
        systemId,
        won,
        mechs: lance.length,
        enemy: brief.enemy.length,
        lostRecordIds: [...debriefed.lostRecordIds],
      },
      ...pilotEvents,
    );
  }
  events.push(...applyGarrisonHomeRaids(state, day));
  return events;
}

/**
 * ГАРНИЗОН ПРОТИВ ВОЛЬНИЦЫ (шаг 89): тем же порядком, что восстание, — гарнизон мира бьёт работу «пираты у дома»
 * авторасчётом. Победа — мир вычищен, работа снята. Сид — свой, из мира и дня.
 */
function applyGarrisonHomeRaids(state: CampaignState, day: number): CampaignEvent[] {
  const events: CampaignEvent[] = [];
  for (const systemId of garrisonWorlds(state.garrison)) {
    if (!isPlayerActor(ownerOf(state.deltas, systemId))) continue;
    const contract = homeRaidContract(state.worldSeed, state.deltas, systemId, day, state.reputation, state.war);
    if (contract === undefined) continue;
    const lance = fitLance(state, garrisonAt(state.company, state.garrison, systemId, day));
    if (lance.length === 0) continue;
    const seed = (garrisonRevoltSeed(state.worldSeed, systemId, day) ^ 0x2545f491) >>> 0;
    const brief = briefFor(contract, lance, seed, seed);
    const outcome = fastResolve(brief);
    const won = contractResultOf(outcome, false) === 'won';
    const debriefed = debrief({
      brief,
      outcome: { ...outcome, heldField: won && outcome.heldField },
      rng: state.rng,
      contractDone: won,
    });
    const inClash = new Set(lance.map((p) => p.record.id));
    const company: Company = { ...state.company, mechs: inPlace(state.company.mechs, inClash, debriefed.company) };
    const pilotEvents = settlePilots(state, company, debriefed.pilots);
    state.garrison = prunePosts(state.garrison, state.company);
    if (won) {
      state.deltas = withLoyaltyWin(state.deltas, systemId, false);
      state.deltas = withPirateClearing(state.deltas, GALAXY.require(systemId));
      state.deltas = withDelta(state.deltas, systemId, { raidedUntil: undefined });
    }
    events.push(
      {
        kind: 'garrisonRaidBattle',
        systemId,
        won,
        mechs: lance.length,
        enemy: brief.enemy.length,
        lostRecordIds: [...debriefed.lostRecordIds],
      },
      ...pilotEvents,
    );
    if (won) events.push({ kind: 'homeRaidRepelled', systemId, by: 'garrison' });
  }
  return events;
}

/** Миры снимка, ушедшие от роты (шаг 87): журналу — что снесено, что спит, какой недострой пропал. */
function buildingLossEvents(before: RealmBuildSnapshot, state: CampaignState): CampaignEvent[] {
  return buildingsLostSince(before, state.deltas).map((b) => ({ kind: 'buildingsLost', ...b }));
}

/**
 * Мир ушёл от роты, а на нём гарнизон (шаг 86b): машины уходят на свой мир в прыжке, как при отходе; своего
 * мира в прыжке нет — гарнизон потерян вместе с пилотами. В ангар корабля он не возвращается: места там
 * может не быть (решение пользователя 2026-10-01 п. 3).
 */
function evacuateLostWorlds(state: CampaignState, day: number): CampaignEvent[] {
  const events: CampaignEvent[] = [];
  for (const systemId of garrisonWorlds(state.garrison)) {
    if (isPlayerActor(ownerOf(state.deltas, systemId))) continue;
    // Корабль роты здесь — на него грузится, сколько поместится (прибывшие машины); остальные уходят как раньше.
    if (state.travel === null && state.systemId === systemId) {
      const room = mechCapacityOf(state.company) - shipboardMechs(state.company, state.garrison).length;
      const board = postedAt(state, systemId)
        .filter((id) => (state.garrison.posts[id]?.arrives ?? Infinity) <= day)
        .slice(0, Math.max(0, room));
      if (board.length > 0) {
        state.garrison = withPosts(state.garrison, board, null);
        events.push({ kind: 'garrisonLoaded', systemId, recordIds: board });
      }
    }
    const ids = postedAt(state, systemId);
    if (ids.length === 0) continue;
    const target = retreatTarget(state.deltas, GALAXY.require(systemId), day);
    if (target !== null) {
      state.garrison = relocatePosts(state.garrison, ids, target);
      events.push({
        kind: 'garrisonWithdrawn',
        from: systemId,
        to: target.systemId,
        arrives: target.arrives,
        recordIds: ids,
        reason: 'worldLost',
      });
      continue;
    }
    const lost = new Set(ids);
    const pilotIds = new Set(
      state.company.mechs.filter((m) => lost.has(m.id) && m.pilotId !== null).map((m) => m.pilotId as string),
    );
    state.company = {
      ...state.company,
      mechs: state.company.mechs.filter((m) => !lost.has(m.id)),
      pilots: state.company.pilots.filter((p) => !pilotIds.has(p.id)),
    };
    state.garrison = withPosts(state.garrison, ids, null);
    events.push({ kind: 'garrisonLost', systemId, recordIds: ids });
    for (const pilotId of pilotIds) events.push({ kind: 'pilotLost', pilotId });
  }
  return events;
}

/**
 * Выгрузить машины гарнизоном на мир, где стоит рота (шаг 86b): свой мир, не в перелёте; машина на корабле,
 * с пилотом и не в звене взятого контракта. Побитая — тоже (решение пользователя 2026-10-01 п. 2).
 *
 * Шаг 87: гарнизон мира — не больше предела (звено, с казармами — рота); машина без пилота встаёт на склад мира,
 * если он есть и в нём есть место. Предел считается только здесь: отход и эвакуация везут машины сверх него.
 */
function executeGarrisonUnload(state: CampaignState, recordIds: readonly string[]): CampaignCommandResult {
  if (state.travel !== null) return reject(CampaignRejectReason.AlreadyTravelling);
  if (!isPlayerActor(ownerOf(state.deltas, state.systemId))) return reject(CampaignRejectReason.NotOwned);
  if (recordIds.length === 0 || new Set(recordIds).size !== recordIds.length) {
    return reject(CampaignRejectReason.BadLance);
  }
  const sortie = new Set(state.contract?.sortie?.recordIds ?? []);
  const depotRoom = depotCapOf(state.deltas, state.systemId) - depotCount(state.garrison, state.systemId);
  const crewed: string[] = [];
  const stored: string[] = [];
  for (const id of recordIds) {
    const record = state.company.mechs.find((m) => m.id === id);
    if (record === undefined) return reject(CampaignRejectReason.MechNotFound);
    if (isStationed(state.garrison, id)) return reject(CampaignRejectReason.MechStationed);
    if (sortie.has(id)) return reject(CampaignRejectReason.MechInSortie);
    (record.pilotId === null ? stored : crewed).push(id);
  }
  if (stored.length > 0 && depotCapOf(state.deltas, state.systemId) === 0) {
    return reject(CampaignRejectReason.GarrisonNeedsPilot);
  }
  if (stored.length > depotRoom) return reject(CampaignRejectReason.DepotFull);
  if (garrisonCount(state.garrison, state.systemId) + crewed.length > garrisonCapOf(state.deltas, state.systemId)) {
    return reject(CampaignRejectReason.GarrisonFull);
  }
  const post = { systemId: state.systemId, arrives: state.day };
  state.garrison = withPosts(state.garrison, crewed, post);
  state.garrison = withPosts(state.garrison, stored, { ...post, depot: true });
  return ok([{ kind: 'garrisonUnloaded', systemId: state.systemId, recordIds: [...recordIds] }]);
}

/** Забрать машины гарнизона этой системы на корабль (шаг 86b): рота здесь, машина прибыла, есть место. */
function executeGarrisonLoad(state: CampaignState, recordIds: readonly string[]): CampaignCommandResult {
  if (state.travel !== null) return reject(CampaignRejectReason.AlreadyTravelling);
  if (recordIds.length === 0 || new Set(recordIds).size !== recordIds.length) {
    return reject(CampaignRejectReason.BadLance);
  }
  for (const id of recordIds) {
    const post = state.garrison.posts[id];
    if (post === undefined || post.systemId !== state.systemId || post.arrives > state.day) {
      return reject(CampaignRejectReason.NotInGarrison);
    }
  }
  const aboard = shipboardMechs(state.company, state.garrison).length;
  if (aboard + recordIds.length > mechCapacityOf(state.company)) return reject(CampaignRejectReason.HangarFull);
  state.garrison = withPosts(state.garrison, recordIds, null);
  return ok([{ kind: 'garrisonLoaded', systemId: state.systemId, recordIds: [...recordIds] }]);
}

/** Политика гарнизона мира державы (шаг 86b). Ставится на любой свой мир, заранее — и без гарнизона. */
function executeSetGarrisonPolicy(
  state: CampaignState,
  systemId: string,
  policy: GarrisonPolicy,
): CampaignCommandResult {
  if (!GALAXY.has(systemId)) return reject(CampaignRejectReason.SystemNotFound);
  if (!isPlayerActor(ownerOf(state.deltas, systemId))) return reject(CampaignRejectReason.NotOwned);
  state.garrison = withPolicy(state.garrison, systemId, policy);
  return ok([{ kind: 'garrisonPolicySet', systemId, policy }]);
}

/**
 * Такт событий мира (шаг 84): вехи эпохи из `data/events.json` (`war/events.ts::eventTick`).
 * Сработавшее встаёт открытой карточкой — прокрутка останавливается на ней (`executeAdvance`).
 */
function applyEventTask(state: CampaignState, day: number): CampaignEvent[] {
  const result = eventTick(state.war, state.reputation, state.deltas, state.worldSeed, day);
  state.war = result.war;
  state.reputation = result.reputation;
  const events: CampaignEvent[] = result.fired.map((f) => ({
    kind: 'worldEvent',
    id: f.id,
    realm: f.realm,
    invite: state.war.events[f.id]?.invite !== undefined,
  }));

  const seq = state.nextSeq;
  state.nextSeq = seq + 1;
  const nextDay = nextEconomyTickDay(day);
  state.queue = insertScheduled(state.queue, { day: nextDay, seq, task: { kind: 'eventTick' } });
  events.push({ kind: 'taskScheduled', day: nextDay, seq, task: { kind: 'eventTick' } });
  return events;
}

/**
 * Ответ на карточку события (шаг 84). Простая карточка закрывается. Приглашение в коалицию
 * требует выбора: принять — война державы с врагом коалиции (если её ещё нет) и прибавка к
 * отношению союзников к роте; отказать — убавка. Война объявляется теми же правилами, что
 * командой `declareWar`: договор с врагом или подчинение — отказ с той же причиной.
 */
function executeAnswerEvent(state: CampaignState, id: string, accept: boolean | undefined): CampaignCommandResult {
  const record = state.war.events[id];
  if (record === undefined || !record.pending) return reject(CampaignRejectReason.EventNotPending);
  const invite = record.invite;
  const terms = inviteTerms(id);
  if (invite !== undefined && (accept === undefined || terms === undefined)) {
    return reject(CampaignRejectReason.EventAnswerRequired);
  }

  const events: CampaignEvent[] = [];
  if (invite !== undefined && terms !== undefined) {
    if (accept === true && !atWarWithPlayer(state.war, state.reputation, invite.against, state.day)) {
      const declared = executeDeclareWar(state, invite.against, undefined);
      if (!declared.ok) return declared;
      events.push(...declared.events);
    }
    const delta = accept === true ? terms.accept : terms.decline;
    let rep = state.reputation;
    for (const ally of invite.allies) rep = withStanding(rep, ally, delta);
    state.reputation = rep;
  }
  state.war = { ...state.war, events: { ...state.war.events, [id]: { ...record, pending: false } } };
  events.push({
    kind: 'worldEventAnswered',
    id,
    ...(invite === undefined || accept === undefined ? {} : { accept }),
  });
  return ok(events);
}

/**
 * Такт развития планет (шаг 23, часть A): стройка на деньги казны и упадок
 * выжженных войной миров.
 *
 * Идёт СЛЕДОМ за тактом фронта того же дня, и это порядок самого круга: границы
 * сперва двигаются, и только потом хозяин считает, что ему досталось и что он
 * готов отстроить. Порядок держит номер постановки в очередь (`state.ts`), а не
 * совпадение.
 *
 * Броски идут из потока `camp.war` — того же, что у фронта, и это не экономия
 * на потоке: стройка и война — одно и то же решение государства, принятое в
 * один день, и разводить их по разным потокам значило бы утверждать, что мир
 * может воевать в одной ветке случайности, а строить в другой.
 */
function applyDevelopmentTask(state: CampaignState, day: number): CampaignEvent[] {
  const result = developmentTick(
    state.war,
    state.deltas,
    state.reputation,
    state.worldSeed,
    day,
    state.rng.stream('camp.war'),
  );
  state.war = result.war;
  state.deltas = result.deltas;

  const events: CampaignEvent[] = result.moves.map((m) => ({
    kind: 'worldDeveloped',
    systemId: m.systemId,
    owner: m.owner,
    from: m.from,
    to: m.to,
    built: m.kind === 'built',
  }));
  for (const m of result.focusMoves) {
    events.push({
      kind: 'worldFocus',
      systemId: m.systemId,
      owner: m.owner,
      from: m.from,
      to: m.to,
      started: m.kind === 'started',
    });
  }

  // ПИРАТЫ У ДОМА (шаг 89): прорвавшийся набег на мир роты выставляет на его бирже оборону на срок.
  const posted = postHomeRaids(state.deltas, result.raids, day);
  state.deltas = posted.deltas;
  for (const p of posted.posted) events.push({ kind: 'homeRaidPosted', ...p });
  for (const r of result.raids) {
    events.push({
      kind: 'pirateRaid',
      systemId: r.systemId,
      owner: r.owner,
      ruined: r.ruined,
      sacked: r.sacked,
    });
  }

  const seq = state.nextSeq;
  state.nextSeq = seq + 1;
  const nextDay = nextEconomyTickDay(day);
  state.queue = insertScheduled(state.queue, { day: nextDay, seq, task: { kind: 'developmentTick' } });
  events.push({ kind: 'taskScheduled', day: nextDay, seq, task: { kind: 'developmentTick' } });
  return events;
}

function applyPayrollTask(state: CampaignState, day: number): CampaignEvent[] {
  const amount = payrollAmount(state.company);
  state.company = applyPayroll(state.company, day);

  const seq = state.nextSeq;
  state.nextSeq = seq + 1;
  const nextDay = day + ECONOMY.payroll.intervalDays;
  state.queue = insertScheduled(state.queue, { day: nextDay, seq, task: { kind: 'payroll' } });

  return [
    { kind: 'payrollPaid', amount, cbillsAfter: state.company.cbills, bankrupt: state.company.bankrupt },
    { kind: 'taskScheduled', day: nextDay, seq, task: { kind: 'payroll' } },
  ];
}

/**
 * Выписка из лазарета — сама работа лечения (`company/medbay.ts`).
 *
 * Постановку в лазарет (перевод пилота в `out` со сроком лечения) делает
 * шаг 16 вместе с `ResolveContract`: до контрактов пилоту неоткуда получить
 * травму внутри поверхности команд этого шага. Задача существует и
 * исполняется уже сейчас — так же, как `awardXp` была написана в шаге 11 и
 * подключена лишь в шаге 12 (опора §1 «Чего нет вовсе»).
 */
/**
 * ОТДЫХ РОТЫ: раз в декаду у каждого пилота в строю заживает одна травма
 * (`company/medbay.ts::restPilot`, правка 2026-09-08).
 *
 * Задача переставляет себя сама — как содержание и затухание репутации. Правило
 * заживления живёт в `medbay.ts`, здесь только круг времени и события: экран
 * обязан сказать игроку, что ветеран поправился, иначе число в казармах меняется
 * молча.
 */
function applyRestTask(state: CampaignState, day: number): CampaignEvent[] {
  const events: CampaignEvent[] = [];
  const pilots = state.company.pilots.map((p) => {
    const next = restPilot(p);
    if (next !== p) events.push({ kind: 'pilotRested', pilotId: p.id, injuries: next.injuries });
    return next;
  });
  state.company = { ...state.company, pilots };

  const seq = state.nextSeq;
  state.nextSeq = seq + 1;
  const nextDay = day + REST_DAYS;
  state.queue = insertScheduled(state.queue, { day: nextDay, seq, task: { kind: 'restTick' } });
  events.push({ kind: 'taskScheduled', day: nextDay, seq, task: { kind: 'restTick' } });
  return events;
}

function applyMedbayTask(state: CampaignState, pilotId: string): CampaignEvent[] {
  const pilot = state.company.pilots.find((p) => p.id === pilotId);
  if (pilot === undefined) return [];
  state.company = withPilot(state.company, dischargeFromMedbay(pilot));
  return [{ kind: 'pilotRecovered', pilotId }];
}

/** Машина могла покинуть ростер (списана раньше, чем позволяет `MechHasPendingJob`, — на будущее); тогда работа молча теряется. */
function applyRepairJobTask(
  state: CampaignState,
  task: Extract<ScheduledTask, { kind: 'repairJob' }>,
): CampaignEvent[] {
  const record = state.company.mechs.find((m) => m.id === task.recordId);
  if (record === undefined) return [];

  const done: CampaignEvent = {
    kind: 'jobCompleted',
    jobId: task.jobId,
    recordId: task.recordId,
    work: task.work,
    success: true,
  };

  let success = true;
  let next: MechRecord;
  const extra: CampaignEvent[] = [];
  switch (task.work) {
    case 'repairZone':
      next = applyZoneRepair(record, task.zone as ZoneId);
      break;
    case 'upgradeClass': {
      // Повышение класса — это ПОКУПКА нового узла и установка его вместо
      // старого (`mech/repair.ts::replaceJob`, «Повышение — покупка, а не
      // ремонт»). Значит и снятое ложится на склад, ровно как при установке
      // узла со склада и при переоснащении мехлабом (шаг 45). Тир при этом не
      // меняется: класс и тир — разные оси.
      const node = task.node as WearNode;
      const stowed = stowNode(state, record, node);
      state.company = {
        ...state.company,
        warehouse: [...state.company.warehouse, stowed],
      };
      extra.push({ kind: 'partStowed', recordId: record.id, partId: stowed.id, node });
      next = withQuality(record, node, task.targetClass as QualityClass);
      // Новый КАРКАС с рынка — тот же случай, что заводская переборка со
      // склада (`applyInstall`): запас прочности из шага 66 обнуляется, машина
      // копит потери заново уже на новом узле.
      if (node === 'frame') {
        next = { ...next, condition: { ...next.condition, frameLossCount: 0 } };
      }
      break;
    }
    case 'restoreWorn': {
      const node = task.node as WearNode;
      next = { ...record, wear: { ...record.wear, [node]: 0 } };
      break;
    }
    case 'replacePart': {
      const result = attemptReplacePart(record, task.zone as ZoneId, state.rng.stream('camp.events'));
      next = result.record;
      success = result.success;
      break;
    }
    case 'scrapMech':
      return [{ ...done }, applyScrap(state, record)];
    case 'installPart':
      return [{ ...done }, ...applyInstall(state, record, task.partId as string)];
    case 'refitMech':
      return [
        { ...done },
        applyRefitTask(state, record, task.assembly as MechAssembly, task.partIds ?? []),
      ];
    case 'repaintMech':
      state.company = withMech(state.company, withPaint(record, task.paint));
      return [{ ...done }, { kind: 'mechRepainted', recordId: record.id, paint: task.paint ?? null }];
  }

  state.company = withMech(state.company, next);
  awardRepairXp(state, record, task.work, success);
  return [{ ...done, success }, ...extra];
}

/**
 * Опыт Техники за полевой ремонт (`design/pilots/skills.md`).
 *
 * Кому: ПИЛОТУ ЭТОЙ МАШИНЫ. Отдельного техника у роты нет ни в модели, ни в
 * ростере, а в каноне наёмников свою машину чинит экипаж вместе с водителем —
 * поэтому «успешный полевой ремонт» записывается тому, кто на ней ездит.
 * Машина без пилота учит некого, и опыт просто не начисляется.
 *
 * Не всякая работа стапеля — ремонт: повышение класса, установка узла со склада
 * и переоснащение мехлабом это ПОКУПКА и переделка, за них Техника не растёт.
 * Полевая замена платит только удавшаяся — за неудачу учиться нечему.
 */
function awardRepairXp(
  state: CampaignState,
  record: MechRecord,
  work: string,
  success: boolean,
): void {
  if (!success || record.pilotId === null) return;
  if (work !== 'repairZone' && work !== 'restoreWorn' && work !== 'replacePart') return;
  const pilot = state.company.pilots.find((p) => p.id === record.pilotId);
  if (pilot === undefined) return;
  state.company = withPilot(state.company, awardXp(pilot, 'repairDone'));
}

/**
 * Разбор закончен: запись уходит из ростера, всё уцелевшее ложится на склад.
 *
 * Что уцелело, решает `scrapSalvage` по СОСТОЯНИЮ ЗАПИСИ — считать заново
 * нечего, выбитые установки и разрушенные зоны уже там записаны. Броня и
 * боезапас не отдаются вовсе: расходник ремонта, не складская запись
 * (ловушка 5 шага 15).
 */
function applyScrap(state: CampaignState, record: MechRecord): CampaignEvent {
  const salvage = scrapSalvage(record);
  const entries: WarehouseEntry[] = [];

  for (const node of salvage.nodes) {
    entries.push({
      sort: 'node',
      id: nextPartId(state),
      node: node.spec.node,
      quality: node.quality,
      wear: node.wear,
      sourceTonnage: node.spec.tonnage,
      tier: node.spec.tier,
    });
  }
  for (const item of salvage.items) {
    entries.push({ sort: 'item', id: nextPartId(state), itemId: item.itemId, kind: item.kind });
  }

  state.company = {
    ...state.company,
    mechs: state.company.mechs.filter((m) => m.id !== record.id),
    warehouse: [...state.company.warehouse, ...entries],
  };
  return { kind: 'mechScrapped', recordId: record.id, warehousePartIds: entries.map((e) => e.id) };
}

/**
 * Узел со склада встал на машину.
 *
 * Износ узел приносит С СОБОЙ: снятый с трофея реактор не становится новым
 * оттого, что его переставили. Класс машины при этом меняется на класс узла —
 * в том числе вниз, если игрок сознательно ставит хлам вместо выбитого
 * армейского. Со склада запись снимается здесь, а не при постановке работы:
 * отменённая `CancelJob` работа обязана вернуть узел на полку.
 */
function applyInstall(state: CampaignState, record: MechRecord, partId: string): CampaignEvent[] {
  const part = state.company.warehouse.find((w) => w.id === partId);
  if (part === undefined || part.sort !== 'node') return [];

  // Снятый узел ложится на склад ДО подмены тира: после неё паспорт машины уже
  // описывает новый узел, а на полку обязан лечь старый (шаг 45).
  const removed = stowNode(state, record, part.node);

  // Смена тира применяется здесь же (шаг 32 — реактор, шаг 45 — каркас):
  // проверена она была в день постановки работы, а машина меняется в день её
  // окончания — как и всё остальное, что делает цех.
  const retiered = withNodeTier(record, part.node, part.tier) ?? record;

  // Новый КАРКАС — это и есть заводская переборка: кустарные латки, поставленные
  // полевой заменой, снимаются вместе со старой рамой (шаг 33). Реактор латок не
  // касается: он к силовому набору конечностей отношения не имеет.
  let unpatched = retiered;
  if (part.node === 'frame' && hasPatches(retiered)) {
    // Ключ именно УДАЛЯЕТСЯ, а не ставится в undefined: у проекта включён
    // exactOptionalPropertyTypes, и «поле есть, но пустое» — не то же самое,
    // что «поля нет».
    const { patchedZones: _dropped, ...condition } = retiered.condition;
    unpatched = { ...retiered, condition };
  }

  // Тот же новый каркас обнуляет и запас прочности из шага 66: счётчик
  // оторванных конечностей — про старую раму, новая начинает жизнь без потерь.
  // Explicit 0, а не удаление поля — тем же приёмом, что и сброс на пороге в
  // `attemptReplacePart`.
  if (part.node === 'frame' && unpatched.condition.frameLossCount !== undefined) {
    unpatched = { ...unpatched, condition: { ...unpatched.condition, frameLossCount: 0 } };
  }

  const next = withQuality(unpatched, part.node, part.quality);
  state.company = {
    ...withMech(state.company, { ...next, wear: { ...next.wear, [part.node]: part.wear } }),
    warehouse: [...state.company.warehouse.filter((w) => w.id !== partId), removed],
  };
  return [{ kind: 'partStowed', recordId: record.id, partId: removed.id, node: part.node }];
}

/**
 * Переоснащение закончено (шаг 19a).
 *
 * Снятое ложится на склад, поставленное с него уходит — обе половины здесь, а не
 * при постановке работы, по той же причине, что и у установки узла: отменённая
 * `CancelJob` работа обязана оставить склад ровно таким, каким он был.
 *
 * Целевая сборка берётся ИЗ ЗАДАЧИ, а не пересчитывается: из цеха выходит ровно
 * та машина, за которую заплачено в день постановки.
 */
function applyRefitTask(
  state: CampaignState,
  record: MechRecord,
  assembly: MechAssembly,
  partIds: readonly string[],
): CampaignEvent {
  const returned: WarehouseEntry[] = [];
  const consumed = new Set(partIds);

  // Что снимается — считается по разнице сборок, а не по плану из дня
  // постановки: план мог считаться при другом складе, а разница между «что было
  // на машине» и «что стало» от склада не зависит вовсе.
  //
  // БОЕЗАПАС СЧИТАЕТСЯ НАРАВНЕ СО ВСЕМ ОСТАЛЬНЫМ. До этой правки снятые пачки
  // не возвращались на полку, хотя поставленные с полки СПИСЫВАЮТСЯ: с шага 32
  // пачка — складская запись, а не расходник (`refit.ts`, разбор по видам).
  // Асимметрия жила с шага 19a и означала ровно одно: снял пачку — купи новую.
  // Заправка бункеров расходником и осталась (`ammoAdded` в наряде) — это
  // разные вещи: ящик и снаряды в нём.
  const before = new Map<string, number>();
  for (const it of record.assembly.items) {
    before.set(it.id, (before.get(it.id) ?? 0) + 1);
  }
  for (const it of assembly.items) {
    const left = before.get(it.id) ?? 0;
    if (left > 0) before.set(it.id, left - 1);
  }
  for (const [itemId, count] of [...before.entries()].sort()) {
    for (let n = 0; n < count; n++) {
      returned.push({ sort: 'item', id: nextPartId(state), itemId, kind: itemKindOf(itemId) });
    }
  }

  const next = applyRefit(record, assembly);
  state.company = {
    ...withMech(state.company, next),
    warehouse: [...state.company.warehouse.filter((w) => !consumed.has(w.id)), ...returned],
  };

  return {
    kind: 'mechRefitted',
    recordId: record.id,
    warehousePartIds: returned.map((e) => e.id),
    consumedPartIds: [...partIds],
  };
}

/**
 * Складской id.
 *
 * Берётся из того же монотонного счётчика, что и номера постановок в очередь:
 * он уже входит в снимок и в хэш, а значит, загруженная кампания не начнёт
 * нумеровать склад заново и не столкнёт две записи под одним id.
 */
function nextPartId(state: CampaignState): string {
  const seq = state.nextSeq;
  state.nextSeq = seq + 1;
  return `part-${seq}`;
}

function executeSchedule(
  state: CampaignState,
  day: number,
  task: ScheduledEvent['task'],
): CampaignCommandResult {
  // На сегодня ставить можно — это «сейчас, но после уже назначенного».
  // На вчера нельзя: такую задачу не исполнит никто и никогда, а тихо
  // потерянная работа — худший вид ошибки в слое времени.
  if (day < state.day) return reject(CampaignRejectReason.DayInPast);

  const seq = state.nextSeq;
  state.nextSeq = seq + 1;
  state.queue = insertScheduled(state.queue, { day, seq, task });

  return ok([{ kind: 'taskScheduled', day, seq, task }]);
}

function executeRename(state: CampaignState, name: string): CampaignCommandResult {
  const trimmed = name.trim();
  if (trimmed === '') return reject(CampaignRejectReason.EmptyName);

  const from = state.companyName;
  state.companyName = trimmed;
  return ok([{ kind: 'companyRenamed', from, to: trimmed }]);
}

// --- ангар (шаг 13) -----------------------------------------------------------

function spend(company: Company, amount: number): Company | null {
  if (company.cbills < amount) return null;
  return { ...company, cbills: company.cbills - amount };
}

/**
 * Поставить работу стапеля: списать деньги сразу (ловушка 2 брифинга — иначе
 * рота ставит десять работ на последние средства), назначить срок не раньше
 * завтра, даже если план вышел меньше суток.
 */
function scheduleJob(
  state: CampaignState,
  recordId: string,
  work: RepairWork,
  cost: number,
  days: number,
  extra: {
    readonly zone?: ZoneId;
    readonly node?: WearNode;
    readonly targetClass?: QualityClass;
    readonly partId?: string;
    readonly assembly?: MechAssembly;
    readonly partIds?: readonly string[];
    readonly paint?: string;
  },
  site: BaySite,
): { readonly jobId: string; readonly days: number } {
  const seq = state.nextSeq;
  state.nextSeq = seq + 1;
  const jobId = `job-${seq}`;
  const span = Math.max(1, Math.ceil(days));
  const day = state.day + span;
  state.queue = insertScheduled(state.queue, {
    day,
    seq,
    task: {
      kind: 'repairJob',
      jobId,
      recordId,
      work,
      cost,
      ...extra,
      ...(site.workshop === undefined ? {} : { workshop: site.workshop }),
    },
  });
  return { jobId, days: span };
}

function isZoneUnderRepair(state: CampaignState, recordId: string, zone: ZoneId): boolean {
  return state.queue.some(
    (e) =>
      e.task.kind === 'repairJob' &&
      e.task.recordId === recordId &&
      (e.task.work === 'repairZone' || e.task.work === 'replacePart') &&
      e.task.zone === zone,
  );
}

function executeRepairZone(state: CampaignState, recordId: string, zone: ZoneId): CampaignCommandResult {
  const record = state.company.mechs.find((m) => m.id === recordId);
  if (record === undefined) return reject(CampaignRejectReason.MechNotFound);

  const idx = zoneFromId(zone);
  if (record.condition.zones[idx]?.destroyed) return reject(CampaignRejectReason.ZoneDestroyed);
  if (isZoneUnderRepair(state, recordId, zone)) return reject(CampaignRejectReason.NothingToRepair);

  const plan = zoneRepairPlan(record, zone);
  if (plan.jobCount === 0) return reject(CampaignRejectReason.NothingToRepair);
  const site = baySite(state, recordId);
  if (typeof site === 'string') return reject(site);
  const job = atSite(site, 'repairZone', plan.cost, plan.days);

  const spent = spend(state.company, job.cost);
  if (spent === null) return reject(CampaignRejectReason.InsufficientFunds);
  state.company = spent;

  const { jobId, days } = scheduleJob(state, recordId, 'repairZone', job.cost, job.days, { zone }, site);
  return ok([{ kind: 'jobScheduled', jobId, recordId, work: 'repairZone', cost: job.cost, days }]);
}

/**
 * Повышение класса узла — ПОКУПКА, а не ремонт, и потому упирается в рынок
 * (решение 6 §2 пайплайна: купить можно всё, но не везде).
 *
 * Три следствия сразу, и ради них шаг 15 вообще нужен: за мастерским реактором
 * надо лететь в столичную систему; рядом с фронтом цена выше на четверть и
 * выше; а класс, которого тут не продают, не покупается ни за какие деньги —
 * его можно только заказать (`OrderPart`) и ждать.
 */
function executeUpgradeClass(
  state: CampaignState,
  recordId: string,
  node: WearNode,
  targetClass: QualityClass,
): CampaignCommandResult {
  const record = state.company.mechs.find((m) => m.id === recordId);
  if (record === undefined) return reject(CampaignRejectReason.MechNotFound);

  const market = marketHere(state);
  if (market === null) return reject(CampaignRejectReason.NotAtMarket);
  if (!sellsClass(market, targetClass)) return reject(CampaignRejectReason.ClassNotSold);

  const job = replaceJob(record, node, targetClass);
  if (!job.possible) return reject(CampaignRejectReason.SameClass);
  const site = baySite(state, recordId);
  if (typeof site === 'string') return reject(site);

  const cost = Math.round(job.cost * market.priceFactor);
  const spent = spend(state.company, cost);
  if (spent === null) return reject(CampaignRejectReason.InsufficientFunds);
  state.company = spent;

  const { jobId, days } = scheduleJob(state, recordId, 'upgradeClass', cost, job.days, { node, targetClass }, site);
  return ok([{ kind: 'jobScheduled', jobId, recordId, work: 'upgradeClass', cost, days }]);
}

function executeRestoreWorn(state: CampaignState, recordId: string, node: WearNode): CampaignCommandResult {
  const record = state.company.mechs.find((m) => m.id === recordId);
  if (record === undefined) return reject(CampaignRejectReason.MechNotFound);

  const job = restoreJob(record, node);
  if (!job.possible) return reject(CampaignRejectReason.NoWear);
  const site = baySite(state, recordId);
  if (typeof site === 'string') return reject(site);
  const at = atSite(site, 'restoreWorn', job.cost, job.days);

  const spent = spend(state.company, at.cost);
  if (spent === null) return reject(CampaignRejectReason.InsufficientFunds);
  state.company = spent;

  const { jobId, days } = scheduleJob(state, recordId, 'restoreWorn', at.cost, at.days, { node }, site);
  return ok([{ kind: 'jobScheduled', jobId, recordId, work: 'restoreWorn', cost: at.cost, days }]);
}

function executeReplacePart(state: CampaignState, recordId: string, zone: ZoneId): CampaignCommandResult {
  const record = state.company.mechs.find((m) => m.id === recordId);
  if (record === undefined) return reject(CampaignRejectReason.MechNotFound);

  const idx = zoneFromId(zone);
  if (isVital(idx)) return reject(CampaignRejectReason.ZoneUnrepairable);
  if (!record.condition.zones[idx]?.destroyed) return reject(CampaignRejectReason.ZoneNotDestroyed);
  if (isZoneUnderRepair(state, recordId, zone)) return reject(CampaignRejectReason.NothingToRepair);
  const site = baySite(state, recordId);
  if (typeof site === 'string') return reject(site);

  const plan = replacePartPlan(record, zone);
  const job = atSite(site, 'replacePart', plan.cost, plan.days);
  const spent = spend(state.company, job.cost);
  if (spent === null) return reject(CampaignRejectReason.InsufficientFunds);
  state.company = spent;

  const { jobId, days } = scheduleJob(state, recordId, 'replacePart', job.cost, job.days, { zone }, site);
  return ok([{ kind: 'jobScheduled', jobId, recordId, work: 'replacePart', cost: job.cost, days }]);
}

/**
 * Разбор машины — РАБОТА СТАПЕЛЯ (брифинг шага 15, п. 7), а не кнопка.
 *
 * До шага 15 он был мгновенным, бесплатным и клал на склад только реактор с
 * каркасом — остальное просто пропадало. Теперь занимает стапель, стоит денег
 * и времени, как любая другая работа (правило шага 13), и отдаёт всё, что
 * уцелело. Машина, разобранная за один щелчок, обесценивала бы правило
 * «мгновенного ремонта нет».
 */
function executeScrapMech(state: CampaignState, recordId: string): CampaignCommandResult {
  const record = state.company.mechs.find((m) => m.id === recordId);
  if (record === undefined) return reject(CampaignRejectReason.MechNotFound);
  if (isStationed(state.garrison, recordId)) return reject(CampaignRejectReason.MechStationed);
  if (state.queue.some((e) => e.task.kind === 'repairJob' && e.task.recordId === recordId)) {
    return reject(CampaignRejectReason.MechHasPendingJob);
  }
  const site = baySite(state, recordId);
  if (typeof site === 'string') return reject(site);

  const plan = scrapPlan(record);
  const spent = spend(state.company, plan.cost);
  if (spent === null) return reject(CampaignRejectReason.InsufficientFunds);
  state.company = spent;

  const { jobId, days } = scheduleJob(state, recordId, 'scrapMech', plan.cost, plan.days, {}, site);
  return ok([{ kind: 'jobScheduled', jobId, recordId, work: 'scrapMech', cost: plan.cost, days }]);
}

function executeAssignPilot(
  state: CampaignState,
  recordId: string,
  pilotId: string | null,
): CampaignCommandResult {
  const record = state.company.mechs.find((m) => m.id === recordId);
  if (record === undefined) return reject(CampaignRejectReason.MechNotFound);
  // Пилот гарнизона стоит с машиной на мире (шаг 86b): пересадить можно, только стоя в той же системе.
  if (!withinReach(state, recordId)) return reject(CampaignRejectReason.MechStationed);
  const seat = pilotId === null ? undefined : state.company.mechs.find((m) => m.pilotId === pilotId);
  if (seat !== undefined && !withinReach(state, seat.id)) return reject(CampaignRejectReason.MechStationed);

  if (pilotId !== null) {
    const pilot = state.company.pilots.find((p) => p.id === pilotId);
    if (pilot === undefined) return reject(CampaignRejectReason.PilotNotFound);
    if (pilot.status !== 'active') return reject(CampaignRejectReason.PilotNotActive);
    // Губернатор сектора (шаг 88) в машину не садится: сперва снять с поста.
    if (isGovernor(state.realm, pilotId)) return reject(CampaignRejectReason.PilotIsGovernor);
  }
  // Машина склада, получив пилота, становится гарнизоном мира (шаг 87) — в пределах гарнизона.
  const depotPost = pilotId === null ? undefined : state.garrison.posts[recordId];
  if (depotPost?.depot === true) {
    if (garrisonCount(state.garrison, depotPost.systemId) >= garrisonCapOf(state.deltas, depotPost.systemId)) {
      return reject(CampaignRejectReason.GarrisonFull);
    }
    state.garrison = withPosts(state.garrison, [recordId], { systemId: depotPost.systemId, arrives: depotPost.arrives });
  }

  state.company = {
    ...state.company,
    mechs: state.company.mechs.map((m) => {
      if (m.id === recordId) return { ...m, pilotId };
      // Прежняя посадка снимается сама — пилот не может быть в двух кабинах разом.
      if (pilotId !== null && m.pilotId === pilotId) return { ...m, pilotId: null };
      return m;
    }),
  };
  return ok([{ kind: 'pilotAssigned', recordId, pilotId }]);
}

/**
 * Перетаскивание в списке ангара/мехлаба. Порядок в `order` заменяет порядок
 * `company.mechs` целиком — записи он не трогает, только их место в массиве.
 * `order` обязан быть той же машиной, что и парк: то же число, те же id, без
 * дублей. Список формирует UI из собственного `campaign.mechs`, так что
 * несовпадение возможно только при гонке (парк изменился между чтением
 * списка и отпусканием мыши) — тогда честнее отказать, чем гадать.
 */
function executeReorderMechs(state: CampaignState, order: readonly string[]): CampaignCommandResult {
  const current = state.company.mechs;
  if (order.length !== current.length) return reject(CampaignRejectReason.InvalidOrder);

  const byId = new Map(current.map((m) => [m.id, m]));
  const next: MechRecord[] = [];
  for (const id of order) {
    const record = byId.get(id);
    if (record === undefined) return reject(CampaignRejectReason.InvalidOrder);
    next.push(record);
  }

  state.company = { ...state.company, mechs: next };
  return ok([{ kind: 'mechsReordered' }]);
}

/**
 * Дать объявление о найме (переработка 2026-09-10).
 *
 * Порядок проверок важен: сначала всё, что может отказать, и только потом
 * бросок. Иначе отклонённая команда продвинула бы поток `camp.events` — то есть
 * оставила бы след, и следующий поиск дал бы другого человека из-за неудачной
 * попытки, которой не было.
 *
 * ДЕНЬГИ И ПОПЫТКА СПИСЫВАЮТСЯ ЗДЕСЬ, а не при найме (решение пользователя
 * 2026-09-10): платится за поиск, а не за пилота. Отказ не возвращает ничего —
 * ровно поэтому кандидат это решение, а не пункт прейскуранта.
 */
function executeSearchRecruit(state: CampaignState, id: string): CampaignCommandResult {
  if (state.recruit !== null) return reject(CampaignRejectReason.RecruitPending);
  if (state.day < state.hireReadyDay) return reject(CampaignRejectReason.HireNotReady);
  if (state.company.pilots.some((p) => p.id === id)) return reject(CampaignRejectReason.DuplicatePilotId);

  const cost = ECONOMY.hiring.searchFee;
  const spent = spend(state.company, cost);
  if (spent === null) return reject(CampaignRejectReason.InsufficientFunds);

  state.company = spent;
  state.hireReadyDay = state.day + ECONOMY.hiring.searchIntervalDays;
  const recruit = rollRecruit(state.rng.stream('camp.events'), id, hireTierBonus(state.reputation.fame));
  state.recruit = recruit;

  return ok([
    {
      kind: 'recruitFound',
      pilotId: recruit.id,
      name: recruit.name,
      affiliation: recruit.affiliation,
      cost,
      nextTryDay: state.hireReadyDay,
    },
  ]);
}

/** Взять кандидата в роту. Денег не стоит: за поиск уже уплачено. */
function executeHireRecruit(state: CampaignState): CampaignCommandResult {
  const recruit = state.recruit;
  if (recruit === null) return reject(CampaignRejectReason.NoRecruit);
  if (state.company.pilots.some((p) => p.id === recruit.id)) {
    return reject(CampaignRejectReason.DuplicatePilotId);
  }

  state.company = { ...state.company, pilots: [...state.company.pilots, recruit] };
  state.recruit = null;
  return ok([{ kind: 'pilotHired', pilotId: recruit.id, cost: 0 }]);
}

/** Отпустить кандидата. Попытка сгорела вместе с деньгами — это и есть цена отказа. */
function executeRejectRecruit(state: CampaignState): CampaignCommandResult {
  const recruit = state.recruit;
  if (recruit === null) return reject(CampaignRejectReason.NoRecruit);
  state.recruit = null;
  return ok([{ kind: 'recruitRejected', pilotId: recruit.id, name: recruit.name }]);
}

function executeDismissPilot(state: CampaignState, pilotId: string): CampaignCommandResult {
  if (!state.company.pilots.some((p) => p.id === pilotId)) return reject(CampaignRejectReason.PilotNotFound);
  if (state.company.mechs.some((m) => m.pilotId === pilotId && isStationed(state.garrison, m.id))) {
    return reject(CampaignRejectReason.MechStationed);
  }

  state.company = {
    ...state.company,
    pilots: state.company.pilots.filter((p) => p.id !== pilotId),
    mechs: state.company.mechs.map((m) => (m.pilotId === pilotId ? { ...m, pilotId: null } : m)),
  };
  // Уволенный губернатор (шаг 88): пост пуст, сектор ничего не делает, пока игрок не назначит другого.
  const post = state.realm.sectors.find((x) => x.governor === pilotId);
  if (post === undefined) return ok([{ kind: 'pilotDismissed', pilotId }]);
  state.realm = withSector(state.realm, { ...post, governor: null });
  return ok([{ kind: 'pilotDismissed', pilotId }, { kind: 'governorLeft', centerId: post.center, pilotId }]);
}

function executeTrainPilot(state: CampaignState, pilotId: string, skillId: string): CampaignCommandResult {
  const pilot = state.company.pilots.find((p) => p.id === pilotId);
  if (pilot === undefined) return reject(CampaignRejectReason.PilotNotFound);

  const next = trainSkill(pilot, skillId);
  if (next === pilot) return reject(CampaignRejectReason.CannotTrain);

  state.company = withPilot(state.company, next);
  return ok([{ kind: 'pilotTrained', pilotId, skillId, level: next.skills[skillId] ?? 0 }]);
}

/**
 * ОТПРАВИТЬ РАНЕНОГО В ЛАЗАРЕТ, НЕ ДОЖИДАЯСЬ ПОРОГА (правка 2026-09-08).
 *
 * Та же работа, что и после боя, только начатая решением игрока: пилот выбывает
 * из строя на срок лечения (`treatmentDays`) и возвращается с нулём травм той
 * же задачей `medbayDone`. Второго пути выписки не заводится — иначе однажды
 * один из них начнёт лечить не так, как другой.
 *
 * Пилот, уже лежащий в лазарете или потерянный, отклоняется: `PilotNotActive`.
 * Здоровый — `PilotNotInjured`: работа без предмета не ставится в очередь, как
 * не ставится ремонт исправной зоны.
 */
function executeTreatPilot(state: CampaignState, pilotId: string): CampaignCommandResult {
  const pilot = state.company.pilots.find((p) => p.id === pilotId);
  if (pilot === undefined) return reject(CampaignRejectReason.PilotNotFound);
  if (pilot.status !== 'active') return reject(CampaignRejectReason.PilotNotActive);
  if (pilot.injuries <= 0) return reject(CampaignRejectReason.PilotNotInjured);

  const { pilot: admitted, days } = admitToMedbay(pilot);
  state.company = withPilot(state.company, admitted);

  const seq = state.nextSeq;
  state.nextSeq = seq + 1;
  const day = state.day + Math.max(1, Math.ceil(days));
  state.queue = insertScheduled(state.queue, { day, seq, task: { kind: 'medbayDone', pilotId } });

  return ok([{ kind: 'pilotAdmitted', pilotId, days: day - state.day }]);
}

function executeCancelJob(state: CampaignState, jobId: string): CampaignCommandResult {
  const idx = state.queue.findIndex((e) => e.task.kind === 'repairJob' && e.task.jobId === jobId);
  if (idx === -1) return reject(CampaignRejectReason.JobNotFound);

  const task = state.queue[idx]!.task;
  if (task.kind !== 'repairJob') return reject(CampaignRejectReason.JobNotFound);

  const refund = Math.round(task.cost * ECONOMY.cancellation.refundShare);
  state.queue = [...state.queue.slice(0, idx), ...state.queue.slice(idx + 1)];
  state.company = { ...state.company, cbills: state.company.cbills + refund };
  return ok([{ kind: 'jobCancelled', jobId, recordId: task.recordId, work: task.work, refund }]);
}

// --- галактика (шаг 14) -------------------------------------------------------

/**
 * Поставить маршрут в очередь суток.
 *
 * Каждая нога — отдельная задача, а не один прыжок на всю дорогу: рота
 * действительно движется по карте, и загруженное посреди пути сохранение
 * продолжает движение оттуда, где застало. Первая нога — транзит от орбиты до
 * точки прыжка, каждая следующая — зарядка паруса у той звезды, от которой
 * уходим, последняя добавляет транзит до планеты.
 */
function scheduleLeg(state: CampaignState, leg: number, days: number): void {
  const seq = state.nextSeq;
  state.nextSeq = seq + 1;
  state.queue = insertScheduled(state.queue, {
    day: state.day + Math.max(1, Math.ceil(days)),
    seq,
    task: { kind: 'travelLeg', leg },
  });
}

/**
 * Перелёт (`travel`) и одиночный прыжок (`jump`) — одна механика с одной
 * проверкой разницы: прыжок отказывается идти дальше 30 световых лет.
 *
 * Деньги списываются при постановке, как и работы стапеля (ловушка 2 шага 13):
 * иначе рота ставит маршрут на последние средства и прилетает без кассы.
 * Отменять перелёт нечем и намеренно: корабль, развернувшийся на полдороге,
 * не возвращает ни суток, ни топлива, а «отмена прыжка» превратила бы карту в
 * способ бесплатно осмотреться.
 */
function executeTravel(state: CampaignState, systemId: string, singleJump: boolean): CampaignCommandResult {
  if (state.travel !== null) return reject(CampaignRejectReason.AlreadyTravelling);

  const to = GALAXY.index(systemId);
  if (to < 0) return reject(CampaignRejectReason.SystemNotFound);

  const from = GALAXY.require(state.systemId);
  if (from === to) return reject(CampaignRejectReason.AlreadyThere);
  if (singleJump && !isAdjacent(from, to)) return reject(CampaignRejectReason.NotAdjacent);

  const route: Route | null = findRoute(from, to);
  if (route === null || route.jumps === 0) return reject(CampaignRejectReason.NoRoute);

  const spent = spend(state.company, route.cost);
  if (spent === null) return reject(CampaignRejectReason.InsufficientFunds);
  state.company = spent;

  const arrivalDay = state.day + route.days;
  state.travel = {
    path: route.path.map((i) => GALAXY.id(i)),
    legIndex: 0,
    startDay: state.day,
    arrivalDay,
    cost: route.cost,
  };
  scheduleLeg(state, 0, (route.legs[0] as { days: number }).days);

  return ok([
    {
      kind: 'travelStarted',
      toSystemId: systemId,
      jumps: route.jumps,
      days: route.days,
      cost: route.cost,
      arrivalDay,
    },
  ]);
}

/**
 * Нога маршрута пройдена.
 *
 * Сроки следующих ног берутся из состояния, а не из пересчитанного маршрута:
 * `travel.path` уже зафиксирован, и маршрут не имеет права поехать оттого, что
 * между прыжками поменялись данные. Номер ноги в задаче сверяется с состоянием
 * — задача из чужого или уже завершённого маршрута молча теряется.
 */
function applyTravelLegTask(state: CampaignState, leg: number): CampaignEvent[] {
  const travel = state.travel;
  if (travel === null || travel.legIndex !== leg) return [];

  const next = leg + 1;
  const systemId = travel.path[next] as string;
  state.systemId = systemId;
  state.deltas = withDelta(state.deltas, systemId, { visited: true });

  const remaining = travel.path.length - 1 - next;
  const events: CampaignEvent[] = [
    { kind: 'jumpCompleted', systemId, leg, remaining },
  ];

  if (remaining === 0) {
    state.travel = null;
    events.push({ kind: 'arrived', systemId, day: state.day });
    return events;
  }

  state.travel = { ...travel, legIndex: next };
  const here = GALAXY.require(systemId);
  const inbound = remaining === 1 ? TRANSIT_DAYS : 0;
  scheduleLeg(state, next, rechargeDays(here) + inbound);
  return events;
}

/**
 * Купить мир, В КОТОРОМ РОТА СТОИТ (шаг 25, часть C).
 *
 * Планету не берут по каталогу из другого конца Сферы — её берут там, куда
 * прилетели и с кем договорились. Отсюда и порог отношения: сотня контрактов у
 * Дэвиона открывает дорогу к дэвионскому миру, у Куриты — нет, и выбор стороны
 * (шаг 20) наконец получает последствие крупнее окраски биржи.
 *
 * Экономика прежнего владельца правится ПРИРАЩЕНИЕМ, как при захвате: доход,
 * содержание и мощность мира уходят от него, число миров падает на единицу.
 * Роте они не начисляются в `FactionEconomy` вовсе — у роты касса.
 */
function executeBuyWorld(state: CampaignState): CampaignCommandResult {
  if (state.travel !== null) return reject(CampaignRejectReason.AlreadyTravelling);
  const i = GALAXY.require(state.systemId);
  const owner = ownerOf(state.deltas, i);
  if (owner === PLAYER_ACTOR_ID) return reject(CampaignRejectReason.AlreadyOwned);
  // Столицу державы не продают ни за какие деньги, и мир, за который сейчас
  // идёт война, — тоже: у обоих есть цена дороже денег.
  if (GALAXY.hasFlag(i, 'capital')) return reject(CampaignRejectReason.WorldNotForSale);
  if (frontSectors(state.war, state.reputation, state.deltas, state.day).some((sec) => sec.system === i)) {
    return reject(CampaignRejectReason.WorldNotForSale);
  }
  if (standingOf(state.reputation, owner) < WAR.domain.minStanding) {
    return reject(CampaignRejectReason.StandingTooLow);
  }

  const price = worldPrice(state.worldSeed, state.deltas, i);
  const spent = spend(state.company, price);
  if (spent === null) return reject(CampaignRejectReason.InsufficientFunds);
  state.company = spent;

  handWorldToPlayer(state, i, owner, 'bought');
  return ok([{ kind: 'worldBought', systemId: state.systemId, from: owner, price }]);
}

/**
 * Мир переходит роте — ОДИН шов на все три двери (шаг 38).
 *
 * Дверей к первому миру три: купить (деньги), захватить (сила), принять в лен
 * (служба). Три способа стать владельцем — это нормально; три способа СТАТЬ ИМ
 * В СОСТОЯНИИ разошлись бы через месяц, и одна из дверей однажды забыла бы
 * снять мир с экономики прежнего хозяина. Поэтому передача владения здесь одна.
 *
 * Экономика прежнего владельца правится ПРИРАЩЕНИЕМ, как при захвате фронтом:
 * доход, содержание и мощность мира уходят от него, число миров падает на
 * единицу. Роте они не начисляются в `FactionEconomy` вовсе — у роты касса.
 */
function handWorldToPlayer(state: CampaignState, i: number, owner: string, origin: LoyaltyOrigin): void {
  const was = worldContributionAt(state.worldSeed, state.deltas, i);
  const eco = economyOf(state.war, owner);
  state.war = withEconomy(state.war, owner, {
    income: eco.income - was.income,
    upkeep: eco.upkeep - was.upkeep,
    capacity: eco.capacity - was.capacity,
    worlds: eco.worlds - 1,
  });
  // Незавершённая переделка прежнего хозяина отменяется: новый владелец не
  // доводит до конца чужую стройку. То же правило, что при захвате.
  //
  // Столица закрепляется ДО передачи и после (шаг 76): до — чтобы новый мир с
  // меньшим номером не забрал её у той, что игрок видел (сохранения без метки);
  // после — чтобы первый мир державы стал столицей с меткой.
  const given = withDelta(withPlayerCapitalPinned(state.deltas), GALAXY.id(i), {
    owner: PLAYER_ACTOR_ID,
    focusTo: undefined,
    focusUntil: undefined,
    abandonedUntil: undefined,
    // Лояльность (шаг 85): старт по способу получения, прежний владелец — тот, у кого мир получен.
    ...acquiredPatch(origin, owner),
  });
  state.deltas = withPlayerCapitalPinned(given);
}

/**
 * ЗАХВАТИТЬ МИР СИЛОЙ (шаг 38, путь меча).
 *
 * **Что этим чинится.** Парадокс анклава: до шага 38 первый мир брался только
 * покупкой, а репутацию проще всего набить там, где нет войны, — в глубоком
 * тылу дружественного Дома. Купив мир там, игрок оказывался в кольце союзных
 * систем, а наступления считаются строго между смежными (`war/front.ts`).
 * Расширяться силой было некуда: оставалось либо предать благодетеля, либо
 * бесконечно скупать планеты по триста миллионов, игнорируя военную механику
 * державы целиком.
 *
 * **Берётся ничейное и пиратское, и только на своих ногах.** Владелец обязан
 * быть `independent` или `pirates` — Дом свою планету не отдаёт, у неё есть
 * армия. Таких миров на карте тридцать пять, и стоят они кучно на Периферии:
 * взяв один, игрок получает соседей, на которых можно наступать.
 *
 * **Платит не касса, а дело.** Условие — победы роты ИМЕННО ЗДЕСЬ, из памяти
 * мира (`galaxy/delta.ts::memoryOf`, шаг 27a). Для пиратского логова сверх того
 * требуется вычищенность (шаг 37a): сперва выбивают вольницу, потом поднимают
 * флаг. Оттого захват и читается как продолжение зачистки, а не как новая
 * механика с потолка.
 */
function executeConquerWorld(state: CampaignState): CampaignCommandResult {
  if (state.travel !== null) return reject(CampaignRejectReason.AlreadyTravelling);
  const i = GALAXY.require(state.systemId);
  const owner = ownerOf(state.deltas, i);
  if (owner === PLAYER_ACTOR_ID) return reject(CampaignRejectReason.AlreadyOwned);

  const kind = factionKind(owner);
  // МИР ВРАГА (шаг 76): с фракцией, с которой держава воюет, флаг поднимают
  // так же — делом на этой планете. Только на границе державы и не в столице
  // Дома: захват продолжает войну, а не прыгает через всю Сферу.
  //
  // ПРАВО ФЛАГА НА МИР ВРАГА (шаг 90, `notes.md` §10zu п. 4): только победы работы державы против владельца на
  // этом мире (`SystemDelta.realmWon`, `board.ts::warWorkOffers`), а такая работа бывает лишь при записи войны.
  // До шага 90 засчитывались любые победы роты на мире — и контракты самого владельца: рота копила их в мирное
  // время и в день объявления войны брала миры соседа цепочкой без единого боя. Ничейный и пиратский мир — по
  // памяти мира, как прежде: работу против вольницы там дают соседи (награда за логово), а ничейный — не враг.
  const enemy =
    kind !== 'pirates' &&
    kind !== 'independent' &&
    playerWarOf(state.war, owner) !== undefined &&
    nextToDomain(state.deltas, i) &&
    !GALAXY.hasFlag(i, 'capital');
  if (kind !== 'pirates' && kind !== 'independent' && !enemy) {
    return reject(CampaignRejectReason.WorldNotConquerable);
  }
  const won = enemy ? (state.deltas[state.systemId]?.realmWon ?? 0) : (memoryOf(state.deltas, state.systemId)?.won ?? 0);
  if (won < WAR.domain.conquerWins) {
    return reject(CampaignRejectReason.WorldNotConquerable);
  }
  if (kind === 'pirates' && clearedOf(state.deltas, state.systemId) < WAR.domain.conquerCleared) {
    return reject(CampaignRejectReason.WorldNotConquerable);
  }

  // ТРОФЕИ ЗАХВАТА (шаг 90, ступень 8): казна мира — `captureLootTicks` тактов его дохода, в кассу роты.
  const loot = Math.round(worldContributionAt(state.worldSeed, state.deltas, i).income * WAR.domain.captureLootTicks);
  handWorldToPlayer(state, i, owner, 'force');
  state.company = { ...state.company, cbills: state.company.cbills + loot };
  // Мир взят силой — в память захватов (шаг 83), как захват фронтом.
  state.war = withConquest(state.war, PLAYER_ACTOR_ID, owner);
  // В счёт войны — если с этой фракцией держава воюет (пираты — враги от рождения).
  if (atWarWithPlayer(state.war, state.reputation, owner, state.day)) {
    state.war = notePlayerCapture(state.war, PLAYER_ACTOR_ID, owner, state.day, state.systemId);
  }
  return ok([{ kind: 'worldConquered', systemId: state.systemId, from: owner, ...(loot > 0 ? { loot } : {}) }]);
}

/**
 * ПРИНЯТЬ ЛЕН (шаг 38, путь службы).
 *
 * **Лорное основание.** В каноне Дома почти никогда не жаловали наёмникам землю
 * в ядре. Землю давали на неспокойных окраинах, буферными баронствами: Аутрич у
 * границы Конфедерации, Гленгарри у лиранского фронтира. Дом решал свою
 * проблему чужими руками — ставил сильного наёмника щитом против набегов соседа.
 *
 * **Отсюда единственное условие, которого нет у покупки: мир обязан быть
 * ПРИГРАНИЧНЫМ.** Считается фронтовым индексом шага 37 — тем же числом, которым
 * биржа отличает фронт от тыла, и второго определения приграничья не заводится.
 * Игрок получает не случайную тыловую планету, а позицию: за спиной союзник и
 * рынок снабжения, впереди законный враг.
 *
 * Остальные три условия — цена доверия: высокое отношение (выше порога
 * покупки), известность и победы на этом самом мире за этого самого нанимателя.
 * Денег лен не стоит: землю жалуют, а не продают.
 */
function executeClaimGrant(state: CampaignState): CampaignCommandResult {
  if (state.travel !== null) return reject(CampaignRejectReason.AlreadyTravelling);
  const i = GALAXY.require(state.systemId);
  const owner = ownerOf(state.deltas, i);
  if (owner === PLAYER_ACTOR_ID) return reject(CampaignRejectReason.AlreadyOwned);
  // Столицу не жалуют никому и никогда — то же правило, что у продажи.
  if (GALAXY.hasFlag(i, 'capital')) return reject(CampaignRejectReason.GrantNotOffered);

  const D = WAR.domain;
  if (standingOf(state.reputation, owner) < D.grantStanding) {
    return reject(CampaignRejectReason.GrantStandingTooLow);
  }
  if (state.reputation.fame < D.grantFame) return reject(CampaignRejectReason.GrantNotOffered);

  const memory = memoryOf(state.deltas, state.systemId);
  if (memory?.forWhom !== owner || memory.won < D.grantWins) {
    return reject(CampaignRejectReason.GrantNotOffered);
  }
  if (frontierIndexAt(state.deltas, state.reputation, state.war, i) < D.grantFrontier) {
    return reject(CampaignRejectReason.GrantNotOffered);
  }

  handWorldToPlayer(state, i, owner, 'grant');
  // ЛЕН ПЛАТИТ ДАНЬ ЖАЛУЮЩЕМУ ДОМУ (проект державы, шаг 1; решение пользователя
  // 2026-09-28): стандартный срок и доля дани фракций, без новой механики. Через
  // `withDelta`, а не `imposeTribute`: у наложения дани есть расход военного фонда
  // и падение отношения, у пожалования их быть не должно. Прежняя дань мира
  // третьей стороне при этом снимается — землю жалуют чистой.
  const tributeUntil = state.day + WAR.diplomacy.tributeDecades * WAR.front.tickDays;
  // Доля лена меньше общей (шаг 90, `diplomacy.grantTributeShare`).
  state.deltas = withDelta(state.deltas, state.systemId, {
    tribute: owner,
    tributeUntil,
    tributeShare: WAR.diplomacy.grantTributeShare,
  });
  return ok([{ kind: 'worldGranted', systemId: state.systemId, from: owner, tributeUntil }]);
}

/**
 * Военный бюджет державы (проект державы, шаг 2).
 *
 * У фракций в военный фонд идёт `economy.warFundShare` избытка — всегда. У роты фонда не было
 * вовсе («игра не тратит деньги игрока без спроса»), и напор роты на участках стоял на минимуме:
 * проба 2026-09-27 — доля её наступлений в такте фронта 0.4–0.75 %, около боя в два года войны.
 * Теперь долю назначает игрок, а раскладывает и тратит фонд тот же код, что у фракций.
 */
function executeSetWarBudget(state: CampaignState, share: number): CampaignCommandResult {
  if (!isPlayerRealm(state.deltas)) return reject(CampaignRejectReason.DiplomacyLocked);
  if (!WAR.domain.warBudgetSteps.includes(share)) return reject(CampaignRejectReason.BadWarBudget);
  if (share === 0) {
    const { realmWarShare: _old, ...rest } = state.war;
    state.war = rest;
  } else {
    state.war = { ...state.war, realmWarShare: share };
  }
  return ok([{ kind: 'warBudgetSet', share }]);
}

/**
 * Взнос кассы в военный фонд державы (шаг 80). Раскладка — `placeWarFund` с весами участков, как у
 * бюджета в такте экономики; списывается ровно разложенное.
 */
function executeFundWar(state: CampaignState, amount: number): CampaignCommandResult {
  if (!isPlayerRealm(state.deltas)) return reject(CampaignRejectReason.DiplomacyLocked);
  if (!Number.isInteger(amount) || amount <= 0) return reject(CampaignRejectReason.BadFundAmount);
  if (state.company.cbills < amount) return reject(CampaignRejectReason.InsufficientFunds);
  const weights = frontWeights(frontSectors(state.war, state.reputation, state.deltas, state.day));
  const placed = placeWarFund(state.war, state.reputation, PLAYER_ACTOR_ID, amount, weights[PLAYER_ACTOR_ID]);
  if (placed.placed <= 0) return reject(CampaignRejectReason.NoWarEnemies);
  state.war = placed.war;
  state.company = { ...state.company, cbills: state.company.cbills - placed.placed };
  // Казна державы — отражение кассы (`syncDomainEconomy`): без этой строки она отставала бы до такта.
  state.war = syncDomainEconomy(state.war, state.worldSeed, state.deltas, state.company.cbills);
  return ok([{ kind: 'warFunded', amount: placed.placed }]);
}

/**
 * Приказ армии державы наступать (проект державы, шаг 3). Правила и их разбор — `war/offensive.ts`.
 */
function executeOrderOffensive(state: CampaignState, systemId: string): CampaignCommandResult {
  const i = GALAXY.index(systemId);
  if (i < 0) return reject(CampaignRejectReason.SystemNotFound);
  const check = planOffensive(state.war, state.reputation, state.deltas, state.worldSeed, i, state.day);
  if (!check.ok) {
    switch (check.block.kind) {
      case 'noRealm':
        return reject(CampaignRejectReason.DiplomacyLocked);
      case 'ownWorld':
        return reject(CampaignRejectReason.OffensiveOwnWorld);
      case 'notAtWar':
        return reject(CampaignRejectReason.NotAtWar);
      case 'notOnFront':
        return reject(CampaignRejectReason.NotOnFront);
      case 'noTheater':
        return reject(CampaignRejectReason.NoTheaterArmy);
      case 'cooldown':
        return reject(CampaignRejectReason.OffensiveCooldown);
      case 'noFund':
        return reject(CampaignRejectReason.NoWarFund);
    }
  }
  // Звено роты в прыжке от цели идёт с армией само (шаг 86, `orderLance`).
  const lance = orderLance(state, i);
  // Казна мира до захвата — для трофеев (шаг 90, ступень 8).
  const worldIncome = worldContributionAt(state.worldSeed, state.deltas, i).income;
  const done = applyOffensive(
    state.war,
    state.reputation,
    state.deltas,
    state.worldSeed,
    check,
    state.day,
    state.rng.stream('camp.war'),
    lance,
  );
  state.war = done.war;
  state.deltas = done.deltas;
  state.reputation = done.reputation;
  const f = done.fought;
  // ТРОФЕИ ПРИКАЗА (шаг 90, ступень 8): взятый мир отдаёт казну — `captureLootTicks` тактов дохода, а военный фонд
  // врага против державы — долю `offensiveLootShare`. В кассу роты: держава воюет её деньгами.
  let loot = 0;
  if (f.won) {
    const defender = check.sector.defender;
    const fund = fundOf(state.war, defender, PLAYER_ACTOR_ID);
    const seized = Math.round(fund * WAR.domain.offensiveLootShare);
    state.war = withFund(state.war, defender, PLAYER_ACTOR_ID, fund - seized);
    loot = seized + Math.round(worldIncome * WAR.domain.captureLootTicks);
    state.company = { ...state.company, cbills: state.company.cbills + loot };
  }

  // СТОЛКНОВЕНИЕ РОТЫ — разбор как у авторасчёта контракта (шаг 86, решение пользователя 2026-10-01):
  // урон — в записи ангара, выбывшие машины на потерянном поле теряются, ранения и опыт — тем же
  // `debrief`; опыт за сделанную работу — только за выигранное столкновение. Гонорара и трофеев нет.
  const companyEvents: CampaignEvent[] = [];
  let companyLine: { mechs: number; detachment: number; knocked: number; lostRecordIds: string[] } | undefined;
  if (f.company !== undefined) {
    const c = f.company;
    const debriefed = debrief({ brief: c.brief, outcome: c.outcome, rng: state.rng, contractDone: c.outcome.heldField });
    const inClash = new Set(c.brief.company.map((p) => p.record.id));
    const company: Company = { ...state.company, mechs: inPlace(state.company.mechs, inClash, debriefed.company) };
    companyEvents.push(...settlePilots(state, company, debriefed.pilots));
    companyLine = {
      mechs: c.brief.company.length,
      detachment: c.detachment,
      knocked: c.knocked,
      lostRecordIds: [...debriefed.lostRecordIds],
    };
  }

  return ok([
    {
      kind: 'frontClash',
      systemId,
      attacker: PLAYER_ACTOR_ID,
      defender: check.sector.defender,
      outcome: f.won ? 'captured' : 'repelled',
      odds: Math.round(check.forces.odds * 1000) / 1000,
      attackerSize: f.attackerSize,
      defenderSize: f.defenderSize,
      attackerLost: f.attackerLost,
      defenderLost: f.defenderLost,
      cost: check.cost,
      ...(loot > 0 ? { loot } : {}),
      ...(done.ruined === null ? {} : { ruined: done.ruined }),
      ...(companyLine === undefined ? {} : { company: companyLine }),
    },
    ...companyEvents,
  ]);
}

/**
 * Поставить в строй или распустить полевые полки державы игрока (шаг 27, часть C).
 *
 * **Машины покупаются по той же цене и в тот же резерв, что у фракций**
 * (`economy.mechCost`, `FactionEconomy.army`), и оттуда их развозит по
 * направлениям та же логистика. Второго набора правил для армии игрока нет —
 * в этом весь смысл части C: «фальши не должно быть нигде».
 *
 * **Потолок — промышленная мощность домена, а не деньги.** Держава содержит
 * столько полков, сколько её заводы способны чинить: рота, купившая четыре
 * рудника, не выставит армию Дэвиона, сколько бы ни накопила на подрядах. Это
 * тот же `armyTarget`, которым живут фракции с шага 25, — с шага 90 плюс призыв за миры, казармы и заводы и
 * прибавка титула (`realm/army.ts::realmArmyCap`).
 *
 * **Роспуск возвращает половину цены.** Не всю — распродажа полка не окупает
 * его закупку; и не ноль — иначе ошибка игрока была бы необратимой. Полки
 * снимаются сперва с резерва, а недостающее — с театров, от меньшего к
 * большему: домой возвращают сначала тех, кто и так дома.
 */
function executeRaiseRegiment(state: CampaignState, mechs: number): CampaignCommandResult {
  if (!Number.isInteger(mechs) || mechs === 0) return reject(CampaignRejectReason.BadArmyCount);
  if (domainWorlds(state.deltas).length === 0) return reject(CampaignRejectReason.NotOwned);

  state.war = syncDomainEconomy(state.war, state.worldSeed, state.deltas, state.company.cbills);
  const eco = economyOf(state.war, PLAYER_ACTOR_ID);
  const have = totalArmy(state.war, PLAYER_ACTOR_ID);

  if (mechs > 0) {
    // Потолок державы — мощность плюс призыв, постройки и титул (шаг 90, `realm/army.ts`).
    const room = realmArmyCap(state.deltas, eco.capacity).total - have;
    if (room <= 0) return reject(CampaignRejectReason.ArmyMaxed);
    const take = Math.min(mechs, room);
    const price = regimentPrice(take, state.deltas);
    const spent = spend(state.company, price);
    if (spent === null) return reject(CampaignRejectReason.InsufficientFunds);
    state.company = spent;
    state.war = withEconomy(state.war, PLAYER_ACTOR_ID, { army: eco.army + take });
    return ok([
      { kind: 'regimentRaised', mechs: take, armyAfter: have + take, price },
    ]);
  }

  const cut = Math.min(-mechs, have);
  if (cut <= 0) return reject(CampaignRejectReason.BadArmyCount);
  let left = cut;
  const fromReserve = Math.min(left, eco.army);
  state.war = withEconomy(state.war, PLAYER_ACTOR_ID, { army: eco.army - fromReserve });
  left -= fromReserve;
  // Порядок обхода закреплён сортировкой ключей: роспуск обязан быть
  // воспроизводим, как и всё остальное в такте.
  for (const t of theatersOf(state.war, PLAYER_ACTOR_ID)) {
    if (left <= 0) break;
    const take = Math.min(left, t.mechs);
    state.war = withTheater(state.war, PLAYER_ACTOR_ID, t.against, t.mechs - take);
    left -= take;
  }
  const back = regimentRefund(cut, state.deltas);
  state.company = { ...state.company, cbills: state.company.cbills + back };
  return ok([{ kind: 'regimentRaised', mechs: -cut, armyAfter: have - cut, price: -back }]);
}

/** Общая проверка для команд домена: мир есть, и он роты. */
function ownWorld(state: CampaignState, systemId: string): number | CampaignCommandResult {
  const i = GALAXY.index(systemId);
  if (i < 0) return reject(CampaignRejectReason.SystemNotFound);
  if (ownerOf(state.deltas, i) !== PLAYER_ACTOR_ID) return reject(CampaignRejectReason.NotOwned);
  return i;
}

/**
 * Поставить стройку на своём мире (шаг 87, `war/buildings.ts`). Платится сразу; держава строит без роты рядом.
 */
function executeStartBuilding(state: CampaignState, systemId: string, building: BuildingKind): CampaignCommandResult {
  const found = ownWorld(state, systemId);
  if (typeof found !== 'number') return found;
  const blocker = buildBlocker(state.worldSeed, state.deltas, found, building);
  if (blocker !== null) return reject(BUILD_REJECT[blocker]);
  const cost = buildingCost(building);
  const spent = spend(state.company, cost);
  if (spent === null) return reject(CampaignRejectReason.InsufficientFunds);
  state.company = spent;
  const decades = buildEtaDecades(
    state.worldSeed,
    state.deltas,
    found,
    building,
    0,
    realmBonuses(state.deltas, state.realm, state.company.pilots),
  );
  state.deltas = withDelta(state.deltas, systemId, startPatch(building));
  return ok([{ kind: 'buildingStarted', systemId, building, cost, decades }]);
}

const BUILD_REJECT: Readonly<Record<BuildBlocker, CampaignRejectReason>> = {
  notOwned: CampaignRejectReason.NotOwned,
  alreadyBuilt: CampaignRejectReason.AlreadyBuilt,
  buildBusy: CampaignRejectReason.BuildBusy,
  buildNeedsIndustry: CampaignRejectReason.BuildNeedsIndustry,
};

/** Отменить стройку мира (шаг 87): возвращается доля цены. */
function executeCancelBuilding(state: CampaignState, systemId: string): CampaignCommandResult {
  const found = ownWorld(state, systemId);
  if (typeof found !== 'number') return found;
  const c = constructionOf(state.deltas, found);
  if (c === undefined) return reject(CampaignRejectReason.NothingToCancel);
  const refund = buildingRefund(c.kind);
  state.company = { ...state.company, cbills: state.company.cbills + refund };
  state.deltas = withDelta(state.deltas, systemId, CONSTRUCTION_CLEARED);
  return ok([{ kind: 'buildingCancelled', systemId, building: c.kind, refund }]);
}

// ---------------------------------------------------------------------------------------------------------------
// Секторы, губернаторы, стойки (шаг 88, `realm/`)
// ---------------------------------------------------------------------------------------------------------------

/** Заменить сектор с тем же центром или добавить новый в конец (порядок назначения). */
function withSector(r: RealmState, sector: RealmState['sectors'][number]): RealmState {
  const has = r.sectors.some((x) => x.center === sector.center);
  return {
    ...r,
    sectors: has ? r.sectors.map((x) => (x.center === sector.center ? sector : x)) : [...r.sectors, sector],
  };
}

/** Сектор распущен — вместе с ним уходят и ручные отнесения миров к нему (шаг 93). */
function withoutSector(r: RealmState, center: string): RealmState {
  const next: RealmState = { ...r, sectors: r.sectors.filter((x) => x.center !== center) };
  if (r.assigned === undefined) return next;
  return withAssigned(next, Object.fromEntries(Object.entries(r.assigned).filter(([, c]) => c !== center)));
}

/** Ручные отнесения миров к секторам; пустые — поля нет, как у державы до шага 93. */
function withAssigned(r: RealmState, assigned: Readonly<Record<string, string>>): RealmState {
  const { assigned: _old, ...rest } = r;
  return Object.keys(assigned).length === 0 ? rest : { ...rest, assigned };
}

/** Цели стоек, выбранные игроком; пустые — поля нет. */
function withTargets(r: RealmState, targets: Readonly<Record<string, string>>): RealmState {
  const { targets: _old, ...rest } = r;
  return Object.keys(targets).length === 0 ? rest : { ...rest, targets };
}

/**
 * Назначить губернатора (шаг 88). Пилот снимается с машины той же проверкой, что `assignPilot` с `null`: пилот
 * гарнизонной машины на другом мире недоступен. Сектор с этим центром уже есть — губернатор и приоритет меняются.
 */
function executeAppointGovernor(
  state: CampaignState,
  centerId: string,
  pilotId: string,
  priority: GovernorPriority,
): CampaignCommandResult {
  const found = ownWorld(state, centerId);
  if (typeof found !== 'number') return found;
  const pilot = state.company.pilots.find((p) => p.id === pilotId);
  if (pilot === undefined) return reject(CampaignRejectReason.PilotNotFound);
  if (pilot.status !== 'active') return reject(CampaignRejectReason.PilotNotActive);
  const existing = sectorAt(state.realm, centerId);
  if (existing?.governor === pilotId) return reject(CampaignRejectReason.RealmUnchanged);
  if (isGovernor(state.realm, pilotId)) return reject(CampaignRejectReason.PilotIsGovernor);
  if (existing === undefined && state.realm.sectors.length >= sectorLimit(state.deltas)) {
    return reject(CampaignRejectReason.SectorLimit);
  }
  const seat = state.company.mechs.find((m) => m.pilotId === pilotId);
  if (seat !== undefined && !withinReach(state, seat.id)) return reject(CampaignRejectReason.MechStationed);

  const events: CampaignEvent[] = [];
  if (seat !== undefined) {
    state.company = {
      ...state.company,
      mechs: state.company.mechs.map((m) => (m.id === seat.id ? { ...m, pilotId: null } : m)),
    };
    events.push({ kind: 'pilotAssigned', recordId: seat.id, pilotId: null });
  }
  state.realm = withSector(state.realm, { center: centerId, governor: pilotId, priority });
  const replaced = existing?.governor ?? null;
  events.push({
    kind: 'governorAppointed',
    centerId,
    pilotId,
    priority,
    ...(replaced === null ? {} : { replaced }),
  });
  return ok(events);
}

function executeSetSectorPriority(state: CampaignState, centerId: string, priority: GovernorPriority): CampaignCommandResult {
  const sector = sectorAt(state.realm, centerId);
  if (sector === undefined) return reject(CampaignRejectReason.NoSector);
  if (sector.priority === priority) return reject(CampaignRejectReason.RealmUnchanged);
  state.realm = withSector(state.realm, { ...sector, priority });
  return ok([{ kind: 'sectorPrioritySet', centerId, priority }]);
}

/** Снять губернатора — сектор распускается, пилот свободен (шаг 88). */
function executeReleaseGovernor(state: CampaignState, centerId: string): CampaignCommandResult {
  const sector = sectorAt(state.realm, centerId);
  if (sector === undefined) return reject(CampaignRejectReason.NoSector);
  state.realm = withoutSector(state.realm, centerId);
  return ok([{ kind: 'sectorDissolved', centerId, pilotId: sector.governor, reason: 'command' }]);
}

function executePinWorld(state: CampaignState, systemId: string, pinned: boolean): CampaignCommandResult {
  const found = ownWorld(state, systemId);
  if (typeof found !== 'number') return found;
  if (state.realm.pinned.includes(systemId) === pinned) return reject(CampaignRejectReason.RealmUnchanged);
  const next = pinned ? [...state.realm.pinned, systemId].sort() : state.realm.pinned.filter((id) => id !== systemId);
  state.realm = { ...state.realm, pinned: next };
  return ok([{ kind: 'worldPinned', systemId, pinned }]);
}

function executeSetRealmReserve(state: CampaignState, amount: number): CampaignCommandResult {
  if (!isPlayerRealm(state.deltas)) return reject(CampaignRejectReason.DiplomacyLocked);
  if (!WAR.realm.reserveSteps.includes(amount)) return reject(CampaignRejectReason.BadReserve);
  if (state.realm.reserve === amount) return reject(CampaignRejectReason.RealmUnchanged);
  state.realm = { ...state.realm, reserve: amount };
  return ok([{ kind: 'realmReserveSet', amount }]);
}

/** Стойка фронта (шаг 88) — только против врага, с которым идёт война; «держать» снимает запись. */
function executeSetFrontStance(state: CampaignState, factionId: string, stance: FrontStance): CampaignCommandResult {
  if (playerWarOf(state.war, factionId) === undefined) return reject(CampaignRejectReason.NotAtWar);
  const current = state.realm.stances[factionId] ?? 'hold';
  if (current === stance) return reject(CampaignRejectReason.RealmUnchanged);
  const { [factionId]: _old, ...rest } = state.realm.stances;
  state.realm = { ...state.realm, stances: stance === 'hold' ? rest : { ...rest, [factionId]: stance } };
  return ok([{ kind: 'frontStanceSet', factionId, stance }]);
}

/**
 * Цель стойки «наступать» (шаг 93): участок фронта державы против этого врага. Стойка бьёт её по своим же условиям
 * (приказ разрешён, шанс не ниже порога), а не проходит — ждёт; `null` снимает выбор.
 */
function executeSetStanceTarget(state: CampaignState, factionId: string, systemId: string | null): CampaignCommandResult {
  if (playerWarOf(state.war, factionId) === undefined) return reject(CampaignRejectReason.NotAtWar);
  const current = state.realm.targets?.[factionId] ?? null;
  if (current === systemId) return reject(CampaignRejectReason.RealmUnchanged);
  const { [factionId]: _old, ...rest } = state.realm.targets ?? {};
  if (systemId !== null) {
    const i = GALAXY.index(systemId);
    if (i < 0) return reject(CampaignRejectReason.SystemNotFound);
    if (!isFrontTarget(state, factionId, i)) return reject(CampaignRejectReason.NotOnFront);
  }
  state.realm = withTargets(state.realm, systemId === null ? rest : { ...rest, [factionId]: systemId });
  return ok([{ kind: 'stanceTargetSet', factionId, systemId }]);
}

/** Отнести свой мир к сектору явно (шаг 93): центр — живой сектор не дальше радиуса; `null` — снова по геометрии. */
function executeAssignWorldSector(state: CampaignState, systemId: string, center: string | null): CampaignCommandResult {
  const found = ownWorld(state, systemId);
  if (typeof found !== 'number') return found;
  const current = state.realm.assigned?.[systemId] ?? null;
  const { [systemId]: _old, ...rest } = state.realm.assigned ?? {};
  if (center === null) {
    if (current === null) return reject(CampaignRejectReason.RealmUnchanged);
    state.realm = withAssigned(state.realm, rest);
    return ok([{ kind: 'worldSectorAssigned', systemId, center: null }]);
  }
  const sector = sectorAt(state.realm, center);
  if (sector === undefined || !sectorLive(state.deltas, sector)) return reject(CampaignRejectReason.NoSector);
  if (sectorJumps(center, systemId) === undefined) return reject(CampaignRejectReason.SectorTooFar);
  if (current === center) return reject(CampaignRejectReason.RealmUnchanged);
  state.realm = withAssigned(state.realm, { ...rest, [systemId]: center });
  return ok([{ kind: 'worldSectorAssigned', systemId, center }]);
}

const HIRE_REJECT: Readonly<Record<HireBlocker, CampaignRejectReason>> = {
  noRealm: CampaignRejectReason.DiplomacyLocked,
  notAtWar: CampaignRejectReason.NotAtWar,
  regimentHired: CampaignRejectReason.RegimentHired,
  regimentLoyal: CampaignRejectReason.RegimentLoyal,
  noStation: CampaignRejectReason.NoHireStation,
};

/** Нанять великий полк против врага державы (шаг 89, `rivals/hire.ts`). */
function executeHireGreatRegiment(state: CampaignState, regimentId: string, against: string): CampaignCommandResult {
  const regiment = state.rivals.regiments.find((r) => r.id === regimentId);
  if (regiment === undefined) return reject(CampaignRejectReason.RegimentNotFound);
  const blocker = hireBlocker(state.war, state.deltas, regiment, against);
  if (blocker !== null) return reject(HIRE_REJECT[blocker]);
  const price = greatHirePrice(regiment);
  const paid = spend(state.company, price);
  if (paid === null) return reject(CampaignRejectReason.InsufficientFunds);
  state.company = paid;
  const hired = hiredRegiment(regiment, against, hireStation(state.deltas, against) as number, state.day);
  state.rivals = {
    ...state.rivals,
    regiments: state.rivals.regiments.map((r) => (r.id === regimentId ? hired : r)),
  };
  return ok([
    {
      kind: 'greatRegimentHired',
      regimentId,
      regimentName: regiment.name,
      against,
      systemId: hired.systemId,
      price,
      until: (hired.hire as NonNullable<typeof hired.hire>).until,
    },
  ]);
}

/** Ответ на требование соседа (шаг 89, `war/demands.ts`): принять — дань с мира, отказать — набег или отношение вниз. */
function executeAnswerDemand(state: CampaignState, accept: boolean): CampaignCommandResult {
  if (state.war.demands?.pending === undefined) return reject(CampaignRejectReason.NoDemand);
  const r = answerDemand(state.war, state.reputation, state.deltas, state.day, accept, state.worldSeed);
  state.war = r.war;
  state.reputation = r.reputation;
  state.deltas = r.deltas;
  return ok([
    {
      kind: 'demandAnswered',
      from: r.card.from,
      systemId: r.card.systemId,
      outcome: r.outcome,
      ...(r.punishment === undefined ? {} : { punishment: r.punishment }),
    },
  ]);
}

/**
 * Уборка управления державой в такте фронта (шаг 88): стойка против врага, война с которым кончилась, снимается;
 * сектор, чей центр потерян, распускается — губернатор свободен. Закрепление ушедшего мира снимается молча: это
 * пометка игрока, а не решение.
 */
function settleRealm(state: CampaignState): CampaignEvent[] {
  const r = state.realm;
  if (realmIsDefault({ ...r, reserve: WAR.realm.reserveDefault })) return [];
  const events: CampaignEvent[] = [];
  let next = r;
  for (const f of Object.keys(r.stances).sort()) {
    if (playerWarOf(state.war, f) !== undefined) continue;
    const { [f]: _old, ...rest } = next.stances;
    next = { ...next, stances: rest };
    events.push({ kind: 'frontStanceSet', factionId: f, stance: 'hold', ended: true });
  }
  for (const x of r.sectors) {
    if (sectorLive(state.deltas, x)) continue;
    next = withoutSector(next, x.center);
    events.push({ kind: 'sectorDissolved', centerId: x.center, pilotId: x.governor, reason: 'centerLost' });
  }
  const owned = next.pinned.filter((id) => ownerOf(state.deltas, GALAXY.require(id)) === PLAYER_ACTOR_ID);
  if (owned.length !== next.pinned.length) next = { ...next, pinned: owned };
  // Ручное отнесение ушедшего мира снимается молча, как закрепление (шаг 93).
  if (next.assigned !== undefined) {
    const kept = Object.entries(next.assigned).filter(([id]) => ownerOf(state.deltas, GALAXY.require(id)) === PLAYER_ACTOR_ID);
    if (kept.length !== Object.keys(next.assigned).length) next = withAssigned(next, Object.fromEntries(kept));
  }
  // Цель стойки уходит с концом войны или когда перестала быть участком фронта (взята, отдана, фронт закрыт).
  if (next.targets !== undefined) {
    const targets = { ...next.targets };
    for (const f of Object.keys(next.targets).sort()) {
      const id = next.targets[f] as string;
      if (playerWarOf(state.war, f) !== undefined && isFrontTarget(state, f, GALAXY.require(id))) continue;
      delete targets[f];
      events.push({ kind: 'stanceTargetSet', factionId: f, systemId: null, ended: true });
    }
    next = withTargets(next, targets);
  }
  state.realm = next;
  return events;
}

/**
 * Задать фокус своему миру (шаг 25, часть A + C).
 *
 * Платится сразу, действует через год: специализация — решение с отложенным
 * следствием, а не покупка. Пока переделка идёт, мир работает по-старому.
 */
function executeSetWorldFocus(
  state: CampaignState,
  systemId: string,
  focus: WorldFocus,
): CampaignCommandResult {
  const found = ownWorld(state, systemId);
  if (typeof found !== 'number') return found;
  const i = found;

  const d = state.deltas[systemId];
  const current = focusOf(state.deltas, systemId, worldProfile(state.worldSeed, state.deltas, i).naturalFocus);
  if (d?.focusTo !== undefined || current === focus) return reject(CampaignRejectReason.FocusUnchanged);

  const spent = spend(state.company, WAR.focus.cost);
  if (spent === null) return reject(CampaignRejectReason.InsufficientFunds);
  state.company = spent;

  state.deltas = withDelta(state.deltas, systemId, {
    focusTo: focus,
    focusUntil: state.day + WAR.focus.changeDays,
  });
  return ok([
    { kind: 'worldFocus', systemId, owner: PLAYER_ACTOR_ID, from: current, to: focus, started: true },
  ]);
}

/**
 * Вложиться в развитие своего мира — ровно то, что делают государства с шага 23:
 * та же цена ступени, тот же потолок, те же формулы профиля.
 */
function executeDevelopWorld(state: CampaignState, systemId: string): CampaignCommandResult {
  const found = ownWorld(state, systemId);
  if (typeof found !== 'number') return found;

  const from = developmentOf(state.deltas, systemId);
  if (from >= developmentMaxAt(state.deltas, found)) {
    return reject(CampaignRejectReason.DevelopmentMaxed);
  }
  if (!developmentStepMatters(state.worldSeed, state.deltas, found)) {
    return reject(CampaignRejectReason.DevelopmentNoEffect);
  }

  const spent = spend(state.company, developCostAt(state.deltas, found));
  if (spent === null) return reject(CampaignRejectReason.InsufficientFunds);
  state.company = spent;

  state.deltas = withDelta(state.deltas, systemId, { development: from + 1 });
  return ok([
    { kind: 'worldDeveloped', systemId, owner: PLAYER_ACTOR_ID, from, to: from + 1, built: true },
  ]);
}

/**
 * Отказаться от своего мира (шаг 75; до него — продажа шага 72e).
 *
 * Обратный шов к `handWorldToPlayer`: мир уходит владельцу по канону 3053 года
 * (`GALAXY.ownerId`) и возвращается в его экономику ПРИРАЩЕНИЕМ — вклад
 * считается уже под новым владельцем, как его посчитал бы полный пересчёт
 * (`makeWarState`). Незавершённая переделка и запись столицы снимаются: новый
 * хозяин чужую стройку не доводит, а столицей роты мир быть перестал.
 *
 * **Денег рота не получает.** Продажа за долю цены была дырой: полевая армия
 * роты оставалась на театре против нового хозяина и отбивала проданный мир —
 * деньги из ничего. Поэтому же на мир ставится `abandonedUntil`: армия роты
 * `domain.abandonHoldDays` суток на него не наступает.
 *
 * Последний мир при поднятой полевой армии не отдаётся: армия без единого мира
 * осталась бы без снабжения и без потолка, и распустить её потом было бы нечем.
 */
function executeAbandonWorld(state: CampaignState, systemId: string): CampaignCommandResult {
  const found = ownWorld(state, systemId);
  if (typeof found !== 'number') return found;
  const i = found;
  if (domainWorlds(state.deltas).length === 1 && totalArmy(state.war, PLAYER_ACTOR_ID) > 0) {
    return reject(CampaignRejectReason.ArmyStillRaised);
  }

  const to = GALAXY.ownerId(i);
  const builtBefore = realmBuildSnapshot(state.deltas);
  handWorldFromPlayer(state, i, to, state.day + WAR.domain.abandonHoldDays);
  return ok([
    { kind: 'worldAbandoned', systemId, to },
    ...evacuateLostWorlds(state, state.day),
    ...buildingLossEvents(builtBefore, state),
  ]);
}

/**
 * Мир роты уходит фракции `to` — обратный шов к `handWorldToPlayer`, один на
 * отказ (шаг 75, владельцу по канону) и уступку по миру (шаг 76, победителю).
 *
 * Экономика нового хозяина правится приращением — вклад считается уже под ним,
 * как его посчитал бы полный пересчёт (`makeWarState`). Стройка и столица
 * снимаются; брошенная столица передаёт метку первому из оставшихся миров
 * вместе с днём последнего переноса (отсчёт 180 суток не начинается заново).
 * `abandonedUntil` — только у отказа: до этого дня армия роты на мир не наступает.
 */
function handWorldFromPlayer(state: CampaignState, i: number, to: string, abandonedUntil?: number): void {
  const systemId = GALAXY.id(i);
  const pinned = withPlayerCapitalPinned(state.deltas);
  const lostSince = domainCapitalIndex(pinned) === i ? pinned[systemId]?.realmCapitalSince : undefined;
  const left = withDelta(pinned, systemId, {
    // Владелец по канону — это отсутствие записи, как при отбитом мире (`front.ts`).
    owner: to === GALAXY.ownerId(i) ? undefined : to,
    focusTo: undefined,
    focusUntil: undefined,
    realmCapitalSince: undefined,
    realmCapital: undefined,
    abandonedUntil,
    ...LOYALTY_CLEARED,
    // Постройки роты (шаг 87): недострой пропадает, готовые уцелевают броском и спят до возврата мира.
    ...buildingsLostPatch(state.worldSeed, pinned, systemId, state.day).patch,
  });
  state.deltas = withPlayerCapitalPinned(left, lostSince);
  const now = worldContributionAt(state.worldSeed, state.deltas, i);
  const eco = economyOf(state.war, to);
  state.war = withEconomy(state.war, to, {
    income: eco.income + now.income,
    upkeep: eco.upkeep + now.upkeep,
    capacity: eco.capacity + now.capacity,
    worlds: eco.worlds + 1,
  });
}

/**
 * Объявить войну соседу (шаг 76).
 *
 * Отношение пары падает до `playerWar.warRelation` — фронт в ту же декаду;
 * отношение фракции к роте — до `playerWar.declareStanding` (её работа закрыта),
 * остальным — волной по сети, той же формулой, что у договора: союзники
 * фракции холодеют, её враги теплеют. Нельзя при договоре и подчинении — их
 * сперва расторгают — и если уже воюют. Цель (шаг 81) проверяется `warGoalValid`.
 */
function executeDeclareWar(state: CampaignState, factionId: string, goal: WarGoal | undefined): CampaignCommandResult {
  if (!isPlayerRealm(state.deltas)) return reject(CampaignRejectReason.DiplomacyLocked);
  if (factionId === PLAYER_ACTOR_ID || FACTIONS.get(factionId) === undefined) {
    return reject(CampaignRejectReason.SystemNotFound);
  }
  if (!domainBorder(state.deltas).some((b) => b.owner === factionId)) {
    return reject(CampaignRejectReason.NotNeighbour);
  }
  // Уже воюет — только при записи войны (шаг 90). Клан и вольница — враги «от рождения» по вражде, и до шага 90
  // объявить им войну было нельзя («уже воюет»), а без записи нет ни мира, ни перемирия, ни работы державы на их
  // мирах (`notes.md` §10zu п. 9).
  if (playerWarOf(state.war, factionId) !== undefined) {
    return reject(CampaignRejectReason.AlreadyAtWar);
  }
  if (boundOrTruced(state.war, PLAYER_ACTOR_ID, factionId, state.day)) {
    return reject(CampaignRejectReason.WarBlocked);
  }
  if (goal !== undefined && !warGoalValid(state.deltas, factionId, goal)) {
    return reject(CampaignRejectReason.BadWarGoal);
  }

  const declared = declarePlayerWar(state.war, state.reputation, factionId, state.day, goal === undefined ? {} : { goal });
  state.war = declared.war;
  let rep = declared.reputation;
  const drop = Math.min(0, WAR.playerWar.declareStanding - standingOf(rep, factionId));
  for (const change of diplomacyReputation(rep, factionId, drop)) {
    rep = withStanding(rep, change.factionId, change.delta);
  }
  state.reputation = rep;
  return ok([{ kind: 'diplomacyMoved', move: 'war', over: PLAYER_ACTOR_ID, under: factionId }]);
}

/**
 * Заключить мир (шаг 76) на условиях `peaceTerms`: даром, за отступные или —
 * при отставании роты от `cedeFrom` миров — уступив пограничный мир (`cede`).
 * Мир по предложению фракции выдаёт цель роты (шаг 81), исход — `concludePeace`.
 */
function executeMakePeace(
  state: CampaignState,
  factionId: string,
  cede: boolean,
  protectorate: boolean,
): CampaignCommandResult {
  const terms = peaceTerms(state.war, state.deltas, state.worldSeed, factionId, state.day);
  if (terms.kind === 'notAtWar') return reject(CampaignRejectReason.NotAtWar);
  if (terms.kind === 'tooEarly') return reject(CampaignRejectReason.PeaceTooEarly);
  if (terms.kind === 'noPolitics') return reject(CampaignRejectReason.NoPeaceWithPirates);
  // ПРОТЕКТОРАТ КАК УСЛОВИЕ МИРА (шаг 90): вместо цели фракция признаёт сюзеренитет; взятое держится по счёту,
  // как при мире «как есть».
  if (protectorate) {
    if (cede || terms.kind !== 'free' || !terms.offered || !protectorateByPeace(state.war, state.deltas, factionId)) {
      return reject(CampaignRejectReason.ProtectorateNotOffered);
    }
    const builtBefore = realmBuildSnapshot(state.deltas);
    const peace = concludePeace(state, factionId, false, 0, undefined);
    state.war = withVassal(state.war, factionId, { suzerain: PLAYER_ACTOR_ID, sinceDay: state.day });
    state.reputation = shift(state.reputation, PLAYER_ACTOR_ID, factionId, RELATIONS.moves.protectorate);
    return ok([
      { ...peace, protectorate: true },
      { kind: 'diplomacyMoved', move: 'protectorate', over: PLAYER_ACTOR_ID, under: factionId },
      ...evacuateLostWorlds(state, state.day),
      ...buildingLossEvents(builtBefore, state),
    ]);
  }

  let cost = 0;
  let ceded: string | undefined;
  const builtBefore = realmBuildSnapshot(state.deltas);
  if (terms.kind === 'pay') {
    if (cede) {
      if (terms.cede === undefined) return reject(CampaignRejectReason.CedeNotOffered);
      ceded = terms.cede;
      handWorldFromPlayer(state, GALAXY.require(terms.cede), factionId);
    } else {
      const spent = spend(state.company, terms.cost);
      if (spent === null) return reject(CampaignRejectReason.InsufficientFunds);
      state.company = spent;
      cost = terms.cost;
    }
  } else if (cede) {
    return reject(CampaignRejectReason.CedeNotOffered);
  }

  const offered = terms.kind === 'free' && terms.offered;
  const peace = concludePeace(state, factionId, offered, cost, ceded);
  return ok([peace, ...evacuateLostWorlds(state, state.day), ...buildingLossEvents(builtBefore, state)]);
}

/**
 * Исход мира роты (шаг 81) — один для команды и для мира на пределе усталости (`forced`): цель по
 * предложению фракции (миры цели переходят роте, дань с них — на срок лена, унижение — волной по сети
 * без самой фракции), лишнее взятое — назад (`peaceOutcome`), цель фракции — ей, если держава проигрывает
 * войну, объявленную по угрозе (шаг 83), затем перемирие (`applyPlayerPeace`). Отступные и уступленный
 * мир уже списаны вызывающим: исход считается по державе после уступки.
 */
function concludePeace(
  state: CampaignState,
  factionId: string,
  offered: boolean,
  cost: number,
  ceded: string | undefined,
  forced?: 'realm' | 'foe',
): Extract<CampaignEvent, { kind: 'peaceMade' }> {
  const outcome = peaceOutcome(state.war, state.deltas, factionId, offered);
  for (const id of outcome.gained) handWorldToPlayer(state, GALAXY.require(id), factionId, 'peace');
  const tributeUntil = state.day + WAR.diplomacy.tributeDecades * WAR.front.tickDays;
  for (const id of outcome.tributaries) {
    state.deltas = withDelta(state.deltas, id, { tribute: PLAYER_ACTOR_ID, tributeUntil });
  }
  for (const id of outcome.returned) handWorldFromPlayer(state, GALAXY.require(id), factionId);
  // Цель фракции (шаг 83): держава проиграла войну, объявленную по угрозе, и отдаёт требуемые миры.
  for (const id of outcome.ceded) handWorldFromPlayer(state, GALAXY.require(id), factionId);
  if (outcome.humiliation) {
    let rep = state.reputation;
    for (const change of diplomacyReputation(rep, factionId, -WAR.playerWar.humiliationStanding)) {
      if (change.factionId !== factionId) rep = withStanding(rep, change.factionId, change.delta);
    }
    state.reputation = rep;
  }

  const peace = applyPlayerPeace(state.war, state.reputation, factionId, state.day);
  state.war = peace.war;
  state.reputation = peace.reputation;
  return {
    kind: 'peaceMade',
    factionId,
    cost,
    truceUntil: peace.truceUntil,
    ...(ceded === undefined ? {} : { ceded }),
    ...(outcome.gained.length === 0 ? {} : { gained: outcome.gained }),
    ...(outcome.tributaries.length === 0 ? {} : { tributaries: outcome.tributaries }),
    ...(outcome.humiliation ? { humiliated: true as const } : {}),
    ...(outcome.returned.length === 0 ? {} : { returned: outcome.returned }),
    ...(forced === undefined ? {} : { forced }),
    ...(outcome.ceded.length === 0 ? {} : { yielded: outcome.ceded }),
  };
}

/**
 * Перенести столицу державы роты (шаг 72a).
 *
 * Запись `realmCapitalSince` (день переноса) ставится на новый мир и снимается со всех прежних —
 * в том числе с мира, который рота потеряла, чтобы он не стал столицей снова,
 * если его когда-нибудь отобьют. Плечо снабжения и логистика читают столицу
 * одной функцией (`economy.ts::domainCapitalIndex`), и пересчитываются сами.
 */
function executeMoveCapital(state: CampaignState, systemId: string): CampaignCommandResult {
  const found = ownWorld(state, systemId);
  if (typeof found !== 'number') return found;
  const from = domainCapitalIndex(state.deltas);
  if (from === found) return reject(CampaignRejectReason.AlreadyCapital);
  const ready = capitalMoveReadyDay(state.deltas);
  if (ready !== undefined && state.day < ready) return reject(CampaignRejectReason.CapitalMoveCooldown);

  const price = WAR.domain.capitalMoveCost;
  const spent = spend(state.company, price);
  if (spent === null) return reject(CampaignRejectReason.InsufficientFunds);
  state.company = spent;

  let deltas = state.deltas;
  for (const id of Object.keys(deltas).sort()) {
    const d = deltas[id];
    if (d?.realmCapitalSince !== undefined || d?.realmCapital === true) {
      deltas = withDelta(deltas, id, { realmCapitalSince: undefined, realmCapital: undefined });
    }
  }
  state.deltas = withDelta(deltas, systemId, { realmCapital: true, realmCapitalSince: state.day });
  return ok([{ kind: 'capitalMoved', systemId, from: from === undefined ? '' : GALAXY.id(from), price }]);
}

// --- дипломатия игрока (шаг 26, часть C) ----------------------------------------


/**
 * Соглашение с владельцем соседнего мира (ступень 1).
 *
 * **Дипломатия не бесплатна, и платит рота не только деньгами.** Отношение с
 * партнёром растёт, а по политической сети это расходится само
 * (`reputation/accrual.ts` читает матрицу): договор с Куритой роняет отношение с
 * Дэвионом без единого частного случая в коде. Ровно ради этого часть A и
 * делала матрицу живой в обе стороны.
 */
function executeProposePact(
  state: CampaignState,
  factionId: string,
  kind: 'truce' | 'trade',
): CampaignCommandResult {
  if (state.travel !== null) return reject(CampaignRejectReason.AlreadyTravelling);
  if (!isPlayerRealm(state.deltas)) return reject(CampaignRejectReason.DiplomacyLocked);
  if (factionId === PLAYER_ACTOR_ID || FACTIONS.get(factionId) === undefined) {
    return reject(CampaignRejectReason.SystemNotFound);
  }
  // Идёт объявленная война (шаг 76) — договор заключают миром, по счёту войны. Проверка — раньше отношения: на войне
  // отношение держится не выше `declareStanding`, и игрок видел бы порог отношения вместо войны.
  if (playerWarOf(state.war, factionId) !== undefined) return reject(CampaignRejectReason.AlreadyAtWar);
  if (standingOf(state.reputation, factionId) < REPUTATION.diplomacy.minStanding) {
    return reject(CampaignRejectReason.PactStandingTooLow);
  }
  if (pactOf(state.war, PLAYER_ACTOR_ID, factionId) !== undefined) {
    return reject(CampaignRejectReason.PactUnchanged);
  }
  // Соседство обязательно: соглашение заключают с тем, до кого дотягиваются, а
  // не с державой на другом конце Сферы.
  if (!domainBorder(state.deltas).some((b) => b.owner === factionId)) {
    return reject(CampaignRejectReason.NotNeighbour);
  }

  const price = pactPrice(state.worldSeed, state.deltas);
  const spent = spend(state.company, price);
  if (spent === null) return reject(CampaignRejectReason.InsufficientFunds);
  state.company = spent;

  const signed = signPact(state.war, state.reputation, PLAYER_ACTOR_ID, factionId, kind, state.day);
  state.war = signed.war;
  // Партнёр теплеет, а всё остальное расходится по политической сети САМО — той
  // же формулой, что у контракта (`reputation/accrual.ts`). Ровно ради этого
  // часть A и делала матрицу живой в обе стороны: сеть читает её.
  let rep = signed.reputation;
  for (const change of diplomacyReputation(rep, factionId, REPUTATION.diplomacy.pactStanding)) {
    rep = withStanding(rep, change.factionId, change.delta);
  }
  state.reputation = rep;
  return ok([{ kind: 'diplomacyMoved', move: 'pact', over: PLAYER_ACTOR_ID, under: factionId, pact: kind }]);
}

/**
 * Выкупить дань со своего мира (ступень 1).
 *
 * Мир роты нельзя отнять (граница шага 25 стоит), но можно обложить данью — и
 * это единственное, чем война давит на домен. Выкуп деньгами и разом: торговаться
 * о рассрочке не с кем.
 */
function executeBuyOffTribute(state: CampaignState, systemId: string): CampaignCommandResult {
  if (state.travel !== null) return reject(CampaignRejectReason.AlreadyTravelling);
  if (!isPlayerRealm(state.deltas)) return reject(CampaignRejectReason.DiplomacyLocked);
  const i = GALAXY.index(systemId);
  if (i < 0) return reject(CampaignRejectReason.SystemNotFound);
  if (ownerOf(state.deltas, i) !== PLAYER_ACTOR_ID) return reject(CampaignRejectReason.NotOwned);
  const to = tributeOf(state.deltas, systemId, state.day);
  if (to === undefined) return reject(CampaignRejectReason.NoTribute);

  const price = tributePrice(state.worldSeed, state.deltas, i);
  const spent = spend(state.company, price);
  if (spent === null) return reject(CampaignRejectReason.InsufficientFunds);
  state.company = spent;
  state.deltas = withDelta(state.deltas, systemId, { tribute: undefined, tributeUntil: undefined });
  return ok([{ kind: 'tributeBought', systemId, from: to, price }]);
}

/**
 * Обложить данью мир соседа (ступень 2).
 *
 * Тем же `imposeTribute`, что и у фракций: второго способа обложить мир данью в
 * игре нет, и это то самое правило «фальши нет нигде» (шаг 22c). Разница одна —
 * держава платит фондом направления, а рота кассой: военного фонда у неё нет.
 */
function executeDemandTribute(state: CampaignState, systemId: string): CampaignCommandResult {
  if (state.travel !== null) return reject(CampaignRejectReason.AlreadyTravelling);
  if (!isPlayerRealm(state.deltas)) return reject(CampaignRejectReason.DiplomacyLocked);
  const i = GALAXY.index(systemId);
  if (i < 0) return reject(CampaignRejectReason.SystemNotFound);
  const owner = ownerOf(state.deltas, i);
  if (owner === PLAYER_ACTOR_ID) return reject(CampaignRejectReason.AlreadyOwned);
  if (GALAXY.hasFlag(i, 'capital')) return reject(CampaignRejectReason.WorldNotForSale);
  if (!nextToDomain(state.deltas, i)) return reject(CampaignRejectReason.NotNeighbour);
  if (tributeOf(state.deltas, systemId, state.day) === PLAYER_ACTOR_ID) {
    return reject(CampaignRejectReason.PactUnchanged);
  }
  if (standingOf(state.reputation, owner) < REPUTATION.diplomacy.minStanding) {
    return reject(CampaignRejectReason.TributeStandingTooLow);
  }

  const price = tributePrice(state.worldSeed, state.deltas, i);
  const spent = spend(state.company, price);
  if (spent === null) return reject(CampaignRejectReason.InsufficientFunds);
  state.company = spent;

  const imposed = imposeTribute(
    state.war,
    state.deltas,
    state.reputation,
    PLAYER_ACTOR_ID,
    i,
    state.day,
  );
  state.war = imposed.war;
  state.deltas = imposed.deltas;
  state.reputation = imposed.reputation;
  return ok([
    { kind: 'diplomacyMoved', move: 'tribute', over: PLAYER_ACTOR_ID, under: owner, systemId },
  ]);
}

/**
 * Принять державу под протекторат (ступень 2).
 *
 * Условия — те же `canSubmit`, что у фракций: сосед уже платит роте дань
 * несколькими мирами, его армия просела, рота крупнее. Разница одна и она вся в
 * том, КТО решает: у державы решают пороги тикера, у роты — игрок.
 */
function executeOfferProtectorate(state: CampaignState, factionId: string): CampaignCommandResult {
  if (state.travel !== null) return reject(CampaignRejectReason.AlreadyTravelling);
  if (!isPlayerRealm(state.deltas)) return reject(CampaignRejectReason.DiplomacyLocked);
  if (FACTIONS.get(factionId) === undefined) return reject(CampaignRejectReason.SystemNotFound);
  if (suzerainOf(state.war, factionId) !== undefined) return reject(CampaignRejectReason.PactUnchanged);
  if (!canSubmit(state.war, state.reputation, state.deltas, PLAYER_ACTOR_ID, factionId, state.day)) {
    return reject(CampaignRejectReason.WillNotSubmit);
  }

  const price = protectoratePrice(state.worldSeed, state.deltas);
  const spent = spend(state.company, price);
  if (spent === null) return reject(CampaignRejectReason.InsufficientFunds);
  state.company = spent;

  state.war = withVassal(state.war, factionId, { suzerain: PLAYER_ACTOR_ID, sinceDay: state.day });
  state.reputation = shift(state.reputation, PLAYER_ACTOR_ID, factionId, RELATIONS.moves.protectorate);
  return ok([
    { kind: 'diplomacyMoved', move: 'protectorate', over: PLAYER_ACTOR_ID, under: factionId },
  ]);
}

function executeSurvey(state: CampaignState): CampaignCommandResult {
  if (state.travel !== null) return reject(CampaignRejectReason.AlreadyTravelling);
  if (isSurveyed(state.deltas, state.systemId)) return reject(CampaignRejectReason.AlreadySurveyed);
  if (state.queue.some((e) => e.task.kind === 'surveyDone' && e.task.systemId === state.systemId)) {
    return reject(CampaignRejectReason.AlreadySurveyed);
  }

  const { cost, days } = GALAXY_RULES.survey;
  const spent = spend(state.company, cost);
  if (spent === null) return reject(CampaignRejectReason.InsufficientFunds);
  state.company = spent;

  const seq = state.nextSeq;
  state.nextSeq = seq + 1;
  const span = Math.max(1, Math.ceil(days));
  state.queue = insertScheduled(state.queue, {
    day: state.day + span,
    seq,
    task: { kind: 'surveyDone', systemId: state.systemId },
  });

  return ok([{ kind: 'surveyStarted', systemId: state.systemId, cost, days: span }]);
}

/**
 * Разведка закончена: в дельту ложится ОДИН флаг, а не результат.
 *
 * Профиль системы не сохраняется даже здесь — он выводится заново при каждом
 * обращении (ловушка 2 брифинга шага 14). Разведка меняет не мир, а то, что о
 * нём знает игрок.
 */
function applySurveyTask(state: CampaignState, systemId: string): CampaignEvent[] {
  state.deltas = withDelta(state.deltas, systemId, { surveyed: true });
  return [{ kind: 'surveyed', systemId }];
}

// --- рынок (шаг 15) -----------------------------------------------------------

/**
 * Лавка системы, в которой рота СТОИТ.
 *
 * `null` в пути, и это правило, а не забытая ветка: ремонт свой — он идёт
 * везде; рынок чужой — он только там, где ты есть (решение 11 §7 пайплайна).
 * Профиль лавки выводится из класса системы и не хранится нигде.
 */
function marketHere(state: CampaignState): MarketProfile | null {
  if (state.travel !== null) return null;
  return marketProfile(
    state.worldSeed,
    state.systemId,
    standingHere(state),
    developmentHere(state),
    realmMarketOf(state.deltas, state.systemId),
  );
}

/**
 * Отношение владельца ЭТОЙ системы к отряду (шаг 20).
 *
 * Владелец берётся с учётом дельты, а не из каталога: систему мог сменить
 * хозяина тикер войны (шаг 21), и снабжать роту после этого будет уже другая
 * фракция — по своему отношению к ней.
 */
function standingHere(state: CampaignState): number {
  return standingOf(state.reputation, ownerOf(state.deltas, GALAXY.require(state.systemId)));
}

/**
 * Насколько мир, где стоит рота, отстроен сверх канона или сведён ниже него
 * (шаг 23). Рынок читает это как класс: отстроенный мир торгует лучше.
 */
function developmentHere(state: CampaignState): number {
  return developmentOf(state.deltas, state.systemId);
}

/** Что уже скуплено в этой системе за ТЕКУЩУЮ декаду. Список прошлой декады не считается. */
function boughtThisDecade(state: CampaignState): readonly string[] {
  const delta = state.deltas[state.systemId];
  if (delta === undefined || delta.boughtDecade !== decadeOf(state.day)) return [];
  return delta.bought ?? [];
}

/** Оценочная стоимость складской записи — то, от чего считается цена выкупа. */
function entryValue(entry: WarehouseEntry): number {
  return entry.sort === 'node'
    ? nodeValue({ node: entry.node, tonnage: entry.sourceTonnage, tier: entry.tier }, entry.quality, entry.wear)
    : itemCost(entry.itemId);
}

function entryDemandKey(entry: WarehouseEntry): DemandKey {
  return entry.sort === 'node' ? entry.node : entry.kind;
}

/**
 * Складская запись, занятая незавершённой работой: продать её нельзя, она уже в
 * цеху. Установка узла держит одну запись (`partId`), переоснащение — сразу
 * несколько (`partIds`, шаг 19a).
 */
function isReserved(state: CampaignState, partId: string): boolean {
  return state.queue.some(
    (e) =>
      e.task.kind === 'repairJob' &&
      (e.task.partId === partId || e.task.partIds?.includes(partId) === true),
  );
}

/** Все складские записи, занятые работами цеха. Вход в план переоснащения. */
function reservedParts(state: CampaignState): ReadonlySet<string> {
  const out = new Set<string>();
  for (const e of state.queue) {
    if (e.task.kind !== 'repairJob') continue;
    if (e.task.partId !== undefined) out.add(e.task.partId);
    for (const id of e.task.partIds ?? []) out.add(id);
  }
  return out;
}

/**
 * Покупка позиции из лавки.
 *
 * В сохранение уходит ТОЛЬКО факт покупки — id лота и декада (ловушка 1
 * брифинга). Сам ассортимент не хранится: он выводится заново из
 * `(worldSeed, systemId, декада)` при каждом обращении, и потому размер снимка
 * не растёт с числом посещённых систем.
 */
function executeBuyPart(state: CampaignState, lotId: string): CampaignCommandResult {
  const market = marketHere(state);
  if (market === null) return reject(CampaignRejectReason.NotAtMarket);

  const lot = availableStock(
    state.worldSeed,
    state.systemId,
    state.day,
    boughtThisDecade(state),
    standingHere(state),
    developmentHere(state),
    realmMarketOf(state.deltas, state.systemId),
  ).find((l) => l.id === lotId);
  if (lot === undefined) return reject(CampaignRejectReason.LotNotAvailable);

  const spent = spend(state.company, lot.price);
  if (spent === null) return reject(CampaignRejectReason.InsufficientFunds);

  const partId = nextPartId(state);
  const entry: WarehouseEntry = { sort: 'item', id: partId, itemId: lot.itemId, kind: lot.kind };

  state.company = { ...spent, warehouse: [...spent.warehouse, entry] };
  // Позиция постоянного снабжения не вычёркивается: охладители и боезапас не
  // кончаются (шаг 32). Вычеркнуть её значило бы «одна пачка снарядов в декаду
  // на всю планету» — ровно тот дефицит, ради снятия которого снабжение и
  // заведено.
  if (lot.supply !== true) {
    state.deltas = withDelta(state.deltas, state.systemId, {
      boughtDecade: decadeOf(state.day),
      bought: [...boughtThisDecade(state), lotId],
    });
  }

  return ok([{ kind: 'partBought', lotId, partId, cost: lot.price }]);
}

/**
 * Продажа складской записи.
 *
 * Спред покупки и продажи — правило, а не настройка (ловушка 3): цена выкупа
 * заметно ниже цены покупки, иначе возка узлов между системами становится
 * бесконечным доходом. Поверх спреда работают класс системы и спрос на этот
 * вид — обе величины выводятся, а не бросаются из состояния.
 */
function executeSellPart(state: CampaignState, partId: string): CampaignCommandResult {
  const market = marketHere(state);
  if (market === null) return reject(CampaignRejectReason.NotAtMarket);

  const entry = state.company.warehouse.find((w) => w.id === partId);
  if (entry === undefined) return reject(CampaignRejectReason.PartNotFound);
  if (isReserved(state, partId)) return reject(CampaignRejectReason.PartReserved);

  const price = sellPrice(entryValue(entry), market, state.worldSeed, state.day, entryDemandKey(entry));
  state.company = {
    ...state.company,
    cbills: state.company.cbills + price,
    warehouse: state.company.warehouse.filter((w) => w.id !== partId),
  };
  return ok([{ kind: 'partSold', partId, price }]);
}

/**
 * Заказ узла с доставкой — способ достать недоступное на месте.
 *
 * Медленно и дороже: срок и наценка растут по мере удаления от Сферы, а с
 * периферии не возят вовсе. Тоннаж и тир берутся у машины, под которую заказ
 * оформлен, — поэтому доехавший узел гарантированно на неё встанет, и заказ не
 * превращается в лотерею совместимости.
 */
function executeOrderPart(
  state: CampaignState,
  items: readonly OrderSpec[],
): CampaignCommandResult {
  if (items.length === 0) return reject(CampaignRejectReason.PartMismatch);

  const market = marketHere(state);
  if (market === null) return reject(CampaignRejectReason.NotAtMarket);
  if (market.orderDays === 0) return reject(CampaignRejectReason.NoDelivery);

  // Заказать можно только узел, который вообще бывает: тоннаж из каталога
  // шасси и тир из таблицы своего узла. Иначе на склад приезжает деталь,
  // которую некуда поставить, а деньги уже списаны.
  for (const item of items) {
    if (!orderable(item)) return reject(CampaignRejectReason.PartMismatch);
  }

  // Весь счёт списывается разом: связка «реактор + каркас» — одна покупка, и
  // наполовину оплаченной она быть не может.
  const cost = items.reduce(
    (sum, item) =>
      sum +
      orderPrice(
        nodeCost({ node: item.node, tonnage: item.tonnage, tier: item.tier }, item.targetClass),
        market,
      ),
    0,
  );
  const spent = spend(state.company, cost);
  if (spent === null) return reject(CampaignRejectReason.InsufficientFunds);
  state.company = spent;

  const seq = state.nextSeq;
  state.nextSeq = seq + 1;
  const orderId = `order-${seq}`;
  const arrivalDay = state.day + market.orderDays;

  // Каждая позиция едет своей задачей очереди с ОБЩИМ номером заказа: схема
  // сохранения при этом не меняется вовсе, а связка приходит одним днём.
  const events: CampaignEvent[] = [];
  for (const item of items) {
    const part: WarehousePart = {
      sort: 'node',
      id: nextPartId(state),
      node: item.node,
      quality: item.targetClass,
      wear: 0,
      sourceTonnage: item.tonnage,
      tier: item.tier,
    };
    const partSeq = state.nextSeq;
    state.nextSeq = partSeq + 1;
    state.queue = insertScheduled(state.queue, {
      day: arrivalDay,
      seq: partSeq,
      task: { kind: 'deliveryArrived', orderId, part },
    });
    events.push({ kind: 'partOrdered', orderId, partId: part.id, cost, arrivalDay });
  }

  return ok(events);
}

/** Бывает ли такой узел вообще: тоннаж — из каталога шасси, тир — из таблицы своего узла. */
function orderable(item: OrderSpec): boolean {
  const tiers = item.node === 'reactor' ? REACTOR_TIER_COUNT : FRAME_TIER_COUNT;
  if (!Number.isInteger(item.tier) || item.tier < 1 || item.tier > tiers) return false;
  return ORDERABLE_TONNAGES.has(item.tonnage);
}

/**
 * Тоннажи, под которые вообще бывают машины. Берутся из каталога, а не задаются
 * списком: узел под тоннаж, которого нет ни у одного шасси, некуда поставить —
 * то же правило, по которому их берёт прилавок (`market/stock.ts`).
 */
const ORDERABLE_TONNAGES: ReadonlySet<number> = new Set(
  CHASSIS_CATALOG_LIST.map((c) => c.tonnage),
);

/** Заказ доехал. Приходит ровно то, за что заплачено в день оформления, и ровно в назначенный день. */
function applyDeliveryTask(
  state: CampaignState,
  orderId: string,
  part: WarehousePart,
): CampaignEvent[] {
  state.company = { ...state.company, warehouse: [...state.company.warehouse, part] };
  return [{ kind: 'partDelivered', orderId, partId: part.id }];
}

/**
 * Установка узла со склада на машину — работа стапеля.
 *
 * Узел обязан подходить машине по тоннажу И по тиру: реактор с 35-тонника не
 * встанет на 55-тонник, а быстрый реактор — не то же самое, что медленный, и
 * цена у них разная ровно по этой причине (`quality.json` → `tierPrice`).
 * Со склада запись снимается по завершении работы, а не при постановке: пока
 * работа висит в очереди, узел числится в цеху и продать его нельзя.
 */
function executeInstallPart(
  state: CampaignState,
  recordId: string,
  partId: string,
): CampaignCommandResult {
  const record = state.company.mechs.find((m) => m.id === recordId);
  if (record === undefined) return reject(CampaignRejectReason.MechNotFound);

  const part = state.company.warehouse.find((w) => w.id === partId);
  if (part === undefined) return reject(CampaignRejectReason.PartNotFound);
  if (isReserved(state, partId)) return reject(CampaignRejectReason.PartReserved);
  if (part.sort !== 'node') return reject(CampaignRejectReason.PartMismatch);

  const spec = recordNodeSpec(record, part.node);
  // Тоннаж обязан совпадать: реактор с другой машины физически не встанет.
  if (spec.tonnage !== part.sourceTonnage) return reject(CampaignRejectReason.PartMismatch);

  // ТИР совпадать НЕ обязан (шаг 32). До него узел другого тира отвергался, и
  // это запирало целую механику: рынок реакторы всех тиров продавал, а
  // поставить их было некуда, и подвижность машины оставалась намертво такой,
  // какой её выдал каталог. Постановка пользователя 2026-09-07 — «установка
  // скоростных реакторов R2/R3/R4 под тяжёлые сборки»: свободный вес,
  // появившийся после шага 31, должен быть во что вкладывать, и скорость —
  // главное, за что его стоит отдавать.
  //
  // Смена тира меняет ПЛАТФОРМУ: старший реактор тяжелее, и навеска, которая
  // помещалась на R1, на R3 может уже не поместиться. Поэтому проверяется не
  // «совпадает ли тир», а «годится ли машина после замены».
  const swapsTier = spec.tier !== part.tier;
  if (swapsTier) {
    const retiered = withNodeTier(record, part.node, part.tier);
    if (retiered === null) return reject(CampaignRejectReason.PartMismatch);
    const report = validateAssembly(retiered.assembly);
    if (!report.valid) return reject(CampaignRejectReason.BadRefit);
  }

  const site = baySite(state, recordId);
  if (typeof site === 'string') return reject(site);

  const plan = installPlan(spec, part.quality);
  const spent = spend(state.company, plan.cost);
  if (spent === null) return reject(CampaignRejectReason.InsufficientFunds);
  state.company = spent;

  const { jobId, days } = scheduleJob(state, recordId, 'installPart', plan.cost, plan.days, { partId }, site);
  return ok([{ kind: 'jobScheduled', jobId, recordId, work: 'installPart', cost: plan.cost, days }]);
}

/**
 * Та же машина с узлом другого тира (шаг 32 — реактор, шаг 45 — каркас).
 *
 * Код шасси несёт оба тира прямо в себе (`IS-H65-R1F3`), поэтому смена узла —
 * это смена кода при том же тоннаже и той же техбазе. Всё остальное в записи —
 * износ, класс узлов, пилот, история боёв, состояние зон — остаётся нетронутым:
 * машина та же, у неё поменяли деталь.
 *
 * **Шаг 45 завёл вторую половину.** До него существовала только реакторная
 * подмена, но звали её на ЛЮБОЙ узел: установка каркаса другого тира
 * проверялась по сборке с подменённым тиром РЕАКТОРА, а по завершении работы
 * тир каркаса не менялся вовсе. Игрок платил за F2 наценку тира
 * (`quality.json` → `tierPrice`) и получал F1 — тир каркаса на прилавке был
 * фантомом: входил в цену, не входил ни во что больше.
 *
 * `null` — такого шасси нет в каталоге (например, тир вне таблицы).
 *
 * **Имя следует за кодом** (решение пользователя 2026-09-18). Канонические
 * имена каталога различаются по обоим тирам — реактор двигает букву серии
 * (Shadow Hawk A/B/C…), каркас двигает саму модель (Shadow Hawk / Wolverine /
 * Griffin на одном тоннаже) — так что смена узла — это смена не только цифр
 * в характеристиках, но и того, как машина называется. Имя переписывается
 * только если оно СЕЙЧАС совпадает с канонической подписью старого кода:
 * так самодельная сборка вне каталога (свой `assembly.name`, старое
 * сохранение) переживает смену тира со своим именем, а не получает чужое.
 */
function withNodeTier(record: MechRecord, node: WearNode, tier: number): MechRecord | null {
  const chassis = getChassisCatalogEntry(record.assembly.chassisCode);
  // Реактор — группа между «R» и «F», каркас — хвост после «F». Тоннаж и
  // техбаза остаются на месте: подменяется ровно один тир.
  const code =
    node === 'reactor'
      ? chassis.code.replace(/R\d+F/, `R${tier}F`)
      : chassis.code.replace(/F\d+$/, `F${tier}`);
  if (code === chassis.code) return record;
  const next = CHASSIS_CATALOG.get(code);
  if (next === undefined) return null;
  const name = record.name === chassis.canonName ? next.canonName : record.name;
  return { ...record, name, assembly: { ...record.assembly, chassisCode: code } };
}

/**
 * Снятый узел как складская запись (шаг 45).
 *
 * **Снятое ложится на склад** — то же правило, по которому туда ложится снятое
 * мехлабом орудие (`applyRefitTask` ниже прямо этим и открывается). До шага 45
 * установка узла ему не подчинялась: деталь со склада уходила в машину, а
 * стоявший там реактор за 270 000 просто переставал существовать. Для отряда
 * это дороже денег — снятый с 60-тонника серийный R1 есть ровно то, что должно
 * встать на второй 60-тонник.
 *
 * Каким узел сходит, решает не эта функция, а `salvagedNode`: правило схода
 * одно на разбор и на замену, и живёт оно рядом с оценкой.
 */
function stowNode(state: CampaignState, record: MechRecord, node: WearNode): WarehousePart {
  const taken = salvagedNode(record, node);
  return {
    sort: 'node',
    id: nextPartId(state),
    node,
    quality: taken.quality,
    wear: taken.wear,
    sourceTonnage: taken.spec.tonnage,
    tier: taken.spec.tier,
  };
}

/**
 * Продажа машины целиком и НА ХОДУ.
 *
 * Машина обязана быть на ходу — иметь все конечности и восстановленную
 * внутреннюю структуру. Броня может быть повреждена (расходник), но оторванная
 * конечность или пробитая структура продаются только через разбор на лом.
 */
function executeSellMech(state: CampaignState, recordId: string): CampaignCommandResult {
  const record = state.company.mechs.find((m) => m.id === recordId);
  if (record === undefined) return reject(CampaignRejectReason.MechNotFound);
  if (isStationed(state.garrison, recordId)) return reject(CampaignRejectReason.MechStationed);
  if (state.queue.some((e) => e.task.kind === 'repairJob' && e.task.recordId === recordId)) {
    return reject(CampaignRejectReason.MechHasPendingJob);
  }

  const market = marketHere(state);
  if (market === null) return reject(CampaignRejectReason.NotAtMarket);

  if (!hasIntactStructure(record)) {
    return reject(CampaignRejectReason.MechNotRunning);
  }

  const price = sellPrice(mechValue(record), market, state.worldSeed, state.day, 'mech');
  state.company = {
    ...state.company,
    cbills: state.company.cbills + price,
    mechs: state.company.mechs.filter((m) => m.id !== recordId),
  };
  return ok([{ kind: 'mechSold', recordId, price }]);
}

// --- мехлаб, цех и покупка машин (шаг 19a) -------------------------------------

/**
 * Переоснащение — работа стапеля (решение пользователя 2026-09-03).
 *
 * Три отказа и все три — правила, а не проверки формата: сборка обязана
 * проходить валидатор Части 1 и не менять платформу (`BadRefit`), машина
 * обязана быть в паспортном состоянии (`MechNotRepaired`, иначе переоснащение
 * стало бы дешёвым обходом ремонта), а железо — лежать на складе не занятым
 * другой работой.
 */
function executeRefitMech(
  state: CampaignState,
  recordId: string,
  assembly: MechAssembly,
): CampaignCommandResult {
  const record = state.company.mechs.find((m) => m.id === recordId);
  if (record === undefined) return reject(CampaignRejectReason.MechNotFound);
  // Чистый демонтаж проходит и на побитой машине (шаг 33): снять уцелевшее
  // железо с подбитого меха — обычная работа экипажа, а не обход ремонта.
  // Монтаж в побитую машину по-прежнему отклоняется.
  if (!isRefittable(record) && !isStripOnly(record, assembly)) {
    return reject(CampaignRejectReason.MechNotRepaired);
  }

  const plan = refitPlan(state.company, record, assembly, reservedParts(state));
  if (!plan.valid) return reject(CampaignRejectReason.BadRefit);
  const site = baySite(state, recordId);
  if (typeof site === 'string') return reject(site);

  const spent = spend(state.company, plan.cost);
  if (spent === null) return reject(CampaignRejectReason.InsufficientFunds);
  state.company = spent;

  const { jobId, days } = scheduleJob(
    state,
    recordId,
    'refitMech',
    plan.cost,
    plan.days,
    { assembly, partIds: plan.partIds },
    site,
  );
  return ok([{ kind: 'jobScheduled', jobId, recordId, work: 'refitMech', cost: plan.cost, days }]);
}

/**
 * Перекраска — работа стапеля (шаг 50, решение пользователя 2026-09-13).
 *
 * Состояние машины не проверяется: красят и побитую, цвета к ремонту отношения
 * не имеют. Вторая перекраска той же машины, пока первая в цеху, отклоняется —
 * иначе исход решал бы порядок завершения, а не выбор игрока.
 */
function executeRepaintMech(
  state: CampaignState,
  recordId: string,
  paint: string | null,
): CampaignCommandResult {
  const record = state.company.mechs.find((m) => m.id === recordId);
  if (record === undefined) return reject(CampaignRejectReason.MechNotFound);
  if (paint !== null && !isPaintId(paint)) return reject(CampaignRejectReason.PaintNotAvailable);
  if ((record.paint ?? null) === paint) return reject(CampaignRejectReason.SamePaint);

  const pending = state.queue.some(
    (e) => e.task.kind === 'repairJob' && e.task.recordId === recordId && e.task.work === 'repaintMech',
  );
  if (pending) return reject(CampaignRejectReason.MechHasPendingJob);
  const site = baySite(state, recordId);
  if (typeof site === 'string') return reject(site);

  const cost = repaintCost(record);
  const spent = spend(state.company, cost);
  if (spent === null) return reject(CampaignRejectReason.InsufficientFunds);
  state.company = spent;

  const { jobId, days } = scheduleJob(
    state,
    recordId,
    'repaintMech',
    cost,
    REPAINT_DAYS,
    paint === null ? {} : { paint },
    site,
  );
  return ok([{ kind: 'jobScheduled', jobId, recordId, work: 'repaintMech', cost, days }]);
}

/**
 * Следующая ступень лестницы цеха и ангара (`bays.steps`) выше `current` или
 * `null`, если она выше потолка `max`. Лестница одна на двоих (шаг 75):
 * ячейка ангара с номером N стоит как стапель с номером N.
 */
function nextLadderStep(
  current: number,
  max: number,
): { readonly to: number; readonly cost: number; readonly days: number } | null {
  const step = ECONOMY.bays.steps.find((s) => s.to > current);
  return step === undefined || step.to > max ? null : step;
}

/** Следующая ступень лестницы цеха или `null`, если цех уже упёрся в потолок корабля. */
export function nextBayStep(
  bays: number,
  dropshipId: DropshipId = 'leopard',
): { readonly to: number; readonly cost: number; readonly days: number } | null {
  const dropship = ECONOMY.dropships[dropshipId] ?? ECONOMY.dropships.leopard;
  return nextLadderStep(bays, dropship.maxBays);
}

/** Следующая ячейка ангара (шаг 75) или `null`, если ангар открыт до потолка корабля. */
export function nextHangarStep(
  hangar: number,
  dropshipId: DropshipId,
): { readonly to: number; readonly cost: number; readonly days: number } | null {
  return nextLadderStep(hangar, ECONOMY.dropships[dropshipId].mechCapacity);
}

/**
 * Расширение цеха (шаг 19a).
 *
 * Стапель под эту работу НЕ занимается: место не может занимать само себя, а
 * перестройка идёт вокруг работающего цеха. Зато вторую перестройку поверх
 * первой начать нельзя — иначе за одну декаду можно было бы пройти обе ступени,
 * заплатив только временем одной.
 */
function executeUpgradeBays(state: CampaignState): CampaignCommandResult {
  const step = nextBayStep(state.company.bays, state.company.dropship);
  if (step === null) return reject(CampaignRejectReason.BaysMaxed);
  if (state.queue.some((e) => e.task.kind === 'baysUpgraded')) {
    return reject(CampaignRejectReason.BaysUpgrading);
  }

  const spent = spend(state.company, step.cost);
  if (spent === null) return reject(CampaignRejectReason.InsufficientFunds);
  state.company = spent;

  const seq = state.nextSeq;
  state.nextSeq = seq + 1;
  const day = state.day + Math.max(1, Math.ceil(step.days));
  const task: ScheduledTask = { kind: 'baysUpgraded', to: step.to };
  state.queue = insertScheduled(state.queue, { day, seq, task });
  return ok([{ kind: 'taskScheduled', day, seq, task }]);
}

/**
 * Открыть ячейку ангара (шаг 75) — копия `executeUpgradeBays`: ступень всегда
 * следующая, вторую поверх незавершённой не начать, верфь не нужна. Ячейка
 * открывается задачей очереди в срок ступени, а до того рота живёт на прежнем
 * числе мест.
 */
function executeUpgradeHangar(state: CampaignState): CampaignCommandResult {
  const step = nextHangarStep(state.company.hangar, state.company.dropship);
  if (step === null) return reject(CampaignRejectReason.HangarMaxed);
  if (state.queue.some((e) => e.task.kind === 'hangarUpgraded')) {
    return reject(CampaignRejectReason.HangarUpgrading);
  }

  const spent = spend(state.company, step.cost);
  if (spent === null) return reject(CampaignRejectReason.InsufficientFunds);
  state.company = spent;

  const seq = state.nextSeq;
  state.nextSeq = seq + 1;
  const day = state.day + Math.max(1, Math.ceil(step.days));
  const task: ScheduledTask = { kind: 'hangarUpgraded', to: step.to };
  state.queue = insertScheduled(state.queue, { day, seq, task });
  return ok([{ kind: 'taskScheduled', day, seq, task }]);
}

export function nextDropshipId(current: DropshipId): DropshipId | null {
  if (current === 'leopard') return 'union';
  if (current === 'union') return 'overlord';
  return null;
}

/**
 * Модернизация десантного судна роты (Leopard -> Union -> Overlord).
 *
 * Требует наличия верфи в системе (космопорт A/B, столица/хаб или высокий техуровень).
 * Сменяет класс корабля, расширяет вместимость ангара и гарантирует базовое число стапелей нового судна.
 */
function executeUpgradeDropship(state: CampaignState): CampaignCommandResult {
  if (state.travel !== null) return reject(CampaignRejectReason.NotAtMarket);

  const profile = worldProfile(state.worldSeed, state.deltas, state.systemId);
  if (!isShipyard(profile)) return reject(CampaignRejectReason.NotAtShipyard);

  const nextId = nextDropshipId(state.company.dropship);
  if (nextId === null) return reject(CampaignRejectReason.DropshipMaxed);

  const targetDef = ECONOMY.dropships[nextId];
  const spent = spend(state.company, targetDef.upgradeCost);
  if (spent === null) return reject(CampaignRejectReason.InsufficientFunds);

  state.company = {
    ...spent,
    dropship: nextId,
    bays: Math.max(spent.bays, targetDef.minBays),
    hangar: Math.max(spent.hangar, targetDef.minMechs),
  };

  return ok([{ kind: 'dropshipUpgraded', dropship: nextId, cost: targetDef.upgradeCost }]);
}

function applyBaysUpgradedTask(state: CampaignState, to: number): CampaignEvent[] {
  // Ступень применяется, только если она выше текущей: задача из старой очереди
  // не имеет права УМЕНЬШИТЬ цех.
  if (to <= state.company.bays) return [];
  state.company = { ...state.company, bays: to };
  return [{ kind: 'baysUpgraded', to }];
}

function applyHangarUpgradedTask(state: CampaignState, to: number): CampaignEvent[] {
  // Как у цеха: задача из старой очереди не имеет права УМЕНЬШИТЬ ангар.
  if (to <= state.company.hangar) return [];
  state.company = { ...state.company, hangar: to };
  return [{ kind: 'hangarUpgraded', to }];
}

// --- репутация (шаг 20) -------------------------------------------------------

/**
 * ЕДИНСТВЕННОЕ место, где меняется репутация.
 *
 * Ловушка 2 плана шага 20 буквально: как только начисление появится в двух
 * местах, оси разойдутся с журналом, и игрок увидит числа, которых не объяснит
 * ни одно событие. Поэтому все четыре повода — выполнил, отступил, разорвал,
 * просрочил — сходятся сюда, а не считаются каждый у себя.
 *
 * Расчёт при этом живёт НЕ здесь (`reputation/accrual.ts`) и состояния не
 * трогает: ту же функцию зовёт карточка контракта, чтобы показать последствия
 * ДО подписи, и она физически не может ничего сдвинуть.
 */
function accrueReputation(
  state: CampaignState,
  outcome: ReputationOutcome,
  contract: Contract,
): CampaignEvent[] {
  const deltas = contractReputation(
    state.reputation,
    outcome,
    contract.mission,
    contract.employer,
    contract.target,
    contract.atonement === true,
  );
  return applyReputationDeltas(state, deltas, outcome);
}

/** Наложить посчитанное и рассказать об этом событиями. Журнал репутации собирается из них. */
function applyReputationDeltas(
  state: CampaignState,
  deltas: ReputationDeltas,
  source: ReputationOutcome,
): CampaignEvent[] {
  const before = state.reputation;
  state.reputation = applyReputation(before, deltas);

  const events: CampaignEvent[] = [];
  for (const change of deltas.standing) {
    const after = standingOf(state.reputation, change.factionId);
    // Упёршееся в край шкалы изменение в журнал не пишется: строка «Курита
    // −15», не сдвинувшая ничего, — это ровно то враньё о последствиях, ради
    // честности которого шаг и затеян.
    if (after === standingOf(before, change.factionId)) continue;
    events.push({
      kind: 'reputationChanged',
      factionId: change.factionId,
      delta: change.delta,
      after,
      reason: change.reason,
      source,
    });
  }

  const fameDelta = state.reputation.fame - before.fame;
  const reliabilityDelta = state.reputation.reliability - before.reliability;
  if (fameDelta !== 0 || reliabilityDelta !== 0) {
    events.push({
      kind: 'companyReputationChanged',
      fame: state.reputation.fame,
      reliability: state.reputation.reliability,
      fameDelta,
      reliabilityDelta,
      source,
    });
  }
  return events;
}

/**
 * Затухание репутации раз в месяц. Сама переставляет себя дальше — тем же
 * приёмом, что и содержание роты.
 *
 * Событиями сыплет только то, что действительно сдвинулось: месяц без единого
 * контракта не должен заваливать журнал двадцатью строками «отношение не
 * изменилось».
 */
function applyDecayTask(state: CampaignState, day: number): CampaignEvent[] {
  const before = state.reputation;
  // Война держит отношения (шаг 79): затухание про войну не знает и тянуло бы −25 к нулю посреди неё.
  // Договор державы держит доброе отношение к партнёру (отладка 2026-10-03, `decayReputation`).
  const held = new Set(FACTION_LIST.map((f) => f.id).filter((id) => (pactOf(state.war, PLAYER_ACTOR_ID, id)?.untilDay ?? 0) > day));
  // Тревога держит обиду (шаг 91): сосед, которому держава угрожает, не остывает, пока она растёт у его границы.
  const grudges = new Set<string>();
  const border = domainBorder(state.deltas);
  if (border.length > 0) {
    const borders = bordersOf(state.deltas);
    const growth = growthOf(state.war);
    for (const { owner } of border) if (realmAlarm(state.war, borders, growth, owner) > 0) grudges.add(owner);
  }
  state.reputation = holdPlayerWars(state.war, decayReputation(before, held, grudges));

  const events: CampaignEvent[] = [];
  for (const f of FACTION_LIST) {
    const was = before.standing[f.id] ?? 0;
    const now = state.reputation.standing[f.id] ?? 0;
    if (was === now) continue;
    events.push({
      kind: 'reputationChanged',
      factionId: f.id,
      delta: Math.round((now - was) * 100) / 100,
      after: now,
      reason: 'network',
      source: 'decay',
    });
  }
  if (state.reputation.fame !== before.fame) {
    events.push({
      kind: 'companyReputationChanged',
      fame: state.reputation.fame,
      reliability: state.reputation.reliability,
      fameDelta: state.reputation.fame - before.fame,
      reliabilityDelta: 0,
      source: 'decay',
    });
  }

  const seq = state.nextSeq;
  state.nextSeq = seq + 1;
  const nextDay = day + REPUTATION.decay.intervalDays;
  state.queue = insertScheduled(state.queue, { day: nextDay, seq, task: { kind: 'decayTick' } });
  events.push({ kind: 'taskScheduled', day: nextDay, seq, task: { kind: 'decayTick' } });
  return events;
}

/**
 * Покупка машины целиком (шаг 19a).
 *
 * Зеркало `executeBuyPart` во всём, кроме одного: в ростер уходит не складская
 * запись, а `MechRecord` со своим id. Пилота в ней нет — сажает `AssignPilot`,
 * и это не забытая ветка: купленный корпус без экипажа платит содержание и
 * ничего не приносит, ровно как трофейный.
 */
function executeBuyMech(state: CampaignState, lotId: string): CampaignCommandResult {
  const cap = mechCapacityOf(state.company);
  // Гарнизон места в ангаре не занимает (шаг 86b): считаются машины на корабле.
  if (shipboardMechs(state.company, state.garrison).length >= cap) return reject(CampaignRejectReason.HangarFull);

  const market = marketHere(state);
  if (market === null) return reject(CampaignRejectReason.NotAtMarket);

  const lot = availableMechs(
    state.worldSeed,
    state.systemId,
    state.day,
    boughtThisDecade(state),
    standingHere(state),
    developmentHere(state),
    realmMarketOf(state.deltas, state.systemId),
  ).find((l) => l.id === lotId);
  if (lot === undefined) return reject(CampaignRejectReason.LotNotAvailable);

  const spent = spend(state.company, lot.price);
  if (spent === null) return reject(CampaignRejectReason.InsufficientFunds);

  const recordId = nextRecordId(state);
  // Происхождение пишется при покупке, а не при сборке прилавка: прилавок
  // генерируется без дельт мира и о смене хозяина системы не знает.
  const record: MechRecord = {
    ...lot.record,
    id: recordId,
    name: lot.record.name,
    originFaction: ownerOf(state.deltas, GALAXY.require(state.systemId)),
  };
  state.company = { ...spent, mechs: [...spent.mechs, record] };
  state.deltas = withDelta(state.deltas, state.systemId, {
    boughtDecade: decadeOf(state.day),
    bought: [...boughtThisDecade(state), lotId],
  });

  return ok([{ kind: 'mechBought', lotId, recordId, cost: lot.price }]);
}

/** Id новой машины. Тот же монотонный счётчик, что у складских записей и работ. */
function nextRecordId(state: CampaignState): string {
  const seq = state.nextSeq;
  state.nextSeq = seq + 1;
  return `mech-${seq}`;
}

// --- контракты (шаг 16) -------------------------------------------------------

/**
 * Биржа системы, в которой рота СТОИТ.
 *
 * `null` в пути — по тому же правилу, что и лавка (`marketHere`): работу берут
 * там, где сидит наниматель. Отличие от рынка одно и оно в другую сторону:
 * взятый контракт перелёт не отменяет — рота как раз и летит его исполнять.
 */
function boardHere(state: CampaignState): readonly Contract[] | null {
  if (state.travel !== null) return null;
  return availableContracts(
    state.worldSeed,
    state.deltas,
    state.systemId,
    state.day,
    takenThisDecade(state),
    // Четвёртый вход биржи, обещанный брифингом шага 16 и приехавший шагом 20:
    // порог доступности по типу работы, потолок по известности, множители
    // гонорара и трофеев, аванс по надёжности.
    state.reputation,
    // Пятый вход, шаг 21a: экономика фракций. Она снаряжает часть противника —
    // и тип части, и её комплектность (`contracts/supply.ts`).
    state.war,
  );
}

/** Что уже взято в этой системе за ТЕКУЩУЮ декаду биржи. Список прошлой декады не считается. */
function takenThisDecade(state: CampaignState): readonly string[] {
  const delta = state.deltas[state.systemId];
  if (delta === undefined || delta.takenDecade !== contractDecadeOf(state.day)) return [];
  return delta.taken ?? [];
}

/**
 * Взять контракт.
 *
 * Аванс зачисляется сразу, срок ставится задачей очереди суток — провал по
 * сроку обязан сработать сам, даже если рота всё это время чинилась и ни разу
 * не открыла экран контракта.
 */
function executeTakeContract(state: CampaignState, contractId: string): CampaignCommandResult {
  if (state.contract !== null) return reject(CampaignRejectReason.ContractActive);

  const board = boardHere(state);
  if (board === null) return reject(CampaignRejectReason.NotAtMarket);

  const contract = board.find((c) => c.id === contractId);
  if (contract === undefined) {
    // Работа закрыта войной, а не исчезла (шаг 79): причина — та, что на экране биржи.
    const owner = ownerOf(state.deltas, GALAXY.require(state.systemId));
    if (playerWarOf(state.war, owner) !== undefined) return reject(CampaignRejectReason.EmployerAtWar);
    return reject(CampaignRejectReason.ContractNotAvailable);
  }

  const deadlineDay = state.day + contract.durationDays;
  const seq = state.nextSeq;
  state.nextSeq = seq + 1;
  state.queue = insertScheduled(state.queue, {
    day: deadlineDay,
    seq,
    task: { kind: 'contractExpired', contractId: contract.id },
  });

  state.contract = {
    contract,
    takenDay: state.day,
    deadlineDay,
    advancePaid: contract.advance,
    sortie: null,
  };
  state.company = { ...state.company, cbills: state.company.cbills + contract.advance };
  state.deltas = withDelta(state.deltas, state.systemId, {
    takenDecade: contractDecadeOf(state.day),
    taken: [...takenThisDecade(state), contract.id],
  });

  return ok([{ kind: 'contractTaken', contract, advance: contract.advance, deadlineDay }]);
}

/** Снять задачу срока — контракт закрыт любым способом, и её больше некому исполнять. */
function dropDeadlineTask(state: CampaignState, contractId: string): void {
  state.queue = state.queue.filter(
    (e) => !(e.task.kind === 'contractExpired' && e.task.contractId === contractId),
  );
}

/**
 * Разрыв контракта в одностороннем порядке.
 *
 * Аванс возвращается нанимателю, сверх того берётся неустойка. Списание
 * НЕОТМЕНЯЕМОЕ (`chargeUnavoidable`): у роты может не быть денег, но это не
 * повод не платить — уход в минус здесь такое же измеряемое разорение, как от
 * содержания.
 */
function executeAbandonContract(state: CampaignState): CampaignCommandResult {
  const active = state.contract;
  if (active === null) return reject(CampaignRejectReason.NoContract);

  const charged = active.advancePaid + active.contract.penalty;
  state.company = chargeUnavoidable(state.company, charged, state.day);
  dropDeadlineTask(state, active.contract.id);
  state.contract = null;

  // Разрыв в одностороннем порядке — самый тяжёлый удар по надёжности из всех:
  // отряд не проиграл и не отступил, он просто не вышел на работу, за которую
  // уже взял деньги.
  const events: CampaignEvent[] = [
    { kind: 'contractAbandoned', contractId: active.contract.id, charged },
  ];
  events.push(...accrueReputation(state, 'abandoned', active.contract));
  return ok(events);
}

/**
 * Срок вышел, а контракт всё ещё не закрыт: провал.
 *
 * Аванс остаётся у роты — она его отработала временем, — но неустойка берётся
 * полностью. Задача от чужого или уже закрытого контракта молча теряется, тем
 * же правилом, что и нога отменённого маршрута.
 */
function applyContractExpiredTask(
  state: CampaignState,
  contractId: string,
  day: number,
): CampaignEvent[] {
  const active = state.contract;
  if (active === null || active.contract.id !== contractId) return [];

  const penalty = active.contract.penalty;
  state.company = chargeUnavoidable(state.company, penalty, day);
  const contract = active.contract;
  state.contract = null;

  // Провал по сроку — отдельная строка таблицы, а не «честный проигрыш»: рота
  // не проиграла бой, она не появилась вовсе, и надёжность страдает сильнее
  // отношения.
  return [
    { kind: 'contractFailed', contractId, penalty },
    ...accrueReputation(state, 'expired', contract),
  ];
}

/** Годна ли машина к вылету: цела в торсе и голове, есть пилот и пилот в строю. */
function deployable(state: CampaignState, record: MechRecord): boolean {
  // Гарнизон в контракт не идёт (шаг 86b): сперва забрать на корабль.
  if (isStationed(state.garrison, record.id)) return false;
  const zones = record.condition.zones;
  if (zones[zoneFromId('torso')]?.destroyed === true) return false;
  if (zones[zoneFromId('head')]?.destroyed === true) return false;
  if (record.pilotId === null) return false;
  return state.company.pilots.find((p) => p.id === record.pilotId)?.status === 'active';
}

/**
 * Вывести звено на контракт.
 *
 * Команда не создаёт боя — она фиксирует СОСТАВ и СИД вылета. Из них
 * `contracts/active.ts::contractBrief` собирает `BattleBrief` дважды: сейчас,
 * чтобы отдать бою, и потом, при разборе. Сид берётся из потока `camp.contracts`
 * и после этого лежит в состоянии — иначе разбор пересобрал бы противника по
 * другому броску и не нашёл бы в итогах боя ни одной вражеской машины.
 */
function executeDeploy(state: CampaignState, recordIds: readonly string[], auto: boolean): CampaignCommandResult {
  const active = state.contract;
  if (active === null) return reject(CampaignRejectReason.NoContract);
  if (active.sortie !== null) return reject(CampaignRejectReason.AlreadyDeployed);
  // Вылет двигает сутки (`ECONOMY.sortie.days`), а при открытой карточке события время стоит (шаг 84).
  if (cardOpen(state.war)) return reject(CampaignRejectReason.EventPending);
  // РАБОТА «ТОЛЬКО НА ПОЛЕ» (шаг 74) штабу не отдаётся. Проверка здесь, на
  // вылете, а не при разборе: иначе рота успела бы заплатить за высадку и
  // отыграть бой, прежде чем узнать об отказе.
  if (auto && fieldOnly(active.contract)) return reject(CampaignRejectReason.FieldOnly);
  // ПОТОЛОК ВЫЛЕТА — ВМЕСТИМОСТЬ СУДНА (шаг 44d), а не `lanceSize`. Копьё
  // осталось единицей измерения, но перестало быть пределом: Леопард поднимает
  // четвёрку, Юнион — двенадцать, Оверлорд — двадцать четыре.
  //
  // Нижнего предела нет и не будет: с шага 44 противник записан в предложении и
  // от размера вылета не зависит, поэтому выйти вчетвером туда, где выйдет
  // двенадцать, — не выгодная лазейка, а самоубийство. Правило «не меньше
  // стольких-то» понадобилось бы только миру, который подгоняет противника под
  // игрока; такого мира здесь больше нет.
  if (recordIds.length === 0 || recordIds.length > mechCapacityOf(state.company)) {
    return reject(CampaignRejectReason.BadLance);
  }
  if (new Set(recordIds).size !== recordIds.length) return reject(CampaignRejectReason.BadLance);

  const lance: MechRecord[] = [];
  for (const id of recordIds) {
    const record = state.company.mechs.find((m) => m.id === id);
    if (record === undefined) return reject(CampaignRejectReason.MechNotFound);
    if (!deployable(state, record)) return reject(CampaignRejectReason.MechNotDeployable);
    lance.push(record);
  }

  // ПЛАТА ЗА ВЫСАДКУ СВЕРХ НОРМЫ НАНИМАТЕЛЯ (шаг 67). Списывается здесь, при
  // вылете, и не возвращается ни при отходе, ни при провале: корабль сел и
  // поднялся в любом случае. Денег не хватает — вылета нет; взятый контракт
  // остаётся, звено можно собрать меньше.
  const landing = landingQuote(active.contract, lance, state.mode);
  const paid = spend(state.company, landing.fee);
  if (paid === null) return reject(CampaignRejectReason.InsufficientFunds);

  // ГПСЧ трогается только ПОСЛЕ всех проверок: отклонённая команда не имеет
  // права оставить след ни в состоянии, ни в потоке бросков.
  const stream = state.rng.stream('camp.contracts');
  const battleSeed = (stream.next() * 0xffffffff) >>> 0;
  const mapSeed = (stream.next() * 0xffffffff) >>> 0;

  state.company = paid;
  state.contract = { ...active, sortie: { recordIds: [...recordIds], battleSeed, mapSeed } };
  const events: CampaignEvent[] = [
    {
      kind: 'deployed',
      contractId: active.contract.id,
      recordIds: [...recordIds],
      enemyUnits: opforCount(active.contract),
    },
  ];
  if (landing.fee > 0) {
    events.push({
      kind: 'landingPaid',
      contractId: active.contract.id,
      amount: landing.fee,
      feeRatio: landing.feeRatio,
      cbillsAfter: paid.cbills,
    });
  }
  return ok(events);
}

/**
 * Какие трофеи рота увозит с поля.
 *
 * `undefined` — выбор за движком: берутся самые дорогие, ровно `points` штук.
 * Так работает бот-менеджер, и так же ведёт себя игрок, нажавший «взять по
 * умолчанию».
 *
 * Список id — выбор ИГРОКА (экран дебрифинга, шаг 17). Проверяется строго:
 * очков хватает, каждая позиция действительно лежит на поле, повторов нет.
 * `null` означает отказ команды — выбор, которого не могло быть, не должен
 * молча превращаться в другой выбор.
 */
function pickSalvage(
  offered: readonly MechRecord[],
  points: number,
  picked: readonly string[] | undefined,
): MechRecord[] | null {
  if (picked === undefined) return offered.slice(0, points);
  if (picked.length > points) return null;
  if (new Set(picked).size !== picked.length) return null;

  const byId = new Map(offered.map((m) => [m.id, m]));
  const out: MechRecord[] = [];
  for (const id of picked) {
    const record = byId.get(id);
    if (record === undefined) return null;
    out.push(record);
  }
  return out;
}

/**
 * Закрыть контракт по итогам боя — ШОВ шага 16.
 *
 * До этой команды свод боевого результата в ростер шёл в обход команд
 * (`sim/campaign/batch.ts`, `state.company = {...}`), и формального места для
 * него не было. Теперь оно есть, и вместе с ним сюда переезжают три вещи,
 * которые батч раньше приближал руками: постановка раненого в лазарет очередью
 * суток, отчисление потерянного пилота из роты и ограничение трофеев долей из
 * условий контракта.
 */
/**
 * Экстренный заём Гильдии наёмников (шаг 35, questions.md п. 22).
 *
 * Плейтест: десять побед подряд и одно поражение — парка нет, а уцелевшего
 * капитала не хватает даже на лёгкий тридцатитонник. Винрейт 91 % выбрасывал
 * игрока из игры, и это дефект контура, а не сложность.
 *
 * Два условия, и оба обязательны: касса ДЕЙСТВИТЕЛЬНО бедственная и прежний
 * долг погашен. Иначе заём превращается из страховки в источник бесплатных
 * денег, которым удобно финансировать покупки в хорошие времена.
 */
function executeTakeLoan(state: CampaignState): CampaignCommandResult {
  const l = ECONOMY.loan;
  if (state.company.loan !== undefined) return reject(CampaignRejectReason.LoanNotAvailable);
  if (state.company.cbills >= l.eligibleBelow) return reject(CampaignRejectReason.LoanNotAvailable);

  const debt = Math.round(l.principal * (1 + l.interest));
  const installment = Math.ceil(debt / l.installments);
  state.company = {
    ...state.company,
    cbills: state.company.cbills + l.principal,
    loan: { debt, installment },
  };
  return ok([{ kind: 'loanTaken', principal: l.principal, debt, installment }]);
}

/**
 * Кредит песочницы (шаг 74): беспроцентный, без сроков и без лимита — песочница
 * для экспериментов, и деньги в ней не должны быть преградой. Долг лежит
 * отдельно от займа Гильдии (`company.loan`): у того взносы и процент, и
 * ведомость о кредите песочницы не знает ничего.
 */
function executeTakeSandboxLoan(state: CampaignState): CampaignCommandResult {
  if (state.mode !== 'sandbox') return reject(CampaignRejectReason.SandboxOnly);
  const step = ECONOMY.sandbox.loanStep;
  const debt = (state.company.sandboxDebt ?? 0) + step;
  state.company = { ...state.company, cbills: state.company.cbills + step, sandboxDebt: debt };
  return ok([{ kind: 'sandboxLoanTaken', amount: step, debt }]);
}

/** Вернуть шаг кредита песочницы: целиком, из кассы, и только пока долг есть. */
function executeRepaySandboxLoan(state: CampaignState): CampaignCommandResult {
  if (state.mode !== 'sandbox') return reject(CampaignRejectReason.SandboxOnly);
  const owed = state.company.sandboxDebt ?? 0;
  if (owed <= 0) return reject(CampaignRejectReason.NoSandboxDebt);
  const step = Math.min(ECONOMY.sandbox.loanStep, owed);
  const paid = spend(state.company, step);
  if (paid === null) return reject(CampaignRejectReason.InsufficientFunds);
  const debt = owed - step;
  const { sandboxDebt: _cleared, ...rest } = paid;
  state.company = debt > 0 ? { ...paid, sandboxDebt: debt } : rest;
  return ok([{ kind: 'sandboxLoanRepaid', amount: step, debt }]);
}

/**
 * Парк после вылета с сохранением порядка игрока.
 *
 * Вернувшаяся машина встаёт на то место, где стояла, а потерянная просто
 * исчезает: порядок списка игрок расставляет руками (`reorderMechs`), и вылет
 * не вправе сбрасывать его, сдвигая ушедших в бой в конец.
 */
function inPlace(
  fleet: readonly MechRecord[],
  inSortie: ReadonlySet<string>,
  returned: readonly MechRecord[],
): MechRecord[] {
  const byId = new Map(returned.map((m) => [m.id, m]));
  const next: MechRecord[] = [];
  for (const m of fleet) {
    if (!inSortie.has(m.id)) next.push(m);
    else {
      const back = byId.get(m.id);
      if (back !== undefined) next.push(back);
    }
  }
  return next;
}

/**
 * Пилоты роты после боя — контракта или столкновения в приказе армии (шаг 86). Потерянный отчисляется из
 * роты (и с машины); раненый ставится в лазарет ЗАДАЧЕЙ ОЧЕРЕДИ, а не «считается вылечившимся за
 * простой», как приближал батч шага 15. Пишет `state.company` (ростер `company` с пилотами после боя).
 */
function settlePilots(state: CampaignState, company: Company, after: readonly Pilot[]): CampaignEvent[] {
  const byId = new Map(after.map((p) => [p.id, p]));
  const admitted: { readonly pilotId: string; readonly days: number }[] = [];
  const lostPilots: string[] = [];
  const pilots = company.pilots.flatMap((p) => {
    const was = byId.get(p.id);
    if (was === undefined) return [p];
    if (was.status === 'lost') {
      lostPilots.push(p.id);
      return [];
    }
    if (was.status === 'out') {
      const { pilot, days } = admitToMedbay(was);
      admitted.push({ pilotId: p.id, days });
      return [pilot];
    }
    return [was];
  });
  const lostSet = new Set(lostPilots);
  state.company = {
    ...company,
    pilots,
    mechs: company.mechs.map((m) => (m.pilotId !== null && lostSet.has(m.pilotId) ? { ...m, pilotId: null } : m)),
  };

  const events: CampaignEvent[] = [];
  for (const pilotId of lostPilots) events.push({ kind: 'pilotLost', pilotId });
  for (const a of admitted) {
    const seq = state.nextSeq;
    state.nextSeq = seq + 1;
    const day = state.day + Math.max(1, Math.ceil(a.days));
    state.queue = insertScheduled(state.queue, { day, seq, task: { kind: 'medbayDone', pilotId: a.pilotId } });
    events.push({ kind: 'pilotAdmitted', pilotId: a.pilotId, days: day - state.day });
  }
  return events;
}

function executeResolveContract(
  state: CampaignState,
  outcome: BattleOutcome,
  withdrew: boolean,
  salvage: readonly string[] | undefined,
  salvageScrap: readonly string[] | undefined,
  auto: boolean,
): CampaignCommandResult {
  const active = state.contract;
  if (active === null) return reject(CampaignRejectReason.NoContract);
  if (active.sortie === null) return reject(CampaignRejectReason.NotDeployed);

  // 1. Трофеи считаются ПЕРВЫМИ и до единого броска: выбор игрока проверяется
  //    прежде, чем команда что-либо изменит. `salvageOffer` — та же чистая
  //    функция, которой экран дебрифинга показывает список.
  const offer = salvageOffer(state, outcome, withdrew);

  const brief = contractBrief(state);
  const result = offer.result;
  // Отступление отдаёт поле противнику, даже если бой формально не проигран:
  // `heldField` — это про поле, а не про победу, и от него зависит судьба
  // выбывших своих машин (решение 3 §7 пайплайна).
  const held = offer.heldField;

  // Ростер до трофеев: машины вылета заменяются тем, что от них осталось,
  // остальные не трогаются вовсе — они всё это время стояли в ангаре.
  const inSortie = new Set(active.sortie.recordIds);
  // Гарнизон места в ангаре не занимает (шаг 86b).
  const sidelined = shipboardMechs(state.company, state.garrison).filter((m) => !inSortie.has(m.id));

  // Свободные места под целые трофеи ограничены вместимостью десантного
  // корабля роты — тем же лимитом, что и покупка машин на рынке (`HangarFull`).
  // Явный выбор игрока сверх свободных мест отклоняется; выбор по умолчанию
  // («движок берёт самые дорогие») просто не берёт лишнее. Считается через
  // `survivingCompanyIds` — тот же критерий, что у `debrief.company`, но БЕЗ
  // бросков износа: отказ обязан ничего не тратить из ГПСЧ, а сам `debrief`
  // зовётся только ниже, когда все причины для отказа уже позади.
  const survivingCount = survivingCompanyIds(brief, outcome, held).length;
  const freeSlots = Math.max(0, mechCapacityOf(state.company) - sidelined.length - survivingCount);
  if (salvage !== undefined && salvage.length > freeSlots) return reject(CampaignRejectReason.HangarFull);
  const keptLimit = salvage === undefined ? Math.min(offer.points, freeSlots) : offer.points;
  const kept = pickSalvage(offer.trophies, keptLimit, salvage);
  if (kept === null) return reject(CampaignRejectReason.BadSalvage);

  // РАЗБОР НА ПОЛЕ (шаг 34). Трюм запчастей стойками корабля не ограничен,
  // поэтому разобрать трофей можно и при полном ангаре — ровно та ситуация, в
  // которой заработанный трофей раньше просто пропадал.
  const keptIds = new Set(kept.map((m) => m.id));
  const scrapped: MechRecord[] = [];
  if (salvageScrap !== undefined) {
    const byId = new Map(offer.trophies.map((m) => [m.id, m]));
    for (const id of salvageScrap) {
      const record = byId.get(id);
      // Одну машину нельзя и забрать, и разобрать; и дважды разобрать нельзя.
      if (record === undefined || keptIds.has(id) || scrapped.some((m) => m.id === id)) {
        return reject(CampaignRejectReason.BadSalvage);
      }
      scrapped.push(record);
    }
    if (kept.length + scrapped.length > offer.points) return reject(CampaignRejectReason.BadSalvage);
  }

  const debriefed = debrief({
    brief,
    outcome: { ...outcome, heldField: held },
    rng: state.rng,
    // Опыт за сделанную работу платит только выполненный контракт: отход и
    // провал звену ничего не дают (`debrief/index.ts::DebriefOptions`).
    contractDone: result === 'won',
  });

  const events: CampaignEvent[] = [];
  const points = offer.points;

  // 2. Ростер закрывается трофеями, прошедшими проверку вместимости.
  let company: Company = {
    ...state.company,
    mechs: [...inPlace(state.company.mechs, inSortie, debriefed.company), ...kept],
  };

  // 2а. Разобранные на поле трофеи ложатся на склад железом (шаг 34). Правило
  //     разбора то же, что у стапельного (`scrapSalvage`): отдаётся только
  //     уцелевшее, броня и боезапас не отдаются вовсе.
  if (scrapped.length > 0) {
    const entries: WarehouseEntry[] = [];
    for (const record of scrapped) {
      const salv = scrapSalvage(record);
      for (const node of salv.nodes) {
        entries.push({
          sort: 'node',
          id: nextPartId(state),
          node: node.spec.node,
          quality: node.quality,
          wear: node.wear,
          sourceTonnage: node.spec.tonnage,
          tier: node.spec.tier,
        });
      }
      for (const item of salv.items) {
        entries.push({ sort: 'item', id: nextPartId(state), itemId: item.itemId, kind: item.kind });
      }
      events.push({
        kind: 'trophyScrapped',
        recordId: record.id,
        parts: salv.nodes.length + salv.items.length,
      });
    }
    company = { ...company, warehouse: [...company.warehouse, ...entries] };
  }

  // 2б. ВЫКУП НЕВОСТРЕБОВАННЫХ ОЧКОВ (шаг 34, questions.md п. 11).
  //
  //     Игрок торговался за долю утиля при подписании, победил, удержал поле —
  //     и очки сгорали, если ангар полон или машина не нужна. Наниматель в
  //     каноне такой утиль выкупает: техника, брошенная на поле, ему нужна.
  //     Поэтому очко, не потраченное ни на машину, ни на разбор, превращается в
  //     деньги по лучшему из оставшихся трофеев.
  const usedIds = new Set([...keptIds, ...scrapped.map((m) => m.id)]);
  const leftover = offer.trophies.filter((m) => !usedIds.has(m.id));
  const unusedPoints = Math.max(0, points - kept.length - scrapped.length);
  const buyoutCount = Math.min(unusedPoints, leftover.length);
  let buyout = 0;
  for (let i = 0; i < buyoutCount; i++) {
    buyout += Math.round(mechValue(leftover[i]!) * ECONOMY.salvage.buyoutShare);
  }
  // КОМПЕНСАЦИЯ ЗА ДРОБНУЮ ДОЛЮ (решение пользователя 2026-09-08). Считает её
  // `salvageOffer` — тот же предпросмотр, который видел игрок на дебрифинге, —
  // а здесь она только зачисляется. Второй раз с выкупом не складывается: она
  // бывает ровно тогда, когда очков ноль, а выкуп — только когда они есть и
  // остались неистраченными.
  if (offer.compensation > 0) {
    company = { ...company, cbills: company.cbills + offer.compensation };
    events.push({ kind: 'salvageCompensated', amount: offer.compensation, share: offer.share });
  }
  if (buyout > 0) {
    company = { ...company, cbills: company.cbills + buyout };
    events.push({ kind: 'salvageBoughtOut', machines: buyoutCount, amount: buyout });
  }

  // 3. Пилоты.
  events.push(...settlePilots(state, company, debriefed.pilots));

  // 4. Расчёт с нанимателем. Аванс уже уплачен при взятии — здесь только
  //    остаток при успехе и неустойка при провале. Отступление не платит и не
  //    штрафует: отряд отработал честно и ушёл.
  //    ВТОРОЙ ГОНОРАР ЗА РАЗГРОМ (решение пользователя 2026-09-08). Исход
  //    «выполнено с превышением» существовал с шага 19b и платил только
  //    репутацией: рота выбивала противника целиком там, где хватало
  //    продержаться шесть ходов, и получала ровно столько же, сколько за уход
  //    по сроку. Теперь у контракта две ставки: за выполненное условие и за
  //    очищенное поле. У штурма превышения не бывает — его задача и есть
  //    разгром (`reputationOutcomeOf`), и вторично за неё не платят.
  const beyondOutcome = reputationOutcomeOf(result, outcome, active.contract.mission) === 'beyond';
  let settlement = 0;
  if (result === 'won') {
    const payout = beyondOutcome
      ? Math.round(active.contract.payout * CONTRACTS.beyond.payFactor)
      : active.contract.payout;
    settlement = payout - active.advancePaid;
    state.company = { ...state.company, cbills: state.company.cbills + settlement };
  } else if (result === 'lost') {
    settlement = -active.contract.penalty;
    state.company = chargeUnavoidable(state.company, active.contract.penalty, state.day);
  } else if (result === 'withdrawn' && outcome.engaged === false) {
    // ОТХОД БЕЗ ОГНЕВОГО КОНТАКТА ВОЗВРАЩАЕТ АВАНС (шаг 35, questions.md п. 1).
    //
    // Отход был единственным исходом, который не платит и не штрафует, — и это
    // читалось как справедливость («отряд отработал честно и ушёл»), пока не
    // выяснилось, что отработать необязательно: подписать контракт, забрать
    // 25-35 % аванса, высадиться и отвести звено на первом ходу давало чистый
    // доход без единого выстрела и без неустойки.
    //
    // Отход ПОСЛЕ боя остаётся тем, чем задуман: отряд дрался, оценил силы и
    // ушёл — это решение, а не обман, и денег оно не стоит. Разделяет их ровно
    // огневой контакт: наниматель платит за попытку, а не за высадку.
    settlement = -active.advancePaid;
    state.company = chargeUnavoidable(state.company, active.advancePaid, state.day);
  }

  dropDeadlineTask(state, active.contract.id);
  state.contract = null;

  // ПАМЯТЬ МИРА (шаг 27a, часть B). Планета запоминает, что рота здесь дралась,
  // за кого и чем это кончилось. Пишется ЗДЕСЬ и только здесь — второе место,
  // ведущее ту же запись, разошлось бы с первым через месяц.
  //
  // Отступление считается наравне с проигрышем: мир помнит, что рота ушла с
  // поля, а не разбирает, почему. РАЗРЫВ контракта памяти не оставляет вовсе —
  // отряд не вышел на работу, боя не было, и планете нечего помнить.
  // Запись ложится в разрежённую дельту и есть только у миров, где рота
  // воевала, — за десять лет это сотни планет, не тысячи.
  state.deltas = withWorldMemory(
    state.deltas,
    active.contract.systemId,
    active.contract.employer,
    result === 'won',
    dateOf(state.day).year,
  );

  // 5. Репутация (шаг 20). Начисляется ПОСЛЕ расчёта и последней: она читает
  //    исход, но на деньги и трофеи этого контракта уже не влияет — её
  //    множители сидят в условиях, подписанных при взятии.
  const repOutcome = beyondOutcome
    ? 'beyond'
    : reputationOutcomeOf(result, outcome, active.contract.mission);

  events.push({
    kind: 'contractResolved',
    contractId: active.contract.id,
    result,
    settlement,
    salvagePoints: points,
    salvageAvailable: offer.trophies.length,
    trophyRecordIds: kept.map((m) => m.id),
    lostRecordIds: [...debriefed.lostRecordIds],
  });
  events.push(...accrueReputation(state, repOutcome, active.contract));

  // 6. Вклад роты в войну (шаг 21b, часть C, решение 5). Только победа: рота,
  //    отступившая с поля или провалившая работу, войну нанимателю не двигает.
  //
  //    Идёт ПОСЛЕДНИМ и в военный фонд нанимателя против цели — то есть туда
  //    же, куда государство откладывает само. Четыре машины войну не выигрывают:
  //    доля выставлена так, чтобы вклад читался в сводке и не был виден на
  //    карте, и это подобрано замером, а не на глаз.
  if (result === 'won') {
    const before = fundOf(state.war, active.contract.employer, active.contract.target);
    state.war = withCompanyEffort(
      state.war,
      active.contract.employer,
      active.contract.target,
      active.contract.payout,
    );
    const amount = fundOf(state.war, active.contract.employer, active.contract.target) - before;
    if (amount > 0) {
      events.push({
        kind: 'warEffort',
        employer: active.contract.employer,
        target: active.contract.target,
        amount,
      });
    }
  }

  // 6б. РАБОТА ДОМА (шаг 85). Победа на своём мире поднимает его лояльность, а подавленное восстание
  //     кончается. Работа против врага, с которым держава воюет, идёт в войну так же, как бой фронта:
  //     в счёт, а сбитые машины врага — с его театра против державы и в его усталость
  //     (`playerWar.ts::notePlayerLosses`). Флаг она не двигает: ставки у работы дома нет (`board.ts`).
  if (isPlayerActor(active.contract.employer) && result === 'won') {
    const target = active.contract.target;
    const revolting = active.contract.revolt === true && state.deltas[active.contract.systemId]?.revoltSince !== undefined;
    state.deltas = withLoyaltyWin(state.deltas, active.contract.systemId, active.contract.revolt === true);
    if (revolting) events.push({ kind: 'worldRevoltSuppressed', systemId: active.contract.systemId });
    // Пираты у дома (шаг 89): отбитая вольница — работа снимается; мир вычищает общий шов ниже (п. 7).
    if (active.contract.homeRaid === true && state.deltas[active.contract.systemId]?.raidedUntil !== undefined) {
      state.deltas = withDelta(state.deltas, active.contract.systemId, { raidedUntil: undefined });
      events.push({ kind: 'homeRaidRepelled', systemId: active.contract.systemId, by: 'company' });
    }
    // ПРАВО ФЛАГА (шаг 90): победа державы над владельцем мира, на котором шла работа, — работа державы на мире
    // врага (`board.ts::warWorkOffers`). Её и только её засчитывает захват мира врага.
    const here = active.contract.systemId;
    if (ownerOf(state.deltas, GALAXY.require(here)) === target) {
      state.deltas = withDelta(state.deltas, here, { realmWon: (state.deltas[here]?.realmWon ?? 0) + 1 });
    }
    const rec = playerWarOf(state.war, target);
    if (active.contract.revolt !== true && rec !== undefined) {
      const theirUnits = outcome.units.filter((u) => u.side === 'opfor');
      const theirLost = theirUnits.filter((u) => u.unit.destroyed || u.unit.pilot.status !== 'active').length;
      const before = withPlayerWar(state.war, target, { ...rec, won: rec.won + 1 });
      const after = withTheaterLoss(before, target, PLAYER_ACTOR_ID, theirLost);
      state.war = notePlayerLosses(before, after, PLAYER_ACTOR_ID, target, 0, theirUnits.length);
    }
  }

  // 6а. СУДЬБА СЕКТОРА (шаг 44e). Исход крупной фронтовой работы двигает ФЛАГ
  //     ПЛАНЕТЫ — ту самую связь «тактика → стратегия», ради которой затевался
  //     весь шаг: после боя карта выглядит иначе.
  //
  //     Две ставки, и они несимметричны, потому что несимметрична сама биржа:
  //     наниматель — это ВЛАДЕЛЕЦ мира, на котором висит предложение
  //     (`board.ts`), и «победа отдаёт ему эту планету» было бы пустой строкой —
  //     она уже его.
  //
  //     * ОБОРОНА: проиграли — мир переходит противнику. Тот самый вес, которого
  //       не хватало: проигранный бой видно на звёздной карте.
  //     * ШТУРМ: выиграли — наниматель занимает СОСЕДНИЙ мир противника, тот, за
  //       который здесь и шла война. Так же двигает фронт и государство в своём
  //       такте (`war/front.ts`); разница лишь в том, что одну попытку решила
  //       рота, а не бросок.
  //
  //     Обратные исходы флага не двигают и двигать не должны: удержанная оборона
  //     оставляет мир там, где он был, а сорванный штурм — просто неудача.
  //
  //     Ограничители от «рота перекрасила полсферы» стоят на бирже, а не здесь:
  //     ставка бывает только у ротной и батальонной работы на горячем участке
  //     (`contracts.json → opfor.sector`), а фронт двигается и без игрока —
  //     отбитый мир могут отбить обратно.
  if (active.contract.stakes === 'sector') {
    const here = GALAXY.require(active.contract.systemId);
    const employer = active.contract.employer;
    const target = active.contract.target;

    let taken: number | null = null;
    let capturer: string | null = null;
    let loser: string | null = null;
    if (result === 'lost' && active.contract.mission === 'defense' && ownerOf(state.deltas, here) === employer) {
      taken = here;
      capturer = target;
      loser = employer;
    } else if (result === 'won' && active.contract.mission === 'assault') {
      // Мир, за который шёл бой: ближайший сосед под флагом противника.
      // Каталог соседства уже посчитан, и порядок в нём устойчив — значит
      // устойчив и выбор: один и тот же бой не может однажды взять один мир,
      // а при перезагрузке другой.
      for (const n of GALAXY.neighbors(here)) {
        if (ownerOf(state.deltas, n) === target) {
          taken = n;
          capturer = employer;
          loser = target;
          break;
        }
      }
    }

    if (taken !== null && capturer !== null && loser !== null) {
      const applied = applySystemCapture(
        state.war,
        state.deltas,
        state.worldSeed,
        taken,
        capturer,
        loser,
        state.rng.stream('camp.war'),
        state.day,
      );
      state.war = applied.war;
      state.deltas = applied.deltas;

      // ЭХО ЗАХВАТА — то же самое, что делает такт фронта вокруг своего
      // `capture` (`war/front.ts`): без него мир, взятый ротой, отличался бы от
      // мира, взятого державой, и отличался бы молча. Отношения воевавшей пары
      // вниз, взятый мир — в счёт объявленного замысла, потери — с театра.
      state.reputation = withRelation(
        state.reputation,
        capturer,
        loser,
        relationOf(state.reputation, capturer, loser) - WAR.front.relationPerMove,
      );
      state.war = notePlanCapture(state.war, capturer, loser);

      const ourLost = debriefed.lostRecordIds.length;
      const theirUnits = outcome.units.filter((u) => u.side === 'opfor');
      const theirLost = theirUnits.filter(
        (u) => u.unit.destroyed || u.unit.pilot.status !== 'active',
      ).length;
      // С театра списывается сторона, которая эти машины и потеряла: рота воюет
      // за нанимателя, но полком державы не является, поэтому её потери на театр
      // не ложатся — ложатся потери противника.
      state.war = withTheaterLoss(state.war, loser, capturer, capturer === employer ? theirLost : ourLost);

      const ourSize = active.sortie.recordIds.length;
      const theirSize = theirUnits.length;
      const attackerIsPlayerSide = capturer === employer;
      events.push({
        kind: 'frontMoved',
        systemId: applied.move.systemId,
        kindOfMove: applied.move.kind,
        attacker: applied.move.attacker,
        defender: applied.move.defender,
        ruined: applied.move.ruined,
        odds: Math.round((ourSize / Math.max(1, theirSize)) * 1000) / 1000,
        attackerSize: attackerIsPlayerSide ? ourSize : theirSize,
        defenderSize: attackerIsPlayerSide ? theirSize : ourSize,
        attackerLost: attackerIsPlayerSide ? ourLost : theirLost,
        defenderLost: attackerIsPlayerSide ? theirLost : ourLost,
      });
    }
  }

  // 7. МИР СТАЛ ЧИЩЕ (шаг 37a). Выигранный подряд против вольницы двигает
  //    пиратскую активность системы вниз, и волной — у соседей за прыжок.
  //
  //    ШКАЛА, А НЕ ФЛАЖОК, и это требование замысла: «чем больше успешных
  //    контрактов — тем чище мир». Порог отвечал бы игроку только на третьем
  //    контракте, шкала отвечает с первого — на бирже сразу меньше пиратской
  //    работы. Отсюда же и стимул лететь дальше: вычищенный мир перестаёт
  //    кормить, и рота ищет следующий очаг.
  //
  //    Тот же шов зовёт и такт соперников (`rivals/tick.ts`): вычистить мир мог
  //    кто угодно, и это свойство МИРА, а не роты.
  if (result === 'won' && active.contract.target === PIRATE_FACTION) {
    const i = GALAXY.require(active.contract.systemId);
    state.deltas = withPirateClearing(state.deltas, i);
    events.push({
      kind: 'pirateCleared',
      systemId: active.contract.systemId,
      cleared: clearedOf(state.deltas, active.contract.systemId),
    });
  }

  // БОЕВОЙ ВЫЛЕТ ЗАНИМАЕТ ВРЕМЯ (шаг 35, questions.md п. 2).
  //
  // Бой не двигал сутки вовсе — по разумной причине: тактический раунд длится
  // десять секунд, весь бой минуту-две. Но вылет это не бой: это спуск с орбиты,
  // выход на позицию, операция и эвакуация шаттлом. Пока сутки стояли, игрок за
  // один игровой день брал, отыгрывал и закрывал ВСЕ контракты декады на
  // планете, и ни ремонт, ни ведомость, ни срок контракта не значили ничего.
  //
  // Время двигается тем же `advance`, что и обычный ход: в очереди сидят наряды
  // цеха, лазарет и сроки контрактов, и сдвиг `state.day` напрямую разошёлся бы
  // с ними на первом же дне.
  // 7. ДОСТИЖЕНИЯ ЗА БОЙ (шаг 69) — только за отыгранный игроком. Здесь, до
  //    сдвига суток на вылет: день открытия — день боя. Достижения из
  //    состояния (касса, корабль) проверяет `execute` после любой команды.
  if (!auto) {
    const unlocked = awardBattle(state, {
      brief,
      outcome,
      won: result === 'won',
      beyond: beyondOutcome,
      taken: [...kept, ...scrapped],
    });
    for (const id of unlocked) events.push({ kind: 'achievementUnlocked', id });
  }

  const sortieDays = ECONOMY.sortie.days;
  if (sortieDays > 0) {
    const advanced = executeAdvance(state, state.day + sortieDays);
    if (advanced.ok) events.push(...advanced.events);
  }

  return ok(events);
}

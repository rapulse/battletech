import {
  dateOf,
  execute,
  foundingInit,
  hashCampaignState,
  makeSaveFile,
  parseSaveFile,
  restore,
  RIVALS,
  snapshot,
  contractBrief,
  maxZones,
  recordChassisDef,
  CampaignState,
  type CampaignCommand,
  type CampaignEvent,
  type MechRecord,
  type ScheduledTask,
} from '../../core/campaign/index.js';
import {
  FAST_FIDELITY,
  FULL_FIDELITY,
  parseSeedRange,
  runCampaign,
  toCsv,
  type BattleResolver,
} from './batch.js';
import { chooseSortie, crewUp, pickContract, repairStep, supplyStep } from './manager.js';
import { advanceAnswering } from './worldEvents.js';
/**
 * Прогон кампании из терминала (шаг 10; вертикальный срез — шаг 16).
 *
 *   pnpm camp --seed 1 --days 365                          год времени с журналом
 *   pnpm camp --seed 1 --days 3650 --tasks 500 --quiet     замер: десять лет
 *   pnpm camp --seed 1 --contracts 20                      ПРИЁМКА шага 16: полный цикл командами
 *   pnpm camp --seeds 1..70 --contracts 20                 замер §6: батч кампаний в CSV
 *
 * `--contracts` — приёмочный сценарий шага 16: рота берёт работу с биржи, выводит звено,
 * дерётся, разбирается, чинится и берёт следующую — и всё это командами, без единого экрана.
 * До шага 16 этот же ключ гонял бои подряд руками, потому что ни оплаты, ни шва для свода
 * результата в ростер не существовало.
 *
 * `--fidelity fast` (шаг 18) считает бой статистически, без розыгрыша ходов
 * (`core/campaign/bridge/fastResolve.ts`). Он в сотни раз дешевле полного, и
 * именно он снимает потолок в 1400 боёв: `--seeds 1..500 --contracts 20`
 * быстрым расчётом проходит за секунды. Расхождение с полным замерено
 * калибровкой (`pnpm fastcalib`) и записано в `wiki/decisions.md`.
 */

interface Args {
  readonly seed: number;
  readonly days: number;
  readonly tasks: number;
  readonly name: string;
  readonly quiet: boolean;
  readonly contracts: number;
  readonly fidelity: string;
  /** `--seeds 1..70` — батч кампаний в CSV (шаг 13, замер §6). `''` — однопрогонные режимы выше. */
  readonly seeds: string;
  readonly repairThreshold: number;
  /**
   * Насколько бот готов драться в меньшинстве (шаг 16). Ручка «решения
   * отступить». Три четверти, а не единица: замер шага 16a показал, что бот с
   * равными шансами теряет парк в половине кампаний — при том, что заменить
   * потерянную машину покупкой негде до шага 19. Осторожный берёт на четверть
   * меньше работы и доживает до конца в семи случаях из десяти вместо пяти.
   */
  readonly odds: number;
  /** Порог вылета (шаг 67, `ManagerPolicy.sortieOdds`); `null` — умолчание бота. */
  readonly sortieOdds: number | null;
  /**
   * Порог верности (шаг 20): отношение, выше которого бот не берёт работу
   * ПРОТИВ фракции. `null` — сторону не выбирать вовсе (контрольный угол
   * замера). Ключ `--loyalty <число|off>`.
   */
  readonly loyaltyThreshold: number | null;
  /** Снабжение (шаг 15): потолок парка, порог вылета за классом и дальность поиска рынка. */
  readonly fleetCap: number;
  readonly supplyThreshold: number;
  readonly supplyJumps: number;
  /** Пришпилить старт батча к одной системе. Пусто — разброс по карте от сида (`batch.ts`). */
  readonly start: string;
}

function parseArgs(argv: readonly string[]): Args {
  let seed = 1;
  let days = 365;
  let tasks = 0;
  let name = 'Железный Авангард';
  let quiet = false;
  let contracts = 0;
  let fidelity = 'full';
  let seeds = '';
  let repairThreshold = 0;
  // Шаг 68: 0.75 → 0.58 вместе с оценкой по огню и живучести — та же
  // осторожность в новой шкале (`data/rivals.json → contractOdds`, пояснение там).
  let odds = 0.58;
  let sortieOdds: number | null = null;
  let fleetCap = 6;
  let supplyThreshold = 600_000;
  let supplyJumps = 3;
  let start = '';
  /**
   * Порог верности (шаг 20): отношение, выше которого бот не бьёт фракцию.
   * Пустая строка — умолчание (`LOYALTY_DEFAULT`); `off` — контрольный угол
   * замера, где сторона не выбирается вовсе.
   */
  let loyalty = '';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    switch (arg) {
      case '--seed':
        seed = Number(value);
        i++;
        break;
      case '--days':
        days = Number(value);
        i++;
        break;
      case '--tasks':
        tasks = Number(value);
        i++;
        break;
      case '--name':
        name = String(value);
        i++;
        break;
      case '--quiet':
        quiet = true;
        break;
      case '--contracts':
        contracts = Number(value);
        i++;
        break;
      case '--fidelity':
        fidelity = String(value);
        i++;
        break;
      case '--seeds':
        seeds = String(value);
        i++;
        break;
      case '--repair-threshold':
        repairThreshold = Number(value);
        i++;
        break;
      case '--odds':
        odds = Number(value);
        i++;
        break;
      case '--sortie-odds':
        sortieOdds = Number(value);
        i++;
        break;
      case '--fleet-cap':
        fleetCap = Number(value);
        i++;
        break;
      case '--supply-threshold':
        supplyThreshold = Number(value);
        i++;
        break;
      case '--supply-jumps':
        supplyJumps = Number(value);
        i++;
        break;
      case '--start':
        start = String(value);
        i++;
        break;
      case '--loyalty':
        loyalty = String(value);
        i++;
        break;
      default:
        if (arg !== undefined && arg.startsWith('--')) {
          throw new Error(`Неизвестный ключ: ${arg}`);
        }
    }
  }

  if (!Number.isFinite(seed) || !Number.isFinite(days) || !Number.isFinite(tasks) || !Number.isFinite(contracts)) {
    throw new Error('Ключи --seed, --days, --tasks и --contracts ожидают числа');
  }
  if (contracts === 0 && seeds === '' && days <= 0) throw new Error('--days должен быть больше нуля');
  if (fidelity !== 'full' && fidelity !== 'fast') {
    throw new Error(`--fidelity «${fidelity}» не поддержан: есть «full» и «fast»`);
  }

  if (!Number.isFinite(odds) || odds <= 0) throw new Error('--odds ожидает положительное число');
  if (sortieOdds !== null && (!Number.isFinite(sortieOdds) || sortieOdds <= 0)) {
    throw new Error('--sortie-odds ожидает положительное число');
  }

  if (!Number.isFinite(fleetCap) || fleetCap < 1) throw new Error('--fleet-cap ожидает число не меньше единицы');
  if (!Number.isFinite(supplyThreshold) || supplyThreshold < 0) {
    throw new Error('--supply-threshold ожидает неотрицательное число');
  }
  if (!Number.isFinite(supplyJumps) || supplyJumps < 0) throw new Error('--supply-jumps ожидает неотрицательное число');

  let loyaltyThreshold: number | null = LOYALTY_DEFAULT;
  if (loyalty === 'off') loyaltyThreshold = null;
  else if (loyalty !== '') {
    loyaltyThreshold = Number(loyalty);
    if (!Number.isFinite(loyaltyThreshold)) {
      throw new Error('--loyalty ожидает число или «off»');
    }
  }

  return {
    seed,
    days,
    tasks,
    name,
    quiet,
    contracts,
    fidelity,
    seeds,
    repairThreshold,
    odds,
    sortieOdds,
    fleetCap,
    supplyThreshold,
    supplyJumps,
    start,
    loyaltyThreshold,
  };
}

/**
 * Умолчание порога верности.
 *
 * Двадцать пять — ровно порог тяжёлых типов работ (`data/reputation.json` →
 * `access.missions.defense`): отряд не бьёт того, кто уже готов доверить ему
 * оборону. Число одно и то же не случайно — иначе бот разрушал бы доступ ровно
 * к тому, чего только что добился.
 */
const LOYALTY_DEFAULT = 25;

/** Форматирование даты живёт здесь, а не в ядре: ядро знает только номер дня. */
function formatDate(day: number): string {
  const d = dateOf(day);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.day)}.${pad(d.month)}.${d.year}`;
}

function describeTask(task: ScheduledTask): string {
  switch (task.kind) {
    case 'debug':
      return task.label;
    case 'payroll':
      return 'содержание роты';
    case 'medbayDone':
      return `лазарет: пилот ${task.pilotId}`;
    case 'restTick':
      return 'отдых роты: заживление травм';
    case 'repairJob':
      return `${task.work} ${task.recordId} (${task.jobId})`;
    case 'travelLeg':
      return `перелёт: нога ${task.leg + 1}`;
    case 'surveyDone':
      return `разведка: ${task.systemId}`;
    case 'deliveryArrived':
      return `доставка ${task.orderId}: ${task.part.node} ${task.part.quality}`;
    case 'contractExpired':
      return `срок контракта ${task.contractId}`;
    case 'baysUpgraded':
      return `расширение цеха до ${task.to} стапелей`;
    case 'hangarUpgraded':
      return `ячейка ангара: до ${task.to} машин`;
    case 'decayTick':
      return 'затухание репутации';
    case 'economyTick':
      return 'такт экономики фракций';
    case 'frontTick':
      return 'такт фронта';
    case 'developmentTick':
      return 'такт развития планет';
    case 'eventTick':
      return 'такт событий мира';
    case 'rivalTick':
      return 'такт соперников';
  }
}

/**
 * Подчинение (шаг 26) — шесть родов одного события. Разводится здесь, а не
 * шестью событиями в ядре: правда — это состояние войны, а событие лишь
 * рассказывает, как оно таким стало.
 */
function describeDiplomacy(
  event: Extract<CampaignEvent, { kind: 'diplomacyMoved' }>,
): string {
  const where = event.systemId === undefined ? '' : ` (${event.systemId})`;
  switch (event.move) {
    case 'tribute':
      return `дань: ${event.under} платит ${event.over}${where}`;
    case 'tributeLapsed':
      return `дань истекла: ${event.under} больше не платит ${event.over}${where}`;
    case 'protectorate':
      return `протекторат: ${event.under} признал сюзеренитет ${event.over}`;
    case 'protectorateBroken':
      return `протекторат разорван: ${event.under} вышел из-под ${event.over}`;
    case 'pact':
      return `договор (${event.pact ?? '—'}): ${event.over} и ${event.under}`;
    case 'pactLapsed':
      return `договор истёк (${event.pact ?? '—'}): ${event.over} и ${event.under}`;
    case 'war':
      return `война: ${event.over} объявил войну ${event.under}`;
    case 'peaceOffer':
      return `предложение мира: ${event.over} предлагает мир ${event.under}`;
    case 'coalition':
      return `коалиция против ${event.against ?? '—'}: перемирие ${event.over} и ${event.under}`;
  }
}

function describe(event: CampaignEvent): string {
  switch (event.kind) {
    case 'dayAdvanced':
      return `время: ${formatDate(event.from)} → ${formatDate(event.to)} (${event.to - event.from} сут.)`;
    case 'taskScheduled':
      return `назначено на ${formatDate(event.day)} [#${event.seq}]: ${describeTask(event.task)}`;
    case 'taskDue':
      return `${formatDate(event.day)} [#${event.seq}]: ${describeTask(event.task)}`;
    case 'companyRenamed':
      return `рота: «${event.from}» → «${event.to}»`;
    case 'jobScheduled':
      return `работа ${event.jobId} на ${event.recordId}: ${event.cost} C-Bills, ${event.days} сут.`;
    case 'jobCompleted':
      return `работа ${event.jobId} (${event.work}) завершена${event.success ? '' : ' — неудача'}`;
    case 'jobCancelled':
      return `работа ${event.jobId} отменена, возврат ${event.refund} C-Bills`;
    case 'payrollPaid':
      return `содержание: −${event.amount} C-Bills, баланс ${event.cbillsAfter}${event.bankrupt ? ' (РОТА РАЗОРЕНА)' : ''}`;
    case 'pilotRecovered':
      return `пилот ${event.pilotId} вышел из лазарета`;
    case 'salvageCompensated':
      return `наниматель заплатил за долю трофеев (${Math.round(event.share * 100)} %): ${event.amount} C-Bills`;
    case 'pilotRested':
      return `пилот ${event.pilotId}: травма зажила, осталось ${event.injuries}`;
    case 'mechScrapped':
      return `машина ${event.recordId} разобрана: ${event.warehousePartIds.join(', ')}`;
    case 'pilotAssigned':
      return `пилот ${event.pilotId ?? '—'} → машина ${event.recordId}`;
    case 'mechsReordered':
      return 'парк переставлен';
    case 'recruitFound':
      return `объявление о найме: пришёл ${event.name} (${event.affiliation}), поиск стоил ${event.cost}, следующая попытка с ${formatDate(event.nextTryDay)}`;
    case 'recruitRejected':
      return `кандидат отпущен: ${event.name}`;
    case 'pilotHired':
      return `нанят пилот ${event.pilotId} за ${event.cost} C-Bills`;
    case 'pilotDismissed':
      return `пилот ${event.pilotId} уволен`;
    case 'pilotTrained':
      return `пилот ${event.pilotId}: ${event.skillId} → ${event.level}`;
    case 'travelStarted':
      return `курс на ${event.toSystemId}: ${event.jumps} прыж., ${event.days} сут., ${event.cost} C-Bills (прибытие ${formatDate(event.arrivalDay)})`;
    case 'jumpCompleted':
      return `прыжок выполнен: ${event.systemId}, осталось ${event.remaining}`;
    case 'arrived':
      return `рота прибыла: ${event.systemId}`;
    case 'surveyStarted':
      return `разведка ${event.systemId}: ${event.cost} C-Bills, ${event.days} сут.`;
    case 'surveyed':
      return `система разведана: ${event.systemId}`;
    case 'partBought':
      return `куплено ${event.lotId} → склад ${event.partId} за ${event.cost} C-Bills`;
    case 'partSold':
      return `продано со склада ${event.partId} за ${event.price} C-Bills`;
    case 'partOrdered':
      return `заказ ${event.orderId} (${event.partId}) за ${event.cost} C-Bills, прибытие ${formatDate(event.arrivalDay)}`;
    case 'partDelivered':
      return `заказ ${event.orderId} доставлен: ${event.partId}`;
    case 'partStowed':
      return `снятый узел (${event.node}) машины ${event.recordId} лёг на склад: ${event.partId}`;
    case 'mechSold':
      return `машина ${event.recordId} продана за ${event.price} C-Bills`;
    case 'contractTaken':
      return (
        `контракт ${event.contract.id}: ${event.contract.employer} против ${event.contract.target}, ` +
        `${event.contract.mission}, ${event.contract.payout} C-Bills (аванс ${event.advance}), ` +
        `срок до ${formatDate(event.deadlineDay)}`
      );
    case 'contractAbandoned':
      return `контракт ${event.contractId} разорван: −${event.charged} C-Bills`;
    case 'contractFailed':
      return `контракт ${event.contractId} провален по сроку: неустойка ${event.penalty} C-Bills`;
    case 'loanTaken':
      return `заём Гильдии: +${event.principal} C-Bills, вернуть ${event.debt} по ${event.installment} за ведомость`;
    case 'sandboxLoanTaken':
      return `кредит песочницы: +${event.amount} C-Bills, долг ${event.debt}`;
    case 'sandboxLoanRepaid':
      return `кредит песочницы возвращён: −${event.amount} C-Bills, долг ${event.debt}`;
    case 'trophyScrapped':
      return `трофей ${event.recordId} разобран на поле: ${event.parts} позиций на склад`;
    case 'salvageBoughtOut':
      return `наниматель выкупил утиль (${event.machines} машин): +${event.amount} C-Bills`;
    case 'deployed':
      return `вылет по ${event.contractId}: ${event.recordIds.join(', ')} против ${event.enemyUnits} машин`;
    case 'landingPaid':
      return `высадка сверх нормы нанимателя: −${event.amount} C-Bills (перевес для платы ${event.feeRatio.toFixed(2)} к 1), баланс ${event.cbillsAfter}`;
    case 'contractResolved':
      return (
        `контракт ${event.contractId} закрыт (${event.result}): расчёт ${event.settlement} C-Bills, ` +
        `трофеев ${event.salvagePoints} из ${event.salvageAvailable}, потерь ${event.lostRecordIds.length}`
      );
    case 'pilotAdmitted':
      return `пилот ${event.pilotId} в лазарет на ${event.days} сут.`;
    case 'reputationChanged':
      return `репутация: ${event.factionId} ${event.delta > 0 ? '+' : ''}${event.delta} → ${event.after} (${event.reason}/${event.source})`;
    case 'companyReputationChanged':
      return `отряд: известность ${event.fame}, надёжность ${event.reliability} (${event.source})`;
    case 'factionEconomyTicked':
      return (
        `${event.factionId}: избыток ${event.surplus} C-Bills, ` +
        `казна ${event.treasuryAfter}, военный фонд ${event.warFundAfter}`
      );
    case 'pilotLost':
      return `пилот ${event.pilotId} потерян`;
    case 'mechBought':
      return `куплена машина ${event.lotId} → ${event.recordId} за ${event.cost} C-Bills`;
    case 'mechRefitted':
      return (
        `машина ${event.recordId} переоснащена: снято на склад ${event.warehousePartIds.length}, ` +
        `поставлено со склада ${event.consumedPartIds.length}`
      );
    case 'mechRepainted':
      return `машина ${event.recordId} перекрашена: ${event.paint ?? 'цвета происхождения'}`;
    case 'baysUpgraded':
      return `цех расширен: ${event.to} стапелей`;
    case 'hangarUpgraded':
      return `ангар открыт: ${event.to} машин`;
    case 'dropshipUpgraded':
      return `модернизация флота: флагман ${event.dropship}, -${event.cost} C-Bills`;
    case 'frontMoved':
      return event.kindOfMove === 'capture'
        ? `фронт: ${event.attacker} занял ${event.systemId} у ${event.defender} ` +
            `(шанс ${event.odds}, разорение ${event.ruined})`
        : `набег: ${event.attacker} разорил ${event.systemId} (${event.defender}) до ${event.ruined}`;
    case 'warPlan':
      return event.result === 'declared'
        ? `замысел: ${event.factionId} объявил наступление на ${event.against} (${event.systemId})`
        : `замысел: наступление ${event.factionId} на ${event.against} ${
            event.result === 'done' ? 'достигло цели' : 'выдохлось'
          } (${event.systemId})`;
    case 'worldDeveloped':
      return event.built
        ? `стройка: ${event.owner} поднял ${event.systemId} до ступени ${event.to}`
        : `упадок: ${event.systemId} (${event.owner}) сведён войной до ступени ${event.to}`;
    case 'pirateRaid':
      return `набег: пираты сожгли ${event.systemId} (${event.owner}) на ${event.ruined}${event.sacked ? ', вывезена ступень' : ''}`;
    case 'pirateCleared':
      return `зачистка: ${event.systemId} стал чище (${event.cleared})`;
    case 'worldBought':
      return `домен: рота купила ${event.systemId} у ${event.from} за ${event.price} C-Bills`;
    case 'worldConquered':
      return `домен: рота ЗАХВАТИЛА ${event.systemId} у ${event.from}`;
    case 'worldGranted':
      return `домен: ${event.from} пожаловал роте лен ${event.systemId}, дань ему до дня ${event.tributeUntil}`;
    case 'domainTicked':
      return `домен: ${event.worlds} мир(ов), ${event.income - event.upkeep - event.army} C-Bills за декаду (армия ${event.army})`;
    case 'frontClash':
      return `${event.cost === undefined ? 'бой фронта' : 'приказ армии'}: ${event.attacker} на ${event.systemId} (${event.defender}) — ${
        event.outcome === 'captured' ? 'ВЗЯТ' : event.outcome === 'tributed' ? 'дань' : 'отбито'
      }, силы ${event.attackerSize}/${event.defenderSize}, потери ${event.attackerLost}/${event.defenderLost}${
        event.garrison === undefined
          ? ''
          : event.garrison.withdrew
            ? `, гарнизон ${event.garrison.mechs} отошёл`
            : `, гарнизон ${event.garrison.mechs} против ${event.garrison.detachment}: выбито ${event.garrison.knocked}, потеряно ${event.garrison.lostRecordIds.length}`
      }`;
    case 'garrisonUnloaded':
      return `гарнизон: на ${event.systemId} выгружено ${event.recordIds.join(' ')}`;
    case 'garrisonLoaded':
      return `гарнизон: с ${event.systemId} забрано ${event.recordIds.join(' ')}`;
    case 'garrisonPolicySet':
      return `гарнизон: ${event.systemId} — ${event.policy === 'withdraw' ? 'отходить' : 'драться'}`;
    case 'garrisonWithdrawn':
      return `гарнизон: ${event.from} → ${event.to} (${event.reason === 'policy' ? 'отход' : 'мир потерян'}), прибытие ${formatDate(event.arrives)}`;
    case 'garrisonPilotHired':
      return `гарнизон: на ${event.systemId} нанят пилот ${event.pilotId} для ${event.recordId} за ${event.cost} C-Bills`;
    case 'garrisonLost':
      return `гарнизон: потерян с миром ${event.systemId} (${event.recordIds.join(' ')})`;
    case 'garrisonRevoltBattle':
      return `гарнизон: бой восстания на ${event.systemId} ${event.mechs} против ${event.enemy} — ${event.won ? 'подавлено' : 'отбит'}, потеряно ${event.lostRecordIds.length}`;
    case 'garrisonRaidBattle':
      return `гарнизон: бой с вольницей на ${event.systemId} ${event.mechs} против ${event.enemy} — ${event.won ? 'отбита' : 'отбит гарнизон'}, потеряно ${event.lostRecordIds.length}`;
    case 'realmTitleChanged':
      return `титул державы: ${event.from ?? '—'} → ${event.to ?? '—'}`;
    case 'homeRaidPosted':
      return `пираты у дома: оборона на ${event.systemId} до ${formatDate(event.until)}`;
    case 'homeRaidRepelled':
      return `пираты у дома: вольница на ${event.systemId} отбита (${event.by})`;
    case 'buildingStarted':
      return `стройка: ${event.building} на ${event.systemId}, ${event.cost} C-Bills, ${event.decades} дек.`;
    case 'buildingCancelled':
      return `стройка отменена: ${event.building} на ${event.systemId}, возврат ${event.refund}`;
    case 'buildingDone':
      return `постройка готова: ${event.building} на ${event.systemId}`;
    case 'buildingsLost':
      return `постройки на ${event.systemId}: снесено ${event.lost.join(' ') || '—'}, спят ${event.kept.join(' ') || '—'}${event.construction === undefined ? '' : `, недострой ${event.construction}`}`;
    case 'governorAppointed':
      return `губернатор сектора ${event.centerId}: ${event.pilotId}, приоритет ${event.priority}${event.replaced === undefined ? '' : ` (сменил ${event.replaced})`}`;
    case 'sectorPrioritySet':
      return `сектор ${event.centerId}: приоритет ${event.priority}`;
    case 'sectorDissolved':
      return `сектор ${event.centerId} распущен (${event.reason})${event.pilotId === null ? '' : `, ${event.pilotId} свободен`}`;
    case 'governorLeft':
      return `сектор ${event.centerId}: губернатор ${event.pilotId} уволен, пост пуст`;
    case 'worldPinned':
      return `${event.systemId}: ${event.pinned ? 'закреплён за игроком' : 'закрепление снято'}`;
    case 'realmReserveSet':
      return `резерв кассы державы: ${event.amount} C-Bills`;
    case 'stanceTargetSet':
      return `цель стойки против ${event.factionId}: ${event.systemId ?? 'по выбору ядра'}${event.ended === true ? ' (снята тактом)' : ''}`;
    case 'worldSectorAssigned':
      return `${event.systemId}: ${event.center === null ? 'сектор по геометрии' : `в секторе ${event.center}`}`;
    case 'frontStanceSet':
      return `стойка против ${event.factionId}: ${event.stance}${event.ended === true ? ' (война кончилась)' : ''}`;
    case 'realmPolicy': {
      const by = event.by.kind === 'governor' ? `губернатор ${event.by.pilotId} (${event.by.centerId})` : `стойка ${event.by.stance} против ${event.by.factionId}`;
      const a = event.act;
      const what =
        a.kind === 'build' ? `стройка ${a.building} на ${a.systemId}`
        : a.kind === 'develop' ? `развитие ${a.systemId}`
        : a.kind === 'focus' ? `фокус ${a.focus} на ${a.systemId}`
        : a.kind === 'offensive' ? `приказ на ${a.systemId}`
        : 'мир';
      return `держава: ${by} — ${what}`;
    }
    case 'realmFrontTally':
      return `держава: боёв за такт ${event.battles}, армия ${event.armyBefore} → ${event.armyAfter}`;
    case 'warFunded':
      return `держава: в военный фонд из кассы ${event.amount} C-Bills`;
    case 'warBudgetSet':
      return `держава: военный бюджет ${Math.round(event.share * 100)} % итога`;
    case 'regimentRaised':
      return event.mechs > 0
        ? `полки: поставлено в строй ${event.mechs} машин за ${event.price} C-Bills (армия ${event.armyAfter})`
        : `полки: распущено ${-event.mechs} машин, возвращено ${-event.price} C-Bills (армия ${event.armyAfter})`;
    case 'worldFocus':
      return event.started
        ? `фокус: ${event.owner} начал переделку ${event.systemId} из «${event.from}» в «${event.to}»`
        : `фокус: ${event.systemId} (${event.owner}) стал «${event.to}»`;
    case 'warEffort':
      return `война: ${event.employer} +${Math.round(event.amount)} C-Bills против ${event.target}`;
    case 'diplomacyMoved':
      return describeDiplomacy(event);
    case 'worldEvent':
      return `событие мира: ${event.id}${event.realm ? ' (держава)' : ''}${event.invite ? ' — приглашение в коалицию' : ''}`;
    case 'worldEventAnswered':
      return `событие ${event.id}: карточка закрыта${event.accept === undefined ? '' : event.accept ? ', приглашение принято' : ', отказ'}`;
    case 'tributeBought':
      return `дипломатия: рота выкупила дань с ${event.systemId} у ${event.from} за ${event.price} C-Bills`;
    case 'peaceMade':
      return (
        `держава: мир с ${event.factionId}${event.forced === undefined ? '' : ` на пределе усталости (${event.forced})`}` +
        `${event.ceded === undefined ? '' : `, уступлен ${event.ceded}`}${event.cost > 0 ? `, отступные ${event.cost} C-Bills` : ''}` +
        `${event.gained === undefined ? '' : `, цель: ${event.gained.join(' ')}`}` +
        `${event.tributaries === undefined ? '' : `, дань: ${event.tributaries.join(' ')}`}` +
        `${event.humiliated === undefined ? '' : ', унижение'}` +
        `${event.returned === undefined ? '' : `, возвращено: ${event.returned.join(' ')}`}`
      );
    case 'warEnded':
      return `держава: война с ${event.factionId} окончена (${event.how})`;
    case 'worldAbandoned':
      return `держава: рота отказалась от мира ${event.systemId} (вернулся ${event.to})`;
    case 'worldRevolt':
      return `держава: восстание на ${event.systemId} (прежний владелец ${event.formerOwner})`;
    case 'worldRevoltSuppressed':
      return `держава: восстание на ${event.systemId} подавлено`;
    case 'worldSeceded':
      return `держава: ${event.systemId} отпал к ${event.to}`;
    case 'capitalMoved':
      return `держава: столица перенесена ${event.from} → ${event.systemId} за ${event.price} C-Bills`;
    case 'realmChanged':
      return event.realm ? 'держава: основана' : 'держава: пала';
    case 'achievementUnlocked':
      return `достижение: ${event.id}`;
    case 'rivalContract':
      return (
        `соперник ${event.rivalName}: ${event.mission} в ${event.systemId} ` +
        `(${event.employer} против ${event.target}) — ${event.result}, ${event.payout} C-Bills`
      );
    case 'rivalMoved':
      return `соперник ${event.rivalName}: ${event.from} → ${event.to}`;
    case 'regimentCommission':
      return (
        `полк ${event.regimentName}: подряд в ${event.systemId} (${event.employer} против ${event.target}) — ` +
        `${event.won ? 'взял' : 'отбит'}, вывел ${event.size}, потерял ${event.lost}`
      );
    case 'regimentMoved':
      return `полк ${event.regimentName}: ${event.from} → ${event.to} (наниматель ${event.employer})`;
    case 'greatRegimentHired':
      return `держава наняла полк ${event.regimentName} против ${event.against}: встал на ${event.systemId}, ${event.price} C-Bills, до ${formatDate(event.until)}`;
    case 'demandIssued':
      return `требование: ${event.from} требует дань с ${event.systemId}`;
    case 'demandAnswered':
      return `ответ на требование ${event.from} (${event.systemId}): ${event.outcome}${event.punishment === undefined ? '' : ` — ${JSON.stringify(event.punishment)}`}`;
    case 'greatRegimentHireEnded':
      return `найм полка ${event.regimentName} против ${event.against} кончился (${event.how})`;
    case 'rivalGone':
      return `соперник ${event.rivalName} разорился, на его место пришли «${event.replacedByName}» (${event.systemId})`;
  }
}

/**
 * Целость отряда: сколько брони и структуры осталось от паспортной. Приёмка шага 12 требовала
 * увидеть глазами, что повреждения ПЕРЕЖИВАЮТ бой; шагу 16 это же число показывает, что цех
 * успевает их чинить между контрактами.
 */
function integrity(mechs: readonly MechRecord[]): number {
  let have = 0;
  let full = 0;
  for (const record of mechs) {
    const limits = maxZones(recordChassisDef(record));
    record.condition.zones.forEach((z, i) => {
      const lim = limits[i];
      if (lim === undefined) return;
      have += z.armor + z.structure;
      full += lim.armor + lim.structure;
    });
  }
  return full === 0 ? 0 : Math.round((have / full) * 100);
}

/** Точность боя из ключа `--fidelity` (шаг 18). */
function resolverOf(args: Args): BattleResolver {
  return args.fidelity === 'fast' ? FAST_FIDELITY : FULL_FIDELITY;
}

/**
 * ПРИЁМКА ШАГА 16: полный цикл «контракт → перелёт → бой → разбор → ремонт →
 * следующий контракт» проходится КОМАНДАМИ, без единого экрана.
 *
 * До шага 16 этот режим гонял бои подряд руками: свой ростер лежал локальной
 * переменной, противник собирался прямо здесь, а оплаты не было вовсе. Теперь
 * ровно то же самое проходит через `execute`: работа берётся с биржи, звено
 * выводится `Deploy`, бой строится из `contractBrief`, а его итог возвращается
 * в роту единственным швом — `ResolveContract`. Ни одной строчки вида
 * `state.company = {...}` в этом файле больше нет, и это и есть приёмка.
 */
function runContracts(args: Args): void {
  const state = new CampaignState(args.seed, {
    companyName: args.name,
    company: foundingInit(args.seed),
  });

  const policy = {
    repairThreshold: args.repairThreshold,
    fleetCap: args.fleetCap,
    supplyThreshold: args.supplyThreshold,
    supplyJumps: args.supplyJumps,
    contractOdds: args.odds,
    ...(args.sortieOdds === null ? {} : { sortieOdds: args.sortieOdds }),
    loyaltyThreshold: args.loyaltyThreshold,
  };

  const run = (command: CampaignCommand): boolean => {
    const result = command.kind === 'advance' ? advanceAnswering(state, state.day + command.days) : execute(state, command);
    if (!args.quiet) {
      if (result.ok) for (const e of result.events) console.log('  ' + describe(e));
      else console.log(`  команда ${command.kind} отклонена: ${result.reason}`);
    }
    return result.ok;
  };

  let taken = 0;
  let idle = 0;
  let won = 0;
  let withdrawn = 0;
  let lost = 0;

  for (let i = 0; i < args.contracts; i++) {
    crewUp(state);
    supplyStep(state, policy);
    repairStep(state, policy);
    run({ kind: 'advance', days: 14 });

    const offer = pickContract(state, policy);
    if (offer === null) {
      console.log(`контракт ${i + 1}: работы по силам нет, рота стоит`);
      // Три простоя подряд без работы — это не невезение, а конец кампании:
      // годных машин не осталось, а на покупку новой (шаг 19a) не хватает денег.
      if (++idle >= 3) {
        console.log('рота больше не может выйти на контракт, останавливаюсь');
        break;
      }
      continue;
    }
    idle = 0;
    if (!run({ kind: 'takeContract', contractId: offer.id })) continue;
    taken++;

    const lance = chooseSortie(state, policy, offer);
    if (lance.length === 0 || !run({ kind: 'deploy', recordIds: lance.map((m) => m.id) })) {
      run({ kind: 'abandonContract' });
      continue;
    }

    const brief = contractBrief(state);
    const outcome = resolverOf(args)(brief);
    run({ kind: 'resolveContract', outcome });

    if (outcome.winner === 'player') won++;
    else if (outcome.winner === 'opfor') lost++;
    else withdrawn++;

    console.log(
      `контракт ${i + 1} (${offer.mission}, ${offer.employer} против ${offer.target}): ` +
        `победитель ${outcome.winner}, оплата ${offer.payout}, ` +
        `парк ${state.company.mechs.length}, целость ${integrity(state.company.mechs)} %, ` +
        `касса ${state.company.cbills}`,
    );
    if (state.company.bankrupt) {
      console.log(`рота разорена на ${formatDate(state.day)}`);
      break;
    }
  }

  console.log('');
  console.log(`контрактов взято:  ${taken} из ${args.contracts}`);
  console.log(`выполнено:         ${won}`);
  console.log(`отход с поля:      ${withdrawn}`);
  console.log(`провалено:         ${lost}`);
  console.log(`парк:              ${state.company.mechs.length} машин, целость ${integrity(state.company.mechs)} %`);
  console.log(`пилотов:           ${state.company.pilots.length}`);
  console.log(`касса:             ${state.company.cbills} C-Bills${state.company.bankrupt ? ' (РОТА РАЗОРЕНА)' : ''}`);
  console.log(`дата:              ${formatDate(state.day)} (день ${state.day})`);
  console.log(`хэш:               ${hashCampaignState(state)}`);
}


/** Максимум ПОЛНЫХ боёв за прогон — правило CLAUDE.md, действует с шага 4 и на кампанию тоже. */
const MAX_BATTLES = 1400;

/**
 * Потолок быстрого расчёта — теперь в МИНУТАХ, а не в боях (шаг 22c).
 *
 * Правило CLAUDE.md про 1400 боёв — это правило про ВРЕМЯ («1400 боёв — около
 * трёх минут»), и до 22c оно было переведено в число быстрых боёв (20 000).
 * Перевод сломался, как только мир населили по-настоящему: сотни отрядов дают
 * сотни тысяч быстрых боёв за прогон, и потолок в боях начал запрещать не
 * долгие прогоны, а САМ ЗАМЕР — при сорока отрядах не проходили уже
 * двадцать пять сидов.
 *
 * Поэтому здесь стоит то, чем правило и было с самого начала: сколько минут
 * прогон имеет право занять. Быстрый бой стоит около 2.6 мс (замерено шагом
 * 22c), из этого и считается оценка. Разовый замер до двадцати минут разрешён
 * решением пользователя 2026-09-04; всё, что дольше, — это уже не проверка
 * гипотезы, а ожидание.
 */
const MAX_FAST_MINUTES = 20;

/** Во что обходится один быстрый бой. Замерено, а не взято на глаз. */
const FAST_BATTLE_MS = 2.6;

/**
 * Сколько боёв соперники отыгрывают на один контракт роты (шаг 22).
 *
 * Замерено на прогоне 30 сидов × 20 контрактов (5186 боёв соперников на 600
 * боёв роты), а не выведено: рота берёт контракт примерно раз в четырнадцать
 * суток, то есть раз в полторы декады, и на каждой декаде ходят все восемь
 * соперников. Число нужно ДО прогона — потолок боёв обязан считаться до того,
 * как прогон начался, а не после.
 *
 * Столбец `rival_battles` в CSV показывает, сколько их вышло на самом деле:
 * разойдись оценка с фактом вдвое — правится здесь.
 */
const RIVAL_BATTLES_PER_CONTRACT = 1.1;

function runBatch(args: Args): void {
  const seeds = parseSeedRange(args.seeds);
  const player = seeds.length * args.contracts;
  // Бои соперников считаются ОТДЕЛЬНО, и это не поблажка. Оба потолка — про
  // ВРЕМЯ («1400 боёв — около трёх минут», CLAUDE.md), а бой соперника ВСЕГДА
  // быстрый: `rivalTick` зовёт `fastResolve` независимо от того, с какой
  // точностью гоняется рота (`core/campaign/rivals/tick.ts`). Сложить их с
  // полными боями значило бы посчитать секунду за минуту и закрыть полную
  // точность для замера вовсе.
  const rivals = Math.round(player * RIVALS.companies * RIVAL_BATTLES_PER_CONTRACT);
  const fast = args.fidelity === 'fast';

  // Полные бои роты остаются под правилом CLAUDE.md как есть: они стоят около
  // ста миллисекунд, и три минуты — это и есть 1400 штук.
  if (!fast && player > MAX_BATTLES) {
    throw new Error(
      `${seeds.length} сидов × ${args.contracts} контрактов = ${player} полных боёв роты — ` +
        `больше лимита ${MAX_BATTLES} (CLAUDE.md). Сократи --seeds или --contracts, ` +
        `либо возьми --fidelity fast.`,
    );
  }

  const fastBattles = (fast ? player : 0) + rivals;
  const minutes = (fastBattles * FAST_BATTLE_MS) / 60_000;
  if (minutes > MAX_FAST_MINUTES) {
    throw new Error(
      `прогон оценивается в ${minutes.toFixed(0)} мин (${fastBattles} быстрых боёв: ` +
        `${rivals} у соперников${fast ? `, ${player} у роты` : ''}) — больше бюджета ` +
        `${MAX_FAST_MINUTES} мин. Сократи --seeds или --contracts, либо убавь rivals.companies.`,
    );
  }

  const policy = {
    repairThreshold: args.repairThreshold,
    fleetCap: args.fleetCap,
    supplyThreshold: args.supplyThreshold,
    supplyJumps: args.supplyJumps,
    contractOdds: args.odds,
    ...(args.sortieOdds === null ? {} : { sortieOdds: args.sortieOdds }),
    loyaltyThreshold: args.loyaltyThreshold,
  };
  const resolve = resolverOf(args);
  const rows = seeds.map((seed) =>
    runCampaign(seed, args.contracts, policy, {
      resolve,
      ...(args.start === '' ? {} : { startSystemId: args.start }),
    }),
  );
  console.log(toCsv(rows));
  const fought = rows.reduce((n, r) => n + r.rival_battles, 0);
  console.error(
    `кампаний: ${rows.length}, боёв роты не более: ${player}, ` +
      `боёв соперников: ${fought} (точность: ${args.fidelity}, оценка была ${rivals})`,
  );
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const started = Date.now();

  if (args.seeds !== '') {
    runBatch(args);
    console.error(`время: ${Date.now() - started} мс`);
    return;
  }

  if (args.contracts > 0) {
    runContracts(args);
    console.log(`время:       ${Date.now() - started} мс`);
    return;
  }

  const state = new CampaignState(args.seed);
  const journal: CampaignCommand[] = [];

  const run = (command: CampaignCommand): void => {
    const result = command.kind === 'advance' ? advanceAnswering(state, state.day + command.days) : execute(state, command);
    if (!result.ok) throw new Error(`Команда ${command.kind} отклонена: ${result.reason}`);
    journal.push(command);
    if (!args.quiet) for (const e of result.events) console.log('  ' + describe(e));
  };

  run({ kind: 'setCompanyName', name: args.name });

  // Задачи раскладываются по всему отрезку, а не кучей: смысл прогона — увидеть,
  // что очередь исполняется по срокам и в правильном порядке при равных днях.
  for (let i = 0; i < args.tasks; i++) {
    const day = Math.floor(((i + 1) * args.days) / (args.tasks + 1));
    run({ kind: 'schedule', day, task: { kind: 'debug', label: `работа ${i + 1}` } });
  }

  run({ kind: 'advance', days: args.days });

  const snap = snapshot(state);
  const bytes = new TextEncoder().encode(JSON.stringify(makeSaveFile(snap))).length;
  const reloaded = restore(parseSaveFile(JSON.parse(JSON.stringify(makeSaveFile(snap)))));

  console.log('');
  console.log(`рота:        ${state.companyName}`);
  console.log(`сид:         ${state.seed}`);
  console.log(`дата:        ${formatDate(state.day)} (день ${state.day})`);
  console.log(`команд:      ${journal.length}`);
  console.log(`в очереди:   ${state.queue.length}`);
  console.log(`хэш:         ${hashCampaignState(state)}`);
  console.log(`сохранение:  ${bytes} байт`);
  console.log(`круг с/з:    ${hashCampaignState(reloaded) === hashCampaignState(state) ? 'совпал' : 'РАЗОШЁЛСЯ'}`);
  console.log(`время:       ${Date.now() - started} мс`);
}

main();

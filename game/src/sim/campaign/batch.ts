import {
  CampaignState,
  FACTIONS,
  GALAXY,
  REPUTATION,
  REFERENCE_MECH_VALUE,
  blockedOffers,
  companyRating,
  judgedContracts,
  playerRank,
  gatedEmployer,
  standingList,
  contractBrief,
  execute,
  fastResolve,
  foundingInit,
  makeBattleFromBrief,
  marketProfile,
  recordChassisDef,
  type BattleBrief,
  type BattleOutcome,
  type CampaignEvent,
  type Contract,
  type MechRecord,
} from '../../core/campaign/index.js';
import { qualityRank, type QualityClass } from '../../core/model/index.js';
import { Rng } from '../../core/rng/index.js';
import { runOn } from '../autoBattle.js';
import { advanceAnswering } from './worldEvents.js';
import {
  bayStep,
  chooseSortie,
  crewUp,
  pickContract,
  repairStep,
  supplyStep,
  workStep,
  type ManagerPolicy,
} from './manager.js';

/**
 * Батч-прогон кампании в CSV (шаг 13, замер §6 из `часть2-pipeline.md`).
 *
 * **Шаг 16 убрал отсюда два костыля, и это главное, что в нём произошло.**
 *
 * 1. **Плоской заглушки оплаты больше нет.** `CONTRACT_PAYOUT_BASE` = 70 000
 *    C-Bills был временным числом замера с шага 13, и шаг 15 показал, во что
 *    он выродился: исправная средняя машина оценивается больше чем в миллион,
 *    и одна проданная трофейная машина стоила семи контрактов. Оплата теперь
 *    приходит из условий контракта, а те выставлены относительно `mechValue`
 *    (`core/campaign/contracts/`, `data/contracts.json`).
 * 2. **Свод боевого результата больше не идёт в обход команд.** Строчка
 *    `state.company = {...}` после боя была признанным долгом: формального шва
 *    не существовало до `ResolveContract`, и называть его командой раньше
 *    времени значило бы выдумать API. Шов появился — вместе с ним сюда
 *    переехали постановка раненых в лазарет очередью суток (раньше батч
 *    считал, что лечение уложилось в простой) и отчисление потерянных пилотов.
 *
 * Что осталось прежним: противник по-прежнему детерминирован от сида — но
 * теперь не «двумя случайными машинами не тяжелее нашей самой тяжёлой», а
 * типом отряда нанимателя-противника, его доктриной и силой гарнизона системы
 * (`contracts/opfor.ts`).
 *
 * Разброс стартовых систем по сиду (`spreadStartSystem`) держится с шага 15:
 * кампания начинается на Аутриче, а Аутрич — столица, где продаётся всё и где
 * биржа самая богатая. Батч, запертый в ней, отвечал бы на географические
 * вопросы замера неизменным нулём — `--start <id>` пришпиливает старт обратно,
 * когда это нужно.
 */

/** Простой между контрактами: за него идут работы стапеля, лечение и содержание. */
const DOWNTIME_DAYS = 14;

/**
 * Сколько простоев подряд рота готова просидеть без работы, прежде чем прогон
 * признаётся законченным. Без потолка кампания, у которой не осталось ни одной
 * годной машины, крутила бы календарь до последнего контракта вхолостую.
 */
const MAX_IDLE_DOWNTIMES = 3;

/**
 * Чем разыгрывается бой внутри прогона — точность из решения 7 §2 пайплайна.
 *
 * Появилось шагом 18. До него точность была одна и звалась прямо в теле цикла;
 * теперь их две, и выбор — параметр прогона, а не правка кода. Разница только
 * в этой функции: всё остальное в кампании (оплата, трофеи, износ, опыт,
 * лазарет) идёт одним и тем же швом `ResolveContract`.
 */
export type BattleResolver = (brief: BattleBrief) => BattleOutcome;

/** Настоящий бой Части 1 с ботом с обеих сторон. Около сотни миллисекунд на бой. */
export const FULL_FIDELITY: BattleResolver = (brief) =>
  runOn(makeBattleFromBrief(brief), { seed: brief.battleSeed }).outcome;

/** Статистический расчёт без розыгрыша ходов (`core/campaign/bridge/fastResolve.ts`). */
export const FAST_FIDELITY: BattleResolver = fastResolve;

export interface RunOptions {
  /** Пришпилить старт к одной системе. Не задано — разброс по карте от сида. */
  readonly startSystemId?: string;
  /** Точность боя. Умолчание — полная: замеры шагов 13–16 сняты ею. */
  readonly resolve?: BattleResolver;
  /**
   * Позвать на каждом бою до его розыгрыша. Нужно калибровке шага 18: она
   * собирает НАСТОЯЩИЕ брифинги кампании (побитые машины, раненые пилоты,
   * подросшие навыки), чтобы потом прогнать одну и ту же выборку обеими
   * точностями. Собрать их иначе нельзя — брифинг кампании существует только
   * внутри её хода.
   *
   * Второй аргумент — сам контракт (шаг 68): оценке сил нужна работа, а не
   * только разыгранный состав, — противник до вылета известен лишь по ней.
   */
  readonly onBrief?: (brief: BattleBrief, contract: Contract) => void;
}

export interface CampaignRow {
  readonly seed: number;
  /** Где рота начала: батч разбрасывает старты по карте, чтобы география вообще участвовала. */
  readonly start_system: string;
  readonly start_market: string;
  readonly days_survived: number;
  readonly bankrupt: boolean;
  readonly bankrupt_day: number | null;
  readonly contracts_taken: number;
  readonly contracts_done: number;
  readonly contracts_failed: number;
  /** Взято и разорвано, не выходя в бой: звено не собралось. */
  readonly contracts_abandoned: number;
  /** Ушли с поля своим ходом: ничья по потолку ходов или объявленный отход. */
  readonly contracts_withdrawn: number;
  readonly mechs_owned_end: number;
  readonly tonnage_end: number;
  readonly best_class_end: QualityClass | 'none';
  readonly mechs_lost: number;
  readonly mechs_salvaged: number;
  readonly pilots_lost: number;
  readonly pilot_days_in_medbay: number;
  readonly cbills_min: number;
  readonly cbills_end: number;
  readonly repair_share: number;
  readonly upkeep_share: number;
  /** Плата за высадку сверх нормы нанимателя (шаг 67) — доля дохода, как `upkeep_share`. */
  readonly landing_share: number;
  /** Сколько машин рота в среднем выводит на вылет (шаг 67): ради этого числа плата и заведена. */
  readonly mechs_deployed_avg: number;
  readonly avg_wear_end: number;
  readonly jumps: number;
  readonly days_in_transit: number;
  /**
   * Доля дохода, ушедшая на снабжение: класс узлов, дорога за ним, а с шага 19a
   * ещё переоснащение, ступени цеха и покупка машин целиком.
   */
  readonly supply_share: number;
  /**
   * Из неё — доля, ушедшая в мехлаб (шаг 19a). Отдельным столбцом, потому что
   * шаг 19a добавил в снабжение сразу три статьи, и без разбивки не видно, какая
   * из них двигает `supply_share`.
   */
  readonly refit_share: number;
  /** Доля дохода, полученная продажей трофеев (машин и складских записей), а не контрактами. */
  readonly trophy_income_share: number;
  /** Деньги от нанимателей: авансы плюс доплаты, за вычетом неустоек. */
  readonly contract_income: number;
  readonly income_total: number;
  /** Средняя оплата взятого контракта — то самое число, которое шаг 16 и выставляет. */
  readonly payout_avg: number;
  /** Во сколько эталонных машин обходится средний контракт (`contracts/reference.ts`). */
  readonly payout_in_mechs: number;
  /** Трофеев было доступно на поле / забрано по доле из условий. */
  readonly salvage_offered: number;
  readonly salvage_kept: number;
  readonly mechs_sold: number;
  readonly parts_sold: number;
  readonly upgrades: number;
  /** Работ переоснащения, поставленных за кампанию (шаг 19a). */
  readonly refits: number;
  /** Машин, купленных целиком (шаг 19a). Второй сток денег. */
  readonly mechs_bought: number;
  /** Оплаченных ступеней лестницы цеха (шаг 19a). */
  readonly bay_upgrades: number;
  /** Сколько стапелей у роты к концу: 4 — лестницу цеха не трогали (шаг 19a). */
  readonly bays_end: number;

  // --- репутация (шаг 20) -----------------------------------------------------
  /**
   * Лучшее и худшее отношение к концу кампании. Главный вопрос замера шага 20:
   * развела ли кампания фракции по знаку — или всё сползло к нулю, и тогда
   * затухание слишком сильное.
   */
  readonly standing_best: number;
  readonly standing_worst: number;
  /** Скольких нанимателей рота закрыла для себя: отношение ниже порога гарнизона. */
  readonly factions_locked: number;
  /**
   * Какая доля биржи была недоступна по порогу — ПРЯМОЙ индикатор тупика.
   * Считается на каждом простое по системе, где рота стоит, и усредняется.
   */
  readonly offers_blocked_share: number;
  /** Растут ли вторая и третья оси вообще. */
  readonly fame_end: number;
  readonly reliability_end: number;
  /** Работает ли надёжность на условиях: средняя доля аванса от гонорара. */
  readonly advance_share_avg: number;
  /** Сколько простоев рота простояла без единого доступного предложения. */
  readonly idle_downtimes: number;

  // --- война (шаг 21b) --------------------------------------------------------
  /**
   * Сколько миров сменило владельца за кампанию. Двигается ли карта ВООБЩЕ —
   * первый вопрос замера шага.
   */
  readonly worlds_captured: number;
  /** Клановых набегов на Сферу: перемирие Тукайида держится, но молодые воины ходят. */
  readonly clan_raids: number;
  /**
   * Доля ВЗЯТЫХ контрактов, порождённых фронтом, — то есть таких, у которых
   * напряжённость участка не нулевая. Заработала ли связка «война → работа».
   */
  readonly front_contracts_share: number;
  /** Средняя напряжённость участка по взятой работе. */
  readonly tension_avg: number;
  /**
   * Доля ШТУРМОВ среди ВСЕХ предложений, которые породил мир, — главное число,
   * ради которого шаг и делается: до него их было 0.1 % по всей карте.
   *
   * Считается ДО порога репутации: тикер войны отвечает за то, рождается ли
   * тяжёлая работа, а порог шага 20 — за то, дадут ли её этой роте. Смешивать
   * их значило бы не понять, что именно сдвинулось.
   */
  readonly assault_share: number;
  /** Доля штурмов среди предложений, ОТКРЫТЫХ роте по репутации. */
  readonly assault_open_share: number;
  /** Доля обороны там же: второй тяжёлый тип, который открывает репутация. */
  readonly defense_share: number;
  /**
   * Доля ВЗЯТОЙ работы против Домов и КомСтара. До шага 21b — 5 % (95 % работы
   * бот брал против пиратов, а у пиратов нет политики, и выбор стороны поэтому
   * не стоил ничего).
   */
  readonly vs_house_share: number;
  /** Доля взятой работы против пиратов — зеркало предыдущего столбца. */
  readonly vs_pirates_share: number;
  /** Записей в разрежённой карте дельт к концу: растёт ли снимок вместе с войной. */
  readonly deltas_end: number;
  // --- соперники (шаг 22) ------------------------------------------------------
  /**
   * Сколько отрядов-соперников разорилось за кампанию.
   *
   * Обновляется ли список или все восемь доживают до конца — это прямой ответ
   * на вопрос «мир не подыгрывает»: соперник, который не может разориться, —
   * декорация с числом.
   */
  readonly rivals_bankrupt: number;
  /** Сколько боёв отыграли соперники. Он же — настоящий счёт боёв прогона. */
  readonly rival_battles: number;
  /**
   * Сколько работы соперники взяли В СИСТЕМЕ, ГДЕ СТОЯЛА РОТА.
   *
   * Не «сколько всего взяли»: работа, ушедшая за три прыжка, — новость, а
   * работа, ушедшая из-под носа, — конкуренция. Ради второго числа шаг и делался.
   */
  readonly offers_taken_by_rivals: number;
  /**
   * Место роты в таблице MRBC (1 — первое): на последнем простое и лучшее за
   * кампанию.
   *
   * Снимается на ПРОСТОЕ, а не по завершении последнего боя: кампания
   * заканчивается сразу после расчёта, когда раненые пилоты ещё в лазарете, а
   * машина без саженного пилота в рейтинг не входит.
   */
  readonly rank_end: number;
  readonly rank_best: number;
  /** Рейтинг роты и рейтинг лучшего соперника на конец: догоняет ли рота верхушку. */
  readonly rating_end: number;
  readonly rival_rating_top: number;
}

function bestClass(mechs: readonly MechRecord[]): QualityClass | 'none' {
  let best: QualityClass | 'none' = 'none';
  let bestRank = -1;
  for (const m of mechs) {
    const q = m.assembly.quality;
    for (const cls of [q?.reactor ?? 'standard', q?.frame ?? 'standard']) {
      const r = qualityRank(cls);
      if (r > bestRank) {
        bestRank = r;
        best = cls;
      }
    }
  }
  return best;
}

/** Стартовая система батча: разброс по всей карте от сида. См. докстринг модуля. */
export function spreadStartSystem(seed: number): string {
  return GALAXY.id(new Rng(seed ^ 0x5f5f5f5f).int(0, GALAXY.count - 1));
}

/** Событие расчёта по контракту — единственное место, где считаются деньги нанимателя. */
function settlementOf(events: readonly CampaignEvent[]): number {
  let sum = 0;
  for (const e of events) {
    if (e.kind === 'contractResolved') sum += e.settlement;
    if (e.kind === 'contractFailed') sum -= e.penalty;
    if (e.kind === 'contractAbandoned') sum -= e.charged;
  }
  return sum;
}

export function runCampaign(
  seed: number,
  contracts: number,
  policy: ManagerPolicy,
  opts: RunOptions = {},
): CampaignRow {
  const startSystemId = opts.startSystemId ?? spreadStartSystem(seed);
  const resolve = opts.resolve ?? FULL_FIDELITY;
  // Стартовая рота собирается ЯДРОМ и приходит в конструктор (`company/founding.ts`).
  // Прежде замер строил её у себя и присваивал в состояние после создания —
  // копия правил, которую CLI держал второй, а экран создания отряда завёл бы
  // третьей.
  const state = new CampaignState(seed, { systemId: startSystemId, company: foundingInit(seed) });

  let contractsTaken = 0;
  let contractsDone = 0;
  let contractsFailed = 0;
  let contractsAbandoned = 0;
  let contractsWithdrawn = 0;
  let mechsLost = 0;
  let mechsSalvaged = 0;
  let salvageOffered = 0;
  let pilotsLost = 0;
  let pilotDaysInMedbay = 0;
  let repairSpend = 0;
  let upkeepSpend = 0;
  let landingSpend = 0;
  let sorties = 0;
  let mechsDeployed = 0;
  let supplySpend = 0;
  let trophyIncome = 0;
  let contractIncome = 0;
  let payoutSum = 0;
  let mechsSold = 0;
  let partsSold = 0;
  let upgrades = 0;
  let refits = 0;
  let refitSpend = 0;
  let mechsBought = 0;
  let bayUpgrades = 0;
  let jumps = 0;
  let transitDays = 0;
  let cbillsMin = state.company.cbills;
  let idleDowntimes = 0;
  let idleTotal = 0;
  let advanceShareSum = 0;
  let blockedShareSum = 0;
  let blockedSamples = 0;
  // --- война (шаг 21b) --------------------------------------------------------
  let worldsCaptured = 0;
  let clanRaids = 0;
  let frontContracts = 0;
  let tensionSum = 0;
  let vsHouse = 0;
  let vsPirates = 0;
  // Доли тяжёлых типов снимаются с ПРЕДЛОЖЕНИЙ, а не со взятого: «доля штурмов
  // на бирже» — свойство мира, а «доля взятых штурмов» — свойство робости бота,
  // и смешивать их значило бы не понять, что именно сдвинулось.
  let offersSeen = 0;
  // --- соперники (шаг 22) ------------------------------------------------------
  let rivalsBankrupt = 0;
  let rivalBattles = 0;
  let offersTakenByRivals = 0;
  let rankBest = Number.POSITIVE_INFINITY;
  let rankLast = 0;
  let assaultOffers = 0;
  let defenseOffers = 0;
  let openOffers = 0;
  let assaultOpen = 0;

  for (let i = 0; i < contracts; i++) {
    // --- простой: экипаж, снабжение, ремонт, ход времени -----------------------
    crewUp(state);

    // Место в таблице MRBC снимается НА ПРОСТОЕ, а не в самом конце кампании, и
    // это не мелочь: кампания заканчивается сразу после последнего боя, когда
    // раненые пилоты ещё в лазарете, а машина без саженного пилота в рейтинг не
    // входит вовсе (`contracts/threat.ts::companyRating`). Замер «на выходе из
    // боя» показывал бы не силу роты, а то, насколько тяжёлым вышел последний
    // контракт.
    rankLast = playerRank(state);
    rankBest = Math.min(rankBest, rankLast);

    const supply = supplyStep(state, policy);
    supplySpend += supply.spent;
    trophyIncome += supply.income;
    mechsSold += supply.mechsSold;
    partsSold += supply.partsSold;
    upgrades += supply.upgrades;
    refits += supply.refits;
    refitSpend += supply.refitSpend;
    mechsBought += supply.mechsBought;
    jumps += supply.jumps;
    transitDays += supply.transitDays;

    const beforeRepair = state.company.cbills;
    repairStep(state, policy);
    repairSpend += beforeRepair - state.company.cbills;

    // Ступень цеха покупается ПОСЛЕ того, как рота поставила в него всё, что
    // хотела: загруженность стапелей видна только тогда (`manager.ts::bayStep`).
    // Это капитальный расход, а не ремонт, поэтому идёт в снабжение.
    const bay = bayStep(state, policy);
    supplySpend += bay.spent;
    bayUpgrades += bay.upgrades;

    const beforeAdvance = state.company.cbills;
    // Ход времени крутит и мир: такт экономики фракций и такт фронта идут раз в
    // декаду, что бы рота ни делала. События фронта считаются здесь, а не
    // пересчётом карты в конце: пересчёт сказал бы, сколько миров СТОИТ не на
    // своём месте, а не сколько раз фронт сдвинулся.
    const passing = advanceAnswering(state, state.day + DOWNTIME_DAYS);
    if (passing.ok) {
      for (const e of passing.events) {
        if (e.kind === 'frontMoved') {
          if (e.kindOfMove === 'capture') worldsCaptured++;
          else clanRaids++;
          continue;
        }
        // Соперники (шаг 22). Работа, взятая ТАМ, ГДЕ СТОИТ РОТА, считается
        // отдельно от всей взятой: первое — конкуренция, второе — новость.
        if (e.kind === 'rivalContract') {
          rivalBattles++;
          if (e.systemId === state.systemId) offersTakenByRivals++;
          continue;
        }
        if (e.kind === 'rivalGone') rivalsBankrupt++;
      }
    }

    // Содержание — единственное, что списывается ходом времени само; работы
    // стапеля оплачены при постановке, а доплата по контракту приходит позже.
    upkeepSpend += Math.max(0, beforeAdvance - state.company.cbills);
    cbillsMin = Math.min(cbillsMin, state.company.cbills);

    // --- работа ----------------------------------------------------------------
    //
    // Доля закрытой порогом биржи снимается ДО выбора контракта и на каждом
    // простое, а не только там, где работа нашлась: тупик — это как раз те
    // простои, где не нашлась (шаг 20).
    if (state.travel === null) {
      const blocked = blockedOffers(
        state.worldSeed,
        state.deltas,
        state.systemId,
        state.day,
        state.reputation,
        state.war,
      );
      if (blocked.total > 0) {
        blockedShareSum += blocked.count / blocked.total;
        blockedSamples++;
      }
      // Состав биржи на этом простое, и он снимается ДВАЖДЫ, потому что вопросов
      // тоже два. «Сколько тяжёлой работы порождает МИР» — про тикер войны, и
      // считается по всем предложениям; «сколько её доступно ЭТОЙ роте» — про
      // порог репутации шага 20, и считается по разрешённым. До шага 21b их было
      // не различить, и мир, начавший порождать штурмы, читался бы как не
      // начавший, пока рота не набрала известности.
      for (const judged of judgedContracts(
        state.worldSeed,
        state.deltas,
        state.systemId,
        state.day,
        state.reputation,
        state.war,
      )) {
        offersSeen++;
        if (judged.contract.mission === 'assault') assaultOffers++;
        if (judged.contract.mission === 'defense') defenseOffers++;
        if (!judged.allowed) continue;
        openOffers++;
        if (judged.contract.mission === 'assault') assaultOpen++;
      }
    }

    // Лететь ЗА РАБОТОЙ, а не только за узлом на рынок (шаг 21b). Тикер сдвинул
    // биржу туда, где идёт война; бот, не трогающийся с места, этого не увидел
    // бы вовсе — см. `manager.ts::workStep`.
    const move = workStep(state, policy);
    jumps += move.jumps;
    transitDays += move.days;
    supplySpend += move.spent;
    cbillsMin = Math.min(cbillsMin, state.company.cbills);

    const offer = pickContract(state, policy);
    if (offer === null) {
      idleTotal++;
      if (++idleDowntimes >= MAX_IDLE_DOWNTIMES) break;
      continue;
    }
    idleDowntimes = 0;

    const taken = execute(state, { kind: 'takeContract', contractId: offer.id });
    if (!taken.ok) continue;
    contractsTaken++;
    contractIncome += offer.advance;
    payoutSum += offer.payout;
    advanceShareSum += offer.payout === 0 ? 0 : offer.advance / offer.payout;
    if (offer.tension > 0) frontContracts++;
    tensionSum += offer.tension;
    const targetKind = FACTIONS.get(offer.target)?.kind;
    if (targetKind === 'house' || targetKind === 'comstar') vsHouse++;
    if (targetKind === 'pirates') vsPirates++;

    const lance = chooseSortie(state, policy, offer);
    if (lance.length === 0) {
      const abandoned = execute(state, { kind: 'abandonContract' });
      if (abandoned.ok) {
        contractsAbandoned++;
        contractIncome += settlementOf(abandoned.events);
      }
      continue;
    }

    const deployed = execute(state, { kind: 'deploy', recordIds: lance.map((m) => m.id) });
    if (!deployed.ok) {
      const abandoned = execute(state, { kind: 'abandonContract' });
      if (abandoned.ok) {
        contractsAbandoned++;
        contractIncome += settlementOf(abandoned.events);
      }
      continue;
    }

    sorties++;
    mechsDeployed += lance.length;
    for (const e of deployed.events) if (e.kind === 'landingPaid') landingSpend += e.amount;

    const brief = contractBrief(state);
    opts.onBrief?.(brief, offer);
    const outcome = resolve(brief);

    const resolved = execute(state, { kind: 'resolveContract', outcome });
    if (!resolved.ok) throw new Error(`ResolveContract отклонена: ${resolved.reason}`);
    contractIncome += settlementOf(resolved.events);

    for (const e of resolved.events) {
      if (e.kind === 'contractResolved') {
        if (e.result === 'won') contractsDone++;
        else if (e.result === 'withdrawn') contractsWithdrawn++;
        else contractsFailed++;
        mechsLost += e.lostRecordIds.length;
        mechsSalvaged += e.trophyRecordIds.length;
        salvageOffered += e.salvageAvailable;
      }
      if (e.kind === 'pilotLost') pilotsLost++;
      if (e.kind === 'pilotAdmitted') pilotDaysInMedbay += e.days;
    }
    cbillsMin = Math.min(cbillsMin, state.company.cbills);
  }

  const mechs = state.company.mechs;
  // Доли считаются от ВСЕГО дохода, а не только от контрактов: продажа трофеев
  // с шага 15 — второй настоящий источник денег, и делить расходы на выдуманную
  // базу значило бы получить долю больше единицы там, где рота живёт продажами.
  const total = contractIncome + trophyIncome;
  const tonnageEnd = mechs.reduce((n, m) => n + recordChassisDef(m).tons, 0);
  const wearValues = mechs.flatMap((m) => [m.wear.reactor, m.wear.frame]);
  const avgWearEnd = wearValues.length === 0 ? 0 : wearValues.reduce((a, b) => a + b, 0) / wearValues.length;
  const payoutAvg = contractsTaken === 0 ? 0 : Math.round(payoutSum / contractsTaken);
  // Репутация к концу кампании. Порог гарнизона — самый низкий из всех, поэтому
  // «отношение ниже него» и означает нанимателя, закрытого для роты вовсе.
  const rep = state.reputation;
  const standings = standingList(rep).map((r) => r.standing);
  const lockedBelow = REPUTATION.access.missions.garrison.standingMin;
  const share = (x: number, base: number): number => (base <= 0 ? 0 : Math.round((x / base) * 1000) / 1000);

  return {
    seed,
    start_system: startSystemId,
    start_market: marketProfile(state.worldSeed, startSystemId).marketClass,
    days_survived: state.day,
    bankrupt: state.company.bankrupt,
    bankrupt_day: state.company.bankruptDay,
    contracts_taken: contractsTaken,
    contracts_done: contractsDone,
    contracts_failed: contractsFailed,
    contracts_abandoned: contractsAbandoned,
    contracts_withdrawn: contractsWithdrawn,
    mechs_owned_end: mechs.length,
    tonnage_end: tonnageEnd,
    best_class_end: bestClass(mechs),
    mechs_lost: mechsLost,
    mechs_salvaged: mechsSalvaged,
    pilots_lost: pilotsLost,
    pilot_days_in_medbay: Math.round(pilotDaysInMedbay * 10) / 10,
    cbills_min: cbillsMin,
    cbills_end: state.company.cbills,
    repair_share: share(repairSpend, total),
    upkeep_share: share(upkeepSpend, total),
    landing_share: share(landingSpend, total),
    mechs_deployed_avg: sorties === 0 ? 0 : Math.round((mechsDeployed / sorties) * 100) / 100,
    avg_wear_end: Math.round(avgWearEnd * 10) / 10,
    jumps,
    days_in_transit: transitDays,
    supply_share: share(supplySpend, total),
    refit_share: share(refitSpend, total),
    trophy_income_share: share(trophyIncome, total),
    contract_income: contractIncome,
    income_total: total,
    payout_avg: payoutAvg,
    payout_in_mechs: Math.round((payoutAvg / REFERENCE_MECH_VALUE) * 1000) / 1000,
    salvage_offered: salvageOffered,
    salvage_kept: mechsSalvaged,
    mechs_sold: mechsSold,
    parts_sold: partsSold,
    upgrades,
    refits,
    mechs_bought: mechsBought,
    bay_upgrades: bayUpgrades,
    bays_end: state.company.bays,
    standing_best: standings[0] ?? 0,
    standing_worst: standings[standings.length - 1] ?? 0,
    factions_locked: standingList(rep).filter(
      (r) => r.standing < lockedBelow && gatedEmployer(r.id),
    ).length,
    offers_blocked_share: blockedSamples === 0 ? 0 : Math.round((blockedShareSum / blockedSamples) * 1000) / 1000,
    fame_end: rep.fame,
    reliability_end: rep.reliability,
    advance_share_avg:
      contractsTaken === 0 ? 0 : Math.round((advanceShareSum / contractsTaken) * 1000) / 1000,
    idle_downtimes: idleTotal,
    worlds_captured: worldsCaptured,
    clan_raids: clanRaids,
    front_contracts_share: share(frontContracts, contractsTaken),
    tension_avg: contractsTaken === 0 ? 0 : Math.round((tensionSum / contractsTaken) * 1000) / 1000,
    assault_share: share(assaultOffers, offersSeen),
    assault_open_share: share(assaultOpen, openOffers),
    defense_share: share(defenseOffers, offersSeen),
    vs_house_share: share(vsHouse, contractsTaken),
    vs_pirates_share: share(vsPirates, contractsTaken),
    deltas_end: Object.keys(state.deltas).length,
    rivals_bankrupt: rivalsBankrupt,
    rival_battles: rivalBattles,
    offers_taken_by_rivals: offersTakenByRivals,
    rank_end: rankLast === 0 ? playerRank(state) : rankLast,
    rank_best: Number.isFinite(rankBest) ? rankBest : playerRank(state),
    rating_end: companyRating(state.company).total,
    rival_rating_top:
      state.rivals.list.length === 0
        ? 0
        : Math.max(...state.rivals.list.map((r) => companyRating(r.company).total)),
  };
}

const CSV_COLUMNS: readonly (keyof CampaignRow)[] = [
  'seed',
  'start_system',
  'start_market',
  'days_survived',
  'bankrupt',
  'bankrupt_day',
  'contracts_taken',
  'contracts_done',
  'contracts_failed',
  'contracts_abandoned',
  'contracts_withdrawn',
  'mechs_owned_end',
  'tonnage_end',
  'best_class_end',
  'mechs_lost',
  'mechs_salvaged',
  'pilots_lost',
  'pilot_days_in_medbay',
  'cbills_min',
  'cbills_end',
  'repair_share',
  'upkeep_share',
  'landing_share',
  'mechs_deployed_avg',
  'avg_wear_end',
  'jumps',
  'days_in_transit',
  'supply_share',
  'refit_share',
  'trophy_income_share',
  'contract_income',
  'income_total',
  'payout_avg',
  'payout_in_mechs',
  'salvage_offered',
  'salvage_kept',
  'mechs_sold',
  'parts_sold',
  'upgrades',
  'refits',
  'mechs_bought',
  'bay_upgrades',
  'bays_end',
  'standing_best',
  'standing_worst',
  'factions_locked',
  'offers_blocked_share',
  'fame_end',
  'reliability_end',
  'advance_share_avg',
  'idle_downtimes',
  'worlds_captured',
  'clan_raids',
  'front_contracts_share',
  'tension_avg',
  'assault_share',
  'assault_open_share',
  'defense_share',
  'vs_house_share',
  'vs_pirates_share',
  'deltas_end',
  'rivals_bankrupt',
  'rival_battles',
  'offers_taken_by_rivals',
  'rank_end',
  'rank_best',
  'rating_end',
  'rival_rating_top',
];

export function toCsv(rows: readonly CampaignRow[]): string {
  const lines = [CSV_COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(CSV_COLUMNS.map((c) => String(row[c])).join(','));
  }
  return lines.join('\n');
}

/** Разбирает `1..70` в список сидов; одиночное число — список из одного. */
export function parseSeedRange(spec: string): number[] {
  const m = /^(\d+)\.\.(\d+)$/.exec(spec);
  if (m === null) {
    const n = Number(spec);
    if (!Number.isFinite(n)) throw new Error(`Не разобрал диапазон сидов: «${spec}»`);
    return [n];
  }
  const from = Number(m[1]);
  const to = Number(m[2]);
  if (from > to) throw new Error(`Диапазон сидов «${spec}» пуст: начало больше конца`);
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

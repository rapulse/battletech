import { ECONOMY, NAMES } from '../../data/index.js';
import { fillName } from '../../rules/names.js';
import { isWreck } from '../mech/MechRecord.js';
import { ZONE_IDS, type ZoneId } from '../../model/HitZone.js';
import type { Pilot } from '../../model/Pilot.js';
import { makePilot } from '../../rules/skills.js';
import type { Rng } from '../../rng/index.js';
import { fastResolve } from '../bridge/fastResolve.js';
import type { BattleBrief, BattleParticipant } from '../bridge/toBattle.js';
import { applyZoneRepair, attemptReplacePart, replacePartPlan, zoneRepairPlan } from '../company/jobs.js';
import { dischargeFromMedbay } from '../company/medbay.js';
import { chargeUnavoidable, payrollAmount } from '../company/payroll.js';
import { withMech, type Company } from '../company/types.js';
import { contractObjective, emplacementsField, fortressField } from '../contracts/active.js';
import { availableContracts, contractDecadeOf, type Contract } from '../contracts/board.js';
import { buildAllies, buildOpfor } from '../contracts/opfor.js';
import { withPirateClearing, PIRATE_FACTION } from '../contracts/pirates.js';
import { CONTRACTS } from '../contracts/schema.js';
import { contractResultOf, reputationOutcomeOf, salvagePointsOf } from '../contracts/salvage.js';
import { companyRating, companyThreat, lanceThreat } from '../contracts/threat.js';
import { collectTrophies, debrief } from '../debrief/index.js';
import { GALAXY } from '../galaxy/catalog.js';
import { withDelta, type GalaxyDeltas } from '../galaxy/delta.js';
import { mechValue } from '../market/pricing.js';
import { recordChassisDef, type MechRecord } from '../mech/MechRecord.js';
import { repairPlan } from '../mech/repair.js';
import { applyReputation, contractReputation } from '../reputation/accrual.js';
import { type ReputationState } from '../reputation/state.js';
import type { CampaignRngSet } from '../rng.js';
import { withCompanyEffort, type WarState } from '../war/index.js';
import { foundRival } from './founding.js';
import {
  regimentTick,
  type CommissionReport,
  type RegimentHireEndReport,
  type RegimentMoveReport,
} from './regiments.js';
import { RIVALS } from './schema.js';
import { withWorldRelations, type Rival, type RivalsState } from './types.js';

/**
 * Такт соперников (шаг 22, части A и B).
 *
 * **Чем этот такт является.** Тем же, чем `fastResolve` является полному бою:
 * не вторыми правилами, а теми же правилами на грубом календаре. Содержание
 * считает `payroll.ts`, ремонт — `repairPlan`/`applyZoneRepair`, бой —
 * `fastResolve`, разбор — `debrief`, трофеи — `collectTrophies`, репутацию —
 * `contractReputation`, вклад в войну — `withCompanyEffort`. Ни одной из этих
 * функций не пришлось спрашивать «а если это соперник» — и ровно это, а не
 * число отрядов, было главной проверкой шага (ловушка 1 плана).
 *
 * Грубого здесь два, и оба записаны честно:
 *
 * 1. **Календарь.** У соперника нет очереди суток: за одну декаду он чинится,
 *    добирает экипаж и, если готов, отрабатывает один контракт. Своя очередь на
 *    каждого означала бы восемь параллельных календарей в снимке — и, что
 *    важнее, третий календарь в игре, которого решение шага 21a не допускает.
 * 2. **Снабжение.** Соперник не торгует узлами и не переоснащается: склад у
 *    него всегда пуст, трофеи он либо ставит в строй, либо продаёт. Мехлаб и
 *    рынок — это ЭКРАНЫ, и моделировать их для того, кого игрок видит одной
 *    строкой в таблице, значило бы платить за то, чего не видно.
 *
 * **Порядок хода.** Соперники ходят НА ТАКТЕ, игрок — между тактами (ловушка 1
 * части B, выбор записан в `wiki/decisions.md`). Отсюда «успей раньше» означает
 * «не тяни декаду»: работа, за которой рота собиралась на следующей неделе,
 * может уйти на ближайшем такте.
 */

const P = ECONOMY.payroll;

/** Доля месячного содержания, приходящаяся на одну декаду. */
const PAYROLL_SHARE = CONTRACTS.board.decadeDays / P.intervalDays;

/** Зоны, разрушение которых означает не ремонт, а списание машины. */
const VITAL: readonly ZoneId[] = ['torso', 'head'];

export interface RivalContractReport {
  readonly rivalId: string;
  readonly rivalName: string;
  readonly systemId: string;
  readonly contractId: string;
  readonly employer: string;
  readonly target: string;
  readonly mission: string;
  readonly result: 'won' | 'withdrawn' | 'lost';
  readonly payout: number;
  readonly mechsLost: number;
  readonly trophies: number;
}

export interface RivalMoveReport {
  readonly rivalId: string;
  readonly rivalName: string;
  readonly from: string;
  readonly to: string;
}

export interface RivalGoneReport {
  readonly rivalId: string;
  readonly rivalName: string;
  /** Кто пришёл на освободившееся место. */
  readonly replacedById: string;
  readonly replacedByName: string;
  readonly systemId: string;
}

export interface RivalTickResult {
  readonly rivals: RivalsState;
  readonly deltas: GalaxyDeltas;
  readonly war: WarState;
  readonly contracts: readonly RivalContractReport[];
  readonly moves: readonly RivalMoveReport[];
  readonly gone: readonly RivalGoneReport[];
  /** Полковые подряды этого такта (шаг 22c). */
  readonly commissions: readonly CommissionReport[];
  /** Перелёты полков этого такта (шаг 82). */
  readonly regimentMoves: readonly RegimentMoveReport[];
  /** Найм полка державой кончился (шаг 89). */
  readonly regimentHireEnds: readonly RegimentHireEndReport[];
}

// --- отряд между контрактами ---------------------------------------------------

/** Что уже взято в этой системе за текущую декаду — зеркало проверки в `execute.ts`. */
function takenAt(deltas: GalaxyDeltas, systemId: string, day: number): readonly string[] {
  const delta = deltas[systemId];
  if (delta === undefined || delta.takenDecade !== contractDecadeOf(day)) return [];
  return delta.taken ?? [];
}

/**
 * Машины, годные к вылету, — тот же критерий, что у `deployable` в `execute.ts`
 * и у `readyMechs` бота-менеджера: цела в торсе и голове, есть пилот, пилот в строю.
 */
function readyMechs(company: Company): readonly MechRecord[] {
  const active = new Set(company.pilots.filter((p) => p.status === 'active').map((p) => p.id));
  return company.mechs.filter(
    (m) => m.pilotId !== null && active.has(m.pilotId) && !isWreck(m),
  );
}

/** Звено на вылет: самые тяжёлые из годных — та же политика, что у бота-менеджера. */
function chooseLance(company: Company): readonly MechRecord[] {
  return [...readyMechs(company)]
    .sort((a, b) => recordChassisDef(b).tons - recordChassisDef(a).tons)
    .slice(0, CONTRACTS.lanceSize);
}

/** Списание разбитых остовов: торс или голова разрушены — это не машина, а обломки. */
function scrapWrecks(company: Company): Company {
  const wrecks = new Set(company.mechs.filter(isWreck).map((m) => m.id));
  if (wrecks.size === 0) return company;
  // Пилот разбитой машины остаётся в отряде: он сядет в первую свободную кабину
  // на шаге `crewStep`. Отряд теряет технику, а не людей, — то же правило, что
  // у роты игрока.
  return { ...company, mechs: company.mechs.filter((m) => !wrecks.has(m.id)) };
}

/** Выписка из лазарета: декада перекрывает любой срок лечения (`medbay.ts::treatmentDays`). */
function dischargeAll(company: Company): Company {
  if (!company.pilots.some((p) => p.status === 'out')) return company;
  return {
    ...company,
    pilots: company.pilots.map((p) => (p.status === 'out' ? dischargeFromMedbay(p) : p)),
  };
}

/**
 * Ремонт за один такт.
 *
 * Работ не больше, чем стапелей (`company.bays`): пропускная способность цеха у
 * соперника та же, что у роты, и «чинится весь парк разом» было бы первым
 * правилом, написанным для него отдельно. Неприкосновенный остаток — месяц
 * содержания, та же дисциплина, что у бота-менеджера: отряд, вложивший в цех
 * последние деньги, разоряется на ближайшей зарплате, ещё не выйдя на работу.
 */
function repairStep(company: Company, rng: Rng): Company {
  const reserve = payrollAmount(company) * RIVALS.reserveMonths;
  let budget = Math.max(0, (company.cbills - reserve) * RIVALS.repairShare);
  let next = company;
  let done = 0;

  // Сначала самые побитые: машина, стоящая в цеху наполовину починенной, не
  // выходит на работу вовсе, а половина парка с оторванной бронёй — выходит.
  const order = [...company.mechs].sort((a, b) => repairPlan(b).cost - repairPlan(a).cost);
  for (const record of order) {
    if (done >= company.bays || budget <= 0) break;
    let mech = next.mechs.find((m) => m.id === record.id);
    if (mech === undefined) continue;

    // Разрушенная не жизненно важная зона — полевая замена узла, ровно та же
    // работа и тот же бросок, что у роты (`jobs.ts::attemptReplacePart`).
    let spent = 0;
    for (let z = 0; z < ZONE_IDS.length; z++) {
      const id = ZONE_IDS[z] as ZoneId;
      if (VITAL.includes(id)) continue;
      if (mech.condition.zones[z]?.destroyed !== true) continue;
      const plan = replacePartPlan(mech, id);
      if (plan.cost > budget - spent) continue;
      spent += plan.cost;
      mech = attemptReplacePart(mech, id, rng).record;
    }

    for (const zone of ZONE_IDS) {
      const plan = zoneRepairPlan(mech, zone);
      if (plan.jobCount === 0) continue;
      if (plan.cost > budget - spent) continue;
      spent += plan.cost;
      mech = applyZoneRepair(mech, zone);
    }

    if (spent <= 0) continue;
    budget -= spent;
    next = withMech({ ...next, cbills: next.cbills - spent }, mech);
    done++;
  }
  return next;
}

/**
 * Экипаж: свободные пилоты садятся в пустые кабины, на оставшиеся нанимаются
 * новые. Цена найма — та же, что у роты (`data/economy.json` → `hiring`).
 */
function crewStep(company: Company, rng: Rng): Company {
  let next = company;

  const seated = new Set(next.mechs.map((m) => m.pilotId).filter((id): id is string => id !== null));
  const free = next.pilots.filter((p) => p.status === 'active' && !seated.has(p.id));
  let f = 0;
  next = {
    ...next,
    mechs: next.mechs.map((m) => {
      if (m.pilotId !== null || isWreck(m)) return m;
      const pilot = free[f];
      if (pilot === undefined) return m;
      f++;
      return { ...m, pilotId: pilot.id };
    }),
  };

  // Отряд не держит на довольствии пилотов, которым не в чем выходить. Один
  // запасной остаётся — на случай ранения, ровно как держит его игрок; всё
  // сверх того отчисляется. Без этого проданная машина оставляла бы пилота на
  // зарплате до конца кампании, и содержание соперника росло бы вечно.
  const seatedNow = new Set(next.mechs.map((m) => m.pilotId).filter((id): id is string => id !== null));
  const spare = next.pilots.filter((p) => !seatedNow.has(p.id));
  if (spare.length > 1) {
    const dismissed = new Set(spare.slice(1).map((p) => p.id));
    next = { ...next, pilots: next.pilots.filter((p) => !dismissed.has(p.id)) };
  }

  const empty = next.mechs.filter((m) => m.pilotId === null && !isWreck(m));
  const reserve = payrollAmount(next) * RIVALS.reserveMonths;
  for (let n = 0; n < empty.length; n++) {
    const tier = rng.int(2, 4);
    const pilot: Pilot = makePilot(rng, {
      id: `${(empty[n] as MechRecord).id}-пилот-${next.pilots.length + n + 1}`, // i18n-ignore: id в сохранениях
      callsign: fillName(NAMES.defaults.rivalPilotCallsign, { n: next.pilots.length + n + 1 }),
      tier,
    });
    // Соперник платит ту же плату за поиск, что и рота игрока: найм у всех
    // один. Ступень кандидата у соперника своя (`rivals.json`), а цена поиска
    // от неё не зависит — платят за объявление, а не за человека.
    const fee = ECONOMY.hiring.searchFee;
    if (next.cbills - fee < reserve) break;
    next = {
      ...next,
      cbills: next.cbills - fee,
      pilots: [...next.pilots, pilot],
      mechs: next.mechs.map((m) => (m.id === (empty[n] as MechRecord).id ? { ...m, pilotId: pilot.id } : m)),
    };
  }
  return next;
}

// --- работа ---------------------------------------------------------------------

/**
 * Готов ли отряд браться за работу.
 *
 * Не бросок кубика, а состояние парка: доля машин на ходу против всего парка.
 * Ровно этим соперник и держит темп примерно на темпе роты игрока — около
 * двадцати контрактов за кампанию, а не по одному каждую декаду: побитый отряд
 * сперва чинится.
 */
function readyForWork(company: Company): boolean {
  if (company.mechs.length === 0) return false;
  return readyMechs(company).length / company.mechs.length >= RIVALS.readyShare;
}

/** Какую работу взять: та же оценка, что у бота-менеджера, — посильное и самое денежное. */
function pickContract(
  offers: readonly Contract[],
  company: Company,
  lance: readonly MechRecord[],
): Contract | null {
  const ours = lanceThreat(company, lance) * RIVALS.contractOdds;
  let best: Contract | null = null;
  for (const offer of offers) {
    if (companyThreat(offer) > ours) continue;
    if (best === null || offer.payout > best.payout) best = offer;
  }
  return best;
}

/**
 * Куда лететь, когда на своей бирже брать нечего.
 *
 * Один прыжок за такт и никакого обхода в ширину: у отряда один десантный
 * корабль, а декада — это и есть примерно один прыжок с зарядкой паруса. Выбор
 * — по числу посильных предложений у соседа, то есть по той же бирже, которую
 * видит игрок.
 */
function pickMove(
  rival: Rival,
  deltas: GalaxyDeltas,
  war: WarState,
  worldSeed: number,
  day: number,
  lance: readonly MechRecord[],
): string | null {
  if (RIVALS.moveJumps <= 0) return null;
  if (rival.company.cbills < RIVALS.moveCost) return null;
  const here = GALAXY.require(rival.systemId);
  let bestId: string | null = null;
  let bestPayout = 0;
  for (const j of GALAXY.neighbors(here)) {
    const id = GALAXY.id(j);
    const offers = availableContracts(worldSeed, deltas, id, day, takenAt(deltas, id, day), rival.reputation, war);
    // Искупительная работа — разговор Дома с ротой игрока; соперник её не берёт.
    const offer = pickContract(offers.filter((c) => c.atonement !== true), rival.company, lance);
    if (offer !== null && offer.payout > bestPayout) {
      bestPayout = offer.payout;
      bestId = id;
    }
  }
  return bestId;
}

/** Сид боя соперника. Из потока `camp.rivals`, а не из сида мира: бой — свойство КАМПАНИИ. */
function battleSeeds(rng: Rng): { readonly battleSeed: number; readonly mapSeed: number } {
  return {
    battleSeed: (rng.next() * 0xffffffff) >>> 0,
    mapSeed: (rng.next() * 0xffffffff) >>> 0,
  };
}

/**
 * Один контракт соперника от подписи до расчёта.
 *
 * Тот же порядок, что у `executeResolveContract`: трофеи, ростер, пилоты,
 * расчёт с нанимателем, репутация, вклад в войну. Разница ровно одна — трофеи
 * берутся «по умолчанию», самые дорогие: выбор трофея это ЭКРАН, и спрашивать
 * его у соперника не у кого.
 */
function fight(
  rival: Rival,
  contract: Contract,
  lance: readonly MechRecord[],
  worldRep: ReputationState,
  war: WarState,
  rngs: CampaignRngSet,
  rng: Rng,
  day: number,
): { readonly rival: Rival; readonly war: WarState; readonly report: RivalContractReport } {
  const { battleSeed, mapSeed } = battleSeeds(rng);
  const pilotOf = (record: MechRecord): Pilot => {
    const pilot = rival.company.pilots.find((p) => p.id === record.pilotId);
    if (pilot === undefined) throw new RangeError(`У соперника ${rival.id} нет пилота ${record.pilotId}`);
    return pilot;
  };
  const company: BattleParticipant[] = lance.map((record) => ({ record, pilot: pilotOf(record) }));
  const brief: BattleBrief = {
    mapSeed,
    battleSeed,
    map: { biome: contract.biome },
    company,
    enemy: buildOpfor(contract, lance, battleSeed),
    // Звено нанимателя — и у соперника (шаг 73b): он взял тот же контракт на
    // тех же условиях, с урезанным гонораром.
    ...(contract.allies === undefined ? {} : { allies: buildAllies(contract, battleSeed) }),
    ...emplacementsField(contract, battleSeed),
    ...fortressField(contract),
    // Долевая задача — числом от ОБЪЯВЛЕННОГО состава, как у игрока
    // (`contractBrief`, шаг 61): разведка ошибается и для соперника.
    objective: contractObjective(contract),
  };

  const outcome = fastResolve(brief);
  const result = contractResultOf(outcome, false);
  const heldField = result === 'won' && outcome.heldField;
  const debriefed = debrief({ brief, outcome: { ...outcome, heldField }, rng: rngs, wearStream: 'camp.rivals' });

  const offered = [...collectTrophies(brief, outcome, heldField)].sort((a, b) => mechValue(b) - mechValue(a));
  const kept = offered.slice(0, salvagePointsOf(offered.length, contract.salvageShare));

  // Ростер: машины вылета заменяются тем, что от них осталось, остальные не
  // трогаются — они стояли в ангаре.
  const inSortie = new Set(lance.map((m) => m.id));
  let next: Company = {
    ...rival.company,
    mechs: [...rival.company.mechs.filter((m) => !inSortie.has(m.id)), ...debriefed.company, ...kept],
  };

  // Пилоты: потерянный уходит из отряда вместе с местом в кабине, раненый
  // ложится в лазарет (у соперника он лечится к следующему такту).
  const byId = new Map(debriefed.pilots.map((p) => [p.id, p]));
  const lost = new Set<string>();
  const pilots = next.pilots.flatMap((p) => {
    const after = byId.get(p.id);
    if (after === undefined) return [p];
    if (after.status === 'lost') {
      lost.add(p.id);
      return [];
    }
    return [after];
  });
  next = {
    ...next,
    pilots,
    mechs: next.mechs.map((m) => (m.pilotId !== null && lost.has(m.pilotId) ? { ...m, pilotId: null } : m)),
  };

  // Расчёт с нанимателем: аванс уже уплачен при подписи, здесь остаток при
  // успехе и неустойка при провале — те же числа контракта, что у роты.
  if (result === 'won') next = { ...next, cbills: next.cbills + (contract.payout - contract.advance) };
  else if (result === 'lost') next = chargeUnavoidable(next, contract.penalty, day);

  const reputation = applyReputation(
    withWorldRelations(rival.reputation, worldRep),
    contractReputation(
      withWorldRelations(rival.reputation, worldRep),
      reputationOutcomeOf(result, outcome, contract.mission),
      contract.mission,
      contract.employer,
      contract.target,
    ),
  );

  const nextWar =
    result === 'won' ? withCompanyEffort(war, contract.employer, contract.target, contract.payout) : war;

  return {
    rival: {
      ...rival,
      company: next,
      // Матрица фракций у соперника не хранится: она свойство мира
      // (`types.ts::withWorldRelations`), и вернуть её сюда значило бы завести
      // восемь расходящихся политических карт.
      reputation: { ...reputation, relations: {} },
      contracts: rival.contracts + 1,
      wins: rival.wins + (result === 'won' ? 1 : 0),
    },
    war: nextWar,
    report: {
      rivalId: rival.id,
      rivalName: rival.name,
      systemId: contract.systemId,
      contractId: contract.id,
      employer: contract.employer,
      target: contract.target,
      mission: contract.mission,
      result,
      payout: contract.payout,
      mechsLost: debriefed.lostRecordIds.length,
      trophies: kept.length,
    },
  };
}

/**
 * Лишнее железо уходит с молотка.
 *
 * Отряд держит парк не больше `fleetCap` машин: трофей, который не встал в
 * строй, продаётся по той же цене, по которой его купил бы игрок
 * (`market/pricing.ts::mechValue`). Без этого стока восемь соперников за
 * кампанию скопили бы по сорок машин и таблица рейтинга перестала бы что-либо
 * значить.
 */
function sellSurplus(company: Company, cap: number): Company {
  if (company.mechs.length <= cap) return company;
  const keep = [...company.mechs].sort((a, b) => mechValue(b) - mechValue(a));
  const sold = keep.slice(cap);
  if (sold.length === 0) return company;
  const income = sold.reduce((n, m) => n + mechValue(m), 0);
  const soldIds = new Set(sold.map((m) => m.id));
  return {
    ...company,
    cbills: company.cbills + income,
    mechs: company.mechs.filter((m) => !soldIds.has(m.id)),
  };
}

// --- сам такт --------------------------------------------------------------------

export interface RivalTickInput {
  readonly rivals: RivalsState;
  readonly deltas: GalaxyDeltas;
  readonly war: WarState;
  /** Репутация игрока: из неё берётся только матрица отношений ФРАКЦИЙ — она одна на мир. */
  readonly worldRep: ReputationState;
  readonly worldSeed: number;
  readonly day: number;
  /** Где стоит рота игрока: рядом с ней приходят на смену новые отряды. */
  readonly playerSystemId: string;
  /** Рейтинг роты игрока на сегодня — запоминается для «движения» в таблице. */
  readonly playerRating: number;
  readonly rngs: CampaignRngSet;
}

/**
 * Такт соперников (задача очереди `rivalTick`, раз в декаду).
 *
 * Идёт СЛЕДОМ за тактом фронта того же дня: фракции сперва копят и воюют, потом
 * наёмники разбирают то, что из этого вышло. Порядок держит номер постановки в
 * очередь (`state.ts`), а не совпадение.
 */
export function rivalTick(input: RivalTickInput): RivalTickResult {
  const { rivals, worldRep, worldSeed, day, playerSystemId, playerRating, rngs } = input;
  const rng = rngs.stream('camp.rivals');

  let deltas = input.deltas;
  let war: WarState = input.war;
  const contracts: RivalContractReport[] = [];
  const moves: RivalMoveReport[] = [];
  const gone: RivalGoneReport[] = [];

  const list: Rival[] = [];
  let bankrupt = rivals.bankrupt;
  let nextId = rivals.nextId;

  for (const start of rivals.list) {
    const ratingBefore = companyRating(start.company).total;

    // 1. Отряд, который не свёл концы с концами, распускается — но по-разному,
    //    и разница не косметическая.
    //
    //    **Канонический отряд из реестра MRBC не исчезает.** Рейнджеры Уако
    //    после разгрома остаются Рейнджерами Уако: они набирают людей заново и
    //    возвращаются. Отсюда же ответ на «через сто декад останется три
    //    отряда» — у именованных убыли нет вовсе.
    //
    //    **Вольный отряд распускается насовсем**, освобождая место на рынке;
    //    заполняет его формирование новых ниже по такту.
    if (start.company.bankrupt || start.company.mechs.length === 0) {
      bankrupt++;
      if (start.registered) {
        const taken = new Set([...list, ...rivals.list].map((r) => r.name));
        const rebuilt = foundRival(worldSeed ^ (day * 0x9e3779b9), start.systemId, nextId, taken);
        nextId++;
        gone.push({
          rivalId: start.id,
          rivalName: start.name,
          replacedById: start.id,
          replacedByName: start.name,
          systemId: start.systemId,
        });
        // Имя, герб и место остаются его собственными: вернулся тот же отряд,
        // а не другой под тем же флагом.
        list.push({
          ...rebuilt,
          id: start.id,
          name: start.name,
          unitId: start.unitId,
          emblem: start.emblem,
          registered: true,
          systemId: start.systemId,
          contracts: start.contracts,
          wins: start.wins,
        });
      } else {
        gone.push({
          rivalId: start.id,
          rivalName: start.name,
          replacedById: '',
          replacedByName: '',
          systemId: start.systemId,
        });
      }
      continue;
    }

    let rival: Rival = { ...start, ratingBefore };

    // 2. Содержание. Декада — треть месяца, и цена та же, что у роты: свой
    //    прайс-лист для соперника был бы первым правилом, написанным отдельно.
    let company = chargeUnavoidable(rival.company, Math.round(payrollAmount(rival.company) * PAYROLL_SHARE), day);
    company = dischargeAll(company);
    company = scrapWrecks(company);
    company = repairStep(company, rng);
    company = crewStep(company, rng);
    company = sellSurplus(company, CONTRACTS.lanceSize + 2);
    rival = { ...rival, company };

    // 3. Работа. Отряд, который сейчас не тянет вылет, эту декаду чинится — и
    //    ровно этим держит темп на темпе роты игрока.
    const lance = chooseLance(rival.company);
    if (lance.length === 0 || !readyForWork(rival.company)) {
      list.push(rival);
      continue;
    }

    const offers = availableContracts(
      worldSeed,
      deltas,
      rival.systemId,
      day,
      takenAt(deltas, rival.systemId, day),
      // Биржа спрашивается С ЕГО репутацией (ловушка 2 части B): порог
      // доступности, потолок по известности, гонорар и аванс — его собственные.
      // Иначе новичок-соперник брался бы за штурмы, которых ему не предложат.
      rival.reputation,
      war,
    );
    // Искупительная работа (2026-09-14) соперника не касается: мир соперников
    // живёт, как жил, а бесплатный контракт разорил бы его кассу.
    const offer = pickContract(offers.filter((c) => c.atonement !== true), rival.company, lance);

    if (offer === null) {
      const to = pickMove(rival, deltas, war, worldSeed, day, lance);
      if (to !== null) {
        moves.push({ rivalId: rival.id, rivalName: rival.name, from: rival.systemId, to });
        rival = {
          ...rival,
          systemId: to,
          company: chargeUnavoidable(rival.company, RIVALS.moveCost, day),
        };
      }
      list.push(rival);
      continue;
    }

    // 4. Работа занята — тем же швом, что у роты: записью в `taken` дельты
    //    системы (решение 3). Второго способа «контракт занят» в игре нет, и
    //    биржа остаётся ВЫВОДИМОЙ — в снимок уходит только факт взятия.
    deltas = withDelta(deltas, rival.systemId, {
      takenDecade: contractDecadeOf(day),
      taken: [...takenAt(deltas, rival.systemId, day), offer.id],
    });
    rival = { ...rival, company: { ...rival.company, cbills: rival.company.cbills + offer.advance } };

    const fought = fight(rival, offer, lance, worldRep, war, rngs, rng, day);
    war = fought.war;
    // МИР СТАЛ ЧИЩЕ (шаг 37a) — тем же швом, что у роты (`execute.ts`).
    // Вычищенность это свойство МИРА, а не роты: вычистить его мог кто угодно,
    // и след виден всем одинаково. Без этой строки прогон мира без игрока
    // показал бы тыл, который только разоряется и никогда не восстанавливается,
    // — картину, которой в игре с игроком не будет.
    if (fought.report.result === 'won' && offer.target === PIRATE_FACTION) {
      deltas = withPirateClearing(deltas, GALAXY.require(rival.systemId));
    }
    contracts.push(fought.report);
    list.push({ ...fought.rival, company: sellSurplus(fought.rival.company, CONTRACTS.lanceSize + 2) });
  }

  // 5. Рынок наёмников не пустеет. Свободные места заполняются новыми вольными
  //    отрядами — не разом, а `formationPerTick` за декаду: отряд собирают из
  //    отставных офицеров, трофеев и чужих долгов, и это занимает время. Без
  //    этого через сотню декад от трёхсот отрядов осталась бы горстка, и мир
  //    тихо опустел бы — ровно тот класс поломки, который не видно, пока не
  //    посмотришь на счётчик.
  let formed = rivals.formed;
  const vacancies = RIVALS.companies - list.length;
  if (vacancies > 0) {
    const want = Math.min(vacancies, Math.max(0, Math.round(vacancies * RIVALS.formationPerTick + rng.next())));
    const taken = new Set(list.map((r) => r.name));
    for (let n = 0; n < want; n++) {
      // Новый отряд садится там, где есть работа, а не рядом с ротой игрока:
      // соперники расселяются по всей карте (шаг 22c).
      const anchor = list[rng.int(0, Math.max(0, list.length - 1))]?.systemId ?? playerSystemId;
      const fresh = foundRival(worldSeed ^ ((day + n) * 0x85ebca6b), anchor, nextId, taken);
      taken.add(fresh.name);
      nextId++;
      formed++;
      list.push(fresh);
    }
  }

  // 6. Великие полки ходят СВОИМ масштабом: не контракт с биржи, а полковой
  //    подряд, и бой у них полк на полк. Идут последними: их подряды двигают
  //    военные фонды, а ротные отряды весь такт читали фонды прежними.
  const rg = regimentTick(rivals.regiments, war, worldRep, deltas, worldSeed, day, rng);
  war = rg.war;

  return {
    rivals: {
      ...rivals,
      list,
      regiments: rg.regiments,
      playerRatingBefore: playerRating,
      bankrupt,
      formed,
      nextId,
    },
    deltas,
    war,
    contracts,
    moves,
    gone,
    commissions: rg.commissions,
    regimentMoves: rg.moves,
    regimentHireEnds: rg.hireEnds,
  };
}

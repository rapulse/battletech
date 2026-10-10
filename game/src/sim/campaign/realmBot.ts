import {
  CampaignState,
  FACTIONS,
  GALAXY,
  PLAYER_ACTOR_ID,
  WAR,
  isLegal,
  greatHirePrice,
  realmTitle,
  dateOf,
  domainBorder,
  bordersOf,
  growthOf,
  realmAlarm,
  pactPrice,
  domainCapitalIndex,
  domainWorlds,
  execute,
  foundingInit,
  frontSectors,
  ownerOf,
  peaceTerms,
  standingOf,
  theaterOf,
  totalArmy,
  withDelta,
  withStanding,
  worldContributionAt,
  realmArmyCap,
  syncDomainEconomy,
  atWarWithPlayer,
  boundOrTruced,
  planOffensive,
  orderLance,
  fitLance,
  garrisonAt,
  isPlayerActor,
  loyaltyDrift,
  loyaltyPressure,
  shipboardMechs,
  availableContracts,
  contractSimpleThreat,
  lanceSimpleThreat,
  type Contract,
  type MechRecord,
  contractBrief,
  fastResolve,
  buildBlocker,
  buildingCost,
  buildingUpkeep,
  realmArmyUpkeep,
  domainBuildingsUpkeep,
  domainTally,
  regimentPrice,
  sectorLimit,
  sectorMap,
  isGovernor,
  type GovernorPriority,
  type BuildingKind,
  type CampaignCommand,
  type CampaignEvent,
  developCostAt,
} from '../../core/campaign/index.js';
import { frontierIndexAt } from '../../core/campaign/contracts/index.js';
import { skillLevel } from '../../core/model/Pilot.js';
import { buyMechStep, chooseLance, chooseSortie, crewUp, repairStep, type ManagerPolicy } from './manager.js';
import { advanceAnswering } from './worldEvents.js';

/**
 * Бот державы (проект державы, шаг 0): рота получает первый мир леном и дальше живёт державой по
 * простой политике, декада за декадой, теми же командами ядра, что и экран. Зовут его замер
 * `pnpm realm` (`scripts/realmstat.ts`, там же разбор политики и того, что мерится) и тест здоровья
 * второй части (`test/health.test.ts`).
 */

export interface RealmBotArgs {
  readonly seeds: number[];
  readonly years: number;
  readonly startDay: number;
  readonly cash: number;
  readonly policy: 'peace' | 'war';
  /** Военный бюджет державы с первого дня (проект державы, шаг 2): один из `domain.warBudgetSteps`. */
  readonly warShare: number;
  /** Не ставить армию в строй (шаг 80): замер «армия под потолок против армии 0». */
  readonly noArmy: boolean;
  /** Принимать приглашение события мира в коалицию (шаг 84, «Бульдог»); без флага — отказ. */
  readonly joinCoalition: boolean;
  /** Не подавлять восстания (шаг 85): замер «сколько миров отпадёт без работы роты». */
  readonly noRevolt: boolean;
  /**
   * Вести роту к фронту (шаг 86): свободная от восстаний рота летит на свой мир в прыжке от цели
   * ближайшего приказа и идёт в него с армией. Без флага рота стоит, где её оставили лен и восстания, —
   * в приказ она входит сама, если оказалась в прыжке от цели (`orderLance`).
   */
  readonly lead: boolean;
  /**
   * Оставлять гарнизон (шаг 86b): рота на своём мире, который теряет лояльность, оставляет там две годные
   * машины (`garrisonStep`). Без флага гарнизона нет — бой и такт как у `main`.
   */
  readonly garrison: boolean;
  /**
   * Строить (шаг 87): на каждом своём мире без стройки — первая доступная постройка по порядку `BUILD_ORDER`, если
   * касса после цены не ниже `BUILD_RESERVE`, а итог державы с новым содержанием в плюсе (`buildStep`). Без флага
   * построек нет — такт как у `main`.
   */
  readonly build: boolean;
  /**
   * Отдать державу политикам (шаг 88): секторы с губернаторами, как только предел позволяет, и стойка «наступать»
   * на каждой войне (`governStep`). Миры секторов строят губернаторы (с `--build` бот строит руками только миры вне
   * секторов), приказы армии отдают стойки — свой цикл приказов бот не ведёт. Без флага секторов и стоек нет —
   * такт как у `main`.
   */
  readonly govern: boolean;
  /**
   * Нанимать великие полки (шаг 89): на каждой войне без нанятого полка — самый дешёвый доступный полк, если касса
   * после цены не ниже `HIRE_RESERVE` (`hireStep`). Без флага полков бот не нанимает.
   */
  readonly hire: boolean;
  /**
   * Брать работу «пираты у дома» (шаг 89, `pirateStep`), когда нет восстания. Без флага рота её не берёт — бьёт
   * только гарнизон, если он есть.
   */
  readonly pirates: boolean;
  /**
   * Работа державы на мире врага (шаг 90, `warWorkStep`): в войне рота, свободная от восстаний, летит на пограничный
   * мир врага, берёт работу державы против владельца и поднимает флаг, набрав право (`realmWon`). Без флага рота её не
   * берёт — миры врага берёт только армия.
   */
  readonly warWork: boolean;
  /**
   * Лен на стыке трёх держав (шаг 91, партия): мир Дома, у которого среди соседей — ещё не меньше двух Домов или кланов.
   * Без флага — прежний выбор (`pickGrant`).
   */
  readonly junction?: boolean;
  readonly verbose: boolean;
  /** Зонд (шаг 91): зовётся в конце каждой декады с состоянием после такта. Бот его не читает — замер не меняется. */
  readonly onDecade?: (s: CampaignState) => void;
  /** Зонд (шаг 91): события такта декады. Бот его не читает — замер не меняется. */
  readonly onEvents?: (s: CampaignState, events: readonly CampaignEvent[]) => void;
}


export const millions = (n: number): string => (n / 1e6).toFixed(1);
const date = (day: number): string => {
  const d = dateOf(day);
  return `${String(d.day).padStart(2, '0')}.${String(d.month).padStart(2, '0')}.${d.year}`;
};

function run(state: CampaignState, cmd: CampaignCommand): CampaignEvent[] | null {
  const r = execute(state, cmd);
  return r.ok ? [...r.events] : null;
}

/**
 * Политика менеджера для боя восстания (шаг 85): ремонт досуха за вычетом зарплаты, звено — по
 * умолчанию вылета (`DEFAULT_SORTIE_ODDS`). Снабжения и рынка бот державы не ведёт — только чинится
 * и сажает пилотов: замер мерит державу, а не экономику роты.
 */
const REVOLT_POLICY: ManagerPolicy = {
  repairThreshold: 0,
  fleetCap: 6,
  supplyThreshold: Number.POSITIVE_INFINITY,
  supplyJumps: 0,
  contractOdds: 0.58,
  loyaltyThreshold: null,
};

/**
 * ПОПОЛНЕНИЕ (шаг 86): рота докупает машины до `fleetCap` на рынке системы, где стоит, оставляя в кассе
 * зарплату, и сажает на них пилотов (`crewUp` нанимает под пустой корпус). Политика та же, что у боя
 * восстания, только резерв — зарплата, а не бесконечность: там `supplyThreshold` закрывает полёты за
 * снабжением, а в `buyMechStep` он же — резерв кассы.
 *
 * Без пополнения рота державы — только сток: контрактов бот не берёт, в приказах армии трофеев нет, и
 * звено, которое ходит в приказы само (`orderLance`), таяло до нуля — замер шага 86 (`notes.md` §10zl).
 */
const BUY_POLICY: ManagerPolicy = { ...REVOLT_POLICY, supplyThreshold: 0 };

function replenish(s: CampaignState): void {
  while (buyMechStep(s, BUY_POLICY).bought > 0);
  crewUp(s);
}

/**
 * ВОССТАНИЕ (шаг 85): рота летит к восставшему миру (раньше восставший — первым), берёт работу «подавить
 * восстание» и решает бой быстрым расчётом (`fastResolve`, как `pnpm camp --fidelity fast`). После боя —
 * ремонт и пилоты. Возвращает события расчёта контракта или `null`, если боя не было.
 */
function revoltStep(s: CampaignState, verbose: boolean): CampaignEvent[] | null {
  return homeStep(s, verbose, 'revolt');
}

/** Пираты у дома (шаг 89, `--pirates`): та же работа дома, что восстание, — на мир с прорвавшимся набегом. */
function pirateStep(s: CampaignState, verbose: boolean): CampaignEvent[] | null {
  return homeStep(s, verbose, 'raid');
}

/**
 * РАБОТА ДЕРЖАВЫ НА МИРЕ ВРАГА (шаг 90, `--warwork`): цель — пограничный мир врага (не столица) с наибольшим правом
 * флага, затем ближайший. Набрано право — захват; нет — работа державы против владельца, бой быстрым расчётом, как у
 * восстания. Возвращает события расчёта и взятый мир (`null` — не брали).
 */
function warWorkStep(
  s: CampaignState,
  verbose: boolean,
): { readonly events: CampaignEvent[] | null; readonly conquered: string | null } {
  const none = { events: null, conquered: null };
  if (s.contract !== null || s.travel !== null) return none;
  const foes = new Set(Object.keys(s.war.playerWars ?? {}));
  const here = GALAXY.index(s.systemId);
  const won = (i: number): number => s.deltas[GALAXY.id(i)]?.realmWon ?? 0;
  const targets = domainBorder(s.deltas)
    .filter((b) => foes.has(b.owner))
    .flatMap((b) => b.systems.filter((i) => !GALAXY.hasFlag(i, 'capital')))
    .sort((x, y) => won(y) - won(x) || GALAXY.distance(x, here) - GALAXY.distance(y, here) || x - y);
  const target = targets[0];
  if (target === undefined) return none;
  if (target !== here) {
    run(s, { kind: 'travel', systemId: GALAXY.id(target) });
    return none;
  }
  if (won(target) >= WAR.domain.conquerWins) {
    const from = ownerOf(s.deltas, target);
    if (run(s, { kind: 'conquerWorld' }) === null) return none;
    if (verbose) console.log(`  ${date(s.day)} рота поднимает флаг: ${s.systemId} у ${from}`);
    return { events: null, conquered: s.systemId };
  }
  // Как игрок: по «Оценке сил» экрана (`lanceSimpleThreat` против `contractSimpleThreat`), всем звеном, и только
  // работу с перевесом от `WAR_WORK_ODDS` — без порога бот бился о гвардию маленькой ротой и проигрывал всё.
  const lance = chooseLance(s);
  const ours = lanceSimpleThreat(lance);
  const offer = availableContracts(s.worldSeed, s.deltas, s.systemId, s.day, [], s.reputation, s.war)
    .filter((c) => c.warWork === true && ours >= WAR_WORK_ODDS * contractSimpleThreat(c))
    .sort((x, y) => contractSimpleThreat(x) - contractSimpleThreat(y))[0];
  if (offer === undefined) return none;
  const events = fightOffer(s, offer, lance);
  if (verbose && events !== null) {
    const r = events.find((e) => e.kind === 'contractResolved');
    console.log(`  ${date(s.day)} работа державы на ${s.systemId}: ${r?.kind === 'contractResolved' ? r.result : '?'}, право ${won(target)}`);
  }
  return { events, conquered: null };
}

/** Порог «Оценки сил» для работы державы на мире врага (шаг 90): бот берёт её с перевесом, как игрок. */
const WAR_WORK_ODDS = 1.3;

/**
 * Взять работу, вывести звено (по умолчанию — по политике восстания), решить быстрым расчётом, починиться
 * (шаги 85, 89, 90).
 */
function fightOffer(s: CampaignState, offer: Contract, sortie?: readonly MechRecord[]): CampaignEvent[] | null {
  if (run(s, { kind: 'takeContract', contractId: offer.id }) === null) return null;
  const lance = sortie ?? chooseSortie(s, REVOLT_POLICY, offer);
  if (lance.length === 0 || run(s, { kind: 'deploy', recordIds: lance.map((m) => m.id) }) === null) {
    run(s, { kind: 'abandonContract' });
    return null;
  }
  const events = run(s, { kind: 'resolveContract', outcome: fastResolve(contractBrief(s)) });
  if (events === null) throw new Error(`resolveContract отклонена на ${s.systemId}`);
  repairStep(s, REVOLT_POLICY);
  crewUp(s);
  return events;
}

/**
 * Работа дома (шаг 85; пираты — шаг 89): рота летит на свой мир с самой старой такой работой и берёт её. Восстание —
 * по `revoltSince`, пираты — по сроку `raidedUntil`.
 */
function homeStep(s: CampaignState, verbose: boolean, work: 'revolt' | 'raid'): CampaignEvent[] | null {
  if (s.contract !== null || s.travel !== null) return null;
  const mark = (i: number): number | undefined => {
    const d = s.deltas[GALAXY.id(i)];
    if (work === 'revolt') return d?.revoltSince;
    return d?.raidedUntil !== undefined && d.raidedUntil >= s.day ? d.raidedUntil : undefined;
  };
  const worlds = domainWorlds(s.deltas)
    .filter((i) => mark(i) !== undefined)
    .sort((x, y) => (mark(x) ?? 0) - (mark(y) ?? 0) || x - y);
  const target = worlds[0];
  if (target === undefined) return null;
  if (!worlds.some((i) => GALAXY.id(i) === s.systemId)) {
    run(s, { kind: 'travel', systemId: GALAXY.id(target) });
    return null;
  }
  const offer = availableContracts(s.worldSeed, s.deltas, s.systemId, s.day, [], s.reputation, s.war).find((c) =>
    work === 'revolt' ? c.revolt === true : c.homeRaid === true,
  );
  if (offer === undefined) return null;
  const events = fightOffer(s, offer);
  if (events === null) return null;
  if (verbose) {
    const r = events.find((e) => e.kind === 'contractResolved');
    const label = work === 'revolt' ? 'восстание' : 'пираты у дома';
    console.log(`  ${date(s.day)} ${label} ${s.systemId}: ${r?.kind === 'contractResolved' ? r.result : '?'}`);
  }
  return events;
}

/**
 * К ФРОНТУ (шаг 86, `--lead`): рота без контракта и не в перелёте, когда восстаний нет (или бот их не
 * подавляет), летит на свой мир в прыжке от участка, на который приказ пройдёт с лучшим соотношением
 * сил. Уже стоит в прыжке от такого участка — остаётся.
 */
function leadStep(s: CampaignState, noRevolt: boolean): void {
  if (s.contract !== null || s.travel !== null) return;
  if (!noRevolt && domainWorlds(s.deltas).some((i) => s.deltas[GALAXY.id(i)]?.revoltSince !== undefined)) return;
  let best: { system: number; odds: number } | null = null;
  for (const x of frontSectors(s.war, s.reputation, s.deltas, s.day)) {
    if (x.attacker !== PLAYER_ACTOR_ID) continue;
    const check = planOffensive(s.war, s.reputation, s.deltas, s.worldSeed, x.system, s.day);
    const odds = check.ok ? check.forces.odds : (check.forces?.odds ?? 0);
    if (!check.ok && check.block.kind !== 'cooldown' && check.block.kind !== 'noFund') continue;
    if (best === null || odds > best.odds || (odds === best.odds && x.system < best.system)) best = { system: x.system, odds };
  }
  if (best === null || orderLance(s, best.system).length > 0) return;
  const here = GALAXY.index(s.systemId);
  const near = GALAXY.neighbors(best.system)
    .filter((j) => ownerOf(s.deltas, j) === PLAYER_ACTOR_ID)
    .sort((x, y) => GALAXY.distance(x, here) - GALAXY.distance(y, here) || x - y)[0];
  if (near !== undefined && GALAXY.id(near) !== s.systemId) run(s, { kind: 'travel', systemId: GALAXY.id(near) });
}

/**
 * ГАРНИЗОН (шаг 86b, `--garrison`): рота без контракта, стоящая на своём мире под ударом фронта (участок
 * врага на этот мир) или теряющем лояльность (война с прежним владельцем), и ещё без гарнизона, оставляет
 * там две годные машины — если на корабле остаётся хоть одна годная. Место в ангаре докупает пополнение.
 * Политика мира — «драться», по умолчанию.
 */
function garrisonStep(s: CampaignState, verbose: boolean): void {
  if (s.contract !== null || s.travel !== null) return;
  if (!isPlayerActor(ownerOf(s.deltas, s.systemId))) return;
  const here = GALAXY.index(s.systemId);
  const threatened = frontSectors(s.war, s.reputation, s.deltas, s.day).some(
    (x) => x.system === here && x.defender === PLAYER_ACTOR_ID,
  );
  if (!threatened && loyaltyDrift(s.deltas, s.war, s.reputation, s.systemId, s.day) >= 0) return;
  if (garrisonAt(s.company, s.garrison, s.systemId, s.day).length > 0) return;
  const fit = fitLance(s, shipboardMechs(s.company, s.garrison));
  if (fit.length < 3) return;
  const ids = fit.slice(0, 2).map((p) => p.record.id);
  if (run(s, { kind: 'garrisonUnload', recordIds: ids }) !== null && verbose) {
    console.log(`  ${date(s.day)} гарнизон на ${s.systemId}: ${ids.join(' ')}`);
  }
}

/** Порядок стройки бота (шаг 87): оборона и казармы держат мир, цех чинит гарнизон, остальное — потом. */
const BUILD_ORDER: readonly BuildingKind[] = ['defence', 'barracks', 'workshop', 'factory', 'spaceport', 'depot'];
/** Запас кассы, ниже которого бот не строит: полк и пополнение роты важнее. */
const BUILD_RESERVE = 30_000_000;

/**
 * СТРОЙКА (шаг 87, `--build`): то, что игрок делает очевидно, — свободный мир строит следующую постройку, пока
 * держава может её содержать. Деньги — после армии под потолок.
 */
function buildStep(s: CampaignState, verbose: boolean): number {
  let spent = 0;
  // Миры секторов (шаг 88) строит губернатор; бот — как игрок — только миры вне секторов и закреплённые.
  const governed = sectorMap(s.deltas, s.realm);
  for (const i of domainWorlds(s.deltas)) {
    const id = GALAXY.id(i);
    if (governed.has(id) && !s.realm.pinned.includes(id)) continue;
    if (s.deltas[id]?.building !== undefined) continue;
    const kind = BUILD_ORDER.find((k) => buildBlocker(s.worldSeed, s.deltas, i, k) === null);
    if (kind === undefined) continue;
    if (s.company.cbills - buildingCost(kind) < BUILD_RESERVE) break;
    const tally = domainTally(s.worldSeed, s.deltas);
    const net = tally.income - tally.upkeep - realmArmyUpkeep(s.war, s.deltas, s.realm).total - domainBuildingsUpkeep(s.deltas);
    if (net - buildingUpkeep(kind) <= 0) break;
    if (run(s, { kind: 'startBuilding', systemId: id, building: kind }) === null) continue;
    spent += buildingCost(kind);
    if (verbose) console.log(`  ${date(s.day)} стройка на ${id}: ${kind}`);
  }
  return spent;
}

/** Сумма навыков, дающих бонус сектору (шаг 88): присутствие, техника, тактика. */
function governorScore(s: CampaignState, pilotId: string): number {
  const p = s.company.pilots.find((x) => x.id === pilotId);
  return p === undefined ? 0 : skillLevel(p, 'presence') + skillLevel(p, 'tech') + skillLevel(p, 'tactics');
}

/**
 * Приоритет сектора — то, что очевидно игроку: в секторе мир, взятый у фракции, с которой идёт война (лояльность
 * падает, шаг 85), — «лояльность»; иначе — «доход».
 */
function sectorPriority(s: CampaignState, center: string): GovernorPriority {
  // Мир сектора под давлением — война с прежним владельцем или (шаг 91) его подстрекательство — приоритет «лояльность».
  for (const [id, c] of sectorMap(s.deltas, s.realm)) {
    if (c !== center) continue;
    if (loyaltyPressure(s.deltas, s.war, s.reputation, id, s.day) !== null) return 'loyalty';
  }
  return 'income';
}

/**
 * Ответ на сопротивление дипломатией (шаг 91), как игрок: торговый договор с соседом, которого держава тревожит, — если
 * договор можно заключить (отношение не ниже `reputation.json → diplomacy.minStanding`) и касса после цены не ниже
 * `BUILD_RESERVE`. С подстрекателем договора не бывает: подстрекает он от отношения −20 и ниже. В `main` тревоги нет —
 * правило там не срабатывает.
 */
function pactStep(s: CampaignState, verbose: boolean): number {
  const borders = bordersOf(s.deltas);
  const growth = growthOf(s.war);
  let signed = 0;
  for (const { owner } of domainBorder(s.deltas)) {
    if (realmAlarm(s.war, borders, growth, owner) <= 0) continue;
    const cmd = { kind: 'proposePact', factionId: owner, pact: 'trade' } as const;
    if (!isLegal(s, cmd) || s.company.cbills - pactPrice(s.worldSeed, s.deltas) < BUILD_RESERVE) continue;
    if (run(s, cmd) === null) continue;
    signed++;
    if (verbose) console.log(`  ${date(s.day)} торговый договор с ${owner} (отношение ${standingOf(s.reputation, owner).toFixed(0)})`);
  }
  return signed;
}

/**
 * НАЁМ ПОЛКА (шаг 89, `--hire`): на каждой войне без нанятого полка — самый дешёвый полк, который команда примет, если
 * касса после цены не ниже `HIRE_RESERVE`. Резерв меньше стройки: на войне доход уходит в фонд и армию, и с резервом
 * стройки (30 млн) бот не нанимал ни разу (зонд, сид 4: касса к началу войны 18–20 млн). Возвращает потраченное.
 */
const HIRE_RESERVE = 5_000_000;

function hireStep(s: CampaignState, verbose: boolean): { hires: number; spent: number } {
  let hires = 0;
  let spent = 0;
  for (const f of Object.keys(s.war.playerWars ?? {}).sort()) {
    if (s.rivals.regiments.some((r) => r.hire?.against === f)) continue;
    const pick = s.rivals.regiments
      .filter((r) => r.hire === undefined)
      .map((r) => ({ r, price: greatHirePrice(r) }))
      .filter((x) => s.company.cbills - x.price >= HIRE_RESERVE)
      .filter((x) => isLegal(s, { kind: 'hireGreatRegiment', regimentId: x.r.id, against: f }))
      .sort((x, y) => x.price - y.price || (x.r.id < y.r.id ? -1 : 1))[0];
    if (pick === undefined) continue;
    if (run(s, { kind: 'hireGreatRegiment', regimentId: pick.r.id, against: f }) === null) continue;
    hires++;
    spent += pick.price;
    if (verbose) console.log(`  ${date(s.day)} наём: ${pick.r.name} против ${f} за ${millions(pick.price)} млн`);
  }
  return { hires, spent };
}

/**
 * ПОЛИТИКИ (шаг 88, `--govern`): секторы, как только предел позволяет, — центр там, где сектор накроет больше
 * своих миров, ещё не входящих в сектор; губернатор — пилот в строю с наибольшей суммой присутствия, техники и
 * тактики. Приоритет каждого сектора — `sectorPriority`. Стойка «наступать» — на каждой войне без стойки.
 */
function governStep(s: CampaignState, verbose: boolean): void {
  while (s.realm.sectors.length < sectorLimit(s.deltas)) {
    const covered = new Set(sectorMap(s.deltas, s.realm).keys());
    const centers = new Set(s.realm.sectors.map((x) => x.center));
    let best: { id: string; gain: number } | undefined;
    for (const i of domainWorlds(s.deltas)) {
      const id = GALAXY.id(i);
      if (centers.has(id)) continue;
      const trial = { ...s.realm, sectors: [...s.realm.sectors, { center: id, governor: null, priority: 'income' as const }] };
      let gain = 0;
      for (const [w, c] of sectorMap(s.deltas, trial)) if (c === id && !covered.has(w)) gain++;
      if (best === undefined || gain > best.gain) best = { id, gain };
    }
    const pilot = s.company.pilots
      .filter((p) => p.status === 'active' && !isGovernor(s.realm, p.id))
      .sort((x, y) => governorScore(s, y.id) - governorScore(s, x.id) || (x.id < y.id ? -1 : 1))[0];
    if (best === undefined || best.gain === 0 || pilot === undefined) break;
    const ok = run(s, { kind: 'appointGovernor', centerId: best.id, pilotId: pilot.id, priority: 'income' });
    if (ok === null) break;
    if (verbose) console.log(`  ${date(s.day)} губернатор ${pilot.callsign} на сектор ${best.id} (+${best.gain} миров)`);
  }
  for (const x of s.realm.sectors) {
    const want = sectorPriority(s, x.center);
    if (want !== x.priority) run(s, { kind: 'setSectorPriority', centerId: x.center, priority: want });
  }
  for (const f of Object.keys(s.war.playerWars ?? {}).sort()) {
    if (s.realm.stances[f] === undefined) run(s, { kind: 'setFrontStance', factionId: f, stance: 'advance' });
  }
}

/** Мир под лен — см. разбор в шапке. `null`, если такого нет. */
function pickGrant(s: CampaignState, junction: boolean): number | null {
  let best = -Infinity;
  let idx: number | null = null;
  for (let i = 0; i < GALAXY.count; i++) {
    if (GALAXY.hasFlag(i, 'capital')) continue;
    const owner = ownerOf(s.deltas, i);
    if (FACTIONS.get(owner)?.kind !== 'house') continue;
    const foe = GALAXY.neighbors(i).some((j) => {
      const o = ownerOf(s.deltas, j);
      return o !== owner && FACTIONS.get(o)?.kind === 'house';
    });
    if (!foe) continue;
    if (junction) {
      const powers = new Set(
        GALAXY.neighbors(i)
          .map((j) => ownerOf(s.deltas, j))
          .filter((o) => o !== owner && (FACTIONS.get(o)?.kind === 'house' || FACTIONS.get(o)?.kind === 'clan')),
      );
      if (powers.size < 2) continue;
    }
    if (frontierIndexAt(s.deltas, s.reputation, s.war, i) < WAR.domain.grantFrontier) continue;
    const c = worldContributionAt(s.worldSeed, s.deltas, i);
    if (c.income - c.upkeep > best) {
      best = c.income - c.upkeep;
      idx = i;
    }
  }
  return idx;
}

export interface RealmSeedResult {
  readonly seed: number;
  readonly grant: string;
  readonly grantor: string;
  readonly worldsEnd: number;
  readonly worldsMax: number;
  readonly captured: number;
  readonly lost: number;
  readonly tributesOnUs: number;
  readonly battlesAttack: number;
  readonly battlesDefence: number;
  readonly mechsLost: number;
  readonly warDecades: number;
  readonly wars: number;
  readonly aiWars: number;
  readonly peaces: number;
  /** Миры по видам (шаг 81): даром, за отступные, уступкой мира, принудительные на 100 % усталости. */
  readonly peacesFree: number;
  readonly peacesPaid: number;
  readonly peacesCeded: number;
  readonly peacesForced: number;
  /** Кончившиеся войны: сколько и суммарная длина в сутках. */
  readonly warsEnded: number;
  readonly warDays: number;
  /** Войны, идущие к концу прогона: сколько и суммарная длина на последний день. */
  readonly warsOpen: number;
  readonly warOpenDays: number;
  readonly cashEnd: number;
  readonly netPerDecade: number;
  readonly armyEnd: number;
  readonly armyCapEnd: number;
  readonly armyBought: number;
  readonly grantorStanding: number;
  readonly realmLost: boolean;
  readonly orders: number;
  readonly orderWins: number;
  readonly orderOdds: number;
  /** Шаг 85: восстаний, боёв восстания, подавлено, отпало миров; средняя лояльность миров к концу. */
  readonly revolts: number;
  readonly revoltFights: number;
  readonly suppressed: number;
  readonly seceded: number;
  readonly loyaltyEnd: number;
  /** Шаг 86: приказов со звеном роты; сумма машин роты, отрядов против неё, выбитого ротой; машин роты потеряно. */
  readonly companyClashes: number;
  readonly companyMechs: number;
  readonly companyDetachment: number;
  readonly companyKnocked: number;
  readonly companyLost: number;
  /**
   * Шаг 86b: нападений фронта на мир с годным гарнизоном (бой и отход), из них отходов; сумма отрядов
   * против гарнизона, выбитого им, машин гарнизона, потерянных в этих боях; боёв восстания гарнизоном и
   * побед; машин, потерянных в них; уходов с потерянного мира и машин, потерянных с миром; мир-декад с
   * гарнизоном — знаменатель частоты нападений.
   */
  readonly garrisonAttacks: number;
  readonly garrisonWithdrew: number;
  readonly garrisonDetachment: number;
  readonly garrisonKnocked: number;
  readonly garrisonClashLost: number;
  readonly garrisonRevoltFights: number;
  readonly garrisonRevoltWon: number;
  readonly garrisonRevoltLost: number;
  readonly garrisonEvacuated: number;
  readonly garrisonLostMechs: number;
  readonly garrisonWorldDecades: number;
  /** Стройка (шаг 87): готовые постройки по видам, потрачено на стройку, содержание, снесено и уцелело при потере мира. */
  readonly built: Partial<Record<BuildingKind, number>>;
  readonly buildSpent: number;
  readonly buildUpkeep: number;
  readonly buildingsDemolished: number;
  readonly buildingsKept: number;
  /** Команды политик (шаг 88): `кто.что` → сколько. */
  readonly policyActs: Readonly<Record<string, number>>;
  /** Потрачено губернаторами на развитие и фокус. */
  readonly investSpent: number;
  readonly sectorsEnd: number;
  /** Титул державы к концу (шаг 89); `null` — держава пала. */
  readonly titleEnd: string | null;
  /** Пираты у дома (шаг 89): прорывов на миры державы; боёв роты и отбито ею; боёв гарнизона и побед. */
  readonly homeRaids: number;
  readonly raidFights: number;
  readonly raidsRepelled: number;
  readonly garrisonRaidFights: number;
  readonly garrisonRaidWon: number;
  /** Требования соседей (шаг 89): пришло, принято, отказано; войн ИИ от соседей, которым бот хоть раз отказал. */
  readonly demands: number;
  readonly demandsAccepted: number;
  readonly demandsRefused: number;
  readonly warsAfterRefusal: number;
  /** Наём полков (шаг 89): нанято, потрачено, подрядов нанятых полков и побед в них. */
  /** Доход миров и содержание армии державы за все такты (шаг 90, ступень 8): рамка «армия — 30–50 % дохода». */
  readonly incomeSum: number;
  readonly armyUpkeepSum: number;
  /** По годам: доход, содержание армии фактическое и по полной цене, миры (сумма по тактам) и число тактов. */
  readonly byYear: readonly { readonly income: number; readonly army: number; readonly full: number; readonly worlds: number; readonly ticks: number }[];
  /** Работа державы на мире врага (шаг 90): боёв, побед и миров, взятых по праву флага. */
  readonly warWorkFights: number;
  readonly warWorkWon: number;
  readonly warWorkConquered: number;
  readonly hires: number;
  readonly hireSpent: number;
  readonly hiredCommissions: number;
  readonly hiredWins: number;
  /** Сопротивление (шаг 91): войн ИИ коалицией, войн, кончившихся без выигрыша державы, мир-декад подстрекательства. */
  readonly coalitionWars: number;
  readonly warsNoWin: number;
  readonly inciteDecades: number;
  /** Торговых договоров, заключённых ботом в ответ на тревогу и подстрекательство (шаг 91). */
  readonly pactsSigned: number;
}

export function playRealmSeed(seed: number, a: RealmBotArgs): RealmSeedResult {
  return playRealmState(seed, a).result;
}

/** То же, что `playRealmSeed`, и итоговое состояние кампании — для инвариантов теста здоровья. */
export function playRealmState(seed: number, a: RealmBotArgs): { readonly result: RealmSeedResult; readonly state: CampaignState } {
  const s = new CampaignState(seed, { company: foundingInit(seed) });
  s.company = { ...s.company, cbills: 1e12 };
  advanceAnswering(s, a.startDay);

  const g = pickGrant(s, a.junction === true);
  if (g === null) throw new Error(`сид ${seed}: нет мира под лен`);
  const grantor = ownerOf(s.deltas, g);
  const gid = GALAXY.id(g);
  s.systemId = gid;
  s.travel = null;
  s.reputation = withStanding(s.reputation, grantor, 100 - standingOf(s.reputation, grantor));
  s.reputation = { ...s.reputation, fame: 100 };
  s.deltas = withDelta(s.deltas, gid, { fought: 3, foughtWon: 3, foughtFor: grantor, foughtYear: dateOf(s.day).year });
  s.company = { ...s.company, cbills: a.cash };
  if (run(s, { kind: 'claimGrant' }) === null) throw new Error(`сид ${seed}: лен не принят на ${gid}`);
  if (a.warShare > 0 && run(s, { kind: 'setWarBudget', share: a.warShare }) === null) {
    throw new Error(`--war-share ${a.warShare}: нет такого шага в domain.warBudgetSteps`);
  }
  if (a.verbose) console.log(`сид ${seed}: ${date(s.day)} лен ${GALAXY.name(g)} (${grantor})`);

  const endDay = s.day + a.years * 360;
  const startDay = s.day;
  let captured = 0;
  let lost = 0;
  let tributesOnUs = 0;
  let battlesAttack = 0;
  let battlesDefence = 0;
  let mechsLost = 0;
  let warDecades = 0;
  let wars = 0;
  let aiWars = 0;
  let peaces = 0;
  let peacesFree = 0;
  let peacesPaid = 0;
  let peacesCeded = 0;
  let peacesForced = 0;
  let warsEnded = 0;
  let warDays = 0;
  // С какого дня идёт каждая война — снимок до хода: мир такта снимает запись раньше, чем бот её увидит.
  let since = new Map<string, number>();
  // Счёт каждой войны — снимок до хода (шаг 91): война без выигрыша державы — счёт не в её пользу, уступка, отступные
  // или мир на пределе её усталости.
  let score = new Map<string, number>();
  let warsNoWin = 0;
  let pactsSigned = 0;
  let coalitionWars = 0;
  let inciteDecades = 0;
  const notePeace = (e: CampaignEvent): void => {
    if (e.kind !== 'peaceMade' && e.kind !== 'warEnded') return;
    const from = since.get(e.factionId);
    if (from !== undefined) {
      warsEnded++;
      warDays += s.day - from;
      since.delete(e.factionId);
      const lost =
        e.kind === 'peaceMade' && (e.forced === 'realm' || e.cost > 0 || e.ceded !== undefined || (e.yielded?.length ?? 0) > 0);
      if (lost || (score.get(e.factionId) ?? 0) <= 0) warsNoWin++;
    }
    if (e.kind !== 'peaceMade') return;
    if (a.verbose) {
      const rec = s.war.playerWars?.[e.factionId];
      console.log(
        `  ${date(s.day)} мир с ${e.factionId}${e.forced === undefined ? '' : ` на пределе (${e.forced})`}` +
          `${e.cost > 0 ? `, отступные ${millions(e.cost)} млн` : ''}${e.gained === undefined ? '' : `, цель: ${e.gained.join(' ')}`}` +
          `${e.returned === undefined ? '' : `, назад: ${e.returned.join(' ')}`}${rec === undefined ? '' : ` [запись ещё есть]`}`,
      );
    }
    peaces++;
    if (e.forced !== undefined) peacesForced++;
    else if (e.ceded !== undefined) peacesCeded++;
    else if (e.cost > 0) peacesPaid++;
    else peacesFree++;
  };
  // Бой державы подробно (шаг 81): стороны, потери, театры после боя и усталость.
  const logClash = (e: CampaignEvent): void => {
    if (!a.verbose || e.kind !== 'frontClash') return;
    const foe = e.attacker === PLAYER_ACTOR_ID ? e.defender : e.attacker;
    const w = s.war.playerWars?.[foe];
    console.log(
      `  ${date(s.day)} бой ${e.attacker}→${e.defender} ${e.outcome}: ${e.attackerSize}/${e.defenderSize}, потери ${e.attackerLost}/${e.defenderLost}; ` +
        `театр роты ${theaterOf(s.war, PLAYER_ACTOR_ID, foe)}, врага ${theaterOf(s.war, foe, PLAYER_ACTOR_ID)}` +
        (w === undefined ? '' : `; усталость ${Math.round((w.fatigue ?? 0) * 100)} / ${Math.round((w.foeFatigue ?? 0) * 100)} %`),
    );
  };
  let worldsMax = 1;
  let armyBought = 0;
  let realmLost = false;
  let orders = 0;
  let orderWins = 0;
  let orderOdds = 0;
  let revolts = 0;
  let revoltFights = 0;
  let suppressed = 0;
  let seceded = 0;
  let companyClashes = 0;
  let companyMechs = 0;
  let companyDetachment = 0;
  let companyKnocked = 0;
  let companyLost = 0;
  let garrisonAttacks = 0;
  let garrisonWithdrew = 0;
  let garrisonDetachment = 0;
  let garrisonKnocked = 0;
  let garrisonClashLost = 0;
  let garrisonRevoltFights = 0;
  let garrisonRevoltWon = 0;
  let garrisonRevoltLost = 0;
  let garrisonEvacuated = 0;
  let garrisonLostMechs = 0;
  let garrisonWorldDecades = 0;
  const cashStart = s.company.cbills;
  let armySpent = 0;
  const built: Partial<Record<BuildingKind, number>> = {};
  let buildSpent = 0;
  let buildUpkeep = 0;
  let buildingsDemolished = 0;
  let buildingsKept = 0;
  // Политики (шаг 88): команды губернаторов и стоек, деньги на развитие и фокус.
  const policyActs: Record<string, number> = {};
  let investSpent = 0;
  let homeRaids = 0;
  let raidFights = 0;
  let raidsRepelled = 0;
  let garrisonRaidFights = 0;
  let garrisonRaidWon = 0;
  let demands = 0;
  let demandsAccepted = 0;
  let demandsRefused = 0;
  let warsAfterRefusal = 0;
  const refusedBy = new Set<string>();
  const byYear: { income: number; army: number; full: number; worlds: number; ticks: number }[] = [];
  let incomeSum = 0;
  let armyUpkeepSum = 0;
  let warWorkFights = 0;
  let warWorkWon = 0;
  let warWorkConquered = 0;
  let hires = 0;
  let hireSpent = 0;
  let hiredCommissions = 0;
  let hiredWins = 0;

  while (s.day < endDay) {
    if (domainWorlds(s.deltas).length === 0) {
      realmLost = true;
      break;
    }
    // Армия — под потолок, пока в кассе остаётся запас на одну машину.
    const war = syncDomainEconomy(s.war, s.worldSeed, s.deltas, s.company.cbills);
    const cap = realmArmyCap(s.deltas, war.economy[PLAYER_ACTOR_ID]?.capacity ?? 0).total;
    const have = totalArmy(war, PLAYER_ACTOR_ID);
    // Цена полка — та же функция, что у команды: заводы державы (шаг 87) её режут.
    const price = regimentPrice(1, s.deltas);
    const afford = Math.floor(s.company.cbills / price) - 1;
    const buy = Math.min(cap - have, afford);
    if (!a.noArmy && buy > 0 && run(s, { kind: 'raiseRegiment', mechs: buy }) !== null) {
      armyBought += buy;
      armySpent += regimentPrice(buy, s.deltas);
    }
    if (a.build) buildSpent += buildStep(s, a.verbose);

    since = new Map(Object.entries(s.war.playerWars ?? {}).map(([f, w]) => [f, w.since]));
    score = new Map(Object.entries(s.war.playerWars ?? {}).map(([f, w]) => [f, w.won - w.lost]));
    if (a.policy === 'war') {
      const atWar = Object.keys(s.war.playerWars ?? {});
      if (atWar.length === 0 && s.day >= startDay + 360) {
        const target = domainBorder(s.deltas)
          .filter((b) => b.owner !== grantor && FACTIONS.get(b.owner)?.kind === 'house')
          .filter((b) => !boundOrTruced(s.war, PLAYER_ACTOR_ID, b.owner, s.day))
          .sort((x, y) => y.systems.length - x.systems.length || (x.owner < y.owner ? -1 : 1))[0];
        const capital = domainCapitalIndex(s.deltas) as number;
        const goalWorld = target?.systems
          .filter((i) => !GALAXY.hasFlag(i, 'capital'))
          .sort((x, y) => GALAXY.distance(x, capital) - GALAXY.distance(y, capital) || x - y)[0];
        if (target !== undefined && goalWorld !== undefined) {
          const goal = { kind: 'worlds', systems: [GALAXY.id(goalWorld)] } as const;
          if (run(s, { kind: 'declareWar', factionId: target.owner, goal }) !== null) {
            wars++;
            if (a.verbose) console.log(`  ${date(s.day)} война ${target.owner}, цель ${goal.systems[0]}`);
          }
        }
      }
      for (const f of Object.keys(s.war.playerWars ?? {})) {
        const terms = peaceTerms(s.war, s.deltas, s.worldSeed, f, s.day);
        if (terms.kind === 'free' && terms.offered) {
          for (const e of run(s, { kind: 'makePeace', factionId: f }) ?? []) notePeace(e);
        }
      }
    }

    if (a.hire) {
      const h = hireStep(s, a.verbose);
      hires += h.hires;
      hireSpent += h.spent;
    }

    if (a.policy === 'war' && !a.govern) {
      // Приказ армии (шаг 3): против каждого врага — участок с лучшим соотношением сил.
      const best = new Map<string, { system: number; odds: number }>();
      for (const x of frontSectors(s.war, s.reputation, s.deltas, s.day)) {
        if (x.attacker !== PLAYER_ACTOR_ID) continue;
        const check = planOffensive(s.war, s.reputation, s.deltas, s.worldSeed, x.system, s.day);
        if (!check.ok) continue;
        const cur = best.get(x.defender);
        if (cur === undefined || check.forces.odds > cur.odds) best.set(x.defender, { system: x.system, odds: check.forces.odds });
      }
      for (const [, target] of [...best].sort((p, q) => (p[0] < q[0] ? -1 : 1))) {
        const armyBefore = totalArmy(s.war, PLAYER_ACTOR_ID);
        const ev = run(s, { kind: 'orderOffensive', systemId: GALAXY.id(target.system) });
        const done = ev?.find((e) => e.kind === 'frontClash');
        if (done?.kind !== 'frontClash') continue;
        logClash(done);
        if (done.company !== undefined) {
          companyClashes++;
          companyMechs += done.company.mechs;
          companyDetachment += done.company.detachment;
          companyKnocked += done.company.knocked;
          companyLost += done.company.lostRecordIds.length;
          // После боя — ремонт и пилоты, как после восстания: рота не ходит в следующий приказ побитой.
          repairStep(s, REVOLT_POLICY);
          crewUp(s);
          if (a.verbose) {
            const c = done.company;
            console.log(`  ${date(s.day)} рота в приказе: ${c.mechs} машин против ${c.detachment}, выбито ${c.knocked}, потеряно ${c.lostRecordIds.length}`);
          }
        }
        orders++;
        battlesAttack++;
        mechsLost += armyBefore - totalArmy(s.war, PLAYER_ACTOR_ID);
        orderOdds += done.odds;
        if (done.outcome === 'captured') {
          orderWins++;
          captured++;
          if (a.verbose) console.log(`  ${date(s.day)} приказ: рота берёт ${done.systemId} у ${done.defender} (силы ${done.odds})`);
        }
      }
    }

    let foughtRevolt = false;
    if (!a.noRevolt) {
      const fought = revoltStep(s, a.verbose);
      if (fought !== null) {
        foughtRevolt = true;
        revoltFights++;
        if (fought.some((e) => e.kind === 'worldRevoltSuppressed')) suppressed++;
      }
    }
    if (a.pirates && !foughtRevolt) {
      const fought = pirateStep(s, a.verbose);
      if (fought !== null) {
        raidFights++;
        if (fought.some((e) => e.kind === 'homeRaidRepelled')) raidsRepelled++;
      }
    }
    if (a.warWork && !foughtRevolt) {
      const w = warWorkStep(s, a.verbose);
      if (w.conquered !== null) warWorkConquered++;
      if (w.events !== null) {
        warWorkFights++;
        if (w.events.some((e) => e.kind === 'contractResolved' && e.result === 'won')) warWorkWon++;
      }
    }
    if (a.lead && a.policy === 'war') leadStep(s, a.noRevolt);
    if (a.garrison) garrisonStep(s, a.verbose);
    if (a.govern) governStep(s, a.verbose);
    pactsSigned += pactStep(s, a.verbose);
    replenish(s);
    garrisonWorldDecades += new Set(
      Object.values(s.garrison.posts)
        .filter((p) => p.arrives <= s.day)
        .map((p) => p.systemId),
    ).size;

    if (Object.keys(s.war.playerWars ?? {}).some((f) => atWarWithPlayer(s.war, s.reputation, f, s.day))) warDecades++;
    if (a.verbose && (s.day - startDay) % 180 === 0) {
      for (const [f, w] of Object.entries(s.war.playerWars ?? {})) {
        console.log(`  ${date(s.day)} война ${f}: счёт ${w.won}:${w.lost}, усталость ${Math.round((w.fatigue ?? 0) * 100)} / ${Math.round((w.foeFatigue ?? 0) * 100)} %`);
      }
    }

    const advanced = advanceAnswering(s, s.day + WAR.front.tickDays, a.joinCoalition);
    const events = advanced.ok ? [...advanced.events] : [];
    a.onEvents?.(s, events);
    for (const e of events) {
      if (e.kind === 'domainTicked') {
        incomeSum += e.income;
        armyUpkeepSum += e.army;
        // По годам (шаг 90, ступень 8): доля армии в доходе фактическая и без скидок — вся армия по полной цене.
        const y = Math.floor((s.day - startDay) / 360);
        const row = (byYear[y] ??= { income: 0, army: 0, full: 0, worlds: 0, ticks: 0 });
        row.income += e.income;
        row.army += e.army;
        row.full += totalArmy(s.war, PLAYER_ACTOR_ID) * WAR.domain.armyUpkeep;
        row.worlds += e.worlds;
        row.ticks++;
      }
      notePeace(e);
      logClash(e);
      if (e.kind === 'realmPolicy') {
        const key = `${e.by.kind}.${e.act.kind}`;
        policyActs[key] = (policyActs[key] ?? 0) + 1;
        if (a.verbose) console.log(`  ${date(s.day)} политика ${key}${e.act.kind === 'peace' ? '' : ` ${e.act.systemId}`}`);
      }
      if (e.kind === 'regimentCommission' && e.employer === PLAYER_ACTOR_ID) {
        hiredCommissions++;
        if (e.won) hiredWins++;
      }
      if (e.kind === 'buildingStarted') buildSpent += e.cost;
      if (e.kind === 'worldDeveloped' && e.owner === PLAYER_ACTOR_ID && e.built) investSpent += developCostAt(s.deltas, e.systemId);
      if (e.kind === 'worldFocus' && e.owner === PLAYER_ACTOR_ID && e.started) investSpent += WAR.focus.cost;
      // Приказ стойки (шаг 88) идёт внутри такта: считается здесь, как бот считает свой приказ в цикле выше.
      if (e.kind === 'frontClash' && e.cost !== undefined) {
        orders++;
        orderOdds += e.odds;
        mechsLost += e.attackerLost;
        if (e.outcome === 'captured') {
          orderWins++;
          captured++;
        }
        if (e.company !== undefined) {
          companyClashes++;
          companyMechs += e.company.mechs;
          companyDetachment += e.company.detachment;
          companyKnocked += e.company.knocked;
          companyLost += e.company.lostRecordIds.length;
          repairStep(s, REVOLT_POLICY);
          crewUp(s);
        }
      }
      if (e.kind === 'domainTicked') buildUpkeep += e.buildings;
      if (e.kind === 'buildingDone') built[e.building] = (built[e.building] ?? 0) + 1;
      if (e.kind === 'buildingsLost') {
        buildingsDemolished += e.lost.length;
        buildingsKept += e.kept.length;
      }
      if (e.kind === 'frontClash') {
        if (e.attacker === PLAYER_ACTOR_ID) battlesAttack++;
        else battlesDefence++;
        if (e.garrison !== undefined) {
          garrisonAttacks++;
          if (e.garrison.withdrew) garrisonWithdrew++;
          else {
            garrisonDetachment += e.garrison.detachment;
            garrisonKnocked += e.garrison.knocked;
            garrisonClashLost += e.garrison.lostRecordIds.length;
            // После боя — ремонт и пилоты, как после приказа: игрок чинит гарнизон той же очередью.
            repairStep(s, REVOLT_POLICY);
            crewUp(s);
          }
          if (a.verbose) {
            const g = e.garrison;
            console.log(
              `  ${date(s.day)} гарнизон на ${e.systemId}: ${g.withdrew ? `${g.mechs} отошёл` : `${g.mechs} против ${g.detachment}, выбито ${g.knocked}, потеряно ${g.lostRecordIds.length}`}, мир ${e.outcome}`,
            );
          }
        }
      }
      if (e.kind === 'garrisonRevoltBattle') {
        garrisonRevoltFights++;
        if (e.won) garrisonRevoltWon++;
        garrisonRevoltLost += e.lostRecordIds.length;
        repairStep(s, REVOLT_POLICY);
        crewUp(s);
        if (a.verbose) console.log(`  ${date(s.day)} гарнизон против восстания на ${e.systemId}: ${e.won ? 'подавлено' : 'отбит'}, потеряно ${e.lostRecordIds.length}`);
      }
      if (e.kind === 'garrisonWithdrawn' && e.reason === 'worldLost') garrisonEvacuated++;
      if (e.kind === 'garrisonLost') garrisonLostMechs += e.recordIds.length;
      if (e.kind === 'realmFrontTally') mechsLost += e.armyBefore - e.armyAfter;
      if (e.kind === 'frontMoved' && e.kindOfMove === 'capture') {
        if (e.attacker === PLAYER_ACTOR_ID) captured++;
        if (e.defender === PLAYER_ACTOR_ID) lost++;
        if (a.verbose && (e.attacker === PLAYER_ACTOR_ID || e.defender === PLAYER_ACTOR_ID)) {
          console.log(`  ${date(s.day)} ${e.attacker} берёт ${e.systemId} у ${e.defender}`);
        }
      }
      if (e.kind === 'worldRevolt') {
        revolts++;
        if (a.verbose) console.log(`  ${date(s.day)} восстание на ${e.systemId} (прежний владелец ${e.formerOwner})`);
      }
      if (e.kind === 'worldSeceded') {
        seceded++;
        if (a.verbose) console.log(`  ${date(s.day)} ${e.systemId} отпал к ${e.to}`);
      }
      if (e.kind === 'diplomacyMoved' && e.under === PLAYER_ACTOR_ID) {
        if (e.move === 'tribute') tributesOnUs++;
        if (e.move === 'war') aiWars++;
        if (e.move === 'war' && e.leader !== undefined) coalitionWars++;
        if (e.move === 'war' && refusedBy.has(e.over)) warsAfterRefusal++;
      }
      // Требования соседей (шаг 89): пришло, ответ бота по правилу `acceptsDemand`.
      // Пираты у дома (шаг 89): прорывы на миры державы и бои гарнизона с вольницей.
      if (e.kind === 'homeRaidPosted') homeRaids++;
      if (e.kind === 'garrisonRaidBattle') {
        garrisonRaidFights++;
        if (e.won) garrisonRaidWon++;
        repairStep(s, REVOLT_POLICY);
        crewUp(s);
      }
      if (e.kind === 'demandIssued') {
        demands++;
        if (a.verbose) console.log(`  ${date(s.day)} требование ${e.from}: дань с ${e.systemId}`);
      }
      if (e.kind === 'demandAnswered') {
        if (e.outcome === 'accepted') demandsAccepted++;
        if (e.outcome === 'refused') {
          demandsRefused++;
          refusedBy.add(e.from);
        }
        if (a.verbose) console.log(`  ${date(s.day)} ответ ${e.from}: ${e.outcome}`);
      }
    }
    worldsMax = Math.max(worldsMax, domainWorlds(s.deltas).length);
    for (const i of domainWorlds(s.deltas)) {
      if (loyaltyPressure(s.deltas, s.war, s.reputation, GALAXY.id(i), s.day) === 'incite') inciteDecades++;
    }
    a.onDecade?.(s);
  }

  const open = Object.values(s.war.playerWars ?? {});
  const decades = Math.max(1, (s.day - startDay) / WAR.front.tickDays);
  const war = syncDomainEconomy(s.war, s.worldSeed, s.deltas, s.company.cbills);
  const result: RealmSeedResult = {
    seed,
    grant: GALAXY.name(g),
    grantor,
    worldsEnd: domainWorlds(s.deltas).length,
    worldsMax,
    captured,
    lost,
    tributesOnUs,
    battlesAttack,
    battlesDefence,
    mechsLost,
    warDecades,
    wars,
    aiWars,
    peaces,
    peacesFree,
    peacesPaid,
    peacesCeded,
    peacesForced,
    warsEnded,
    warDays,
    warsOpen: open.length,
    warOpenDays: open.reduce((sum, w) => sum + (s.day - w.since), 0),
    cashEnd: s.company.cbills,
    netPerDecade: (s.company.cbills - cashStart + armySpent + buildSpent + investSpent) / decades,
    armyEnd: totalArmy(war, PLAYER_ACTOR_ID),
    armyCapEnd: realmArmyCap(s.deltas, war.economy[PLAYER_ACTOR_ID]?.capacity ?? 0).total,
    armyBought,
    grantorStanding: standingOf(s.reputation, grantor),
    realmLost,
    orders,
    orderWins,
    orderOdds,
    revolts,
    revoltFights,
    suppressed,
    seceded,
    loyaltyEnd: meanLoyalty(s),
    companyClashes,
    companyMechs,
    companyDetachment,
    companyKnocked,
    companyLost,
    garrisonAttacks,
    garrisonWithdrew,
    garrisonDetachment,
    garrisonKnocked,
    garrisonClashLost,
    garrisonRevoltFights,
    garrisonRevoltWon,
    garrisonRevoltLost,
    garrisonEvacuated,
    garrisonLostMechs,
    garrisonWorldDecades,
    built,
    buildSpent,
    buildUpkeep,
    buildingsDemolished,
    buildingsKept,
    policyActs,
    investSpent,
    sectorsEnd: s.realm.sectors.length,
    titleEnd: realmTitle(s.deltas)?.id ?? null,
    homeRaids,
    raidFights,
    raidsRepelled,
    garrisonRaidFights,
    garrisonRaidWon,
    demands,
    demandsAccepted,
    demandsRefused,
    warsAfterRefusal,
    incomeSum,
    armyUpkeepSum,
    byYear,
    warWorkFights,
    warWorkWon,
    warWorkConquered,
    hires,
    hireSpent,
    hiredCommissions,
    hiredWins,
    coalitionWars,
    warsNoWin,
    inciteDecades,
    pactsSigned,
  };
  return { result, state: s };
}

/** Средняя лояльность миров роты (у кого поле есть); без миров — 0. */
function meanLoyalty(s: CampaignState): number {
  const values = domainWorlds(s.deltas)
    .map((i) => s.deltas[GALAXY.id(i)]?.loyalty)
    .filter((v): v is number => v !== undefined);
  return values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;
}

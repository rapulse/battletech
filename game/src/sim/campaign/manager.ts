import {
  GALAXY,
  availableContracts,
  availableMechs,
  contractDecadeOf,
  companyThreat,
  decadeOf,
  execute,
  isRefittable,
  itemCost,
  itemKindOf,
  lanceThreat,
  landingQuote,
  findRoute,
  developmentOf,
  marketProfile,
  realmMarketOf,
  mechCapacityOf,
  nextBayStep,
  ownerOf,
  payrollAmount,
  refitPlan,
  replacePartPlan,
  restoreJob,
  sellsClass,
  standingOf,
  zoneRepairPlan,
  type CampaignState,
  type Contract,
  type MechRecord,
  shipboardMechs,
  isGovernor,
} from '../../core/campaign/index.js';
import { ECONOMY } from '../../core/data/index.js';
import type { ZoneId } from '../../core/model/HitZone.js';
import {
  AMMO_FOR_WEAPON,
  validateAssembly,
  type MechAssembly,
} from '../../core/rules/construction.js';
import { HitZone, isVital, ZONE_IDS, zoneFromId } from '../../core/model/HitZone.js';
import { QUALITY_CLASS_IDS, qualityRank, type QualityClass } from '../../core/model/QualityClass.js';
import { WEAR_NODES, recordChassisDef, recordQuality, type WearNode } from '../../core/campaign/mech/MechRecord.js';
import { partCost } from '../../core/campaign/mech/repair.js';
import { advanceAnswering } from './worldEvents.js';

/**
 * Бот-менеджер роты (шаг 13, брифинг п. 7): первая политика, буквально по
 * тексту брифинга — «чинить, если денег больше порога; иначе воевать как
 * есть». Не решает, лететь ли в бой — этим занимается замер (`batch.ts`),
 * менеджер только ставит работы стапеля между контрактами.
 *
 * Порядок работ фиксированный: сперва полевая замена разрушенных
 * (не жизненно важных) зон, потом обычный ремонт зон, потом снятие износа —
 * так деньги в первую очередь идут на то, без чего машина не летит в бой,
 * а не на полировку исправной.
 */
export interface ManagerPolicy {
  readonly repairThreshold: number;
  /**
   * Сколько машин рота держит. Всё сверх — лишние корпуса: их продают целиком,
   * если они на ходу, и разбирают, если нет. Без этого потолка замер меряет
   * склад трофеев, а не экономику: трофеи копятся, платится содержание по
   * тоннажу, и деньги уходят в никуда.
   */
  readonly fleetCap: number;
  /**
   * С каких денег рота решает лететь за снабжением. Заведомо больше цены узла:
   * лететь, чтобы приехать и не купить, — не решение, а трата.
   */
  readonly supplyThreshold: number;
  /** Насколько далеко бот согласен искать лучший рынок. Дальше — уже не снабжение, а переезд. */
  readonly supplyJumps: number;
  /**
   * Во сколько раз оценка противника может превосходить оценку звена, чтобы бот
   * всё-таки взялся (шаг 16, `contracts/threat.ts`). Это и есть «решение
   * отступить» из брифинга, принятое ДО подписи: отступление после подписи
   * стоит неустойки, и разумный наниматель отряда не подписывается под тем,
   * чего не вытянет.
   */
  readonly contractOdds: number;
  /**
   * С каким перевесом бот ВЫВОДИТ звено (шаг 67), в тех же единицах, что
   * `contractOdds`: звено × `sortieOdds` ≥ противник. Не задан —
   * `DEFAULT_SORTIE_ODDS`.
   *
   * Отдельная ручка, потому что с платой за высадку «браться ли» и «каким
   * составом лететь» — разные вопросы. Взяться можно, когда вытянет весь парк;
   * лететь выгодно меньшим составом: каждая машина сверх нормы нанимателя стоит
   * денег, и перевес, при котором бот брал работу (`contractOdds` 0.58 — это
   * отношение 1.7), обошёлся бы в несколько гонораров.
   */
  readonly sortieOdds?: number;
  /**
   * Отношение, выше которого бот не берёт работу ПРОТИВ фракции (шаг 20).
   *
   * Та самая ручка, которой меряется «стоит ли выбор чего-нибудь». Без неё бот
   * берёт самый денежный контракт подряд и к двадцатому разругивается со
   * всеми — и замер показывает не экономику выбора стороны, а её отсутствие.
   * Простейшая политика из плана шага 20, и намеренно простейшая: сложная
   * политика мерила бы саму себя.
   *
   * `null` — не выбирать сторону вовсе. Это контрольный угол замера: с ним
   * видно, чего стоит выбор, — а не только то, как он выглядит.
   */
  readonly loyaltyThreshold: number | null;
}

export function repairStep(state: CampaignState, policy: ManagerPolicy): void {
  // Месяц содержания остаётся в кассе НЕПРИКОСНОВЕННЫМ, и это правка шага 16, а
  // не шага 13. До настоящей оплаты порог `repairThreshold` был единственным
  // тормозом, и по умолчанию он стоял в нуле: рота чинилась досуха, уходила в
  // минус на ближайшей зарплате и записывалась в разорившиеся — при том, что
  // деньги за контракт приходили через неделю. Замер тогда мерил не экономику,
  // а жадность бота. Тот же резерв, что и у найма (`hireForIdleHulls`).
  const reserve = Math.max(policy.repairThreshold, payrollAmount(state.company));
  // Сравнивается ЦЕНА КОНКРЕТНОЙ РАБОТЫ, а не просто остаток: проверка «в кассе
  // больше резерва» пропускала работу дороже разницы, и рота уходила в минус
  // ровно на одну дорогую починку.
  const affords = (cost: number): boolean => state.company.cbills - cost >= reserve;

  for (const record of state.company.mechs) {
    for (const zone of ZONE_IDS) {
      const idx = zoneFromId(zone);
      if (isVital(idx)) continue;
      if (record.condition.zones[idx]?.destroyed && affords(replacePartPlan(record, zone).cost)) {
        execute(state, { kind: 'replacePart', recordId: record.id, zone });
      }
    }

    for (const zone of ZONE_IDS) {
      const idx = zoneFromId(zone);
      if (record.condition.zones[idx]?.destroyed) continue;
      const plan = zoneRepairPlan(record, zone);
      if (plan.jobCount > 0 && affords(plan.cost)) {
        execute(state, { kind: 'repairZone', recordId: record.id, zone });
      }
    }

    for (const node of WEAR_NODES) {
      const job = restoreJob(record, node);
      if (record.wear[node] > 0 && job.possible && affords(job.cost)) {
        execute(state, { kind: 'restoreWorn', recordId: record.id, node });
      }
    }
  }
}

/**
 * Рассадка: свободный (без машины) годный пилот занимает пустующий (без
 * пилота) исправный корпус — трофей или машину, чей пилот выбыл.
 *
 * Не часть брифинга шага 13 буквально, но без неё замер меряет не экономику,
 * а нехватку пилотов: трофеи (`mechs_salvaged` в `batch.ts`) иначе никогда не
 * летят в бой, и рота стопорится на первых же потерянных кокпитах — совсем
 * не то, что должен показать «Замер §6».
 */
export function crewUp(state: CampaignState): void {
  seatFreePilots(state);
  hireForIdleHulls(state);
  seatFreePilots(state);
}

function idleHulls(state: CampaignState): readonly string[] {
  // Гарнизон нанимает себе пилота сам (шаг 86b) — бот сажает и нанимает только на машины корабля.
  return shipboardMechs(state.company, state.garrison)
    .filter(
      (m) =>
        m.pilotId === null &&
        !m.condition.zones[HitZone.Torso]?.destroyed &&
        !m.condition.zones[HitZone.Head]?.destroyed,
    )
    .map((m) => m.id);
}

function seatFreePilots(state: CampaignState): void {
  const hulls = idleHulls(state);
  // Губернатор сектора (шаг 88) в машину не садится — он не свободный пилот.
  const freePilots = state.company.pilots.filter(
    (p) => p.status === 'active' && !isGovernor(state.realm, p.id) && !state.company.mechs.some((m) => m.pilotId === p.id),
  );
  const pairs = Math.min(hulls.length, freePilots.length);
  for (let i = 0; i < pairs; i++) {
    execute(state, { kind: 'assignPilot', recordId: hulls[i]!, pilotId: freePilots[i]!.id });
  }
}

/**
 * Найм под пустующий исправный корпус, пока в кассе остаётся месяц содержания.
 *
 * Как и `crewUp`, не буква брифинга шага 13, а условие того, чтобы замер мерил
 * экономику. Без найма команда `HirePilot` не вызывается ни разу за прогон, а
 * трофейные корпуса копятся неукомплектованными: рота платит за их содержание
 * по тоннажу и не может ими воевать — итог замера получался про нехватку
 * кабин, а не про деньги (найдено при приёмке шага 13).
 */
function hireForIdleHulls(state: CampaignState): void {
  // `seatFreePilots` уже отработал, так что все оставшиеся пустые корпуса —
  // это ровно те, кому пилота в роте не нашлось.
  //
  // НАЙМ ИДЁТ ПОПЫТКАМИ (переработка 2026-09-10), и замер обязан жить по тем же
  // правилам, что игрок: одна попытка раз в две недели, деньги за поиск, отказ
  // ничего не возвращает. Поэтому здесь не «нанять четверых», а «дать
  // объявление, если попытка подошла, и взять того, кто пришёл». Штаб берёт
  // любого: выбирать за игрока замер не должен, а пустой корпус хуже слабого
  // пилота.
  const need = Math.min(idleHulls(state).length, MAX_HIRES_PER_DOWNTIME);
  for (let i = 0; i < need; i++) {
    // Резерв растёт с каждым нанятым (зарплата), поэтому найм сам себя тормозит.
    if (state.company.cbills <= payrollAmount(state.company)) return;
    if (state.recruit === null && !execute(state, { kind: 'searchRecruit', id: freePilotId(state) }).ok) {
      return;
    }
    if (!execute(state, { kind: 'hireRecruit' }).ok) return;
  }
}

/** Больше звена за один простой рота не набирает — это найм, а не мобилизация. */
const MAX_HIRES_PER_DOWNTIME = 4;

function freePilotId(state: CampaignState): string {
  let n = state.company.pilots.length + 1;
  while (state.company.pilots.some((p) => p.id === `наёмник-${n}`)) n++;
  return `наёмник-${n}`;
}

// --- снабжение (шаг 15) -------------------------------------------------------

/**
 * Что рота делает с лишним железом и с деньгами (шаг 15, замер брифинга).
 *
 * Три вопроса, на которые обязан ответить замер, и три ответа здесь:
 *
 * 1. **Доля дохода от продажи трофеев против дохода от контрактов.** Лишние
 *    корпуса продаются целиком, если на ходу, и разбираются, если торс или
 *    голова разрушены, — разобранное потом уходит со склада.
 * 2. **Сколько прыжков рота делает ради покупки.** Если местная лавка не
 *    продаёт класс лучше того, что уже стоит на машинах, а деньги есть, — бот
 *    ищет ближайший рынок, где продают, и летит туда.
 * 3. **Встречается ли мастерский класс за первый игровой год.** Приехав, бот
 *    покупает лучший доступный класс на худшую машину.
 *
 * Порядок именно такой: сперва продать, потом лететь, потом покупать. Иначе
 * рота уезжает за армейским реактором, имея полный трюм непроданных трофеев.
 */
export interface SupplyReport {
  /** Выручка от продажи машин и складских записей. */
  readonly income: number;
  /** Потрачено на повышение класса узлов, переоснащение, покупку машин и цех. */
  readonly spent: number;
  readonly mechsSold: number;
  readonly partsSold: number;
  readonly upgrades: number;
  /** Прыжков, сделанных ради снабжения (не ради контракта). */
  readonly jumps: number;
  readonly transitDays: number;
  /** Поставленных работ переоснащения (шаг 19a). */
  readonly refits: number;
  /** Сколько из `spent` ушло именно в мехлаб — разбивка для замера. */
  readonly refitSpend: number;
  /** Куплено машин целиком (шаг 19a). */
  readonly mechsBought: number;
  /** Ступеней лестницы цеха, оплаченных за этот простой (шаг 19a). */
  readonly bayUpgrades: number;
}

const NOTHING: SupplyReport = {
  income: 0,
  spent: 0,
  mechsSold: 0,
  partsSold: 0,
  upgrades: 0,
  jumps: 0,
  transitDays: 0,
  refits: 0,
  refitSpend: 0,
  mechsBought: 0,
  bayUpgrades: 0,
};

/**
 * Отношение владельца системы, в которой рота стоит, — вход в цены рынка
 * (шаг 20). Зеркало `standingHere` из `commands/execute.ts`: бот обязан видеть
 * ровно те цены, по которым команда с него возьмёт деньги.
 */
function standingHere(state: CampaignState): number {
  return standingOf(state.reputation, ownerOf(state.deltas, GALAXY.require(state.systemId)));
}

/** Худшая машина роты по классу узлов: её и улучшают первой. */
function weakestMech(state: CampaignState): MechRecord | undefined {
  let worst: MechRecord | undefined;
  let worstRank = Number.POSITIVE_INFINITY;
  for (const m of shipboardMechs(state.company, state.garrison)) {
    const q = recordQuality(m);
    const rank = Math.min(qualityRank(q.reactor), qualityRank(q.frame));
    if (rank < worstRank) {
      worstRank = rank;
      worst = m;
    }
  }
  return worst;
}

/** Лучший класс, который продают в этой системе, — независимо от того, по карману ли он. */
function bestClassOnSale(state: CampaignState): QualityClass | null {
  const profile = marketProfile(
    state.worldSeed,
    state.systemId,
    standingHere(state),
    developmentOf(state.deltas, state.systemId),
    realmMarketOf(state.deltas, state.systemId),
  );
  for (let i = QUALITY_CLASS_IDS.length - 1; i >= 0; i--) {
    const cls = QUALITY_CLASS_IDS[i] as QualityClass;
    if (sellsClass(profile, cls)) return cls;
  }
  return null;
}

/**
 * Лучший класс, который тут продают И который рота может себе позволить,
 * оставив месяц содержания в резерве.
 *
 * Без проверки на кошелёк бот раз за разом заказывал мастерский реактор,
 * получал отказ по деньгам и не покупал вообще ничего: замер показывал
 * «лестница классов не работает» там, где не работал бот (найдено на первом
 * прогоне шага 15).
 */
function affordableClassOnSale(
  state: CampaignState,
  record: MechRecord,
  node: WearNode,
): QualityClass | null {
  const profile = marketProfile(
    state.worldSeed,
    state.systemId,
    standingHere(state),
    developmentOf(state.deltas, state.systemId),
    realmMarketOf(state.deltas, state.systemId),
  );
  const budget = state.company.cbills - payrollAmount(state.company);
  for (let i = QUALITY_CLASS_IDS.length - 1; i >= 0; i--) {
    const cls = QUALITY_CLASS_IDS[i] as QualityClass;
    if (!sellsClass(profile, cls)) continue;
    if (Math.round(partCost(record, node, cls) * profile.priceFactor) <= budget) return cls;
  }
  return null;
}

/**
 * Ближайший рынок, где продают класс лучше здешнего.
 *
 * Поиск в ширину по соседям, а не по всей карте: две тысячи маршрутов ради
 * одного решения бота — это не замер, а профилирование A*.
 */
function nearestBetterMarket(state: CampaignState, want: QualityClass, maxJumps: number): number | null {
  const here = GALAXY.require(state.systemId);
  const seen = new Set<number>([here]);
  let frontier: number[] = [here];

  for (let depth = 0; depth < maxJumps; depth++) {
    const next: number[] = [];
    for (const i of frontier) {
      for (const j of GALAXY.neighbors(i)) {
        if (seen.has(j)) continue;
        seen.add(j);
        next.push(j);
        // Развитие мира (шаг 23) меняет класс рынка, а значит и то, что там
        // продают: искать по каноническому профилю значило бы лететь за
        // реактором в мир, который его больше (или ещё) не делает.
        const id = GALAXY.id(j);
        if (sellsClass(marketProfile(state.worldSeed, id, 0, developmentOf(state.deltas, id), realmMarketOf(state.deltas, id)), want)) {
          return j;
        }
      }
    }
    frontier = next;
  }
  return null;
}

// --- мехлаб, цех и покупка машин (шаг 19a) -------------------------------------

/**
 * Что бот делает с мехлабом.
 *
 * Замеру нужен ответ ровно на один вопрос: **есть ли у денег второй сток.**
 * Шаг 16 показал, что нет, — `supply_share` в половину дохода набегала оттого,
 * что боту некуда было деть кассу, кроме класса узлов. Поэтому политика тут
 * намеренно простая и одна: **доукомплектовать свои машины тем, что лежит на
 * складе**, вместо того чтобы это продать.
 *
 * Это и есть буква решения шага 16a: недокомплект — не поломка, ремонт его не
 * лечит, лечит переоснащение. Стартовая рота выходит с неполной бронёй и без
 * части навески, трофеи приходят такими же, и до этого шага исправить их было
 * нечем.
 *
 * Чего бот СОЗНАТЕЛЬНО не делает: не пересобирает машину под роль, не считает
 * тепло против залпа, не выбирает между двумя стволами по дальности. Это
 * решения игрока, и подменять их жадным перебором значило бы мерить не
 * экономику, а качество перебора.
 */
function fillFromWarehouse(state: CampaignState, record: MechRecord): MechAssembly | null {
  const free = state.company.warehouse.filter(
    (w): w is Extract<typeof w, { sort: 'item' }> => w.sort === 'item',
  );
  if (free.length === 0 && !underArmored(record)) return null;

  let target: MechAssembly = record.assembly;
  const used = new Set<string>();

  // 1. Навеска: ставим со склада всё, что влезает по массе и ячейкам. Порядок —
  //    от тяжёлого к лёгкому: тяжёлое влезает только пока масса свободна.
  const byWeight = [...free].sort((a, b) => itemCost(b.itemId) - itemCost(a.itemId));
  for (const entry of byWeight) {
    if (used.has(entry.id)) continue;
    const placed = placeItem(target, entry.itemId);
    if (placed !== null) {
      target = placed;
      used.add(entry.id);
    }
  }

  // 2. Броня: доливаем до потолка корпуса, сколько позволяет оставшаяся масса.
  //    Ровно то, чего не умеет ремонт: он доводит до паспорта, а паспорт у
  //    недоукомплектованной машины и есть неполный.
  target = topUpArmor(target);

  return sameAssembly(record.assembly, target) ? null : target;
}

/** Несёт ли машина брони меньше, чем держит корпус. */
function underArmored(record: MechRecord): boolean {
  const report = validateAssembly(record.assembly);
  return report.totalArmor < report.maxArmor && report.freeMass > 0;
}

function sameAssembly(a: MechAssembly, b: MechAssembly): boolean {
  if (a.armorTons !== b.armorTons || a.items.length !== b.items.length) return false;
  const key = (x: MechAssembly): string =>
    x.items.map((it) => `${it.id}@${it.zone}`).sort().join(',');
  return key(a) === key(b);
}

/**
 * Поставить установку в первую зону, где она помещается.
 *
 * Годность решает `validateAssembly`, а не свой счёт слотов: правила сборки
 * живут в одном месте, и бот не имеет права знать их отдельно (то же правило,
 * по которому бот боя не считает попадание сам).
 */
function placeItem(assembly: MechAssembly, itemId: string): MechAssembly | null {
  const kind = itemKindOf(itemId);
  for (const zone of REFIT_ZONES) {
    const items = [...assembly.items, { id: itemId, kind, zone }];
    // Орудию нужна своя пачка: без неё сборка не пройдёт валидатор.
    const ammoId = AMMO_FOR_WEAPON[itemId];
    const withAmmo =
      ammoId !== undefined && !items.some((it) => it.id === ammoId)
        ? [...items, { id: ammoId, kind: 'ammo' as const, zone: 'torso' as const }]
        : items;
    const candidate: MechAssembly = { ...assembly, items: withAmmo };
    if (validateAssembly(candidate).valid) return candidate;
  }
  return null;
}

/** Зоны в порядке предпочтения: руки под оружие, корпус и ноги под остальное. */
const REFIT_ZONES: readonly ZoneId[] = ['rightArm', 'leftArm', 'torso', 'rightLeg', 'leftLeg', 'head'];

/** Долить брони до потолка корпуса, насколько хватает свободной массы. */
function topUpArmor(assembly: MechAssembly): MechAssembly {
  let best = assembly;
  for (let n = 0; n < 40; n++) {
    const candidate: MechAssembly = { ...best, armorTons: Math.round((best.armorTons + 0.25) * 100) / 100 };
    const report = validateAssembly(candidate);
    if (!report.valid) break;
    best = candidate;
    if (report.totalArmor >= report.maxArmor) break;
  }
  return best;
}

/**
 * Переоснащение между контрактами: поставить в цех то, что реально меняет
 * машину. Работает только по исправным машинам — это правило ядра
 * (`company/refit.ts`), а не выбор бота.
 */
export function refitStep(state: CampaignState, policy: ManagerPolicy): { readonly spent: number; readonly refits: number } {
  const reserve = Math.max(policy.repairThreshold, payrollAmount(state.company));
  let spent = 0;
  let refits = 0;

  for (const record of [...state.company.mechs]) {
    if (!isRefittable(record)) continue;
    const target = fillFromWarehouse(state, record);
    if (target === null) continue;

    const plan = refitPlan(state.company, record, target);
    if (!plan.valid) continue;
    if (state.company.cbills - plan.cost < reserve) continue;

    const before = state.company.cbills;
    if (execute(state, { kind: 'refitMech', recordId: record.id, assembly: target }).ok) {
      spent += before - state.company.cbills;
      refits += 1;
    }
  }
  return { spent, refits };
}

/**
 * Расширение цеха — когда цех действительно стал узким местом.
 *
 * Условие ровно одно и оно проверяемое: **все стапели заняты**. Покупать
 * ступень «просто потому, что деньги есть» бот не будет — иначе замер покажет
 * не то, нужна ли лестница, а то, что у бота остались деньги.
 *
 * Зовётся ПОСЛЕ `repairStep` и `refitStep`, а не вместе со снабжением, и это
 * найдено первым же прогоном шага 19a: до постановки работ очередь пуста
 * всегда — простой на то и простой, — и «все стапели заняты» не срабатывало ни
 * разу за 70 кампаний. Загруженность цеха видна только сразу после того, как
 * рота попыталась поставить в него всё, что нужно.
 */
export function bayStep(state: CampaignState, policy: ManagerPolicy): { readonly spent: number; readonly upgrades: number } {
  const busy = new Set(
    state.queue.filter((e) => e.task.kind === 'repairJob').map((e) => (e.task as { recordId: string }).recordId),
  );
  if (busy.size < state.company.bays) return { spent: 0, upgrades: 0 };

  // Резерв тот же, что у ремонта, а не порог снабжения: ступень покупается уже
  // ПОСЛЕ того, как рота оплатила весь цех этого простоя, и требовать сверх
  // этого ещё и полный порог вылета за классом значило бы не покупать её
  // никогда (первый прогон шага 19a: ноль ступеней за 70 кампаний).
  const reserve = Math.max(policy.repairThreshold, payrollAmount(state.company));
  const before = state.company.cbills;
  // Тот же `nextBayStep`, что у игрока (`execute.ts`): потолок стапелей ограничен
  // классом корабля роты, дублировать эту проверку здесь нельзя — она уже
  // однажды разошлась (лестница росла бы поверх потолка Leopard/Union/Overlord).
  const step = nextBayStep(state.company.bays, state.company.dropship);
  if (step === null || before - step.cost < reserve) return { spent: 0, upgrades: 0 };

  if (!execute(state, { kind: 'upgradeBays' }).ok) return { spent: 0, upgrades: 0 };
  return { spent: before - state.company.cbills, upgrades: 1 };
}

/**
 * Покупка машины целиком — второй сток денег, ради которого шаг 19a и делался.
 *
 * Берётся самая дорогая из тех, что по карману с месяцем содержания в резерве:
 * рота покупает не «что-нибудь», а лучшее, что тянет. Потолок парка — меньшее
 * из `fleetCap` политики и вместимости ангара текущего десантного корабля:
 * без вместимости бот бился бы лбом в `HangarFull` до конца прогона, потому что
 * менеджер сам не покупает более крупный корабль.
 */
export function buyMechStep(state: CampaignState, policy: ManagerPolicy): { readonly spent: number; readonly bought: number } {
  if (state.travel !== null) return { spent: 0, bought: 0 };
  const cap = Math.min(policy.fleetCap, mechCapacityOf(state.company));
  // Гарнизон — парк мира, а не корабля (шаг 86b): потолок считает машины на корабле.
  if (shipboardMechs(state.company, state.garrison).length >= cap) return { spent: 0, bought: 0 };

  const reserve = Math.max(policy.supplyThreshold, payrollAmount(state.company));
  const budget = state.company.cbills - reserve;
  if (budget <= 0) return { spent: 0, bought: 0 };

  const lots = availableMechs(
    state.worldSeed,
    state.systemId,
    state.day,
    boughtHere(state),
    0,
    developmentOf(state.deltas, state.systemId),
    realmMarketOf(state.deltas, state.systemId),
  )
    .filter((lot) => lot.price <= budget)
    .sort((a, b) => b.price - a.price);
  const lot = lots[0];
  if (lot === undefined) return { spent: 0, bought: 0 };

  const before = state.company.cbills;
  if (!execute(state, { kind: 'buyMech', lotId: lot.id }).ok) return { spent: 0, bought: 0 };
  return { spent: before - state.company.cbills, bought: 1 };
}

/** Что уже куплено в этой системе за текущую декаду — зеркало проверки в `execute.ts`. */
function boughtHere(state: CampaignState): readonly string[] {
  const delta = state.deltas[state.systemId];
  if (delta === undefined || delta.boughtDecade !== decadeOf(state.day)) return [];
  return delta.bought ?? [];
}

export function supplyStep(state: CampaignState, policy: ManagerPolicy): SupplyReport {
  if (state.travel !== null) return NOTHING;

  let income = 0;
  let spent = 0;
  let mechsSold = 0;
  let partsSold = 0;
  let upgrades = 0;
  let jumps = 0;
  let transitDays = 0;
  let refits = 0;
  let refitSpend = 0;
  let mechsBought = 0;
  const bayUpgrades = 0;

  // Сводка собирается одной функцией: у шага восемь точек выхода, и переписывать
  // в каждой список из десяти полей значит рано или поздно забыть одно.
  const report = (): SupplyReport => ({
    income,
    spent,
    mechsSold,
    partsSold,
    upgrades,
    jumps,
    transitDays,
    refits,
    refitSpend,
    mechsBought,
    bayUpgrades,
  });

  // 0. ЛОМ. Разрушенный торс или голова не чинятся вовсе (правило шага 13), и
  //    такая запись — не машина, а расходы: содержание по тоннажу платится за
  //    неё так же, как за боевую. Разбор возвращает хотя бы уцелевшие узлы.
  //    Добавлено шагом 16: до настоящей оплаты рота разорялась быстрее, чем
  //    успевала накопить лом, и разницы было не видно — а с контрактами
  //    кампании стали доживать до состояния «три остова в трюме и ни одной
  //    годной машины», из которого бот не выходил вовсе.
  for (const record of [...state.company.mechs]) {
    const zones = record.condition.zones;
    const wreck =
      zones[HitZone.Torso]?.destroyed === true || zones[HitZone.Head]?.destroyed === true;
    if (wreck) execute(state, { kind: 'scrapMech', recordId: record.id });
  }

  // 1. Лишние корпуса. Разбор — работа стапеля, поэтому она просто ставится в
  //    очередь; склад пополнится, когда работа подойдёт по сроку.
  const surplus = shipboardMechs(state.company, state.garrison).length - policy.fleetCap;
  for (let n = 0; n < surplus; n++) {
    const worst = weakestMech(state);
    if (worst === undefined) break;
    const before = state.company.cbills;
    if (execute(state, { kind: 'sellMech', recordId: worst.id }).ok) {
      income += state.company.cbills - before;
      mechsSold += 1;
      continue;
    }
    // Не на ходу — только в разбор.
    if (!execute(state, { kind: 'scrapMech', recordId: worst.id }).ok) break;
  }

  // 1.5. МЕХЛАБ (шаг 19a). Стоит ПЕРЕД продажей склада и не случайно: до этого
  //    шага всё, что не было узлом, рота сбывала скупщику, потому что поставить
  //    его на машину было нечем. Теперь железо сначала пробуют навесить на свои
  //    корпуса — и продают только то, что не пригодилось.
  const refit = refitStep(state, policy);
  spent += refit.spent;
  refitSpend += refit.spent;
  refits += refit.refits;

  // 2. Склад: всё, что не встало на машину, — это деньги, а не имущество.
  for (const entry of [...state.company.warehouse]) {
    const before = state.company.cbills;
    if (execute(state, { kind: 'sellPart', partId: entry.id }).ok) {
      income += state.company.cbills - before;
      partsSold += 1;
    }
  }

  // 2.7. МАШИНА ЦЕЛИКОМ (шаг 19a). Второй сток денег, которого не было до этого
  //    шага: до него единственным применением кассы был класс узлов, и отсюда
  //    росла `supply_share` в половину дохода (замер шага 16).
  const purchase = buyMechStep(state, policy);
  spent += purchase.spent;
  mechsBought += purchase.bought;

  if (state.company.cbills < policy.supplyThreshold) {
    return report();
  }

  // 3. Лететь или покупать. Класс лучше того, что уже стоит, — единственный
  //    повод трогаться с места: ехать за тем же самым бессмысленно.
  const weakest = weakestMech(state);
  if (weakest === undefined) return report();

  const q = recordQuality(weakest);
  const node: WearNode = qualityRank(q.reactor) <= qualityRank(q.frame) ? 'reactor' : 'frame';
  const have = qualityRank(q[node]);
  const onSale = bestClassOnSale(state);

  if (onSale === null || qualityRank(onSale) <= have) {
    const want = QUALITY_CLASS_IDS[Math.min(QUALITY_CLASS_IDS.length - 1, have + 1)] as QualityClass;
    const target = nearestBetterMarket(state, want, policy.supplyJumps);
    if (target !== null) {
      const route = findRoute(GALAXY.require(state.systemId), target);
      const before = state.company.cbills;
      if (route !== null && execute(state, { kind: 'travel', systemId: GALAXY.id(target) }).ok) {
        spent += before - state.company.cbills;
        jumps += route.jumps;
        transitDays += route.days;
        advanceAnswering(state, state.day + route.days);
      }
    }
    return report();
  }

  const buy = affordableClassOnSale(state, weakest, node);
  if (buy === null || qualityRank(buy) <= have) {
    return report();
  }

  const before = state.company.cbills;
  if (execute(state, { kind: 'upgradeClass', recordId: weakest.id, node, targetClass: buy }).ok) {
    spent += before - state.company.cbills;
    upgrades += 1;
  }
  return report();
}

// --- работа (шаг 16) ----------------------------------------------------------

/**
 * Полная политика бота по контрактам (брифинг шага 16, п. 5): оценка контракта
 * по риску и оплате, решение чинить или лететь, решение отступить.
 *
 * «Решение отступить» здесь принимается ДО подписи, и это не уклонение от
 * брифинга, а следствие его же экономики: отступление после подписи стоит
 * неустойки (`AbandonContract`), а мид-боевого выхода из боя в правилах Части 1
 * нет и не заводится этим шагом (условия победы — параметр боя, шаг 19). Что
 * бот действительно умеет — не браться за то, чего не вытянет, и уйти с поля,
 * не добив противника: ничья по потолку ходов читается как организованный
 * отход (`commands/execute.ts::contractResultOf`).
 */

/** Машины, годные к вылету: целы в торсе и голове, с пилотом в строю. */
export function readyMechs(state: CampaignState): readonly MechRecord[] {
  const active = new Set(state.company.pilots.filter((p) => p.status === 'active').map((p) => p.id));
  // Гарнизон в контракт не идёт (шаг 86b).
  return shipboardMechs(state.company, state.garrison).filter(
    (m) =>
      m.pilotId !== null &&
      active.has(m.pilotId) &&
      !m.condition.zones[HitZone.Torso]?.destroyed &&
      !m.condition.zones[HitZone.Head]?.destroyed,
  );
}

/**
 * Звено на вылет: самые тяжёлые из годных, не больше того, что поднимает корабль.
 *
 * Тяжёлые вперёд — не жадность, а то же правило калибровки, что и у потолка
 * тоннажа противника: он считается по САМОЙ ТЯЖЁЛОЙ машине звена, и выводить
 * лёгкую четвёрку при тяжёлой машине в ангаре значило бы драться против её же
 * веса без неё самой.
 *
 * Потолок — вместимость судна, а не `lanceSize` (шаг 44-0). Замер, выводящий
 * четвёрку при купленном Юнионе, мерил бы игру, которой нет: масштаб вылета —
 * это то, ЧТО ИМЕННО шаг 44 и меняет, и слепое к нему мерило показало бы
 * «ничего не изменилось» при любой правке.
 */
export function chooseLance(state: CampaignState): readonly MechRecord[] {
  return [...readyMechs(state)]
    .sort((a, b) => recordChassisDef(b).tons - recordChassisDef(a).tons)
    .slice(0, mechCapacityOf(state.company));
}

/**
 * Звено на вылет по этой работе (шаг 67): наименьшая голова списка «тяжёлые
 * вперёд», что проходит порог вылета бота (`sortieOdds`).
 *
 * Пока высадка была бесплатной, бот выводил всё, что поднимает корабль, — и был
 * прав. С платой сверх нормы нанимателя лишняя машина стоит денег, и бот,
 * выводящий всех, мерил бы обеднение роты, которого у живого игрока не будет:
 * игрок видит цену в окне высадки и собирает звено меньше. Порог вылета —
 * свой (`sortieOdds`, пояснение у поля): браться за работу и лететь на неё
 * меньшим составом — разные решения. Не проходит и полное звено — выводится
 * полное.
 */
export function chooseSortie(state: CampaignState, policy: ManagerPolicy, contract: Contract): readonly MechRecord[] {
  const all = chooseLance(state);
  const theirs = companyThreat(contract);
  const odds = policy.sortieOdds ?? DEFAULT_SORTIE_ODDS;
  // Два порядка набора: тяжёлые вперёд (меньше машин) и лёгкие вперёд (меньше
  // перевеса). Против одиночного лёгкого пирата первый выводит тяжёлую машину и
  // платит за перевес, второй — лёгкую, и так поступил бы игрок, видящий цену.
  // Из годных по порогу берётся самый дешёвый вылет.
  const light = [...readyMechs(state)]
    .sort((a, b) => recordChassisDef(a).tons - recordChassisDef(b).tons)
    .slice(0, all.length);
  let best: readonly MechRecord[] | null = null;
  let bestFee = Infinity;
  for (const order of [all, light]) {
    for (let k = 1; k <= order.length; k++) {
      const sub = order.slice(0, k);
      if (lanceThreat(state.company, sub) * odds < theirs) continue;
      const fee = landingQuote(contract, sub, state.mode).fee;
      if (fee < bestFee || (fee === bestFee && best !== null && sub.length < best.length)) {
        best = sub;
        bestFee = fee;
      }
      break;
    }
  }
  return best ?? all;
}

/**
 * Умолчание `sortieOdds`: звено выводится при отношении сил от 1.0 — там плата
 * за высадку пятая часть гонорара. Выбрано замером шага 67 (`pnpm camp`, 70 × 20)
 * из трёх порогов: 1.0 — 5.76 выполненных контрактов, 1.25 (от 0.8) — 5.31,
 * 0.58 (от 1.7, прежняя осторожность) — 4.57.
 */
export const DEFAULT_SORTIE_ODDS = 1.0;

/**
 * Гонорар работы за вычетом платы за высадку того звена, что бот на неё выведет.
 * `null` — плату не потянуть: такой работы для бота нет.
 */
function netPayout(state: CampaignState, policy: ManagerPolicy, offer: Contract): number | null {
  const fee = landingQuote(offer, chooseSortie(state, policy, offer), state.mode).fee;
  if (fee > state.company.cbills) return null;
  return offer.payout - fee;
}

/**
 * Куда лететь за работой (шаг 21b).
 *
 * **Без этого шага замер не видит того, ради чего 21b делается.** Тикер сдвинул
 * биржу туда, где идёт война: на горячей границе работы больше, она тяжелее и
 * платят за неё вдвое (`contracts/board.ts`). Но бот до сих пор трогался с места
 * только за КЛАССОМ УЗЛА на рынке (`supplyStep`), а работу брал ту, что нашлась
 * под ногами, — и потому девять контрактов из десяти брал против пиратов,
 * стоя в тылу, где другой работы просто нет. Замер шага 20 назвал это прямо:
 * работа не против пиратов есть только в 31 % систем, и виной тому не фронт, а
 * география.
 *
 * Это не подкрутка бота ради красивых чисел, а починка мерила: наёмник, который
 * не летит туда, где платят вдвое, — не мерило кампании про наёмника. Правило
 * при этом остаётся простейшим, как и вся политика бота: **лететь, если лучшая
 * посильная работа в пределах досягаемости окупает дорогу**. Сложная политика
 * мерила бы саму себя.
 */
export function workStep(state: CampaignState, policy: ManagerPolicy): { jumps: number; days: number; spent: number } {
  const idle = { jumps: 0, days: 0, spent: 0 };
  if (state.travel !== null || state.contract !== null) return idle;

  const lance = chooseLance(state);
  if (lance.length === 0) return idle;
  const ours = lanceThreat(state.company, lance) * policy.contractOdds;

  const here = GALAXY.require(state.systemId);
  const hereBest = bestPayoutAt(state, policy, here, ours);

  // Обход в ширину на ту же дальность, на которую бот летает за узлами: две
  // дальности означали бы две разные политики перелёта, и объяснить, почему за
  // реактором рота готова лететь дальше, чем за гонораром, было бы нечем.
  const seen = new Set<number>([here]);
  let frontier: number[] = [here];
  let bestScore = hereBest;
  let bestTarget: number | null = null;

  for (let depth = 0; depth < policy.supplyJumps; depth++) {
    const next: number[] = [];
    for (const i of frontier) {
      for (const j of GALAXY.neighbors(i)) {
        if (seen.has(j)) continue;
        seen.add(j);
        next.push(j);
        const payout = bestPayoutAt(state, policy, j, ours);
        if (payout <= 0) continue;
        const route = findRoute(here, j);
        if (route === null) continue;
        // Дорога вычитается ЦЕЛИКОМ — и прыжки, и содержание за дни в пути:
        // иначе бот гонял бы роту через полсектора за прибавку в пять тысяч.
        const score = payout - route.cost - (payrollAmount(state.company) / ECONOMY.payroll.intervalDays) * route.days;
        if (score > bestScore) {
          bestScore = score;
          bestTarget = j;
        }
      }
    }
    frontier = next;
  }

  if (bestTarget === null) return idle;
  const route = findRoute(here, bestTarget);
  if (route === null) return idle;
  // Месяц содержания остаётся в кассе неприкосновенным — та же дисциплина, что
  // у ремонта и снабжения. Без неё бот улетал за дорогим контрактом на последние
  // деньги и записывался в разорившиеся на ближайшей зарплате, ещё не долетев:
  // замер показал скачок разорений с 0.19 до 0.34 ровно на этом.
  if (state.company.cbills - route.cost < Math.max(policy.repairThreshold, payrollAmount(state.company))) {
    return idle;
  }

  const before = state.company.cbills;
  if (!execute(state, { kind: 'travel', systemId: GALAXY.id(bestTarget) }).ok) return idle;
  advanceAnswering(state, state.day + route.days);
  return { jumps: route.jumps, days: route.days, spent: before - state.company.cbills };
}

/** Лучшая посильная оплата на бирже этой системы. Ноль — брать нечего. */
function bestPayoutAt(
  state: CampaignState,
  policy: ManagerPolicy,
  system: number,
  ours: number,
): number {
  const id = GALAXY.id(system);
  const offers = availableContracts(
    state.worldSeed,
    state.deltas,
    id,
    state.day,
    system === GALAXY.require(state.systemId) ? takenHere(state) : [],
    state.reputation,
    state.war,
  );
  let best = 0;
  for (const offer of offers) {
    if (companyThreat(offer) > ours) continue;
    if (!worthTheSide(state, policy, offer)) continue;
    // Чистыми, за вычетом высадки (шаг 67): лететь за работой, которую съест
    // плата за перевес, незачем.
    const net = netPayout(state, policy, offer);
    if (net !== null && net > best) best = net;
  }
  return best;
}

/**
 * Какой контракт взять.
 *
 * Оценка проста и вся на виду: отсеять то, что не вытянуть (обе стороны в
 * условных машинах, `contracts/threat.ts`), из оставшегося взять самый
 * денежный. Сложнее сейчас незачем — репутация, доступность по типу и рейтинг
 * MRBC приходят шагами 20 и 22, и любая тонкая оценка будет ими переписана.
 *
 * Оценка звена растёт вместе с классом исполнения его машин: рота, поднявшаяся
 * до армейского, берётся за штурмы, за которые не бралась серийной. Это и есть
 * та лестница вверх, ради которой наёмнику вообще нужны деньги.
 */
export function pickContract(state: CampaignState, policy: ManagerPolicy): Contract | null {
  const lance = chooseLance(state);
  if (lance.length === 0) return null;

  const offers = availableContracts(
    state.worldSeed,
    state.deltas,
    state.systemId,
    state.day,
    takenHere(state),
    // Биржа отдаёт то, что этому отряду ВООБЩЕ предложат: порог доступности,
    // потолок по известности, гонорар и аванс по репутации. Без этого замер
    // мерил бы биржу, которой у роты нет.
    state.reputation,
    // Экономика фракций (шаг 21a): без неё замер мерил бы снаряжение противника
    // до этого шага, то есть ровно то, что шаг и меняет.
    state.war,
  );

  const ours = lanceThreat(state.company, lance) * policy.contractOdds;
  let best: Contract | null = null;
  let bestNet = 0;
  for (const offer of offers) {
    if (companyThreat(offer) > ours) continue;
    if (!worthTheSide(state, policy, offer)) continue;
    // Самый денежный — ЧИСТЫМИ, за вычетом высадки звена, которое бот на эту
    // работу выведет (шаг 67). Работа, которую плата съедает целиком, не берётся.
    const net = netPayout(state, policy, offer);
    if (net === null || net <= 0) continue;
    if (best === null || net > bestNet) {
      best = offer;
      bestNet = net;
    }
  }
  return best;
}

/**
 * Стоит ли эта работа ссоры с целью контракта (шаг 20).
 *
 * Отряд не бьёт тех, кто к нему хорошо относится: потерять нанимателя, который
 * платит по повышенному множителю и открывает тяжёлые типы работ, дороже
 * одного гонорара. Ровно это и делает выбор стороны решением, а не строкой в
 * списке.
 */
function worthTheSide(state: CampaignState, policy: ManagerPolicy, offer: Contract): boolean {
  if (policy.loyaltyThreshold === null) return true;
  return standingOf(state.reputation, offer.target) <= policy.loyaltyThreshold;
}

/** Что уже взято в этой системе за текущую декаду биржи — зеркало проверки в `execute.ts`. */
function takenHere(state: CampaignState): readonly string[] {
  const delta = state.deltas[state.systemId];
  if (delta === undefined || delta.takenDecade !== contractDecadeOf(state.day)) return [];
  return delta.taken ?? [];
}

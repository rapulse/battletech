import { FACTION_LIST, GALAXY } from '../galaxy/catalog.js';
import { focusOf, ownerOf, type GalaxyDeltas } from '../galaxy/delta.js';
import { worldProfile } from '../galaxy/profile.js';
import { REPUTATION } from '../reputation/schema.js';
import {
  domainCapitalIndex,
  domainWorldIndexes,
  economyOf,
  fleetOf,
  capitalJumps,
  withEconomy,
  worldContribution,
  worldContributionAt,
  loyaltyMultiplier,
  type WarState,
  type WorldContribution,
} from './economy.js';
import { PLAYER_ACTOR_ID, isPlayerActor } from './actors.js';
import { WAR } from './schema.js';
import { armyPriceFactor } from './buildings.js';

/**
 * Домен игрока (шаг 25, часть C) — миры, которыми владеет рота.
 *
 * **Считается по разрежённой карте дельт, а не по каталогу.** Мир роты — это
 * всегда отклонение от канона (в 3053 году рота не владеет ничем), поэтому
 * запись о нём есть в дельте по построению, и перебирать ради десятка миров две
 * тысячи систем незачем — тем же приёмом, что заживление разорения и упадок.
 *
 * **Доход домена не идёт в `FactionEconomy`.** У роты нет ни военного фонда, ни
 * замысла, ни фронта; у неё есть касса. `makeWarState` при этом молча пропускает
 * мир с незнакомым владельцем, поэтому полный пересчёт экономики фракций и
 * приращение сходятся сами собой: купленный мир перестал вносить вклад обеим
 * сторонам одновременно.
 */
export interface DomainTally {
  readonly worlds: readonly number[];
  readonly income: number;
  readonly upkeep: number;
}

/** Индексы миров роты — в порядке каталога, чтобы такт был воспроизводим. */
export function domainWorlds(deltas: GalaxyDeltas): number[] {
  // Сам обход живёт в `economy.ts`: плечо мира (шаг 27) обязано знать столицу
  // роты, а `domain.ts` импортирует экономику, и обратный импорт замкнул бы
  // кольцо. Здесь — единственный вход для всех остальных.
  return domainWorldIndexes(deltas);
}

/**
 * ДЕЙСТВУЮЩИЕ ЛИЦА ВОЙНЫ (шаг 27, часть C) — фракции каталога и держава игрока.
 *
 * Это и есть `warActors`, которую шаг 25 отложил как абстракцию с одним
 * поведением, а шаг 26 наполовину завёл как `actorWorlds`. Теперь поведений
 * действительно два: у фракции есть запись в `FactionEconomy` всегда, у роты —
 * только пока она чем-то владеет.
 *
 * **Порядок закреплён: сперва каталог, потом рота.** Логистика обходит акторов
 * подряд, и «как получилось» здесь означало бы другой мир на том же сиде после
 * загрузки. Рота дописана В КОНЕЦ по тому же правилу, по которому в конец
 * дописывается любой новый бросок.
 */
export function warActors(deltas: GalaxyDeltas): string[] {
  const out = FACTION_LIST.map((f) => f.id);
  if (domainWorlds(deltas).length > 0) out.push(PLAYER_ACTOR_ID);
  return out;
}

/** Доход и содержание домена за такт — теми же функциями, которыми живут фракции. */
export function domainTally(worldSeed: number, deltas: GalaxyDeltas): DomainTally {
  const worlds = domainWorlds(deltas);
  let income = 0;
  let upkeep = 0;
  for (const i of worlds) {
    const c = worldContributionAt(worldSeed, deltas, i);
    income += c.income;
    upkeep += c.upkeep;
  }
  return { worlds, income, upkeep };
}

/**
 * Сколько миров держит АКТОР — фракция или рота (шаг 26).
 *
 * Единственное место, где два способа считать территорию сводятся вместе, и без
 * него дипломатия роты не работала бы вовсе: у державы игрока нет записи в
 * `FactionEconomy` (`makeWarState` обходит только реестр фракций), поэтому
 * `economyOf(war, 'player').worlds` — всегда ноль, и любой порог вида «сюзерен
 * обязан быть крупнее вассала» отвергал бы роту молча. Нашлось это не игроком и
 * не тестом механики, а перечитыванием кода перед закрытием шага.
 *
 * Это и есть та самая `warActors(state)`, которую шаг 25 отложил как абстракцию
 * с одним поведением. Теперь поведений действительно два, и они разные:
 * территория фракции — сумма, посчитанная приращением; территория роты — длина
 * разрежённого списка дельт.
 */
export function actorWorlds(war: WarState, deltas: GalaxyDeltas, id: string): number {
  return isPlayerActor(id) ? domainWorlds(deltas).length : economyOf(war, id).worlds;
}

/**
 * Цена мира для роты.
 *
 * Считается ОТ ДОХОДА, а не берётся из таблицы качества: сколько тактов мир
 * окупается. Отсюда цена сама следует за качеством мира, его развитием и его
 * разорением — выжженную планету отдают дешевле, и торговаться об этом не с кем.
 */
export function worldPrice(worldSeed: number, deltas: GalaxyDeltas, i: number): number {
  const D = WAR.domain;
  const c = worldContributionAt(worldSeed, deltas, i);
  return Math.max(D.priceMin, Math.round(c.income * D.priceIncomeTicks));
}

/**
 * ЭКОНОМИКА ДЕРЖАВЫ ИГРОКА (шаг 27, часть C) — пересчётом, а не приращением.
 *
 * **Это единственное место во всей войне, где полный пересчёт разрешён, и
 * разрешён он по причине, а не по недосмотру.** Дисциплина приращения
 * (`worldContributionAt` в четырёх точках) существует ровно потому, что две
 * тысячи профилей нельзя считать на каждом такте. Домен роты — 5–40 миров по
 * построению (§2 дорожной карты Части 3), и пересчёт стоит сорока профилей раз
 * в декаду. Взамен исчезает целый род ошибок: забытое приращение расходится с
 * суммой молча и всплывает через двадцать декад разъехавшимся хэшем — здесь
 * расходиться нечему.
 *
 * **Казна — ПРОЕКЦИЯ кассы роты, а не второй кошелёк.** Достаток
 * (`prosperityOf`) выводится из казны и фонда, и без этой строки держава игрока
 * читалась бы нищей всегда: касса лежит в `company.cbills`, куда `WarState` не
 * смотрит. Проекция обновляется каждым тактом и никем не тратится — деньги
 * роты тратит только рука игрока.
 *
 * **Военный фонд роты — только по решению игрока** (проект державы, шаг 2). У
 * фракций фонд — постоянная доля избытка; у роты избыток идёт в кассу, и
 * автоматическое отчисление означало бы, что игра тратит деньги игрока без
 * спроса. Долю назначает команда `setWarBudget` (`WarState.realmWarShare`), а
 * раскладывает и тратит фонд тот же код, что у фракций. Без бюджета напор роты
 * на участке — базовый (`front.ts::pushOf`). Распущенный фонд кладётся в эту
 * проекцию, и такт возвращает его в кассу (`execute.ts::returnRealmFunds`).
 */
export function syncDomainEconomy(
  war: WarState,
  worldSeed: number,
  deltas: GalaxyDeltas,
  cbills: number,
): WarState {
  const worlds = domainWorlds(deltas);
  if (worlds.length === 0 && war.economy[PLAYER_ACTOR_ID] === undefined) return war;

  let income = 0;
  let upkeep = 0;
  let capacity = 0;
  let lift = 0;
  for (const i of worlds) {
    const c = worldContributionAt(worldSeed, deltas, i);
    income += c.income;
    upkeep += c.upkeep;
    capacity += c.capacity;
    lift += c.lift;
  }
  return withEconomy(war, PLAYER_ACTOR_ID, {
    treasury: cbills,
    income,
    upkeep,
    capacity,
    worlds: worlds.length,
    lift: lift + fleetOf(PLAYER_ACTOR_ID),
  });
}

/**
 * СТАЛА ЛИ РОТА ДЕРЖАВОЙ — есть ли у неё хоть один мир (шаг 72c).
 *
 * До шага 72c здесь стояла ступень 2 доступа (четыре мира, известность,
 * надёжность, признание Дома), а до неё мир роты был целью только для набега,
 * и при этом сама рота наступала на соседей с первого мира — асимметрия,
 * найденная вопросом пользователя (`notes.md` §7b). Решение пользователя:
 * промежуточной стадии нет. С первого мира рота — держава: её миры — участки
 * фронта на общих правах, она наступает тем же `frontTick`, и открыта вся
 * дипломатия.
 *
 * Вражда при этом идёт через живую матрицу (шаг 26), а она для наёмника и
 * Домов стартует с 0.1 при пороге фронта 0.4: Дом становится врагом, только
 * если отношения испорчены. Пираты (0.6) и кланы (0.5, до конца перемирия
 * Тукайида — набегом) — враги с первого дня.
 */
export function isPlayerRealm(deltas: GalaxyDeltas): boolean {
  return domainWorlds(deltas).length > 0;
}

// --- граница домена и цены шагов державы (шаг 72) ----------------------------------

/** Граничит ли система хотя бы с одним миром роты. */
export function nextToDomain(deltas: GalaxyDeltas, i: number): boolean {
  for (const j of GALAXY.neighbors(i)) {
    if (ownerOf(deltas, j) === PLAYER_ACTOR_ID) return true;
  }
  return false;
}

/**
 * Соседи домена: чужие миры в одном прыжке от миров роты, по владельцу.
 *
 * Это и есть круг тех, с кем держава может говорить: договор заключают с
 * соседом, дань требуют с соседнего мира. Порядок закреплён — владельцы по
 * имени, миры по каталогу, — чтобы экран не мигал строками от прокрутки суток.
 */
export function domainBorder(
  deltas: GalaxyDeltas,
): readonly { readonly owner: string; readonly systems: readonly number[] }[] {
  const by = new Map<string, Set<number>>();
  for (const i of domainWorlds(deltas)) {
    for (const j of GALAXY.neighbors(i)) {
      const owner = ownerOf(deltas, j);
      if (owner === PLAYER_ACTOR_ID) continue;
      let set = by.get(owner);
      if (set === undefined) by.set(owner, (set = new Set<number>()));
      set.add(j);
    }
  }
  return [...by.keys()]
    .sort()
    .map((owner) => ({ owner, systems: [...(by.get(owner) as Set<number>)].sort((a, b) => a - b) }));
}

/**
 * Цена дипломатического шага: столько тактов дохода мира, о котором идёт речь.
 *
 * Цены отданы наружу (шаг 72), чтобы экран державы показывал ту же сумму, какую
 * спишет команда: до того формула жила в `execute.ts` частной функцией, и экрану
 * оставалось бы переписать её себе.
 */
function diplomacyPrice(worldSeed: number, deltas: GalaxyDeltas, i: number, ticks: number): number {
  const income = worldContributionAt(worldSeed, deltas, i).income;
  return Math.max(WAR.domain.priceMin / 10, Math.round(income * ticks));
}

/** Столица роты (`economy.ts::domainCapitalIndex`); без миров цены шагов державы нет. */
function domainCapital(deltas: GalaxyDeltas): number {
  const cap = domainCapitalIndex(deltas);
  if (cap === undefined) throw new Error('domain: у роты нет миров, цена шага державы не определена');
  return cap;
}

/**
 * С какого дня столицу можно перенести снова (шаг 72b): полгода после
 * прошлого переноса. `undefined` — хоть сегодня: столицу не переносили, или
 * перенесённую столицу рота потеряла и столицей снова стал первый мир.
 */
export function capitalMoveReadyDay(deltas: GalaxyDeltas): number | undefined {
  const cap = domainCapitalIndex(deltas);
  if (cap === undefined) return undefined;
  const since = deltas[GALAXY.id(cap)]?.realmCapitalSince;
  return since === undefined ? undefined : since + WAR.domain.capitalMoveCooldownDays;
}

/** Договор с соседом — от дохода столицы роты. */
export function pactPrice(worldSeed: number, deltas: GalaxyDeltas): number {
  return diplomacyPrice(worldSeed, deltas, domainCapital(deltas), REPUTATION.diplomacy.pactCostTicks);
}

/** Дань — наложить на мир соседа или выкупить со своего: от дохода этого мира. */
export function tributePrice(worldSeed: number, deltas: GalaxyDeltas, i: number): number {
  return diplomacyPrice(worldSeed, deltas, i, REPUTATION.diplomacy.tributeCostTicks);
}

/** Протекторат — от дохода столицы роты. */
export function protectoratePrice(worldSeed: number, deltas: GalaxyDeltas): number {
  return diplomacyPrice(worldSeed, deltas, domainCapital(deltas), REPUTATION.diplomacy.protectorateCostTicks);
}

/**
 * Поставить в строй `mechs` машин полевой армии — по цене машины фракций; заводы державы (шаг 87) её режут
 * (`buildings.ts::armyPriceFactor`).
 */
export function regimentPrice(mechs: number, deltas: GalaxyDeltas): number {
  return Math.round(mechs * WAR.economy.mechCost * armyPriceFactor(deltas));
}

/**
 * Что мир давал бы державе роты, стань он её (проект державы, шаг 1): доход и содержание с плечом
 * от столицы роты — теми же формулами, что такт домена. Нужно карточке системы до того, как мир
 * взят: в пробе первый мир под лен оказался убыточным, а экран об этом молчал (24 % не-столичных
 * миров Домов в убытке даже без плеча). Державы ещё нет — мир станет столицей, плечо ноль.
 */
export function realmOutlook(worldSeed: number, deltas: GalaxyDeltas, i: number, loyalty: number): WorldContribution {
  const profile = worldProfile(worldSeed, deltas, i);
  const id = GALAXY.id(i);
  const c = worldContribution(
    profile,
    GALAXY.hasFlag(i, 'capital'),
    deltas[id]?.ruined ?? 0,
    focusOf(deltas, id, profile.naturalFocus),
    capitalJumps(deltas, i, PLAYER_ACTOR_ID),
  );
  // Стартовая лояльность по способу получения (шаг 85) — тем же множителем, что `worldContributionAt`.
  const loyal = loyaltyMultiplier(loyalty);
  return { ...c, income: Math.round(c.income * loyal), capacity: Math.round(c.capacity * loyal) };
}

/** Сколько возвращает роспуск `mechs` машин: половину цены (`executeRaiseRegiment`) — с той же скидкой заводов. */
export function regimentRefund(mechs: number, deltas: GalaxyDeltas): number {
  return Math.round(regimentPrice(mechs, deltas) / 2);
}

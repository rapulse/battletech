import { factionPairKey } from '../contracts/relations.js';
import { FACTIONS, FACTION_LIST, GALAXY } from '../galaxy/catalog.js';
import { focusOf, ownerOf, tributeOf, withDelta, type GalaxyDeltas } from '../galaxy/delta.js';
import { worldProfile, type SystemProfile } from '../galaxy/profile.js';
import type { WorldFocus } from '../galaxy/schema.js';
import { liveEnemiesOf, liveEnmity, type ReputationState } from '../reputation/state.js';
import { actorKind, isPlayerActor } from './actors.js';
import { logisticsTick, type FrontShares, type TheaterJumps } from './logistics.js';
import { WAR, type SpaceportClass } from './schema.js';
import type { PlayerWars } from './playerWar.js';

/**
 * Экономика фракций (шаг 21a) — бюджет войны.
 *
 * **Часть `CampaignState`, а не выводимая величина**, и по той же причине, что
 * репутация: журнал не хранится (снимок — это состояние, а не список команд,
 * `save.ts`), а пересчёт «с начала времён» сделал бы загруженную кампанию
 * ДРУГОЙ. Меняется только командами и задачами очереди, входит в хэш.
 *
 * Начальные суммы при этом ВЫВОДЯТСЯ из карты один раз, при основании кампании:
 * профиль системы — чистая функция от `(worldSeed, systemId)` и нигде не
 * хранится (`galaxy/profile.ts`), поэтому суммировать две тысячи профилей на
 * каждом такте нельзя. Сумма считается один раз и живёт здесь, а дельты (смена
 * владельца, разорение) правят её приращением — это ловушка, названная в плане
 * шага 21a и решённая ровно так.
 */

/**
 * Экономика одной фракции.
 *
 * Карта фракций ПЛОТНАЯ, в отличие от репутации и дельт, и это осознанно:
 * у каждой фракции экономика есть всегда, а «отличается от начального» здесь
 * не определено — начальное само выводится из карты и у каждого мира своё.
 * Двадцать записей в снимке — не та цена, ради которой стоит городить
 * разрежённость.
 */
export interface FactionEconomy {
  /** Казна, C-Bills. */
  readonly treasury: number;
  /** Доход за такт: со своих миров плюс внетерриториальный (`factions.json` → `income`). */
  readonly income: number;
  /** Содержание за такт: гарнизоны и администрация. */
  readonly upkeep: number;
  /** Сколько миров держит фракция. Знаменатель достатка НА МИР. */
  readonly worlds: number;
  /**
   * Армия: машин в строю (шаг 22c).
   *
   * **Запас, а не вес.** До этого поля сила стороны на участке выводилась из
   * одних денег, и настоящий бой фронта — тридцать шесть выбитых машин — не
   * вычитался ниоткуда: у войны не было убыли. Теперь бой её вычитает, а казна
   * восстанавливает, и круг «накопили → повоевали → потеряли → восстановили»
   * замыкается.
   *
   * Мера та же, что у всех сил в игре, — МАШИНЫ, а не абстрактные очки: их
   * выводит на поле `buildForce`, их же считает бой.
   */
  readonly army: number;
  /**
   * Промышленная мощность (шаг 25, часть B) — сколько машин держава способна
   * построить за декаду.
   *
   * **Пропускная способность, а не склад**, и в этом вся разница. Склад копился
   * бы и позволял разово выставить армию, которую нечем содержать; пропускная
   * способность задаёт ПОТОЛОК И ТЕМП: целевую численность армии и то, как
   * быстро выбитое возвращается в строй.
   *
   * До шага 25 армия считалась от ЧИСЛА миров, и пятнадцать арсенальных миров
   * давали ровно столько же, сколько пятнадцать захолустий. Отсюда же и второе
   * следствие: сожжённый набегом арсенал бьёт по способности восполнять потери
   * НЕМЕДЛЕННО, а не через падение дохода на несколько процентов.
   */
  readonly capacity: number;
  /**
   * ПОДЪЁМНАЯ СИЛА (шаг 27, часть B) — машино-прыжков за декаду.
   *
   * Пятое слагаемое, которое правится приращением наравне с доходом,
   * содержанием и мощностью, и по той же причине: оно сумма по своим мирам, а
   * профиль системы нигде не хранится, поэтому пересчитывать две тысячи миров
   * на каждом такте нельзя.
   *
   * **Единица — машино-прыжок**, и она выбрана так, чтобы расстояние стоило
   * ровно столько, сколько оно стоит: перевезти одну машину на N прыжков —
   * это N машино-прыжков. Отсюда дальний фронт питается медленнее ближнего сам
   * собой, без отдельного множителя расстояния в правиле переброски.
   */
  readonly lift: number;
}

/**
 * Военный фонд по направлениям.
 *
 * **Направление НАПРАВЛЕНО**, и это не то же самое, что пара фракций у
 * репутации. `factionPairKey` (`contracts/relations.ts`) описывает множество:
 * «Курита и Дэвион враждуют» — одно утверждение с двух сторон. Фонд описывает
 * намерение: «Дэвион копит против Куриты» и «Курита копит против Дэвиона» —
 * два разных числа, и вся суть решения 2 записи «Восемь решений по тикеру
 * войны» (кланы копят силы к 3067 году) держится на том, что они разные.
 *
 * Поэтому здесь вложенная карта `откуда → против кого → сколько`, а не плоский
 * ключ пары. Оба уровня разрежённые: направление появляется, когда по нему
 * начинают копить.
 */
export type WarFunds = Readonly<Record<string, Readonly<Record<string, number>>>>;

/**
 * Замысел государства (шаг 23, часть B) — направление главного удара на
 * несколько декад.
 *
 * Лежит здесь, рядом с военным фондом, а не в `plans.ts`, по той же причине,
 * по которой рядом лежат `FactionEconomy` и `WarFunds`: это ЧАСТЬ СОСТОЯНИЯ
 * войны, а `plans.ts` — правила, которые её двигают. Разложи их иначе — и
 * модуль правил стал бы импортировать состояние, а состояние правила, кольцом.
 */
export interface WarPlan {
  /** Против кого объявлено наступление. */
  readonly against: string;
  /**
   * Мир, к которому стягиваются силы. Хранится ИМЕНЕМ, а не индексом каталога:
   * индекс сдвинется при первом же пополнении каталога, и замысел на старом
   * сохранении станет указывать в другую сторону. То же правило, что у сида
   * системы (`galaxy/profile.ts`).
   */
  readonly target: string;
  readonly fromDay: number;
  /** День, после которого наступление выдыхается само. */
  readonly untilDay: number;
  /** Сколько миров уже взято по этому замыслу. Достигнув цели, он закрывается досрочно. */
  readonly taken: number;
}

export type WarPlans = Readonly<Record<string, WarPlan>>;

/**
 * ПРОТЕКТОРАТ (шаг 26, часть B) — вторая ступень подчинения.
 *
 * Разбитая держава признаёт сюзеренитет: сохраняет свои миры, флаг и внутреннее
 * самоуправление, отдаёт долю дохода в военный фонд сюзерена и не воюет ни с
 * ним, ни с его остальными вассалами.
 *
 * Одно поле на актора, и плотности это не создаёт: вассалов на карте единицы,
 * а не сотни. Ключ карты — ВАССАЛ, а не сюзерен: у вассала сюзерен ровно один
 * (вассала вассала не бывает — предохранитель от каскада), а у сюзерена
 * вассалов несколько.
 */
export interface Vassalage {
  readonly suzerain: string;
  readonly sinceDay: number;
}

export type Vassals = Readonly<Record<string, Vassalage>>;

/**
 * ДОГОВОР ПАРЫ (шаг 26, часть B) — третья ступень: перемирие на срок и
 * торговый договор.
 *
 * Ключ — пара (`factionPairKey`), а не направление, и это то же различие, что
 * между враждой и военным фондом: договор описывает ПАРУ целиком («Ляо и Марик
 * не воюют»), фонд описывает намерение одной стороны.
 *
 * У перемирия уже есть работающий прообраз — перемирие Тукайида
 * (`front.truceUntilYear`), глобальный выключатель для пары «кланы — Сфера».
 * Договорное перемирие — то же самое, но на пару и на срок. Сводить Тукайид к
 * его частному случаю шаг 26 сознательно НЕ стал: на глобальном выключателе
 * стоит вся клановая линия и все замеры Части 2.
 */
export interface Pact {
  /** `truce` — пара не воюет; `trade` — обе стороны получают прибавку к доходу. */
  readonly kind: 'truce' | 'trade';
  readonly untilDay: number;
}

export type Pacts = Readonly<Record<string, Pact>>;

/**
 * ТЕАТРЫ (шаг 27, часть A) — полевые полки, стянутые на направление.
 *
 * **Та же форма, что у военного фонда, и тем же ключом**: откуда → против кого
 * → сколько МАШИН. Это и есть ответ на «армия не копится на планете»: она
 * копится на НАПРАВЛЕНИИ, и направление — то, что у войны реально есть, в
 * отличие от точки на карте. Хранить армию по мирам запрещено §6 дорожной
 * карты Части 3: снимок вырос бы с числом миров, а направлений на карте
 * десятки — у фракции 3–6 врагов выше порога вражды.
 *
 * Разрежённость и дисциплина снятия записи — те же, что у `WarFunds`:
 * опустевший театр удаляется, опустевшая строка фракции — тоже.
 */
export type WarTheaters = Readonly<Record<string, Readonly<Record<string, number>>>>;

export interface WarState {
  readonly economy: Readonly<Record<string, FactionEconomy>>;
  readonly funds: WarFunds;
  /**
   * Полевые полки по направлениям (шаг 27, часть A). `FactionEconomy.army`
   * рядом с ними означает уже не всю армию, а РЕЗЕРВ — выход производства,
   * ещё не отправленный на фронт. Правила — `war/logistics.ts`.
   */
  readonly theaters: WarTheaters;
  /**
   * Замыслы государств (шаг 23, часть B): направление главного удара на
   * несколько декад. Карта разрежённая — запись есть, пока наступление
   * объявлено. Разбор — `war/plans.ts`.
   */
  readonly plans: WarPlans;
  /**
   * Протектораты (шаг 26, часть B): кто чей вассал. Карта разрежённая —
   * вассалов на карте единицы. Правила — `war/diplomacy.ts`.
   */
  readonly vassals: Vassals;
  /**
   * Договоры пар (шаг 26, часть B): перемирия и торговые договоры. Карта
   * разрежённая и по построению самоочищающаяся — истёкший договор снимается
   * тактом дипломатии.
   */
  readonly pacts: Pacts;
  /**
   * Войны державы роты с фракциями (шаг 76): с какого дня и какой счёт. Карта
   * разрежённая — без войн поля нет вовсе, и сохранения до шага читаются как
   * держава без войн. Правила — `war/playerWar.ts`.
   */
  readonly playerWars?: PlayerWars;
  /**
   * Доля итога державы роты, которую игрок откладывает в военный фонд (проект державы, шаг 2):
   * 0..1, шаги — `domain.warBudgetSteps`. Нет поля — ноль: игра не тратит деньги игрока без спроса.
   * Раскладка по врагам — та же `placeWarFund`, что у фракций, и напор роты на участках растёт по той
   * же формуле `front.ts::pushOf`.
   */
  readonly realmWarShare?: number;
  /**
   * Память захватов (шаг 83): ключ `захватчик>потерявший`, значение — взятые миры, тающие ×
   * `diplomacy.conquestDecay` за декаду. Из неё угроза (`threat.ts`) и выбор партнёра перемирия на втором
   * фронте. Разрежённая: истаявшая пара снимается.
   */
  readonly conquests: Conquests;
  /**
   * Сработавшие события мира (шаг 84): id → когда и с чем. Событие срабатывает один раз за кампанию,
   * поэтому запись не снимается. Разбор — `war/events.ts`.
   */
  readonly events: WorldEvents;
  /**
   * Пары «клан — Сфера», с которых событие сняло перемирие Тукайида (шаг 84, «Бульдог»): ключ
   * `factionPairKey`, по возрастанию. Глобальный выключатель — `front.truceUntilYear`.
   */
  readonly truceLifted: readonly string[];
  /**
   * Требования соседей к державе роты (шаг 89): открытая карточка и откат по соседям. Разрежённое: без требований
   * поля нет. Правила — `war/demands.ts`.
   */
  readonly demands?: Demands;
}

/** Требование соседа к державе роты (шаг 89): кто, дань с какого мира, с какого дня карточка открыта. */
export interface DemandCard {
  readonly from: string;
  readonly systemId: string;
  readonly day: number;
}

export interface Demands {
  /** Открытая карточка: прокрутка времени стоит, пока игрок не ответит (`answerDemand`). */
  readonly pending?: DemandCard;
  /** Сосед → день последнего требования: откат пары. */
  readonly last: Readonly<Record<string, number>>;
  /**
   * Сосед → день, до которого он не требует дани (шаг 90): мир с державой ставит конец перемирия плюс
   * `demands.afterTruceDays`. Нет записи — тишины нет.
   */
  readonly quiet?: Readonly<Record<string, number>>;
}

export type Conquests = Readonly<Record<string, number>>;

/** Сработавшее событие мира (шаг 84). */
export interface WorldEventRecord {
  readonly day: number;
  /** Карточку ещё не закрыли: прокрутка времени стоит, пока игрок не ответит (`answerEvent`). */
  readonly pending: boolean;
  /** Событие касается державы роты — метка «держава» в сводке. */
  readonly realm: boolean;
  /** Приглашение державы в коалицию: против кого и кто союзники. */
  readonly invite?: { readonly against: string; readonly allies: readonly string[] };
}

export type WorldEvents = Readonly<Record<string, WorldEventRecord>>;

const E = WAR.economy;
const IND = WAR.industry;
const LOG = WAR.logistics;

/**
 * Множитель фокуса из таблицы. Схема требует запись на каждый фокус, поэтому
 * промаха здесь быть не может — приведение нужно только потому, что фокус
 * приходит строкой.
 */
function focusMult(table: unknown, focus: WorldFocus): number {
  return (table as Record<string, number>)[focus] ?? 1;
}

function round(v: number): number {
  return Math.round(v);
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Доход системы за такт.
 *
 * Слагаемые — качество мира, а не факт владения (решение 1): гражданская и
 * военная промышленность, класс космопорта, столичный флаг. Разорение бьёт
 * прямо здесь, множителем `(1 − ruined)`.
 *
 * **Населения отдельным слагаемым нет намеренно.** `industryCivil` в
 * `galaxy/profile.ts` выведена из логарифма населения, и второе слагаемое
 * считало бы его дважды — причём нелинейно: население доходит до восьми
 * миллиардов, и пара столиц перевесила бы сотню обычных миров.
 */
export function systemIncome(
  profile: SystemProfile,
  isCapital: boolean,
  ruined = 0,
  focus: WorldFocus = profile.naturalFocus,
): number {
  const inc = E.income;
  const port = inc.spaceportByClass[profile.spaceport as SpaceportClass] ?? 1;
  const base = inc.perCivil * profile.industryCivil + inc.perMilitary * profile.industryMilitary;
  // Фокус (шаг 25) ПЕРЕРАСПРЕДЕЛЯЕТ: метрополия обращает мир в деньги, крепость
  // и рудник — во что угодно, кроме денег. Округление здесь не косметика: на
  // целом доходе мира стоит сходимость приращения с полным пересчётом, и держать
  // её лучше явным правилом, чем совпадением кратностей в таблице.
  return Math.round(
    base *
      port *
      (isCapital ? inc.capitalBonus : 1) *
      focusMult(IND.focusIncome, focus) *
      (1 - clamp(ruined, 0, 1)),
  );
}

/**
 * Содержание системы за такт.
 *
 * От разорения НЕ зависит, и это половина того, чем разорение вообще страшно
 * фракции: доход с разорённого мира падает, а держать его стоит ровно столько
 * же. Второй половиной будет разорённый гарнизон (21b).
 */
export function systemUpkeep(
  profile: SystemProfile,
  focus: WorldFocus = profile.naturalFocus,
  jumps = 0,
): number {
  // Житница удешевляет содержание СВОЕГО мира, а не соседних. Плановое «дешевле
  // содержание миров в радиусе прыжка» потребовало бы обхода соседей у каждого
  // из двух тысяч миров на каждом такте — ровно того, чего §6 дорожной карты
  // Части 3 велит не делать. Продовольствие местное, и множитель местный.
  //
  // ПЛЕЧО ДО СТОЛИЦЫ — прибавка шага 27, и она СЛАГАЕМОЕ, а не множитель.
  // Множитель удорожал бы дальний мир пропорционально его гарнизону, то есть
  // сильнее всего бил бы по укреплённым окраинам — ровно наоборот тому, что
  // означает расстояние. Возить приходится одно и то же на одно и то же плечо,
  // сколько бы народу на планете ни жило.
  //
  // Этим и закрывается долг §10 `war.md` — «содержание мира плоское: держать
  // 400-й мир стоит как 40-й». Подъёмная сила задаёт ТЕМП переброски, но она не
  // деньги и в прибыльность мира не входит; без этой строки приёмка шага
  // («доля убыточных миров растёт с удалённостью») была бы невыполнима в
  // принципе.
  return Math.round(
    (E.upkeep.perGarrison * profile.garrison + E.upkeep.perWorld) * focusMult(IND.focusUpkeep, focus) +
      LOG.upkeepPerJump * jumps,
  );
}

/**
 * Вклад мира в ПОДЪЁМНУЮ СИЛУ державы (шаг 27, часть B), машино-прыжков за
 * декаду.
 *
 * Выводится из класса космопорта — величины, которая уже лежит в профиле и уже
 * участвует в доходе. Разброс здесь НАМЕРЕННО круче, чем у дохода (10 против
 * 0.8 при 1.35 против 0.75): доход с грунтовой площадки идёт всё равно, а полк
 * с неё не улетит.
 *
 * Разорение бьёт прямо здесь, как и по мощности: сожжённый порт полков не
 * возит. Округления до целого тут НЕТ, в отличие от дохода и мощности, и это
 * не оплошность: подъёмная сила не входит ни в одно приращение, которое
 * сверяется с полным пересчётом побитово, — она пересчитывается той же суммой,
 * и дробный вклад ей ничем не грозит. Округляется итог у фракции.
 */
export function systemLift(profile: SystemProfile, ruined = 0): number {
  const port = LOG.spaceportLift[profile.spaceport as SpaceportClass] ?? 1;
  return port * (1 - clamp(ruined, 0, 1));
}

/**
 * Промышленная мощность мира за такт (шаг 25, часть B).
 *
 * `военпром^qualityPower × вклад фокуса × (1 − разорение)`, **округлённое до
 * целого**.
 *
 * Целое — не косметика. Доход фракции всегда целый по построению (база кратна
 * 20 000, множители кратны 0.05, разорение — тысячным), и ровно на этом стоит
 * тест «приращение сходится с полным пересчётом»: один и тот же мир даёт одно и
 * то же число обоим путям. Дробный вклад развалил бы это молча — сумма
 * округлений не равна округлению суммы.
 *
 * **Недра отдельным слагаемым не входят.** Шаг 24 уже вложил их в
 * `industryMilitary` прибавкой `round(3 × richness)`; второе слагаемое считало
 * бы их дважды. Сырьевой мир получает своё дважды и без того: недра подняли ему
 * военную промышленность, а фокус `mining` весит вчетверо против житницы.
 */
export function systemCapacity(profile: SystemProfile, focus: WorldFocus, ruined = 0): number {
  const mult = focusMult(IND.focusCapacity, focus);
  return Math.round(
    Math.pow(profile.industryMilitary, IND.qualityPower) * mult * (1 - clamp(ruined, 0, 1)),
  );
}

/**
 * Что мир даёт своему владельцу за такт: доход, содержание и мощность разом.
 *
 * Одна функция вместо трёх вызовов в каждом из четырёх мест, где экономика
 * правится приращением (захват, набег, заживление, стройка). Заведена шагом 25
 * не ради краткости: до неё каждое из этих мест перечисляло слагаемые само, и
 * добавить мощность значило четыре раза не забыть — а забытое приращение
 * расходится с пересчётом молча и всплывает через сто декад.
 *
 * **Содержание от разорения НЕ зависит** (решение 6 шага 21b: разорённый мир
 * держать так же дорого), доход и мощность — зависят.
 */
export interface WorldContribution {
  readonly income: number;
  readonly upkeep: number;
  readonly capacity: number;
  /** Подъёмная сила (шаг 27): машино-прыжков за декаду, которые даёт космопорт мира. */
  readonly lift: number;
}

export function worldContribution(
  profile: SystemProfile,
  isCapital: boolean,
  ruined: number,
  focus: WorldFocus,
  jumps = 0,
): WorldContribution {
  return {
    income: systemIncome(profile, isCapital, ruined),
    upkeep: systemUpkeep(profile, profile.naturalFocus, jumps),
    capacity: systemCapacity(profile, focus, ruined),
    lift: systemLift(profile, ruined),
  };
}

/**
 * То же, но мир задан индексом каталога: профиль, разорение и фокус берутся из
 * дельт.
 *
 * Единственное место, которое знает, как сложить «естественный фокус из
 * профиля» с «фокусом из дельты». Все четыре точки приращения зовут её, поэтому
 * разойтись им негде.
 *
 * `focus` задан — ответ «что мир давал бы с этим фокусом» (шаг 72: выбор фокуса
 * на экране державы). Тем же сложением, а не копией его на экране: иначе
 * предпросмотр разошёлся бы с тактом при первой же правке формулы.
 */
export function worldContributionAt(
  worldSeed: number,
  deltas: GalaxyDeltas,
  i: number,
  focus?: WorldFocus,
): WorldContribution {
  const id = GALAXY.id(i);
  const profile = worldProfile(worldSeed, deltas, i);
  const c = worldContribution(
    profile,
    GALAXY.hasFlag(i, 'capital'),
    deltas[id]?.ruined ?? 0,
    focus ?? focusOf(deltas, id, profile.naturalFocus),
    capitalJumps(deltas, i, ownerOf(deltas, i)),
  );
  // Лояльность мира роты (шаг 85) режет доход и мощность; содержание и подъёмная сила — как есть.
  const loyal = loyaltyFactor(deltas, id);
  return loyal === 1 ? c : { ...c, income: Math.round(c.income * loyal), capacity: Math.round(c.capacity * loyal) };
}

/**
 * МНОЖИТЕЛЬ ЛОЯЛЬНОСТИ (шаг 85): `loyalty.mulBase + лояльность × loyalty.mulPerPoint` у мира роты, у
 * остальных — единица. Здесь, а не в `war/loyalty.ts`: вклад мира считает экономика, а модуль лояльности
 * сам зовёт войну роты, и обратный импорт замкнул бы кольцо.
 */
export function loyaltyFactor(deltas: GalaxyDeltas, id: string): number {
  const loyalty = deltas[id]?.loyalty;
  return loyalty === undefined ? 1 : loyaltyMultiplier(loyalty);
}

/** Множитель по самой лояльности — его же зовёт предпросмотр мира до получения (`domain.ts::realmOutlook`). */
export function loyaltyMultiplier(loyalty: number): number {
  const L = WAR.loyalty;
  return Math.min(1, L.mulBase + loyalty * L.mulPerPoint);
}

/**
 * ПЛЕЧО МИРА — сколько прыжков от него до столицы его нынешнего владельца
 * (шаг 27, часть B).
 *
 * Прямая линия `GALAXY.distance`, а не маршрут, и это решение §6 дорожной
 * карты, а не упрощение на скорую руку: `findRoute` — это A\* по каталогу,
 * `jumpDistance` — обход в ширину по всем 2000 системам, а звать плечо
 * приходится на каждый мир при основании кампании и на каждый захват. Прямая
 * линия стоит двух обращений к массивам координат.
 *
 * **Столица берётся у ТЕКУЩЕГО владельца, а не у канонического.** У каталога
 * есть `distanceToCapital(i)`, но она читает `this.owner` — владельца 3053
 * года, — и отнятый мир считал бы плечо до столицы того, кто его потерял.
 *
 * У кого столицы нет (пираты, независимые), плечо равно нулю: у вольницы нет
 * метрополии, из которой она что-то возит, и её миры местные по построению.
 * Держава игрока — исключение, и её столица считается ниже.
 */
export function capitalJumps(deltas: GalaxyDeltas, i: number, owner: string): number {
  const ly = isPlayerActor(owner)
    ? playerCapitalDistance(deltas, i)
    : GALAXY.distanceToCapitalOf(i, owner);
  if (!Number.isFinite(ly)) return 0;
  return Math.min(LOG.jumpsMax, Math.round(ly / GALAXY.jumpRangeLy));
}

/** Расстояние от мира до столицы державы игрока. */
function playerCapitalDistance(deltas: GalaxyDeltas, i: number): number {
  const cap = domainCapitalIndex(deltas);
  return cap === undefined ? 0 : GALAXY.distance(i, cap);
}

/**
 * СТОЛИЦА ДЕРЖАВЫ РОТЫ — единственный ответ на «где столица» для плеча
 * снабжения, логистики и цен дипломатии.
 *
 * Мир роты с меткой `realmCapital` (шаг 76) или с днём переноса
 * `realmCapitalSince` (сохранения шагов 72a–75). Запись на мире, который уже не
 * роты, не действует. Без записи — первый мир роты по каталогу, но это правило
 * живёт только до ближайшей смены состава миров: её закрепляет
 * `withPlayerCapitalPinned`, иначе столица переезжала бы сама на каждый новый мир
 * с меньшим номером.
 */
export function domainCapitalIndex(deltas: GalaxyDeltas): number | undefined {
  const own = domainWorldIndexes(deltas);
  for (const i of own) {
    const d = deltas[GALAXY.id(i)];
    if (d?.realmCapital === true || d?.realmCapitalSince !== undefined) return i;
  }
  return own[0];
}

/**
 * Закрепить столицу роты меткой (шаг 76), если записи ещё нет: первый мир роты
 * получает её при основании державы, а при потере столицы — первый из
 * оставшихся по каталогу. `since` — день последнего переноса потерянной
 * столицы: отсчёт 180 суток идёт от настоящего переноса и не начинается заново.
 * Зовётся везде, где меняется состав миров роты, — до и после.
 */
export function withPlayerCapitalPinned(deltas: GalaxyDeltas, since?: number): GalaxyDeltas {
  const own = domainWorldIndexes(deltas);
  if (own.length === 0) return deltas;
  for (const i of own) {
    const d = deltas[GALAXY.id(i)];
    if (d?.realmCapital === true || d?.realmCapitalSince !== undefined) return deltas;
  }
  return withDelta(deltas, GALAXY.id(own[0] as number), { realmCapital: true, realmCapitalSince: since });
}

/**
 * Миры роты — в порядке каталога.
 *
 * Живёт здесь, а не в `war/domain.ts`, ровно потому, что нужна плечу: `domain.ts`
 * импортирует экономику, и обратный импорт замкнул бы кольцо. `domainWorlds`
 * там оставлена как единственный вход для всех остальных.
 */
export function domainWorldIndexes(deltas: GalaxyDeltas): number[] {
  const out: number[] = [];
  for (const id of Object.keys(deltas)) {
    if (!isPlayerActor(deltas[id]?.owner ?? '')) continue;
    const i = GALAXY.index(id);
    if (i >= 0) out.push(i);
  }
  return out.sort((a, b) => a - b);
}

/** Внетерриториальный доход фракции: монополия на ГПГ, контракты, набеги. */
export function externalIncome(factionId: string): number {
  return FACTIONS.get(factionId)?.income ?? 0;
}

/**
 * Канонический флот актора сверх его космопортов, машино-прыжков за декаду
 * (шаг 27, часть B).
 *
 * По ВИДУ, а не по фракции поимённо: таблица на двадцать строк повторяла бы
 * `factions.json` и расходилась бы с ним при первом же добавлении фракции.
 * Дом возит полки, клан пришёл во Внутреннюю Сферу на своих кораблях, у
 * пиратской вольницы — захваченные транспорты.
 */
export function fleetOf(actorId: string): number {
  const kind = actorKind(actorId);
  if (kind === undefined) return 0;
  return (LOG.fleetByKind as Record<string, number>)[kind] ?? 0;
}

/**
 * Начальная экономика всех фракций: один проход по каталогу.
 *
 * Две тысячи профилей считаются ЗДЕСЬ и больше никогда: дальше суммы правятся
 * приращением. Проход берёт владельца с учётом дельт, поэтому та же функция
 * годится и для пересчёта с нуля в тесте, доказывающем, что приращение не
 * разошлось с суммой.
 */
export function makeWarState(worldSeed: number, deltas: GalaxyDeltas): WarState {
  const income: Record<string, number> = {};
  const upkeep: Record<string, number> = {};
  const worlds: Record<string, number> = {};
  const capacity: Record<string, number> = {};
  const lift: Record<string, number> = {};

  for (const f of FACTION_LIST) {
    income[f.id] = externalIncome(f.id);
    upkeep[f.id] = 0;
    worlds[f.id] = 0;
    capacity[f.id] = 0;
    lift[f.id] = 0;
  }

  for (let i = 0; i < GALAXY.count; i++) {
    const owner = ownerOf(deltas, i);
    // Владелец из дельты — ссылка в реестр акторов, и она проверена при записи.
    // Незнакомое имя здесь означало бы испорченный снимок, а не новую фракцию.
    const known = income[owner];
    if (known === undefined) continue;
    // Профиль берётся С УЧЁТОМ РАЗВИТИЯ (шаг 23) и фокуса (шаг 25): полный
    // пересчёт обязан сходиться с приращением, а приращение оба уже учло.
    const c = worldContributionAt(worldSeed, deltas, i);
    income[owner] = known + c.income;
    upkeep[owner] = (upkeep[owner] as number) + c.upkeep;
    capacity[owner] = (capacity[owner] as number) + c.capacity;
    lift[owner] = (lift[owner] as number) + c.lift;
    worlds[owner] = (worlds[owner] as number) + 1;
  }

  const economy: Record<string, FactionEconomy> = {};
  for (const f of FACTION_LIST) {
    const inc = round(income[f.id] as number);
    const cap = round(capacity[f.id] as number);
    economy[f.id] = {
      treasury: round(inc * E.treasuryStartTicks),
      income: inc,
      upkeep: round(upkeep[f.id] as number),
      worlds: worlds[f.id] as number,
      capacity: cap,
      // Армия отсчитывается от МОЩНОСТИ (шаг 25), а не от числа миров: держать
      // фронт нечем, кроме того, что успевают построить заводы. С шага 27 она
      // же и РЕЗЕРВ: в первый день кампании ни один полк ещё никуда не
      // отправлен, театров нет, и сумма «резерв + театры» равна армии
      // тождественно.
      army: armyTarget(cap),
      // Флот державы — космопорты своих миров плюс канонический флот по виду.
      // Пол по виду здесь ради малых: анклав из пятнадцати миров без него не
      // перебросил бы ничего, а у клана корабли есть независимо от того,
      // сколько планет он занял.
      lift: round((lift[f.id] as number) + fleetOf(f.id)),
    };
  }
  return { economy, funds: {}, theaters: {}, plans: {}, vassals: {}, pacts: {}, conquests: {}, events: {}, truceLifted: [] };
}

// --- чтение -------------------------------------------------------------------

const EMPTY_ECONOMY: FactionEconomy = Object.freeze({
  treasury: 0,
  income: 0,
  upkeep: 0,
  worlds: 0,
  capacity: 0,
  army: 0,
  lift: 0,
});

export function economyOf(war: WarState, factionId: string): FactionEconomy {
  return war.economy[factionId] ?? EMPTY_ECONOMY;
}

/** Сколько фракция накопила ПРОТИВ конкретного противника. */
export function fundOf(war: WarState, from: string, against: string): number {
  return war.funds[from]?.[against] ?? 0;
}

/** Все направления фракции — от крупного к мелкому. Для сводок 21b и для экрана. */
export function fundsOf(war: WarState, from: string): readonly { readonly against: string; readonly amount: number }[] {
  const row = war.funds[from];
  if (row === undefined) return [];
  return Object.keys(row)
    .sort()
    .map((against) => ({ against, amount: row[against] as number }))
    .sort((a, b) => (a.amount !== b.amount ? b.amount - a.amount : a.against < b.against ? -1 : 1));
}

/** Сколько машин фракция держит на направлении против этого врага. */
export function theaterOf(war: WarState, from: string, against: string): number {
  return war.theaters[from]?.[against] ?? 0;
}


/**
 * Все направления фракции — от крупного к мелкому, порядок закреплён явно.
 *
 * Воспроизводимость такта держится на нём: переброска обходит направления
 * подряд, и «как получилось в карте» здесь означало бы другой мир на том же
 * сиде после загрузки.
 */
export function theatersOf(
  war: WarState,
  from: string,
): readonly { readonly against: string; readonly mechs: number }[] {
  const row = war.theaters[from];
  if (row === undefined) return [];
  return Object.keys(row)
    .sort()
    .map((against) => ({ against, mechs: row[against] as number }));
}


/**
 * Вся армия актора: резерв плюс все театры.
 *
 * **Единственная мера, которой можно верить после шага 27.** `eco.army` рядом с
 * театрами означает уже не армию, а резерв, и всякое место, где раньше стояло
 * «сколько у фракции машин», обязано звать эту функцию. Сумма «резерв + театры»
 * — главный инвариант части A: она обязана сходиться до машины на каждом такте,
 * иначе машины начнут тихо появляться и пропадать при переброске, а заметить
 * это можно будет только через двадцать декад по разъехавшемуся хэшу.
 */
export function totalArmy(war: WarState, factionId: string): number {
  let total = economyOf(war, factionId).army;
  const row = war.theaters[factionId];
  if (row !== undefined) for (const k of Object.keys(row)) total += row[k] as number;
  return total;
}


/**
 * Записать театр.
 *
 * Опустевшее направление из карты УДАЛЯЕТСЯ, и опустевшая строка фракции —
 * тоже: та же дисциплина, что у `withFund`, `withStanding` и `withDelta`. Без
 * неё разрежённость протекла бы через первую же законченную войну, и через год
 * игры плотная карта из четырёхсот направлений собралась бы сама.
 */
export function withTheater(war: WarState, from: string, against: string, value: number): WarState {
  if (from === against) return war;
  const mechs = Math.max(0, Math.round(value));
  const prevRow = war.theaters[from];
  const row: Record<string, number> = { ...(prevRow ?? {}) };
  if (mechs === 0) delete row[against];
  else row[against] = mechs;

  const theaters = { ...war.theaters };
  if (Object.keys(row).length === 0) delete theaters[from];
  else theaters[from] = row;
  return { ...war, theaters };
}

/**
 * Убыль полевых полков от боя (шаг 27 вместо `withArmyLoss` шага 22c).
 *
 * **Списывается ТОЛЬКО с театра, и никогда с резерва.** Машины, которых на
 * направлении не было, потерять там нельзя: за них дрались ополчение и
 * планетарная оборона, а их фронт не считает и не хранит. Отсюда же и
 * свойство, которого у прежнего общего пула быть не могло: разбитый театр
 * перестаёт кровоточить, и держава не истекает через одно направление.
 *
 * Пол `armyMinShare`, стоявший в `withArmyLoss`, здесь не нужен и снят: резерв
 * боями не тратится вовсе, поэтому вся армия до нуля не сходится по построению,
 * а оборона мира с разбитым театром держится ополчением (`militiaBacked`).
 */
export function withTheaterLoss(war: WarState, from: string, against: string, lost: number): WarState {
  if (lost <= 0) return war;
  const had = theaterOf(war, from, against);
  if (had <= 0) return war;
  return withTheater(war, from, against, had - Math.min(had, Math.round(lost)));
}

export function planOf(war: WarState, factionId: string): WarPlan | undefined {
  return war.plans[factionId];
}

/**
 * Записать замысел. `undefined` СНИМАЕТ запись, а не оставляет её пустой, — та
 * же дисциплина разрежённости, что у `withFund`, `withDelta` и `withStanding`:
 * без неё через десять лет войны в снимке лежали бы двадцать закрытых замыслов,
 * не несущих ни одного бита.
 */
export function withPlan(war: WarState, factionId: string, plan: WarPlan | undefined): WarState {
  const plans = { ...war.plans };
  if (plan === undefined) delete plans[factionId];
  else plans[factionId] = plan;
  return { ...war, plans };
}

/** Все действующие замыслы — для экрана и для замера. Порядок закреплён именем фракции. */
// --- дипломатия: чтение состояния (шаг 26) --------------------------------------

/** Чей вассал этот актор, или `undefined`. */
export function suzerainOf(war: WarState, id: string): string | undefined {
  return war.vassals[id]?.suzerain;
}

/** Вассалы сюзерена — по имени, чтобы порядок обхода не выдумывался. */
export function vassalsOf(war: WarState, suzerain: string): readonly string[] {
  return Object.keys(war.vassals)
    .filter((id) => war.vassals[id]?.suzerain === suzerain)
    .sort();
}

/**
 * Связаны ли двое протекторатом: сюзерен с вассалом либо два вассала одного
 * сюзерена.
 *
 * Второй случай так же обязателен, как первый: сюзерен, чьи вассалы воюют между
 * собой, не сюзерен, а зритель.
 */
export function boundByProtectorate(war: WarState, a: string, b: string): boolean {
  if (a === b) return true;
  const sa = suzerainOf(war, a);
  const sb = suzerainOf(war, b);
  return sa === b || sb === a || (sa !== undefined && sa === sb);
}

export function pactOf(war: WarState, a: string, b: string): Pact | undefined {
  return war.pacts[factionPairKey(a, b)];
}

/** Действует ли на этот день договор такого рода. */
export function pactHolds(war: WarState, a: string, b: string, kind: Pact['kind'], day: number): boolean {
  const p = pactOf(war, a, b);
  return p !== undefined && p.kind === kind && p.untilDay > day;
}

/** Все договоры — от ближайшего к истечению. Для экрана и для замера. */
export function pactList(
  war: WarState,
): readonly { readonly pair: string; readonly pact: Pact }[] {
  return Object.keys(war.pacts)
    .sort()
    .map((pair) => ({ pair, pact: war.pacts[pair] as Pact }));
}

/** Память захватов пары «`attacker` взял у `defender`» (шаг 83). */
export function conquestOf(war: WarState, attacker: string, defender: string): number {
  return war.conquests[`${attacker}>${defender}`] ?? 0;
}

/** Взятый мир — в память захватов (шаг 83). Зовёт `front.ts::applySystemCapture` и завоевание роты. */
export function withConquest(war: WarState, attacker: string, defender: string): WarState {
  if (attacker === defender) return war;
  const key = `${attacker}>${defender}`;
  return { ...war, conquests: { ...war.conquests, [key]: (war.conquests[key] ?? 0) + 1 } };
}

/**
 * Память захватов тает (шаг 83): × `conquestDecay` за декаду, с точностью до 1e-4. Пара ниже
 * `CONQUEST_FLOOR` снимается — та же дисциплина разрежённости, что у фонда и театров.
 */
export function decayConquests(war: WarState): WarState {
  const next: Record<string, number> = {};
  for (const key of Object.keys(war.conquests).sort()) {
    const v = Math.round((war.conquests[key] as number) * WAR.diplomacy.conquestDecay * 1e4) / 1e4;
    if (v >= CONQUEST_FLOOR) next[key] = v;
  }
  return { ...war, conquests: next };
}

/** Ниже этого пара из памяти захватов уходит: сотая мира ничего не решает. */
const CONQUEST_FLOOR = 0.01;

// --- дипломатия: запись состояния ----------------------------------------------

/** Записать или снять протекторат. `undefined` освобождает вассала. */
export function withVassal(war: WarState, id: string, v: Vassalage | undefined): WarState {
  const vassals = { ...war.vassals };
  if (v === undefined) delete vassals[id];
  else vassals[id] = v;
  return { ...war, vassals };
}

/** Записать или снять договор пары. `undefined` разрывает его. */
export function withPact(war: WarState, a: string, b: string, p: Pact | undefined): WarState {
  if (a === b) return war;
  const key = factionPairKey(a, b);
  const pacts = { ...war.pacts };
  if (p === undefined) delete pacts[key];
  else pacts[key] = p;
  return { ...war, pacts };
}

/**
 * ПОТОКИ ПОДЧИНЕНИЯ за такт: кто кому сколько платит.
 *
 * **Считается заново каждый такт, а НЕ правится приращением в `income`, и это
 * отступление от плана шага 26 — сознательное.** План предлагал «дань в доходе
 * обеих сторон приращением». Так делать нельзя: `income` фракции означает
 * «доход со своих миров», и ровно на этом стоит тест, который охраняет всю
 * экономику с 21a, — полный пересчёт по каталогу (`makeWarState`) обязан
 * сойтись с приращением. Дань же — это ПОТОК МЕЖДУ АКТОРАМИ, а не свойство
 * мира: вложи её в `income`, и полный пересчёт разошёлся бы с приращением на
 * величину всей дани карты, потому что каталог о ней ничего не знает.
 *
 * Цена честности мала: данников на карте десятки, вассалов единицы, и обход
 * стоит десятков профилей за декаду — столько же, сколько уже стоит заживление
 * разорения.
 *
 * В карту потоков входит и держава игрока: её мир платит дань тем же правилом,
 * что мир Дома, а её доход считается в кассе (`war/domain.ts`), а не в
 * `FactionEconomy`. Поэтому карта возвращается по всем акторам, а такт
 * экономики берёт из неё свои строки.
 */
export function tributeFlows(
  war: WarState,
  worldSeed: number,
  deltas: GalaxyDeltas,
  day: number,
): Record<string, number> {
  const D = WAR.diplomacy;
  const out: Record<string, number> = {};
  const add = (id: string, amount: number): void => {
    out[id] = (out[id] ?? 0) + amount;
  };

  // Дань миров. Идём по разрежённой карте дельт: мир под данью — это всегда
  // отклонение от канона, и перебирать ради десятков записей две тысячи систем
  // незачем (тем же приёмом живут заживление и домен роты).
  for (const id of Object.keys(deltas).sort()) {
    const to = tributeOf(deltas, id, day);
    if (to === undefined) continue;
    const i = GALAXY.index(id);
    if (i < 0) continue;
    const from = ownerOf(deltas, i);
    // Мир, отбитый тем, кому он платил, дань не платит: сам себе данников не
    // назначают. Такт дипломатии такую запись снимет, но правильность не должна
    // зависеть от того, дошёл ли он до неё.
    if (from === to) continue;
    // Своя доля дани мира (шаг 90: лен) — иначе общая.
    const amount = round(worldContributionAt(worldSeed, deltas, i).income * (deltas[id]?.tributeShare ?? D.tributeShare));
    if (amount <= 0) continue;
    add(from, -amount);
    add(to, amount);
  }

  // Доля вассала. Считается от ДОХОДА вассала, а не от его избытка: избыток
  // ушедшей в минус державы равен нулю, и сюзеренитет над разорённым вассалом
  // не давал бы ничего ровно тогда, когда он и устанавливается.
  for (const id of Object.keys(war.vassals).sort()) {
    const suzerain = war.vassals[id]?.suzerain;
    if (suzerain === undefined || suzerain === id) continue;
    const amount = round(economyOf(war, id).income * D.vassalShare);
    if (amount <= 0) continue;
    add(id, -amount);
    add(suzerain, amount);
  }

  // Торговый договор: прибавка ОБЕИМ сторонам, а не переток от одной к другой.
  // Это и есть то, чем договор отличается от дани, — обмен, а не изъятие.
  // Держава роты (шаг 90, ступень 8): каждый её космопорт прибавляет `buildings.spaceportTradeShare` к своей доле.
  let ports = 0;
  for (const i of domainWorldIndexes(deltas)) if (deltas[GALAXY.id(i)]?.buildings?.includes('spaceport') === true) ports++;
  const shareOf = (id: string): number =>
    D.tradeIncomeShare + (isPlayerActor(id) ? ports * WAR.buildings.spaceportTradeShare : 0);
  for (const pair of Object.keys(war.pacts).sort()) {
    const p = war.pacts[pair] as Pact;
    if (p.kind !== 'trade' || p.untilDay <= day) continue;
    const [a, b] = pair.split('|') as [string, string];
    add(a, round(economyOf(war, a).income * shareOf(a)));
    add(b, round(economyOf(war, b).income * shareOf(b)));
  }

  return out;
}

export function planList(war: WarState): readonly (WarPlan & { readonly factionId: string })[] {
  return Object.keys(war.plans)
    .sort()
    .map((id) => ({ factionId: id, ...(war.plans[id] as WarPlan) }));
}

/** Насколько быстрее копится фонд по направлению главного удара (`war/plans.ts`). */
export function planFundWeight(war: WarState, from: string, against: string): number {
  const plan = war.plans[from];
  return plan !== undefined && plan.against === against ? WAR.plans.fundWeight : 1;
}

/**
 * Военный достаток фракции: казна плюс всё накопленное по направлениям.
 *
 * Фонд входит наравне с казной намеренно. Деньги, отложенные на войну,
 * снаряжают части не хуже денег в казне, и без этого слагаемого фракция,
 * исправно копящая на фронт, читалась бы как беднеющая.
 */
export function wealthOf(war: WarState, factionId: string): number {
  let total = economyOf(war, factionId).treasury;
  const row = war.funds[factionId];
  if (row !== undefined) for (const k of Object.keys(row)) total += row[k] as number;
  return total;
}

/**
 * Средневзвешенный достаток на мир по всей Сфере — знаменатель нормировки.
 *
 * Взвешенный, а не среднее по двадцати фракциям: иначе Волчьи Драгуны с одним
 * миром весили бы в середине столько же, сколько Дэвион с тремя сотнями, и
 * «середина» перестала бы означать середину карты.
 */
export function meanWealthPerWorld(war: WarState): number {
  let wealth = 0;
  let worlds = 0;
  for (const f of FACTION_LIST) {
    const w = economyOf(war, f.id).worlds;
    if (w === 0) continue;
    wealth += wealthOf(war, f.id);
    worlds += w;
  }
  return worlds === 0 ? 0 : wealth / worlds;
}

/**
 * Достаток фракции НА МИР, нормированный к середине Сферы. 1.0 — середина.
 *
 * Мера намеренно не абсолютная (решение 1): 396 миров Дэвиона против 134 у Ляо
 * дали бы вечную кастовость, которая за кампанию не меняется ни на шаг, —
 * Ляо был бы обречён выставлять худшее просто за свой размер.
 *
 * Полоса `prosperity.min..max` обязательна: КомСтар и Волчьи Драгуны владеют
 * одним миром каждый, и их внетерриториальный доход, делённый на единицу, дал
 * бы достаток в десятки раз выше любого Дома. Полоса упирает их в верхний край
 * — что и правильно по существу, — не ломая шкалу для остальных.
 */
export function prosperityOf(war: WarState, factionId: string): number {
  const p = WAR.prosperity;
  const eco = economyOf(war, factionId);
  const mean = meanWealthPerWorld(war);
  if (eco.worlds === 0 || mean <= 0) return 1;
  const value = wealthOf(war, factionId) / eco.worlds / mean;
  return clamp(Math.round(value * 1000) / 1000, p.min, p.max);
}

/**
 * Полоса достатка — то, что игрок видит без разведки (решение 6).
 *
 * Нижняя ступень «разорена» до 21b НЕДОСТИЖИМА намеренно: её порог совпадает с
 * полом полосы достатка (`data/war.json`), поэтому от одной бедности в неё не
 * попасть ни на одном сиде. Слово обязано означать войну, а не мелкий размер
 * фракции — замер на 200 сидах показал, чем грозило обратное: независимые миры
 * читались разорёнными на 69 сидах из 200 в ПЕРВЫЙ день кампании.
 */
export type ProsperityBand = 'ruined' | 'poor' | 'fair' | 'strong';

export function prosperityBand(prosperity: number): ProsperityBand {
  const b = WAR.prosperity.bands;
  if (prosperity < b.poor) return 'ruined';
  if (prosperity < b.fair) return 'poor';
  if (prosperity < b.strong) return 'fair';
  return 'strong';
}

/**
 * Полоса, которую видит игрок: достаток, перекрытый ВОЙНОЙ.
 *
 * «Разорена» — это не «беднее всех», а «выжжена»: ступень открывает доля
 * разорённых миров (`front.ts::ruinShareOf`), а не низ шкалы достатка. Разница
 * не косметическая — на первый день кампании разорение равно нулю у всех и на
 * любом сиде, поэтому слово означает войну по построению, а не по калибровке
 * порога. Как это выяснилось — в докстринге `ruinShareOf`.
 */
export function warBand(prosperity: number, ruinShare: number): ProsperityBand {
  if (ruinShare >= WAR.front.ruinedBandFrom) return 'ruined';
  const band = prosperityBand(prosperity);
  return band === 'ruined' ? 'poor' : band;
}

// --- запись -------------------------------------------------------------------

/**
 * Правка экономики одной фракции. Возвращает НОВОЕ состояние — всё внутри
 * `CampaignState` неизменяемо, как и в боевом ядре.
 *
 * Казна не уходит в минус: при нехватке дохода сначала сохнет военный фонд
 * (`withFund`), а казна упирается в ноль. Фракция-должник ничего не значила бы
 * — занимать ей не у кого, и никакая механика долг бы не читала.
 */
export function withEconomy(war: WarState, factionId: string, patch: Partial<FactionEconomy>): WarState {
  const prev = economyOf(war, factionId);
  const next: FactionEconomy = {
    treasury: Math.max(0, round(patch.treasury ?? prev.treasury)),
    income: round(patch.income ?? prev.income),
    upkeep: round(patch.upkeep ?? prev.upkeep),
    worlds: Math.max(0, patch.worlds ?? prev.worlds),
    capacity: Math.max(0, round(patch.capacity ?? prev.capacity)),
    army: Math.max(0, round(patch.army ?? prev.army)),
    lift: Math.max(0, round(patch.lift ?? prev.lift)),
  };
  return { ...war, economy: { ...war.economy, [factionId]: next } };
}

/**
 * Записать военный фонд по направлению.
 *
 * Обнулившееся направление из карты УДАЛЯЕТСЯ, и опустевшая строка фракции —
 * тоже: иначе разрежённость протекала бы через первый же мирный такт, и через
 * год игры плотная карта из четырёхсот направлений собралась бы сама. Та же
 * дисциплина, что у `withStanding` и `withDelta`.
 */
export function withFund(war: WarState, from: string, against: string, value: number): WarState {
  if (from === against) return war;
  const amount = Math.max(0, round(value));
  const prevRow = war.funds[from];
  const row: Record<string, number> = { ...(prevRow ?? {}) };
  if (amount === 0) delete row[against];
  else row[against] = amount;

  const funds = { ...war.funds };
  if (Object.keys(row).length === 0) delete funds[from];
  else funds[from] = row;
  return { ...war, funds };
}

/** Экономика всех фракций — от богатых к бедным. Для экрана и для замера. */
export function economyList(
  war: WarState,
): readonly { readonly id: string; readonly economy: FactionEconomy; readonly prosperity: number }[] {
  return FACTION_LIST.map((f) => ({
    id: f.id,
    economy: economyOf(war, f.id),
    prosperity: prosperityOf(war, f.id),
  })).sort((a, b) =>
    a.prosperity !== b.prosperity ? b.prosperity - a.prosperity : a.id < b.id ? -1 : 1,
  );
}

// --- такт ---------------------------------------------------------------------

/**
 * Такт экономики (шаг 21a, часть B): доход, содержание, отчисление в военный
 * фонд по направлениям.
 *
 * **Ни одного броска.** Тикер — весовые правила, а не ИИ и не случайность
 * (`ai.md` §3, ловушка 1 плана шага 21): при равном состоянии такт обязан дать
 * равный результат, и сидированный ГПСЧ здесь просто нечем занять. Броски
 * появятся в 21b, где фронт выбирает, какой участок сдвинуть.
 *
 * Избыток делится между казной и военным фондом; фонд расходится по
 * направлениям пропорционально ВРАЖДЕ, а с шага 21b — ещё и числу участков
 * фронта с этим врагом (`front`). Без второго множителя Соколы копили бы
 * против КомСтара, с которым не граничат ни одним миром, ровно столько же,
 * сколько против Волков, чья граница проходит по их зоне оккупации, — и
 * «стягивают силы к Твайкроссу» не значило бы ничего.
 *
 * Без `front` (так его зовёт 21a и так его зовут тесты экономики) деление идёт
 * по одной вражде: подготовка к войне идёт раньше самой войны, и фракция без
 * единого участка фронта всё равно копит против того, с кем ей воевать.
 *
 * Нехватка гасится сначала фондом и лишь потом казной: отложенное на войну
 * тратится на жалованье раньше, чем государство залезает в резерв.
 */
export function economyTick(
  war: WarState,
  rep: ReputationState,
  front?: Readonly<Record<string, Readonly<Record<string, number>>>>,
  flows?: Readonly<Record<string, number>>,
  logistics?: LogisticsInput,
): WarState {
  let next = demobilize(war, rep);
  for (const f of FACTION_LIST) {
    const eco = economyOf(next, f.id);
    // Армия ест содержание наравне с мирами: большая армия — это решение, за
    // которое платят каждую декаду, а не бесплатный запас.
    //
    // Потоки подчинения (шаг 26) входят сюда ЖЕ и в том же знаке, что доход:
    // данник отдаёт часть дохода мира, вассал — часть своего, сюзерен и партнёр
    // по торговому договору получают. Отдельной строки в состоянии у них нет
    // намеренно — разбор в `tributeFlows`.
    // Содержание платится за ВСЮ армию, а не за резерв (шаг 27): полк на фронте
    // ест не меньше полка дома, а скорее больше. Считай по резерву — и держава
    // отправкой полков на фронт СНИМАЛА бы с себя расходы.
    const surplus =
      eco.income + (flows?.[f.id] ?? 0) - eco.upkeep - totalArmy(next, f.id) * E.armyUpkeep;
    next = surplus >= 0 ? accrue(next, rep, f.id, surplus, front?.[f.id]) : drain(next, f.id, -surplus);
    next = rebuildArmy(next, f.id);
  }
  // ЛОГИСТИКА — ПОСЛЕДНЕЕ ЗВЕНО ТАКТА, и порядок здесь и есть порядок круга:
  // заплатили содержание → отложили на войну → построили машины → и только
  // потом повезли их на фронт. Построенное в эту декаду уезжает в эту же
  // декаду, если хватает подъёмной силы, — очереди «в пути» между резервом и
  // театром нет намеренно (решение §6 дорожной карты: задержка выражена
  // потолком, а не третьим состоянием).
  //
  // Без `logistics` звено пропускается целиком, и это не заглушка: так
  // `economyTick` зовут тесты экономики, которым фронт не нужен вовсе. Сумма
  // «резерв + театры» при этом не сходится с места — переброска ничего не
  // создаёт и не уничтожает, — поэтому пропуск звена не может незаметно
  // испортить состояние.
  if (logistics !== undefined) {
    next = logisticsTick(next, rep, logistics.shares, logistics.jumps, logistics.actors);
  }
  return next;
}

/**
 * Что такту экономики нужно знать о геометрии войны, чтобы двинуть полки.
 *
 * Обе величины считаются ОДИН РАЗ на такт из уже построенного списка участков и
 * передаются сюда готовыми (`commands/execute.ts`). Считай их здесь — и такт
 * экономики строил бы фронт заново, вторым проходом по каталогу, ради того же
 * самого, что уже посчитано для раскладки военного фонда.
 */
export interface LogisticsInput {
  readonly shares: FrontShares;
  readonly jumps: TheaterJumps;
  /** Кого двигает такт: фракции каталога, а с шага 27, часть C, — и держава игрока. */
  readonly actors?: readonly string[];
}

/**
 * РОСПУСК ПРИГОТОВЛЕНИЙ (шаг 26, часть A) — третий и самый крупный сток
 * военного фонда.
 *
 * Направление, переставшее быть враждебным (живая вражда упала ниже
 * `fundMinEnmity` — договор, дань, протекторат или просто годы без войны),
 * распускается: накопленное на него уходит в КАЗНУ. Деньги не исчезают, они
 * перестают быть отложенными на войну, которой больше нет.
 *
 * До шага 26 такого не могло случиться в принципе: вражда была статической
 * таблицей, и направление, однажды заведённое, оставалось враждебным вечно.
 * Отсюда и долг 21a — фонд рос без предела: 14.9 такта дохода на сотой декаде,
 * 40.0 за десять лет.
 */
function demobilize(war: WarState, rep: ReputationState): WarState {
  let next = war;
  for (const from of Object.keys(war.funds).sort()) {
    for (const against of Object.keys(war.funds[from] ?? {}).sort()) {
      if (liveEnmity(rep, from, against) >= E.fundMinEnmity) continue;
      const amount = fundOf(next, from, against);
      if (amount <= 0) continue;
      next = withFund(next, from, against, 0);
      next = withEconomy(next, from, { treasury: economyOf(next, from).treasury + amount });
    }
  }
  return next;
}

/**
 * РОСПУСК ПО БЕЗДЕЙСТВИЮ — вторая половина того же стока и та, которая
 * закрывает долг 21a численно.
 *
 * Направление, на котором в эту декаду не стреляли, возвращает в казну долю
 * `idleRelease` отложенного. Приготовления не хранятся вечно: части
 * расформировывают, склады проедают, бюджет уходит на то, что горит сегодня.
 *
 * **Зачем это понадобилось сверх дипломатии — замер, а не вкус.** Части A и B в
 * первом виде дали медиану фонда 14.20 такта дохода против дошаговых 14.89, то
 * есть не сделали с долгом 21a ничего. Причина арифметическая и видна из
 * равновесия: направление тратится только наступлением, а наступлений на карте
 * две с половиной за декаду на пятьсот направлений. Равновесие фонда равно
 * «сколько накопили, делённое на вероятность, что на это направление вообще
 * сходят», и оно уходит в потолок при любой цене наступления.
 *
 * Доля же от самого фонда задаёт равновесие честно: `накопление / idleRelease`.
 * Отсюда и главное свойство, которого не было ни у одной прежней ручки, — фонд
 * ПЕРЕСТАЁТ РАСТИ БЕЗ ПРЕДЕЛА, а не просто становится меньше.
 *
 * **И это не «затухание к базовой линии», запрещённое решением о матрице.**
 * Матрица — про политику: стянутая к нулю, она означала бы Сферу, где все
 * помирились сами собой. Фонд — про деньги, и «отложенное на войну, которой не
 * случилось, ушло на другое» не утверждает о политике ничего. Вражда при этом
 * остаётся ровно там, где была.
 *
 * Направление, на котором ВОЮЮТ, роспуска не видит вовсе, — поэтому деньги сами
 * стягиваются к горячей границе, а не размазываются по всем девятнадцати
 * соседям. Это то же требование, ради которого фонд с самого начала направлен.
 */
export function releaseIdleFunds(
  war: WarState,
  active: ReadonlySet<string>,
): WarState {
  if (E.idleRelease <= 0) return war;
  let next = war;
  for (const from of Object.keys(war.funds).sort()) {
    for (const against of Object.keys(war.funds[from] ?? {}).sort()) {
      if (active.has(`${from}>${against}`)) continue;
      const amount = fundOf(next, from, against);
      if (amount <= 0) continue;
      const back = round(amount * E.idleRelease);
      if (back <= 0) continue;
      next = withFund(next, from, against, amount - back);
      next = withEconomy(next, from, { treasury: economyOf(next, from).treasury + back });
    }
  }
  return next;
}

/**
 * Целевая численность армии — от ПРОМЫШЛЕННОЙ МОЩНОСТИ (шаг 25, часть B).
 *
 * До шага 25 считалась от числа миров, и пятнадцать арсенальных миров давали
 * ровно столько же, сколько пятнадцать захолустий. Теперь «компактный и
 * сильный» возможен: держава с богатой военной промышленностью выставляет
 * армию больше, чем её территория «полагает».
 *
 * `mechsPerCapacity` выставлен так, что СУММАРНАЯ армия Сферы осталась на
 * дошаговом уровне: шаг виден как перераспределение, а масштаб войны не меняется.
 */
export function armyTarget(capacity: number): number {
  return Math.round(capacity * IND.mechsPerCapacity);
}

/**
 * Сколько армии ПОЛАГАЕТСЯ фракции по её территории.
 *
 * Отдельная мера рядом с целевой численностью, и разделять их обязательно.
 * Готовность (`armyReadiness`) множит силу стороны на участке фронта, то есть
 * это ОТНОСИТЕЛЬНАЯ величина. Считай её от мощности — и получится извращение:
 * фракция, у которой сожгли арсеналы, получила бы вместе с падением мощности
 * падение цели, отношение осталось бы прежним, и выжженная держава дралась бы
 * ровно так же, как целая. Разорение перестало бы что-либо значить на фронте.
 *
 * Территория же от пожаров не зависит. Отсюда обе половины смысла разом:
 * держава с сильной промышленностью выставляет БОЛЬШЕ полагающегося и дерётся
 * выше нормы, а держава с выжженной — не может восполнить потери и проседает.
 */
export function armyReference(worlds: number): number {
  return Math.round(worlds * E.armyPerWorld);
}

/**
 * Пополнение армии за такт (шаг 22c) — то самое «закупаются роботы» из круга.
 *
 * Фракция вкладывает долю СВОБОДНОЙ казны в машины, пока не дойдёт до целевой
 * численности. Отсюда и обратная связь, которой не было: проигранный рейд стоит
 * машин, машины стоят денег, деньги идут не в военный фонд, и следующее
 * наступление слабее. Разорённая войной фракция беднеет дважды — доходом и
 * армией.
 */
export function rebuildArmy(war: WarState, factionId: string): WarState {
  const eco = economyOf(war, factionId);
  const target = armyTarget(eco.capacity);
  // Цель — на ВСЮ армию, а покупка идёт в РЕЗЕРВ (шаг 27): заводы строят
  // машины дома, на фронт их увозит логистика. Сравнивать цель с одним резервом
  // значило бы, что держава, отправившая полки на фронт, немедленно закупает им
  // замену, и армия росла бы без предела ровно с той скоростью, с какой её
  // возят.
  if (totalArmy(war, factionId) >= target || eco.treasury <= 0) return war;

  const budget = eco.treasury * E.rebuildShare;
  const canBuy = Math.floor(budget / E.mechCost);
  if (canBuy <= 0) return war;

  // ВТОРОЙ ПРЕДЕЛ, заведённый шагом 25: заводы. До него фракция докупала до
  // целевой численности одним тактом, если казна позволяла, и выжженная
  // промышленность не меняла ничего. Теперь богатая держава с сожжёнными
  // арсеналами не может откупиться от потерь — ей физически не на чем строить,
  // и крупная потеря отыгрывается годами, а не одной декадой.
  const canBuild = Math.floor(eco.capacity * IND.buildPerCapacity);
  if (canBuild <= 0) return war;

  const bought = Math.min(canBuy, canBuild, Math.ceil(target - totalArmy(war, factionId)));
  if (bought <= 0) return war;
  return withEconomy(war, factionId, {
    army: eco.army + bought,
    treasury: round(eco.treasury - bought * E.mechCost),
  });
}

/**
 * Убыль армии от боя (шаг 22c).
 *
 * Ниже `armyMinShare` от цели армия не падает: государство не исчезает от одного
 * проигранного рейда, у него остаются ополчение и планетарная оборона, которых
 * фронт не считает. Это тот же предел, что у полка (`rivals/regiments.ts`), и по
 * той же причине — из реестра действующих лиц не выбывают молча.
 */
export function withArmyLoss(war: WarState, factionId: string, lost: number): WarState {
  if (lost <= 0) return war;
  const eco = economyOf(war, factionId);
  // Пол считается от ТЕРРИТОРИИ, а не от мощности: у державы с выжженными
  // заводами всё равно остаются ополчение и планетарная оборона, которых фронт
  // не считает, и они никуда не деваются вместе с арсеналами.
  const floor = armyReference(eco.worlds) * E.armyMinShare;
  const next = Math.max(floor, eco.army - lost);
  if (next === eco.army) return war;
  return withEconomy(war, factionId, { army: round(next) });
}

/**
 * Насколько армия фракции отвечает тому, что ей положено держать.
 *
 * Единица — армия в целевой численности, ниже — обескровленная. Ею взвешивается
 * сила стороны на участке (`front.ts::sectorForces`): фракция, потерявшая
 * половину машин, и наступает вполсилы. До шага 22c этого множителя не было
 * вовсе, и войну можно было вести бесконечно, не имея чем.
 */
export function armyReadiness(war: WarState, factionId: string): number {
  const eco = economyOf(war, factionId);
  // Знаменатель — ТЕРРИТОРИАЛЬНАЯ норма, а не цель от мощности (шаг 25):
  // разбор — в комментарии к `armyReference`. Коротко: цель от мощности падала
  // бы вместе с сожжёнными заводами, и выжженная держава дралась бы как целая.
  const reference = armyReference(eco.worlds);
  if (reference <= 0) return 1;
  // ЧИСЛИТЕЛЬ — ВСЯ АРМИЯ, А НЕ РЕЗЕРВ (шаг 27). После разделения на эшелоны
  // `eco.army` означает резерв, и эта функция, считай она по нему, объявляла бы
  // обескровленной всякую державу, которая отправила полки на фронт, — то есть
  // ровно ту, у которой с армией всё в порядке.
  //
  // Эта мера осталась ОБЩЕДЕРЖАВНОЙ намеренно, и её зовут только те, кому
  // нужна держава целиком: замысел государства (`plans.ts` — хватит ли сил
  // объявить наступление), разрыв протектората и просьба о перемирии
  // (`diplomacy.ts`). Сила на УЧАСТКЕ считается готовностью театра
  // (`logistics.ts::theaterReadiness`), и вот она уже по направлениям.
  return Math.max(E.armyMinShare, Math.min(1.5, totalArmy(war, factionId) / reference));
}

/** Избыток: доля в военный фонд по направлениям, остаток в казну. */
function accrue(
  war: WarState,
  rep: ReputationState,
  factionId: string,
  surplus: number,
  front?: Readonly<Record<string, number>>,
): WarState {
  const toFund = round(surplus * E.warFundShare);
  const { war: next, placed } = placeWarFund(war, rep, factionId, toFund, front);
  const eco = economyOf(next, factionId);
  return withEconomy(next, factionId, { treasury: eco.treasury + surplus - placed });
}

/**
 * Разложить `toFund` по военным фондам против живых врагов — по вражде, участкам фронта и
 * замыслу. Вынесено из `accrue` проектом державы (шаг 2): держава роты откладывает на войну ту
 * долю дохода, которую назначил игрок, и раскладывает её ЭТОЙ ЖЕ функцией, а не второй копией.
 * `placed` — сколько легло в фонды; без живых врагов — ноль, и деньги остаются у владельца.
 */
export function placeWarFund(
  war: WarState,
  rep: ReputationState,
  factionId: string,
  toFund: number,
  front?: Readonly<Record<string, number>>,
): { war: WarState; placed: number } {
  // ЖИВАЯ вражда, а не таблица 3053 года (шаг 26, часть A): пара, помирившаяся
  // за годы кампании, перестаёт быть направлением, на которое копят, а пара,
  // провоевавшая десять лет, тянет к себе больше. До этой строки петля была
  // разомкнута — война портила отношения, а раскладка фонда их не читала.
  const all = liveEnemiesOf(rep, factionId, E.fundMinEnmity);
  // Участки фронта ВЕСЯТ, но не отсекают: фракция, у которой сегодня нет общей
  // границы с врагом, всё равно откладывает против него — иначе первый же
  // потерянный приграничный мир обнулял бы всю подготовку к войне.
  // Замысел государства (шаг 23, часть B) множит своё направление ещё раз:
  // «копит против неё фонд» — половина того, чем главный удар вообще отличается
  // от обычного давления по всей границе.
  const enemies = all.map((e) => ({
    id: e.id,
    enmity:
      e.enmity * (front === undefined ? 1 : 1 + (front[e.id] ?? 0)) * planFundWeight(war, factionId, e.id),
  }));
  let weight = 0;
  for (const e of enemies) weight += e.enmity;

  let next = war;
  let placed = 0;
  if (toFund > 0 && weight > 0) {
    // Последнее направление добирает остаток от округления: без этого сумма
    // разошлась бы с отчислением на несколько C-Bills за такт, и за двадцать
    // восемь декад расхождение стало бы видно в хэше.
    for (let k = 0; k < enemies.length; k++) {
      const e = enemies[k] as { id: string; enmity: number };
      const share =
        k === enemies.length - 1 ? toFund - placed : round((toFund * e.enmity) / weight);
      placed += share;
      next = withFund(next, factionId, e.id, fundOf(next, factionId, e.id) + share);
    }
  }

  return { war: next, placed };
}

/** Нехватка: сначала сохнет военный фонд, потом казна, и обе упираются в ноль. */
function drain(war: WarState, factionId: string, deficit: number): WarState {
  const rows = fundsOf(war, factionId);
  let total = 0;
  for (const r of rows) total += r.amount;

  let next = war;
  let taken = 0;
  if (total > 0) {
    const want = Math.min(deficit, total);
    for (let k = 0; k < rows.length; k++) {
      const r = rows[k] as { against: string; amount: number };
      const cut = k === rows.length - 1 ? want - taken : round((want * r.amount) / total);
      taken += cut;
      next = withFund(next, factionId, r.against, r.amount - cut);
    }
  }

  const eco = economyOf(next, factionId);
  return withEconomy(next, factionId, { treasury: eco.treasury - (deficit - taken) });
}

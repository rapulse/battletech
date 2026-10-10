import { qualityRank } from '../../model/QualityClass.js';
import { skillLevel, type Pilot } from '../../model/Pilot.js';
import { validateAssembly } from '../../rules/construction.js';
import type { Company } from '../company/types.js';
import { recordChassisDef, recordQuality, type MechRecord } from '../mech/MechRecord.js';
import { opforCount, type Contract } from './board.js';
import { forceTonsAverage } from './opfor.js';
import { contractParts, lanceParts, strengthOf } from './power.js';
import { CONTRACTS } from './schema.js';
import { supplyThreat } from './supply.js';

/**
 * Читаемая ДО боя оценка сил (шаг 16, пересчитана на шаге 16a).
 *
 * «У контракта должна быть оценка силы, сопоставимая с силой отряда, иначе
 * замер утонет в поражениях и ничего не покажет» (ловушка 2 брифинга шага 16) —
 * и ровно эта же оценка нужна игроку на экране контракта: «периферийная банда
 * на трофеях» и «гвардейский полк» обязаны быть разными ЧИСЛАМИ, а не разной
 * подписью.
 *
 * **Единица — условная серийная средняя машина с обычным экипажем.** Обе
 * стороны меряются ею, иначе сравнивать нечего.
 *
 * **Что пришлось исправить на шаге 16a и почему.** Первая версия считала только
 * класс исполнения: звено из трёх машин давало тройку независимо от того,
 * тридцатитонные они или пятидесятитонные и всё ли на них навешено. Пока рота
 * начиналась с четырёх одинаковых середняков, это сходилось; как только она
 * стала начинаться с двух лёгких и одной средней, притом недоукомплектованных,
 * бот начал считать себя вдвое сильнее, чем был, и брался за работу, которой не
 * тянул. Замер показал это без обиняков: 60 кампаний из 70 теряли парк. Теперь в
 * оценку входят **тоннаж** и **фактическая загрузка** — то есть ровно те две
 * вещи, которые шаг 16a и добавил в мир.
 *
 * **Это не боевое правило.** В бой ни одно из этих чисел не попадает: сколько
 * на самом деле стоит гвардейский реактор против серийного, решает сам бой.
 * Здесь только грубая мера для решения «браться или нет», и её коэффициенты
 * лежат в `data/contracts.json`, а не в коде.
 */

/** Эталон тоннажа: середина среднего класса (`classification.md` §2, 45–65 т). */
export const REFERENCE_TONS = 55;

/**
 * Насколько машина загружена против собственного паспорта.
 *
 * Недогруз — это и есть комплектность (`mech/outfit.ts`): броню навесили не всю,
 * одного орудия не нашлось. Считается по свободной массе, которую и так
 * возвращает валидатор сборки, — второй формулы «сколько на машине железа»
 * заводить не надо.
 */
export function payloadUse(record: MechRecord): number {
  const report = validateAssembly(record.assembly);
  if (report.maxMass <= 0) return 1;
  return Math.max(0.2, Math.min(1, 1 - Math.max(0, report.freeMass) / report.maxMass));
}

/** Сила одной машины в условных серийных средних: класс × вес × загрузка. */
export function mechThreat(record: MechRecord): number {
  const q = recordQuality(record);
  const worst = qualityRank(q.reactor) <= qualityRank(q.frame) ? q.reactor : q.frame;
  const tons = recordChassisDef(record).tons;
  return CONTRACTS.opfor.threatByQuality[worst] * (tons / REFERENCE_TONS) * payloadUse(record);
}

/**
 * Во сколько условных машин рота оценивает выведенное звено.
 *
 * Модель выбирается данными (`opfor.power.model`, шаг 68):
 *
 * - `tonnage` — прежняя линия по тоннажу. Экипаж здесь НЕ учитывается: звено
 *   сравнивается с противником, чьи пилоты заложены в `threat` типа отряда;
 * - `power` — огонь и живучесть (`power.ts`), и тогда пилот входит в огонь
 *   обеих сторон одинаково: у роты — свой, у противника — выборка по типу части.
 *
 * Рота нужна ради пилотов: машина без пилота в строю в оценку `power` не входит.
 */
export function lanceThreat(company: Company, lance: readonly MechRecord[]): number {
  if (CONTRACTS.opfor.power.model === 'power') return strengthOf(lanceParts(company, lance));
  return lanceTonnageThreat(lance);
}

/** Прежняя оценка звена, линия по тоннажу, — при любом значении флага (замер и тесты её зовут явно). */
export function lanceTonnageThreat(lance: readonly MechRecord[]): number {
  return lance.reduce((sum, m) => sum + mechThreat(m), 0);
}

// --- простая оценка: то, что видит игрок --------------------------------------

/**
 * Простая оценка сил (решения пользователя 2026-09-23) — прежняя тоннажная
 * оценка с двумя исправленными перекосами. Это то, что видит игрок: «Оценка
 * сил», черепа на карточке, норма нанимателя и плата за высадку (`landing.ts`).
 *
 * **Машина роты:** класс узлов × тоннаж / 55 × комплектность (`mechThreat`), у
 * клановой ещё × `opfor.simple.clanFactor` (1.8 — только технология).
 * **Противник:** объявленное число машин × тип части × снабжение × средний
 * тоннаж полосы / 55 (`opforMechThreat`). Клан в типе части уже сидит (2.2 —
 * технология, узлы и выучка вместе), второй раз он не множится.
 *
 * Исправлено против прежней оценки:
 * - клановая машина игрока шла как сферная — теперь × 1.8 за технологию;
 *   армейская клановая выходит 1.8 × 1.2 = 2.16, почти как клановая часть 2.2;
 * - численность противника шла в степени 1.2, своя — линейно; теперь обе
 *   линейно.
 *
 * **Пилота и выбора вооружения здесь нет намеренно:** это манёвр игрока.
 * Комплектность — доля навешенной массы: машина с пустыми местами слабее, а
 * какие именно стволы стоят, оценка не видит. Грамотная сборка и обученный
 * пилот дают перевес в бою, который по этой оценке выглядит равным, и не
 * удорожают вылет.
 *
 * Подробная оценка (`power.ts`, огонь × живучесть) — мера риска ботов.
 */
export function mechSimpleThreat(record: MechRecord): number {
  const tech = recordChassisDef(record).techBase === 'clan' ? CONTRACTS.opfor.simple.clanFactor : 1;
  return mechThreat(record) * tech;
}

/** Простая оценка звена: сумма машин. */
export function lanceSimpleThreat(lance: readonly MechRecord[]): number {
  return lance.reduce((sum, m) => sum + mechSimpleThreat(m), 0);
}

/** Простая оценка противника: объявленное число машин (линейно) × средняя машина. */
export function contractSimpleThreat(contract: Contract): number {
  return opforCount(contract) * opforMechThreat(contract);
}

/**
 * Простая оценка звена нанимателя (шаг 73b), 0 — звена нет.
 *
 * Та же средняя машина, что у противника (`opforMechThreat`), только тип части
 * и снабжение — нанимателя: тоннаж у звена и противника один.
 */
export function alliesSimpleThreat(contract: Contract): number {
  const a = contract.allies;
  if (a === undefined) return 0;
  const type = CONTRACTS.opfor.types[a.opforType];
  return a.units * type.threat * supplyThreat(a.supply) * (opforTonsAverage(contract) / REFERENCE_TONS);
}

/**
 * Средняя машина противника по условиям предложения: тип части × снабжение ×
 * средний тоннаж полосы / 55. Общая для простой и прежней оценок.
 */
export function opforMechThreat(contract: Contract): number {
  const type = CONTRACTS.opfor.types[contract.opforType];
  return type.threat * supplyThreat(contract.supply) * (opforTonsAverage(contract) / REFERENCE_TONS);
}

/**
 * Полоса тоннажа, из которой набирается состав противника (шаг 44, план Б).
 *
 * Потолок записан в контракте, нижняя граница — доля от него из данных
 * (`opfor.tons.floor`). Без нижней границы гвардия с потолком 85 т набирала бы
 * двадцатитонники наравне со штурмовыми, и обещание «выйдет гвардия» ничего не
 * значило бы по весу.
 */
export function opforTonsBand(contract: Contract): { readonly min: number; readonly max: number } {
  return { min: contract.opforTons * CONTRACTS.opfor.tons.floor, max: contract.opforTons };
}

/**
 * Средняя машина такого состава — ею меряется опасность контракта.
 *
 * Считается по тем же шасси, из которых `opfor.ts::buildForce` собирает состав
 * (`forceTonsAverage`), а не серединой полосы: оценка до боя и фактическая
 * сборка обязаны считать вес ОДНОЙ формулой — разойдись они, и «сложность,
 * читаемая до боя» перестала бы совпадать с боем. Середина полосы расходилась
 * на мелких потолках: каталог начинается с 20 т и идёт шагом 5 т, и «до 20 т»
 * оценивалось машинами по 15.5 т, тогда как выходили двадцатитонные (−22 %).
 */
export function opforTonsAverage(contract: Contract): number {
  const band = opforTonsBand(contract);
  return forceTonsAverage(band.max, band.min, contract.opforTechBase);
}

/**
 * Во сколько условных машин обходится противник по контракту.
 *
 * `threat` типа отряда вбирает в себя и класс исполнения, и комплектность, и
 * выучку пилотов — это одно число на тип части, и в `data/contracts.json` оно
 * так и подписано. Разносить их на три множителя значило бы делать вид, что мы
 * знаем вклад каждого; мы его не знаем, его знает только бой.
 *
 * Со шага 44 (план Б) звено сюда не входит вовсе: и число машин противника, и
 * их вес записаны в предложении. Оценка стала свойством РАБОТЫ, и её можно
 * сравнивать с оценкой любого звена — на этом и держится «беру только то, что
 * вытяну».
 */
export function contractThreat(contract: Contract): number {
  if (CONTRACTS.opfor.power.model === 'power') return strengthOf(contractParts(contract));
  return contractTonnageThreat(contract);
}

/**
 * Доля противника, приходящаяся на роту (шаг 73b): оценка противника за
 * вычетом доли звена нанимателя. Той же долей урезан гонорар, поэтому бот,
 * выбирающий работу, видит ровно ту же картину, что и цена.
 */
export function companyThreat(contract: Contract): number {
  return contractThreat(contract) * (1 - (contract.allies?.share ?? 0));
}

/** Прежняя оценка противника по типу части и тоннажу — при любом значении флага. */
export function contractTonnageThreat(contract: Contract): number {
  // Снабжение (шаг 21a) входит в оценку наравне с типом части: оно правит и
  // комплектность машин противника, и его место на лестнице типов. Оценка, не
  // знающая о нём, обещала бы среднюю часть там, где выйдет богатая гвардия.
  // Число машин входит НЕЛИНЕЙНО (шаг 44, план Б): численный перевес даёт
  // больше, чем сумма машин, — сосредоточенный огонь выбивает по одной, и
  // потерявшая машину сторона стреляет слабее следующим ходом. Пока противник
  // считался долей от звена, разница не превышала полутора машин и показатель
  // был не нужен; с абсолютными контрактами линейная оценка объявляла работу на
  // двенадцать лёгких посильной четвёрке средних.
  return Math.pow(opforCount(contract), CONTRACTS.opfor.threatNumbersPower) * opforMechThreat(contract);
}

// --- рейтинг роты -------------------------------------------------------------

/**
 * Рейтинг силы роты (шаг 16a).
 *
 * То же мерило, что у `lanceThreat`, но по всему парку и с добавкой, которой в
 * оценке одного вылета нет: **выучкой пилотов**. Звену она не нужна — пилоты
 * противника уже сидят в `threat` его типа; рейтингу нужна, потому что рота из
 * шести тяжёлых машин с ветеранами и рота из трёх лёгких с новобранцами обязаны
 * стоять в таблице далеко друг от друга.
 *
 * **Зачем это сейчас, когда соперников ещё нет** (они — шаг 22, и им нужен
 * авто-расчёт шага 18): рейтинговая таблица — это экран, и если формулы нет к
 * шагу 17, экран либо не появится вовсе, либо посчитает силу по-своему, и шагу
 * 22 придётся спорить с уже нарисованным числом. Формула одна, живёт здесь, и
 * соперник считается ею же — он та же структура данных, что и рота игрока
 * (`wiki/design/campaign/reputation.md`, «Масштабируемость»).
 */

/** Навыки, решающие исход боя. Техника и присутствие в рейтинг не входят — они про кампанию. */
const RATING_SKILLS = ['gunnery', 'piloting', 'tactics'] as const;

/** Уровень навыка, вокруг которого держится обычный пилот (`data/pilots.json`, шкала 1..10). */
const BASELINE_SKILL = 4;

/**
 * Выучка экипажа множителем к машине.
 *
 * Считается по САЖЕННЫМ пилотам: пилот в лазарете или без машины боевой силы
 * роте сейчас не добавляет — он добавит её, когда сядет в кабину.
 */
function crewFactor(company: Company, record: MechRecord): number {
  if (record.pilotId === null) return 0;
  const pilot: Pilot | undefined = company.pilots.find((p) => p.id === record.pilotId);
  if (pilot === undefined || pilot.status !== 'active') return 0;
  const avg =
    RATING_SKILLS.reduce((sum, id) => sum + skillLevel(pilot, id), 0) / RATING_SKILLS.length;
  return avg / BASELINE_SKILL;
}

/** Разбор рейтинга по машинам — для экрана: игрок должен видеть, чем он силён. */
export interface RatingEntry {
  readonly recordId: string;
  readonly rating: number;
  /** Машина без пилота или с пилотом в лазарете: в рейтинг не входит, но в списке видна. */
  readonly idle: boolean;
}

export interface CompanyRating {
  /** Сила роты в условных серийных средних машинах. */
  readonly total: number;
  readonly byMech: readonly RatingEntry[];
}

export function companyRating(company: Company): CompanyRating {
  const byMech = company.mechs.map((m) => {
    const crew = crewFactor(company, m);
    return {
      recordId: m.id,
      rating: Math.round(mechThreat(m) * crew * 100) / 100,
      idle: crew === 0,
    };
  });
  const total = byMech.reduce((sum, e) => sum + e.rating, 0);
  return { total: Math.round(total * 100) / 100, byMech };
}

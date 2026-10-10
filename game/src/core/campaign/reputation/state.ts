import { FACTION_LIST } from '../galaxy/catalog.js';
import { enmity, factionPairKey } from '../contracts/relations.js';
import { RELATIONS } from '../contracts/schema.js';
import { REPUTATION } from './schema.js';
import { hostileFloor } from './access.js';

/**
 * Репутация отряда (шаг 20) — три оси и матрица отношений фракций.
 *
 * **Часть `CampaignState`, а не выводимая величина.** Соблазн считать её «на
 * лету из журнала контрактов» отвергнут сразу: журнал не хранится (снимок — это
 * состояние, а не список команд, `save.ts`), и пересчёт по нему сделал бы
 * загруженную кампанию ДРУГОЙ. Поэтому репутация меняется только командами и
 * входит в хэш, ровно как деньги и парк.
 *
 * **Разрежённость обязательна.** В снимок ложатся только фракции и пары,
 * отличные от начальных. Плотная запись стоила бы 20 фракций и 190 пар в
 * КАЖДОМ сохранении с первого дня — та же ловушка, что решена в галактике
 * дельтами (`galaxy/delta.ts`), и решается она тем же приёмом.
 */
export interface ReputationState {
  /**
   * Отношение фракции к отряду, −100..+100. Разрежённая карта: фракции, к
   * которым отношение ровно нулевое, здесь не значатся вовсе.
   */
  readonly standing: Readonly<Record<string, number>>;
  /** Известность: «о вас слышали». Одна на отряд, 0..100. */
  readonly fame: number;
  /** Надёжность: «вам можно доверять». Одна на отряд, 0..100, не затухает. */
  readonly reliability: number;
  /**
   * Матрица отношений ФРАКЦИЙ друг к другу, −1..+1, — то, чем «враг моего
   * врага» отличается от списка частных случаев.
   *
   * Разрежённая: здесь лежат только пары, отличные от выведенных из
   * `data/galaxy/relations.json`. Шаг 20 матрицу ЧИТАЕТ (по ней расходится
   * изменение репутации, `accrual.ts`), а ДВИГАЕТ её тикер войны — такт фронта
   * шага 21b (`commands/execute.ts::applyFrontTask`): каждое наступление уводит
   * пару вниз на `war.front.relationPerMove`. Ради этого порядок шагов 20 → 21 и
   * не менялся (`wiki/decisions.md`, 2026-09-03). Поле заведено здесь, а не там,
   * чтобы `rulesVersion`, схема снимка и хэш поднимались один раз, а не дважды
   * подряд.
   */
  readonly relations: Readonly<Record<string, number>>;
}

/** Свежая репутация: отношение и известность с нуля, надёжность — стартовая (решение 2026-09-03). */
export function makeReputation(): ReputationState {
  return {
    standing: {},
    fame: 0,
    reliability: REPUTATION.axes.reliabilityStart,
    relations: {},
  };
}

/**
 * Пустая репутация — для мест, где матрица не передана вовсе.
 *
 * Нужна с шага 26: живую вражду читают биржа и сводки, а у них репутация
 * необязательный аргумент ещё с шага 20. Пустая матрица по построению даёт ровно
 * статичную таблицу 3053 года, поэтому такая подстановка ничего не выдумывает —
 * она возвращает ровно то, что было до шага 26.
 */
export const NO_REPUTATION: ReputationState = Object.freeze(makeReputation());

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Округление осей до сотых.
 *
 * Не косметика: по сети расходятся дробные прибавки (12 × −0.8 × 0.3), и без
 * округления в снимок и в хэш попадали бы хвосты двоичной дроби. Читаемая
 * строка состояния — половина смысла хэша (`hash.ts`).
 */
export function roundAxis(v: number): number {
  return Math.round(v * 100) / 100;
}

// --- чтение -------------------------------------------------------------------

export function standingOf(rep: ReputationState, factionId: string): number {
  return rep.standing[factionId] ?? 0;
}

/**
 * Отношение двух фракций друг к другу, −1..+1.
 *
 * Начальное значение выводится из статичной вражды: `1 − 2 × вражда`. Так
 * политическая карта 3053 года не переписывается заново, а получает знак и
 * подвижность: тотальная война (вражда 1) даёт −1, «воевать не о чем» (0) даёт
 * +1. Фракция сама с собой — всегда +1, и это тождество, а не запись в таблице.
 */
export function initialRelation(a: string, b: string): number {
  return 1 - 2 * enmity(a, b);
}

export function relationOf(rep: ReputationState, a: string, b: string): number {
  if (a === b) return 1;
  return rep.relations[factionPairKey(a, b)] ?? initialRelation(a, b);
}

/**
 * ЖИВАЯ ВРАЖДА (шаг 26, часть A) — точное обращение `initialRelation`.
 *
 * ```
 * relation = 1 − 2 × вражда        →        вражда = (1 − relation) / 2
 * ```
 *
 * Это та самая функция, ради которой затевалась часть A шага 26. До неё петля
 * была разомкнута ровно посередине: война портила отношения
 * (`front.relationPerMove` на каждое наступление), а отношения на войну не
 * влияли — участок фронта, вес участка и раскладка военного фонда читали
 * СТАТИЧНУЮ таблицу `data/galaxy/relations.json`. Десять лет боёв не приближали
 * и не отдаляли ни одного наступления.
 *
 * **Пустая матрица обязана дать побайтово сегодняшний мир, и она его даёт.**
 * Заметьте, что при отсутствии записи возвращается `enmity(a, b)` НАПРЯМУЮ, а
 * не пересчёт `(1 − initialRelation(a, b)) / 2`. Это не оптимизация: два
 * округления двоичной дроби подряд не сокращаются. При вражде 0.15 обратный
 * путь даёт 0.15000000000000002, и хэш кампании на чистом старте разошёлся бы с
 * дошаговым на пустом месте.
 *
 * `withRelation` при этом УДАЛЯЕТ запись, совпавшую с выведенной, — значит,
 * пара, вернувшаяся к базовой линии, снова читается точно.
 */
export function liveEnmity(rep: ReputationState, a: string, b: string): number {
  if (a === b) return 0;
  const stored = rep.relations[factionPairKey(a, b)];
  return stored === undefined ? enmity(a, b) : (1 - clamp(stored, -1, 1)) / 2;
}

/**
 * С кем у фракции ЖИВАЯ вражда не ниже порога — то же, что `enemiesOf`, но по
 * матрице, а не по таблице 3053 года.
 *
 * Отсортировано по id: порядок обхода задаёт раскладку военного фонда и потому
 * обязан быть воспроизводим, а не «как получилось».
 */
export function liveEnemiesOf(
  rep: ReputationState,
  id: string,
  minEnmity: number,
): readonly { readonly id: string; readonly enmity: number }[] {
  return FACTION_LIST.filter((f) => f.id !== id)
    .map((f) => ({ id: f.id, enmity: liveEnmity(rep, id, f.id) }))
    .filter((e) => e.enmity >= minEnmity)
    .sort((x, y) => (x.id < y.id ? -1 : 1));
}

/**
 * Полоса отношения — то, что видит игрок вместо числа.
 *
 * Порог фронта (`war.json` → `front.minEnmity` = 0.4) отвечает отношению 0.2,
 * то есть верхней границе «холода»: участок фронта порождают полосы «война»,
 * «вражда» и «холод», а начиная с «нейтралитета» пара уже не воюет.
 */
export type RelationBand = 'war' | 'feud' | 'cold' | 'neutral' | 'accord' | 'alliance';

export function relationBand(value: number): RelationBand {
  const b = RELATIONS.bands;
  if (value < b.feud) return 'war';
  if (value < b.cold) return 'feud';
  if (value < b.neutral) return 'cold';
  if (value < b.accord) return 'neutral';
  if (value < b.alliance) return 'accord';
  return 'alliance';
}

// --- запись -------------------------------------------------------------------

/**
 * Прибавить отношение одной фракции. Возвращает НОВОЕ состояние — репутация
 * неизменяема, как и всё остальное внутри `CampaignState`.
 *
 * Запись, вернувшаяся к нулю, из карты УДАЛЯЕТСЯ: иначе разрежённость
 * протекала бы через затухание — оно только тем и занято, что тянет значения к
 * нулю, и через год игры плотная карта собралась бы сама.
 */
export function withStanding(rep: ReputationState, factionId: string, delta: number): ReputationState {
  const next = roundAxis(
    clamp(standingOf(rep, factionId) + delta, REPUTATION.axes.standingMin, REPUTATION.axes.standingMax),
  );
  const standing = { ...rep.standing };
  if (next === 0) delete standing[factionId];
  else standing[factionId] = next;
  return { ...rep, standing };
}

export function withFame(rep: ReputationState, delta: number): ReputationState {
  return { ...rep, fame: roundAxis(clamp(rep.fame + delta, 0, REPUTATION.axes.fameMax)) };
}

export function withReliability(rep: ReputationState, delta: number): ReputationState {
  return {
    ...rep,
    reliability: roundAxis(clamp(rep.reliability + delta, 0, REPUTATION.axes.reliabilityMax)),
  };
}

/**
 * Переписать отношение пары фракций. Шов для тикера войны, и с шага 21b он
 * действительно зовётся — тактом фронта, на каждое наступление
 * (`commands/execute.ts::applyFrontTask`). Шаг 20 сам его не звал нигде, кроме
 * теста, доказывавшего, что переписанная пара читается сетью, а не украшает
 * снимок.
 *
 * Значение, совпавшее с выведенным из `relations.json`, из карты удаляется —
 * та же дисциплина разрежённости, что у отношения к отряду.
 */
export function withRelation(rep: ReputationState, a: string, b: string, value: number): ReputationState {
  if (a === b) return rep;
  const key = factionPairKey(a, b);
  const next = Math.round(clamp(value, -1, 1) * 1000) / 1000;
  const relations = { ...rep.relations };
  if (next === Math.round(initialRelation(a, b) * 1000) / 1000) delete relations[key];
  else relations[key] = next;
  return { ...rep, relations };
}

/**
 * Затухание (задача очереди суток `decayTick`, раз в месяц).
 *
 * Отношение тянется к нулю на пункт, известность — медленнее, надёжность НЕ
 * затухает вовсе: доверие набирается годами и само не восстанавливается.
 * Без затухания мир к середине кампании застывает — все либо навсегда друзья,
 * либо навсегда враги.
 *
 * Матрицу фракций затухание не трогает: она про политическую карту, а не про
 * отряд, и стянутая к нулю карта означала бы Сферу, в которой все со всеми
 * помирились сами собой.
 *
 * `held` — фракции, с которыми у державы роты действует договор (отладка 2026-10-03): доброе отношение к ним не
 * тает, пока договор в силе. Без этого у державы, переставшей брать контракты, отношение со всеми сходило к нулю,
 * и пороги покупки мира и договора закрывались навсегда; обида (отрицательное отношение) тает как обычно.
 *
 * `grudges` — соседи, встревоженные ростом державы роты (шаг 91, `war/playerWar.ts::realmAlarm`): их обида не тает, пока
 * держава растёт у их границы. Без этого тревога упиралась в затухание вражды (4 пункта в месяц ниже порога работы), и
 * отношение соседа к растущей державе стояло у −20, не доходя до объявления войны (замер шага 91).
 */
export function decayReputation(
  rep: ReputationState,
  held: ReadonlySet<string> = new Set(),
  grudges: ReadonlySet<string> = new Set(),
): ReputationState {
  // Глубокая вражда — ниже порога, за которым наниматель не даёт никакой работы, —
  // остывает быстрее (решение пользователя 2026-09-14): старые обиды гаснут, а
  // свежая дружба не стирается. Иначе из −60 рота выбиралась бы три года.
  const floor = hostileFloor();
  const standing: Record<string, number> = {};
  for (const id of Object.keys(rep.standing).sort()) {
    const v = rep.standing[id] as number;
    if ((v > 0 && held.has(id)) || (v < 0 && grudges.has(id))) {
      standing[id] = v;
      continue;
    }
    const step = v < floor ? REPUTATION.decay.hostileStandingPerTick : REPUTATION.decay.standingPerTick;
    const next = roundAxis(v > 0 ? Math.max(0, v - step) : Math.min(0, v + step));
    if (next !== 0) standing[id] = next;
  }
  return {
    ...rep,
    standing,
    fame: roundAxis(Math.max(0, rep.fame - REPUTATION.decay.famePerTick)),
  };
}

/** Фракции, к которым отношение не нулевое, — от лучшего к худшему. Для экрана и для замера. */
export function standingList(
  rep: ReputationState,
): readonly { readonly id: string; readonly standing: number }[] {
  return FACTION_LIST.map((f) => ({ id: f.id, standing: standingOf(rep, f.id) })).sort((a, b) =>
    a.standing !== b.standing ? b.standing - a.standing : a.id < b.id ? -1 : 1,
  );
}

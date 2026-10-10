/**
 * Парк, порезанный на звенья (шаг 60).
 *
 * Порядок ЗАДАЁТ группу, а не наоборот: звено — это «машины с позиции 1 по 4»,
 * «с 5 по 8» и так далее в массиве `company.mechs` (его двигает команда
 * `reorderMechs`). Нового поля данных нет, поэтому трофей, вставленный
 * перетаскиванием в середину парка, сдвигает все звенья ниже на одну позицию —
 * это следствие модели, и интерфейс говорит о нём подсказкой у заголовка.
 *
 * Функции чистые: списков парка два (ангар и мехлаб), плюс окно вывода на
 * контракт, и резать они должны одинаково.
 */

export interface LanceGroup<T> {
  /** Номер звена с единицы. */
  readonly number: number;
  readonly mechs: readonly T[];
  /** Сколько машин в звене сейчас; `size - count` — сколько не хватает до полного. */
  readonly count: number;
  readonly size: number;
}

/** Режет парк подряд на звенья по `size` машин; последнее может быть неполным. */
export function lanceGroups<T>(mechs: readonly T[], size: number): LanceGroup<T>[] {
  const step = Math.max(1, Math.floor(size));
  const groups: LanceGroup<T>[] = [];
  for (let i = 0; i < mechs.length; i += step) {
    const slice = mechs.slice(i, i + step);
    groups.push({ number: groups.length + 1, mechs: slice, count: slice.length, size: step });
  }
  return groups;
}

/** Почему машина не годна к вылету — для строки под кнопкой звена. */
export type SkipReason = 'stationed' | 'wreck' | 'inWork' | 'noPilot';

export interface LanceCandidate {
  readonly id: string;
  /** `null` — годна к вылету (решение принимает `campaign.deployable`, не этот файл). */
  readonly skip: SkipReason | null;
}

export interface TakeLanceResult {
  /** Новый выбор целиком: чужие выбранные машины на месте. */
  readonly lance: readonly string[];
  /** Что кнопка сделала: набрала звено или сняла его. */
  readonly action: 'added' | 'removed';
  /** Не годные машины звена по причинам. */
  readonly skipped: Readonly<Partial<Record<SkipReason, number>>>;
  /** Годные, которым не хватило места под потолок судна. */
  readonly overflow: number;
}

/**
 * Кнопка «звено N»: одна на группу, и это выбор ГОДНЫХ, а не цикл «нажать на
 * каждую строку». Если все годные машины звена уже отмечены — кнопка снимает
 * именно их (без неё пришлось бы снимать по одной, чтобы освободить место
 * другому звену); иначе добавляет недостающих в порядке списка, пока не упрётся
 * в `maxDeploy`. Машины из других звеньев не трогаются ни в одном из случаев,
 * поэтому «звено 1 целиком плюс пара из звена 2» собирается обычными щелчками.
 *
 * Годность здесь только КЛАССИФИЦИРУЕТСЯ для подписи; отказ вылета целиком по
 * прежнему выдаёт ядро (`campaign.why({ kind: 'deploy' })`).
 */
export function takeLance(
  group: readonly LanceCandidate[],
  current: readonly string[],
  maxDeploy: number,
): TakeLanceResult {
  const skipped: Partial<Record<SkipReason, number>> = {};
  const fit: string[] = [];
  for (const m of group) {
    if (m.skip === null) fit.push(m.id);
    else skipped[m.skip] = (skipped[m.skip] ?? 0) + 1;
  }

  const chosen = new Set(current);
  if (fit.length > 0 && fit.every((id) => chosen.has(id))) {
    const drop = new Set(fit);
    return { lance: current.filter((id) => !drop.has(id)), action: 'removed', skipped, overflow: 0 };
  }

  const lance = [...current];
  let overflow = 0;
  for (const id of fit) {
    if (chosen.has(id)) continue;
    if (lance.length >= maxDeploy) overflow++;
    else lance.push(id);
  }
  return { lance, action: 'added', skipped, overflow };
}

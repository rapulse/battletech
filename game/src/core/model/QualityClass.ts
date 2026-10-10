/**
 * Класс исполнения узла — вторая валюта конструирования
 * (wiki/design/mechs/classification.md §5).
 *
 * Тир отвечает на вопрос «какая машина мне нужна» и платится тоннами. Класс
 * отвечает на «насколько она хороша и что я готов за это заплатить» и платится
 * деньгами. Смешивать оси нельзя: одна съест другую.
 *
 * Здесь только имена и порядок. Числа — в `data/quality.json`, применяет их
 * `core/rules/construction.ts` (единственное место, где считается масса).
 *
 * Порядок массива — это шкала «хуже → лучше», и на неё опираются повышение
 * класса при ремонте и понижение при износе. Менять порядок нельзя.
 */
export const QUALITY_CLASS_IDS = ['recovered', 'standard', 'military', 'master'] as const;

export type QualityClass = (typeof QUALITY_CLASS_IDS)[number];

/**
 * Класс по умолчанию.
 *
 * Отсутствие класса означает серийный, и это не мелочь: только так весь замер
 * баланса Части 1 остаётся действительным после появления таблицы классов.
 * Эталонные сценарии обязаны оставаться серийными жёстко — иначе мерило
 * поедет вместе с экономикой (`wiki/design/mechs/classification.md` §5,
 * «Что этот выбор ломает»).
 */
export const DEFAULT_QUALITY_CLASS: QualityClass = 'standard';

/** Классы двух узлов, у которых он вообще есть: реактора и каркаса. */
export interface MechQuality {
  readonly reactor: QualityClass;
  readonly frame: QualityClass;
}

export const STANDARD_QUALITY: MechQuality = {
  reactor: DEFAULT_QUALITY_CLASS,
  frame: DEFAULT_QUALITY_CLASS,
};

/** Позиция класса на шкале: 0 — восстановленный, 3 — мастерский. */
export function qualityRank(cls: QualityClass): number {
  return QUALITY_CLASS_IDS.indexOf(cls);
}

/** Соседний класс на шкале. Возвращает тот же, если дальше двигаться некуда. */
export function shiftQuality(cls: QualityClass, steps: number): QualityClass {
  const i = qualityRank(cls) + steps;
  const clamped = Math.max(0, Math.min(QUALITY_CLASS_IDS.length - 1, i));
  return QUALITY_CLASS_IDS[clamped] as QualityClass;
}

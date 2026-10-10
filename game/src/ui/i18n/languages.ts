/**
 * Языки игры (шаг 52).
 *
 * Список короткий намеренно: язык появляется здесь, когда у него есть файлы
 * `ui/i18n/<язык>.json` и `core/log/<язык>.json`. Английский интерфейс — пока
 * заготовка: непереведённая строка показывается ключом, и это видно сразу.
 */

export const LANGUAGE_IDS = ['ru', 'en'] as const;

export type LanguageId = (typeof LANGUAGE_IDS)[number];

export const DEFAULT_LANGUAGE: LanguageId = 'ru';

/**
 * Самоназвание языка. В списке выбора язык называет себя сам и НЕ переводится:
 * игрок, случайно включивший незнакомый язык, обязан найти дорогу обратно.
 */
export const LANGUAGE_NAMES: Readonly<Record<LanguageId, string>> = {
  ru: 'Русский', // i18n-ignore: самоназвание языка, в списке выбора не переводится
  en: 'English',
};

export function isLanguageId(value: unknown): value is LanguageId {
  return typeof value === 'string' && (LANGUAGE_IDS as readonly string[]).includes(value);
}

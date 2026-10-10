/**
 * Настройки игрока в браузере (шаг 52): язык интерфейса и язык названий оружия.
 *
 * `localStorage`, а не IndexedDB сохранений: это пара коротких строк, которые
 * нужны синхронно при запуске, до первого кадра, и к кампании они не относятся —
 * настройка принадлежит игроку, а не роте. Живёт в `platform/`, потому что это
 * разговор с браузером, как и хранилище сохранений.
 *
 * Хранилище может быть закрыто (приватное окно, запрет сайта) — тогда чтение
 * отдаёт пустые настройки, а запись молча не сохраняется: выбор живёт до
 * перезагрузки страницы, и игра от этого не падает.
 */

const KEY = 'battletech.preferences';

export interface Preferences {
  readonly interfaceLanguage?: string;
  readonly termsLanguage?: string;
}

export function loadPreferences(): Preferences {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (raw === null || raw === undefined) return {};
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as Preferences) : {};
  } catch {
    return {};
  }
}

export function savePreferences(preferences: Preferences): void {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(preferences));
  } catch {
    // Хранилище закрыто: выбор действует до перезагрузки, см. комментарий модуля.
  }
}

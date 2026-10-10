import { setCoreLanguages } from '../../core/log/index.js';
import en from './en.json';
import { DEFAULT_LANGUAGE, type LanguageId } from './languages.js';
import ru from './ru.json';

/**
 * Локализация интерфейса (game_core.md §7, ловушка 3 шага 17).
 *
 * Термины BattleTech каноничны по-английски, интерфейс русский. Без словаря это
 * потом не расшить: русская строка, вписанная прямо в разметку, не находится
 * поиском по ключу, не проверяется на полноту и требует переписать все экраны,
 * когда понадобится второй язык.
 *
 * Что здесь СОЗНАТЕЛЬНО не сделано. Библиотеки нет — ни `i18next`, ни `svelte-i18n`:
 * им нужно то, чего у нас не будет (загрузка по сети, форматирование дат по
 * локали), а стоят они зависимостью и слоем реактивности поверх словаря.
 * `t()` — это поиск по объекту и подстановка.
 *
 * **Язык как настройка** (шаг 52). Словарь, формы множественного числа и
 * разделитель разрядов выбираются `setLanguages`; вызывает её состояние
 * настроек (`ui/state/settings.svelte.ts`), а экраны пересобираются корнем
 * приложения. Реактивности внутри `t()` по-прежнему нет: смена языка — редкое
 * событие, и пересборка экранов проще, чем подписка каждой строки.
 *
 * Ключи — точечные пути (`hangar.title`), значения — строки с плейсхолдерами
 * `{имя}`. Отсутствующий ключ возвращается САМ СОБОЙ, а не пустой строкой: на
 * экране видно `hangar.title`, а не дыра, и опечатка — или непереведённая
 * строка заготовки — находится глазами за секунду. Тест `test/i18n.test.ts`
 * ловит их и без глаз.
 */

type Dict = { readonly [key: string]: string | Dict };

const DICTIONARIES: Readonly<Record<LanguageId, Dict>> = { ru, en };

/**
 * Разделитель разрядов в суммах — часть языка, а не строка словаря: без него
 * сумма нечитаема даже в заготовке перевода. У русского — неразрывный пробел,
 * чтобы сумма не переносилась посреди числа.
 */
const GROUP_SEPARATOR: Readonly<Record<LanguageId, string>> = { ru: ' ', en: ',' };

let language: LanguageId = DEFAULT_LANGUAGE;
let DICT: Dict = DICTIONARIES[DEFAULT_LANGUAGE];
let pluralRules = new Intl.PluralRules(DEFAULT_LANGUAGE);

/**
 * Выбрать язык интерфейса и язык терминов (названия оружия и систем).
 * Второй уходит в словарь ядра: термины переводит он (`core/log/dictionary.ts`).
 */
export function setLanguages(interfaceLanguage: LanguageId, termsLanguage: LanguageId): void {
  language = interfaceLanguage;
  DICT = DICTIONARIES[interfaceLanguage];
  pluralRules = new Intl.PluralRules(interfaceLanguage);
  setCoreLanguages(interfaceLanguage, termsLanguage);
}

/** Текущий выбранный язык интерфейса (шаг 74). */
export function currentLanguage(): LanguageId {
  return language;
}

/** Значение по точечному пути. `undefined` — такого ключа в словаре нет. */
function lookup(dict: Dict, key: string): string | undefined {
  let node: string | Dict | undefined = dict;
  for (const part of key.split('.')) {
    if (typeof node !== 'object' || node === null) return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

export type TParams = Readonly<Record<string, string | number>>;

/**
 * Строка интерфейса по ключу.
 *
 * `t('contracts.payout', { sum: '340 000' })` → «Гонорар: 340 000 C-Bills».
 * Плейсхолдер без значения остаётся в тексте как есть — та же логика, что и с
 * отсутствующим ключом: пусть видно, что не подставилось.
 */
export function t(key: string, params?: TParams): string {
  const raw = lookup(DICT, key);
  if (raw === undefined) return key;
  if (params === undefined) return raw;
  return raw.replace(/\{(\w+)\}/g, (whole, name: string) => {
    const value = params[name];
    return value === undefined ? whole : String(value);
  });
}

export interface TPart {
  readonly text: string;
  /** Кусок пришёл из подставленного значения — разметка выделяет его (жирным, кнопкой). */
  readonly param: boolean;
  /** Имя плейсхолдера у куска-значения: выделять можно не все подстановки фразы. */
  readonly name?: string;
}

/**
 * Строка по ключу, разрезанная на куски по плейсхолдерам (шаг 52).
 *
 * Для фраз, где внутри предложения стоит выделенный кусок: «Нажмите
 * <b>[К СТРЕЛЬБЕ →]</b> вверху». Резать такую фразу на два ключа «до» и
 * «после» нельзя — в другом языке кнопка встанет в другое место предложения.
 * Фраза остаётся одной строкой словаря, а разметка рисует куски-значения
 * по-своему, без `{@html}`.
 */
export function tParts(key: string, params: TParams): TPart[] {
  const raw = lookup(DICT, key) ?? key;
  const parts: TPart[] = [];
  let last = 0;
  for (const m of raw.matchAll(/\{(\w+)\}/g)) {
    const value = params[m[1] as string];
    if (value === undefined) continue;
    const at = m.index ?? 0;
    if (at > last) parts.push({ text: raw.slice(last, at), param: false });
    parts.push({ text: String(value), param: true, name: m[1] as string });
    last = at + m[0].length;
  }
  if (last < raw.length) parts.push({ text: raw.slice(last), param: false });
  return parts;
}

/** Есть ли такой ключ в словаре выбранного языка. */
export function hasKey(key: string): boolean {
  return lookup(DICT, key) !== undefined;
}

/**
 * Подсказка оборудования (ангар, мехлаб, рынок).
 * Возвращает развёрнутое описание назначения и боевой механики системы.
 */
export function equipmentHint(id: string, fallbackName?: string): string {
  const key = `hangar.mountEquipmentDesc.${id}`;
  if (hasKey(key)) return t(key);
  return fallbackName !== undefined ? t('hangar.mountEquipmentHint', { name: fallbackName }) : '';
}

/** Все ключи словаря плоским списком — для теста полноты. По умолчанию — выбранного языка. */
export function allKeys(dict: Dict = DICT, prefix = ''): string[] {
  const out: string[] = [];
  for (const [name, value] of Object.entries(dict)) {
    const key = prefix === '' ? name : `${prefix}.${name}`;
    if (typeof value === 'string') out.push(key);
    else out.push(...allKeys(value, key));
  }
  return out;
}

// --- форматирование чисел и дат ------------------------------------------------

/**
 * C-Bills с разделителем разрядов выбранного языка.
 *
 * Формат денег — часть локали, а не украшение: `1450000` в кассе роты читается
 * как ошибка вёрстки.
 */
export function cbills(amount: number): string {
  const sign = amount < 0 ? '−' : '';
  const digits = Math.abs(Math.round(amount)).toString();
  const spaced = digits.replace(/\B(?=(\d{3})+(?!\d))/g, GROUP_SEPARATOR[language]);
  return `${sign}${spaced}`;
}

/** То же со знаком плюса у положительных: доплата, аванс, начисленный опыт. */
export function signedCbills(amount: number): string {
  return amount > 0 ? `+${cbills(amount)}` : cbills(amount);
}

/**
 * Дата Внутренней Сферы словами: «12 мая 3053».
 *
 * Календарь считает ядро (`core/campaign/clock.ts::dateOf`) — здесь только
 * названия месяцев и порядок частей, оба из словаря (`date.*`). Считать дату
 * второй раз в слое показа значило бы завести второй календарь, а он однажды
 * разойдётся с первым на високосном году.
 */
export function formatDate(date: { year: number; month: number; day: number }): string {
  const monthKey = `date.months.${date.month}`;
  const month = hasKey(monthKey) ? t(monthKey) : String(date.month);
  return t('date.format', { day: date.day, month, year: date.year });
}

/**
 * Число со словом в нужной форме: `tn('count.jumps', 3)` → «3 прыжка» (шаг 52).
 *
 * Формы лежат в словаре под категориями CLDR (`one`, `few`, `many`, `other`), а
 * выбирает категорию `Intl.PluralRules` языка. Формы — часть языка, а не кода:
 * у русского их три, у английского две, и `plural(n, 'мир', 'мира', 'миров')`
 * в разметке перевести было нельзя. `other` — обязательный запасной вариант.
 */
export function tn(key: string, n: number, params?: TParams): string {
  const category = pluralRules.select(n);
  const form = hasKey(`${key}.${category}`) ? `${key}.${category}` : `${key}.other`;
  return t(form, { n, ...params });
}

/** «3 дня», «1 день» — срок работы стапеля и перелёта. */
export function days(n: number): string {
  return tn('count.days', n);
}

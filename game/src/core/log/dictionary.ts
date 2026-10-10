import en from './en.json';
import ru from './ru.json';

/**
 * Словарь ядра: термины, причины, журнал боя, текстовый отчёт.
 *
 * Правила и события оперируют ключами (`zone.head`, `botch.heat`), а не текстом:
 * иначе перевод и правка формулировок означали бы правку правил боя. Здесь —
 * единственное место, где ключ превращается в слова. Слова лежат в JSON по
 * языкам (`ru.json`, `en.json`): второй язык — второй файл того же вида.
 *
 * **Два языка сразу** (решение пользователя, шаг 52). Названия оружия,
 * оборудования и боезапаса (`weapon.*`, `equipment.*`) — термины BattleTech, и
 * игрок выбирает их язык отдельно от языка интерфейса: канонические английские
 * «Medium Laser» и «LRM 10» при русском интерфейсе — законный выбор, а не
 * недоперевод. Остальные ключи идут языком интерфейса.
 *
 * Выбор языка — настройка показа, а не состояние боя или кампании: он не
 * входит ни в сохранение, ни в хеш, и бой, проигранный на английском, побитово
 * совпадает с тем же боем на русском. Поэтому он живёт переменной модуля, а не
 * командой. Headless-прогон (`sim`) языка не выбирает и пишет по-русски.
 */

export type CoreDict = Readonly<Record<string, string>>;

const DICTIONARIES: Readonly<Record<string, CoreDict>> = { ru, en };

let interfaceDict: CoreDict = ru;
let termsDict: CoreDict = ru;

/** Выбрать языки: интерфейса и терминов. Неизвестный язык — русский, а не пустота. */
export function setCoreLanguages(interfaceLanguage: string, termsLanguage: string): void {
  interfaceDict = DICTIONARIES[interfaceLanguage] ?? ru;
  termsDict = DICTIONARIES[termsLanguage] ?? ru;
}

/** Термин ли это: название оружия, оборудования или боезапаса. */
export function isTermKey(key: string): boolean {
  return key.startsWith('weapon.') || key.startsWith('equipment.');
}

/** Перевод ключа. Неизвестный ключ возвращается как есть — молча терять текст нельзя. */
export function tr(key: string): string {
  return (isTermKey(key) ? termsDict : interfaceDict)[key] ?? key;
}

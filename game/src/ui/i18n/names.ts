import { hasKey, t } from './index.js';

/**
 * Названия, которые игра не выдумывает и не записывает в сохранение: фракции, отряды реестра MRBC
 * и классы десантных кораблей (шаг 64б).
 *
 * Каждое названо в данных (`data/galaxy/factions.json`, `data/rivals.json`, `data/economy.json`)
 * ПО-РУССКИ и в словаре интерфейса — на обоих языках, по id: `faction.name.<id>`, `faction.short.<id>`,
 * `merc.name.<id>`, `merc.base.<id>`, `dropship.<id>`. Экран спрашивает эти функции, а не читает поле
 * `name` данных, иначе в английском режиме среди английского текста стояли бы русские названия.
 *
 * **Запасной ответ — строка из данных, а не ключ.** Новая фракция без перевода покажется своим русским
 * именем, а не `faction.name.xxx`; тест `i18n.test.ts` перебирает id данных и не даст такой дыре дожить
 * до плейтеста.
 *
 * Что здесь НЕ переводится: имя роты и позывные, которые ввёл игрок; строки, которые игра создаёт сама
 * и записывает в сохранение («Вольный отряд №7», позывной «Враг-3») — они остаются на языке, на котором
 * созданы (`data/names.json → defaults`), иначе пришлось бы хранить в сохранении вид и число вместо текста.
 */

function byId(key: string, fallback: string): string {
  return hasKey(key) ? t(key) : fallback;
}

/** Полное название фракции: «Клан Волка», «Лига Свободных Миров». */
export function factionFullName(id: string, fallback: string = id): string {
  return byId(`faction.name.${id}`, fallback);
}

/** Короткое название фракции для строк таблиц и значков: «Волки», «Марик». */
export function factionShortName(id: string, fallback: string = id): string {
  return byId(`faction.short.${id}`, fallback);
}

/** Название отряда реестра MRBC по id реестра; вольный отряд (`unitId` пуст) и незнакомый id — как записано. */
export function mercName(unitId: string, fallback: string): string {
  return unitId === '' ? fallback : byId(`merc.name.${unitId}`, fallback);
}

/** База отряда реестра MRBC. */
export function mercBase(unitId: string, fallback: string): string {
  return unitId === '' ? fallback : byId(`merc.base.${unitId}`, fallback);
}

/** Название класса десантного корабля. */
export function dropshipName(id: string, fallback: string = id): string {
  return byId(`dropship.${id}`, fallback);
}

import { isWarehousePart, type WarehouseEntry } from '../../core/campaign/company/types.js';
import { ITEM_FAMILIES, itemFamilyOf } from '../../core/campaign/market/pricing.js';
import { qualityRank } from '../../core/model/QualityClass.js';

/**
 * Склад стопками: одинаковые записи показываются одной строкой с числом.
 *
 * Склад разрастается (десять теплоотводов подряд читались как десять строк),
 * а игроку важно «что и сколько», а не номера записей. Стопка — только вид на
 * экране: в состоянии кампании по-прежнему отдельные записи со своими id,
 * команды (`sellPart`, `installPart`) принимают id одной записи, и экран отдаёт
 * им `head`.
 *
 * Одинаковыми считаются записи, у которых совпадает всё, от чего зависит цена и
 * годность: у установки — её id; у узла — вид, класс, тоннаж, тир и износ.
 * Округлять износ нельзя: две «одинаковые на вид» записи с разной ценой
 * выкупа в одной стопке дали бы цену, зависящую от того, какая лежит сверху.
 */
export interface WarehouseStack<T extends WarehouseEntry> {
  readonly key: string;
  /** Запись, с которой работают кнопки стопки: первая из стопки. */
  readonly head: T;
  readonly entries: readonly T[];
  readonly count: number;
}

/** Ключ, по которому записи сливаются в стопку. */
export function stackKey(entry: WarehouseEntry): string {
  return isWarehousePart(entry)
    ? `node|${entry.node}|${entry.quality}|${entry.sourceTonnage}|${entry.tier}|${entry.wear}`
    : `item|${entry.itemId}`;
}

/**
 * Порядок склада: сперва установки по родам (энергетическое, баллистическое,
 * ракетное, системы, боезапас), внутри рода — по названию; потом узлы (реактор,
 * каркас, класс, тоннаж, тир, износ).
 *
 * Порядок НЕ должен зависеть от того, какие именно записи стопки ещё лежат:
 * при установке уходят первые записи, и стопка, поставленная «по месту первой
 * записи», проваливалась бы вниз списка и терялась (замечено пользователем
 * 2026-09-20). Название подставляет экран: словарь ядру не принадлежит.
 */
export function stackOrder(
  nameOf: (itemId: string) => string,
): (a: WarehouseEntry, b: WarehouseEntry) => number {
  const rank = (e: WarehouseEntry): number => (isWarehousePart(e) ? ITEM_FAMILIES.length : ITEM_FAMILIES.indexOf(itemFamilyOf(e.itemId)));
  return (a, b) => {
    if (rank(a) !== rank(b)) return rank(a) - rank(b);
    if (isWarehousePart(a) && isWarehousePart(b)) {
      return (
        a.node.localeCompare(b.node) ||
        qualityRank(b.quality) - qualityRank(a.quality) ||
        a.sourceTonnage - b.sourceTonnage ||
        a.tier - b.tier ||
        a.wear - b.wear
      );
    }
    if (!isWarehousePart(a) && !isWarehousePart(b)) {
      return nameOf(a.itemId).localeCompare(nameOf(b.itemId), 'ru') || a.itemId.localeCompare(b.itemId);
    }
    return 0;
  };
}

/**
 * Собрать стопки. Без `order` — в порядке первого появления записи; с ним — в
 * заданном, при равенстве свободные раньше занятых, дальше по ключу.
 *
 * `split` — признак, по которому записи с одинаковым ключом всё же не смешиваются
 * (склад рынка отделяет занятые работой цеха: их нельзя продать, и в одной
 * стопке с продаваемыми кнопка «Продать» отказывала бы при живом остатке).
 */
export function stackWarehouse<T extends WarehouseEntry>(
  entries: readonly T[],
  split: (entry: T) => string = () => '',
  order?: (a: T, b: T) => number,
): WarehouseStack<T>[] {
  const keys: string[] = [];
  const groups = new Map<string, T[]>();
  for (const entry of entries) {
    const key = `${stackKey(entry)}#${split(entry)}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, [entry]);
      keys.push(key);
    } else {
      group.push(entry);
    }
  }
  const stacks = keys.map((key) => {
    const group = groups.get(key) as T[];
    return { key, head: group[0] as T, entries: group, count: group.length };
  });
  if (order !== undefined) {
    stacks.sort((a, b) => order(a.head, b.head) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  }
  return stacks;
}

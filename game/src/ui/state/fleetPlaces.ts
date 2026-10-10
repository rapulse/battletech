/**
 * Где стоят машины парка: корабль или мир гарнизона (шаг 86b), — для выбора над
 * списком парка в ангаре и мехлабе.
 *
 * Функции чистые: место машины, название мира и допуск мира приходят снаружи,
 * поэтому оба экрана режут парк одинаково, а мехлаб лишь сужает выбор до миров
 * с цехом.
 */

import { lanceGroups, type LanceGroup } from './lanceGroups.js';

export interface FleetPlace {
  readonly id: string;
  readonly name: string;
  /** Машин роты на мире, включая идущие туда и стоящие на складе. */
  readonly count: number;
}

/** Миры, где стоят машины роты, по названию; `allow` отсекает миры, которые экрану не нужны. */
export function fleetPlaces(
  mechs: readonly { readonly id: string }[],
  placeOf: (id: string) => string | null,
  nameOf: (systemId: string) => string,
  allow: (systemId: string) => boolean = () => true,
): FleetPlace[] {
  const worlds = new Map<string, number>();
  for (const m of mechs) {
    const id = placeOf(m.id);
    if (id !== null && allow(id)) worlds.set(id, (worlds.get(id) ?? 0) + 1);
  }
  return [...worlds]
    .map(([id, count]) => ({ id, name: nameOf(id), count }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Список парка для места: `null` — корабль, иначе мир.
 *
 * Звенья — позиции во ВСЁМ парке (как в окне вывода на контракт), поэтому
 * режутся до отбора: номер звена не зависит от того, кто сейчас на мире. На
 * корабле видны звенья с машинами на борту, счётчик звена — по ним. Гарнизон —
 * не звено: он одна группа с номером 0, заголовок звена ей не рисуют.
 */
export function placeGroups<T extends { readonly id: string }>(
  mechs: readonly T[],
  lanceSize: number,
  place: string | null,
  placeOf: (id: string) => string | null,
): LanceGroup<T>[] {
  if (place !== null) {
    const here = mechs.filter((m) => placeOf(m.id) === place);
    return [{ number: 0, mechs: here, count: here.length, size: here.length }];
  }
  return lanceGroups(mechs, lanceSize)
    .map((g) => {
      const aboard = g.mechs.filter((m) => placeOf(m.id) === null);
      return { ...g, mechs: aboard, count: aboard.length };
    })
    .filter((g) => g.count > 0);
}

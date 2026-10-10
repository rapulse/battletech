import { AMMO_FOR_WEAPON, type MechAssembly, type MountedItem } from '../../rules/construction.js';
import { WEAPONS } from '../../data/index.js';
import type { Rng } from '../../rng/index.js';

/**
 * Комплектность машины (шаг 16a).
 *
 * «Мир, где против тебя выходят одинаково новые машины, — мёртвый мир»
 * (`wiki/design/campaign/global-layer.md`, «Снаряжение отрядов»). Класс
 * исполнения уже делает чужие машины разными по качеству узлов — но не по
 * КОМПЛЕКТНОСТИ: до этого шага и периферийная банда, и гвардия выходили с
 * полным паспортным вооружением и полной бронёй, отличаясь только реактором и
 * каркасом.
 *
 * Здесь заводится вторая ось, и она отдельная от износа (`mech/wear.ts`):
 *
 * - **износ** — узел отработал ресурс и просел; лечится ремонтом;
 * - **комплектность** — машину так и собрали: брони навесили меньше, чем
 *   держит корпус, одного орудия не нашлось вовсе. Ремонтом это не лечится —
 *   ремонт доводит до ПАСПОРТА, а паспорт у такой машины и есть неполный.
 *   Лечится мехлабом (шаг 19a, `company/refit.ts`), то есть переоснащением.
 *
 * Ровно поэтому недокомплект — свойство СБОРКИ (`MechAssembly`), а не
 * состояния: он переживает любой ремонт и виден в цене машины (`mechValue`
 * считает по факту навески и брони).
 */

/**
 * Насколько машина недоукомплектована.
 *
 * Оба поля — диапазоны, а не числа: одинаково ободранные машины были бы такой
 * же мёртвой картиной, как одинаково новые. Бросок берётся из переданного
 * ГПСЧ, поэтому результат воспроизводим вместе со своим сидом.
 */
export interface OutfitSpec {
  /** Доля паспортной брони, которую машина реально несёт: `[минимум, максимум]`. */
  readonly armorShare: readonly [number, number];
  /** Сколько единиц навески не поставили: `[минимум, максимум]`. */
  readonly missingItems: readonly [number, number];
}

/** Полный комплект: ничего не снято. Для гвардии, кланов и эталонных сборок. */
export const FULL_OUTFIT: OutfitSpec = { armorShare: [1, 1], missingItems: [0, 0] };

function roll(rng: Rng, range: readonly [number, number]): number {
  const [lo, hi] = range;
  return hi <= lo ? lo : lo + rng.next() * (hi - lo);
}

/** Броня считается четвертями тонны — как и в генераторе сборок (`generateAssembly`, п. 6). */
function quarterTons(tons: number): number {
  return Math.max(0.25, Math.floor(tons * 4) / 4);
}

/**
 * Какие позиции навески вообще можно не поставить.
 *
 * Боезапас сам по себе не снимается: орудие без своей пачки не проходит
 * `validateAssembly` («для оружия не установлен боекомплект»). Пачка уходит
 * вместе с орудием и только если её больше некому расходовать.
 */
function removableIndexes(items: readonly MountedItem[]): number[] {
  const out: number[] = [];
  items.forEach((it, i) => {
    if (it.kind !== 'ammo') out.push(i);
  });
  return out;
}

function ammoStillNeeded(items: readonly MountedItem[], ammoId: string): boolean {
  return items.some((it) => WEAPONS.has(it.id) && AMMO_FOR_WEAPON[it.id] === ammoId);
}

/**
 * Собрать ту же машину, но неполным комплектом.
 *
 * Что делает и чего не делает:
 *
 * - режет `armorTons` — броню навесили не всю, и это ПАСПОРТ машины, а не
 *   пробоина: ремонт вернёт её ровно к этому уровню, не выше;
 * - снимает несколько позиций навески вместе с осиротевшим боезапасом;
 * - **никогда не снимает последнее орудие** — машина без единого ствола
 *   получила бы от `assemblyToChassisDef` подставной средний лазер, то есть
 *   недокомплект превратился бы в бесплатное оружие;
 * - не трогает ни класс исполнения, ни износ, ни состояние: это другие оси.
 *
 * Сборка остаётся ВАЛИДНОЙ: `validateAssembly` проверяет только потолки —
 * массу, слоты, предел брони и наличие боекомплекта у каждого орудия. Машина
 * легче паспорта — это не нарушение, это недогруз.
 */
export function stripOutfit(assembly: MechAssembly, spec: OutfitSpec, rng: Rng): MechAssembly {
  const share = roll(rng, spec.armorShare);
  const missing = Math.floor(roll(rng, [spec.missingItems[0], spec.missingItems[1] + 1]));

  let items: MountedItem[] = [...assembly.items];
  for (let n = 0; n < missing; n++) {
    const candidates = removableIndexes(items).filter((i) => {
      const it = items[i] as MountedItem;
      if (!WEAPONS.has(it.id)) return true;
      // Последнее орудие не снимается — см. докстринг.
      return items.filter((other) => WEAPONS.has(other.id)).length > 1;
    });
    if (candidates.length === 0) break;

    const idx = candidates[rng.int(0, candidates.length - 1)] as number;
    const removed = items[idx] as MountedItem;
    items = items.filter((_, i) => i !== idx);

    // Осиротевший боезапас уходит ВЕСЬ, а не одной пачкой. Пачек у ствола
    // столько, на сколько залпов его снарядили (`ammoVolleys`): у АП/20 их три,
    // у РДД-20 две. Снимая одну, машина увозила остальные мёртвым грузом —
    // тонны, которые нечем расходовать, и вдобавок ячейки, которые детонируют
    // от крита. Замер до правки: 14 % машин ополчения возили бесхозный БК.
    const ammoId = AMMO_FOR_WEAPON[removed.id];
    if (ammoId !== undefined && !ammoStillNeeded(items, ammoId)) {
      items = items.filter((it) => it.id !== ammoId);
    }
  }

  return { ...assembly, armorTons: quarterTons(assembly.armorTons * share), items };
}

/** Доля паспортного комплекта, которую машина реально несёт. Для показа и для оценки сил. */
export function outfitCompleteness(full: MechAssembly, actual: MechAssembly): number {
  const armor = full.armorTons === 0 ? 1 : actual.armorTons / full.armorTons;
  const items = full.items.length === 0 ? 1 : actual.items.length / full.items.length;
  return Math.round(((armor + items) / 2) * 100) / 100;
}

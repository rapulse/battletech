/**
 * Бонус губернатора сектора миру (шаг 88) и прибавка титула державы (шаг 89) — лист без импортов: его читают такты
 * лояльности, стройки и фронта, а считает `realm/sectors.ts::realmBonuses`. Пустая карта — держава без губернаторов
 * и без титульной прибавки, числа как до шага 88.
 */

/** Прибавка к дрейфу лояльности, к очкам стройки и множитель обороны мира. */
export interface GovernorBonus {
  readonly loyalty: number;
  readonly points: number;
  readonly defence: number;
}

export const NO_BONUS: GovernorBonus = Object.freeze({ loyalty: 0, points: 0, defence: 1 });

/** Бонусы миров державы: мир → бонус губернатора его сектора плюс прибавка титула. Миров без того и другого в карте нет. */
export type RealmBonuses = ReadonlyMap<string, GovernorBonus>;

export const NO_BONUSES: RealmBonuses = new Map();

export function bonusOf(bonuses: RealmBonuses, systemId: string): GovernorBonus {
  return bonuses.get(systemId) ?? NO_BONUS;
}

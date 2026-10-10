/** Весовые классы. Тоннаж и обоснование — wiki/design/mechs/classification.md. */
export enum WeightClass {
  Light = 0,
  Medium = 1,
  Heavy = 2,
  Assault = 3,
}

export const WEIGHT_CLASS_KEYS: Readonly<Record<WeightClass, string>> = {
  [WeightClass.Light]: 'weightClass.light',
  [WeightClass.Medium]: 'weightClass.medium',
  [WeightClass.Heavy]: 'weightClass.heavy',
  [WeightClass.Assault]: 'weightClass.assault',
};

/** Имя класса в данных (`combat.json`: запас корпуса, порог падения от урона). */
export type WeightClassName = 'light' | 'medium' | 'heavy' | 'assault';

export const WEIGHT_CLASS_NAME: Readonly<Record<WeightClass, WeightClassName>> = {
  [WeightClass.Light]: 'light',
  [WeightClass.Medium]: 'medium',
  [WeightClass.Heavy]: 'heavy',
  [WeightClass.Assault]: 'assault',
};

import { WEAPONS } from '../core/data/tables.js';

/**
 * Как показать выстрел на тактической карте — по типу и калибру оружия.
 *
 * Источник истины по типу — `category` из `data/weapons.json` (energy/
 * ballistic/missile) плюс последний сегмент id (`is_er_ppc` → `ppc`,
 * `is_lpl` → `lpl`), а не название оружия: имя приходит из события ядра как
 * сырой id, а не человекочитаемый текст, и раньше здесь ловили подстроку
 * "laser" в id вида `is_ml` — она там никогда не встречается.
 */

export type WeaponFxKind = 'ppc' | 'laser' | 'pulseLaser' | 'ballistic' | 'missile';

export interface WeaponFxSpec {
  readonly kind: WeaponFxKind;
  readonly color: string;
  readonly width: number;
  /** Луч — сколько горит; снаряд и ракеты — сколько летят до цели. */
  readonly duration: number;
  /** Только для missile: сколько отдельных "жал" рисовать в залпе. */
  readonly missileCount: number;
  /** Только для missile: цвет дыма `r, g, b` и сколько клубов в шлейфе. */
  readonly smoke: string;
  readonly trail: number;
}

/*
 * Палитра по «природе» выстрела, классы не пересекаются по цвету:
 * энергия — яркие (красный лазер, жёлтый импульсный, бирюзовый PPC),
 * баллистика — почти белая раскалённая болванка, ракеты — жёлтые SRM и
 * фиолетовые LRM. У ракет корпус крошечный, поэтому их разводит ещё и шлейф.
 */
const NO_MISSILE = { missileCount: 0, smoke: '', trail: 0 } as const;

const FALLBACK: WeaponFxSpec = {
  kind: 'ballistic',
  color: '#fff1d6',
  width: 2,
  duration: 200,
  ...NO_MISSILE,
};

export function weaponFxSpec(weaponId: string): WeaponFxSpec {
  const def = WEAPONS.get(weaponId);
  if (def === undefined) return FALLBACK;
  const suffix = weaponId.split('_').pop() ?? '';

  if (def.category === 'energy') {
    if (suffix === 'ppc') {
      return { kind: 'ppc', color: '#00e5ff', width: 3.5, duration: 650, ...NO_MISSILE };
    }
    if (suffix === 'mpl' || suffix === 'lpl') {
      const big = suffix === 'lpl';
      return { kind: 'pulseLaser', color: '#ffe14d', width: big ? 3 : 2, duration: 520, ...NO_MISSILE };
    }
    // sl / ml / ll — малый/средний/большой лазер, толщина растёт с калибром.
    const width = suffix === 'll' ? 3.5 : suffix === 'ml' ? 2.5 : 1.6;
    return { kind: 'laser', color: '#ff3366', width, duration: 500, ...NO_MISSILE };
  }

  if (def.category === 'ballistic') {
    // Гаусс — самый быстрый снаряд: рельса, а не пушка.
    if (suffix === 'gauss') {
      return { kind: 'ballistic', color: '#d9f2ff', width: 4, duration: 150, ...NO_MISSILE };
    }
    // Пулемёт в сборках не стоит — заглушка в цвет пушек.
    if (suffix === 'mg') {
      return { kind: 'ballistic', color: '#fff1d6', width: 1, duration: 170, ...NO_MISSILE };
    }
    // ac2..ac20, uac5..uac20 — толщина прочерка от урона снаряда.
    const width = def.damage >= 20 ? 4.5 : def.damage >= 10 ? 3.2 : def.damage >= 5 ? 2.2 : 1.4;
    return { kind: 'ballistic', color: '#fff1d6', width, duration: 230, ...NO_MISSILE };
  }

  if (def.category === 'missile') {
    const count = def.shots <= 2 ? 2 : def.shots <= 6 ? 4 : 5;
    // LRM — фиолетовые, со светлым голубоватым дымом и длинным шлейфом;
    // SRM — жёлтые, короткий серый дым. Оранжево-красные терялись на карте.
    if (suffix.startsWith('lrm')) {
      return { kind: 'missile', color: '#b388ff', width: 1.5, duration: 820, missileCount: count, smoke: '200, 220, 255', trail: 6 };
    }
    return { kind: 'missile', color: '#ffcc66', width: 1.5, duration: 820, missileCount: count, smoke: '170, 170, 170', trail: 3 };
  }

  return FALLBACK;
}

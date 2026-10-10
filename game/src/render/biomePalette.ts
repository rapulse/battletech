import raw from '../../data/palette.json';

/**
 * Цвета карты: биом выбирает набор, схема показа его перекрывает.
 *
 * Живут в данных (`data/map-palette.json`), а не в коде: цвет — такой же
 * материал, как таблица оружия (game_core.md §8). Ни одного шестнадцатеричного
 * литерала цвета земли в этом модуле нет и быть не должно.
 */
export interface Palette {
  readonly bg: string;
  /** Четыре оттенка земли по уровням 0…3. */
  readonly clear: readonly string[];
  readonly rock: string;
  readonly snow: string;
  readonly water: string;
  readonly waterDeep: string;
  readonly sandBank: string;
  readonly road: string;
  readonly bridge: string;
  readonly forestBase: string;
  readonly treePine: string;
  readonly treePineLight: string;
  readonly treeDeciduous: string;
  readonly treeDeciduousLight: string;
  readonly gridLine: string;
  readonly gridText: string;
}

const BIOMES = raw.biomes as unknown as Record<string, Palette>;
const THEMES = raw.themes as unknown as Record<string, Palette>;

export const DEFAULT_PALETTE = 'temperate';

export const THEME_NAMES = ['classic', ...Object.keys(THEMES)] as const;

/**
 * Палитра для биома под выбранной схемой показа.
 *
 * Неизвестный биом — не повод падать в кадре отрисовки: карта уже собрана, и
 * отказ рисовать её ничего не чинит. Берём эталонную и идём дальше.
 */
export function biomePalette(biome: string, theme = 'classic'): Palette {
  const themed = THEMES[theme];
  if (themed !== undefined) return themed;
  return BIOMES[biome] ?? BIOMES[DEFAULT_PALETTE]!;
}

/**
 * Цвет земли по уровню. Уровни ниже нуля в макете не встречались — там вода
 * была отдельной сущностью, — а в правилах это глубина: чем ниже, тем темнее.
 */
export function groundColor(pal: Palette, elevation: number): string {
  if (elevation >= 0) return pal.clear[Math.min(pal.clear.length - 1, elevation)]!;
  return darken(pal.clear[0]!, Math.min(0.55, 0.18 * -elevation));
}

/** Затемнение цвета вида #rrggbb на долю amount. */
export function darken(hex: string, amount: number): string {
  if (!hex.startsWith('#')) return hex;
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number): number => Math.max(0, Math.min(255, Math.round(v * (1 - amount))));
  const r = f((n >> 16) & 0xff);
  const g = f((n >> 8) & 0xff);
  const b = f(n & 0xff);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Затемнение цвета вида rgba(r, g, b, a) на долю amount. */
export function darkenRgba(rgba: string, amount: number): string {
  const match = rgba.match(/rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?\s*\)/);
  if (!match) return rgba;
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * (1 - amount))));
  const r = f(parseInt(match[1]!, 10));
  const g = f(parseInt(match[2]!, 10));
  const b = f(parseInt(match[3]!, 10));
  const a = Math.min(1, parseFloat(match[4] ?? '1') + 0.05);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

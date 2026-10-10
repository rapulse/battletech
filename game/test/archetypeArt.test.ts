import { describe, expect, it } from 'vitest';
import { WeightClass } from '../src/core/model/index.js';
import { ARCHETYPE_DRAWERS, INSTALLATION_ARCHETYPES } from '../src/render/archetypeArt.js';
import { archetypeKey } from '../src/render/scene.js';

/**
 * Фишки-силуэты (шаг 59). Штурмовые сочетания долго рисовались тяжёлым силуэтом, потому что
 * `switch` по строке ключа ничего не проверял: девятое сочетание или пропущенный случай не
 * замечались. Теперь каждое сочетание «силуэт × класс» обязано иметь свою рисовалку.
 */
const WEIGHT_CLASSES = Object.values(WeightClass).filter((v): v is WeightClass => typeof v === 'number');
const BODIES = ['humanoid', 'non_humanoid'] as const;

describe('таблица рисовалок фишек', () => {
  it('в перечислении четыре класса (иначе тест ниже проверяет не всё)', () => {
    expect(WEIGHT_CLASSES).toHaveLength(4);
  });

  it('у каждого сочетания силуэт × класс есть своя рисовалка', () => {
    for (const body of BODIES) {
      for (const weight of WEIGHT_CLASSES) {
        const key = archetypeKey(body, weight);
        expect(ARCHETYPE_DRAWERS[key], key).toBeTypeOf('function');
      }
    }
  });

  it('все восемь рисовалок и установки — разные функции: ни один класс не схлопнут с соседним', () => {
    const keys = [...BODIES.flatMap((b) => WEIGHT_CLASSES.map((w) => archetypeKey(b, w))), ...INSTALLATION_ARCHETYPES];
    expect(new Set(keys.map((k) => ARCHETYPE_DRAWERS[k])).size).toBe(8 + INSTALLATION_ARCHETYPES.size);
  });

  it('в таблице нет лишних ключей: сочетания машин и установки (шаги 73c, 73d)', () => {
    const keys = new Set(BODIES.flatMap((b) => WEIGHT_CLASSES.map((w) => archetypeKey(b, w))));
    for (const k of INSTALLATION_ARCHETYPES) keys.add(k);
    expect(Object.keys(ARCHETYPE_DRAWERS).sort()).toEqual([...keys].sort());
  });
});

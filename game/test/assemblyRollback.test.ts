import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildForce } from '../src/core/campaign/index.js';
import { CHASSIS_CATALOG_LIST, CONSTRUCTION } from '../src/core/data/tables.js';
import { Rng } from '../src/core/rng/index.js';
import { ASSEMBLY_ROLES, generateAssembly } from '../src/core/rules/construction.js';

/**
 * Откат сборщика ДАННЫМИ (шаг 71).
 *
 * Требование пользователя ко всем ступеням шага: нейтральное значение каждой
 * новой ручки в `construction.json` даёт сборки байт в байт как до шага. Эталон —
 * отпечаток тысячи сборок, снятый на `main` перед шагом (коммит 6be25fb): случайное
 * шасси каталога, роль по кругу, каждая седьмая — жребием генератора.
 *
 * Тест подменяет ручки в разобранных данных на время прогона и возвращает их на
 * место: так проверяется ровно то, что обещано, — правка JSON, а не кода.
 */
const BEFORE_STEP_71 = '16042581dff617eba934c059707749f1954ccd067c024e4f59f4a8c3bbd1ca51';

function fingerprint(): string {
  const h = createHash('sha256');
  for (let s = 1; s <= 1000; s++) {
    const rng = new Rng(s);
    const entry = rng.pick(CHASSIS_CATALOG_LIST);
    const role = s % 7 === 0 ? undefined : ASSEMBLY_ROLES[s % 6];
    h.update(
      JSON.stringify(generateAssembly({ chassisCode: entry.code, ...(role ? { role } : {}) }, rng)),
    );
  }
  return h.digest('hex');
}

/** Разбить каждую ступень пула на одиночные в том же порядке — пул «до шага 71». */
function flattenTiers(): () => void {
  const pools = CONSTRUCTION.weapons.primaryByRole as Record<
    string,
    { is: (string | string[])[]; clan: (string | string[])[] }
  >;
  const saved = structuredClone(pools);
  for (const p of Object.values(pools)) {
    p.is = p.is.flat();
    p.clan = p.clan.flat();
  }
  return () => {
    for (const [k, v] of Object.entries(saved)) pools[k] = v;
  };
}

/** Выключить добор неистраченных тонн (ступень Б). */
function fillOff(): () => void {
  const w = CONSTRUCTION.weapons as { fillUnusedPayload: boolean };
  const saved = w.fillUnusedPayload;
  w.fillUnusedPayload = false;
  return () => {
    w.fillUnusedPayload = saved;
  };
}

/** Все ручки шага в нейтральное положение разом; возвращает, чем их вернуть. */
function neutral(): () => void {
  const undo = [flattenTiers(), fillOff()];
  return () => undo.reverse().forEach((u) => u());
}

describe('Откат сборщика данными (шаг 71)', () => {
  it('откат данными: нейтральные ручки всех ступеней дают сборки как до шага', () => {
    const restore = neutral();
    try {
      expect(fingerprint()).toBe(BEFORE_STEP_71);
    } finally {
      restore();
    }
  });

  it('каждая ручка по отдельности действительно меняет сборку — иначе тест выше ничего не мерит', () => {
    for (const keepOn of [flattenTiers, fillOff]) {
      const restore = keepOn();
      try {
        expect(fingerprint()).not.toBe(BEFORE_STEP_71);
      } finally {
        restore();
      }
    }
  });

  it('семейства по биому: пустая таблица — состав как без биома (шаг 71b)', () => {
    // Ступени В и 71b откатываются данными так же: `roles.familyByBiome` пуст —
    // семейство не тянется, ГПСЧ не трогается, и состав с биомом совпадает с
    // составом без биома байт в байт. Доктрины Домов сняты решением
    // пользователя и данными не возвращаются.
    const r = CONSTRUCTION.roles as unknown as { familyByBiome: Record<string, unknown> };
    const saved = r.familyByBiome;
    const force = (biome?: string): string => {
      const out: unknown[] = [];
      for (let s = 1; s <= 60; s++) {
        out.push(
          buildForce(
            {
              count: 8,
              factionId: 'davion',
              ...(biome !== undefined ? { biome } : {}),
              opforType: 'line',
              techBase: 'is',
              supply: 1,
              tonnageCap: 100,
              idPrefix: 'R',
            },
            s,
          ).map((p) => p.record.assembly),
        );
      }
      return JSON.stringify(out);
    };
    r.familyByBiome = {};
    try {
      expect(force('jungle')).toBe(force());
    } finally {
      r.familyByBiome = saved;
    }
    // И обратное: с таблицей из данных джунгли состав действительно двигают.
    expect(force('jungle')).not.toBe(force());
  });
});

import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FACTIONS } from '../src/core/campaign/galaxy/index.js';
import { CHASSIS_CATALOG_LIST, CONSTRUCTION, DEFAULT_PAINT, PAINTS } from '../src/core/data/tables.js';
import { weightClassOf } from '../src/core/rules/construction.js';
import MECH_ART from '../src/ui/components/mechArt.json';
import {
  BAND_ORDER,
  bandOfTonnage,
  mechArtFullUrl,
  mechArtThumbUrl,
  paintOfFaction,
  paintOfRecord,
  paintsOf,
  pickMechArt,
  resolvePaint,
} from '../src/ui/components/mechArt.js';

/**
 * Портреты машин (шаги 48, 50).
 *
 * Замера здесь нет и быть не может: картинка ни на одно правило не влияет.
 * Проверяется другое — обещания, которые интерфейс даёт игроку:
 *
 * 1. у каждого из 850 шасси картинка есть, в любой раскраске;
 * 2. одна и та же машина всегда показывает один и тот же рисунок;
 * 3. каждый файл, на который ссылается манифест, лежит на диске;
 * 4. реестр раскрасок согласован с фракциями галактики.
 *
 * Первый пункт — тест на БУДУЩИЙ пробел, а не на сегодняшний: арт добирается
 * не одним заходом, и новая группа (скажем, после появления подтипов
 * локомоции) обязана обнаружиться здесь, а не глазами на живом экране.
 */

const GROUPS = MECH_ART.groups as Record<string, Record<string, string[] | undefined>>;
const BASES = MECH_ART.bases as Record<string, { paints: string[]; fallback: string }>;
const GROUP_NAMES = Object.keys(GROUPS);
const PAINT_IDS = Object.keys(PAINTS.paints);

describe('Портреты машин: манифест', () => {
  it('объявлены четыре группы', () => {
    expect([...GROUP_NAMES].sort()).toEqual(['clan_h', 'clan_n', 'is_h', 'is_n']);
  });

  it('границы разрядов возрастают и лежат внутри шкалы тоннажа', () => {
    const { light, medium, heavy } = MECH_ART.bands;
    expect(light).toBeLessThan(medium);
    expect(medium).toBeLessThan(heavy);
    const tons = CONSTRUCTION.tonnages;
    expect(light).toBeGreaterThanOrEqual(tons[0]!);
    expect(heavy).toBeLessThan(tons[tons.length - 1]!);
  });

  it('КОПИЯ ГРАНИЦ У ПАКОВЩИКА НЕ РАЗОШЛАСЬ С ДАННЫМИ', () => {
    // Границы полос живут в `construction.json → roles.classBands`. Паковщик —
    // офлайн-скрипт на Python, импортировать TypeScript он не может, поэтому
    // держит свою копию в разметке и переносит её в `mechArt.json`. Разойдись
    // копии — и картинка поедет относительно подписи: машина подписана
    // «тяжёлый», а нарисован средний. Один тест на всю эту опасность.
    const { light, medium, heavy } = MECH_ART.bands;
    expect([light, medium, heavy]).toEqual([...CONSTRUCTION.roles.classBands]);
  });

  it('весовые классы режут шкалу тоннажа там, где написано в вики', () => {
    expect(weightClassOf(20)).toBe('light');
    expect(weightClassOf(35)).toBe('light');
    expect(weightClassOf(40)).toBe('medium');
    expect(weightClassOf(55)).toBe('medium');
    expect(weightClassOf(60)).toBe('heavy');
    expect(weightClassOf(75)).toBe('heavy');
    expect(weightClassOf(80)).toBe('assault');
    expect(weightClassOf(100)).toBe('assault');
  });

  it('в каждой группе заняты все четыре разряда', () => {
    for (const name of GROUP_NAMES) {
      for (const band of BAND_ORDER) {
        expect(
          (GROUPS[name]![band] ?? []).length,
          `${name}: разряд «${band}» пуст — портрет сведётся к соседнему по весу`,
        ).toBeGreaterThan(0);
      }
    }
  });

  it('каждый рисунок стоит ровно в одном разряде одной группы и описан в bases', () => {
    const seen = Object.values(GROUPS).flatMap((g) => Object.values(g).flatMap((v) => v ?? []));
    expect(new Set(seen).size, 'рисунок попал в два разряда').toBe(seen.length);
    expect([...seen].sort()).toEqual(Object.keys(BASES).sort());
  });

  it('каждая раскраска каждого рисунка лежит на диске в обоих размерах', () => {
    // Ссылка на несуществующий файл не падает, а просто не рисуется, — поэтому
    // проверять её надо здесь, а не глазами по одной из трёхсот.
    const missing: string[] = [];
    for (const [base, entry] of Object.entries(BASES)) {
      expect(entry.paints, `${base}: откат «${entry.fallback}» без файла`).toContain(entry.fallback);
      for (const paint of entry.paints) {
        expect(PAINT_IDS, `${base}: раскраска «${paint}» не описана в paints.json`).toContain(paint);
        for (const size of ['s', 'l']) {
          const url = `${MECH_ART.dir}/${base}/${paint}-${size}.webp`;
          if (!existsSync(`public${url}`)) missing.push(url);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});

describe('Портреты машин: выбор рисунка', () => {
  it('рисунок находится для КАЖДОГО шасси каталога', () => {
    const missing = CHASSIS_CATALOG_LIST.filter((c) => pickMechArt(c.code) === null);
    expect(missing.map((c) => c.code)).toEqual([]);
  });

  it('разряд рисунка совпадает с разрядом машины по тоннажу', () => {
    // Сведение к соседнему разряду — законный запас на неполный арт, но пока
    // все корзины заняты, срабатывать он не должен ни разу.
    for (const c of CHASSIS_CATALOG_LIST) {
      const pick = pickMechArt(c.code)!;
      expect(pick.wanted).toBe(bandOfTonnage(c.tonnage));
      expect(pick.band, `${c.code}: разряд сведён к соседнему`).toBe(pick.wanted);
    }
  });

  it('группа выбирается по техбазе и локомоции записи', () => {
    for (const c of CHASSIS_CATALOG_LIST) {
      expect(pickMechArt(c.code)!.group).toBe(`${c.techBase}_${c.locomotion.toLowerCase()}`);
    }
  });

  it('выбор детерминирован: один код — всегда один рисунок', () => {
    for (const c of CHASSIS_CATALOG_LIST) {
      expect(pickMechArt(c.code)!.base).toBe(pickMechArt(c.code)!.base);
    }
  });

  it('пул разряда используется весь, а не один рисунок на всех', () => {
    for (const name of GROUP_NAMES) {
      for (const band of BAND_ORDER) {
        const pool = GROUPS[name]![band] ?? [];
        if (pool.length < 2) continue;
        const used = new Set(
          CHASSIS_CATALOG_LIST.map((c) => pickMechArt(c.code)!)
            .filter((p) => p.group === name && p.band === band)
            .map((p) => p.base),
        );
        expect(used.size, `${name}/${band}: из ${pool.length} рисунков в ходу ${used.size}`).toBe(pool.length);
      }
    }
  });

  it('любая раскраска любого шасси даёт существующий файл', () => {
    // Раскраски нет у рисунка — откат, а не пустая рамка: клановый корпус в
    // руках наёмников показывается в клановом варианте по умолчанию.
    const urls = new Set<string>();
    for (const c of CHASSIS_CATALOG_LIST) {
      const pick = pickMechArt(c.code)!;
      for (const paint of [...PAINT_IDS, 'нет-такой']) {
        urls.add(mechArtThumbUrl(pick, paint));
        urls.add(mechArtFullUrl(pick, paint));
      }
    }
    expect([...urls].filter((u) => !existsSync(`public${u}`))).toEqual([]);
  });

  it('неизвестный код шасси не ломает показ, а даёт пусто', () => {
    expect(pickMechArt('IS-X999-R9F9')).toBeNull();
    expect(pickMechArt('')).toBeNull();
    expect(resolvePaint('нет-такого', DEFAULT_PAINT)).toBeNull();
    expect(paintsOf('нет-такого')).toEqual([]);
  });
});

describe('Портреты машин: раскраски', () => {
  it('реестр ссылается только на существующие фракции и виды фракций', () => {
    for (const id of Object.keys(PAINTS.byFaction)) {
      expect(FACTIONS.has(id), `byFaction: нет фракции «${id}»`).toBe(true);
    }
    const kinds = new Set([...FACTIONS.values()].map((f) => f.kind));
    for (const kind of Object.keys(PAINTS.byKind)) {
      expect(kinds.has(kind as never), `byKind: нет вида фракции «${kind}»`).toBe(true);
    }
  });

  it('раскраска фракции: своя → по виду → по умолчанию', () => {
    expect(paintOfFaction(undefined)).toBe(PAINTS.player);
    for (const [id, paint] of Object.entries(PAINTS.byFaction)) {
      expect(paintOfFaction(id)).toBe(paint);
    }
    for (const f of FACTIONS.values()) {
      if (f.id in PAINTS.byFaction) continue;
      expect(paintOfFaction(f.id), f.id).toBe(PAINTS.byKind[f.kind] ?? DEFAULT_PAINT);
    }
    expect(paintOfFaction('нет-такой')).toBe(DEFAULT_PAINT);
  });

  it('перекраска важнее происхождения', () => {
    const origin = Object.keys(PAINTS.byFaction)[0]!;
    expect(paintOfRecord({ originFaction: origin })).toBe(PAINTS.byFaction[origin]);
    expect(paintOfRecord({ originFaction: origin, paint: DEFAULT_PAINT })).toBe(DEFAULT_PAINT);
    expect(paintOfRecord({})).toBe(PAINTS.player);
  });

  it('раскраска, которой у рисунка нет, откатывается в имеющуюся', () => {
    for (const [base, entry] of Object.entries(BASES)) {
      for (const paint of PAINT_IDS) {
        const got = resolvePaint(base, paint);
        expect(got).toBe(entry.paints.includes(paint) ? paint : entry.fallback);
      }
    }
  });
});

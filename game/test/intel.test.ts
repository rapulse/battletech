import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CampaignState,
  CONTRACTS,
  GALAXY,
  actualForce,
  buildOpfor,
  contractObjective,
  missionObjective,
  contractIntel,
  contractThreat,
  foundingInit,
  intelBand,
  intelMissChance,
  intelOf,
  intelSurprise,
  judgedContracts,
  opforCount,
  roundTons,
  type Contract,
} from '../src/core/campaign/index.js';
import { crippleQuota } from '../src/core/rules/objective.js';

/**
 * ДОСТОВЕРНОСТЬ РАЗВЕДДАННЫХ (шаг 57).
 *
 * До шага сводка нанимателя была идеальной: «2 машины до 55 т» — ровно две
 * машины до 55 т и выходило. Проверяется здесь не конкретный разброс (он
 * уедет с любой перекалибровкой), а три правила, на которых механика стоит:
 * факт выводится из сида вылета, разброс не смещён ни в чью пользу, и **цена
 * о разбросе не знает** — иначе гонорар выдавал бы сюрприз до подписи.
 */

const CORE = resolve(__dirname, '..', 'src', 'core');

function sampleBoard(): Contract[] {
  const state = new CampaignState(1, { worldSeed: 42, company: foundingInit(1) });
  const out: Contract[] = [];
  for (let i = 0; i < GALAXY.count && out.length < 400; i += 8) {
    for (const { contract, allowed } of judgedContracts(
      state.worldSeed,
      state.deltas,
      GALAXY.id(i),
      0,
      state.reputation,
      state.war,
    )) {
      if (allowed) out.push(contract);
    }
  }
  return out;
}

const BOARD = sampleBoard();
const noisy = BOARD.find((c) => c.intel <= 0.5) as Contract;
const sure = BOARD.find((c) => c.intel >= 0.8);

describe('сводка нанимателя против факта', () => {
  it('биржа набралась и достоверность лежит в своих границах', () => {
    expect(BOARD.length).toBeGreaterThan(200);
    for (const c of BOARD) {
      expect(c.intel).toBeGreaterThanOrEqual(CONTRACTS.intel.min);
      expect(c.intel).toBeLessThanOrEqual(CONTRACTS.intel.max);
    }
    expect(noisy).toBeDefined();
  });

  it('точная сводка выходит на поле слово в слово', () => {
    const exact: Contract = { ...(noisy as Contract), intel: 1 };
    for (let seed = 1; seed < 40; seed++) {
      expect(actualForce(exact, seed)).toEqual({
        units: opforCount(exact),
        tonnageCap: exact.opforTons,
      });
    }
  });

  /**
   * Разбор контракта пересобирает тот же брифинг, и состав обязан совпасть с
   * тем, что дрался: сид вылета лежит в сохранении именно для этого.
   */
  it('факт выводится из сида вылета и повторяется', () => {
    for (let seed = 1; seed < 20; seed++) {
      expect(actualForce(noisy, seed)).toEqual(actualForce(noisy, seed));
    }
    const many = new Set(
      Array.from({ length: 200 }, (_, s) => JSON.stringify(actualForce(noisy, s + 1))),
    );
    // Сюрприз вообще случается: иначе достоверность была бы украшением.
    expect(many.size).toBeGreaterThan(1);
  });

  it('разброс не смещён ни в чью пользу', () => {
    // Симметрия — не украшение: сдвинь середину в худшую сторону, и работа с
    // плохой сводкой станет систематически недоплаченной, потому что цена о
    // разбросе не знает по построению.
    const n = 4000;
    let units = 0;
    let tons = 0;
    for (let s = 1; s <= n; s++) {
      const f = actualForce(noisy, s);
      units += f.units;
      tons += f.tonnageCap;
    }
    expect(units / n).toBeCloseTo(opforCount(noisy), 0);
    expect(Math.abs(tons / n - noisy.opforTons)).toBeLessThan(noisy.opforTons * 0.05);
  });

  it('факт не выходит за полосу, которую показали игроку', () => {
    for (const c of BOARD.slice(0, 60)) {
      const band = intelBand(c);
      for (let s = 1; s <= 60; s++) {
        const f = actualForce(c, s);
        expect(f.units).toBeGreaterThanOrEqual(band.units[0]);
        expect(f.units).toBeLessThanOrEqual(band.units[1]);
        expect(f.tonnageCap).toBeGreaterThanOrEqual(band.tons[0]);
        expect(f.tonnageCap).toBeLessThanOrEqual(band.tons[1]);
      }
    }
  });

  /**
   * ДО 2026-09-21 ЗДЕСЬ БЫЛ МНИМЫЙ ПОРОГ. Поправка разведки непрерывна, а
   * машины целые, и обычный `Math.round` при высокой достоверности съедал её
   * насмерть: число машин не сдвигалось НИ РАЗУ выше 0.75, тоннаж — выше 0.88.
   * Правило при этом вероятностное, порога в нём нет — его приделывало
   * округление. Теперь округление вероятностное, и «мало» значит «редко», а не
   * «никогда».
   */
  it('точная сводка тоже изредка ошибается — порога у механики нет', () => {
    const c: Contract = { ...(noisy as Contract), intel: 0.95, opforUnits: 4, opforTons: 55 };
    let units = 0;
    let tons = 0;
    const n = 4000;
    for (let s = 1; s <= n; s++) {
      const f = actualForce(c, s);
      if (f.units !== c.opforUnits) units += 1;
      if (f.tonnageCap !== c.opforTons) tons += 1;
    }
    // Порядок величин: поправка 0.1 машины даёт около 3 % сдвигов, тоннаж — около 7 %.
    expect(units).toBeGreaterThan(0);
    expect(tons).toBeGreaterThan(0);
    expect(units / n).toBeLessThan(0.1);
    expect(tons / n).toBeLessThan(0.2);
  });

  it('шанс ошибки, показанный игроку, сходится с фактом', () => {
    // Число считается формулой (`intelMissChance`), а не перебором, — значит
    // разойтись с самим разбросом оно может молча. Здесь и сверяется.
    for (const intel of [0.95, 0.75, 0.5, 0.25]) {
      const c: Contract = { ...(noisy as Contract), intel, opforUnits: 4, opforTons: 55 };
      let missed = 0;
      const n = 4000;
      for (let s = 1; s <= n; s++) {
        const f = actualForce(c, s);
        if (f.units !== c.opforUnits || f.tonnageCap !== c.opforTons) missed += 1;
      }
      expect(Math.abs(missed / n - intelMissChance(c)), `достоверность ${intel}`).toBeLessThan(0.03);
    }
  });

  it('у точной сводки шанс ошибки нулевой', () => {
    expect(intelMissChance({ ...(noisy as Contract), intel: 1 })).toBe(0);
  });

  it('чем ниже достоверность, тем выше шанс ошибки', () => {
    const at = (intel: number): number => intelMissChance({ ...(noisy as Contract), intel });
    expect(at(0.95)).toBeLessThan(at(0.75));
    expect(at(0.75)).toBeLessThan(at(0.5));
    expect(at(0.5)).toBeLessThan(at(0.25));
  });

  it('потолок тоннажа кратен пяти — и объявленный, и фактический', () => {
    for (const c of BOARD) {
      expect(c.opforTons % CONTRACTS.intel.tonsStep).toBe(0);
      expect(actualForce(c, 7).tonnageCap % CONTRACTS.intel.tonsStep).toBe(0);
    }
    expect(roundTons(54)).toBe(55);
    expect(roundTons(47)).toBe(45);
    expect(roundTons(3)).toBe(20);
    expect(roundTons(140)).toBe(100);
  });
});

describe('цена и опасность о разбросе не знают', () => {
  /**
   * Главное требование механики (2026-09-17): «по стоимости контракта не должно
   * быть понятно, что выйдет на поле». Поэтому и гонорар, и читаемая до боя
   * оценка сил считаются по ОБЪЯВЛЕННЫМ числам.
   */
  it('оценка сил не меняется от достоверности', () => {
    const a: Contract = { ...noisy, intel: 0.25 };
    const b: Contract = { ...noisy, intel: 0.95 };
    expect(contractThreat(a)).toBe(contractThreat(b));
  });

  it('формулы цены и опасности не читают поле `intel`', () => {
    // Грубая, но верная проверка: разброс просачивается в цену ровно одним
    // способом — если кто-то прочитает `intel` там, где считается гонорар.
    const board = readFileSync(join(CORE, 'campaign', 'contracts', 'board.ts'), 'utf8');
    const payout = /function payoutOf\([\s\S]*?\n\}/.exec(board)?.[0] ?? '';
    const force = /function forceFactor\([\s\S]*?\n\}/.exec(board)?.[0] ?? '';
    expect(payout).not.toBe('');
    expect(force).not.toBe('');
    expect(payout).not.toMatch(/\bintel\b/);
    expect(force).not.toMatch(/\bintel\b/);

    const threat = readFileSync(join(CORE, 'campaign', 'contracts', 'threat.ts'), 'utf8');
    expect(/function contractThreat\([\s\S]*?\n\}/.exec(threat)?.[0] ?? '').not.toMatch(/\bintel\b/);
  });
});

describe('на достоверность можно влиять', () => {
  it('разведанная система даёт сводку точнее', () => {
    const base = {
      mission: 'garrison' as const,
      target: 'kurita',
      tension: 0,
      standing: 0,
      hpg: false,
    };
    expect(intelOf({ ...base, surveyed: true })).toBeGreaterThan(
      intelOf({ ...base, surveyed: false }),
    );
    // Станция HPG и доброе отношение — тоже, а вольница и горячий участок наоборот.
    expect(intelOf({ ...base, surveyed: false, hpg: true })).toBeGreaterThan(
      intelOf({ ...base, surveyed: false }),
    );
    expect(intelOf({ ...base, surveyed: false, target: 'pirates' })).toBeLessThan(
      intelOf({ ...base, surveyed: false }),
    );
    expect(intelOf({ ...base, surveyed: false, tension: 1 })).toBeLessThan(
      intelOf({ ...base, surveyed: false }),
    );
    expect(intelOf({ ...base, surveyed: false, standing: 100 })).toBeGreaterThan(
      intelOf({ ...base, surveyed: false, standing: -100 }),
    );
  });

  it('разведка боем знает о противнике меньше всех', () => {
    const shifts = CONTRACTS.intel.missionShift;
    expect(shifts.recon).toBeLessThan(shifts.garrison);
    expect(shifts.recon).toBeLessThan(shifts.defense);
  });

  it('экран получает и достоверность, и полосу', () => {
    const view = contractIntel(noisy, false);
    expect(view.reliability).toBe(noisy.intel);
    expect(view.unitsRange[0]).toBeLessThanOrEqual(view.expectedUnits);
    expect(view.unitsRange[1]).toBeGreaterThanOrEqual(view.expectedUnits);
    expect(view.tonsRange[0]).toBeLessThanOrEqual(view.tonnageCap);
    expect(view.tonsRange[1]).toBeGreaterThanOrEqual(view.tonnageCap);
    if (sure !== undefined) {
      // Полосы сравниваются В ДОЛЯХ от объявленного: у работ разный потолок
      // тоннажа, и абсолютная ширина сравнивала бы не достоверность, а вес.
      const width = (c: ReturnType<typeof contractIntel>): number =>
        (c.tonsRange[1] - c.tonsRange[0]) / c.tonnageCap;
      expect(width(contractIntel(sure, false))).toBeLessThan(width(view));
    }
  });
});

describe('расхождение сводки с фактом в конкретном вылете (шаг 61)', () => {
  const lance = new CampaignState(1, { worldSeed: 42, company: foundingInit(1) }).company.mechs;

  it('видит именно то число, что стоит на поле', () => {
    let seen = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const onField = buildOpfor(noisy, lance, seed).length;
      const surprise = intelSurprise(noisy, seed);
      if (surprise === null) {
        expect(onField).toBe(noisy.opforUnits);
      } else {
        seen++;
        expect(surprise.declared).toBe(noisy.opforUnits);
        expect(surprise.actual).toBe(onField);
        expect(surprise.actual).not.toBe(surprise.declared);
      }
    }
    // Достоверность ≤ 0.5: на двухстах вылетах промахи есть, но и попадания тоже.
    expect(seen).toBeGreaterThan(0);
    expect(seen).toBeLessThan(200);
  });

  it('разведка ошибается в обе стороны', () => {
    const signs = new Set<number>();
    for (let seed = 1; seed <= 400; seed++) {
      const s = intelSurprise(noisy, seed);
      if (s !== null) signs.add(Math.sign(s.actual - s.declared));
    }
    expect(signs).toEqual(new Set([-1, 1]));
  });

  it('при достоверности 1 расхождения нет ни на одном сиде', () => {
    const exact: Contract = { ...noisy, intel: 1 };
    for (let seed = 1; seed <= 100; seed++) expect(intelSurprise(exact, seed)).toBeNull();
  });
});

describe('условие долевой задачи задаёт контракт, а не факт (шаг 61)', () => {
  it('число машин фиксируется по ОБЪЯВЛЕННОМУ составу, какой бы состав ни вышел', () => {
    let checked = 0;
    for (const c of BOARD) {
      const task = missionObjective(c.mission);
      if (task.kind !== 'cripple') continue;
      const fixed = contractObjective(c);
      expect(fixed.kind).toBe('cripple');
      if (fixed.kind !== 'cripple') continue;
      expect(fixed.share).toBe(task.share);
      expect(fixed.quota).toBe(crippleQuota(task.share, c.opforUnits));
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('задачи без доли контракт не трогает', () => {
    for (const c of BOARD) {
      const task = missionObjective(c.mission);
      // Укреплённая работа (шаг 73d) несёт свою задачу — её проверяет `fortress.test.ts`.
      if (task.kind === 'cripple' || c.fortified !== undefined) continue;
      expect(contractObjective(c)).toEqual(task);
    }
  });
});

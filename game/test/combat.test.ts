import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hex, Direction } from '../src/core/hex/index.js';
import { HexMap, MoveMode, TerrainType } from '../src/core/map/index.js';
import {
  BattleState,
  ContactLevel,
  HitZone,
  makeUnit,
  Phase,
  spendAmmo,
  zoneState,
  type MechUnit,
  type MountState,
} from '../src/core/model/index.js';
import { Rng, RngSet } from '../src/core/rng/index.js';
import { COMBAT, WEAPONS, weapon } from '../src/core/data/tables.js';
import {
  ammoPerVolley,
  applyDamage,
  heatLimits,
  heatMarkShown,
  hitProbability,
  jumpBudget,
  makePilot,
  mpBudget,
  resolveAttack,
  rollZone,
  toHitBreakdown,
  zoneTableFor,
  zoneTableName,
  arcingWeapon,
} from '../src/core/rules/index.js';
import { execute, refreshContacts, RejectReason } from '../src/core/commands/index.js';

function pilot(id: string, skills: Record<string, number> = {}) {
  const p = makePilot(new Rng(42), { id, tier: 5 });
  return { ...p, skills: { ...p.skills, ...skills }, firstBattle: false };
}

function unit(id: string, side: 'player' | 'opfor', q: number, r: number, chassis = 'IS-H55-R3F2'): MechUnit {
  return makeUnit({
    id,
    side,
    chassis,
    pilot: pilot(`${id}-пилот`),
    hex: hex(q, r),
    facing: Direction.NW,
  });
}

describe('вероятность попадания на 2d6', () => {
  it('совпадает с точным распределением', () => {
    expect(hitProbability(2)).toBe(1);
    expect(hitProbability(7)).toBeCloseTo(21 / 36, 10);
    expect(hitProbability(12)).toBeCloseTo(1 / 36, 10);
    expect(hitProbability(13)).toBe(0);
  });

  it('убывает монотонно — колокол, а не равномерное распределение', () => {
    for (let t = 3; t <= 12; t++) {
      expect(hitProbability(t)).toBeLessThan(hitProbability(t - 1));
    }
  });
});

describe('целевое число', () => {
  it('складывается из базы навыка и модификаторов', () => {
    const map = new HexMap(15, 15);
    const a = unit('a', 'player', 0, 0);
    const b = unit('b', 'opfor', 0, 2);
    const bd = toHitBreakdown(map, a, b, 'is_ml');
    // Стрельба 5 -> база 4, вплотную, оба стояли: модификаторов нет.
    expect(bd.base).toBe(4);
    expect(bd.target).toBe(4);
    expect(bd.impossible).toBe(false);
  });

  it('дальность за пределом оружия делает выстрел невозможным', () => {
    const map = new HexMap(30, 30);
    const a = unit('a', 'player', 0, 0);
    const b = unit('b', 'opfor', 0, 12);
    expect(toHitBreakdown(map, a, b, 'is_ml').band).toBe('out');
    expect(toHitBreakdown(map, a, b, 'is_ml').impossible).toBe(true);
    // ППК добивает на 18.
    expect(toHitBreakdown(map, a, b, 'is_ppc').impossible).toBe(false);
  });

  it('перекрытая линия делает выстрел невозможным', () => {
    const map = new HexMap(15, 15);
    map.setTerrain(hex(0, 2), TerrainType.Building);
    const a = unit('a', 'player', 0, 0);
    const b = unit('b', 'opfor', 0, 4);
    expect(toHitBreakdown(map, a, b, 'is_ml').impossible).toBe(true);
  });

  describe('косвенный огонь ракетами', () => {
    // Здание на (0,2) перекрывает линию стрелка (0,0) → цель (0,4). Союзник на
    // (1,4) стоит рядом с целью и видит её напрямую — годится в наводчики.
    function scene() {
      const map = new HexMap(15, 15);
      map.setTerrain(hex(0, 2), TerrainType.Building);
      const a = unit('a', 'player', 0, 0);
      const spotter = unit('s', 'player', 1, 4);
      const b = unit('b', 'opfor', 0, 4);
      return { map, a, spotter, b };
    }

    it('ракеты бьют навесом по наводке союзника — со штрафом и без укрытия по пути', () => {
      const { map, a, spotter, b } = scene();
      const bd = toHitBreakdown(map, a, b, 'is_srm6', undefined, undefined, [a, spotter, b]);
      expect(bd.los.blocked).toBe(true);
      expect(bd.impossible).toBe(false);
      expect(bd.indirect).toBe(true);
      expect(bd.factors.find((f) => f.key === 'toHit.indirect')?.amount).toBe(COMBAT.toHit.indirectFire);
      expect(bd.factors.some((f) => f.key === 'toHit.cover')).toBe(false);
    });

    it('штраф идёт сверх потолка обстановки', () => {
      const { map, a, spotter, b } = scene();
      const bd = toHitBreakdown(map, a, b, 'is_srm6', undefined, undefined, [a, spotter, b]);
      const other = bd.factors.filter((f) => f.key !== 'toHit.indirect').reduce((s, f) => s + f.amount, 0);
      const expected = bd.base + Math.min(COMBAT.toHit.maxSituational, other) + COMBAT.toHit.indirectFire;
      expect(bd.target).toBe(Math.min(COMBAT.toHit.maxTarget, expected));
    });

    it('не ракетное оружие навесом не стреляет', () => {
      const { map, a, spotter, b } = scene();
      expect(toHitBreakdown(map, a, b, 'is_ml', undefined, undefined, [a, spotter, b]).impossible).toBe(true);
    });

    it('по засветке навесом не стреляют, даже с наводчиком', () => {
      const { map, a, spotter, b } = scene();
      const bd = toHitBreakdown(map, a, b, 'is_srm6', undefined, ContactLevel.Blip, [a, spotter, b]);
      expect(bd.impossible).toBe(true);
    });

    // `combat.json` → toHit.indirectRequiresSpotter, сейчас true (решение пользователя
    // 2026-09-19, вернуло исходное правило после 2026-09-14..09-19 без наводчика).
    describe('indirectRequiresSpotter: true (нынешнее) — нужен живой наводчик', () => {
      it('одного силуэта стороны без живого наводчика не хватает', () => {
        const { map, a, b } = scene();
        const bd = toHitBreakdown(map, a, b, 'is_srm6', undefined, ContactLevel.Silhouette, [a, b]);
        expect(bd.impossible).toBe(true);
        expect(bd.indirect).toBe(false);
      });

      it('сам стрелок за наводчика не считается', () => {
        const { map, a, b } = scene();
        const bd = toHitBreakdown(map, a, b, 'is_srm6', undefined, undefined, [a, b]);
        expect(bd.impossible).toBe(true);
      });

      it('союзник с открытой линией на цель — навес доступен', () => {
        const { map, a, spotter, b } = scene();
        const bd = toHitBreakdown(map, a, b, 'is_srm6', undefined, ContactLevel.Silhouette, [a, spotter, b]);
        expect(bd.impossible).toBe(false);
        expect(bd.indirect).toBe(true);
      });
    });

    describe('indirectRequiresSpotter: false (было 2026-09-14..09-19) — хватает контакта стороны', () => {
      beforeEach(() => {
        COMBAT.toHit.indirectRequiresSpotter = false;
      });
      afterEach(() => {
        COMBAT.toHit.indirectRequiresSpotter = true;
      });

      it('хватает силуэта: союзник с линией прямо сейчас не нужен', () => {
        // Контакт стороны внутри хода не убывает (terrain.md): силуэт с начала хода
        // держится, когда свои уже за гребнем. Игрок видит силуэт — стреляет навесом.
        const { map, a, b } = scene();
        const bd = toHitBreakdown(map, a, b, 'is_srm6', undefined, ContactLevel.Silhouette, [a, b]);
        expect(bd.impossible).toBe(false);
        expect(bd.indirect).toBe(true);
      });
    });
  });

  it('минимальная дальность ППК штрафует за стрельбу вплотную', () => {
    const map = new HexMap(15, 15);
    const a = unit('a', 'player', 0, 0);
    const near = unit('b', 'opfor', 0, 1);
    const far = unit('c', 'opfor', 0, 4);
    const close = toHitBreakdown(map, a, near, 'is_ppc');
    const ok = toHitBreakdown(map, a, far, 'is_ppc');
    expect(close.target).toBeGreaterThan(ok.target);
    expect(close.factors.some((f) => f.key === 'toHit.minRange')).toBe(true);
  });

  it('целевое число не выходит за границы 2d6', () => {
    const map = new HexMap(30, 30);
    const a = { ...unit('a', 'player', 0, 0), prone: true, heat: 30 };
    const b = { ...unit('b', 'opfor', 0, 8), hexesMoved: 9 };
    const bd = toHitBreakdown(map, a, b, 'is_ppc');
    expect(bd.target).toBeLessThanOrEqual(12);
    expect(bd.target).toBeGreaterThanOrEqual(2);
  });
});

describe('роботы на линии огня (Total Warfare p.101, шаг 9c)', () => {
  it('стоящий на пути луча робот добавляет +1 к целевому числу', () => {
    const map = new HexMap(15, 15);
    const a = unit('a', 'player', 0, 0);
    const b = unit('b', 'opfor', 0, 2);
    const baseline = toHitBreakdown(map, a, b, 'is_ml', undefined, undefined, [a, b]);
    expect(baseline.factors.some((f) => f.key === 'toHit.interveningMech')).toBe(false);

    const c = unit('c', 'opfor', 0, 1);
    const withMech = toHitBreakdown(map, a, b, 'is_ml', undefined, undefined, [a, b, c]);
    const factor = withMech.factors.find((f) => f.key === 'toHit.interveningMech');
    expect(factor?.amount).toBe(1);
    expect(withMech.target).toBe(baseline.target + 1);
  });

  it('два робота на линии огня складывают штраф', () => {
    const map = new HexMap(15, 15);
    const a = unit('a', 'player', 0, 0);
    const b = unit('b', 'opfor', 0, 3);
    const c = unit('c', 'opfor', 0, 1);
    const d = unit('d', 'player', 0, 2);
    const bd = toHitBreakdown(map, a, b, 'is_ml', undefined, undefined, [a, b, c, d]);
    expect(bd.factors.find((f) => f.key === 'toHit.interveningMech')?.amount).toBe(2);
  });

  it('уничтоженный робот на пути луча не считается', () => {
    const map = new HexMap(15, 15);
    const a = unit('a', 'player', 0, 0);
    const b = unit('b', 'opfor', 0, 2);
    const wreck = { ...unit('c', 'opfor', 0, 1), destroyed: true };
    const bd = toHitBreakdown(map, a, b, 'is_ml', undefined, undefined, [a, b, wreck]);
    expect(bd.factors.some((f) => f.key === 'toHit.interveningMech')).toBe(false);
  });

  it('без списка юнитов штраф не считается — перебор без него не имеет права на него ссылаться', () => {
    const map = new HexMap(15, 15);
    const a = unit('a', 'player', 0, 0);
    const b = unit('b', 'opfor', 0, 2);
    const bd = toHitBreakdown(map, a, b, 'is_ml');
    expect(bd.factors.some((f) => f.key === 'toHit.interveningMech')).toBe(false);
  });
});

describe('таблица зон', () => {
  it('высота вычёркивает зоны: сверху не видно ног, снизу — рук', () => {
    const above = zoneTableFor({ levelAdvantage: 2, distance: 2 });
    const below = zoneTableFor({ levelAdvantage: -2, distance: 2 });
    expect(above).toEqual([HitZone.Head, HitZone.Torso, HitZone.LeftArm, HitZone.RightArm]);
    expect(below).toEqual([HitZone.Head, HitZone.Torso, HitZone.LeftLeg, HitZone.RightLeg]);
  });

  it('вычеркнув зоны, таблица НЕ перевешивает оставшиеся', () => {
    // Решение пользователя 2026-09-17: исключать невидимое можно, менять доли
    // между оставшимися зонами нельзя. Каждая зона встречается в своей таблице
    // ровно один раз — значит доли равные при любом броске по длине таблицы.
    for (const shot of [{}, { levelAdvantage: 2, distance: 2 }, { levelAdvantage: -2, distance: 2 }]) {
      const table = zoneTableFor(shot);
      expect(new Set(table).size).toBe(table.length);
    }
    expect(zoneTableFor({}).length).toBe(6);
    expect(zoneTableFor({ levelAdvantage: 2, distance: 2 }).length).toBe(4);
  });

  it('равные доли держатся и на броске, а не только в таблице', () => {
    const rng = new Rng(4242);
    const counts = new Map<HitZone, number>();
    const n = 120000;
    for (let i = 0; i < n; i++) {
      // Голова уходит в торс по подтверждению — считаем сам бросок, а не исход.
      const r = rollZone(rng, { levelAdvantage: 2, distance: 1 });
      const zone = r.glanced ? HitZone.Head : r.zone;
      counts.set(zone, (counts.get(zone) ?? 0) + 1);
    }
    expect(counts.size).toBe(4);
    for (const zone of [HitZone.Head, HitZone.Torso, HitZone.LeftArm, HitZone.RightArm]) {
      expect((counts.get(zone) ?? 0) / n, HitZone[zone]).toBeGreaterThan(0.24);
      expect((counts.get(zone) ?? 0) / n, HitZone[zone]).toBeLessThan(0.26);
    }
  });

  it('высота работает углом: дальше пяти клеток таблица ровная', () => {
    expect(zoneTableName({ levelAdvantage: 1, distance: 5 })).toBe('Above');
    expect(zoneTableName({ levelAdvantage: 1, distance: 6 })).toBe('Main');
    expect(zoneTableName({ levelAdvantage: -3, distance: 5 })).toBe('Below');
    expect(zoneTableName({ levelAdvantage: -3, distance: 20 })).toBe('Main');
  });

  it('ракета идёт навесом: ровный d6 на любой высоте, но не сквозь выступ', () => {
    expect(arcingWeapon(weapon('is_lrm10').category)).toBe(true);
    expect(arcingWeapon(weapon('is_ppc').category)).toBe(false);
    expect(zoneTableName({ levelAdvantage: 3, distance: 1, arcing: true })).toBe('Main');
    expect(zoneTableFor({ levelAdvantage: -3, distance: 1, arcing: true })).toHaveLength(6);
    // Ноги за выступом не видны ничему, включая ракету.
    expect(zoneTableName({ levelAdvantage: -3, distance: 1, arcing: true, partialCover: true }))
      .toBe('Above');
  });

  it('выступ в уровень закрывает ноги на любой дальности', () => {
    expect(zoneTableName({ levelAdvantage: 0, distance: 20, partialCover: true })).toBe('Above');
    expect(zoneTableFor({ levelAdvantage: 0, distance: 20, partialCover: true }))
      .not.toContain(HitZone.LeftLeg);
  });

  it('подтверждение опускает долю попаданий в кокпит примерно до 1/18', () => {
    const rng = new Rng(123);
    let head = 0;
    const n = 200000;
    for (let i = 0; i < n; i++) {
      if (rollZone(rng).zone === HitZone.Head) head += 1;
    }
    const share = head / n;
    // 1/6 без подтверждения, 1/18 с ним. Проверяем именно второе.
    expect(share).toBeGreaterThan(0.045);
    expect(share).toBeLessThan(0.068);
  });

  it('неподтверждённый кокпит уходит в торс, а не пропадает', () => {
    const rng = new Rng(7);
    for (let i = 0; i < 5000; i++) {
      const r = rollZone(rng);
      if (r.glanced) {
        expect(r.roll).toBe(1);
        expect(r.zone).toBe(HitZone.Torso);
      }
    }
  });
});

describe('урон', () => {
  it('сначала снимает броню, потом идёт в структуру', () => {
    const u = unit('a', 'player', 0, 0);
    const armor = zoneState(u, HitZone.Torso).armor;
    const light = applyDamage(u, HitZone.Torso, 3);
    expect(light.armorHeld).toBe(true);
    expect(light.armorAfter).toBe(armor - 3);

    const heavy = applyDamage(u, HitZone.Torso, armor + 2);
    expect(heavy.armorHeld).toBe(false);
    expect(heavy.armorAfter).toBe(0);
    expect(heavy.structureAfter).toBe(zoneState(u, HitZone.Torso).structure - 2);
  });

  it('исчерпание структуры разрушает зону', () => {
    let u = unit('a', 'player', 0, 0);
    const z = zoneState(u, HitZone.LeftArm);
    const out = applyDamage(u, HitZone.LeftArm, z.armor + z.structure);
    u = out.unit;
    expect(out.zoneDestroyed).toBe(true);
    expect(zoneState(u, HitZone.LeftArm).destroyed).toBe(true);
  });

  it('разрушенная рука уносит установленное в ней оружие', () => {
    const u = unit('a', 'player', 0, 0);
    const z = zoneState(u, HitZone.RightArm);
    const out = applyDamage(u, HitZone.RightArm, z.armor + z.structure);
    expect(out.weaponsLost.length).toBeGreaterThan(0);
    expect(out.unit.mounts.filter((m) => m.zone === HitZone.RightArm).every((m) => m.destroyed)).toBe(true);
  });

  it('разрушенная нога валит робота и выводит его из боя (шаг 6, часть A)', () => {
    const u = unit('a', 'player', 0, 0);
    const z = zoneState(u, HitZone.LeftLeg);
    const out = applyDamage(u, HitZone.LeftLeg, z.armor + z.structure);
    expect(out.fell).toBe(true);
    expect(out.unit.prone).toBe(true);
    expect(out.mechDestroyed).toBe(true);
    expect(out.unit.destroyed).toBe(true);
  });

  it('разрушение торса выводит робота из строя', () => {
    const u = unit('a', 'player', 0, 0);
    const z = zoneState(u, HitZone.Torso);
    const out = applyDamage(u, HitZone.Torso, z.armor + z.structure);
    expect(out.mechDestroyed).toBe(true);
  });

  it('урон в разрушенную зону уходит сквозным в торс, а не пропадает', () => {
    let u = unit('a', 'player', 0, 0);
    const arm = zoneState(u, HitZone.LeftArm);
    u = applyDamage(u, HitZone.LeftArm, arm.armor + arm.structure).unit;

    const torsoBefore = zoneState(u, HitZone.Torso).armor;
    const out = applyDamage(u, HitZone.LeftArm, 5);
    expect(out.transferredFrom).toBe(HitZone.LeftArm);
    expect(out.zone).toBe(HitZone.Torso);
    expect(zoneState(out.unit, HitZone.Torso).armor).toBe(torsoBefore - 5);
  });

  it('нулевой урон ничего не меняет', () => {
    const u = unit('a', 'player', 0, 0);
    const out = applyDamage(u, HitZone.Torso, 0);
    expect(out.unit).toBe(u);
    expect(out.armorAfter).toBe(zoneState(u, HitZone.Torso).armor);
  });
});

describe('MP по машине (шаг 6, часть B) и прыжок по двигателям (часть C)', () => {
  it('MP ходьбы берётся из walkMP юнита, выведенного из тира реактора', () => {
    const u = unit('a', 'player', 0, 0);
    expect(mpBudget(u, MoveMode.Walk)).toBe(u.walkMP);
    // IS-H55-R3F2: средний класс, тир реактора R3 — строка `reactors.walkMP.medium`
    // даёт 6 (шаг 49: сетка средних [4..8]). Источник числа — makePlatform, не
    // MOVE_PROFILES.
    expect(u.walkMP).toBe(6);
  });

  it('бег — ходьба, умноженная на runMultiplier из construction.json, с округлением вниз', () => {
    const u = unit('a', 'player', 0, 0);
    expect(mpBudget(u, MoveMode.Run)).toBe(Math.floor(u.walkMP * 1.5));
  });

  it('без прыжковых двигателей прыжковый бюджет — ноль', () => {
    const u = unit('a', 'player', 0, 0);
    expect(jumpBudget(u)).toBe(0);
    expect(mpBudget(u, MoveMode.Jump)).toBe(0);
  });

  it('прыжковый бюджет — сумма jumpMP установленных двигателей', () => {
    const u = unit('a', 'player', 0, 0);
    const slots = u.slots.map((zoneSlots) => zoneSlots.slice());
    slots[HitZone.LeftLeg]!.push({ kind: 'jump_jet', id: 'jj_med', destroyed: false });
    slots[HitZone.RightLeg]!.push({ kind: 'jump_jet', id: 'jj_med', destroyed: false });
    const withJJ: MechUnit = { ...u, slots };
    expect(jumpBudget(withJJ)).toBe(2);
  });

  it('разрушенный (критом) прыжковый двигатель не даёт вклада в бюджет', () => {
    const u = unit('a', 'player', 0, 0);
    const slots = u.slots.map((zoneSlots) => zoneSlots.slice());
    slots[HitZone.LeftLeg]!.push({ kind: 'jump_jet', id: 'jj_med', destroyed: false });
    slots[HitZone.RightLeg]!.push({ kind: 'jump_jet', id: 'jj_med', destroyed: true });
    const withJJ: MechUnit = { ...u, slots };
    expect(jumpBudget(withJJ)).toBe(1);
  });
});

describe('повреждения роняют подвижность (шаг 6, часть D)', () => {
  it('перебитый привод ноги снимает 1 MP ходьбы за попадание', () => {
    const u = unit('a', 'player', 0, 0);
    const hit1: MechUnit = { ...u, legActuatorHits: [1, 0] };
    expect(mpBudget(hit1, MoveMode.Walk)).toBe(u.walkMP - 1);

    const hit2: MechUnit = { ...u, legActuatorHits: [1, 1] };
    expect(mpBudget(hit2, MoveMode.Walk)).toBe(u.walkMP - 2);
  });

  it('MP ходьбы не уходит ниже 1, сколько бы приводов ни выбило', () => {
    const u = unit('a', 'player', 0, 0);
    const wrecked: MechUnit = { ...u, legActuatorHits: [4, 4] };
    expect(mpBudget(wrecked, MoveMode.Walk)).toBe(1);
  });

  it('первый крит гироскопа снимает 1 MP бега', () => {
    const u = unit('a', 'player', 0, 0);
    const base = mpBudget(u, MoveMode.Run);
    const gyroHit: MechUnit = { ...u, gyroHits: 1 };
    expect(mpBudget(gyroHit, MoveMode.Run)).toBe(base - 1);
  });

  it('тепло режет MP по старшей достигнутой ступени, а не суммой ступеней', () => {
    const u = unit('a', 'player', 0, 0);
    // Ступени берутся из данных, а не числом в тесте: тепловая шкала уже
    // переезжала целиком (шаг 46), и переписанный вручную порог такой переезд
    // молча переживёт, проверяя не то.
    // Метки — от предела машины (`rules/heat.ts`), поэтому тепло считается от
    // предела этой машины, а не общим числом.
    const steps = COMBAT.heat.mpPenaltySteps;
    const second = steps[1]!;
    const hot: MechUnit = { ...u, heat: heatMarkShown(heatLimits(u).limit, second) };
    expect(mpBudget(hot, MoveMode.Walk)).toBe(u.walkMP - second.mp);
  });

  it('пробитая до структуры нога снимает 1 MP сама по себе, без крита привода', () => {
    const u = unit('a', 'player', 0, 0);
    const leg = zoneState(u, HitZone.LeftLeg);
    // Брони не хватает, чтобы пережить удар без остатка — часть уйдёт в структуру.
    const punched = applyDamage(u, HitZone.LeftLeg, leg.armor + 1).unit;
    expect(zoneState(punched, HitZone.LeftLeg).structure).toBeLessThan(leg.maxStructure);
    expect(punched.legActuatorHits).toEqual([0, 0]);
    expect(mpBudget(punched, MoveMode.Walk)).toBe(u.walkMP - 1);
  });

  it('пробитая структура и крит привода на одной ноге складываются', () => {
    const u = unit('a', 'player', 0, 0);
    const leg = zoneState(u, HitZone.LeftLeg);
    const punched = applyDamage(u, HitZone.LeftLeg, leg.armor + 1).unit;
    const withActuator: MechUnit = { ...punched, legActuatorHits: [1, 0] };
    expect(mpBudget(withActuator, MoveMode.Walk)).toBe(u.walkMP - 2);
  });

  it('пробитая только броня без выхода в структуру MP не снимает', () => {
    const u = unit('a', 'player', 0, 0);
    const leg = zoneState(u, HitZone.LeftLeg);
    const armorOnly = applyDamage(u, HitZone.LeftLeg, leg.armor).unit;
    expect(zoneState(armorOnly, HitZone.LeftLeg).structure).toBe(leg.maxStructure);
    expect(mpBudget(armorOnly, MoveMode.Walk)).toBe(u.walkMP);
  });
});

describe('разрешение выстрела', () => {
  function battle(): { state: BattleState; a: MechUnit; b: MechUnit } {
    const state = new BattleState(new HexMap(15, 15), new RngSet(2026));
    const a = unit('альфа', 'player', 0, 0);
    const b = unit('браво', 'opfor', 0, 3);
    state.addUnit(a);
    state.addUnit(b);
    state.phase = Phase.Attack;
    // Знание о цели — часть состояния (шаг 7), без него выстрел не разрешат.
    refreshContacts(state);
    return { state, a, b };
  }

  it('срыв превращает попадание в промах и объясняет причину', () => {
    const { state, a, b } = battle();
    // Хладнокровие 1 — срыв в 25 % случаев плюс обстановка.
    const nervous = { ...a, pilot: { ...a.pilot, skills: { ...a.pilot.skills, composure: 1 } } };
    let botched = 0;
    let hits = 0;
    for (let i = 0; i < 400; i++) {
      const res = resolveAttack(state.rng, { map: state.map, attacker: nervous, target: b, mountIndex: 0 });
      if (res.execution?.botched === true) {
        botched += 1;
        expect(res.intentHit).toBe(true);
        expect(res.hit).toBe(false);
        expect(res.execution.odds.chance).toBeGreaterThan(0.2);
      }
      if (res.hit) hits += 1;
    }
    expect(botched).toBeGreaterThan(0);
    expect(hits).toBeGreaterThan(0);
  });

  it('срыв не трогает провальный бросок — второго шанса промахнуться нет', () => {
    const { state, a, b } = battle();
    for (let i = 0; i < 500; i++) {
      const res = resolveAttack(state.rng, { map: state.map, attacker: a, target: b, mountIndex: 0 });
      if (!res.intentHit) expect(res.execution).toBeNull();
    }
  });

  it('собранность работает только при высоком Хладнокровии и только на единицу', () => {
    const { state, a, b } = battle();
    const master = { ...a, pilot: { ...a.pilot, skills: { ...a.pilot.skills, composure: 10 } } };
    let saved = 0;
    for (let i = 0; i < 2000; i++) {
      const res = resolveAttack(state.rng, { map: state.map, attacker: master, target: b, mountIndex: 0 });
      if (res.poise?.saved === true) {
        saved += 1;
        expect(res.roll).toBe(res.breakdown.target - 1);
      }
    }
    expect(saved).toBeGreaterThan(0);

    const rookie = { ...a, pilot: { ...a.pilot, skills: { ...a.pilot.skills, composure: 3 } } };
    for (let i = 0; i < 500; i++) {
      const res = resolveAttack(state.rng, { map: state.map, attacker: rookie, target: b, mountIndex: 0 });
      expect(res.poise?.saved ?? false).toBe(false);
    }
  });

  it('выстрел тратит тепло и боезапас независимо от исхода', () => {
    const { state, a, b } = battle();
    const ac10 = a.mounts.findIndex((m) => m.weapon === 'is_ac10');
    const res = resolveAttack(state.rng, { map: state.map, attacker: a, target: b, mountIndex: ac10 });
    expect(res.attacker.heat).toBeGreaterThan(a.heat);
    expect(res.attacker.mounts[ac10]?.ammo).toBe((a.mounts[ac10]?.ammo ?? 0) - 1);
  });

  it('боезапас меряется ЗАЛПАМИ, а не ракетами в связке (2026-09-16)', () => {
    // Тонна РДД-20 — это шесть залпов, а не шесть ракет: `equipment.shots` и
    // `weapon.ammo` считают выстрелы, `weapon.shots` — ракеты в связке. Бой
    // вычитал из пула `weapon.shots` и осушал пусковую с ПЕРВОГО нажатия, а
    // генератор при этом был уверен, что снарядил машину на двенадцать залпов.
    // Разойтись этим двум величинам снова — значит вернуть немые ракетные
    // машины, поэтому правило закреплено тестом, а не комментарием.
    for (const id of ['is_lrm20', 'is_lrm15', 'is_srm6', 'is_ac20'] as const) {
      const w = WEAPONS.get(id)!;
      expect(ammoPerVolley(w)).toBe(1);
    }
    // Сдвоенный огонь Ultra AC — исключение: он не кластерный и по канону
    // съедает два снаряда за залп.
    expect(ammoPerVolley(WEAPONS.get('cl_uac20')!)).toBe(2);

    const unitLrm = makeUnit({
      id: 'ракетчик', // i18n-ignore: id боевой единицы в тесте, игрок его не видит
      side: 'player',
      chassis: 'IS-H55-R3F2',
      pilot: pilot('ракетчик-пилот'), // i18n-ignore: id пилота, см. выше
      hex: hex(0, 0),
      facing: Direction.NW,
    });
    const lrm: MountState = {
      weapon: 'is_lrm20',
      zone: HitZone.Torso,
      ammo: WEAPONS.get('is_lrm20')!.ammo,
      destroyed: false,
      slotIndices: [],
      firedThisTurn: false,
    };
    let armed: MechUnit = { ...unitLrm, mounts: [lrm] };
    let volleys = 0;
    while ((armed.mounts[0]?.ammo ?? 0) > 0) {
      armed = spendAmmo(armed, 0);
      volleys++;
    }
    expect(volleys).toBe(WEAPONS.get('is_lrm20')!.ammo);
  });

  it('команда стрельбы отвергается вне своей фазы и по своим', () => {
    const { state } = battle();
    state.phase = Phase.Movement;
    expect(execute(state, { kind: 'attack', unitId: 'альфа', targetId: 'браво', mountIndex: 0 })).toEqual({
      ok: false,
      reason: RejectReason.WrongPhase,
    });

    state.phase = Phase.Attack;
    expect(execute(state, { kind: 'attack', unitId: 'альфа', targetId: 'альфа', mountIndex: 0 })).toEqual({
      ok: false,
      reason: RejectReason.SameSide,
    });
  });

  it('одна установка стреляет один раз за ход, залп собирается из разных стволов', () => {
    const { state } = battle();
    const first = execute(state, { kind: 'attack', unitId: 'альфа', targetId: 'браво', mountIndex: 0 });
    expect(first.ok).toBe(true);
    const second = execute(state, { kind: 'attack', unitId: 'альфа', targetId: 'браво', mountIndex: 0 });
    expect(second).toEqual({ ok: false, reason: RejectReason.AlreadyFired });
  });

  describe('ракеты пачки — попадание по отдельности (шаг 66b)', () => {
    /** Тот же приём, что у теста боезапаса выше: свой одиночный ствол вместо каталога шасси. */
    function armWith(u: MechUnit, weaponId: string): MechUnit {
      const w = WEAPONS.get(weaponId)!;
      const mount: MountState = {
        weapon: weaponId,
        zone: HitZone.Torso,
        ammo: w.ammo,
        destroyed: false,
        slotIndices: [],
        firedThisTurn: false,
      };
      return { ...u, mounts: [mount] };
    }

    it('бывает частичное попадание — не все ракеты долетают синхронно', () => {
      const { state, a, b } = battle();
      const srm6 = armWith(a, 'is_srm6');
      const seenCounts = new Set<number>();
      for (let i = 0; i < 300; i++) {
        const res = resolveAttack(state.rng, { map: state.map, attacker: srm6, target: b, mountIndex: 0 });
        if (!res.impossible) seenCounts.add(res.shots.length);
      }
      // Раньше долетали либо все шесть, либо ни одной — ровно два значения.
      // Независимые броски по ракете обязаны дать хотя бы одно промежуточное.
      const partial = [...seenCounts].some((n) => n > 0 && n < 6);
      expect(partial).toBe(true);
    });

    it('clusterShots — по записи на ракету у ракетного оружия, null у прочих', () => {
      const { state, a, b } = battle();
      const srm6 = armWith(a, 'is_srm6');
      const res = resolveAttack(state.rng, { map: state.map, attacker: srm6, target: b, mountIndex: 0 });
      expect(res.clusterShots).not.toBeNull();
      expect(res.clusterShots).toHaveLength(6);
      // Долетевших ровно столько, сколько записей landed:true — и ровно
      // столько же зон разыграно (res.shots — то, что реально ушло в урон).
      const landed = res.clusterShots!.filter((s) => s.landed).length;
      expect(res.shots).toHaveLength(landed);

      // Некластерный ствол (АП/10, штатный мount[0] шасси) — как раньше.
      const acRes = resolveAttack(state.rng, { map: state.map, attacker: a, target: b, mountIndex: 0 });
      expect(acRes.clusterShots).toBeNull();
    });

    it('каждая запись согласована: долетела — значит попала намерением и не сорвалась', () => {
      const { state, a, b } = battle();
      const srm6 = armWith(a, 'is_srm6');
      for (let i = 0; i < 200; i++) {
        const res = resolveAttack(state.rng, { map: state.map, attacker: srm6, target: b, mountIndex: 0 });
        if (res.impossible || res.clusterShots === null) continue;
        for (const s of res.clusterShots) {
          if (s.landed) {
            expect(s.intentHit).toBe(true);
            expect(s.execution?.botched).toBe(false);
          } else if (s.intentHit) {
            expect(s.execution?.botched).toBe(true);
          }
        }
      }
    });

    it('Ultra-автопушка (shots: 2, cluster: false) остаётся одним броском на весь залп', () => {
      const { state, a, b } = battle();
      // Клановая Ультра-АП/20 бьёт дважды одним решением (шаг 46b) — это НЕ
      // ракетный кластер, шаг 66b её не трогает.
      const uac = armWith(a, 'cl_uac20');
      const seenCounts = new Set<number>();
      for (let i = 0; i < 300; i++) {
        const res = resolveAttack(state.rng, { map: state.map, attacker: uac, target: b, mountIndex: 0 });
        if (!res.impossible) seenCounts.add(res.shots.length);
        expect(res.clusterShots).toBeNull();
      }
      // Ровно 0 или 2 — партиала (1) быть не должно.
      expect([...seenCounts].every((n) => n === 0 || n === 2)).toBe(true);
    });
  });
});

describe('Штраф за перебитый привод руки (шаг 4)', () => {
  const map = new HexMap(20, 20);

  function unitAt(id: string, chassisId: string, q: number, r: number): MechUnit {
    return makeUnit({
      id,
      side: id === 'a' ? 'player' : 'opfor',
      chassis: chassisId,
      pilot: { ...makePilot(new Rng(5), { id: `p-${id}`, tier: 5 }), firstBattle: false },
      hex: hex(q, r),
      facing: Direction.NW,
    });
  }

  it('кусает только ту руку, в которой перебит привод', () => {
    const shooter = unitAt('a', 'IS-H75-R3F3', 2, 2);
    const target = unitAt('b', 'IS-H55-R3F2', 4, 2);

    // ППК стоит в правой руке, АП/10 — в левой.
    const ppc = shooter.mounts.findIndex((m) => m.weapon === 'is_ppc');
    const ac10 = shooter.mounts.findIndex((m) => m.weapon === 'is_ac10');
    expect(ppc).toBeGreaterThanOrEqual(0);
    expect(ac10).toBeGreaterThanOrEqual(0);

    const hurt: MechUnit = { ...shooter, armActuatorHits: [0, 1] }; // перебита правая

    const rightBefore = toHitBreakdown(map, shooter, target, 'is_ppc', HitZone.RightArm).target;
    const rightAfter = toHitBreakdown(map, hurt, target, 'is_ppc', HitZone.RightArm).target;
    const leftAfter = toHitBreakdown(map, hurt, target, 'is_ac10', HitZone.LeftArm).target;
    const leftBefore = toHitBreakdown(map, shooter, target, 'is_ac10', HitZone.LeftArm).target;

    expect(rightAfter).toBe(rightBefore + 1);
    expect(leftAfter).toBe(leftBefore);
  });

  it('орудие в торсе привода рук не замечает', () => {
    const shooter = unitAt('a', 'IS-H75-R3F3', 2, 2);
    const target = unitAt('b', 'IS-H55-R3F2', 4, 2);
    const hurt: MechUnit = { ...shooter, armActuatorHits: [2, 2] };

    expect(toHitBreakdown(map, hurt, target, 'is_ml', HitZone.Torso).target).toBe(
      toHitBreakdown(map, shooter, target, 'is_ml', HitZone.Torso).target,
    );
  });
});

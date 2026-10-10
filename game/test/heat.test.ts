import { describe, expect, it } from 'vitest';
import { execute, RejectReason, type BattleEvent } from '../src/core/commands/index.js';
import { BattleState, makeUnit, Phase, type MechUnit } from '../src/core/model/index.js';
import { Rng, RngSet } from '../src/core/rng/index.js';
import { heatLimits, makePilot, wouldShutDown } from '../src/core/rules/index.js';
import { HexMap, MoveMode } from '../src/core/map/index.js';
import { COMBAT, registerDynamicChassis } from '../src/core/data/tables.js';
import { unitDissipation } from '../src/core/model/MechUnit.js';
import {
  assemblyToChassisDef,
  generateAssembly,
  validateAssembly,
  type MechAssembly,
  type MountedItem,
} from '../src/core/rules/construction.js';
import { makeRecord, type MechRecord } from '../src/core/campaign/mech/MechRecord.js';
import { fastResolveDetailed, type BattleBrief } from '../src/core/campaign/index.js';

function pilot(id: string) {
  const p = makePilot(new Rng(42), { id, tier: 5 });
  return { ...p, firstBattle: false };
}

function testUnit(id: string, side: 'player' | 'opfor' = 'player', heat = 0): MechUnit {
  const u = makeUnit({
    id,
    side,
    chassis: 'IS-H55-R3F2',
    pilot: pilot(`pilot-${id}`),
    hex: { q: side === 'player' ? 0 : 5, r: 0 },
    facing: 0,
  });
  return { ...u, heat };
}

function testState(units: MechUnit[]): BattleState {
  const map = new HexMap(10, 10);
  const state = new BattleState(map, new RngSet(12345));
  for (const u of units) {
    state.addUnit(u);
  }
  state.phase = Phase.Heat;
  state.turn = 1;
  return state;
}

describe('Аварийное отключение реактора и тепловые риски (Часть C)', () => {
  it('тепло выше предела на единицу — мех уходит в shutdown в фазе тепла', () => {
    const cold = testUnit('mech-1', 'player');
    const { limit } = heatLimits(cold);
    const state = testState([{ ...cold, heat: limit + 1 }]);

    const res = execute(state, { kind: 'endPhase' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const shutdownEvent = res.events.find((e: BattleEvent) => e.kind === 'shutdown');
    expect(shutdownEvent).toEqual({ kind: 'shutdown', unitId: 'mech-1', heat: limit + 1, limit });

    const updated = state.getUnit('mech-1')!;
    expect(updated.shutdown).toBe(true);
  });

  it('залп ровно в предел реактор держит, но остывает машина только на отвод', () => {
    const cold = testUnit('mech-1', 'player');
    const limits = heatLimits(cold);
    expect(limits.dissipation).toBe(unitDissipation(cold));
    expect(limits.limit).toBe(limits.dissipation + COMBAT.heat.hullReserve.medium);
    const state = testState([{ ...cold, heat: limits.limit }]);

    const res = execute(state, { kind: 'endPhase' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    expect(res.events.some((e: BattleEvent) => e.kind === 'shutdown')).toBe(false);
    const updated = state.getUnit('mech-1')!;
    expect(updated.shutdown).toBe(false);
    // Запас корпуса за ход не остывает: он возвращается только через ход передышки.
    expect(updated.heat).toBe(limits.reserve);
  });

  it('выбитый радиатор опускает порог отключения на своё очко', () => {
    const cold = testUnit('mech-1', 'player');
    const before = heatLimits(cold).shutdownAt;
    let zone = -1;
    let index = -1;
    cold.slots.forEach((zs, z) => {
      const i = zs.findIndex((s) => s.kind === 'heatsink');
      if (zone < 0 && i >= 0) {
        zone = z;
        index = i;
      }
    });
    expect(zone).toBeGreaterThanOrEqual(0);
    const hit: MechUnit = {
      ...cold,
      slots: cold.slots.map((zs, z) =>
        z === zone ? zs.map((s, i) => (i === index ? { ...s, destroyed: true } : s)) : zs,
      ),
    };
    expect(heatLimits(hit).shutdownAt).toBe(before - 1);
  });

  it('только что перезапущенный реактор не отключается — и интерфейс об этом не предупреждает', () => {
    const cold = testUnit('mech-1', 'player');
    const hot: MechUnit = { ...cold, heat: heatLimits(cold).limit + 5 };
    expect(wouldShutDown(hot)).toBe(true);
    expect(wouldShutDown({ ...hot, shutdownLastTurn: true })).toBe(false);
    expect(wouldShutDown({ ...hot, shutdown: true })).toBe(false);
  });

  it('обесточенный мех не может двигаться и стрелять (unitShutdown)', () => {
    const u1 = { ...testUnit('mech-1', 'player', 10), shutdown: true };
    const u2 = testUnit('mech-2', 'opfor', 0);
    const state = testState([u1, u2]);

    // Фаза движения
    state.phase = Phase.Movement;
    const moveRes = execute(state, {
      kind: 'move',
      unitId: 'mech-1',
      path: [{ q: 0, r: 0 }, { q: 0, r: 1 }],
      mode: MoveMode.Walk,
    });
    expect(moveRes.ok).toBe(false);
    if (!moveRes.ok) {
      expect(moveRes.reason).toBe(RejectReason.PilotUnfit); // isOperational is false when shutdown
    }

    // Фаза стрельбы
    state.phase = Phase.Attack;
    const attackRes = execute(state, {
      kind: 'attack',
      unitId: 'mech-1',
      targetId: 'mech-2',
      mountIndex: 0,
    });
    expect(attackRes.ok).toBe(false);
    if (!attackRes.ok) {
      expect(attackRes.reason).toBe(RejectReason.PilotUnfit);
    }
  });

  it('в конце следующего хода обесточенный мех автоматически перезапускается', () => {
    const u1 = { ...testUnit('mech-1', 'player', 10), shutdown: true };
    const state = testState([u1]);

    const res = execute(state, { kind: 'endPhase' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const restartedEvent = res.events.find((e: BattleEvent) => e.kind === 'restarted');
    expect(restartedEvent).toBeDefined();

    const updated = state.getUnit('mech-1')!;
    expect(updated.shutdown).toBe(false);
    expect(updated.shutdownLastTurn).toBe(true);
  });

  it('защита от петли: только что перезапустившийся мех не отключается снова в том же ходу', () => {
    const u1 = { ...testUnit('mech-1', 'player', 20), shutdown: true };
    const state = testState([u1]);

    // Ход перезапуска
    const res = execute(state, { kind: 'endPhase' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const updated = state.getUnit('mech-1')!;
    expect(updated.shutdown).toBe(false);
    // Несмотря на то, что остаточное тепло может быть >= 14, мех не должен был отключиться повторно
    const secondShutdown = res.events.find((e: BattleEvent) => e.kind === 'shutdown');
    expect(secondShutdown).toBeUndefined();
  });

  it('бег греет ровно на runHeat (шаг 8, часть C: движенческое тепло подключено)', () => {
    // Стартовое тепло заведомо выше рассеивания: иначе «стоял» упирается в
    // нижний ноль, и разница с «бежал» перестаёт быть чистым runHeat.
    const still = testState([testUnit('still', 'player', 20)]);
    const ran = testState([
      { ...testUnit('ran', 'player', 20), moveMode: MoveMode.Run, hexesMoved: 3 },
    ]);

    execute(still, { kind: 'endPhase' });
    execute(ran, { kind: 'endPhase' });

    expect(ran.getUnit('ran')!.heat).toBe(still.getUnit('still')!.heat + COMBAT.heat.runHeat);
  });

  it('прыжок греет по гексу, не по факту прыжка', () => {
    const still = testState([testUnit('still', 'player', 20)]);
    const jumped = testState([
      { ...testUnit('jumped', 'player', 20), moveMode: MoveMode.Jump, hexesMoved: 4 },
    ]);

    execute(still, { kind: 'endPhase' });
    execute(jumped, { kind: 'endPhase' });

    expect(jumped.getUnit('jumped')!.heat).toBe(
      still.getUnit('still')!.heat + COMBAT.heat.jumpHeatPerHex * 4,
    );
  });
});

describe('Одна тепловая шкала на цех и на бой (шаг 46)', () => {
  it('отвод в бою равен отводу в наряде цеха — на всех тоннажах, ролях и классах реактора', () => {
    // Страховка от возврата расхождения, из-за которого ангар обещал машине
    // отвод 16, а бой давал 6-8: конструктор складывал ОЧКИ (реактор 10/20,
    // двойной охладитель 2, одинарный 1), а бой читал ту же графу как ЧИСЛО
    // ЖЕЛЕЗОК и делил пополам. Двойной охладитель отдавал столько же, сколько
    // одинарный, а восстановленный реактор не отличался от серийного.
    const rng = new Rng(2026);
    for (let i = 0; i < 120; i++) {
      const assembly = generateAssembly(
        {
          tonnage: [25, 35, 45, 55, 65, 75, 85, 100][i % 8]!,
          role: (['brawler', 'sniper', 'skirmisher', 'scout'] as const)[i % 4]!,
          quality: {
            reactor: (['recovered', 'standard', 'military', 'master'] as const)[i % 4]!,
            frame: 'standard',
          },
        },
        rng,
      );
      const report = validateAssembly(assembly);
      const def = assemblyToChassisDef(assembly);
      registerDynamicChassis({ ...def, id: `${def.id}~heat-scale-${i}` });
      const unit = makeUnit({
        id: `scale-${i}`,
        side: 'player',
        chassis: `${def.id}~heat-scale-${i}`,
        pilot: pilot(`scale-${i}`),
        hex: { q: 0, r: 0 },
        facing: 0,
      });
      expect(unitDissipation(unit)).toBe(report.heatDissipation);
    }
  });

  it('двойной охладитель отводит вдвое больше одинарного, и это видно в бою', () => {
    const base: MechAssembly = {
      chassisCode: 'IS-H55-R3F2',
      name: 'Стенд охлаждения',
      role: 'brawler',
      techBase: 'is',
      tonnage: 55,
      armorTons: 5,
      items: [{ id: 'is_ml', kind: 'weapon', zone: 'rightArm' }],
    };
    const withSingles: MechAssembly = {
      ...base,
      items: [...base.items, { id: 'is_shs', kind: 'heatsink', zone: 'torso' },
        { id: 'is_shs', kind: 'heatsink', zone: 'leftLeg' },],
    };
    const withDoubles: MechAssembly = {
      ...base,
      items: [...base.items, { id: 'is_dhs', kind: 'heatsink', zone: 'torso' },
        { id: 'is_dhs', kind: 'heatsink', zone: 'leftLeg' },],
    };
    const dissOf = (a: MechAssembly, tag: string): number => {
      const def = assemblyToChassisDef(a);
      registerDynamicChassis({ ...def, id: `${def.id}~${tag}` });
      return unitDissipation(
        makeUnit({
          id: tag,
          side: 'player',
          chassis: `${def.id}~${tag}`,
          pilot: pilot(tag),
          hex: { q: 0, r: 0 },
          facing: 0,
        }),
      );
    };
    const bare = dissOf(base, 'bare');
    const singles = dissOf(withSingles, 'singles');
    const doubles = dissOf(withDoubles, 'doubles');

    expect(singles - bare).toBe(2);
    expect(doubles - bare).toBe(4);
  });

  it('класс реактора отдаёт в бою ровно то, что обещает таблица классов', () => {
    // recovered -1, standard 0, military +1, master +2 к базовым 10 очкам
    // сферного реактора (`quality.json` → reactor.dissipationDelta; вдвое меньше
    // с шага 51 — тепло оружия вернулось к канону). До шага 46 деление пополам
    // и нижний порог стирали разницу: восстановленный и серийный отводили одинаково.
    const expected = { recovered: 9, standard: 10, military: 11, master: 12 } as const;
    for (const [quality, points] of Object.entries(expected)) {
      const assembly: MechAssembly = {
        chassisCode: 'IS-H55-R3F2',
        name: `Реактор ${quality}`,
        role: 'brawler',
        techBase: 'is',
        tonnage: 55,
        armorTons: 5,
        items: [{ id: 'is_ml', kind: 'weapon', zone: 'rightArm' }],
        quality: { reactor: quality as 'standard', frame: 'standard' },
      };
      const def = assemblyToChassisDef(assembly);
      registerDynamicChassis({ ...def, id: `${def.id}~q-${quality}` });
      const unit = makeUnit({
        id: `q-${quality}`,
        side: 'player',
        chassis: `${def.id}~q-${quality}`,
        pilot: pilot(`q-${quality}`),
        hex: { q: 0, r: 0 },
        facing: 0,
      });
      expect(unitDissipation(unit)).toBe(points);
    }
  });
});

describe('Клановое охлаждение в обоих расчётах боя (шаг 46)', () => {
  /** Клановая машина мехлабовской сборкой: реактор 20 очков + двойные по 2. */
  function clanMech(id: string, sinks: number, weapons: number): MechRecord {
    const items: MountedItem[] = [];
    for (let i = 0; i < weapons; i++) {
      items.push({ id: 'cl_er_ml', kind: 'weapon', zone: i % 2 === 0 ? 'rightArm' : 'leftArm' });
    }
    const zones = ['torso', 'leftLeg', 'rightLeg', 'leftArm'] as const;
    for (let i = 0; i < sinks; i++) {
      items.push({ id: 'cl_dhs', kind: 'heatsink', zone: zones[i % zones.length]! });
    }
    return makeRecord({
      id,
      assembly: {
        chassisCode: 'CL-H55-R3F2',
        name: id,
        role: 'brawler',
        techBase: 'clan',
        tonnage: 55,
        armorTons: 6,
        items,
      },
    });
  }

  it('мехлаб: клановый реактор 20 плюс двойные по 2 очка — и цех, и бой считают одинаково', () => {
    for (const sinks of [0, 1, 2, 4, 6]) {
      const record = clanMech(`CL-${sinks}`, sinks, 2);
      const report = validateAssembly(record.assembly);
      const def = assemblyToChassisDef(record.assembly);
      registerDynamicChassis({ ...def, id: `${def.id}~cl-${sinks}` });
      const unit = makeUnit({
        id: `cl-${sinks}`,
        side: 'player',
        chassis: `${def.id}~cl-${sinks}`,
        pilot: pilot(`cl-${sinks}`),
        hex: { q: 0, r: 0 },
        facing: 0,
      });

      expect(report.heatDissipation).toBe(20 + sinks * 2);
      expect(unitDissipation(unit)).toBe(20 + sinks * 2);
      // Клановый двойной занимает две ячейки и даёт два очка — обе цены сходятся.
      expect(report.slotsUsed.torso + report.slotsUsed.leftLeg + report.slotsUsed.rightLeg + report.slotsUsed.leftArm)
        .toBeGreaterThanOrEqual(sinks * 2);
    }
  });

  it('полный бой: за фазу тепла машина снимает ровно свой отвод', () => {
    const record = clanMech('CL-HEAT', 3, 2);
    const def = assemblyToChassisDef(record.assembly);
    registerDynamicChassis({ ...def, id: `${def.id}~cl-phase` });
    const cold = makeUnit({
      id: 'cl-phase',
      side: 'player',
      chassis: `${def.id}~cl-phase`,
      pilot: pilot('cl-phase'),
      hex: { q: 0, r: 0 },
      facing: 0,
    });
    const dissipation = unitDissipation(cold);
    expect(dissipation).toBe(26);

    const state = testState([{ ...cold, heat: 26 } as MechUnit]);
    const res = execute(state, { kind: 'endPhase' });
    expect(res.ok).toBe(true);
    expect(state.getUnit('cl-phase')!.heat).toBe(26 - dissipation);
  });

  it('быстрый расчёт: те же очки решают, перегреется машина или нет', () => {
    // Залп 30 (шесть клановых ER средних по 5) против отвода 20 без охладителей
    // и 32 с шестью двойными. Разница ровно в очках охладителей — и в фоновом
    // мире, которым считаются бои Домов, Кланов и соперников, она обязана
    // работать так же, как в отыгранном бою.
    //
    // До шага 51 сценарий был «залп ровно в отвод»: два ствола по 10 против
    // отвода 20. При каноническом тепле (ствол 5) и вдвое меньшем запасе корпуса
    // залп в отвод прибавляет к остатку не больше единицы за раунд и до порога
    // отключения за бой не доходит — проверять стало нечего. Поэтому машина без
    // охладителей теперь заведомо недоохлаждена, а с охладителями — заведомо нет.
    //
    // СУММА ПО ДЮЖИНЕ СИДОВ, а не один бой: стреляют не все стволы каждый раунд
    // (`fireChance`), и перегрев на одном сиде зависит от длины боя. С шестью
    // двойными перегрева не бывает в принципе (отвод 32 против залпа 30 и
    // движения 1).
    const run = (sinks: number): number => {
      let total = 0;
      for (let seed = 1; seed <= 12; seed++) {
        const brief: BattleBrief = {
          mapSeed: seed,
          battleSeed: seed,
          company: [
            { record: clanMech('HOT-1', sinks, 6), pilot: pilot('hot-1') },
            { record: clanMech('HOT-2', sinks, 6), pilot: pilot('hot-2') },
          ],
          enemy: [
            { record: clanMech('FOE-1', 4, 4), pilot: pilot('foe-1') },
            { record: clanMech('FOE-2', 4, 4), pilot: pilot('foe-2') },
          ],
        };
        const detailed = fastResolveDetailed(brief);
        total += detailed.outcome.units
          .filter((u) => u.side === 'player')
          .reduce((acc, u) => acc + u.overheatTurns, 0);
      }
      return total;
    };

    const undercooled = run(0);
    const cooled = run(6);
    expect(cooled).toBeLessThan(undercooled);
    expect(cooled).toBe(0);
  });
});

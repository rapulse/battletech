import { describe, expect, it } from 'vitest';
import { execute, RejectReason } from '../src/core/commands/index.js';
import { COMBAT } from '../src/core/data/tables.js';
import { Phase, hashBattleState, type BattleState, type Side } from '../src/core/model/index.js';
import { missionObjective } from '../src/core/campaign/contracts/active.js';
import { reputationOutcomeOf } from '../src/core/campaign/contracts/salvage.js';
import { buildOutcome } from '../src/core/campaign/bridge/fromBattle.js';
import {
  atHomeEdge,
  distanceToEdge,
  homeEdgeOf,
  moraleBreak,
  moraleReading,
} from '../src/core/rules/morale.js';
import { chooseSideAction } from '../src/sim/bot.js';
import { runBattle } from '../src/sim/autoBattle.js';
import { LANCE_VS_LANCE, makeBattle, type UnitSpec } from '../src/sim/scenario.js';

/**
 * Шаг 43 — мораль стороны и отход с поля.
 *
 * Проверяется ровно то, на чём шаг стоит: правило чистое и не трогает ГПСЧ,
 * царапина отряд не ломает, разгром ломает, Хладнокровие держит строй, ушедшая
 * машина не становится трофеем, а обездвиженная становится.
 */

/** Звено против звена на большой карте: четыре машины, есть кого терять. */
const FOUR_VS_FOUR: readonly UnitSpec[] = [
  ...LANCE_VS_LANCE,
  { id: 'Копьё-3', side: 'player', chassis: 'IS-H35-R3F1', col: 4, row: 14, tier: 4 },
  { id: 'Копьё-4', side: 'player', chassis: 'IS-H55-R3F2', col: 6, row: 14, tier: 4 },
  { id: 'Цель-C', side: 'opfor', chassis: 'IS-H35-R3F1', col: 10, row: 3, tier: 4 },
  { id: 'Цель-D', side: 'opfor', chassis: 'IS-H55-R3F2', col: 12, row: 3, tier: 4 },
];

function battle(seed = 4242): BattleState {
  return makeBattle({ seed, units: FOUR_VS_FOUR });
}

/** Выбить машину «по-настоящему»: как это делает бой — через замену юнита. */
function knockOut(state: BattleState, id: string): void {
  const u = state.requireUnit(id);
  state.replaceUnit({ ...u, destroyed: true });
}

/** Снять с машины всю броню и структуру, кроме единицы: побита, но жива. */
function batter(state: BattleState, id: string): void {
  const u = state.requireUnit(id);
  state.replaceUnit({
    ...u,
    zones: u.zones.map((z) => ({ ...z, armor: 0, structure: Math.min(z.structure, 1) })),
  });
}

function withComposure(state: BattleState, side: Side, level: number): void {
  for (const u of state.units) {
    if (u.side !== side) continue;
    state.replaceUnit({ ...u, pilot: { ...u.pilot, skills: { ...u.pilot.skills, composure: level } } });
  }
}

describe('правило морали', () => {
  it('чистое: одно и то же состояние даёт то же решение и не трогает ГПСЧ', () => {
    const state = battle();
    state.turn = 6;
    knockOut(state, 'Цель-A');
    knockOut(state, 'Цель-B');

    const before = hashBattleState(state);
    const first = moraleReading(state, 'opfor');
    const second = moraleReading(state, 'opfor');

    expect(second).toEqual(first);
    // Хэш включает состояние всех потоков ГПСЧ: сдвинься хоть один, он уедет.
    expect(hashBattleState(state)).toBe(before);
  });

  it('не срабатывает на царапине', () => {
    const state = battle();
    state.turn = 10;
    const u = state.requireUnit('Цель-A');
    const zone = u.zones[1]!;
    state.replaceUnit({
      ...u,
      zones: u.zones.map((z, i) => (i === 1 ? { ...z, armor: Math.max(0, zone.armor - 2) } : z)),
    });

    expect(moraleBreak(state, 'opfor')).toBe(false);
  });

  it('срабатывает на разгроме: половина звена выбита против целого противника', () => {
    const state = battle();
    state.turn = 10;
    knockOut(state, 'Цель-A');
    knockOut(state, 'Цель-B');
    batter(state, 'Цель-C');

    expect(moraleBreak(state, 'opfor')).toBe(true);
  });

  it('раньше checkFromTurn не срабатывает никогда: бой ещё не начался', () => {
    const state = battle();
    state.turn = COMBAT.morale.checkFromTurn - 1;
    knockOut(state, 'Цель-A');
    knockOut(state, 'Цель-B');
    knockOut(state, 'Цель-C');

    expect(moraleBreak(state, 'opfor')).toBe(false);
    state.turn = COMBAT.morale.checkFromTurn;
    expect(moraleBreak(state, 'opfor')).toBe(true);
  });

  it('Хладнокровие держит строй: тот же расклад терпят дольше', () => {
    const make = (composure: number): number => {
      const state = battle();
      state.turn = 10;
      withComposure(state, 'opfor', composure);
      return moraleReading(state, 'opfor').resolve;
    };

    // Проверяется не «сломается/не сломается» на одном раскладе — это зависело
    // бы от того, куда лёг порог, — а САМА стойкость: хладнокровный отряд
    // терпит строго больше.
    expect(make(8)).toBeGreaterThan(make(2));
  });

  it('перевес считается долей, а не разностью: двое против четверых и один против двоих равны', () => {
    const big = battle();
    big.turn = 10;
    const small = battle();
    small.turn = 10;
    // big: 2 машины противника против 4 роты. small: 1 против 2.
    knockOut(big, 'Цель-C');
    knockOut(big, 'Цель-D');
    knockOut(small, 'Цель-B');
    knockOut(small, 'Цель-C');
    knockOut(small, 'Цель-D');
    knockOut(small, 'Копьё-3');
    knockOut(small, 'Копьё-4');

    // У обеих сторон противника вдвое больше.
    expect(moraleReading(big, 'opfor').outnumbered).toBeCloseTo(0.5, 6);
    expect(moraleReading(small, 'opfor').outnumbered).toBeCloseTo(0.5, 6);
  });
});

describe('команда отхода', () => {
  it('объявленный отход не отменяется и не повторяется', () => {
    const state = battle();
    state.phase = Phase.Movement;

    expect(execute(state, { kind: 'withdrawSide', side: 'opfor' }).ok).toBe(true);
    expect(state.isWithdrawing('opfor')).toBe(true);

    const again = execute(state, { kind: 'withdrawSide', side: 'opfor' });
    expect(again).toEqual({ ok: false, reason: RejectReason.AlreadyWithdrawing });
  });

  it('отказ команды не сдвигает состояние: отходить некому', () => {
    const state = battle();
    state.phase = Phase.Movement;
    for (const u of state.units) if (u.side === 'opfor') knockOut(state, u.id);

    const before = hashBattleState(state);
    expect(execute(state, { kind: 'withdrawSide', side: 'opfor' })).toEqual({
      ok: false,
      reason: RejectReason.NoSuchSide,
    });
    expect(hashBattleState(state)).toBe(before);
  });

  it('свой край карты — тот, где сторона ВЫСАДИЛАСЬ, а не тот, к которому прижали', () => {
    const state = battle();
    const edge = homeEdgeOf(state, 'opfor');
    const centre = state.deploymentCentre('opfor');
    expect(centre).not.toBeNull();

    // Машину переставляем к чужому краю — свой край от этого не двигается.
    const u = state.units.find((x) => x.side === 'opfor')!;
    const far = state.units.find((x) => x.side === 'player')!;
    state.replaceUnit({ ...u, hex: far.hex });
    expect(homeEdgeOf(state, 'opfor')).toBe(edge);
  });

  it('дошедшая до своего края уходит с поля целой, обездвиженная остаётся', () => {
    const state = battle();
    state.phase = Phase.Movement;
    execute(state, { kind: 'withdrawSide', side: 'opfor' });

    const edge = homeEdgeOf(state, 'opfor');
    const runner = state.requireUnit('Цель-A');
    const stuck = state.requireUnit('Цель-B');

    // Бегущий поставлен ровно на свой край; обездвиженный — в середине поля.
    const atEdge = state.map.hexAt(
      edge === 'west' || edge === 'east'
        ? Math.floor(state.map.h / 2) * state.map.w + (edge === 'west' ? 0 : state.map.w - 1)
        : (edge === 'north' ? 0 : state.map.h - 1) * state.map.w + Math.floor(state.map.w / 2),
    );
    const centre = state.map.hexAt(Math.floor((state.map.w * state.map.h) / 2));
    // Клетку центра могла занять другая машина — тогда сдвигаем её саму.
    const occupant = state.unitAt(centre);
    if (occupant !== undefined && occupant.id !== stuck.id) {
      state.replaceUnit({ ...occupant, hex: state.map.hexAt(1) });
    }
    state.replaceUnit({ ...state.requireUnit(runner.id), hex: atEdge });
    state.replaceUnit({ ...state.requireUnit(stuck.id), hex: centre });

    expect(atHomeEdge(state, state.requireUnit(runner.id))).toBe(true);
    expect(distanceToEdge(state, edge, centre)).toBeGreaterThan(COMBAT.morale.exitBand);

    const result = execute(state, { kind: 'endPhase' });
    expect(result.ok).toBe(true);

    expect(state.requireUnit(runner.id).withdrawn).toBe(true);
    expect(state.requireUnit(runner.id).destroyed).toBe(false);
    expect(state.requireUnit(stuck.id).withdrawn).toBe(false);
  });

  it('ушедшая машина не числится в строю и не даёт по себе стрелять', () => {
    const state = battle();
    state.phase = Phase.Movement;
    const gone = state.requireUnit('Цель-A');
    state.replaceUnit({ ...gone, withdrawn: true });

    expect(state.active.some((u) => u.id === gone.id)).toBe(false);
    for (const u of state.units) {
      if (u.side !== 'player') continue;
      const shots = execute(state, { kind: 'attack', unitId: u.id, targetId: gone.id, mountIndex: 0 });
      expect(shots.ok).toBe(false);
    }
  });
});

describe('мораль в бою', () => {
  it('решение стороны отдаётся командой и попадает в журнал команд', () => {
    const state = battle();
    state.phase = Phase.Movement;
    state.turn = 10;
    knockOut(state, 'Цель-A');
    knockOut(state, 'Цель-B');
    batter(state, 'Цель-C');

    const decision = chooseSideAction(state, 'opfor');
    expect(decision).toEqual({ kind: 'withdrawSide', side: 'opfor' });
  });

  it('отход воспроизводится реплеем: команда — часть журнала', () => {
    const a = runBattle({ seed: 4242, units: FOUR_VS_FOUR });
    const b = runBattle({ seed: 4242, units: FOUR_VS_FOUR });
    expect(b.hash).toBe(a.hash);
    expect(b.commands.map((c) => c.kind)).toEqual(a.commands.map((c) => c.kind));
  });

  it('на выборке боёв мораль случается и машины действительно уходят', () => {
    let declared = 0;
    let escaped = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const report = runBattle({ seed, units: FOUR_VS_FOUR });
      if (report.stats.sidesWithdrawn > 0) declared += 1;
      escaped += report.stats.unitsWithdrawn;
    }
    expect(declared).toBeGreaterThan(0);
    expect(escaped).toBeGreaterThan(0);
  });
});

describe('шов в кампанию', () => {
  /** Итог боя, в котором часть противника ушла своим ходом. */
  function outcomeWithWithdrawal(): ReturnType<typeof buildOutcome> {
    const state = battle();
    for (const u of state.units) {
      if (u.side !== 'opfor') continue;
      state.replaceUnit({ ...u, withdrawn: true });
    }
    return buildOutcome(state);
  }

  it('ушедший противник — победа роты: в строю его больше нет', () => {
    const outcome = outcomeWithWithdrawal();
    expect(outcome.winner).toBe('player');
    expect(outcome.heldField).toBe(true);
    expect(outcome.enemyWithdrew).toBe(4);
  });

  it('ушедшая машина НЕ трофей: поле очищено не ротой, и премии за разгром нет', () => {
    const outcome = outcomeWithWithdrawal();
    // Трофей выводится из `destroyed`, а ушедшая машина цела.
    expect(outcome.units.filter((u) => u.side === 'opfor' && u.unit.destroyed)).toHaveLength(0);
    // `beyond` платится за очищенное поле; ушедший противник считается
    // оставшимся (`salvage.ts`).
    expect(reputationOutcomeOf('won', outcome, 'garrison')).toBe('won');
    // А задача при этом — не «разгром»: иначе проверка была бы бессодержательной.
    expect(missionObjective('garrison').kind).not.toBe('destroy');
  });
});

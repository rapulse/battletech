import { describe, expect, it } from 'vitest';
import { execute, RejectReason } from '../src/core/commands/index.js';
import { buildOutcome } from '../src/core/campaign/bridge/fromBattle.js';
import { contractResultOf } from '../src/core/campaign/contracts/salvage.js';
import { Phase, hashBattleState, type BattleState } from '../src/core/model/index.js';
import { atHomeEdge, exitReading, homeEdgeOf, inExitBand } from '../src/core/rules/morale.js';
import { hexToOffset, offsetToHex } from '../src/core/hex/index.js';
import { buildMapView, key as viewKey } from '../src/render/mapView.js';
import { buildScene } from '../src/render/scene.js';
import { LANCE_VS_LANCE, makeBattle, type UnitSpec } from '../src/sim/scenario.js';

/**
 * Шаг 65 — кнопка «отвести звено» с предупреждением.
 *
 * Игрок выходит из боя когда угодно, но уходят только машины в зоне выхода у своего
 * края; остальные остаются на поле и теряются. Ядро само говорит, сколько где
 * (`exitReading`), а команда `evacuate` делает то, о чём предупредили.
 */

const FOUR_VS_FOUR: readonly UnitSpec[] = [
  ...LANCE_VS_LANCE,
  { id: 'Копьё-3', side: 'player', chassis: 'IS-H35-R3F1', col: 4, row: 14, tier: 4 },
  { id: 'Копьё-4', side: 'player', chassis: 'IS-H55-R3F2', col: 6, row: 14, tier: 4 },
  { id: 'Цель-C', side: 'opfor', chassis: 'IS-H35-R3F1', col: 10, row: 3, tier: 4 },
  { id: 'Цель-D', side: 'opfor', chassis: 'IS-H55-R3F2', col: 12, row: 3, tier: 4 },
];

function battle(): BattleState {
  const state = makeBattle({ seed: 4242, units: FOUR_VS_FOUR });
  state.phase = Phase.Movement;
  return state;
}

/** Клетка на самом крае своей стороны; `slot` сдвигает вдоль края, чтобы не делить клетку. */
function edgeHex(state: BattleState, slot: number) {
  const edge = homeEdgeOf(state, 'player');
  const mid = Math.floor(state.map.w / 2) + slot;
  const index =
    edge === 'west' || edge === 'east'
      ? (Math.floor(state.map.h / 2) + slot) * state.map.w + (edge === 'west' ? 0 : state.map.w - 1)
      : (edge === 'north' ? 0 : state.map.h - 1) * state.map.w + mid;
  return state.map.hexAt(index);
}

function placeAtEdge(state: BattleState, id: string, slot: number): void {
  state.replaceUnit({ ...state.requireUnit(id), hex: edgeHex(state, slot) });
}

/** Центр карты: заведомо вне зоны выхода. Занявшую его машину сдвигаем в сторону. */
function placeAtCentre(state: BattleState, id: string): void {
  const centre = state.map.hexAt(Math.floor((state.map.w * state.map.h) / 2));
  const occupant = state.unitAt(centre);
  if (occupant !== undefined && occupant.id !== id) {
    state.replaceUnit({ ...occupant, hex: state.map.hexAt(1) });
  }
  state.replaceUnit({ ...state.requireUnit(id), hex: centre });
}

/** Три машины из четырёх в зоне выхода, одна посреди поля. */
function threeOfFour(): BattleState {
  const state = battle();
  placeAtEdge(state, 'Копьё-1', 0);
  placeAtEdge(state, 'Копьё-2', 1);
  placeAtEdge(state, 'Копьё-3', 2);
  placeAtCentre(state, 'Копьё-4');
  return state;
}

describe('предупреждение перед выходом', () => {
  it('считает, сколько машин в зоне выхода, а сколько нет', () => {
    const reading = exitReading(threeOfFour(), 'player');
    expect(reading.inZone.map((u) => u.id)).toEqual(['Копьё-1', 'Копьё-2', 'Копьё-3']);
    expect(reading.stranded.map((u) => u.id)).toEqual(['Копьё-4']);
  });

  it('выбывшие в счёт не идут: они потеряны и так', () => {
    const state = threeOfFour();
    state.replaceUnit({ ...state.requireUnit('Копьё-4'), destroyed: true });
    const reading = exitReading(state, 'player');
    expect(reading.inZone).toHaveLength(3);
    expect(reading.stranded).toHaveLength(0);
  });

  it('вопрос «в зоне ли клетка» один и для предупреждения, и для ухода', () => {
    const state = battle();
    const probe = state.requireUnit('Копьё-1');
    for (let row = 0; row < state.map.h; row++) {
      for (let col = 0; col < state.map.w; col++) {
        const hex = offsetToHex(col, row);
        expect(inExitBand(state, 'player', hex)).toBe(atHomeEdge(state, { ...probe, hex }));
      }
    }
  });
});

describe('команда выхода', () => {
  it('уходят стоящие в зоне, остальные остаются и теряются', () => {
    const state = threeOfFour();
    const result = execute(state, { kind: 'evacuate', side: 'player' });
    expect(result.ok).toBe(true);

    for (const id of ['Копьё-1', 'Копьё-2', 'Копьё-3']) {
      const u = state.requireUnit(id);
      expect(u.withdrawn).toBe(true);
      expect(u.destroyed).toBe(false);
    }
    const stranded = state.requireUnit('Копьё-4');
    expect(stranded.withdrawn).toBe(false);
    expect(stranded.destroyed).toBe(true);

    // Противник не тронут.
    for (const u of state.units) if (u.side === 'opfor') expect(u.destroyed || u.withdrawn).toBe(false);
  });

  it('события называют каждую машину: ушла или оставлена', () => {
    const state = threeOfFour();
    const result = execute(state, { kind: 'evacuate', side: 'player' });
    if (!result.ok) throw new Error('команда отвергнута');
    expect(result.events.filter((e) => e.kind === 'unitWithdrew')).toHaveLength(3);
    expect(result.events).toContainEqual({ kind: 'unitAbandoned', unitId: 'Копьё-4', side: 'player' });
  });

  it('никого в зоне нет — теряются все', () => {
    const state = battle();
    const centre = Math.floor((state.map.w * state.map.h) / 2);
    ['Копьё-1', 'Копьё-2', 'Копьё-3', 'Копьё-4'].forEach((id, i) => {
      state.replaceUnit({ ...state.requireUnit(id), hex: state.map.hexAt(centre + i) });
    });
    expect(exitReading(state, 'player').inZone).toHaveLength(0);

    execute(state, { kind: 'evacuate', side: 'player' });

    const company = state.units.filter((u) => u.side === 'player');
    expect(company.every((u) => u.destroyed && !u.withdrawn)).toBe(true);
  });

  it('вся рота в зоне — потерь нет', () => {
    const state = battle();
    ['Копьё-1', 'Копьё-2', 'Копьё-3', 'Копьё-4'].forEach((id, slot) => placeAtEdge(state, id, slot));
    execute(state, { kind: 'evacuate', side: 'player' });
    const company = state.units.filter((u) => u.side === 'player');
    expect(company.every((u) => u.withdrawn && !u.destroyed)).toBe(true);
  });

  it('некому выходить — отказ, и состояние не сдвинулось', () => {
    const state = battle();
    for (const u of state.units) if (u.side === 'player') state.replaceUnit({ ...u, destroyed: true });
    const before = hashBattleState(state);
    expect(execute(state, { kind: 'evacuate', side: 'player' })).toEqual({
      ok: false,
      reason: RejectReason.NoSuchSide,
    });
    expect(hashBattleState(state)).toBe(before);
  });

  it('в разбор это уходит как отход: неустойки нет, потерянные списаны с полем', () => {
    const state = threeOfFour();
    execute(state, { kind: 'evacuate', side: 'player' });
    const outcome = buildOutcome(state);
    expect(outcome.heldField).toBe(false);
    expect(contractResultOf(outcome, true)).toBe('withdrawn');
  });
});

describe('зона выхода на карте', () => {
  function sceneOf(state: BattleState, showExitZone: boolean) {
    if (state.mapDescriptor === null) throw new Error('у боя нет описания карты');
    return buildScene({
      state,
      viewer: 'player',
      mapView: buildMapView(state.map, state.mapDescriptor),
      selectedId: null,
      hover: null,
      hoveredWeapon: null,
      mode: 'move',
      reach: null,
      showExitZone,
    });
  }

  it('без просьбы зоны на карте нет', () => {
    expect(sceneOf(battle(), false).exitBand.size).toBe(0);
  });

  it('подсвечены ровно те клетки, откуда машина уходит', () => {
    const state = battle();
    const scene = sceneOf(state, true);
    expect(scene.exitBand.size).toBeGreaterThan(0);
    for (let row = 0; row < state.map.h; row++) {
      for (let col = 0; col < state.map.w; col++) {
        expect(scene.exitBand.has(viewKey(col, row))).toBe(inExitBand(state, 'player', offsetToHex(col, row)));
      }
    }
    // Крайняя клетка своего края в зоне, центр карты — нет.
    const { col, row } = hexToOffset(edgeHex(state, 0));
    expect(scene.exitBand.has(viewKey(col, row))).toBe(true);
    const mid = hexToOffset(state.map.hexAt(Math.floor((state.map.w * state.map.h) / 2)));
    expect(scene.exitBand.has(viewKey(mid.col, mid.row))).toBe(false);
  });
});

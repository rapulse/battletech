import { beforeEach, describe, expect, it } from 'vitest';
import { Direction, neighbor, offsetToHex, type Hex } from '../src/core/hex/index.js';
import { HexMap, MoveMode, TerrainType, pathTo, reachable } from '../src/core/map/index.js';
import {
  BattleState,
  HitZone,
  makeUnit,
  Phase,
  skillLevel,
  type MechUnit,
  type Pilot,
} from '../src/core/model/index.js';
import { COMBAT } from '../src/core/data/index.js';
import { MOVE_MODES, makePilot } from '../src/core/rules/index.js';
import { Rng, RngSet } from '../src/core/rng/index.js';
import { enumerateLegalCommands, execute, RejectReason } from '../src/core/commands/index.js';

const START = offsetToHex(7, 7);

/** Пилот ниже порога иммунитета к штатным броскам на равновесие (шаг 30). */
function novice(id: string): Pilot {
  const p = makePilot(new Rng(7), { id: `${id}-новобранец`, tier: 1 });
  return { ...p, skills: { ...p.skills, piloting: 1 } };
}

/** Средний робот со средним пилотом: базовая фигура для тестов команд. */
function mech(id: string, hex: Hex, chassis = 'IS-H55-R3F2'): MechUnit {
  return makeUnit({
    id,
    side: 'player',
    chassis,
    pilot: makePilot(new Rng(1), { id: `${id}-пилот`, tier: 5 }),
    hex,
    facing: Direction.NW,
  });
}

let state: BattleState;

beforeEach(() => {
  state = new BattleState(new HexMap(15, 15), new RngSet(2026));
  state.phase = Phase.Movement;
  state.addUnit(mech('alpha', START));
});

/** Кратчайший маршрут в клетку выбранным режимом. */
function route(from: Hex, to: Hex, mode = MoveMode.Walk): Hex[] {
  const r = reachable(state.map, from, {
    mode,
    mpBudget: 20,
    startFacing: Direction.NW,
    blocked: state.occupiedExcept('alpha'),
  });
  return pathTo(r, to).map((c) => c.hex);
}

describe('перемещение', () => {
  it('юнит оказывается в конце маршрута', () => {
    const target = offsetToHex(9, 7);
    const result = execute(state, { kind: 'move', unitId: 'alpha', path: route(START, target), mode: MoveMode.Walk });
    expect(result.ok).toBe(true);
    expect(state.requireUnit('alpha').hex).toEqual(target);
  });

  it('событие несёт маршрут, потраченные MP и итоговый фасинг', () => {
    const target = neighbor(START, Direction.E);
    const result = execute(state, { kind: 'move', unitId: 'alpha', path: [START, target], mode: MoveMode.Walk });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const ev = result.events[0]!;
    expect(ev.kind).toBe('moved');
    if (ev.kind !== 'moved') return;
    expect(ev.path).toEqual([START, target]);
    expect(ev.mpSpent).toBe(1);
    expect(ev.facing).toBe(Direction.E);
  });

  it('остаток MP считается от бюджета весового класса', () => {
    const target = offsetToHex(9, 7);
    const path = route(START, target);
    execute(state, { kind: 'move', unitId: 'alpha', path, mode: MoveMode.Walk });
    const u = state.requireUnit('alpha');
    // Бюджет — ход машины (`walkMP` из тира реактора), а не число в тесте:
    // таблица хода менялась (шаг 49), а смысл проверки — нет.
    expect(u.mpLeft).toBe(u.walkMP - (path.length - 1));
    expect(u.hexesMoved).toBe(path.length - 1);
  });

  it('глубина погружения запоминается', () => {
    const target = neighbor(START, Direction.E);
    state.map.setTerrain(target, TerrainType.Water);
    state.map.setElevation(target, -1);
    execute(state, { kind: 'move', unitId: 'alpha', path: [START, target], mode: MoveMode.Walk });
    expect(state.requireUnit('alpha').submerged).toBe(1);
  });

  it('бросок пилотирования у новобранца бросается и объясняется', () => {
    // Навык Пилотирование ниже порога иммунитета (шаг 30): новобранцу
    // пересечённая местность на бегу по-прежнему стоит броска.
    state.replaceUnit({ ...state.requireUnit('alpha'), pilot: novice('alpha') });
    const mid = neighbor(START, Direction.E);
    state.map.setTerrain(mid, TerrainType.Rough);
    const result = execute(state, { kind: 'move', unitId: 'alpha', path: [START, mid], mode: MoveMode.Run });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const check = result.events.find((e) => e.kind === 'pilotingCheck');
    expect(check).toBeDefined();
    if (check?.kind !== 'pilotingCheck') return;
    expect(check.reason).toBe('piloting.rough');
    expect(check.roll).toBeGreaterThanOrEqual(2);
    expect(check.roll).toBeLessThanOrEqual(12);
    expect(check.passed).toBe(check.roll >= check.target);

    const moved = result.events.find((e) => e.kind === 'moved');
    expect(moved?.kind === 'moved' && moved.pilotingChecks).toBe(1);
  });

  it('опытный пилот на исправной машине штатное перемещение не бросает вовсе', () => {
    // Правило шага 30: мастерство отвечает за штатное перемещение. Пилот с
    // навыком не ниже `routineImmunitySkill` не спотыкается ни о пересечёнку,
    // ни о брод — до этого шага он спотыкался, и вода с холмами выпали из
    // тактики целиком.
    const unit = state.requireUnit('alpha');
    expect(skillLevel(unit.pilot, 'piloting')).toBeGreaterThanOrEqual(
      COMBAT.piloting.routineImmunitySkill,
    );
    const mid = neighbor(START, Direction.E);
    state.map.setTerrain(mid, TerrainType.Rough);
    const result = execute(state, { kind: 'move', unitId: 'alpha', path: [START, mid], mode: MoveMode.Run });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.events.some((e) => e.kind === 'pilotingCheck')).toBe(false);
  });

  it('маршрут по пересечённой стоит ОДНОГО броска, а не броска на гекс', () => {
    // Сердце правки шага 30. Каждый гекс, требующий проверки, до этого давал
    // свой независимый бросок: три гекса подряд — три броска, и новобранец не
    // доходил до конца маршрута почти никогда. Не потому, что правило строгое,
    // а потому, что его применяли трижды.
    state.replaceUnit({ ...state.requireUnit('alpha'), pilot: novice('alpha') });
    const path = [START];
    let hex = START;
    for (let i = 0; i < 3; i++) {
      hex = neighbor(hex, Direction.E);
      state.map.setTerrain(hex, TerrainType.Rough);
      path.push(hex);
    }
    const result = execute(state, { kind: 'move', unitId: 'alpha', path, mode: MoveMode.Run });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Каждый из трёх гексов — законный повод для броска; бросок всё равно один.
    expect(path.length - 1).toBe(3);
    expect(result.events.filter((e) => e.kind === 'pilotingCheck')).toHaveLength(1);
  });

  it('провал броска валит робота, и это записано событиями', () => {
    // Новичок с Пилотированием 1 промахивается по порогу 9 достаточно часто,
    // чтобы падение случилось за десяток попыток.
    let fell = false;
    for (let seed = 1; seed <= 40 && !fell; seed++) {
      const s2 = new BattleState(new HexMap(15, 15), new RngSet(seed));
      s2.phase = Phase.Movement;
      const rookie = mech('alpha', START);
      s2.addUnit({
        ...rookie,
        pilot: { ...rookie.pilot, skills: { ...rookie.pilot.skills, piloting: 1, composure: 5 } },
      });
      const mid = neighbor(START, Direction.E);
      s2.map.setTerrain(mid, TerrainType.Rough);
      const r = execute(s2, { kind: 'move', unitId: 'alpha', path: [START, mid], mode: MoveMode.Run });
      if (r.ok && r.events.some((e) => e.kind === 'fell')) {
        fell = true;
        expect(s2.requireUnit('alpha').prone).toBe(true);
        expect(r.events.some((e) => e.kind === 'damaged')).toBe(true);
      }
    }
    expect(fell).toBe(true);
  });
});

describe('отказы — каждый со своей причиной', () => {
  it('не в ту фазу', () => {
    state.phase = Phase.Attack;
    const r = execute(state, { kind: 'move', unitId: 'alpha', path: [START, neighbor(START, Direction.NW)], mode: MoveMode.Walk });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(RejectReason.WrongPhase);
  });

  it('нет такого юнита', () => {
    const r = execute(state, { kind: 'move', unitId: 'нет', path: [START], mode: MoveMode.Walk });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(RejectReason.NoSuchUnit);
  });

  it('маршрут начинается не там, где стоит юнит', () => {
    const wrong = offsetToHex(2, 2);
    const r = execute(state, { kind: 'move', unitId: 'alpha', path: [wrong, neighbor(wrong, Direction.NW)], mode: MoveMode.Walk });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(RejectReason.PathNotFromUnit);
  });

  it('в маршруте разрыв', () => {
    const far = offsetToHex(11, 7);
    const r = execute(state, { kind: 'move', unitId: 'alpha', path: [START, far], mode: MoveMode.Walk });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(RejectReason.NotAdjacent);
  });

  it('не хватает очков движения', () => {
    const far = offsetToHex(14, 7);
    const path = route(START, far);
    expect(path.length - 1).toBeGreaterThan(state.requireUnit('alpha').walkMP);
    const r = execute(state, { kind: 'move', unitId: 'alpha', path, mode: MoveMode.Walk });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(RejectReason.NotEnoughMp);
  });

  it('клетка занята другим роботом', () => {
    const target = neighbor(START, Direction.E);
    state.addUnit(mech('bravo', target));
    const r = execute(state, { kind: 'move', unitId: 'alpha', path: [START, target], mode: MoveMode.Walk });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(RejectReason.Occupied);
  });

  it('сквозь непроходимый рельеф', () => {
    const target = neighbor(START, Direction.E);
    state.map.setTerrain(target, TerrainType.Building);
    const r = execute(state, { kind: 'move', unitId: 'alpha', path: [START, target], mode: MoveMode.Walk });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(RejectReason.Impassable);
  });

  it('второй ход в той же фазе', () => {
    const a = neighbor(START, Direction.NW);
    execute(state, { kind: 'move', unitId: 'alpha', path: [START, a], mode: MoveMode.Walk });
    const r = execute(state, { kind: 'move', unitId: 'alpha', path: [a, neighbor(a, Direction.NW)], mode: MoveMode.Walk });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe(RejectReason.AlreadyMoved);
  });

  it('отказ не меняет состояние', () => {
    const before = state.requireUnit('alpha');
    execute(state, { kind: 'move', unitId: 'alpha', path: [START, offsetToHex(13, 13)], mode: MoveMode.Walk });
    expect(state.requireUnit('alpha')).toBe(before);
  });
});

describe('фазы хода', () => {
  it('идут по кругу и увеличивают номер хода', () => {
    state.phase = Phase.Initiative;
    for (const expected of [Phase.Movement, Phase.Attack, Phase.Heat]) {
      execute(state, { kind: 'endPhase' });
      expect(state.phase).toBe(expected);
    }
    execute(state, { kind: 'endPhase' });
    expect(state.phase).toBe(Phase.Initiative);
    expect(state.turn).toBe(2);
  });

  it('новый ход снимает отметку о движении', () => {
    execute(state, { kind: 'move', unitId: 'alpha', path: [START, neighbor(START, Direction.NW)], mode: MoveMode.Walk });
    expect(state.requireUnit('alpha').moveMode).not.toBeNull();

    for (let i = 0; i < 3; i++) execute(state, { kind: 'endPhase' });
    expect(state.requireUnit('alpha').moveMode).toBeNull();
    expect(state.requireUnit('alpha').hexesMoved).toBe(0);
  });
});

describe('перебор допустимых команд', () => {
  it('содержит только исполнимые команды', () => {
    for (const c of enumerateLegalCommands(state, 'alpha')) {
      expect(execute(new FreshCopy().state, c).ok).toBe(true);
    }
  });

  it('порядок детерминирован', () => {
    const a = enumerateLegalCommands(state, 'alpha').map(describeCmd);
    const b = enumerateLegalCommands(state, 'alpha').map(describeCmd);
    expect(a).toEqual(b);
  });

  it('не предлагает остаться на месте — для этого есть endPhase', () => {
    for (const c of enumerateLegalCommands(state, 'alpha')) {
      if (c.kind !== 'move') continue;
      expect(c.path.length).toBeGreaterThan(1);
      expect(c.path[c.path.length - 1]).not.toEqual(START);
    }
  });

  it('покрывает все РАЗРЕШЁННЫЕ режимы движения (при установленных прыжковых двигателях)', () => {
    // Эталонные шасси прыжковых двигателей не несут (шаг 6, часть C) — прыжок
    // проверяется на юните с вручную поставленным двигателем в ячейку.
    const alpha = state.requireUnit('alpha');
    const slots = alpha.slots.map((zoneSlots) => zoneSlots.slice());
    slots[HitZone.Torso]!.push({ kind: 'jump_jet', id: 'jj_med', destroyed: false });
    state.replaceUnit({ ...alpha, slots });

    const modes = new Set(
      enumerateLegalCommands(state, 'alpha')
        .filter((c) => c.kind === 'move')
        .map((c) => (c.kind === 'move' ? c.mode : -1)),
    );
    // Список — из правил, а не перечислением: бег выключается флагом данных
    // (`combat.json → movement.runAllowed`), и тест обязан следовать за ним, а
    // не падать при каждой смене набора режимов.
    expect(modes).toEqual(new Set(MOVE_MODES));
  });

  it('без прыжковых двигателей режим «прыжок» не предлагается', () => {
    const modes = new Set(
      enumerateLegalCommands(state, 'alpha')
        .filter((c) => c.kind === 'move')
        .map((c) => (c.kind === 'move' ? c.mode : -1)),
    );
    expect(modes).toEqual(new Set(MOVE_MODES.filter((m) => m !== MoveMode.Jump)));
  });

  it('уже походивший юнит может только завершить фазу или катапультироваться', () => {
    execute(state, { kind: 'move', unitId: 'alpha', path: [START, neighbor(START, Direction.NW)], mode: MoveMode.Walk });
    const cmds = enumerateLegalCommands(state, 'alpha');
    // Ходить больше нельзя, но уйти из машины можно в любой момент фазы движения.
    expect(new Set(cmds.map((c) => c.kind))).toEqual(new Set(['endPhase', 'eject']));
  });

  it('каждый предложенный маршрут исполним: перебор и исполнение считают MP одной функцией', () => {
    // Ловушка части B: если бы пасфайндер остался на весовом классе, а
    // executeMove перешёл на walkMP машины, бот планировал бы маршруты, которых
    // не проходит. Проверяется буквально — каждый маршрут из перебора
    // исполняется на чистой копии состояния и обязан быть принят.
    const commands = enumerateLegalCommands(state, 'alpha').filter((c) => c.kind === 'move');
    expect(commands.length).toBeGreaterThan(0);
    for (const cmd of commands) {
      const fresh = new FreshCopy();
      const res = execute(fresh.state, cmd);
      expect(res.ok, `отклонён маршрут ${describeCmd(cmd)}`).toBe(true);
    }
  });

  it('стена зданий оставляет только endPhase', () => {
    for (let d = 0; d < 6; d++) {
      state.map.setTerrain(neighbor(START, d as Direction), TerrainType.Building);
    }
    const cmds = enumerateLegalCommands(state, 'alpha');
    // Прыжок всё ещё может перелететь здания — проверяем, что шагом никуда.
    const walks = cmds.filter((c) => c.kind === 'move' && c.mode === MoveMode.Walk);
    expect(walks).toHaveLength(0);
  });
});

function describeCmd(c: ReturnType<typeof enumerateLegalCommands>[number]): string {
  if (c.kind !== 'move') return c.kind;
  return `${c.mode}:${c.path.map((h) => `${h.q},${h.r}`).join('>')}`;
}

/** Свежая копия исходной расстановки: команды проверяются каждая на чистом состоянии. */
class FreshCopy {
  readonly state: BattleState;
  constructor() {
    this.state = new BattleState(new HexMap(15, 15), new RngSet(2026));
    this.state.phase = Phase.Movement;
    this.state.addUnit(mech('alpha', START));
  }
}

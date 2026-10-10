import { describe, expect, it } from 'vitest';
import { execute, refreshContacts, RejectReason, type BattleEvent } from '../src/core/commands/index.js';
import { Direction, hex } from '../src/core/hex/index.js';
import { HexMap } from '../src/core/map/index.js';
import {
  BattleState,
  HitZone,
  makeUnit,
  Phase,
  zoneState,
  type MechUnit,
} from '../src/core/model/index.js';
import { Rng, RngSet } from '../src/core/rng/index.js';
import { applyDamage, heatLimits, makePilot } from '../src/core/rules/index.js';
import { chooseAttack } from '../src/sim/bot.js';

function pilot(id: string) {
  return { ...makePilot(new Rng(42), { id, tier: 5 }), firstBattle: false };
}

function unit(id: string, side: 'player' | 'opfor', chassisId: string, q: number): MechUnit {
  return makeUnit({
    id,
    side,
    chassis: chassisId,
    pilot: pilot(`p-${id}`),
    hex: hex(q, 0),
    facing: Direction.NW,
  });
}

/** Стрелок и цель в упор: достают все стволы, дальность не мешает замеру. */
function battle(shooter = 'IS-H75-R3F3'): BattleState {
  const state = new BattleState(new HexMap(12, 12), new RngSet(2026));
  state.addUnit(unit('альфа', 'player', shooter, 0));
  state.addUnit(unit('браво', 'opfor', 'IS-H55-R3F2', 2));
  state.phase = Phase.Attack;
  state.turn = 1;
  // Знание — часть состояния (шаг 7): без него сторона не видит цели и
  // выстрел отклоняется поводом NoContact.
  refreshContacts(state);
  return state;
}

describe('Залп: стволы по очереди (шаг 5)', () => {
  it('разные установки стреляют в один ход, одна и та же — нет', () => {
    const state = battle();
    const shot = (mountIndex: number) =>
      execute(state, { kind: 'attack', unitId: 'альфа', targetId: 'браво', mountIndex });

    expect(shot(0).ok).toBe(true);
    expect(shot(1).ok).toBe(true);
    expect(shot(2).ok).toBe(true);
    expect(shot(0)).toEqual({ ok: false, reason: RejectReason.AlreadyFired });
  });

  it('тепло копится за каждый выстрел, и следующий стреляет уже с ним', () => {
    const state = battle();
    const heats: number[] = [];
    for (let i = 0; i < 3; i++) {
      execute(state, { kind: 'attack', unitId: 'альфа', targetId: 'браво', mountIndex: i });
      heats.push(state.requireUnit('альфа').heat);
    }
    expect(heats[0]).toBeGreaterThan(0);
    expect(heats[1]).toBeGreaterThan(heats[0]!);
    expect(heats[2]).toBeGreaterThan(heats[1]!);
  });

  it('фаза тепла снимает отметки, и на следующем ходу стволы стреляют снова', () => {
    const state = battle();
    execute(state, { kind: 'attack', unitId: 'альфа', targetId: 'браво', mountIndex: 0 });
    expect(state.requireUnit('альфа').mounts[0]?.firedThisTurn).toBe(true);

    state.phase = Phase.Heat;
    execute(state, { kind: 'endPhase' });
    expect(state.requireUnit('альфа').mounts[0]?.firedThisTurn).toBe(false);
  });

  it('раскалённый бот берёт меньше стволов, чем холодный', () => {
    // Решение, а не журнал: одна и та же позиция, разный нагрев.
    const count = (heat: number): number => {
      const state = battle();
      state.replaceUnit({ ...state.requireUnit('альфа'), heat });
      let fired = 0;
      for (let i = 0; i < 4; i++) {
        const action = chooseAttack(state, 'альфа', new Rng(1), {});
        if (action.kind === 'endPhase') break;
        if (!execute(state, action).ok) break;
        fired += 1;
      }
      return fired;
    };

    // «Раскалённый» — от предела самого стрелка (отвод + запас корпуса), а не
    // общим числом: у тяжёлой машины предел 30, и тепло 12 ещё вмещает два
    // шестиградусных ствола. За восемь до предела помещается только один.
    const hot = heatLimits(battle().requireUnit('альфа')).limit - 8;
    expect(count(hot)).toBeLessThan(count(0));
  });
});

describe('Подъём после падения (шаг 5)', () => {
  function proneState(over: Partial<MechUnit> = {}): BattleState {
    const state = battle('IS-H55-R3F2');
    const u = state.requireUnit('альфа');
    state.replaceUnit({ ...u, prone: true, fellThisTurn: false, ...over });
    state.phase = Phase.Heat;
    return state;
  }

  const stood = (events: readonly BattleEvent[], id: string): boolean =>
    events.some((e) => e.kind === 'stoodUp' && e.unitId === id);

  it('упавший встаёт сам в конце следующего хода', () => {
    const state = proneState();
    const res = execute(state, { kind: 'endPhase' });
    expect(res.ok).toBe(true);
    expect(res.ok && stood(res.events, 'альфа')).toBe(true);
    expect(state.requireUnit('альфа').prone).toBe(false);
  });

  it('упавший в этом же ходу тратит на подъём следующий, а не встаёт сразу', () => {
    const state = proneState({ fellThisTurn: true });
    const first = execute(state, { kind: 'endPhase' });
    expect(first.ok && stood(first.events, 'альфа')).toBe(false);
    expect(state.requireUnit('альфа').prone).toBe(true);

    state.phase = Phase.Heat;
    const second = execute(state, { kind: 'endPhase' });
    expect(second.ok && stood(second.events, 'альфа')).toBe(true);
    expect(state.requireUnit('альфа').prone).toBe(false);
  });

  it('со вторым критом гироскопа машина не воюет и не встаёт никогда (шаг 6, часть E)', () => {
    // Второй крит гироскопа теперь ставит destroyed так же, как оторванная
    // нога — gyroHits:2 без destroyed:true в реальном бою не бывает
    // (resolveCriticalSlot ставит их вместе).
    const state = proneState({ gyroHits: 2, destroyed: true });
    for (let turn = 0; turn < 3; turn++) {
      state.phase = Phase.Heat;
      const res = execute(state, { kind: 'endPhase' });
      expect(res.ok && stood(res.events, 'альфа')).toBe(false);
    }
    expect(state.requireUnit('альфа').prone).toBe(true);
    expect(state.requireUnit('альфа').destroyed).toBe(true);
  });

  it('без ноги робот не воюет и считается уничтоженным (шаг 6, часть A)', () => {
    const state = battle('IS-H55-R3F2');
    const u = state.requireUnit('альфа');
    const zones = u.zones.map((z, i) =>
      i === HitZone.LeftLeg ? { ...z, armor: 0, structure: 0, destroyed: true } : z,
    );
    state.replaceUnit({ ...u, prone: true, fellThisTurn: false, destroyed: true, zones });

    state.phase = Phase.Heat;
    const res = execute(state, { kind: 'endPhase' });
    expect(res.ok && stood(res.events, 'альфа')).toBe(false);
    expect(state.requireUnit('альфа').destroyed).toBe(true);

    // Уничтоженная машина стрелять не может — ни торсовым оружием, ничем.
    state.phase = Phase.Attack;
    const torso = state.requireUnit('альфа').mounts.findIndex((m) => m.zone === HitZone.Torso);
    expect(torso).toBeGreaterThanOrEqual(0);
    const attack = execute(state, { kind: 'attack', unitId: 'альфа', targetId: 'браво', mountIndex: torso });
    expect(attack.ok).toBe(false);
    expect(!attack.ok && attack.reason).toBe(RejectReason.UnitDestroyed);
  });

  it('потеря ноги в бою уничтожает машину сразу, без второй ноги', () => {
    const state = battle('IS-H55-R3F2');
    const u = state.requireUnit('альфа');
    const z = zoneState(u, HitZone.LeftLeg);
    const outcome = applyDamage(u, HitZone.LeftLeg, z.armor + z.structure);
    expect(outcome.mechDestroyed).toBe(true);
    expect(outcome.unit.prone).toBe(true);
    expect(zoneState(outcome.unit, HitZone.RightLeg).destroyed).toBe(false);
  });

  it('лежачий (жив, ещё не встал) стрелять не может — лёжа никто не стреляет (шаг 6, часть E)', () => {
    const state = proneState();
    state.phase = Phase.Attack;
    const alpha = state.requireUnit('альфа');
    const torso = alpha.mounts.findIndex((m) => m.zone === HitZone.Torso);
    expect(torso).toBeGreaterThanOrEqual(0);
    const attack = execute(state, { kind: 'attack', unitId: 'альфа', targetId: 'браво', mountIndex: torso });
    expect(attack.ok).toBe(false);
    expect(!attack.ok && attack.reason).toBe(RejectReason.Prone);
  });

  it('обесточенный не поднимается, пока не перезапустится', () => {
    const state = proneState({ shutdown: true });
    const res = execute(state, { kind: 'endPhase' });
    expect(res.ok && stood(res.events, 'альфа')).toBe(false);
    expect(state.requireUnit('альфа').prone).toBe(true);
  });
});

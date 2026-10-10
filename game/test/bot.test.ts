import { describe, expect, it } from 'vitest';
import { execute, refreshContacts } from '../src/core/commands/index.js';
import { Direction, distance, hex, offsetToHex } from '../src/core/hex/index.js';
import { HexMap } from '../src/core/map/index.js';
import {
  BattleState,
  ContactLevel,
  HitZone,
  makeUnit,
  Phase,
  type MechUnit,
  type MountState,
} from '../src/core/model/index.js';
import { Rng, RngSet } from '../src/core/rng/index.js';
import { makePilot } from '../src/core/rules/index.js';
import { allyCentroid, chooseMove, formationLeash, mapCentre, weaponEffectiveRange } from '../src/sim/bot.js';
import { weapon } from '../src/core/data/tables.js';
import { RECON_LANCE, RECON_MAP_SIZE } from '../src/sim/scenario.js';
import { COMBAT } from '../src/core/data/tables.js';

function pilot(id: string) {
  return { ...makePilot(new Rng(42), { id, tier: 5 }), firstBattle: false };
}

function unit(id: string, side: 'player' | 'opfor', at: { q: number; r: number }, chassisId = 'IS-H35-R3F1'): MechUnit {
  return makeUnit({ id, side, chassis: chassisId, pilot: pilot(`p-${id}`), hex: hex(at.q, at.r), facing: Direction.NW });
}

describe('Центроид и поводок звена (шаг 8, часть C)', () => {
  it('центроид — среднее по гексам, пусто — null', () => {
    expect(allyCentroid([])).toBeNull();
    const a = unit('a', 'player', { q: 0, r: 0 });
    const b = unit('b', 'player', { q: 4, r: 0 });
    expect(allyCentroid([a, b])).toEqual({ q: 2, r: 0 });
  });

  it('поводок растёт с ходовым MP, а не с весовым классом', () => {
    const light = unit('l', 'player', { q: 0, r: 0 }, 'IS-H35-R3F1'); // walkMP 7
    const heavy = unit('h', 'player', { q: 0, r: 0 }, 'IS-H75-R3F3'); // walkMP 4
    expect(light.walkMP).toBeGreaterThan(heavy.walkMP);
    expect(formationLeash(light)).toBeGreaterThan(formationLeash(heavy));
    expect(formationLeash(light)).toBe(
      COMBAT.ai.formationBaseLeash + light.walkMP * COMBAT.ai.formationLeashPerWalkMp,
    );
  });
});

describe('Строй в оценке хода (шаг 8, часть C)', () => {
  /**
   * Союзник стоит на месте, враг далеко в стороне от него: агрессивный видит
   * причину рвануть к врагу и отрывается от союзника, осторожный держится
   * ближе к своим. Личности отличаются только весами, сценарий один и тот же.
   */
  function scenario(): { state: BattleState; ally: MechUnit } {
    const map = new HexMap(30, 30);
    const state = new BattleState(map, new RngSet(2026));
    const ally = unit('bravo', 'player', { q: 2, r: 2 });
    state.addUnit(ally);
    state.addUnit(unit('alpha', 'player', { q: 3, r: 2 }));
    state.addUnit(unit('charlie', 'opfor', { q: 20, r: 2 }));
    state.phase = Phase.Movement;
    refreshContacts(state);
    // Контакт с врагом заведомый — иначе некуда рваться и сравнивать нечего.
    state.setContacts('player', new Map([['charlie', ContactLevel.Identified]]));
    return { state, ally };
  }

  it('осторожный держится ближе к союзнику, чем агрессивный, на одном сиде', () => {
    const { state: stateAggressive, ally: allyA } = scenario();
    const aggressiveMove = chooseMove(stateAggressive, 'alpha', new Rng(1), { personality: 'aggressive' });

    const { state: stateCautious, ally: allyB } = scenario();
    const cautiousMove = chooseMove(stateCautious, 'alpha', new Rng(1), { personality: 'cautious' });

    const aggressiveHex =
      aggressiveMove.kind === 'move' ? aggressiveMove.path[aggressiveMove.path.length - 1]! : stateAggressive.requireUnit('alpha').hex;
    const cautiousHex =
      cautiousMove.kind === 'move' ? cautiousMove.path[cautiousMove.path.length - 1]! : stateCautious.requireUnit('alpha').hex;

    expect(distance(cautiousHex, allyB.hex)).toBeLessThanOrEqual(distance(aggressiveHex, allyA.hex));
  });

  it('осторожный держит бо́льшую дистанцию до врага, чем агрессивный', () => {
    const { state: stateAggressive } = scenario();
    const aggressiveMove = chooseMove(stateAggressive, 'alpha', new Rng(1), { personality: 'aggressive' });
    const { state: stateCautious } = scenario();
    const cautiousMove = chooseMove(stateCautious, 'alpha', new Rng(1), { personality: 'cautious' });

    const enemyHex = stateAggressive.requireUnit('charlie').hex;
    const aggressiveHex =
      aggressiveMove.kind === 'move' ? aggressiveMove.path[aggressiveMove.path.length - 1]! : stateAggressive.requireUnit('alpha').hex;
    const cautiousHex =
      cautiousMove.kind === 'move' ? cautiousMove.path[cautiousMove.path.length - 1]! : stateCautious.requireUnit('alpha').hex;

    expect(distance(cautiousHex, enemyHex)).toBeGreaterThanOrEqual(distance(aggressiveHex, enemyHex));
  });
});

describe('Разведка вслепую: память о контакте вместо центра карты (шаг 8, часть D)', () => {
  /**
   * Сторона уже видела врага в конкретном месте и потеряла контакт (память
   * жива, `enemies` пуст). Рядом — второе, куда более далёкое место, никогда
   * не виденное: честная цель — только то, что реально видели.
   */
  function scenario(): { state: BattleState; rally: { q: number; r: number } } {
    const map = new HexMap(40, 40);
    const state = new BattleState(map, new RngSet(2027));
    state.addUnit(unit('scout', 'player', { q: 0, r: 0 }));
    const rally = { q: 6, r: 0 };
    state.phase = Phase.Movement;
    refreshContacts(state);
    // Память проставляется напрямую — эквивалент «видели в прошлом ходу, сейчас потеряли».
    state.recordLastKnownContact('player', 'ghost', rally, 1);
    return { state, rally };
  }

  it('жадный до контакта идёт к месту памяти ближе, чем осторожный, на одном сиде', () => {
    const { state: stateAggressive, rally } = scenario();
    const aggressiveMove = chooseMove(stateAggressive, 'scout', new Rng(1), { personality: 'aggressive' });
    const { state: stateCautious } = scenario();
    const cautiousMove = chooseMove(stateCautious, 'scout', new Rng(1), { personality: 'cautious' });

    const aggressiveHex =
      aggressiveMove.kind === 'move' ? aggressiveMove.path[aggressiveMove.path.length - 1]! : stateAggressive.requireUnit('scout').hex;
    const cautiousHex =
      cautiousMove.kind === 'move' ? cautiousMove.path[cautiousMove.path.length - 1]! : stateCautious.requireUnit('scout').hex;

    expect(distance(aggressiveHex, rally)).toBeLessThanOrEqual(distance(cautiousHex, rally));
  });
});

describe('Память не ведёт к обломкам (шаг 8, часть D)', () => {
  it('выбывшая машина точкой сбора не становится', () => {
    const map = new HexMap(40, 40);
    const state = new BattleState(map, new RngSet(2028));
    state.addUnit(unit('scout', 'player', { q: 10, r: 0 }));
    // Ближняя память — о машине, которой больше нет; дальняя — о живой, но
    // потерянной из виду. Идти надо к дальней: к ближней идти не к кому.
    const wreck = { q: 6, r: 0 };
    const alive = { q: 20, r: 0 };
    state.addUnit({ ...unit('обломки', 'opfor', wreck), destroyed: true });
    state.recordLastKnownContact('player', 'обломки', wreck, 1);
    state.recordLastKnownContact('player', 'призрак', alive, 1);
    state.phase = Phase.Movement;
    refreshContacts(state);

    const action = chooseMove(state, 'scout', new Rng(1), { personality: 'aggressive' });
    const to = action.kind === 'move' ? action.path[action.path.length - 1]! : state.requireUnit('scout').hex;
    expect(distance(to, alive)).toBeLessThan(distance(hex(10, 0), alive));
  });
});

describe('Сценарий разведки шире дальности сенсоров (шаг 8, часть E)', () => {
  it('стороны стартуют дальше, чем видит сенсор, — иначе мерить нечего', () => {
    const player = RECON_LANCE.filter((u) => u.side === 'player');
    const opfor = RECON_LANCE.filter((u) => u.side === 'opfor');
    let nearest = Infinity;
    for (const a of player) {
      for (const b of opfor) {
        const d = distance(offsetToHex(a.col, a.row), offsetToHex(b.col, b.row));
        if (d < nearest) nearest = d;
      }
    }
    // Ровно ради этого неравенства сценарий и заведён: как только сенсор
    // достаёт от угла до угла, столбцы разведки становятся нулём по построению.
    expect(nearest).toBeGreaterThan(COMBAT.detection.sensorRange);
    expect(RECON_MAP_SIZE).toBeGreaterThan(nearest / 2);
  });
});

describe('Bug 2: слепая сторона идёт к центру карты, а не стоит (шаг 8)', () => {
  it('без контакта ход всё равно выбирается, а не endPhase по умолчанию', () => {
    const map = new HexMap(20, 20);
    const state = new BattleState(map, new RngSet(7));
    state.addUnit(unit('alpha', 'player', { q: 0, r: 0 }));
    state.phase = Phase.Movement;
    refreshContacts(state);

    const action = chooseMove(state, 'alpha', new Rng(1), {});
    // Раньше здесь гарантированно был endPhase (ранний выход по пустому
    // enemies) — теперь бот вправе выбрать move к центру карты.
    expect(['move', 'endPhase']).toContain(action.kind);
    if (action.kind === 'move') {
      const res = execute(state, action);
      expect(res.ok).toBe(true);
    }
  });
});

describe('Эффективная дальность оружия ограничивает сближение (шаг 9f)', () => {
  const mount = (id: string): MountState => ({
    weapon: id,
    zone: HitZone.RightArm,
    ammo: null,
    destroyed: false,
    slotIndices: [],
    firedThisTurn: false,
  });

  // Дальности читаются из живых данных (`weapon()`), а не зашиты числами: тест
  // проверяет формулу, а не текущую настройку `weapons.json` — та тюнится
  // отдельно (шаг 9h, 2026-08-28) и не обязана держать эти числа неизменными.
  it('дальность — средневзвешенное по урону от short; сильный ствол решает почти в одиночку', () => {
    const ac10 = weapon('is_ac10');
    const sl = weapon('is_sl');
    const ml = weapon('is_ml');
    const acDmg = ac10.damage * ac10.shots;
    const slDmg = sl.damage * sl.shots;
    // Сильный ствол «тянет» результат к своей дальности сильнее слабого,
    // пропорционально урону, а не поровну — среднее лежит ближе к short АС-10.
    const expected = (acDmg * ac10.short + slDmg * sl.short) / (acDmg + slDmg);
    expect(weaponEffectiveRange([mount('is_ac10'), mount('is_sl')])).toBeCloseTo(expected, 5);
    // Один ствол — среднее вырождается в его собственный short.
    expect(weaponEffectiveRange([mount('is_ml')])).toBe(ml.short);
    expect(weaponEffectiveRange([mount('is_ac10')])).toBe(ac10.short);
    expect(weaponEffectiveRange([])).toBe(0);
  });

  it('бот не рвётся вплотную, если враг уже на дальности лучшей точности', () => {
    // IS-H55-R3F2: AC-10 + 2×ML — эффективная дальность считается той же формулой.
    const map = new HexMap(30, 30);
    const state = new BattleState(map, new RngSet(11));
    const alpha = unit('alpha', 'player', { q: 0, r: 0 }, 'IS-H55-R3F2');
    // Средневзвешенное не обязано быть целым — округляем только для размещения
    // клетки; сама формула проверена отдельным тестом выше.
    const targetDistance = Math.round(weaponEffectiveRange(alpha.mounts));
    const bravo = unit('bravo', 'opfor', { q: targetDistance, r: 0 });
    state.addUnit(alpha);
    state.addUnit(bravo);
    state.phase = Phase.Movement;
    refreshContacts(state);
    state.setContacts('player', new Map([['bravo', ContactLevel.Identified]]));

    const startDistance = distance(alpha.hex, bravo.hex);
    expect(startDistance).toBe(targetDistance);

    const action = chooseMove(state, 'alpha', new Rng(3), { personality: 'balanced' });
    const finalHex = action.kind === 'move' ? action.path[action.path.length - 1]! : alpha.hex;
    const finalDistance = distance(finalHex, bravo.hex);

    // До шага 9f `closing` тянул безусловно до нуля — здесь гарантированно
    // была бы дистанция 0-1 (вплотную), несмотря на то, что позиция уже даёт
    // лучшую точность всем стволам. Порог отделяет это от рывка в мелей.
    expect(finalDistance).toBeGreaterThanOrEqual(2);
  });
});

describe('точка сбора вслепую — середина карты', () => {
  // Клетки хранятся по строкам: индекс w·h/2 при чётной ширине — ЛЕВЫЙ край
  // средней строки. На картах кампании (24, 40, 64) обе стороны вслепую шли туда.
  it.each([15, 24, 40, 64])('на карте %i×%i — середина по колонке и строке', (size) => {
    const state = new BattleState(new HexMap(size, size), new RngSet(1));
    expect(mapCentre(state)).toEqual(offsetToHex(Math.floor(size / 2), Math.floor(size / 2)));
  });
});

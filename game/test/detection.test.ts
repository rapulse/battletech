import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Direction, hex, neighbor, type Hex } from '../src/core/hex/index.js';
import {
  EDGE_WALL,
  HexMap,
  MoveMode,
  OVERLAY_SMOKE,
  TerrainType,
  computeLos,
  invalidateLos,
} from '../src/core/map/index.js';
import {
  BattleState,
  ContactLevel,
  hashBattleState,
  makeUnit,
  Phase,
  type MechUnit,
} from '../src/core/model/index.js';
import { computeContacts, makePilot, toHitBreakdown } from '../src/core/rules/index.js';
import { execute, refreshContacts, RejectReason } from '../src/core/commands/index.js';
import { Rng, RngSet } from '../src/core/rng/index.js';
import { COMBAT } from '../src/core/data/tables.js';

function pilot(id: string) {
  return makePilot(new Rng(7), { id, tier: 5 });
}

function unit(id: string, side: 'player' | 'opfor', at: Hex, chassis = 'IS-H55-R3F2'): MechUnit {
  return makeUnit({ id, side, chassis, pilot: pilot(`p-${id}`), hex: at, facing: Direction.NW });
}

/** Плоская пустая карта: всё, что мешает, ставится тестом явно. */
function flatMap(w = 24, h = 24): HexMap {
  return new HexMap(w, h);
}

describe('Карта работает на видимость (шаг 7)', () => {
  const A = hex(0, 0);

  it('лес В КЛЕТКЕ ЦЕЛИ поднимает целевое число, но линию не перекрывает', () => {
    const map = flatMap();
    const target = hex(0, 4);

    const clear = computeLos(map, A, target);
    expect(clear.targetCover).toBe(0);

    map.setTerrain(target, TerrainType.HeavyWoods);
    const inWoods = computeLos(map, A, target);
    expect(inWoods.blocked).toBe(false);
    expect(inWoods.targetCover).toBe(2);
    // Укрытие по пути и укрытие самой цели считаются раздельно.
    expect(inWoods.coverMod).toBe(0);
  });

  it('дым по пути укрывает так же, как густой лес, и с двух клеток закрывает линию', () => {
    const map = flatMap();
    const target = hex(0, 6);

    map.setOverlay(hex(0, 2), OVERLAY_SMOKE);
    const one = computeLos(map, A, target);
    expect(one.blocked).toBe(false);
    expect(one.coverMod).toBe(COMBAT.toHit.rangeShort + 2);

    map.setOverlay(hex(0, 4), OVERLAY_SMOKE);
    expect(computeLos(map, A, target).blocked).toBe(true);
  });

  it('дым В КЛЕТКЕ ЦЕЛИ мешает наводке, но не прячет от выстрела', () => {
    const map = flatMap();
    const target = hex(0, 4);
    map.setOverlay(target, OVERLAY_SMOKE);
    const sight = computeLos(map, A, target);
    expect(sight.blocked).toBe(false);
    expect(sight.targetCover).toBe(2);
  });

  it('стена между клетками перекрывает линию и делает это симметрично', () => {
    const map = flatMap();
    const mid = hex(0, 2);
    const target = hex(0, 4);
    expect(computeLos(map, A, target).blocked).toBe(false);

    // Ребро между mid и следующей клеткой по линии.
    map.addEdge(mid, Direction.SE, EDGE_WALL);
    expect(computeLos(map, A, target).blocked).toBe(true);
    expect(computeLos(map, target, A).blocked).toBe(true);
  });

  it('стена не мешает линии, которая идёт выше неё', () => {
    const map = flatMap();
    const mid = hex(0, 2);
    const target = hex(0, 4);
    map.addEdge(mid, Direction.SE, EDGE_WALL);

    // Стрелок на горе: линия идёт над стеной высотой 2. Поднимается только его
    // клетка — подними промежуточные, и линию перекроет уже сама скала.
    map.setElevation(A, 5);
    expect(computeLos(map, A, target).blocked).toBe(false);
  });
});

describe('Три уровня контакта (шаг 7)', () => {
  let map: HexMap;

  beforeEach(() => {
    map = flatMap(30, 30);
  });

  const level = (viewer: MechUnit, target: MechUnit): ContactLevel =>
    computeContacts(map, [viewer, target], viewer.side).get(target.id) ?? ContactLevel.None;

  it('за пределом сенсоров цели нет вовсе', () => {
    const far = COMBAT.detection.sensorRange + 3;
    const a = unit('a', 'player', hex(0, 0));
    const b = unit('b', 'opfor', hex(0, far));
    expect(level(a, b)).toBe(ContactLevel.None);
  });

  it('в радиусе сенсоров без линии видимости — только засветка', () => {
    const a = unit('a', 'player', hex(0, 0));
    const b = unit('b', 'opfor', hex(0, 8));
    // Здание между ними перекрывает линию жёстко, сенсорам оно не мешает.
    map.setTerrain(hex(0, 4), TerrainType.Building);
    expect(level(a, b)).toBe(ContactLevel.Blip);
  });

  it('линия видимости даёт силуэт, сближение — опознание', () => {
    const a = unit('a', 'player', hex(0, 0));
    const far = unit('b', 'opfor', hex(0, COMBAT.detection.identifyRange + 2));
    expect(level(a, far)).toBe(ContactLevel.Silhouette);

    const near = unit('b', 'opfor', hex(0, COMBAT.detection.identifyRange));
    expect(level(a, near)).toBe(ContactLevel.Identified);
  });

  it('лес укорачивает опознание: та же дистанция, другой рельеф — другой уровень', () => {
    const at = hex(0, COMBAT.detection.identifyRange);
    const a = unit('a', 'player', hex(0, 0));
    const b = unit('b', 'opfor', at);
    expect(level(a, b)).toBe(ContactLevel.Identified);

    map.setTerrain(at, TerrainType.HeavyWoods);
    invalidateLos(map); // рельеф сменился — кэш видимости обязан быть сброшен
    expect(level(a, b)).toBe(ContactLevel.Silhouette);
  });

  it('дважды открывший огонь опознан навсегда — хоть за холмом, хоть в лесу', () => {
    const a = unit('a', 'player', hex(0, 0));
    const loud = {
      ...unit('b', 'opfor', hex(0, 8)),
      shotsSeen: COMBAT.detection.identifyAfterShots,
    };
    map.setTerrain(hex(0, 4), TerrainType.Building);
    expect(level(a, loud)).toBe(ContactLevel.Identified);
  });
});

describe('Стрельба по неопознанному (шаг 7)', () => {
  function battle(distanceApart: number, terrain?: TerrainType): BattleState {
    const state = new BattleState(flatMap(30, 30), new RngSet(2026));
    if (terrain !== undefined) state.map.setTerrain(hex(0, distanceApart), terrain);
    state.addUnit(unit('альфа', 'player', hex(0, 0)));
    state.addUnit(unit('браво', 'opfor', hex(0, distanceApart)));
    state.phase = Phase.Attack;
    refreshContacts(state);
    return state;
  }

  it('по опознанной цели штрафа за незнание нет', () => {
    const state = battle(3);
    const a = state.requireUnit('альфа');
    const b = state.requireUnit('браво');
    const bd = toHitBreakdown(state.map, a, b, 'is_ml', a.mounts[0]!.zone, state.contact('player', 'браво'));
    expect(bd.factors.some((f) => f.key === 'toHit.blip' || f.key === 'toHit.silhouette')).toBe(false);
  });

  it('по силуэту стрелять можно, но дороже; по засветке — ещё дороже', () => {
    const silhouette = battle(COMBAT.detection.identifyRange + 2);
    const a = silhouette.requireUnit('альфа');
    const b = silhouette.requireUnit('браво');
    expect(silhouette.contact('player', 'браво')).toBe(ContactLevel.Silhouette);
    // is_ppc, не is_ac10 (шаг 66a): дальность вернулась к канону, и на этой
    // дистанции АП/10 перешла в дальнюю ступень — штраф засветки/силуэта
    // упирался в потолок обстановки у обоих контактов разом и делал их
    // равными. ППК на той же дистанции всё ещё в средней ступени.
    const sil = toHitBreakdown(silhouette.map, a, b, 'is_ppc', a.mounts[0]!.zone, ContactLevel.Silhouette);
    const blip = toHitBreakdown(silhouette.map, a, b, 'is_ppc', a.mounts[0]!.zone, ContactLevel.Blip);
    const known = toHitBreakdown(silhouette.map, a, b, 'is_ppc', a.mounts[0]!.zone, ContactLevel.Identified);

    expect(sil.impossible).toBe(false);
    expect(blip.impossible).toBe(false);
    expect(known.target).toBeLessThan(sil.target);
    expect(sil.target).toBeLessThan(blip.target);
  });

  it('по цели без контакта стрелять нельзя вовсе', () => {
    const state = battle(3);
    const b = state.requireUnit('браво');
    // Сторона забыла о цели: таблица контактов пуста.
    state.setContacts('player', new Map());
    const res = execute(state, { kind: 'attack', unitId: 'альфа', targetId: b.id, mountIndex: 0 });
    expect(res.ok).toBe(false);
    expect(!res.ok && res.reason).toBe(RejectReason.NoContact);
  });
});

describe('Знание меняется по правилам, а не по запросу (шаг 7)', () => {
  it('внутри хода контакт только пополняется, между ходами — пересчитывается заново', () => {
    const state = new BattleState(flatMap(30, 30), new RngSet(3));
    state.map.setTerrain(hex(0, 4), TerrainType.Building);
    state.addUnit(unit('альфа', 'player', hex(0, 0)));
    state.addUnit(unit('браво', 'opfor', hex(0, 8)));
    refreshContacts(state);
    expect(state.contact('player', 'браво')).toBe(ContactLevel.Blip);

    // Здание убрали — на слиянии знание растёт.
    state.map.setTerrain(hex(0, 4), TerrainType.Plain);
    invalidateLos(state.map);
    refreshContacts(state, true);
    const seen = state.contact('player', 'браво');
    expect(seen).toBeGreaterThan(ContactLevel.Blip);

    // Здание вернули: слияние не имеет права опустить уровень внутри хода...
    state.map.setTerrain(hex(0, 4), TerrainType.Building);
    invalidateLos(state.map);
    refreshContacts(state, true);
    expect(state.contact('player', 'браво')).toBe(seen);

    // ...а пересчёт в начале следующего хода — обязан, но не ниже силуэта:
    // однажды разглядев класс машины, сторона его не «забывает» (решение
    // пользователя 2026-09-19, `detection.contactFloorAtSilhouette`).
    refreshContacts(state);
    expect(state.contact('player', 'браво')).toBe(ContactLevel.Silhouette);
  });

  describe('contactFloorAtSilhouette: false (было до 2026-09-19) — пол выключен', () => {
    beforeEach(() => {
      COMBAT.detection.contactFloorAtSilhouette = false;
    });
    afterEach(() => {
      COMBAT.detection.contactFloorAtSilhouette = true;
    });

    it('пересчёт в начале хода опускает контакт до Blip, как раньше', () => {
      const state = new BattleState(flatMap(30, 30), new RngSet(3));
      state.map.setTerrain(hex(0, 4), TerrainType.Building);
      state.addUnit(unit('альфа', 'player', hex(0, 0)));
      state.addUnit(unit('браво', 'opfor', hex(0, 8)));
      refreshContacts(state);

      state.map.setTerrain(hex(0, 4), TerrainType.Plain);
      invalidateLos(state.map);
      refreshContacts(state, true);
      expect(state.contact('player', 'браво')).toBeGreaterThan(ContactLevel.Blip);

      state.map.setTerrain(hex(0, 4), TerrainType.Building);
      invalidateLos(state.map);
      refreshContacts(state);
      expect(state.contact('player', 'браво')).toBe(ContactLevel.Blip);
    });
  });

  it('перебор ходов не предлагает выстрел по цели, о которой сторона не знает', () => {
    const state = new BattleState(flatMap(30, 30), new RngSet(4));
    state.addUnit(unit('альфа', 'player', hex(0, 0)));
    state.addUnit(unit('браво', 'opfor', hex(0, 3)));
    state.phase = Phase.Attack;

    refreshContacts(state);
    const withContact = execute(state, {
      kind: 'attack', unitId: 'альфа', targetId: 'браво', mountIndex: 0,
    });
    expect(withContact.ok).toBe(true);

    state.setContacts('player', new Map());
    const blind = execute(state, {
      kind: 'attack', unitId: 'альфа', targetId: 'браво', mountIndex: 1,
    });
    expect(blind.ok).toBe(false);
  });
});

describe('Электроника получает цену (шаг 7)', () => {
  function withEquipment(u: MechUnit, id: string, destroyed = false): MechUnit {
    const slots = u.slots.map((zoneSlots) => zoneSlots.slice());
    slots[1]!.push({ kind: 'equipment', id, destroyed });
    return { ...u, slots };
  }

  const level = (map: HexMap, viewer: MechUnit, target: MechUnit): ContactLevel =>
    computeContacts(map, [viewer, target], viewer.side).get(target.id) ?? ContactLevel.None;

  it('ЭПП мешает опознанию: опознан → силуэт, разбитый — не мешает', () => {
    const map = flatMap(30, 30);
    const a = unit('a', 'player', hex(0, 0));
    const at = hex(0, COMBAT.detection.identifyRange);

    expect(level(map, a, unit('b', 'opfor', at))).toBe(ContactLevel.Identified);
    expect(level(map, a, withEquipment(unit('b', 'opfor', at), 'is_ecm'))).toBe(
      ContactLevel.Silhouette,
    );
    expect(level(map, a, withEquipment(unit('b', 'opfor', at), 'is_ecm', true))).toBe(
      ContactLevel.Identified,
    );
  });

  it('ЭПП не опускает силуэт до засветки: видно всегда, не разобрать — да', () => {
    const map = flatMap(30, 30);
    const a = unit('a', 'player', hex(0, 0));
    // Дальше дистанции опознания: без ЭПП это силуэт, и с ЭПП тоже силуэт.
    const at = hex(0, COMBAT.detection.identifyRange + 2);
    expect(level(map, a, unit('b', 'opfor', at))).toBe(ContactLevel.Silhouette);
    expect(level(map, a, withEquipment(unit('b', 'opfor', at), 'is_ecm'))).toBe(
      ContactLevel.Silhouette,
    );
  });

  it('ЭПП не превращает засветку в пустоту: за холмом машина всё равно на сенсорах', () => {
    const map = flatMap(30, 30);
    map.setTerrain(hex(0, 4), TerrainType.Building);
    const a = unit('a', 'player', hex(0, 0));
    const at = hex(0, 8);
    expect(level(map, a, unit('b', 'opfor', at))).toBe(ContactLevel.Blip);
    expect(level(map, a, withEquipment(unit('b', 'opfor', at), 'is_ecm'))).toBe(ContactLevel.Blip);
  });

  it('пробник поднимает контакт на ступень в своём радиусе', () => {
    const map = flatMap(30, 30);
    const at = hex(0, 3);
    map.setTerrain(hex(0, 2), TerrainType.Building);

    const plain = unit('a', 'player', hex(0, 0));
    const b = unit('b', 'opfor', at);
    expect(level(map, plain, b)).toBe(ContactLevel.Blip);

    const probing = withEquipment(unit('a', 'player', hex(0, 0)), 'is_bap');
    expect(level(map, probing, b)).toBe(ContactLevel.Silhouette);
  });

  it('пробник в своём радиусе пробивает ЭПП: контакт не срезается до силуэта (A1, шаг 8)', () => {
    const map = flatMap(30, 30);
    // Лес в клетке цели укорачивает опознание, но не блокирует линию: без
    // пробника это силуэт что с ЭПП, что без него.
    const at = hex(0, 3);
    map.setTerrain(at, TerrainType.HeavyWoods);
    const target = withEquipment(unit('b', 'opfor', at), 'is_ecm');

    const plain = unit('a', 'player', hex(0, 0));
    expect(level(map, plain, target)).toBe(ContactLevel.Silhouette);

    // Пробник в радиусе поднимает контакт до опознания, и ЭПП его больше не
    // срезает: контакт, добытый пробником, — не то, что прячут помехами.
    const probing = withEquipment(unit('a', 'player', hex(0, 0)), 'is_bap');
    expect(level(map, probing, target)).toBe(ContactLevel.Identified);
  });

  it('импульсный лазер попадает легче обычного на той же позиции', () => {
    // Точность — свойство самого оружия (`weapons.json` → toHitMod), а не
    // прибора: прицельный компьютер снят (decisions.md, 2026-08-26), и
    // единственная прибавка к наводке в игре теперь эта.
    const map = flatMap(30, 30);
    const a = unit('a', 'player', hex(0, 0));
    const b = unit('b', 'opfor', hex(0, 2));

    const plain = toHitBreakdown(map, a, b, 'is_ml', a.mounts[0]!.zone);
    const pulse = toHitBreakdown(map, a, b, 'is_mpl', a.mounts[0]!.zone);
    expect(pulse.target).toBe(plain.target - 1);
    expect(pulse.factors.some((f) => f.key === 'toHit.weapon')).toBe(true);
    expect(plain.factors.some((f) => f.key === 'toHit.weapon')).toBe(false);
  });
});

describe('Память о последнем контакте (шаг 8, часть D)', () => {
  it('контакт виден — место запоминается на текущий ход', () => {
    const state = new BattleState(flatMap(30, 30), new RngSet(11));
    const at = hex(0, 4);
    state.addUnit(unit('альфа', 'player', hex(0, 0)));
    state.addUnit(unit('браво', 'opfor', at));
    state.phase = Phase.Attack;
    refreshContacts(state);

    expect(state.contact('player', 'браво')).toBeGreaterThan(ContactLevel.None);
    expect(state.lastKnownContact('player', 'браво')).toEqual({ hex: at, turn: state.turn });
  });

  it('сенсорный контакт потерян — пол держит силуэт, но место не трогается, не обнуляется и не следует за целью', () => {
    const state = new BattleState(flatMap(40, 40), new RngSet(12));
    const seenAt = hex(0, 4);
    state.addUnit(unit('альфа', 'player', hex(0, 0)));
    state.addUnit(unit('браво', 'opfor', seenAt));
    state.phase = Phase.Initiative;
    refreshContacts(state);
    expect(state.lastKnownContact('player', 'браво')).toEqual({ hex: seenAt, turn: 1 });

    // Цель уходит далеко за дальность сенсоров и ходом позже пересчитывается заново.
    const far = hex(0, COMBAT.detection.sensorRange + 5);
    state.replaceUnit({ ...state.requireUnit('браво'), hex: far });
    state.turn = 2;
    refreshContacts(state);

    // Класс машины сторона уже разглядела — этого пол не забывает (решение
    // пользователя 2026-09-19), но это не то же самое, что знать, где машина
    // СЕЙЧАС: контакт держится на силуэте, а не тянется за целью до `far`.
    expect(state.contact('player', 'браво')).toBe(ContactLevel.Silhouette);
    // Память осталась там, где видели В ПОСЛЕДНИЙ РАЗ — не на новой позиции
    // (иначе это было бы подглядыванием) и не пустая (иначе это не память).
    expect(state.lastKnownContact('player', 'браво')).toEqual({ hex: seenAt, turn: 1 });
  });

  it('память — часть состояния и входит в хэш', () => {
    const withMemory = new BattleState(flatMap(30, 30), new RngSet(13));
    withMemory.addUnit(unit('альфа', 'player', hex(0, 0)));
    withMemory.addUnit(unit('браво', 'opfor', hex(0, 4)));
    withMemory.phase = Phase.Attack;
    refreshContacts(withMemory);

    const noMemory = new BattleState(flatMap(30, 30), new RngSet(13));
    noMemory.addUnit(unit('альфа', 'player', hex(0, 0)));
    noMemory.addUnit(unit('браво', 'opfor', hex(0, 4)));
    noMemory.phase = Phase.Attack;
    // Контакты просчитаны (совпадают), но lastKnownContact не записан.
    noMemory.setContacts('player', new Map(withMemory.contacts('player')));
    noMemory.setContacts('opfor', new Map(withMemory.contacts('opfor')));

    expect(hashBattleState(withMemory)).not.toBe(hashBattleState(noMemory));
  });
});

describe('Перебор и исполнение согласованы по контакту (шаг 7)', () => {
  it('движение по-прежнему считается одной функцией MP', () => {
    // Страховка от того, что фильтрация по контакту случайно заденет движение:
    // перебор ходов обязан оставаться исполнимым (тот же инвариант, что в шаге 6).
    const state = new BattleState(flatMap(20, 20), new RngSet(9));
    state.addUnit(unit('альфа', 'player', hex(2, 2)));
    state.phase = Phase.Movement;
    refreshContacts(state);

    const walk = execute(state, {
      kind: 'move',
      unitId: 'альфа',
      path: [hex(2, 2), neighbor(hex(2, 2), Direction.SE)],
      mode: MoveMode.Walk,
    });
    expect(walk.ok).toBe(true);
  });
});

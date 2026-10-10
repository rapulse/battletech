import { refreshContacts } from '../../commands/index.js';
import {
  describeMap,
  findSpawn,
  generateMap,
  invalidateLos,
  MAX_ELEVATION,
  placeInBand,
  placeOnDiagonal,
  placeUnits,
  type GeneratedMap,
  type MapDescriptor,
} from '../../map/index.js';
import { Direction, key as hexKey, type Hex } from '../../hex/index.js';
import {
  BattleState,
  HitZone,
  makeUnit,
  Phase,
  type MechUnit,
  type Side,
} from '../../model/index.js';
import type { Pilot } from '../../model/Pilot.js';
import type { BattleObjective } from '../../model/Objective.js';
import { COMBAT, registerDynamicChassis } from '../../data/tables.js';
import { Rng, RngSet } from '../../rng/index.js';
import { recordChassisDef, type MechRecord } from '../mech/MechRecord.js';
import { makeEmplacement, makeStructure, sideGunnery } from '../../rules/emplacement.js';

/**
 * Мост «кампания → бой» (шаг 12, решение 2 из §2).
 *
 * Кампания никогда не держит живой `BattleState`. Она собирает `BattleBrief` — чистые данные,
 * из которых бой Части 1 строится один в один тем же способом, каким его строит демонстрация и
 * батч-прогон (`sim/scenario.ts::makeBattle`). Расстановка по стартовым зонам переиспользуется
 * из `core/map/spawn.ts` — это единственная правка Части 1 этого шага (вынесение хелпера).
 */

export interface BattleParticipant {
  readonly record: MechRecord;
  readonly pilot: Pilot;
  /**
   * Засадная машина (шаг 73a): выходит обесточенной и спящей
   * (`MechUnit.dormant`), стоит не в стартовой зоне, а на диагонали засады.
   * Нет поля — обычная машина, как у всех брифингов до шага.
   */
  readonly ambush?: boolean;
}

/** Огневая точка в брифинге (шаг 73c): id на бой и вид из `data/emplacements.json`. */
export interface BriefEmplacement {
  readonly id: string;
  readonly kind: string;
}

/**
 * Конструкция укрепления в брифинге (шаг 73d): вид, оружие бункера и сторона —
 * на штурме за противника, на обороне за роту (её ведёт бот, как звено
 * нанимателя).
 */
export interface BriefStructure {
  readonly id: string;
  readonly structure: string;
  readonly weapons: readonly string[];
  readonly side: Side;
}

export interface BattleBrief {
  /** Сид карты: рельеф, биом, старты. Ничего боевого от него не зависит. */
  readonly mapSeed: number;
  /** Сид боя: инициатива, попадания, зоны, криты, пилотирование. */
  readonly battleSeed: number;
  /** Ширина/высота/биом карты. Планета (шаг 14) подставит сюда свой биом. */
  readonly map?: Partial<MapDescriptor>;
  /** Рота — всегда сторона `player`, конвенция всего проекта (`sim/scenario.ts`). */
  readonly company: readonly BattleParticipant[];
  /** Противник — всегда сторона `opfor`. */
  readonly enemy: readonly BattleParticipant[];
  /**
   * Звено нанимателя (шаг 73b): сторона `player`, ходит за него бот, в роту не
   * входит — ни в потери, ни в опыт, ни в трофеи (`MechUnit.ally`). Нет поля —
   * рота воюет одна, как во всех брифингах до шага.
   */
  readonly allies?: readonly BattleParticipant[];
  /**
   * Огневые точки противника (шаг 73c): сторона `opfor`, стоят в полосе засады,
   * спят до срока. Нет поля — поле голое, как во всех брифингах до шага.
   */
  readonly emplacements?: readonly BriefEmplacement[];
  /** Укрепление (шаг 73d). Нет поля — поле без укреплений. */
  readonly structures?: readonly BriefStructure[];
  /**
   * Задача боя (шаг 19b). Не задана — правило Части 1, «вывести противника из
   * строя»: так идут бои вне кампании и все брифинги, собранные до этого шага.
   */
  readonly objective?: BattleObjective;
}

/**
 * Уникальный id юнита в бою: `${side}:${record.id}` — состав и противник собираются из
 * независимых списков `MechRecord[]`, и их id могут случайно совпасть (ловушка не про
 * шасси на этот раз, а про сами записи). Отрезается обратно `recordIdOf` в `fromBattle.ts`.
 */
export function battleUnitId(side: Side, recordId: string): string {
  if (recordId.includes(':')) {
    throw new RangeError(`Id записи не может содержать «:»: ${recordId}`);
  }
  return `${side}:${recordId}`;
}

/**
 * Машина отряда → боевой юнит.
 *
 * Свежий `makeUnit` собирается по паспорту (класс уже учтён — `recordChassisDef` вызывает
 * `assemblyToChassisDef`), а состояние повреждений накатывается поверх индексами: зоны, ячейки
 * и боезапас в `MechUnit` и в `MechRecord.condition` лежат в одном порядке (`HitZone`), потому
 * что оба выведены из одного и того же `ChassisDef` — считать здесь заново нечего
 * (`MechRecord.ts`, шаг 11).
 *
 * Разрушенный торс или голова в записи — не машина, а обломки: такую запись в бой не ведут
 * (это решает шаг 13 — ремонт), и функция бросает, а не тихо чинит данные.
 */
export function recordToUnit(
  record: MechRecord,
  pilot: Pilot,
  hex: Hex,
  facing: Direction,
  side: Side,
): MechUnit {
  const def = recordChassisDef(record);
  // Ключ динамического каталога — тот же уникальный на бой id, что и у юнита (`side:recordId`),
  // а не голый `record.id`. `assemblyToChassisDef` выводит `def.id` из кода шасси и класса и
  // НЕ смотрит на навеску, поэтому две записи с одинаковым id на одном шасси затирали бы друг
  // друга в глобальной таблице, и обе машины уходили бы в бой с одним теплоотводом
  // (`makeUnit` копирует зоны и установки сразу, но `heatSinks`, `techBase` и
  // `reactorHeatPerHit` читаются из каталога ПО ХОДУ боя — `MechUnit.ts`, `execute.ts`).
  // Ловушка 2 брифинга шага 12, только про id записей, а не про навеску.
  const registeredId = `${def.id}~rec:${battleUnitId(side, record.id)}`;
  registerDynamicChassis({ ...def, id: registeredId });

  let unit = makeUnit({
    id: battleUnitId(side, record.id),
    side,
    chassis: registeredId,
    pilot,
    hex,
    facing,
  });

  const cond = record.condition;
  if (cond.zones[HitZone.Torso]?.destroyed || cond.zones[HitZone.Head]?.destroyed) {
    throw new RangeError(
      `Запись ${record.id}: разрушен торс или голова — это обломки, не машина для боя`,
    );
  }

  unit = {
    ...unit,
    zones: unit.zones.map((z, i) => {
      const c = cond.zones[i];
      return c === undefined ? z : { ...z, armor: c.armor, structure: c.structure, destroyed: c.destroyed };
    }),
    slots: unit.slots.map((zoneSlots, zi) => {
      const destroyedIdx = new Set(cond.destroyedSlots[zi] ?? []);
      return zoneSlots.map((s, si) => (destroyedIdx.has(si) ? { ...s, destroyed: true } : s));
    }),
    mounts: unit.mounts.map((m, i) => ({
      ...m,
      ammo: cond.ammo[i] ?? m.ammo,
      destroyed: cond.destroyedMounts[i] ?? m.destroyed,
    })),
  };

  return unit;
}

/**
 * Участник брифинга → боевой юнит: `recordToUnit` плюс засада (шаг 73a).
 *
 * Общий вход полного боя и быстрого расчёта: засадник обязан выйти спящим в
 * обоих, иначе две точности начнут судить разные бои.
 */
export function participantToUnit(
  p: BattleParticipant,
  hex: Hex,
  facing: Direction,
  side: Side,
): MechUnit {
  const unit = recordToUnit(p.record, p.pilot, hex, facing, side);
  return p.ambush === true ? { ...unit, dormant: true, shutdown: true } : unit;
}

/** Свой поток жребия засады: от сида карты, вне боевых потоков и вне хэша. */
const AMBUSH_STREAM = 0x5a3b_7c11;

/**
 * Засадники противника — на диагональ, через которую никто не ходит (шаг 73a,
 * `placeOnDiagonal`).
 *
 * Жребий мест — отдельный ГПСЧ от сида КАРТЫ, а не поток боя: засада — часть
 * поля, и поток в `RngSet` боя сдвинул бы хэш каждого боя, где её нет. Не
 * нашлось места в полосе — засадник встаёт у своей стартовой зоны, всё так же
 * спящим: бой без него был бы хуже, чем засада не на месте.
 */
function placeAmbush(state: BattleState, generated: GeneratedMap, brief: BattleBrief): void {
  const ambush = brief.enemy.filter((p) => p.ambush === true);
  if (ambush.length === 0) return;
  const map = state.map;
  const taken = new Set(state.units.map((u) => hexKey(u.hex)));
  const rng = new Rng((brief.mapSeed ^ AMBUSH_STREAM) >>> 0);
  const spots = placeOnDiagonal(map, generated, ambush.length, {
    ...COMBAT.ambush.diagonal,
    spacing: COMBAT.ambush.spacing,
  }, taken, rng);
  const zone = generated.starts[1];
  const facing = zone?.facing ?? Direction.SW;
  ambush.forEach((p, i) => {
    const hex = spots[i] ?? findSpawn(map, zone?.hexes[0] ?? { q: 0, r: 0 }, taken);
    taken.add(hexKey(hex));
    state.addUnit(participantToUnit(p, hex, facing, 'opfor'));
  });
}

/** Свой поток мест огневых точек: от сида карты, как у засады. */
const EMPLACEMENT_PLACE_STREAM = 0x0e3b_1a7c;

/**
 * Огневые точки противника (шаг 73c) — в ту же полосу, что засада, спящими.
 *
 * Клетка под установкой поднимается на +1 (решение пользователя 2026-09-24:
 * укрепление всегда стоит выше окружающей земли) — правкой карты после
 * генерации: генератор и его версия не трогаются, карты без турелей те же. Не
 * нашлось места в полосе — установка не ставится вовсе: турель в стартовой
 * зоне противника — это уже не засада, а подарок.
 */
function placeEmplacements(state: BattleState, generated: GeneratedMap, brief: BattleBrief): void {
  const list = brief.emplacements ?? [];
  if (list.length === 0) return;
  const map = state.map;
  const taken = new Set(state.units.map((u) => hexKey(u.hex)));
  const rng = new Rng((brief.mapSeed ^ EMPLACEMENT_PLACE_STREAM) >>> 0);
  const spots = placeInBand(map, generated, 1, list.length, {
    ...COMBAT.ambush.band,
    spacing: COMBAT.ambush.spacing,
  }, taken, rng);
  const facing = generated.starts[1]?.facing ?? Direction.SW;
  const gunnery = sideGunnery(state.units, 'opfor');
  list.forEach((e, i) => {
    const hex = spots[i];
    if (hex === undefined) return;
    map.setElevation(hex, Math.min(MAX_ELEVATION, map.getElevation(hex) + 1));
    const unit = makeEmplacement({
      id: battleUnitId('opfor', e.id),
      side: 'opfor',
      kind: e.kind,
      hex,
      facing,
      seed: (brief.battleSeed ^ (i + 1) * 0x9e37) >>> 0,
      gunnery,
    });
    state.addUnit({ ...unit, dormant: true, shutdown: true });
  });
  // Высота правлена после генерации: видимость по старым высотам не годится.
  invalidateLos(map);
}

/** Свой поток мест укрепления: от сида карты, как у засады. */
const FORTRESS_PLACE_STREAM = 0x4f7e_22a1;

/**
 * Укрепление (шаг 73d) — скоплением у старта обороняющегося (`combat.json →
 * fortress`), каждая конструкция на +1 к клетке.
 *
 * Бункеры противника спят по правилу засады; объекты-цели не спят — это цель
 * задачи, а не сюрприз. Укрепление роты (оборона) ведёт бот, как звено
 * нанимателя (`ally`), и роте оно не принадлежит. Не нашлось места — конструкция
 * встаёт у стартовой зоны своей стороны: объект задачи обязан быть на поле.
 */
function placeFortress(state: BattleState, generated: GeneratedMap, brief: BattleBrief): void {
  const list = brief.structures ?? [];
  if (list.length === 0) return;
  const map = state.map;
  const taken = new Set(state.units.map((u) => hexKey(u.hex)));
  const rng = new Rng((brief.mapSeed ^ FORTRESS_PLACE_STREAM) >>> 0);
  for (const side of ['player', 'opfor'] as const) {
    const mine = list.filter((s) => s.side === side);
    if (mine.length === 0) continue;
    const index = side === 'player' ? 0 : 1;
    const spots = placeInBand(map, generated, index, mine.length, {
      ...COMBAT.fortress.band,
      spacing: COMBAT.fortress.spacing,
    }, taken, rng);
    const zone = generated.starts[index];
    const facing = zone?.facing ?? Direction.NE;
    const gunnery = sideGunnery(state.units, side);
    mine.forEach((s, i) => {
      const hex = spots[i] ?? findSpawn(map, zone?.hexes[0] ?? { q: 0, r: 0 }, taken);
      taken.add(hexKey(hex));
      map.setElevation(hex, Math.min(MAX_ELEVATION, map.getElevation(hex) + 1));
      const unit = makeStructure({
        id: battleUnitId(side, s.id),
        side,
        structure: s.structure,
        weapons: s.weapons,
        hex,
        facing,
        seed: (brief.battleSeed ^ (i + 17) * 0x9e37) >>> 0,
        gunnery,
      });
      const sleeps = side === 'opfor' && !unit.objectiveTarget;
      state.addUnit({
        ...unit,
        ally: side === 'player',
        ...(sleeps ? { dormant: true, shutdown: true } : {}),
      });
    });
  }
  // Высота правлена после генерации: видимость по старым высотам не годится.
  invalidateLos(map);
}

/**
 * Бой из брифинга — зеркало `sim/scenario.ts::makeBattle`, но состав и противник приходят
 * записями кампании, а не `UnitSpec`. Ничего боевого сверх этого не меняется: та же карта, та
 * же расстановка, тот же порядок инициализации контактов.
 */
export function makeBattleFromBrief(brief: BattleBrief): BattleState {
  const rng = new RngSet(brief.battleSeed);
  const width = brief.map?.width ?? 15;
  const height = brief.map?.height ?? 15;
  const generated = generateMap(
    describeMap({ seed: brief.mapSeed, width, height, ...(brief.map ?? {}) }),
  );
  const map = generated.map;
  const state = new BattleState(map, rng);
  state.mapDescriptor = generated.descriptor;

  // Ключ расстановки — уникальный на бой id юнита (`side:recordId`), а не голый id записи:
  // состав и противник приходят из независимых списков, и их id могут совпасть (та же ловушка,
  // что решает `battleUnitId`).
  const allies = brief.allies ?? [];
  const specs = [
    // Звено нанимателя встаёт в зону роты следом за ней (шаг 73b): высадились
    // вместе. Идёт ПОСЛЕ роты, чтобы рота встала ровно туда же, что и без него.
    ...[...brief.company, ...allies].map((p) => ({
      id: battleUnitId('player', p.record.id),
      side: 'player' as const,
      col: Math.floor(width / 2),
      row: Math.floor(height / 2),
    })),
    // Засадники в стартовую зону не встают (шаг 73a): их место — диагональ засады.
    // Из общего списка их убирают ДО расстановки, чтобы остальные машины
    // встали ровно туда же, куда встали бы без засады.
    ...brief.enemy.filter((p) => p.ambush !== true).map((p) => ({
      id: battleUnitId('opfor', p.record.id),
      side: 'opfor' as const,
      col: Math.floor(width / 2),
      row: Math.floor(height / 2),
    })),
  ];
  const placements = placeUnits(map, generated, specs, ['player', 'opfor']);

  const place = (side: Side, p: BattleParticipant, ally = false): void => {
    const key = battleUnitId(side, p.record.id);
    const placement = placements.get(key);
    if (placement === undefined) throw new Error(`Нет расстановки для ${key}`);
    const unit = participantToUnit(p, placement.hex, placement.facing, side);
    state.addUnit(ally ? { ...unit, ally: true } : unit);
  };

  for (const p of brief.company) place('player', p);
  for (const p of allies) place('player', p, true);
  for (const p of brief.enemy) if (p.ambush !== true) place('opfor', p);
  placeAmbush(state, generated, brief);
  placeEmplacements(state, generated, brief);
  placeFortress(state, generated, brief);

  state.phase = Phase.Initiative;
  if (brief.objective !== undefined) state.objective = brief.objective;
  refreshContacts(state);
  return state;
}

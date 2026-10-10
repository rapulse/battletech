import { Direction, hexToOffset, offsetToHex as offsetToHexLocal } from '../core/hex/index.js';
import { chassis, weapon, CHASSIS_CATALOG } from '../core/data/index.js';
import { tr } from '../core/log/index.js';
import {
  cleanChassisCode,
  ContactLevel,
  HitZone,
  integrity,
  isArm,
  maxIntegrity,
  WEIGHT_CLASS_KEYS,
  type WeightClass,
  type BattleState,
  type MechUnit,
  type Side,
} from '../core/model/index.js';
import type { MoveMode, ReachResult } from '../core/map/index.js';
import { los } from '../core/map/index.js';
import { heatLimits } from '../core/rules/heat.js';
import { inExitBand } from '../core/rules/morale.js';
import { ecmRange, probeRange } from '../core/rules/detection.js';
import type { MovementTrail, RenderScene, RenderUnit, RenderWeapon } from './tacticalRenderer.js';
import type { HexView, MapView } from './mapView.js';
import { key as viewKey } from './mapView.js';
import { EMPLACEMENT_ARCHETYPE, STRUCTURE_ARCHETYPES } from './archetypeArt.js';
import { emplacementKindOf } from '../core/rules/emplacement.js';

/**
 * Единственное место, где состояние боя превращается в то, что видно.
 *
 * Здесь и только здесь применяется фильтр знания. Если бы карта фильтровала
 * сама, а панель — сама, они разошлись бы на первом же исключении, и игрок
 * узнавал бы из подписи то, чего разведка ему не давала (шаг 7, шаг 9 часть B).
 *
 * Ничего не ВЫЧИСЛЯЕТСЯ: достижимость, целевое число и стоимость хода приходят
 * из ядра готовыми. Показ их только раскладывает по экрану.
 */

/** Румб ядра → угол на экране. E смотрит вправо, дальше по часовой. */
export function facingAngle(facing: Direction): number {
  return ((facing - Direction.E) * Math.PI) / 3;
}

/** Угол на экране → ближайший румб. Нужен повороту мышью. */
export function angleToFacing(angle: number): Direction {
  const steps = Math.round(angle / (Math.PI / 3)) + Direction.E;
  return ((((steps % 6) + 6) % 6) as Direction);
}

/**
 * Силуэт машины: гуманоид или нет.
 *
 * Выводится из того, ГДЕ стоит вооружение, а не назначается списком: машина,
 * несущая стволы в руках, читается как гуманоид (Atlas, Centurion), машина с
 * вооружением в торсе — как не-гуманоид (Timber Wolf, Catapult). Это настоящее
 * свойство сборки, видимое в листе, а не выдуманный признак ради картинки.
 */
export function silhouette(unit: MechUnit): 'humanoid' | 'non_humanoid' {
  let arms = 0;
  let torso = 0;
  for (const mount of unit.mounts) {
    if (isArm(mount.zone)) arms++;
    else if (mount.zone === HitZone.Torso) torso++;
  }
  return arms >= torso ? 'humanoid' : 'non_humanoid';
}

const WEIGHT_NAMES = ['light', 'medium', 'heavy', 'assault'] as const;

/** Ключ фишки: силуэт и весовой класс. По нему `archetypeArt.ts` выбирает рисовалку. */
export function archetypeKey(body: 'humanoid' | 'non_humanoid', weightClass: WeightClass): string {
  return `${body}_${WEIGHT_NAMES[weightClass] ?? 'medium'}`;
}

export function archetypeOf(unit: MechUnit, known: ContactLevel): string {
  if (known <= ContactLevel.Blip) return 'unidentified';
  if (unit.frame === 'emplacement') {
    const name = emplacementKindOf(unit);
    return (name !== null ? STRUCTURE_ARCHETYPES[name] : undefined) ?? EMPLACEMENT_ARCHETYPE;
  }
  return archetypeKey(silhouette(unit), unit.weightClass);
}

function weaponsOf(unit: MechUnit): RenderWeapon[] {
  const out: RenderWeapon[] = [];
  for (const mount of unit.mounts) {
    if (mount.destroyed) continue;
    const w = weapon(mount.weapon);
    out.push({
      name: tr(w.key),
      minR: w.minRange,
      shortR: w.short,
      medR: w.medium,
      maxR: w.long,
    });
  }
  return out;
}

/**
 * Машина глазами стороны `viewer`.
 *
 * Возвращает null, если сторона о ней не знает: не «серую фишку», а именно
 * ничего. Полупрозрачный призрак — это тоже сведения.
 */
export function renderUnit(
  state: BattleState,
  unit: MechUnit,
  viewer: Side,
  unitAngles?: ReadonlyMap<string, number>,
): RenderUnit | null {
  const own = unit.side === viewer;
  const level = unit.destroyed
    ? ContactLevel.Identified
    : own
      ? ContactLevel.Identified
      : state.contact(viewer, unit.id);
  if (level === ContactLevel.None) return null;

  const { col, row } = hexToOffset(unit.hex);
  const known = level >= ContactLevel.Identified
    ? 'identified'
    : level === ContactLevel.Silhouette
      ? 'silhouette'
      : 'blip';

  const full = known === 'identified';
  // Край шкалы — предел машины (отвод + запас корпуса): тепло выше него в фазе
  // тепла глушит реактор (`core/rules/heat.ts`). У неопознанной машины предела
  // не видно, как и тепла.
  const maxHeat = full ? heatLimits(unit).limit : 0;

  const chassisDef = chassis(unit.chassis);
  const tons = chassisDef?.tons ?? ([35, 55, 75, 90][unit.weightClass] ?? 55);
  // Огневая точка (шаг 73c) шасси каталога не имеет: её имя — термин журнала.
  const emplacement = emplacementKindOf(unit);
  const chassisCode = emplacement === null ? cleanChassisCode(unit.chassis) : tr(`emplacement.${emplacement}`);
  const mechName = full ? (CHASSIS_CATALOG.get(chassisCode)?.canonName || chassisCode) : undefined;

  let code: string;
  if (known === 'identified') {
    code = chassisCode;
  } else if (known === 'silhouette') {
    code = tr(WEIGHT_CLASS_KEYS[unit.weightClass]).toUpperCase();
  } else {
    code = '???';
  }

  return {
    id: unit.id,
    code,
    name: mechName,
    chassis: full ? chassisCode : undefined,
    tonnage: tons,
    team: unit.side === 'player' ? 'red' : 'blue',
    col,
    row,
    elevation: state.map.contains(unit.hex) ? state.map.getElevation(unit.hex) : 0,
    facingAngle: unitAngles?.get(unit.id) ?? facingAngle(unit.facing),
    archetype: archetypeOf(unit, level),
    known,
    classLabel: tr(WEIGHT_CLASS_KEYS[unit.weightClass]),
    hp: full ? integrity(unit) : 0,
    maxHp: full ? Math.max(1, maxIntegrity(unit)) : 1,
    heat: full ? unit.heat : 0,
    maxHeat,
    weapons: full ? weaponsOf(unit) : [],
    // РЭБ и зонд — как броня и тепло, только опознанной машине (шаг про
    // ECM/BAP на панели боя): не опознав робота, дальность его приборов не
    // прочитать, а видна ли она вообще — вопрос контакта, а не показа.
    ecmRange: full ? ecmRange(unit) : 0,
    probeRange: full ? probeRange(unit) : 0,
    destroyed: unit.destroyed,
  };
}

export interface SceneInput {
  readonly state: BattleState;
  readonly viewer: Side;
  readonly mapView: MapView;
  readonly selectedId: string | null;
  readonly hover: { col: number; row: number } | null;
  readonly hoveredWeapon: RenderWeapon | null;
  readonly selectedWeapon?: RenderWeapon | null;
  readonly mode: 'move' | 'los';
  /** Готовый результат Дейкстры из ядра. Показ его не пересчитывает. */
  readonly reach: ReachResult | null;
  readonly unitAngles?: ReadonlyMap<string, number> | undefined;
  /** Подсветить зону выхода своей стороны (шаг 65). Какие клетки в ней, решает ядро. */
  readonly showExitZone?: boolean | undefined;
  readonly moveTrails?: ReadonlyMap<
    string,
    {
      readonly path: readonly { readonly col: number; readonly row: number }[];
      readonly mode: MoveMode;
      readonly turn: number;
    }
  > | undefined;
}

export function buildScene(input: SceneInput): RenderScene {
  const units: RenderUnit[] = [];
  for (const u of input.state.units) {
    const view = renderUnit(input.state, u, input.viewer, input.unitAngles);
    if (view !== null) units.push(view);
  }

  const reachable = new Map<string, number>();
  if (input.reach !== null) {
    for (const cell of input.reach.byHex.values()) {
      if (cell.cost === 0) continue;
      const { col, row } = hexToOffset(cell.hex);
      reachable.set(viewKey(col, row), cell.cost);
    }
  }

  const hoverHex: HexView | null =
    input.hover === null
      ? null
      : (input.mapView.hexes.get(viewKey(input.hover.col, input.hover.row)) ?? null);

  const selectedUnit = units.find((u) => u.id === input.selectedId && !u.destroyed) ?? null;

  // Зона выхода: клетки, откуда машина уходит с поля целой. Отвечает ядро — тем же
  // вопросом, каким оно решает, кто уйдёт (`rules/morale.ts::inExitBand`).
  const exitBand = new Set<string>();
  if (input.showExitZone === true) {
    for (const h of input.mapView.hexes.values()) {
      if (inExitBand(input.state, input.viewer, offsetToHexLocal(h.col, h.row))) {
        exitBand.add(viewKey(h.col, h.row));
      }
    }
  }

  // Вердикт линии огня считает ЯДРО тем же вызовом, который сделают правила при
  // выстреле. Показ его только красит.
  let losBlocked: boolean | null = null;
  const shooter = input.selectedId === null ? undefined : input.state.getUnit(input.selectedId);
  if (shooter !== undefined && input.hover !== null) {
    const target = offsetToHexLocal(input.hover.col, input.hover.row);
    if (input.state.map.contains(target)) {
      losBlocked = los(input.state.map, shooter.hex, target, { fromEye: 1, toEye: 1 }).blocked;
    }
  }

  // Траектории перемещений роботов
  const movementTrails: MovementTrail[] = [];
  if (input.moveTrails) {
    for (const [unitId, trail] of input.moveTrails.entries()) {
      const u = input.state.getUnit(unitId);
      if (u === undefined || u.destroyed) continue;
      const team = u.side === 'player' ? 'red' : 'blue';
      if (
        input.state.contact(input.viewer, u.id) !== ContactLevel.None ||
        u.side === input.viewer
      ) {
        movementTrails.push({
          unitId,
          team,
          path: trail.path,
          mode: trail.mode,
        });
      }
    }
  }

  return {
    units,
    selectedUnit,
    hoverHex,
    hoveredWeapon: input.hoveredWeapon,
    selectedWeapon: input.selectedWeapon ?? null,
    mode: input.mode,
    reachableHexes: reachable,
    exitBand,
    losBlocked,
    movementTrails,
  };
}

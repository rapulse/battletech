import { EMPLACEMENTS, emplacementKind, registerDynamicChassis, structureKind } from '../data/tables.js';
import type { ChassisDef } from '../data/index.js';
import type { Direction, Hex } from '../hex/index.js';
import { makeUnit, type MechUnit, type Side } from '../model/MechUnit.js';
import { clampSkill, skillLevel } from '../model/Pilot.js';
import { Rng } from '../rng/index.js';
import { makePilot } from './skills.js';

/**
 * Огневые точки и укрепления (шаги 73c, 73d): неподвижные установки,
 * участники боя с `frame: 'emplacement'`.
 *
 * Собираются тем же `makeUnit`, что и робот, из «шасси», заведённого на лету
 * по `data/emplacements.json`: вся прочность — в корпусе (торсе), остальные
 * зоны пусты, отвод тепла с запасом. Так выбор цели, видимость, линия огня,
 * навесной огонь, журнал и быстрый расчёт работают с ними без новой ветки.
 *
 * Чего у установки нет из правил меха — и где это решено одной проверкой:
 *
 * | правило | где |
 * |---|---|
 * | ходьба | `MoveProfile.ts::mpBudget` — 0 очков в любом режиме: законных ходов нет, бот отвечает `endPhase` |
 * | зона попадания, криты, падение, ранения, катапульта | `attack.ts::emplacementSalvo` |
 * | тепло и отключение | отвод тепла с запасом здесь: порогов она не достаёт |
 * | мораль стороны, инициатива | `morale.ts`, `initiative.ts` — её не считают |
 * | задача «вывести всех / долю / продержаться» | `objective.ts::progressOf` — не считает; объект-цель считается отдельно (`objectiveTarget`) |
 * | строй звена | `sim/bot.ts` — не держит своих у себя |
 * | трофеи, потери, опыт за выбитую машину, достижения | разбор идёт по брифингу, а в `company`/`enemy` её нет; добивание не засчитывается (`sim/tally.ts`, `fastResolve.ts`) |
 * | засада: спит до огня своей стороны, видна за `spotRange` | общее правило `combat.json → ambush` |
 */

/** Отвод тепла «с запасом»: залп установок его не достаёт никогда. */
const COOLING = 99;

/**
 * Шасси установки: имя, оружие и прочность корпуса. Регистрируется по составу
 * (`emp:<имя>` у огневой точки, `emp:<имя>:<оружие+оружие>` у конструкции),
 * поэтому одинаковые установки делят одно шасси.
 */
function installationChassis(
  name: string,
  weapons: readonly string[],
  structure: number,
  withWeapons: boolean,
): string {
  const id = withWeapons ? `emp:${name}:${weapons.join('+')}` : `emp:${name}`;
  const empty = { armor: 0, structure: 0 };
  const def: ChassisDef = {
    id,
    key: `emplacement.${name}`,
    weightClass: 'medium',
    techBase: 'is',
    tons: 40,
    heatSinks: COOLING,
    // Все радиаторы — внутри реактора: ячеек не занимают, и крита, которого у
    // установки нет, им бояться нечего.
    integralHeatSinks: COOLING,
    reactorTier: 3,
    frameTier: 3,
    armorTons: 0,
    zones: {
      head: empty,
      torso: { armor: 0, structure: Math.max(1, Math.round(structure)) },
      leftArm: empty,
      rightArm: empty,
      leftLeg: empty,
      rightLeg: empty,
    },
    mounts: weapons.map((w) => {
      const k = emplacementKind(w);
      return { weapon: k.weapon, zone: 'torso' as const, ammo: k.ammo };
    }),
  };
  registerDynamicChassis(def);
  return id;
}

export interface InstallationOptions {
  readonly id: string;
  readonly side: Side;
  readonly hex: Hex;
  readonly facing: Direction;
  /** Сид расчёта: имя и лицо — от сида; Стрельба — `gunnery`. */
  readonly seed: number;
  /** Стрельба расчёта — средняя по пилотам стороны на карте (`sideGunnery`). */
  readonly gunnery: number;
}

function crew(opts: InstallationOptions): MechUnit['pilot'] {
  const pilot = makePilot(new Rng(opts.seed >>> 0), { id: `${opts.id}-crew`, tier: 3 });
  return { ...pilot, skills: { ...pilot.skills, gunnery: clampSkill(opts.gunnery) }, firstBattle: false };
}

function build(opts: InstallationOptions, chassis: string, objective: boolean): MechUnit {
  const unit = makeUnit({
    id: opts.id,
    side: opts.side,
    chassis,
    pilot: crew(opts),
    hex: opts.hex,
    facing: opts.facing,
  });
  return { ...unit, walkMP: 0, frame: 'emplacement', objectiveTarget: objective };
}

/** Огневая точка: одна установка вида `kind`. Спящей её делает вызывающий. */
export function makeEmplacement(opts: InstallationOptions & { readonly kind: string }): MechUnit {
  const k = emplacementKind(opts.kind);
  return build(opts, installationChassis(k.id, [k.id], k.structure, false), false);
}

/**
 * Конструкция укрепления (шаг 73d): бункер с установками или объект-цель без
 * оружия. `weapons` — виды установок из `kinds`, по числу `mounts` конструкции.
 */
export function makeStructure(
  opts: InstallationOptions & { readonly structure: string; readonly weapons: readonly string[] },
): MechUnit {
  const s = structureKind(opts.structure);
  if (opts.weapons.length !== s.mounts) {
    throw new RangeError(`У «${s.id}» ${s.mounts} установок, передано ${opts.weapons.length}`);
  }
  const chassis = installationChassis(s.id, opts.weapons, EMPLACEMENTS.base * s.factor, s.mounts > 0);
  return build(opts, chassis, s.objective);
}

/**
 * Стрельба расчёта установок стороны: средняя по пилотам её машин на карте, с
 * округлением (решение пользователя 2026-09-24). Машин нет — середина шкалы.
 */
export function sideGunnery(units: readonly MechUnit[], side: Side): number {
  const pilots = units.filter((u) => u.side === side && u.frame === 'mech').map((u) => u.pilot);
  if (pilots.length === 0) return clampSkill(5);
  return clampSkill(pilots.reduce((sum, p) => sum + skillLevel(p, 'gunnery'), 0) / pilots.length);
}

/**
 * Имя установки для словаря журнала (`emplacement.<имя>`): вид огневой точки
 * или конструкция. `null` — это робот.
 */
export function emplacementKindOf(unit: MechUnit): string | null {
  if (unit.frame !== 'emplacement' || !unit.chassis.startsWith('emp:')) return null;
  return unit.chassis.slice(4).split(':')[0] ?? null;
}

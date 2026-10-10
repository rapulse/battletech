import { emplacementKind, structureKind } from '../../data/tables.js';
import type { BattleObjective } from '../../model/Objective.js';
import { Rng } from '../../rng/index.js';
import type { BriefEmplacement } from '../bridge/toBattle.js';
import type { Contract } from './board.js';
import { missionField } from './intel.js';
import { CONTRACTS, type MissionType, type ScaleId } from './schema.js';

/**
 * Огневые точки противника на этом вылете (шаг 73c).
 *
 * Только на поле противника (`missions.*.field`): там он окопался. Разыгрывается
 * на вылете, как ошибка разведки, и в сводку не входит — о возможности
 * предупреждает значок «чужое поле». Чистая функция от `(контракт, сид)`: разбор
 * боя пересоберёт тот же брифинг.
 */
export function emplacementsFor(contract: Contract, seed: number): BriefEmplacement[] {
  if (missionField(contract.mission) !== 'enemy') return [];
  const rules = CONTRACTS.emplacements;
  const rng = new Rng((seed ^ EMPLACEMENT_STREAM) >>> 0);
  if (rng.next() >= rules.chance) return [];
  const [lo, hi] = rules.countByScale[contract.scale];
  const count = rng.int(lo, hi);
  const out: BriefEmplacement[] = [];
  for (let i = 0; i < count; i++) out.push({ id: `T-${seed}-${i + 1}`, kind: pickKind(rng) });
  return out;
}

/** Вид установки по весам `mix`; ключи обходятся в явном порядке. */
function pickKind(rng: Rng): string {
  const total = MIX.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng.next() * total;
  for (const [kind, w] of MIX) {
    roll -= w;
    if (roll < 0) return kind;
  }
  return (MIX[MIX.length - 1] as [string, number])[0];
}

const EMPLACEMENT_STREAM = 0x3e1a_c0de;

const MIX: readonly [string, number][] = Object.entries(CONTRACTS.emplacements.mix).sort(([a], [b]) =>
  a < b ? -1 : a > b ? 1 : 0,
);
// Опечатка в виде обязана остановить загрузку, а не тихо выпасть из жребия.
for (const [kind] of MIX) emplacementKind(kind);

/**
 * Укрепление работы (шаг 73d): объекты-цели и бункеры с их оружием.
 *
 * Лежит в контракте, а не разыгрывается на вылете: карточка обязана назвать
 * цель ДО подписи (решение пользователя 2026-09-24). Где стоит и за кого —
 * решает бой (`bridge/toBattle.ts`): на штурме за противника, на обороне за роту.
 */
export interface ContractFortress {
  /** Объекты-цели: конструкции из `data/emplacements.json → structures`. */
  readonly targets: readonly string[];
  /** Бункеры — по списку видов установок на каждый. */
  readonly bunkers: readonly (readonly string[])[];
}

/**
 * Укрепление для предложения или `undefined` (шаг 73d). Свой ГПСЧ на каждое
 * предложение: биржа без укреплений остаётся прежней, а укреплённая строка не
 * сдвигает жребий соседних.
 */
export function fortressFor(
  worldSeed: number,
  systemId: string,
  decade: number,
  n: number,
  mission: MissionType,
  scale: ScaleId,
): ContractFortress | undefined {
  const rules = CONTRACTS.fortified;
  const row = rules.missions[mission];
  if (row === undefined) return undefined;
  const rng = new Rng(fortressSeed(worldSeed, systemId, decade, n));
  if (rng.next() >= row.chance) return undefined;

  const pool = [...rules.targetKinds];
  const count = Math.min(pool.length, rng.int(rules.targets[0], rules.targets[1]));
  const targets: string[] = [];
  for (let i = 0; i < count; i++) {
    const pick = Math.floor(rng.next() * pool.length);
    targets.push(pool.splice(pick, 1)[0] as string);
  }
  const [lo, hi] = rules.bunkersByScale[scale];
  const mounts = structureKind('bunker').mounts;
  const bunkers: string[][] = [];
  for (let b = rng.int(lo, hi); b > 0; b--) {
    const weapons: string[] = [];
    for (let m = 0; m < mounts; m++) weapons.push(pickWeighted(rng, BUNKER_WEAPONS));
    bunkers.push(weapons);
  }
  return { targets, bunkers };
}

/** Задача боя укреплённой работы или `null`, если работа не укреплена. */
export function fortressObjective(mission: MissionType): BattleObjective | null {
  return CONTRACTS.fortified.missions[mission]?.objective ?? null;
}

function fortressSeed(worldSeed: number, systemId: string, decade: number, n: number): number {
  let h = (worldSeed >>> 0) ^ 0x68e3_1da4;
  const text = `${systemId}|${decade}|${n}|fortress`;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function pickWeighted(rng: Rng, table: readonly [string, number][]): string {
  const total = table.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng.next() * total;
  for (const [kind, w] of table) {
    roll -= w;
    if (roll < 0) return kind;
  }
  return (table[table.length - 1] as [string, number])[0];
}

const BUNKER_WEAPONS: readonly [string, number][] = Object.entries(CONTRACTS.fortified.bunkerWeapons).sort(
  ([a], [b]) => (a < b ? -1 : a > b ? 1 : 0),
);
for (const [kind] of BUNKER_WEAPONS) emplacementKind(kind);
for (const kind of CONTRACTS.fortified.targetKinds) {
  if (!structureKind(kind).objective) throw new Error(`fortified.targetKinds: «${kind}» — не объект-цель`);
}

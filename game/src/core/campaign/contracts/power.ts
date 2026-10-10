import { COMBAT, weapon } from '../../data/tables.js';
import { zoneFromId } from '../../model/HitZone.js';
import { pilotGunneryBase } from '../../rules/skills.js';
import type { Company } from '../company/types.js';
import { FAST } from '../bridge/fastResolve.js';
import type { BattleParticipant } from '../bridge/toBattle.js';
import { recordChassisDef, type MechRecord } from '../mech/MechRecord.js';
import { opforCount, type Contract } from './board.js';
import { buildForce } from './opfor.js';
import { CONTRACTS } from './schema.js';

/**
 * Оценка сил по боевым числам (шаг 68, `notes.md` §10t).
 *
 * Прежняя оценка (`threat.ts::mechThreat`) — линия по тоннажу: она не видит ни
 * залпа, ни брони, ни дальности, ни пилота. Разбор настоящего боя показал цену
 * этого: 135 т трофейных клановых машин с ветераном против трёх лёгких машин
 * ополчения оценка называла перевесом 1.72, а бой кончился за семь ходов
 * одним ответным попаданием.
 *
 * Машина здесь — два числа: **огонь** (ожидаемый урон за ход) и **живучесть**
 * (броня плюс структура). Сторона — `√(Σогонь × Σживучесть)`: по закону
 * квадратов Ланчестера перестрелку выигрывает большее произведение суммарного
 * огня на суммарную прочность. Корень возвращает число в линейную шкалу: две
 * одинаковые машины — ровно вдвое сильнее одной, а численный перевес
 * сказывается в исходе боя, а не в самой оценке.
 *
 * **Это по-прежнему не боевое правило.** Ни одно из чисел в бой не попадает;
 * карта, строй и манёвр свёрнуты в одну поправку `fieldToHit`. Коэффициенты —
 * в `data/contracts.json → opfor.power`.
 */

/** Огонь и живучесть одной машины или суммы машин. */
export interface PowerParts {
  /** Ожидаемый урон за ход, средний по дистанциям `opfor.power.ranges`. */
  readonly fire: number;
  /** Броня плюс структура целых зон. */
  readonly hull: number;
}

const ZERO: PowerParts = { fire: 0, hull: 0 };

/** Вероятность выбросить на 2d6 не меньше `target`. */
export function chance2d6(target: number): number {
  if (target <= 2) return 1;
  if (target > 12) return 0;
  let ways = 0;
  for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) if (a + b >= target) ways++;
  return ways / 36;
}

function rangeMod(distance: number, w: { short: number; medium: number; long: number }): number | null {
  if (distance <= w.short) return COMBAT.toHit.rangeShort;
  if (distance <= w.medium) return COMBAT.toHit.rangeMedium;
  if (distance <= w.long) return COMBAT.toHit.rangeLong;
  return null;
}

interface Gun {
  readonly id: string;
  readonly heat: number;
}

/**
 * Урон за ход на одной дистанции с учётом отвода.
 *
 * Орудия берутся по убыванию урона на единицу тепла, пока отвода хватает, —
 * так стреляет и бот, берегущий машину от отключения. Последнее орудие,
 * которому отвода хватает не целиком, идёт долей: это ожидание по многим ходам,
 * когда оно стреляет через раз.
 */
function fireAt(guns: readonly Gun[], distance: number, toHitBase: number, budget: number): number {
  const shots: { dmg: number; heat: number }[] = [];
  for (const g of guns) {
    const w = weapon(g.id);
    const mod = rangeMod(distance, w);
    if (mod === null) continue;
    const minPenalty = distance < w.minRange ? (w.minRange - distance) * COMBAT.toHit.minRangePenaltyPerHex : 0;
    const raw = toHitBase + mod + minPenalty + w.toHitMod;
    const target = Math.max(COMBAT.toHit.minTarget, Math.min(COMBAT.toHit.maxTarget, raw));
    const dmg = chance2d6(target) * w.damage * w.shots;
    if (dmg > 0) shots.push({ dmg, heat: g.heat });
  }
  shots.sort((a, b) => b.dmg / Math.max(b.heat, 1e-9) - a.dmg / Math.max(a.heat, 1e-9));
  let left = Math.max(0, budget);
  let total = 0;
  for (const s of shots) {
    if (s.heat <= left) {
      total += s.dmg;
      left -= s.heat;
    } else {
      total += s.dmg * (left / s.heat);
      left = 0;
    }
  }
  return total;
}

/**
 * Огонь и живучесть машины в её нынешнем состоянии.
 *
 * `gunnery` — база целевого числа пилота (`pilotGunneryBase`): она уже учитывает
 * ранения, поэтому раненый стрелок и в оценке стреляет хуже.
 *
 * `tuning` — только для замера (`pnpm threatcalib`): перебор поправки поля и
 * дистанций на одной и той же выборке боёв. Игра зовёт без него и берёт данные.
 */
export function mechPower(
  record: MechRecord,
  gunnery: number,
  tuning: { readonly fieldToHit: number; readonly ranges: readonly number[] } = CONTRACTS.opfor.power,
): PowerParts {
  const def = recordChassisDef(record);
  const cond = record.condition;

  let hull = 0;
  cond.zones.forEach((z) => {
    if (!z.destroyed) hull += z.armor + z.structure;
  });

  const guns: Gun[] = [];
  def.mounts.forEach((m, i) => {
    if (cond.destroyedMounts[i] === true) return;
    if (cond.zones[zoneFromId(m.zone)]?.destroyed === true) return;
    const ammo = cond.ammo[i];
    if (ammo !== null && ammo !== undefined && ammo <= 0) return;
    guns.push({ id: m.weapon, heat: weapon(m.weapon).heat });
  });

  const p = tuning;
  const toHitBase = gunnery + p.fieldToHit;
  const budget = def.heatSinks - FAST.moveHeat;
  const fire = p.ranges.reduce((s, d) => s + fireAt(guns, d, toHitBase, budget), 0) / p.ranges.length;
  return { fire, hull };
}

function add(a: PowerParts, b: PowerParts): PowerParts {
  return { fire: a.fire + b.fire, hull: a.hull + b.hull };
}

/** Сила стороны из суммы частей, в сырых единицах (до нормировки). */
function rawStrength(parts: PowerParts): number {
  return Math.sqrt(parts.fire * parts.hull);
}

/** Части звена роты: огонь по пилоту каждой машины; машина без пилота в строю не в счёт. */
export function lanceParts(company: Company, lance: readonly MechRecord[]): PowerParts {
  let sum = ZERO;
  for (const m of lance) {
    const pilot = m.pilotId === null ? undefined : company.pilots.find((p) => p.id === m.pilotId);
    if (pilot === undefined || pilot.status !== 'active') continue;
    sum = add(sum, mechPower(m, pilotGunneryBase(pilot)));
  }
  return sum;
}

/**
 * Части готового состава боя — машин с пилотами, как их видит `fastResolve`. Одна мера на обе стороны
 * боя фронта с ротой (шаг 86): звено роты и армия, собранная `buildForce`, считаются одной формулой.
 */
export function forceParts(force: readonly BattleParticipant[]): PowerParts {
  let sum = ZERO;
  for (const p of force) sum = add(sum, mechPower(p.record, pilotGunneryBase(p.pilot)));
  return sum;
}

// --- ожидание по противнику -----------------------------------------------------

/** Постоянный сид выборки из ключа — FNV-1a: одна и та же работа всегда оценивается одинаково. */
function seedOf(key: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const EXPECTED = new Map<string, PowerParts>();

/** Ступень снабжения в ключе выборки. */
const SUPPLY_STEP = 0.05;

/**
 * Средняя машина противника по параметрам предложения.
 *
 * Выборка собирается ТЕМ ЖЕ `buildForce`, что и настоящий вылет, — доктрина
 * цели, тип части, техбаза, снабжение и полоса тоннажа, — но на своём
 * постоянном сиде. Результат запоминается по ключу: биржа и такт соперников
 * спрашивают одни и те же сочетания много раз.
 */
export function expectedOpforMech(contract: Contract): PowerParts {
  const cap = contract.opforTons;
  // Снабжение непрерывно, и без ступени у каждого предложения был бы свой ключ:
  // такт соперников за десять лет спрашивает десятки тысяч предложений, и
  // выборка собиралась бы заново почти на каждое. Ступень 0.05 меньше того,
  // что снабжение успевает сдвинуть в комплектности одной машины.
  const supply = Math.round(contract.supply / SUPPLY_STEP) * SUPPLY_STEP;
  const key = [contract.target, contract.biome, contract.opforType, contract.opforTechBase, supply.toFixed(2), cap].join('|');
  const hit = EXPECTED.get(key);
  if (hit !== undefined) return hit;

  const n = CONTRACTS.opfor.power.samples;
  const force = buildForce(
    {
      count: n,
      factionId: contract.target,
      biome: contract.biome,
      opforType: contract.opforType,
      techBase: contract.opforTechBase,
      supply,
      tonnageCap: cap,
      tonnageMin: cap * CONTRACTS.opfor.tons.floor,
      idPrefix: 'P',
    },
    seedOf(key),
  );
  let sum = ZERO;
  for (const p of force) sum = add(sum, mechPower(p.record, pilotGunneryBase(p.pilot)));
  const mean = { fire: sum.fire / n, hull: sum.hull / n };
  EXPECTED.set(key, mean);
  return mean;
}

/** Части противника по предложению: объявленное число машин × средняя машина. */
export function contractParts(contract: Contract): PowerParts {
  const units = opforCount(contract);
  const m = expectedOpforMech(contract);
  return { fire: m.fire * units, hull: m.hull * units };
}

/** Сила стороны в условных средних машинах. */
export function strengthOf(parts: PowerParts): number {
  return rawStrength(parts) / CONTRACTS.opfor.power.reference;
}

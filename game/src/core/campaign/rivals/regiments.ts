import { NAMES } from '../../data/index.js';
import { FAST, fastResolve } from '../bridge/fastResolve.js';
import type { BattleBrief } from '../bridge/toBattle.js';
import { buildForce } from '../contracts/opfor.js';
import { factionKind } from '../contracts/relations.js';
import { opforTypeOf, supplyLevel } from '../contracts/supply.js';
import { GALAXY } from '../galaxy/catalog.js';
import { ownerOf, type GalaxyDeltas } from '../galaxy/delta.js';
import { worldProfile } from '../galaxy/profile.js';
import type { Rng } from '../../rng/index.js';
import { battleRounds } from '../war/battle.js';
import { WAR } from '../war/schema.js';
import { CONTRACTS } from '../contracts/schema.js';
import type { ReputationState } from '../reputation/state.js';
import {
  frontSectors,
  fundOf,
  isPlayerActor,
  tensionOf,
  withCompanyEffort,
  withFund,
  type FrontSector,
  type WarState,
} from '../war/index.js';
import { economyOf } from '../war/economy.js';
import { PLAYER_ACTOR_ID } from '../war/actors.js';
import { hireEndOf, hireStation, type HireEnd } from './hire.js';
import { RIVALS } from './schema.js';
import type { Regiment } from './types.js';

/**
 * Полковые подряды (шаг 22c).
 *
 * **Зачем полки вообще ходят.** До этого шага семь великих полков стояли в
 * таблице неподвижными строками: канон, посчитанный из состава, и ничего
 * больше. Строка, которая за десять лет кампании не сдвинулась ни разу, — это
 * та же декорация, от которой шаг 22 избавлялся, только красивая. Теперь полк
 * берёт подряд, дерётся и несёт потери, и верх реестра гуляет.
 *
 * **Чем он дерётся — тем же, чем все.** Состав собирает `buildForce`, бой
 * считает `fastResolve`, потолок раундов масштабируется по размеру сил
 * (`war/battle.ts`). Ни строки боевых правил, написанной для полка отдельно;
 * отличие ровно одно и оно ЧИСЛО — машин у него сотни.
 *
 * **Полк не разоряется, он редеет.** Из реестра MRBC не выбывают: Волчьи
 * Драгуны после разгрома на Мизери остались Волчьими Драгунами. Ниже `minShare`
 * канонического состава полк не падает и отстраивается `rebuildPerTick` в
 * декаду — годами, но верно. Это и ответ на «через сто декад останется три
 * отряда»: у полков убыли нет вовсе, а у ротных отрядов её возмещает
 * формирование новых.
 */

const R = RIVALS.regiment;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Сила полка в тех же условных машинах, что и рейтинг роты (`rivals/registry.ts`). */
export function regimentRating(r: Regiment): number {
  const q = CONTRACTS.opfor.threatByQuality[r.quality];
  return Math.round(r.mechs * q * (r.tons / 55) * (r.skill / 4) * 10) / 10;
}

export interface CommissionReport {
  readonly regimentId: string;
  readonly regimentName: string;
  readonly systemId: string;
  readonly employer: string;
  readonly target: string;
  readonly won: boolean;
  readonly size: number;
  readonly lost: number;
  readonly enemyLost: number;
}

/** Полк перешёл к новому нанимателю (шаг 82). */
export interface RegimentMoveReport {
  readonly regimentId: string;
  readonly regimentName: string;
  readonly from: string;
  readonly to: string;
  /** Владелец мира, куда полк пришёл, — его новый наниматель. */
  readonly employer: string;
}

/** Найм державой кончился (шаг 89): срок, мир с врагом или потеря мира стоянки. */
export interface RegimentHireEndReport {
  readonly regimentId: string;
  readonly regimentName: string;
  readonly against: string;
  readonly how: HireEnd;
}

export interface RegimentTickResult {
  readonly regiments: readonly Regiment[];
  readonly war: WarState;
  readonly commissions: readonly CommissionReport[];
  readonly moves: readonly RegimentMoveReport[];
  readonly hireEnds: readonly RegimentHireEndReport[];
}

/** Сид подряда. Из мира и дня, как у боя фронта: операция полка — событие МИРА. */
function commissionSeed(worldSeed: number, id: string, day: number): number {
  let h = (worldSeed >>> 0) ^ 0x6d2b79f5;
  const text = `${id}|${day}|commission`;
  for (let i = 0; i < text.length; i++) {
    h = Math.imul(h ^ text.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Кто нанимает великий полк (шаг 82): Дома, Периферия и КомСтар. Наёмники (мир Драгун),
 * кланы, пираты и независимые — нет, держава роты — тоже: её фондом без неё не
 * распоряжаются.
 */
const EMPLOYER_KINDS: ReadonlySet<string> = new Set(['house', 'periphery', 'comstar']);

function hires(owner: string): boolean {
  return !isPlayerActor(owner) && EMPLOYER_KINDS.has(factionKind(owner) ?? '');
}

/** Прыжков от системы до каждой системы каталога; недостижимые — −1. */
function jumpsFrom(start: number): Int16Array {
  const depth = new Int16Array(GALAXY.count).fill(-1);
  depth[start] = 0;
  let frontier = [start];
  for (let d = 1; frontier.length > 0; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      for (const j of GALAXY.neighbors(i)) {
        if (depth[j] !== -1) continue;
        depth[j] = d;
        next.push(j);
      }
    }
    frontier = next;
  }
  return depth;
}

/**
 * Фронт на этот такт: участки по миру, на который давят. Считается один раз на такт и
 * только если хоть одному полку он понадобился — тем же `frontSectors`, что и такт
 * фронта, без второго определения «где война».
 */
class FrontIndex {
  private byWorld: Map<number, FrontSector[]> | null = null;
  constructor(
    private readonly war: WarState,
    private readonly rep: ReputationState,
    private readonly deltas: GalaxyDeltas,
    private readonly day: number,
  ) {}

  /** Участки державы роты (шаг 89) — их берёт только нанятый ею полк. */
  private realmByWorld: Map<number, FrontSector[]> | null = null;

  at(i: number): readonly FrontSector[] {
    this.build();
    return (this.byWorld as Map<number, FrontSector[]>).get(i) ?? [];
  }

  realmAt(i: number): readonly FrontSector[] {
    this.build();
    return (this.realmByWorld as Map<number, FrontSector[]>).get(i) ?? [];
  }

  private build(): void {
    if (this.byWorld !== null) return;
    this.byWorld = new Map();
    this.realmByWorld = new Map();
    for (const s of frontSectors(this.war, this.rep, this.deltas, this.day)) {
      const map = isPlayerActor(s.attacker) || isPlayerActor(s.defender) ? this.realmByWorld : this.byWorld;
      const list = map.get(s.system);
      if (list === undefined) map.set(s.system, [s]);
      else list.push(s);
    }
  }
}

/** Есть ли у полка в досягаемости участок державы против врага найма (шаг 89). */
function realmFoeInReach(against: string, depth: Int16Array, front: FrontIndex): boolean {
  for (let i = 0; i < depth.length; i++) {
    const d = depth[i] as number;
    if (d < 0 || d > R.moveJumps) continue;
    for (const s of front.realmAt(i)) if (s.attacker === against || s.defender === against) return true;
  }
  return false;
}

/**
 * Против кого полк может работать на нанимателя: живые враги, у которых с нанимателем
 * есть участок фронта в досягаемости полка (`moveJumps`) — в любую сторону. Нет такого
 * — подряда нет. Отсортировано по id: выбор цели обязан быть воспроизводим.
 */
function foesInReach(employer: string, depth: Int16Array, front: FrontIndex): string[] {
  const foes = new Set<string>();
  for (let i = 0; i < depth.length; i++) {
    const d = depth[i] as number;
    if (d < 0 || d > R.moveJumps) continue;
    for (const s of front.at(i)) {
      if (s.defender === employer) foes.add(s.attacker);
      else if (s.attacker === employer) foes.add(s.defender);
    }
  }
  return [...foes].sort();
}

/**
 * Куда полку перейти: мир у фронта, чей владелец нанимает.
 *
 * Вес мира — та же надбавка за напряжённость участка, что у гонорара биржи
 * (`contracts.json` → `payout.tensionBonus`), по которой ротные отряды выбирают, куда
 * лететь (`tick.ts::pickMove`): горячий участок платит больше. На первый день фронт
 * холодный всюду, и вес — единица: полк идёт к ближайшему фронту. Дальше вес затухает
 * с прыжками, у Дома, которому полк верен, умножается на `loyaltyWeight`. Кандидаты — в
 * пределах `moveJumps`; нет там ни одного — вся карта, чтобы полк не простаивал у
 * заглохшей границы.
 */
function pickRegimentMove(
  r: Regiment,
  depth: Int16Array,
  war: WarState,
  rep: ReputationState,
  deltas: GalaxyDeltas,
  front: FrontIndex,
  rng: Rng,
): number | null {
  const loyalTo = RIVALS.registry.find((u) => u.id === r.id)?.great?.loyalTo;
  const bonus = CONTRACTS.payout.tensionBonus;
  const near: { i: number; w: number }[] = [];
  const far: { i: number; w: number }[] = [];
  for (let i = 0; i < depth.length; i++) {
    const d = depth[i] as number;
    if (d <= 0) continue;
    const owner = ownerOf(deltas, i);
    if (!hires(owner)) continue;
    let tension = -1;
    for (const s of front.at(i)) {
      if (s.defender !== owner) continue;
      tension = Math.max(tension, tensionOf(war, rep, owner, s.attacker, 1));
    }
    if (tension < 0) continue;
    const w = ((1 + bonus * tension) * (owner === loyalTo ? R.loyaltyWeight : 1)) / (1 + d / R.moveFalloffJumps);
    (d <= R.moveJumps ? near : far).push({ i, w });
  }
  const pool = near.length > 0 ? near : far;
  if (pool.length === 0) return null;
  let total = 0;
  for (const c of pool) total += c.w;
  let roll = rng.next() * total;
  for (const c of pool) {
    roll -= c.w;
    if (roll <= 0) return c.i;
  }
  return (pool[pool.length - 1] as { i: number }).i;
}

/**
 * Один такт всех полков.
 *
 * Наниматель — владелец системы, где полк стоит; цель — живой враг нанимателя с участком
 * фронта в досягаемости полка (шаг 82; до него — случайный враг по таблице 3053 года, и
 * Марик слал Эриданцев на Новых Котов). Выигранный подряд кладёт нанимателю в военный фонд
 * против цели — ровно тем же швом, что и выигранный контракт роты
 * (`war/front.ts::withCompanyEffort`). Полк войну не выигрывает, но двигает.
 *
 * Полк без подряда с шансом `moveChance` уходит к другому фронту; с мира, где работы нет
 * или который захвачен, — сразу (шаг 82).
 */
export function regimentTick(
  regiments: readonly Regiment[],
  war: WarState,
  rep: ReputationState,
  deltas: GalaxyDeltas,
  worldSeed: number,
  day: number,
  rng: Rng,
): RegimentTickResult {
  const out: Regiment[] = [];
  const commissions: CommissionReport[] = [];
  const moves: RegimentMoveReport[] = [];
  const hireEnds: RegimentHireEndReport[] = [];
  const front = new FrontIndex(war, rep, deltas, day);
  let nextWar = war;

  for (const start of regiments) {
    let r: Regiment = { ...start, ratingBefore: regimentRating(start) };

    // ВОССТАНОВЛЕНИЕ идёт двумя путями, и это ровно то звено круга, которого не
    // хватало: своими силами (ремонт, пополнение из резерва) — медленно и
    // бесплатно; и ЗАКУПКОЙ на гонорары — быстро и за деньги. Без второго пути
    // полк перемалывался, сколько бы ни выигрывал.
    if (r.mechs < r.fullMechs) {
      const own = Math.max(1, Math.round(r.fullMechs * R.rebuildPerTick));
      let mechs = Math.min(r.fullMechs, r.mechs + own);
      let cbills = r.cbills;
      const budget = Math.max(0, cbills) * R.repairShare;
      const bought = Math.min(Math.floor(budget / R.mechCost), r.fullMechs - mechs);
      if (bought > 0) {
        mechs += bought;
        cbills -= bought * R.mechCost;
      }
      r = { ...r, mechs, cbills: Math.round(cbills) };
    }

    // НАЁМ ДЕРЖАВОЙ (шаг 89). Кончился — поле снимается, и полк в эту же декаду живёт по общим правилам: держава
    // его не нанимает (`hires`), и он уходит к фронту. Идёт — своя ветка: цель только враг найма, без перелёта.
    if (r.hire !== undefined) {
      const how = hireEndOf(r, nextWar, deltas, day);
      if (how === undefined) {
        const hired = hiredStep(r, nextWar, deltas, worldSeed, day, front, rng);
        r = hired.regiment;
        nextWar = hired.war;
        if (hired.move !== undefined) moves.push(hired.move);
        if (hired.commission !== undefined) commissions.push(hired.commission);
        out.push(r);
        continue;
      }
      hireEnds.push({ regimentId: r.id, regimentName: r.name, against: r.hire.against, how });
      const { hire: _ended, ...free } = r;
      r = free;
    }

    const i = GALAXY.require(r.systemId);
    const employer = ownerOf(deltas, i);
    const depth = jumpsFrom(i);
    // Мир захвачен — владелец не тот, к кому полк нанимался, — или его владелец не
    // нанимает, или врага в досягаемости нет: полк уходит в эту же декаду, без броска.
    const captured = r.employer !== employer;
    const foes = captured || !hires(employer) ? [] : foesInReach(employer, depth, front);
    const idle = foes.length === 0;
    if (idle || rng.next() >= R.commissionChance) {
      if (idle || rng.next() < R.moveChance) {
        const to = pickRegimentMove(r, depth, war, rep, deltas, front, rng);
        if (to !== null) {
          const toId = GALAXY.id(to);
          const toOwner = ownerOf(deltas, to);
          moves.push({ regimentId: r.id, regimentName: r.name, from: r.systemId, to: toId, employer: toOwner });
          r = { ...r, systemId: toId, employer: toOwner };
        }
      }
      out.push(r);
      continue;
    }
    const target = foes[rng.int(0, foes.length - 1)] as string;
    const battle = fight(r, employer, target, i, nextWar, deltas, worldSeed, day, rng);

    // ГОНОРАР. Наниматель платит из военного фонда против цели — из того же
    // кошелька, из которого он оплачивает собственные наступления
    // (`war/front.ts::spend`). Полк ему обходится дорого, и это правда: полк и
    // есть самое дорогое, что можно нанять. Провал платят вполовину: отряд
    // отработал, но задачу не решил.
    const fund = fundOf(nextWar, employer, target);
    const paid = Math.min(battle.fee, fund);
    if (paid > 0) nextWar = withFund(nextWar, employer, target, fund - paid);

    r = settle(r, battle, paid);
    if (battle.won) nextWar = withCompanyEffort(nextWar, employer, target, paid);
    commissions.push(battle.report(r));
    out.push(r);
  }

  return { regiments: out, war: nextWar, commissions, moves, hireEnds };
}

interface Battle {
  readonly deployed: number;
  readonly won: boolean;
  readonly ourLost: number;
  /** Гонорар по правилу фракций: машины вывода × ставка, провал — вполовину. */
  readonly fee: number;
  readonly report: (r: Regiment) => CommissionReport;
}

/**
 * Бой подряда: вывод, противник, авторасчёт. Один код для подряда фракции и подряда державы (шаг 89); броски —
 * в том же порядке, что до шага: доля вывода, затем доля противника.
 */
function fight(
  r: Regiment,
  employer: string,
  target: string,
  i: number,
  war: WarState,
  deltas: GalaxyDeltas,
  worldSeed: number,
  day: number,
  rng: Rng,
): Battle {
  const profile = worldProfile(worldSeed, deltas, i);
  const seed = commissionSeed(worldSeed, r.id, day);
  const ourSupply = supplyLevel(war, employer, profile, 0);
  const foeSupply = supplyLevel(war, target, profile, 0);

  // Полк выходит НЕ ЦЕЛИКОМ: на подряд идёт батальон, остальное держит базу и
  // чинится. Первая версия 22c выводила весь состав, и полк перемалывался за
  // полгода — замер показал Драгун, сточившихся с 540 машин до 83.
  const [dLo, dHi] = R.deployShare;
  const deployed = Math.max(4, Math.round(r.mechs * (dLo + rng.next() * (dHi - dLo))));

  // Противостоящая часть соразмерна ВЫВЕДЕННОМУ, а не всему полку: подряд
  // такого уровня выдают против равного, а не против гарнизонного взвода.
  // Против клана — вдвое меньше (шаг 82): клановая Звезда стоит двух сферных копий, и
  // подряд такого уровня берут при перевесе 1 к 2, а не на равных числом.
  const [lo, hi] = R.opposingShare;
  const clanShare = factionKind(target) === 'clan' ? R.clanOpposingShare : 1;
  const foeSize = Math.max(1, Math.round(deployed * (lo + rng.next() * (hi - lo)) * clanShare));

  const ours = buildForce(
    {
      count: deployed,
      factionId: employer,
      biome: profile.biome,
      opforType: opforTypeOf(employer, profile.garrison, ourSupply),
      techBase: factionKind(employer) === 'clan' ? 'clan' : 'is',
      supply: ourSupply,
      tonnageCap: 100,
      idPrefix: `RG-${seed}`,
      callsign: NAMES.defaults.regimentCallsign,
    },
    seed,
  );
  const theirs = buildForce(
    {
      count: foeSize,
      factionId: target,
      biome: profile.biome,
      opforType: opforTypeOf(target, profile.garrison, foeSupply),
      techBase: factionKind(target) === 'clan' ? 'clan' : 'is',
      supply: foeSupply,
      tonnageCap: 100,
      idPrefix: `RF-${seed}`,
      callsign: NAMES.defaults.regimentFoeCallsign,
    },
    (seed ^ 0x27d4eb2f) >>> 0,
  );

  const brief: BattleBrief = {
    mapSeed: seed,
    battleSeed: seed,
    map: { biome: profile.biome },
    company: ours,
    enemy: theirs,
    // Подряд кончается переломом противника, а не его истреблением, — той же
    // задачей `cripple`, что и сражение фронта (`war/battle.ts`). Без неё полк
    // выигрывал и всё равно сходил на нет.
    objective: { kind: 'cripple', share: WAR.front.breakShare },
  };
  const outcome = fastResolve(brief, { ...FAST, rounds: battleRounds(deployed + foeSize) });
  const lost = (side: 'player' | 'opfor'): number =>
    outcome.units.filter((u) => u.side === side && u.unit.destroyed).length;
  const ourLost = lost('player');
  const enemyLost = lost('opfor');
  const won = outcome.winner === 'player';
  return {
    deployed,
    won,
    ourLost,
    fee: Math.round(deployed * R.feePerMech * (won ? 1 : 0.5)),
    report: (after) => ({
      regimentId: after.id,
      regimentName: after.name,
      systemId: after.systemId,
      employer,
      target,
      won,
      size: deployed,
      lost: ourLost,
      enemyLost,
    }),
  };
}

/** Состав, касса и счёт полка после подряда. */
function settle(r: Regiment, battle: Battle, paid: number): Regiment {
  const floor = Math.max(1, Math.round(r.fullMechs * R.minShare));
  return {
    ...r,
    mechs: Math.max(floor, r.mechs - battle.ourLost),
    cbills: r.cbills + paid,
    contracts: r.contracts + 1,
    wins: r.wins + (battle.won ? 1 : 0),
  };
}

/**
 * Декада полка, нанятого державой (шаг 89). Участка против врага найма в досягаемости нет — полк без броска
 * переходит на мир державы, ближайший к врагу (`hire.ts::hireStation`). Есть — подряд с тем же шансом, что у
 * фракций, только против врага найма. Гонорара нет (оплачен наймом); выигранный подряд кладёт державе в фонд
 * против врага гонорар × `companyShare`, но фонд после вклада не выше `fundCapTicks` тактов её дохода.
 */
function hiredStep(
  start: Regiment,
  war: WarState,
  deltas: GalaxyDeltas,
  worldSeed: number,
  day: number,
  front: FrontIndex,
  rng: Rng,
): { regiment: Regiment; war: WarState; move?: RegimentMoveReport; commission?: CommissionReport } {
  const against = (start.hire as NonNullable<Regiment['hire']>).against;
  const i = GALAXY.require(start.systemId);
  if (!realmFoeInReach(against, jumpsFrom(i), front)) {
    const to = hireStation(deltas, against);
    if (to === null || to === i) return { regiment: start, war };
    const toId = GALAXY.id(to);
    return {
      regiment: { ...start, systemId: toId },
      war,
      move: { regimentId: start.id, regimentName: start.name, from: start.systemId, to: toId, employer: PLAYER_ACTOR_ID },
    };
  }
  if (rng.next() >= R.commissionChance) return { regiment: start, war };

  const battle = fight(start, PLAYER_ACTOR_ID, against, i, war, deltas, worldSeed, day, rng);
  const r = settle(start, battle, 0);
  let next = war;
  if (battle.won) {
    const fund = fundOf(next, PLAYER_ACTOR_ID, against);
    const cap = R.hire.fundCapTicks * Math.max(0, economyOf(next, PLAYER_ACTOR_ID).income);
    const add = Math.min(battle.fee * WAR.front.companyShare, Math.max(0, cap - fund));
    if (add > 0) next = withFund(next, PLAYER_ACTOR_ID, against, fund + add);
  }
  return { regiment: r, war: next, commission: battle.report(r) };
}

/** Полк, разбитый до предела, — читается в таблице отдельной пометкой. */
export function isShattered(r: Regiment): boolean {
  return r.mechs < r.fullMechs * clamp(R.minShare * 2, 0, 1);
}

import {
  CampaignState,
  FACTIONS,
  FACTION_LIST,
  GALAXY,
  WAR,
  economyOf,
  economyTick,
  frontSectors,
  frontTick,
  frontWeights,
  fundsOf,
  makeWarState,
  prosperityBand,
  prosperityOf,
  tensionOf,
  tributeFlows,
  ownerOf,
  type GalaxyDeltas,
  type ReputationState,
  type WarState,
} from '../src/core/campaign/index.js';
import { Rng } from '../src/core/rng/index.js';

/**
 * Калибровка фронта (шаг 21b) — `pnpm frontstat`.
 *
 * Отвечает на четыре вопроса, которые план шага требует замерить, и делает это
 * БЕЗ боёв: тикер войны не зависит от того, чем занята рота, поэтому гонять
 * ради него батч кампаний значило бы ждать три минуты вместо секунды.
 *
 * 1. Сколько миров меняет владельца за такт и за кампанию (коридор решения 4 —
 *    1–3 за такт).
 * 2. Не перекраивается ли Сфера: кто сколько приобрёл и потерял за десять лет.
 * 3. Держатся ли фонды в берегах — то есть не убегает ли `push` за кампанию.
 * 4. Доросла ли напряжённость до величины, которую биржа вообще заметит.
 *
 * Ключи: `--seeds 1..20` (сиды мира), `--ticks 28` (тактов на сид, 28 — кампания
 * в 20 контрактов), `--years` печатает срез по годам вместо сводки.
 */

interface Args {
  readonly seeds: readonly number[];
  readonly ticks: number;
  readonly years: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  let seeds = '1..20';
  let ticks = 28;
  let years = false;
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (key === '--years') {
      years = true;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined) continue;
    if (key === '--seeds') {
      seeds = value;
      i++;
    } else if (key === '--ticks') {
      ticks = Number(value);
      i++;
    }
  }
  const m = /^(\d+)\.\.(\d+)$/.exec(seeds);
  const list = m === null ? [Number(seeds)] : range(Number(m[1]), Number(m[2]));
  return { seeds: list, ticks, years };
}

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** Один сид мира, прокрученный `ticks` декад без единого боя. */
interface Run {
  readonly moves: number;
  readonly raids: number;
  readonly changed: ReadonlySet<string>;
  readonly ruinedWorlds: number;
  readonly ruinTotal: number;
  readonly war: WarState;
  readonly deltas: GalaxyDeltas;
  /** Репутационное состояние на конец прогона: его читают замеры напряжённости. */
  readonly rep: ReputationState;
  readonly movesPerTick: readonly number[];
}

function run(seed: number, ticks: number): Run {
  const state = new CampaignState(seed);
  let war = state.war;
  let deltas = state.deltas;
  // Матрица отношений едет вместе с миром (шаг 26): живая вражда решает, где
  // участок фронта, и прогон, оставивший её на старте, мерил бы другой мир.
  let rep = state.reputation;
  const rng = new Rng(seed ^ 0x7f4a7c15);

  let moves = 0;
  let raids = 0;
  const changed = new Set<string>();
  const movesPerTick: number[] = [];

  for (let tick = 1; tick <= ticks; tick++) {
    const day = tick * WAR.economy.tickDays;
    war = economyTick(
      war,
      rep,
      frontWeights(frontSectors(war, rep, deltas, day)),
      tributeFlows(war, state.worldSeed, deltas, day),
    );
    const result = frontTick(war, deltas, rep, state.worldSeed, day, rng);
    war = result.war;
    deltas = result.deltas;
    rep = result.reputation;
    movesPerTick.push(result.moves.length);
    for (const m of result.moves) {
      moves++;
      if (m.kind === 'raid') raids++;
      else changed.add(m.systemId);
    }
  }

  let ruinedWorlds = 0;
  let ruinTotal = 0;
  for (const id of Object.keys(deltas)) {
    const r = deltas[id]?.ruined ?? 0;
    if (r > 0) {
      ruinedWorlds++;
      ruinTotal += r;
    }
  }
  return { moves, raids, changed, ruinedWorlds, ruinTotal, war, deltas, rep, movesPerTick };
}

function mean(xs: readonly number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

const args = parseArgs(process.argv.slice(2));
const runs = args.seeds.map((s) => run(s, args.ticks));

console.log(`фронт: ${args.seeds.length} сидов × ${args.ticks} тактов (${args.ticks * 10} суток)\n`);
console.log(`  событий за такт          ${mean(runs.flatMap((r) => r.movesPerTick)).toFixed(2)}`);
console.log(`  захватов за прогон       ${mean(runs.map((r) => r.moves - r.raids)).toFixed(1)}`);
console.log(`  набегов за прогон        ${mean(runs.map((r) => r.raids)).toFixed(1)}`);
console.log(`  разных миров сменило флаг ${mean(runs.map((r) => r.changed.size)).toFixed(1)}`);
console.log(`  разорённых миров к концу ${mean(runs.map((r) => r.ruinedWorlds)).toFixed(1)}`);
console.log(
  `  среднее разорение         ${(mean(runs.map((r) => (r.ruinedWorlds === 0 ? 0 : r.ruinTotal / r.ruinedWorlds))) || 0).toFixed(3)}`,
);
console.log(`  дельт в снимке к концу   ${mean(runs.map((r) => Object.keys(r.deltas).length)).toFixed(1)}`);

// Кто приобрёл и кто потерял. Мера — миры, а не проценты: «Курита взял четыре
// мира за три года» читается, а «Курита вырос на 1.4 %» нет.
const first = runs[0] as Run;
const start = new CampaignState(args.seeds[0] as number).war;
console.log('\nпо фракциям (первый сид):');
const rows = FACTION_LIST.map((f) => ({
  id: f.id,
  kind: FACTIONS.get(f.id)?.kind ?? '',
  was: economyOf(start, f.id).worlds,
  now: economyOf(first.war, f.id).worlds,
  prosperity: prosperityOf(first.war, f.id),
}))
  .map((r) => ({ ...r, delta: r.now - r.was }))
  .sort((a, b) => b.delta - a.delta);
for (const r of rows) {
  if (r.delta === 0) continue;
  console.log(
    `  ${r.id.padEnd(14)} ${String(r.was).padStart(4)} → ${String(r.now).padStart(4)} ` +
      `(${r.delta > 0 ? '+' : ''}${r.delta})  достаток ${r.prosperity.toFixed(2)} ${prosperityBand(r.prosperity)}`,
  );
}

// Фонды и напряжённость: доросли ли они до величины, которую биржа заметит.
console.log('\nвоенные фонды (первый сид, крупнейшие направления):');
for (const f of FACTION_LIST) {
  const top = fundsOf(first.war, f.id).slice(0, 2);
  if (top.length === 0) continue;
  console.log(
    `  ${f.id.padEnd(14)} ` +
      top
        .map((r) => `${r.against}:${(r.amount / Math.max(1, economyOf(first.war, f.id).income)).toFixed(1)} тактов`)
        .join('  '),
  );
}

// Напряжённость на приграничных участках: медиана и верх.
const owners = Array.from({ length: GALAXY.count }, (_, i) => ownerOf(first.deltas, i));
const tensions: number[] = [];
for (const s of frontSectors(first.war, first.rep, first.deltas, args.ticks * 10, owners)) {
  tensions.push(tensionOf(first.war, first.rep, s.attacker, s.defender, 1));
}
tensions.sort((a, b) => a - b);
console.log(
  `\nнапряжённость участков: медиана ${(tensions[Math.floor(tensions.length / 2)] ?? 0).toFixed(3)}, ` +
    `верх ${(tensions[tensions.length - 1] ?? 0).toFixed(3)}, участков ${tensions.length}`,
);

// Приращение против полного пересчёта: сумма обязана сойтись побайтово, иначе
// экономика фракций тихо разъедется с картой за десяток тактов.
const rebuilt = makeWarState(new CampaignState(args.seeds[0] as number).worldSeed, first.deltas);
let drift = 0;
for (const f of FACTION_LIST) {
  const a = economyOf(first.war, f.id);
  const b = economyOf(rebuilt, f.id);
  drift += Math.abs(a.income - b.income) + Math.abs(a.upkeep - b.upkeep) + Math.abs(a.worlds - b.worlds);
}
console.log(`\nрасхождение приращения с полным пересчётом: ${drift} (обязано быть 0)`);

if (args.years) {
  console.log('\nпо годам (первый сид):');
  let acc = 0;
  first.movesPerTick.forEach((n, i) => {
    acc += n;
    if ((i + 1) % 36 === 0) console.log(`  год ${3053 + (i + 1) / 36}: событий всего ${acc}`);
  });
}

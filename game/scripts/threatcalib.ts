/**
 * Проверка оценки сил (шаг 68): какая формула лучше предсказывает исход боя.
 *
 * Вопрос прогона: **насколько число «наши / их», которое игрок видит до
 * подписи, связано с тем, чем кончается бой.** Сравниваются три отношения на
 * одной выборке:
 *
 * - `tonnage` — прежняя оценка (`lanceThreat / contractThreat`);
 * - `power` — огонь и живучесть (`contracts/power.ts`) против ОЖИДАНИЯ по
 *   предложению: ровно то, что можно знать до вылета;
 * - `power·факт` — та же формула против настоящего состава противника: потолок
 *   того, что даёт формула, если бы противник был известен точно. Разница
 *   между двумя последними — цена неизвестности (шаг 57), а не формулы.
 *
 * **Выборка.** Брифинги — из настоящего хода кампании (`runCampaign`, крючок
 * `onBrief`), как у `fastcalib`: побитые машины, раненые пилоты, трофеи в строю.
 * Бот берёт только посильную работу, поэтому отношения сил в его брифингах
 * лежат узкой полосой; чтобы увидеть всю кривую, каждый брифинг разыгрывается
 * ещё и урезанными звеньями — от одной самой тяжёлой машины до полного.
 * Это заодно и вопрос шага 67: сколько машин выводить.
 *
 * **Исход.** Быстрый расчёт (`fastResolve`) по `--reps` сидов на вариант — он
 * дешёвый и под лимит не идёт. Полный бой — по одному на вариант, не больше
 * `--full` (лимит проекта 1400, CLAUDE.md): только он видит дальность, и
 * только он честно проверяет ту часть формулы, что про неё.
 *
 * **Мера качества** — логистическая кривая P(победа) от ln(отношения) и её
 * логарифмическая потеря (меньше — лучше) плюс AUC (0.5 — угадывание,
 * 1 — безошибочно). Отдельно печатается, при каком отношении кривая даёт 50,
 * 85 и 90 % побед — это норма, от которой считается плата за высадку.
 *
 * Запуск:
 *   pnpm threatcalib                         200 брифингов, быстрый расчёт
 *   pnpm threatcalib --full 1200             плюс до 1200 полных боёв
 *   pnpm threatcalib --briefs 300 --reps 8   шире выборка
 */
import {
  contractParts,
  contractTonnageThreat,
  contractSimpleThreat,
  fastResolve,
  lanceTonnageThreat,
  lanceSimpleThreat,
  makeBattleFromBrief,
  mechPower,
  recordChassisDef,
  recordQuality,
  strengthOf,
  type BattleBrief,
  type BattleParticipant,
  type Contract,
  type PowerParts,
} from '../src/core/campaign/index.js';
import { pilotGunneryBase } from '../src/core/rules/skills.js';
import { FAST_FIDELITY, runCampaign } from '../src/sim/campaign/batch.js';
import type { ManagerPolicy } from '../src/sim/campaign/manager.js';
import { runOn } from '../src/sim/autoBattle.js';

const args = process.argv.slice(2);
const num = (flag: string, fallback: number): number => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : fallback;
};

const wantBriefs = num('--briefs', 200);
const reps = num('--reps', 6);
const fullCap = num('--full', 0);
const from = num('--from', 1);
const contracts = num('--contracts', 20);

const MAX_FULL_BATTLES = 1400;
if (fullCap > MAX_FULL_BATTLES) {
  throw new Error(`--full ${fullCap} — больше лимита ${MAX_FULL_BATTLES} полных боёв (CLAUDE.md)`);
}

/** Та же политика, что у `fastcalib`: другая дала бы другую выборку боёв. */
const POLICY: ManagerPolicy = {
  repairThreshold: 0,
  fleetCap: 6,
  supplyThreshold: 600_000,
  supplyJumps: 3,
  // 0.58 — умолчание `pnpm camp` с шага 68 (оценка по огню и живучести).
  contractOdds: 0.58,
  loyaltyThreshold: 25,
};

interface Pair {
  readonly brief: BattleBrief;
  readonly contract: Contract;
}

function collect(count: number): Pair[] {
  const out: Pair[] = [];
  for (let seed = from; out.length < count && seed <= from + count; seed++) {
    runCampaign(seed, contracts, POLICY, {
      resolve: FAST_FIDELITY,
      onBrief: (brief, contract) => {
        if (out.length < count) out.push({ brief, contract });
      },
    });
  }
  return out;
}

type Tuning = { readonly fieldToHit: number; readonly ranges: readonly number[] };

function partsOf(side: readonly BattleParticipant[], tuning?: Tuning): PowerParts {
  let fire = 0;
  let hull = 0;
  for (const p of side) {
    const m = mechPower(p.record, pilotGunneryBase(p.pilot), tuning);
    fire += m.fire;
    hull += m.hull;
  }
  return { fire, hull };
}

interface Variant {
  readonly old: number;
  readonly power: number;
  readonly powerActual: number;
  /** Простая оценка — то, что видит игрок (`lanceSimpleThreat / contractSimpleThreat`). */
  readonly weight: number;
  /** Ожидаемая машина × НАСТОЯЩЕЕ число машин: отделяет ошибку числа (разведка) от ошибки средней машины. */
  readonly powerCount: number;
  /** Доля побед быстрого расчёта по `reps` сидам. */
  readonly fastWin: number;
  /** Полный бой: 1 победа, 0 нет, null — не разыгрывался. */
  full: number | null;
  readonly brief: BattleBrief;
  /**
   * Перекос по классу (случай §10t): в звене клановая машина, машина армейского
   * класса и выше или стрелок с базой 3 и лучше. Прежняя оценка видит из этого
   * только класс узлов и не видит ни техбазы, ни пилота.
   */
  readonly skewed: boolean;
}

const t0 = Date.now();
const pairs = collect(wantBriefs);
const tCollect = Date.now() - t0;

const variants: Variant[] = [];
const t1 = Date.now();
for (const { brief, contract } of pairs) {
  const sorted = [...brief.company].sort(
    (a, b) => recordChassisDef(b.record).tons - recordChassisDef(a.record).tons,
  );
  const theirsOld = contractTonnageThreat(contract);
  const theirsExp = strengthOf(contractParts(contract));
  const theirsAct = strengthOf(partsOf(brief.enemy));
  const exp = contractParts(contract);
  const perUnit = brief.enemy.length / Math.max(1, contract.opforUnits);
  const theirsCount = strengthOf({ fire: exp.fire * perUnit, hull: exp.hull * perUnit });
  for (let k = 1; k <= sorted.length; k++) {
    const sub = sorted.slice(0, k);
    const ours = strengthOf(partsOf(sub));
    const b: BattleBrief = { ...brief, company: sub };
    let wins = 0;
    for (let r = 0; r < reps; r++) {
      const o = fastResolve({ ...b, battleSeed: (brief.battleSeed + r * 7919) >>> 0 });
      if (o.winner === 'player') wins++;
    }
    variants.push({
      old: lanceTonnageThreat(sub.map((p) => p.record)) / theirsOld,
      power: ours / theirsExp,
      powerActual: ours / theirsAct,
      weight: lanceSimpleThreat(sub.map((p) => p.record)) / contractSimpleThreat(contract),
      powerCount: ours / theirsCount,
      fastWin: wins / reps,
      full: null,
      brief: b,
      skewed: sub.some(
        (p) =>
          recordChassisDef(p.record).techBase === 'clan' ||
          pilotGunneryBase(p.pilot) <= 3 ||
          recordQuality(p.record).reactor === 'military' ||
          recordQuality(p.record).reactor === 'master',
      ),
    });
  }
}
const tFast = Date.now() - t1;

// Полные бои — равномерной выборкой по вариантам, чтобы не уйти в одни
// крупные брифинги: шаг по списку, а не первые N.
const t2 = Date.now();
if (fullCap > 0) {
  const step = Math.max(1, variants.length / fullCap);
  for (let i = 0; i < variants.length && i / step < fullCap; i += step) {
    const v = variants[Math.floor(i)];
    if (v === undefined) continue;
    const report = runOn(makeBattleFromBrief(v.brief), { seed: v.brief.battleSeed });
    v.full = report.winner === 'player' ? 1 : 0;
  }
}
const tFull = Date.now() - t2;

// --- мера качества ----------------------------------------------------------------

interface Point {
  readonly x: number;
  /** Доля побед 0..1 и её вес (число боёв). */
  readonly y: number;
  readonly w: number;
}

/** Логистическая регрессия y ~ σ(a + b·x) методом Ньютона, с весами. */
function fitLogistic(pts: readonly Point[]): { a: number; b: number } {
  let a = 0;
  let b = 1;
  for (let it = 0; it < 50; it++) {
    let ga = 0, gb = 0, haa = 0, hab = 0, hbb = 0;
    for (const p of pts) {
      const z = a + b * p.x;
      const s = 1 / (1 + Math.exp(-z));
      const d = p.w * (p.y - s);
      const h = p.w * s * (1 - s);
      ga += d;
      gb += d * p.x;
      haa += h;
      hab += h * p.x;
      hbb += h * p.x * p.x;
    }
    const det = haa * hbb - hab * hab;
    if (Math.abs(det) < 1e-12) break;
    const da = (hbb * ga - hab * gb) / det;
    const db = (haa * gb - hab * ga) / det;
    a += da;
    b += db;
    if (Math.abs(da) + Math.abs(db) < 1e-9) break;
  }
  return { a, b };
}

function logLoss(pts: readonly Point[], f: { a: number; b: number }): number {
  let sum = 0;
  let w = 0;
  for (const p of pts) {
    const s = Math.min(1 - 1e-9, Math.max(1e-9, 1 / (1 + Math.exp(-(f.a + f.b * p.x)))));
    sum += -p.w * (p.y * Math.log(s) + (1 - p.y) * Math.log(1 - s));
    w += p.w;
  }
  return sum / w;
}

/** AUC по долям: вероятность, что случайная победа стоит правее случайного поражения. */
function auc(pts: readonly Point[]): number {
  const pos: { x: number; w: number }[] = [];
  const neg: { x: number; w: number }[] = [];
  for (const p of pts) {
    if (p.y > 0) pos.push({ x: p.x, w: p.w * p.y });
    if (p.y < 1) neg.push({ x: p.x, w: p.w * (1 - p.y) });
  }
  let num = 0;
  let den = 0;
  for (const a of pos) {
    for (const b of neg) {
      num += a.w * b.w * (a.x > b.x ? 1 : a.x === b.x ? 0.5 : 0);
      den += a.w * b.w;
    }
  }
  return den === 0 ? NaN : num / den;
}

/** Отношение, при котором кривая даёт долю побед `p`. */
function ratioAt(f: { a: number; b: number }, p: number): number {
  return Math.exp((Math.log(p / (1 - p)) - f.a) / f.b);
}

const lnr = (r: number): number => Math.log(Math.max(r, 0.01));

type Key = 'old' | 'weight' | 'power' | 'powerCount' | 'powerActual';
const KEYS: readonly { key: Key; name: string }[] = [
  { key: 'old', name: 'tonnage (прежняя)' },
  { key: 'weight', name: 'простая (экран)' },
  { key: 'power', name: 'power (ожидание)' },
  { key: 'powerCount', name: 'power·факт.число' },
  { key: 'powerActual', name: 'power·факт' },
];

function report(
  title: string,
  of: (v: Variant) => { y: number; w: number } | null,
  only: (v: Variant) => boolean = () => true,
): void {
  console.log(`\n=== ${title} ===`);
  console.log('формула              n     logloss  AUC    r@50%  r@85%  r@90%');
  for (const { key, name } of KEYS) {
    const pts: Point[] = [];
    for (const v of variants) {
      if (!only(v)) continue;
      const o = of(v);
      if (o !== null) pts.push({ x: lnr(v[key]), y: o.y, w: o.w });
    }
    if (pts.length < 10) {
      console.log(`${name.padEnd(20)} мало точек (${pts.length})`);
      continue;
    }
    const f = fitLogistic(pts);
    console.log(
      `${name.padEnd(20)} ${String(pts.length).padEnd(5)} ${logLoss(pts, f).toFixed(4)}  ` +
        `${auc(pts).toFixed(3)}  ${ratioAt(f, 0.5).toFixed(2).padEnd(5)}  ` +
        `${ratioAt(f, 0.85).toFixed(2).padEnd(5)}  ${ratioAt(f, 0.9).toFixed(2)}`,
    );
  }
}

/** Доля побед по полосам отношения — глазами, без модели. */
function bins(key: Key, of: (v: Variant) => { y: number; w: number } | null): void {
  const edges = [0, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 5, Infinity];
  const rows: string[] = [];
  for (let i = 0; i + 1 < edges.length; i++) {
    const lo = edges[i] ?? 0;
    const hi = edges[i + 1] ?? Infinity;
    let y = 0;
    let w = 0;
    for (const v of variants) {
      if (v[key] < lo || v[key] >= hi) continue;
      const o = of(v);
      if (o === null) continue;
      y += o.y * o.w;
      w += o.w;
    }
    if (w > 0) rows.push(`${lo}–${hi === Infinity ? '∞' : hi}: ${((100 * y) / w).toFixed(0)}% (${w})`);
  }
  console.log(`  ${key}: ${rows.join(' · ')}`);
}

console.log(
  `брифингов ${pairs.length}, вариантов звена ${variants.length}; ` +
    `сбор ${(tCollect / 1000).toFixed(1)} с, быстрый расчёт ${(tFast / 1000).toFixed(1)} с` +
    (fullCap > 0 ? `, полные бои ${(tFull / 1000).toFixed(1)} с` : ''),
);

const fastOf = (v: Variant) => ({ y: v.fastWin, w: reps });
report(`быстрый расчёт, ${reps} сидов на вариант`, fastOf);
report(`быстрый расчёт, только перекос по классу (${variants.filter((v) => v.skewed).length})`, fastOf, (v) => v.skewed);
console.log('доля побед по полосам отношения (быстрый расчёт):');
for (const { key } of KEYS) bins(key, fastOf);

if (fullCap > 0) {
  const fullOf = (v: Variant) => (v.full === null ? null : { y: v.full, w: 1 });
  report('полный бой', fullOf);
  report('полный бой, только перекос по классу', fullOf, (v) => v.skewed);
  console.log('доля побед по полосам отношения (полный бой):');
  for (const { key } of KEYS) bins(key, fullOf);
}

// --- перебор формулы против НАСТОЯЩЕГО противника ----------------------------------
//
// `--sweep` меряет саму формулу, а не ожидание: обе стороны известны точно, и
// разница между наборами — это разница в том, как формула читает машину.
// Исходы боёв те же самые, поэтому перебор ничего не стоит.
if (args.includes('--sweep')) {
  const sets: { name: string; t: Tuning }[] = [];
  for (const f of [0, 1, 2, 3, 4]) {
    sets.push({ name: `field ${f}, 2..18`, t: { fieldToHit: f, ranges: [2, 4, 6, 8, 10, 12, 15, 18] } });
  }
  sets.push({ name: 'field 2, 1..9', t: { fieldToHit: 2, ranges: [1, 3, 5, 7, 9] } });
  sets.push({ name: 'field 2, 3..12', t: { fieldToHit: 2, ranges: [3, 6, 9, 12] } });
  sets.push({ name: 'field 2, 6..24', t: { fieldToHit: 2, ranges: [6, 9, 12, 15, 18, 21, 24] } });
  const outcomes: { name: string; of: (v: Variant) => { y: number; w: number } | null }[] = [
    { name: 'быстрый', of: fastOf },
  ];
  if (fullCap > 0) outcomes.push({ name: 'полный', of: (v) => (v.full === null ? null : { y: v.full, w: 1 }) });
  for (const o of outcomes) {
    console.log(`\n=== перебор формулы против факта, ${o.name} бой ===`);
    for (const set of sets) {
      const pts: Point[] = [];
      for (const v of variants) {
        const r = o.of(v);
        if (r === null) continue;
        const ours = partsOf(v.brief.company, set.t);
        const theirs = partsOf(v.brief.enemy, set.t);
        const ratio = Math.sqrt(ours.fire * ours.hull) / Math.max(1e-9, Math.sqrt(theirs.fire * theirs.hull));
        pts.push({ x: lnr(ratio), y: r.y, w: r.w });
      }
      const f = fitLogistic(pts);
      console.log(`${set.name.padEnd(18)} logloss ${logLoss(pts, f).toFixed(4)}  AUC ${auc(pts).toFixed(3)}`);
    }
  }
}

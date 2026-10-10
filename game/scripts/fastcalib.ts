/**
 * Калибровка быстрого расчёта боя (шаг 18, M10-A).
 *
 * Вопрос, на который отвечает прогон: **насколько быстрый расчёт расходится с
 * полным** — и в какую сторону. Ловушка шага сформулирована прямо: «быстрый
 * расчёт нельзя калибровать на глаз: если он оптимистичнее полного, весь
 * последующий замер экономики окажется оптимистичным, и настройка цен уедет».
 *
 * Устройство честное: **одна и та же выборка боёв прогоняется обоими
 * способами**. Брифинги берутся не из выдуманных пар и не из одних лишь
 * стартовых рот, а из НАСТОЯЩЕГО хода кампании (`runCampaign`, крючок
 * `onBrief`): побитые машины, раненые пилоты, подросшие навыки, трофеи в
 * строю. Выборка из одних стартовых рот сошлась бы на боях, которых в кампании
 * почти не бывает, — и калибровка встала бы на них.
 *
 * Кампании-поставщики по умолчанию гоняются ПОЛНЫМ боем (`--drive full`), и
 * это стоит вдвое: `--battles 400` = 400 боёв на сбор плюс 400 на сравнение.
 * Дешёвая альтернатива `--drive fast` существует, но пользоваться ею для
 * подбора коэффициентов нельзя: выборка тогда зависит от той самой модели,
 * которую подбираешь, и меняется под руками — два прогона подряд дают разные
 * брифинги и несравнимые числа. Полный ход кампании даёт выборку,
 * ЗАКРЕПЛЁННУЮ за сидом: её можно перебирать сколько угодно раз.
 *
 * Что сравнивается: доля побед и отходов, потери машин с обеих сторон, трофеи,
 * ранения и потери пилотов, длина боя и остаток целости роты. Это ровно тот
 * набор, которым `sim/campaign/batch.ts` меряет экономику: разойдись любой из
 * них — уедет и она.
 *
 * Лимит проекта — 1400 боёв за прогон (CLAUDE.md). Дорогая половина здесь —
 * полная, поэтому умолчание 300 брифингов = 300 полных боёв (плюс 300
 * быстрых, которые почти ничего не стоят).
 *
 * Запуск:
 *   pnpm fastcalib                                   сравнение на 300 боях
 *   pnpm fastcalib --battles 500 --drive fast        шире выборка, дёшево
 *   pnpm fastcalib --sweep toHitPenalty=3,4,5        перебор коэффициента
 *   pnpm fastcalib --drive full --battles 400        итоговый замер
 *   pnpm fastcalib --from 500                        та же настройка, другая выборка
 */
import {
  FAST,
  fastResolveDetailed,
  makeBattleFromBrief,
  recordChassisDef,
  type BattleBrief,
  type BattleOutcome,
  type FastResolveTuning,
} from '../src/core/campaign/index.js';
import { HitZone } from '../src/core/model/HitZone.js';
import {
  FAST_FIDELITY,
  FULL_FIDELITY,
  runCampaign,
} from '../src/sim/campaign/batch.js';
import type { ManagerPolicy } from '../src/sim/campaign/manager.js';
import { runOn } from '../src/sim/autoBattle.js';

const args = process.argv.slice(2);
const num = (flag: string, fallback: number): number => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : fallback;
};
const str = (flag: string, fallback: string): string => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] !== undefined ? String(args[i + 1]) : fallback;
};
const has = (flag: string): boolean => args.includes(flag);

/** Сколько брифингов собрать — столько же и полных боёв потом. */
const want = num('--battles', 300);
/** Контрактов в кампании-поставщике: столько же боёв она и даёт. */
const contracts = num('--contracts', 20);
/** Чем гонять кампании-поставщики: `fast` дёшево, `full` честнее по траектории. */
const drive = str('--drive', 'full');
const start = str('--start', '');
/** С какого сида собирать кампании — проверка, что коэффициенты не подогнаны под одну выборку. */
const from = num('--from', 1);
const fastOnly = has('--fast-only');
/** `--sweep ключ=знач,знач,...` — перебор одного коэффициента за прогон. */
const sweep = str('--sweep', '');

const MAX_FULL_BATTLES = 1400;
const driveCost = drive === 'full' ? want : 0;
const compareCost = fastOnly ? 0 : want;
if (driveCost + compareCost > MAX_FULL_BATTLES) {
  throw new Error(
    `${driveCost + compareCost} полных боёв — больше лимита ${MAX_FULL_BATTLES} (CLAUDE.md). ` +
      `Сократи --battles или возьми --drive fast.`,
  );
}
if (drive !== 'fast' && drive !== 'full') throw new Error(`--drive ожидает fast или full`);

/**
 * Политика бот-менеджера — та же, с которой снят замер §6 шага 16a. Другая
 * политика дала бы другой ход кампании и, значит, другую выборку боёв.
 */
const POLICY: ManagerPolicy = {
  repairThreshold: 0,
  fleetCap: 6,
  supplyThreshold: 600_000,
  supplyJumps: 3,
  // 0.58 — умолчание `pnpm camp` с шага 68 (оценка по огню и живучести).
  contractOdds: 0.58,
  // Порог верности добавлен шагом 20 в `ManagerPolicy`, а сюда — только шагом
  // 32, и всё это время инструмент молча собирал НОЛЬ брифингов: без порога бот
  // не брал ни одного контракта, сравнивать было нечего, и таблица печаталась
  // из NaN. Незамеченным это осталось потому, что `scripts/` не входил в
  // tsconfig и типы там не проверялись вовсе — исправлено тем же шагом.
  // Значение — умолчание замера кампании (`sim/campaign/cli.ts`, LOYALTY_DEFAULT).
  loyaltyThreshold: 25,
};

/** Собрать выборку брифингов из настоящих кампаний. */
function collectBriefs(count: number): BattleBrief[] {
  const out: BattleBrief[] = [];
  const resolve = drive === 'full' ? FULL_FIDELITY : FAST_FIDELITY;
  for (let seed = from; out.length < count; seed++) {
    runCampaign(seed, contracts, POLICY, {
      resolve,
      ...(start === '' ? {} : { startSystemId: start }),
      onBrief: (brief) => {
        if (out.length < count) out.push(brief);
      },
    });
    if (seed > from + count) break;
  }
  return out;
}

interface Sample {
  wins: number;
  draws: number;
  losses: number;
  /** Своих машин выведено из строя. */
  ourLost: number;
  /** Вражеских машин выведено из строя. */
  theirLost: number;
  /** Из них с целыми торсом и головой — то, что рота может увезти трофеем. */
  trophies: number;
  injuries: number;
  pilotsLost: number;
  turns: number;
  /** Остаток брони и структуры роты после боя, доля от вышедшего в бой. */
  integrity: number;
  battles: number;
  ms: number;
}

function empty(): Sample {
  return {
    wins: 0, draws: 0, losses: 0, ourLost: 0, theirLost: 0, trophies: 0,
    injuries: 0, pilotsLost: 0, turns: 0, integrity: 0, battles: 0, ms: 0,
  };
}

function collect(s: Sample, brief: BattleBrief, outcome: BattleOutcome, turns: number): void {
  s.battles += 1;
  s.turns += turns;
  if (outcome.winner === 'player') s.wins += 1;
  else if (outcome.winner === 'opfor') s.losses += 1;
  else s.draws += 1;

  let before = 0;
  for (const p of brief.company) {
    for (const z of p.record.condition.zones) before += z.armor + z.structure;
  }
  let after = 0;

  for (const u of outcome.units) {
    const alive = !u.unit.destroyed;
    if (u.side === 'player') {
      if (!alive) s.ourLost += 1;
      for (const z of u.unit.zones) after += z.armor + z.structure;
      s.injuries += u.unit.pilot.injuries;
      if (u.unit.pilot.status === 'lost') s.pilotsLost += 1;
    } else if (!alive) {
      s.theirLost += 1;
      const zones = u.unit.zones;
      const wreck = zones[HitZone.Torso]?.destroyed === true || zones[HitZone.Head]?.destroyed === true;
      if (!wreck) s.trophies += 1;
    }
  }
  s.integrity += before === 0 ? 0 : after / before;
}

const briefs = collectBriefs(want);

console.log(
  `брифингов: ${briefs.length} из кампаний по ${contracts} контрактов ` +
    `(ход кампании: ${drive}, старт: ${start === '' ? 'разброс по карте' : start})`,
);
console.log(
  `звено: ${(briefs.reduce((n, b) => n + b.company.length, 0) / briefs.length).toFixed(2)} машин, ` +
    `противник: ${(briefs.reduce((n, b) => n + b.enemy.length, 0) / briefs.length).toFixed(2)}, ` +
    `тоннаж звена: ${(
      briefs.reduce((n, b) => n + b.company.reduce((t, p) => t + recordChassisDef(p.record).tons, 0), 0) /
      briefs.length
    ).toFixed(0)} т`,
);
console.log('');

function measureFast(tuning: FastResolveTuning): Sample {
  const s = empty();
  const t0 = Date.now();
  for (const brief of briefs) {
    const r = fastResolveDetailed(brief, tuning);
    collect(s, brief, r.outcome, r.rounds);
  }
  s.ms = Date.now() - t0;
  return s;
}

function measureFull(): Sample {
  const s = empty();
  const t0 = Date.now();
  for (const brief of briefs) {
    const report = runOn(makeBattleFromBrief(brief), { seed: brief.battleSeed });
    collect(s, brief, report.outcome, report.turns);
  }
  s.ms = Date.now() - t0;
  return s;
}

interface Metric {
  readonly name: string;
  readonly of: (s: Sample) => number;
  /** Доля 0..1 — тогда расхождение печатается в процентных пунктах. */
  readonly share: boolean;
  /** Входит ли в сводное расхождение перебора. */
  readonly key?: boolean;
}

const METRICS: readonly Metric[] = [
  { name: 'доля побед', of: (s) => s.wins / s.battles, share: true, key: true },
  { name: 'доля ничьих (отход)', of: (s) => s.draws / s.battles, share: true },
  { name: 'доля поражений', of: (s) => s.losses / s.battles, share: true },
  { name: 'своих выбыло за бой', of: (s) => s.ourLost / s.battles, share: false, key: true },
  { name: 'чужих выбыло за бой', of: (s) => s.theirLost / s.battles, share: false, key: true },
  { name: 'трофеев за бой', of: (s) => s.trophies / s.battles, share: false, key: true },
  { name: 'ранений за бой', of: (s) => s.injuries / s.battles, share: false, key: true },
  { name: 'потерь пилотов за бой', of: (s) => s.pilotsLost / s.battles, share: false },
  { name: 'ходов/раундов', of: (s) => s.turns / s.battles, share: false },
  { name: 'целость роты после', of: (s) => s.integrity / s.battles, share: true, key: true },
];

const pad = (s: string, n: number): string => s.padEnd(n);
const numOf = (v: number, share: boolean): string =>
  share ? `${(v * 100).toFixed(1)} %` : v.toFixed(2);

/**
 * Сводное расхождение набора коэффициентов — среднее относительное отклонение
 * по ключевым показателям. Доли сравниваются в пунктах, счётные — в процентах
 * от полного: иначе «потерь пилотов 0.01 против 0.02» перевесило бы всё
 * остальное вдвое.
 */
function score(full: Sample, fast: Sample): number {
  const keys = METRICS.filter((m) => m.key === true);
  let sum = 0;
  for (const m of keys) {
    const a = m.of(full);
    const b = m.of(fast);
    sum += m.share ? Math.abs(b - a) : a === 0 ? Math.abs(b) : Math.abs(b / a - 1);
  }
  return sum / keys.length;
}

function report(full: Sample, fast: Sample): void {
  console.log(`${pad('показатель', 24)}${pad('полный', 12)}${pad('быстрый', 12)}расхождение`);
  for (const m of METRICS) {
    const a = m.of(full);
    const b = m.of(fast);
    const delta = m.share
      ? `${(b - a) * 100 >= 0 ? '+' : ''}${((b - a) * 100).toFixed(1)} п.п.`
      : `${b - a >= 0 ? '+' : ''}${(b - a).toFixed(2)}` +
        (a === 0 ? '' : ` (${((b / a - 1) * 100).toFixed(0)} %)`);
    console.log(
      `${pad(m.name, 24)}${pad(numOf(a, m.share), 12)}${pad(numOf(b, m.share), 12)}${delta}` +
        (m.key === true ? '  ◆' : ''),
    );
  }
  console.log('');
  console.log(`сводное расхождение по ключевым (◆): ${(score(full, fast) * 100).toFixed(1)} %`);
  console.log(
    `время: полный ${full.ms} мс (${(full.ms / full.battles).toFixed(1)} мс/бой), ` +
      `быстрый ${fast.ms} мс (${(fast.ms / fast.battles).toFixed(2)} мс/бой), ` +
      `ускорение ×${(full.ms / Math.max(1, fast.ms)).toFixed(0)}`,
  );
}

if (fastOnly) {
  const fast = measureFast(FAST);
  console.log(`${pad('показатель', 24)}быстрый`);
  for (const m of METRICS) console.log(`${pad(m.name, 24)}${numOf(m.of(fast), m.share)}`);
} else if (sweep !== '') {
  const [key, list] = sweep.split('=');
  if (key === undefined || list === undefined) throw new Error('--sweep ждёт ключ=знач,знач,...');
  if (!(key in FAST)) throw new Error(`Нет коэффициента «${key}» в data/fastresolve.json`);
  const full = measureFull();
  console.log(`перебор ${key}: ${list}`);
  console.log(`${pad(key, 10)}${pad('побед', 10)}${pad('своих', 10)}${pad('трофеев', 10)}${pad('ранений', 10)}${pad('целость', 10)}${pad('раундов', 10)}сводное`);
  const line = (label: string, s: Sample): string =>
    `${pad(label, 10)}${pad(numOf(s.wins / s.battles, true), 10)}` +
    `${pad((s.ourLost / s.battles).toFixed(2), 10)}${pad((s.trophies / s.battles).toFixed(2), 10)}` +
    `${pad((s.injuries / s.battles).toFixed(2), 10)}${pad(numOf(s.integrity / s.battles, true), 10)}` +
    `${pad((s.turns / s.battles).toFixed(2), 10)}`;
  console.log(`${line('полный', full)}—`);
  for (const raw of list.split(',')) {
    const value = Number(raw);
    if (!Number.isFinite(value)) throw new Error(`«${raw}» — не число`);
    const fast = measureFast({ ...FAST, [key]: value });
    console.log(`${line(raw, fast)}${(score(full, fast) * 100).toFixed(1)} %`);
  }
} else {
  report(measureFull(), measureFast(FAST));
}

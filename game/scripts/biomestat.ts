import {
  FACTIONS,
  GALAXY,
  GALAXY_RULES,
  systemIncome,
  systemProfile,
  systemUpkeep,
  type MarketClass,
  type SystemProfile,
} from '../src/core/campaign/index.js';

/**
 * Расслоение мира по биомам — `pnpm biomestat` (шаг 24, фаза 1 Части 3).
 *
 * **Зачем отдельный замер, когда есть `galaxystat`.** Тот считает биомы штуками
 * и отвечает на вопрос «сколько их»; вопрос шага 24 — другой: «отличается ли
 * лавовый мир от умеренного хоть чем-нибудь, кроме картинки». До шага 24 ответ
 * был «нет» (медиана населения на лунном мире — 4.4 млн против 4.5 на
 * умеренном, а самая высокая гражданская промышленность на карте была у
 * вулканического). Этот замер и есть постоянная проверка, что ответ сменился на
 * «да» и остаётся таким.
 *
 * **Формулы не дублируются.** Прототип, на котором подбирались числа плана,
 * дублировал арифметику `profile.ts` — и был удалён ровно поэтому: дублированные
 * формулы расходятся, и замер начинает мерить себя. Здесь зовётся настоящий
 * `systemProfile` и настоящие `systemIncome`/`systemUpkeep`.
 *
 * Ключи:
 *   --seed 1      сид мира (один сид: замер про КАТАЛОГ, а не про случай)
 *   --seeds 1..5  усреднить по нескольким сидам
 *
 * Стоимость: около 40 мс на сид (2000 профилей). Тактических боёв ноль, под
 * потолок в 1400 боёв (CLAUDE.md) замер не идёт вовсе.
 */

const args = process.argv.slice(2);
const arg = (flag: string): string | undefined => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

function parseSeeds(): number[] {
  const one = arg('--seed');
  if (one !== undefined) return [Number(one)];
  const range = arg('--seeds');
  if (range === undefined) return [1];
  const m = /^(\d+)\.\.(\d+)$/.exec(range);
  if (m === null) return range.split(',').map(Number);
  const out: number[] = [];
  for (let s = Number(m[1]); s <= Number(m[2]); s++) out.push(s);
  return out;
}

const seeds = parseSeeds();
const pad = (s: string | number, n: number): string => String(s).padEnd(n);
const rpad = (s: string | number, n: number): string => String(s).padStart(n);
const f2 = (v: number): string => v.toFixed(2);
const pct = (v: number): string => `${(v * 100).toFixed(1)} %`;

/** Медиана: у населения хвост в восемь миллиардов, и среднее по нему врёт. */
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const mid = a.length >> 1;
  return a.length % 2 === 1 ? (a[mid] as number) : ((a[mid - 1] as number) + (a[mid] as number)) / 2;
}

interface Bucket {
  worlds: number;
  pops: number[];
  maxPop: number;
  civil: number;
  military: number;
  garrison: number;
  tech: number;
  income: number;
  upkeep: number;
  losing: number;
}

const empty = (): Bucket => ({
  worlds: 0,
  pops: [],
  maxPop: 0,
  civil: 0,
  military: 0,
  garrison: 0,
  tech: 0,
  income: 0,
  upkeep: 0,
  losing: 0,
});

const BIOMES = Object.keys(GALAXY_RULES.profile.biomeWeights);
const byBiome = new Map<string, Bucket>(BIOMES.map((b) => [b, empty()]));
const all = empty();
const marketCount = new Map<MarketClass, number>();
const byFaction = new Map<string, { income: number; upkeep: number }>();

const add = (b: Bucket, p: SystemProfile, income: number, upkeep: number): void => {
  b.worlds++;
  b.pops.push(p.populationM);
  if (p.populationM > b.maxPop) b.maxPop = p.populationM;
  b.civil += p.industryCivil;
  b.military += p.industryMilitary;
  b.garrison += p.garrison;
  b.tech += p.techLevel;
  b.income += income;
  b.upkeep += upkeep;
  if (income < upkeep) b.losing++;
};

const t0 = performance.now();
for (const seed of seeds) {
  for (let i = 0; i < GALAXY.count; i++) {
    const p = systemProfile(seed, i);
    const isCapital = GALAXY.hasFlag(i, 'capital');
    const income = systemIncome(p, isCapital);
    const upkeep = systemUpkeep(p);
    add(byBiome.get(p.biome) as Bucket, p, income, upkeep);
    add(all, p, income, upkeep);
    marketCount.set(p.marketClass, (marketCount.get(p.marketClass) ?? 0) + 1);
    const owner = GALAXY.ownerId(i);
    const f = byFaction.get(owner) ?? { income: 0, upkeep: 0 };
    f.income += income;
    f.upkeep += upkeep;
    byFaction.set(owner, f);
  }
}
const ms = performance.now() - t0;
const n = seeds.length;

// --- расслоение по биомам -----------------------------------------------------

console.log(`=== биомы (сид${n > 1 ? 'ы' : ''} ${seeds.join(',')}, ${GALAXY.count} систем) ===`);
console.log(
  `${pad('биом', 11)}${rpad('миров', 6)}${rpad('медиана', 9)}${rpad('макс', 8)}` +
    `${rpad('гражд', 7)}${rpad('воен', 6)}${rpad('гарн', 6)}${rpad('тех', 5)}` +
    `${rpad('недра', 7)}${rpad('доход', 7)}${rpad('убыт', 8)}`,
);
const eco = GALAXY_RULES.profile.biomeEconomy as unknown as Record<string, { richness: number }>;
for (const [name, b] of [...byBiome].sort((x, y) => y[1].worlds - x[1].worlds)) {
  if (b.worlds === 0) continue;
  console.log(
    pad(name, 11) +
      rpad(Math.round(b.worlds / n), 6) +
      rpad(f2(median(b.pops)), 9) +
      rpad(f2(b.maxPop), 8) +
      rpad(f2(b.civil / b.worlds), 7) +
      rpad(f2(b.military / b.worlds), 6) +
      rpad(f2(b.garrison / b.worlds), 6) +
      rpad(f2(b.tech / b.worlds), 5) +
      rpad(f2(eco[name]?.richness ?? 0), 7) +
      rpad(f2(b.income / b.worlds / 1e6), 7) +
      rpad(pct(b.losing / b.worlds), 8),
  );
}
console.log(
  `\nмедиана и макс — население, млн; доход — млн C-Bills за такт на мир; ` +
    `убыт — доля миров, где содержание выше дохода`,
);

// --- вся карта ----------------------------------------------------------------

console.log(`\n=== по всей карте ===`);
console.log(
  `доход ${f2(all.income / n / 1e9)} млрд за такт, содержание ${f2(all.upkeep / n / 1e9)} млрд, ` +
    `убыточных миров ${pct(all.losing / all.worlds)}`,
);
console.log(`население Сферы: ${f2(all.pops.reduce((s, v) => s + v, 0) / n / 1000)} млрд`);
console.log('классы рынка:');
for (const [c, k] of [...marketCount].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${pad(c, 12)} ${rpad(Math.round(k / n), 4)}  ${pct(k / (GALAXY.count * n))}`);
}

// --- фракции ------------------------------------------------------------------

console.log(`\n=== фракции (доход минус содержание, млн за такт) ===`);
const rows = [...byFaction]
  .map(([id, v]) => ({ id, net: (v.income - v.upkeep) / n / 1e6 }))
  .sort((a, b) => b.net - a.net)
  .slice(0, 12);
for (const r of rows) {
  console.log(`  ${pad(FACTIONS.get(r.id)?.short ?? r.id, 14)} ${rpad(Math.round(r.net), 5)}`);
}

console.log(`\nпосчитано за ${ms.toFixed(0)} мс (${n} × ${GALAXY.count} профилей)`);

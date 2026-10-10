/**
 * Замер галактики (шаг 14).
 * Запуск: pnpm galaxy --stat [--seed N] [--pairs N]
 *
 * Отвечает на пять вопросов из `wiki/design/campaign/planets.md` §10 и на
 * приёмку брифинга: связность, доля недостижимых систем, средняя длина
 * маршрута, распределение владений и классов рынка, время загрузки и размер
 * каталога в памяти.
 */
import {
  FACTIONS,
  GALAXY,
  GALAXY_RULES,
  findRoute,
  jumpDistance,
  systemProfile,
  type MarketClass,
} from '../src/core/campaign/galaxy/index.js';
import { Rng } from '../src/core/rng/index.js';

const args = process.argv.slice(2);
const num = (flag: string, fallback: number): number => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : fallback;
};

const worldSeed = num('--seed', 1);
const pairs = num('--pairs', 300);

const pct = (v: number): string => `${(v * 100).toFixed(1)} %`;
const pad = (s: string | number, n: number): string => String(s).padEnd(n);

// --- загрузка -----------------------------------------------------------------

// Каталог — модульная константа, к этой строке он уже разобран и построен.
// Мерим повторную сборку той же работы: разбор схемы платится один раз за
// процесс, а не за обращение.
const t0 = performance.now();
let neighborTotal = 0;
for (let i = 0; i < GALAXY.count; i++) neighborTotal += GALAXY.neighbors(i).length;
const neighborMs = performance.now() - t0;

const bytesArrays =
  GALAXY.x.byteLength +
  GALAXY.y.byteLength +
  GALAXY.star.byteLength +
  GALAXY.owner.byteLength +
  GALAXY.flags.byteLength +
  GALAXY.borderDistance.byteLength;
const bytesStrings = GALAXY.ids.reduce((s, id, i) => s + id.length * 2 + (GALAXY.names[i] as string).length * 2, 0);

console.log(`=== каталог ===`);
console.log(`систем: ${GALAXY.count}, дальность прыжка ${GALAXY.jumpRangeLy} св. лет`);
console.log(`соседей у системы в среднем: ${(neighborTotal / GALAXY.count).toFixed(1)} (обход всех — ${neighborMs.toFixed(0)} мс)`);
console.log(
  `память: массивы ${(bytesArrays / 1024).toFixed(0)} КБ + строки ${(bytesStrings / 1024).toFixed(0)} КБ = ` +
    `${((bytesArrays + bytesStrings) / 1024).toFixed(0)} КБ`,
);

// --- связность ----------------------------------------------------------------

const seen = new Uint8Array(GALAXY.count);
let components = 0;
let largest = 0;
let isolated = 0;
for (let i = 0; i < GALAXY.count; i++) {
  if (seen[i] === 1) continue;
  components++;
  let size = 0;
  const stack = [i];
  seen[i] = 1;
  while (stack.length > 0) {
    const cur = stack.pop() as number;
    size++;
    for (const j of GALAXY.neighbors(cur)) {
      if (seen[j] === 1) continue;
      seen[j] = 1;
      stack.push(j);
    }
  }
  if (size > largest) largest = size;
  if (size === 1) isolated++;
}

console.log(`\n=== связность ===`);
console.log(`компонент: ${components}, крупнейшая: ${largest} (${pct(largest / GALAXY.count)})`);
console.log(`недостижимых из крупнейшей: ${GALAXY.count - largest} (${pct(1 - largest / GALAXY.count)}), одиночек: ${isolated}`);

// --- маршруты -----------------------------------------------------------------

const rng = new Rng(worldSeed ^ 0x5eed);
let jumps = 0;
let days = 0;
let cost = 0;
let failed = 0;
const tRoute = performance.now();
for (let k = 0; k < pairs; k++) {
  const a = rng.int(0, GALAXY.count - 1);
  const b = rng.int(0, GALAXY.count - 1);
  const route = findRoute(a, b);
  if (route === null) {
    failed++;
    continue;
  }
  jumps += route.jumps;
  days += route.days;
  cost += route.cost;
}
const routeMs = (performance.now() - tRoute) / pairs;
const ok = pairs - failed;

console.log(`\n=== маршруты (${pairs} случайных пар) ===`);
console.log(`не проложено: ${failed}`);
console.log(`в среднем: ${(jumps / ok).toFixed(1)} прыжков, ${(days / ok).toFixed(0)} суток, ${Math.round(cost / ok)} C-Bills`);
console.log(`один поиск A*: ${routeMs.toFixed(1)} мс`);

// --- владения -----------------------------------------------------------------

const byFaction = new Map<string, number>();
for (let i = 0; i < GALAXY.count; i++) {
  const id = GALAXY.ownerId(i);
  byFaction.set(id, (byFaction.get(id) ?? 0) + 1);
}

console.log(`\n=== владения (канон 3053, после Тукайида) ===`);
for (const [id, n] of [...byFaction].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${pad(FACTIONS.get(id)?.short ?? id, 12)} ${String(n).padStart(4)}  ${pct(n / GALAXY.count)}`);
}

// --- профиль ------------------------------------------------------------------

const tProfile = performance.now();
const marketCount = new Map<MarketClass, number>();
const biomeCount = new Map<string, number>();
let popTotal = 0;
for (let i = 0; i < GALAXY.count; i++) {
  const p = systemProfile(worldSeed, i);
  marketCount.set(p.marketClass, (marketCount.get(p.marketClass) ?? 0) + 1);
  biomeCount.set(p.biome, (biomeCount.get(p.biome) ?? 0) + 1);
  popTotal += p.populationM;
}
const profileMs = performance.now() - tProfile;

console.log(`\n=== профиль (сид мира ${worldSeed}) ===`);
console.log(`вывод всех ${GALAXY.count} профилей: ${profileMs.toFixed(0)} мс (${((profileMs / GALAXY.count) * 1000).toFixed(1)} мкс на систему)`);
console.log(`население Сферы: ${(popTotal / 1000).toFixed(1)} млрд`);
console.log('классы рынка:');
for (const [c, n] of [...marketCount].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${pad(c, 12)} ${String(n).padStart(4)}  ${pct(n / GALAXY.count)}`);
}
console.log('биомы:');
for (const [c, n] of [...biomeCount].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${pad(c, 12)} ${String(n).padStart(4)}  ${pct(n / GALAXY.count)}`);
}

// --- лестница классов: далеко ли до армейского рынка --------------------------

/**
 * Где вообще бывает армейский класс исполнения (`planets.md` §4): столица,
 * промышленный узел, развитый мир. Настоящая таблица доступности — шаг 15
 * (`data/market.json`); здесь ровно то, что нужно проверить сейчас: не
 * оказалась ли лестница вверх недостижимой географически.
 */
const ARMY_MARKETS = new Set<MarketClass>(['capital', 'industrial', 'developed']);
const armyMarkets: number[] = [];
for (let i = 0; i < GALAXY.count; i++) {
  if (ARMY_MARKETS.has(systemProfile(worldSeed, i).marketClass)) armyMarkets.push(i);
}

const isFrontier = (i: number): boolean => {
  const kind = FACTIONS.get(GALAXY.ownerId(i))?.kind;
  return kind !== 'house' && kind !== 'comstar';
};

const sample = 60;
let hops = 0;
let worst = 0;
let counted = 0;
for (let k = 0; k < sample; k++) {
  let i = rng.int(0, GALAXY.count - 1);
  let tries = 0;
  while (!isFrontier(i) && tries++ < 200) i = rng.int(0, GALAXY.count - 1);
  let best = Number.POSITIVE_INFINITY;
  // Ближайший по прыжкам, а не по расстоянию: маршрут идёт по сетке, а не по прямой.
  for (const m of armyMarkets) {
    if (GALAXY.distance(i, m) / GALAXY.jumpRangeLy >= best) continue;
    const d = jumpDistance(i, m);
    if (d >= 0 && d < best) best = d;
  }
  if (!Number.isFinite(best)) continue;
  counted++;
  hops += best;
  if (best > worst) worst = best;
}

console.log(`\n=== лестница классов ===`);
console.log(`рынков с армейским классом: ${armyMarkets.length} (${pct(armyMarkets.length / GALAXY.count)})`);
console.log(`от периферийной системы до ближайшего такого рынка: в среднем ${(hops / counted).toFixed(1)} прыжков, худший случай ${worst}`);
console.log(
  `\nодин прыжок: ${GALAXY_RULES.jump.costPerJump} C-Bills + сутки в пути по ${GALAXY_RULES.jump.costPerTransitDay} C-Bills`,
);

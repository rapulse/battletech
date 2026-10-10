/**
 * Замер карт (шаг 9a, часть E): укрытость, тактическая шкала, связность.
 * Запуск: pnpm exec vite-node scripts/mapstat.ts -- [--seeds N] [--size N]
 */
import { describeMap, generateMap, MAP_SIZES } from '../src/core/map/index.js';
import { BIOME_LIST } from '../src/core/data/tables.js';

const args = process.argv.slice(2);
const num = (flag: string, fallback: number): number => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : fallback;
};

const seeds = num('--seeds', 40);
const sizes = args.includes('--sizes')
  ? [MAP_SIZES.duel, MAP_SIZES.lance, MAP_SIZES.company, MAP_SIZES.operational]
  : [num('--size', MAP_SIZES.lance)];

const pct = (v: number): string => `${(v * 100).toFixed(1)} %`;

for (const size of sizes) {
  console.log(`\n=== карта ${size}×${size}, ${seeds} сидов ===`);
  console.log(
    ['биом', 'укрытие', 'массив ср', 'массив мед', 'дальний обзор', 'вода', 'недостижимо', 'путь MP', 'починок', 'мс']
      .map((s) => s.padEnd(14))
      .join(''),
  );

  for (const b of BIOME_LIST) {
    let cover = 0, patch = 0, median = 0, sight = 0, water = 0, unreachable = 0, path = 0, repairs = 0;
    const t0 = performance.now();
    for (let s = 0; s < seeds; s++) {
      const g = generateMap(describeMap({ seed: 1000 + s, width: size, height: size, biome: b.id }));
      cover += g.metrics.coverShare;
      patch += g.metrics.avgPatchSize;
      median += g.metrics.medianPatchSize;
      sight += g.metrics.longSightShare;
      water += g.metrics.waterShare;
      unreachable += g.metrics.unreachable;
      path += g.metrics.startPathCost ?? 0;
      repairs += g.metrics.repairs;
    }
    const ms = (performance.now() - t0) / seeds;
    console.log(
      [
        b.id,
        pct(cover / seeds),
        (patch / seeds).toFixed(1),
        (median / seeds).toFixed(1),
        pct(sight / seeds),
        pct(water / seeds),
        (unreachable / seeds).toFixed(2),
        (path / seeds).toFixed(0),
        (repairs / seeds).toFixed(1),
        ms.toFixed(0),
      ]
        .map((s) => String(s).padEnd(14))
        .join(''),
    );
  }
}

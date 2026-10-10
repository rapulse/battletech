/**
 * Честность карт (шаг 9a, часть E).
 *
 * Определение из плана: честность = |доля побед в раскладе `base` − доля побед
 * в раскладе `swap`|. Каждый сид играется дважды — одна и та же карта, одни и
 * те же машины и пилоты, отличается только то, из какой стартовой зоны идёт
 * какая сторона. Всё, что остаётся в разнице, — перекос самой карты.
 *
 * Ориентир: среднее ниже 4 п.п., ни одна карта выборки не хуже 10 п.п.
 * Запуск: pnpm exec vite-node scripts/mapfair.ts -- [--seeds N] [--size N]
 */
import { runBattle } from '../src/sim/autoBattle.js';
import { LANCE_VS_LANCE } from '../src/sim/scenario.js';
import { BIOME_LIST } from '../src/core/data/tables.js';

const args = process.argv.slice(2);
const num = (flag: string, fallback: number): number => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : fallback;
};

const seeds = num('--seeds', 60);
const size = num('--size', 24);
const only = args.includes('--biome') ? args[args.indexOf('--biome') + 1] : null;

console.log(`карта ${size}×${size}, ${seeds} сидов × 2 расклада\n`);
console.log(
  ['биом', 'база', 'обмен', 'перекос', 'ходов', 'попаданий'].map((s) => s.padEnd(13)).join(''),
);

for (const b of BIOME_LIST) {
  if (only !== null && b.id !== only) continue;

  let baseWins = 0;
  let swapWins = 0;
  let played = 0;
  let turns = 0;
  let shots = 0;
  let hits = 0;

  for (let s = 0; s < seeds; s++) {
    for (const swapZones of [false, true]) {
      const report = runBattle({
        seed: 5000 + s,
        units: LANCE_VS_LANCE,
        width: size,
        height: size,
        map: { biome: b.id },
        swapZones,
        keepLog: false,
      });
      // Считаем победы ОДНОЙ СТОРОНЫ (игрока) в обоих раскладах. В базовом
      // раскладе она стоит в первой зоне, в обменянном — во второй; машины и
      // пилоты те же. Значит вся разница между двумя долями — это перекос
      // карты, и ничего больше.
      //
      // Считать вместо этого победы одной и той же ЗОНЫ — распространённая
      // ошибка того же замера: тогда перевес угла попадает в обе доли сразу и
      // сокращается, а показатель начинает мерить перекос стороны, которого в
      // зеркальном сценарии нет по построению.
      if (report.winner !== 'draw') played++;
      if (report.winner === 'player') {
        if (swapZones) swapWins++;
        else baseWins++;
      }
      turns += report.turns;
      shots += report.stats.shots;
      hits += report.stats.hits;
    }
  }

  const baseShare = baseWins / Math.max(1, seeds);
  const swapShare = swapWins / Math.max(1, seeds);
  const skew = Math.abs(baseShare - swapShare);

  console.log(
    [
      b.id,
      `${(baseShare * 100).toFixed(1)} %`,
      `${(swapShare * 100).toFixed(1)} %`,
      `${(skew * 100).toFixed(1)} п.п.`,
      (turns / (seeds * 2)).toFixed(1),
      `${((hits / Math.max(1, shots)) * 100).toFixed(1)} %`,
    ]
      .map((s) => String(s).padEnd(13))
      .join(''),
  );
  void played;
}

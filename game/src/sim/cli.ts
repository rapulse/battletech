import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { PERSONALITIES } from './bot.js';
import { runBattle } from './autoBattle.js';
import { csvPreamble, runBatch, type BatchOptions } from './batch.js';
import { biome } from '../core/data/tables.js';
import { MAP_SIZES } from '../core/map/index.js';
import { mapSizeFor } from '../core/campaign/index.js';
import {
  CLAN_VS_SPHERE,
  CLAN_VS_SPHERE_6,
  DUEL,
  LANCE_VS_LANCE,
  LANCE_VS_LANCE_CLAN,
  makeRandomScenario,
  mirroredForce,
  RECON_LANCE,
  RECON_MAP_SIZE,
  type UnitSpec,
} from './scenario.js';

/**
 * Запуск симуляций из терминала.
 *
 *   pnpm sim --seed 1 --log                        один бой с текстовым журналом
 *   pnpm sim --seeds 1..10000                       батч-прогон в CSV
 *   pnpm sim --seeds 1..1000 --duel                 дуэль вместо копья против копья
 *   pnpm sim --seeds 1..1000 --random                процедурные сборки из каталога
 *   pnpm sim --seeds 1..900 --clan                   клан против клана (внутри техбазы)
 *   pnpm sim --seeds 1..900 --clan-vs-sphere          3 клана против 5 сферы
 *   pnpm sim --seeds 1..1000 --personalities player=aggressive,opfor=cautious
 *   pnpm sim --matrix --matrix-seeds 200             личность против личности, все 16 пар
 *   pnpm sim --seeds 1..600 --recon                  разведка: копьё на карте 30×30
 *   pnpm sim --seeds 1..40 --force 12                зеркальный бой 12 на 12, поле по числу машин
 */

/** Разбор `player=aggressive,opfor=cautious` в `{ player: 'aggressive', opfor: 'cautious' }`. */
function parsePersonalities(spec: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of spec.split(',')) {
    const [side, key] = pair.split('=');
    if (side === undefined || key === undefined || side === '' || key === '') {
      throw new Error(`Не разобран ключ --personalities: «${pair}». Ожидается side=personality`);
    }
    // Опечатка в имени личности молча падает на `balanced` (см. `personality()`),
    // и прогон меряет не то, что просили, ничего об этом не сказав. Единственное
    // место, где это ещё можно поймать, — разбор ключа.
    if (!(key in PERSONALITIES)) {
      throw new Error(
        `Неизвестная личность «${key}». Есть: ${Object.keys(PERSONALITIES).join(', ')}`,
      );
    }
    out[side] = key;
  }
  return out;
}

interface Args {
  readonly seed: number | null;
  readonly from: number;
  readonly to: number;
  readonly log: boolean;
  readonly units: readonly UnitSpec[];
  readonly random: boolean;
  readonly out: string;
  readonly maxTurns: number;
  readonly personalities: Readonly<Record<string, string>> | undefined;
  /** Сценарий асимметричен по числу машин — зеркалирование углов не имеет смысла. */
  readonly mirrorCorners: boolean;
  /** Матрица личность-против-личности вместо одиночного прогона (часть B). */
  readonly matrix: boolean;
  readonly matrixSeeds: number;
  /** Размер карты: сценарию разведки нужна карта шире дальности сенсоров. */
  readonly width: number | undefined;
  readonly height: number | undefined;
  /** Биом карты: с шага 9a бой идёт на процедурной карте, и биом её определяет. */
  readonly biome: string | undefined;
  /** Размер карты одним ключом: --map lance. */
  readonly mapSize: string | undefined;
}

function parseArgs(argv: readonly string[]): Args {
  let seed: number | null = null;
  let from = 1;
  let to = 100;
  let log = false;
  let units: readonly UnitSpec[] = LANCE_VS_LANCE;
  let random = false;
  let out = '../tools/out/sim.csv';
  let maxTurns = 40;
  let personalities: Record<string, string> | undefined;
  let mirrorCorners = true;
  let matrix = false;
  let matrixSeeds = 200;
  let width: number | undefined;
  let height: number | undefined;
  let biomeId: string | undefined;
  let mapSize: string | undefined;
  let forcePerSide: number | null = null;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--seed') {
      seed = Number(argv[++i]);
    } else if (a === '--seeds') {
      const spec = argv[++i] ?? '';
      const m = /^(-?\d+)\.\.(-?\d+)$/.exec(spec);
      if (m === null) throw new Error(`Не разобран диапазон сидов: «${spec}». Ожидается 1..10000`);
      from = Number(m[1]);
      to = Number(m[2]);
    } else if (a === '--log') {
      log = true;
    } else if (a === '--duel') {
      units = DUEL;
    } else if (a === '--clan') {
      units = LANCE_VS_LANCE_CLAN;
    } else if (a === '--clan-vs-sphere') {
      units = CLAN_VS_SPHERE;
      // Три машины против пяти: зеркалить углы нечем — swapStarts схлопнул бы
      // лишних сферных на одну и ту же клетку меньшей стороны.
      mirrorCorners = false;
    } else if (a === '--clan-vs-sphere-6') {
      units = CLAN_VS_SPHERE_6;
      mirrorCorners = false;
    } else if (a === '--recon') {
      // Карта и расстановка идут вместе: на учебных 15×15 сенсоры видят от края
      // до края, и мерить разведке нечего (шаг 8, часть D).
      units = RECON_LANCE;
      width = RECON_MAP_SIZE;
      height = RECON_MAP_SIZE;
    } else if (a === '--random') {
      random = true;
    } else if (a === '--out') {
      out = argv[++i] ?? out;
    } else if (a === '--max-turns') {
      maxTurns = Number(argv[++i]);
    } else if (a === '--personalities') {
      personalities = parsePersonalities(argv[++i] ?? '');
    } else if (a === '--matrix') {
      matrix = true;
    } else if (a === '--matrix-seeds') {
      matrixSeeds = Number(argv[++i]);
    } else if (a === '--biome') {
      // Опечатка обязана быть слышной здесь, а не превратиться молча в
      // умеренный биом: иначе прогон «по пустыне» померит луга.
      const id = argv[++i] ?? '';
      biome(id);
      biomeId = id;
    } else if (a === '--map') {
      const name = argv[++i] ?? '';
      const size = MAP_SIZES[name as keyof typeof MAP_SIZES];
      if (size === undefined) {
        throw new Error(
          `Неизвестный размер карты: «${name}». Известны: ${Object.keys(MAP_SIZES).join(', ')}`,
        );
      }
      mapSize = name;
      width = size;
      height = size;
    } else if (a === '--force') {
      // Крупный бой (шаг 44): столько машин с каждой стороны. Поле берётся той
      // же лестницей, по которой его берёт кампания (`contracts.json → map.steps`),
      // — иначе замер мерил бы бой на карте, которой в игре не бывает.
      forcePerSide = Number(argv[++i]);
      if (!Number.isInteger(forcePerSide) || forcePerSide < 1) {
        throw new Error(`--force ожидает число машин на сторону, получено «${forcePerSide}»`);
      }
    } else if (a !== undefined && a.startsWith('--')) {
      throw new Error(`Неизвестный ключ: ${a}`);
    }
  }

  if (forcePerSide !== null) {
    const size = width ?? mapSizeFor(forcePerSide * 2);
    width = size;
    height = size;
    units = mirroredForce(forcePerSide, size);
  }

  if (to < from) throw new Error(`Пустой диапазон сидов: ${from}..${to}`);
  return {
    seed, from, to, log, units, random, out, maxTurns, personalities, mirrorCorners,
    matrix, matrixSeeds, width, height, biome: biomeId, mapSize,
  };
}

function pct(x: number): string {
  return `${(x * 100).toFixed(1)} %`;
}

/**
 * Личность против личности: все пары из четырёх, каждая — свой батч.
 *
 * Шестнадцать прогонов по 200 сидов дешевле одного прогона на 3200
 * (шаг8-план.md, часть B) — и, в отличие от одного смешанного прогона,
 * показывают именно то, чем отличаются личности, а не средневзвешенное по ним.
 */
function runMatrix(args: Args): void {
  const keys = Object.keys(PERSONALITIES);
  const rows: string[] = [];
  const header = [
    'player', 'opfor', 'battles', 'wins_player', 'wins_opfor', 'draws',
    'win_rate_player', 'avg_turns', 'avg_range', 'run_share', 'full_volley_share',
  ].join(',');

  const table: number[][] = keys.map(() => keys.map(() => 0));

  process.stderr.write(`матрица личностей: ${keys.length}×${keys.length} пар по ${args.matrixSeeds} сидов\n`);

  for (let pi = 0; pi < keys.length; pi++) {
    for (let oi = 0; oi < keys.length; oi++) {
      const player = keys[pi]!;
      const opfor = keys[oi]!;
      const result = runBatch({
        from: 1,
        to: args.matrixSeeds,
        units: args.units,
        maxTurns: args.maxTurns,
        mirrorCorners: args.mirrorCorners,
        personalities: { player, opfor },
        ...(args.width !== undefined ? { width: args.width } : {}),
        ...(args.height !== undefined ? { height: args.height } : {}),
      });
      const s = result.summary;
      const winRate = s.battles === 0 ? 0 : s.winsPlayer / s.battles;
      table[pi]![oi] = winRate;
      rows.push(
        [
          player, opfor, s.battles, s.winsPlayer, s.winsOpfor, s.draws,
          winRate.toFixed(4), s.avgTurns.toFixed(2), s.avgRange.toFixed(2),
          s.runShare.toFixed(4), s.fullVolleyShare.toFixed(4),
        ].join(','),
      );
      process.stderr.write(`  ${player} vs ${opfor}: player ${pct(winRate)}\n`);
    }
  }

  const path = resolve(process.cwd(), args.out);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${header}\n${rows.join('\n')}\n`, 'utf-8');

  const colWidth = Math.max(...keys.map((k) => k.length)) + 1;
  process.stdout.write(`\nдоля побед player (строка) над opfor (столбец), ${args.matrixSeeds} сидов на пару:\n`);
  process.stdout.write(`${' '.repeat(colWidth)}${keys.map((k) => k.padStart(colWidth)).join('')}\n`);
  for (let pi = 0; pi < keys.length; pi++) {
    const row = table[pi]!.map((v) => `${(v * 100).toFixed(0)}%`.padStart(colWidth)).join('');
    process.stdout.write(`${keys[pi]!.padEnd(colWidth)}${row}\n`);
  }
  process.stdout.write(`\nCSV: ${path}\n`);
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));

  if (args.matrix) {
    runMatrix(args);
    return;
  }

  if (args.seed !== null) {
    const units = args.random ? (makeRandomScenario(args.seed).units ?? args.units) : args.units;
    const report = runBattle({
      seed: args.seed,
      units,
      maxTurns: args.maxTurns,
      keepLog: args.log,
      ...(args.width !== undefined ? { width: args.width } : {}),
      ...(args.height !== undefined ? { height: args.height } : {}),
      ...(args.biome !== undefined ? { map: { biome: args.biome } } : {}),
      ...(args.personalities !== undefined ? { personalities: args.personalities } : {}),
    });

    if (args.log) {
      for (const line of report.log) process.stdout.write(`${line}\n`);
      process.stdout.write('\n');
    }

    process.stdout.write(
      [
        `сид ${report.seed}: ${report.winner === 'draw' ? 'ничья' : `победа ${report.winner}`} за ${report.turns} ход(ов)`,
        `выстрелов ${report.stats.shots}, попаданий ${report.stats.hits}, срывов ${report.stats.botches}, собранность ${report.stats.poiseSaves}`,
        `урон ${report.stats.damage}, в кокпит ${report.stats.headHits}, ранений ${report.stats.injuries}, выбыло ${report.stats.pilotsOut}, потеряно ${report.stats.pilotsLost}`,
        `хэш финального состояния ${report.hash}`,
        '',
      ].join('\n'),
    );
    return;
  }

  const opts: BatchOptions = {
    from: args.from,
    to: args.to,
    units: args.units,
    random: args.random,
    maxTurns: args.maxTurns,
    mirrorCorners: args.mirrorCorners,
    ...(args.width !== undefined ? { width: args.width } : {}),
    ...(args.height !== undefined ? { height: args.height } : {}),
    ...(args.biome !== undefined ? { map: { biome: args.biome } } : {}),
    ...(args.personalities !== undefined ? { personalities: args.personalities } : {}),
    onProgress: (done, total) => {
      process.stderr.write(`\r  ${done}/${total}`);
    },
  };

  const started = Date.now();
  const result = runBatch(opts);
  const seconds = (Date.now() - started) / 1000;
  process.stderr.write('\r');

  const path = resolve(process.cwd(), args.out);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${csvPreamble(opts)}\n${result.header}\n${result.rows.join('\n')}\n`, 'utf-8');

  const s = result.summary;
  process.stdout.write(
    [
      `боёв ${s.battles} за ${seconds.toFixed(1)} с (${(s.battles / seconds).toFixed(0)} боёв/с)`,
      `победы: player ${s.winsPlayer}, opfor ${s.winsOpfor}, ничьих ${s.draws}`,
      `ходов в среднем ${s.avgTurns.toFixed(1)}`,
      `попаданий ${pct(s.hitRate)}, срывов ${pct(s.botchRate)}, в кокпит ${pct(s.headHitRate)} от попаданий`,
      `целевое число: в среднем ${s.avgToHit.toFixed(2)}, цель 11-12 ${pct(s.hardTargetShare)}, обстановка в потолке ${pct(s.situationalCapShare)}, за краем шкалы ${pct(s.cappedShare)}`,
      `равновесие: бросков за бой ${s.pilotingChecksPerBattle.toFixed(2)}, падений ${s.fallsPerBattle.toFixed(2)}`,
      `от урона на 100 ходов машины (Л / С / Т / Ш): бросков ${s.damageChecksPer100TurnsByClass.map((v) => v.toFixed(2)).join(' / ')}, падений ${s.damageFallsPer100TurnsByClass.map((v) => v.toFixed(2)).join(' / ')}; ходов в строю ${s.unitTurnsByClass.join(' / ')}`,
      `ранений за бой ${s.injuriesPerBattle.toFixed(2)}, без сознания ${s.pilotsOutPerBattle.toFixed(3)}, ушло ${s.pilotsEjectedPerBattle.toFixed(3)}, потеряно ${s.pilotsLostPerBattle.toFixed(3)}`,
      `критов за бой ${s.criticalsPerBattle.toFixed(2)} (в занятую ячейку ${pct(s.criticalsEffectiveShare)}), детонаций ${s.ammoExplosionsPerBattle.toFixed(3)}`,
      `выстрелов на машину за ход ${s.shotsPerUnitTurn.toFixed(2)}, нагрев средний ${s.avgHeat.toFixed(1)}, пиковый ${s.maxHeat}`,
      `потеряно установок ${s.weaponsLostPerBattle.toFixed(2)}, конечностей ${s.limbsLostPerBattle.toFixed(2)} (из них ног ${s.legsLostPerBattle.toFixed(2)})`,
      `отключений ${s.shutdownsPerBattle.toFixed(3)}, подъёмов ${s.standUpsPerBattle.toFixed(2)}, прыжков за бой ${s.jumpsPerBattle.toFixed(3)}`,
      `MP ходьбы в среднем ${s.avgWalkMp.toFixed(2)}`,
      `пробитий кокпита за бой ${s.cockpitBreachesPerBattle.toFixed(3)} (стоили пилота ${pct(s.cockpitBreachLostShare)})`,
      `контакт с хода ${s.firstContactTurn.toFixed(1)}, первый выстрел с хода ${s.firstShotTurn.toFixed(1)}`,
      `уровни контакта: засветка ${pct(s.contactShareBlip)}, силуэт ${pct(s.contactShareSilhouette)}, опознан ${pct(s.contactShareIdentified)}; вслепую ${pct(s.blindShotShare)} выстрелов`,
      `импульсники: попаданий ${pct(s.pulseHitRate)} (обычные ${pct(s.hitRate)})`,
      `личность: дистанция боя в среднем ${s.avgRange.toFixed(1)} гекс, бегом ${pct(s.runShare)} ходов, полный залп ${pct(s.fullVolleyShare)} возможностей, добровольных уходов ${s.voluntaryEjectionsPerBattle.toFixed(3)} за бой`,
      `строй: рядом (≤3 гекса с союзником) ${pct(s.formationTogetherShare)} концов хода`,
      `разведка: новых контактов ${s.newContactsOpenedPerBattle.toFixed(2)} за бой, потеряно ${s.contactsLostPerBattle.toFixed(2)}, мигания ниже силуэта ${s.contactDroppedBelowSilhouettePerBattle.toFixed(3)} (по замыслу — 0)`,
      `мораль: объявлен отход в ${(s.withdrawalShare * 100).toFixed(1)} % боёв, дошли до края в ${(s.escapedShare * 100).toFixed(1)} %, ушло машин ${s.withdrawnUnitsPerBattle.toFixed(2)} за бой`,
      `трофеев за бой ${s.trophiesPerBattle.toFixed(2)} (${pct(s.trophyShare)} выбывших машин), из них обездвиженных ${s.immobilizedPerBattle.toFixed(2)}`,
      `CSV: ${path}`,
      '',
    ].join('\n'),
  );
}

main();

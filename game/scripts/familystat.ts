/**
 * Турнир семейств вооружения — `pnpm familystat` (шаг 71b).
 *
 * Вопрос: **какое семейство вооружения сильнее на каком биоме, в каком классе и
 * в каком формате боя** (1 на 1, 2 на 2, звено). Ответ идёт в
 * `construction.json → roles.familyByBiome`.
 *
 * Почему не `rolestat`. Тот мерил РОЛИ против обычного парка звеньями 4 на 4:
 * роль даёт только главный калибр, остальное генератор добирает из общего пула,
 * и машина выходит смесью; противник — тоже смесь; звено быстро сходится в
 * свалку. Разница подходов тонула, и вывод «биом почти не влияет» оказался
 * неверен для одиночной машины: дуэль 2× гаусс против 6× средних лазеров на
 * IS-H90-R2F2 — пустыня 125 : 26, джунгли 63 : 49 (200 боёв на биом).
 *
 * УСТРОЙСТВО. Каждое семейство против каждого (и против `default` — нынешнего
 * генератора по ролям). Обе стороны — одни и те же корпуса, пилоты одного
 * уровня, один сид сборки: отличается только вооружение. Каждый сид играется
 * дважды, и во второй раз стороны меняются и семействами, и углами — так снят
 * небольшой перекос стороны `player`, который показало зеркало `rolestat`.
 * Роль у сборок семейств одна — `brawler` (без прыжковых двигателей и
 * приборов): мерится оружие, а не подвижность.
 *
 * Мера — доля урона (снятая броня и структура) и победы.
 *
 * ЛИМИТ. Не больше 1400 тактических боёв за прогон (CLAUDE.md), бои раздаются
 * `--jobs` процессам.
 *
 * Ключи:
 *   --biomes jungle            биомы через запятую
 *   --each-biome               каждый биом — отдельная ячейка; иначе сид перебирает их по кругу
 *   --classes heavy,assault    весовые классы
 *   --tech is,clan             техбазы
 *   --families laser,brawl,long,missile,mixed,default
 *   --per-side 1               машин на сторону
 *   --seeds 1..10              сиды; боёв на пару — вдвое больше
 *   --jobs 4
 *   --out ../tools/out/familystat.csv
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapSizeFor } from '../src/core/campaign/index.js';
import { BIOMES, CHASSIS_CATALOG_LIST, CONSTRUCTION, registerDynamicChassis } from '../src/core/data/tables.js';
import { Rng } from '../src/core/rng/index.js';
import {
  assemblyToChassisDef,
  ForceFamilies,
  generateAssembly,
  pickWeightedRole,
  weightClassOf,
} from '../src/core/rules/index.js';
import { runBattle } from '../src/sim/autoBattle.js';
import type { UnitSpec } from '../src/sim/scenario.js';

const BATTLE_LIMIT = 1400;
const PILOT_TIER = 4;
const CLASSES = ['light', 'medium', 'heavy', 'assault'] as const;
type WeightClassId = (typeof CLASSES)[number];
/** Нынешний генератор: роль по весам класса, пулы роли. */
const DEFAULT = 'default';
/**
 * Семейство по таблице — ровно тем жребием, что у противника в игре
 * (`ForceFamilies`): веса `roles.familyByBiome`, потолок доли, специалисты
 * звена. `table:missile=2` — то же, но специалисты звена заданы здесь, поверх
 * данных: два ракетчика на каждые четыре машины (для подбора
 * `roles.familySpecialists` боями 4 на 4).
 */
const TABLE = 'table';
function specialistsOf(participant: string): Record<string, number> | undefined {
  if (!participant.startsWith(`${TABLE}:`)) return undefined;
  return Object.fromEntries(
    participant
      .slice(TABLE.length + 1)
      .split('+')
      .map((kv) => {
        const [f, n] = kv.split('=');
        return [f!, Number(n)];
      }),
  );
}
const isTable = (f: string): boolean => f === TABLE || f.startsWith(`${TABLE}:`);

const args = process.argv.slice(2);
const str = (flag: string, fallback: string): string => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] !== undefined ? String(args[i + 1]) : fallback;
};
const list = (flag: string, fallback: string): string[] =>
  str(flag, fallback)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');

const biomes = list('--biomes', 'temperate');
for (const b of biomes) if (!BIOMES.has(b)) throw new Error(`Неизвестный биом «${b}»`);
const eachBiome = args.includes('--each-biome');
const classes = list('--classes', CLASSES.join(',')) as WeightClassId[];
for (const c of classes) if (!CLASSES.includes(c)) throw new Error(`Неизвестный класс «${c}»`);
const techs = list('--tech', 'is,clan') as ('is' | 'clan')[];
const families = list('--families', [...Object.keys(CONSTRUCTION.weapons.families), DEFAULT].join(','));
for (const f of families) {
  if (f !== DEFAULT && !isTable(f) && CONSTRUCTION.weapons.families[f] === undefined) throw new Error(`Неизвестное семейство «${f}»`);
}
const perSide = Math.max(1, Number(str('--per-side', '1')));
const seedSpec = /^(\d+)\.\.(\d+)$/.exec(str('--seeds', '1..10'));
if (seedSpec === null) throw new Error('Ключ --seeds ждёт диапазон вида 1..10');
const seedFrom = Number(seedSpec[1]);
const seedTo = Number(seedSpec[2]);
const jobs = Math.max(1, Number(str('--jobs', '4')));
const out = resolve(str('--out', '../tools/out/familystat.csv'));
const part = str('--part', '');

interface Job {
  readonly biome: string | undefined;
  readonly cls: WeightClassId;
  readonly tech: 'is' | 'clan';
  /** Пара семейств; во втором бою сида они меняются сторонами и углами. */
  readonly a: string;
  readonly b: string;
  readonly seed: number;
  readonly swap: boolean;
}

const JOBS: Job[] = [];
for (const biome of eachBiome ? biomes : [undefined])
  for (const cls of classes)
    for (const tech of techs)
      for (let i = 0; i < families.length; i++)
        for (let j = i + 1; j < families.length; j++)
          for (let seed = seedFrom; seed <= seedTo; seed++)
            for (const swap of [false, true])
              JOBS.push({ biome, cls, tech, a: families[i]!, b: families[j]!, seed, swap });

function baseSeed(job: Job): number {
  return job.seed * 1009 + CLASSES.indexOf(job.cls) * 101 + (job.tech === 'clan' ? 53 : 0) + perSide * 7;
}

function play(job: Job, index: number): string {
  const biome = job.biome ?? biomes[(job.seed - seedFrom) % biomes.length]!;
  const rng = new Rng(baseSeed(job));
  const pool = CHASSIS_CATALOG_LIST.filter((c) => c.techBase === job.tech && weightClassOf(c.tonnage) === job.cls);
  // Во втором бою сида семейства меняются сторонами вместе с углами.
  const famPlayer = job.swap ? job.b : job.a;
  const famOpfor = job.swap ? job.a : job.b;
  const units: UnitSpec[] = [];
  // Жребий семейств на сторону — тот же класс, что у `buildForce`, со своим
  // потоком ГПСЧ на сторону: соперник не сдвигает жребий испытуемого.
  const drawFor = (participant: string, salt: number): { draw: ForceFamilies; rng: Rng } | undefined => {
    if (!isTable(participant)) return undefined;
    const spec = specialistsOf(participant);
    const roles = CONSTRUCTION.roles as unknown as { familySpecialists: Record<string, Record<string, number>> };
    const saved = roles.familySpecialists;
    if (spec !== undefined) {
      roles.familySpecialists = Object.fromEntries(Object.keys(CONSTRUCTION.roles.biomeGroups).map((g) => [g, spec]));
    }
    try {
      return { draw: new ForceFamilies(perSide, job.tech, biome), rng: new Rng(baseSeed(job) ^ salt) };
    } finally {
      roles.familySpecialists = saved;
    }
  };
  const draws = { player: drawFor(famPlayer, 0x5bd1), opfor: drawFor(famOpfor, 0x2c7e) };
  for (let i = 0; i < perSide; i++) {
    const entry = rng.pick(pool);
    const defaultRole = pickWeightedRole(entry.tonnage, rng);
    const assemblySeed = rng.int(1, 2 ** 30);
    for (const [side, fam] of [
      ['player', famPlayer],
      ['opfor', famOpfor],
    ] as const) {
      const d = draws[side];
      const drawn = d === undefined ? fam : (d.draw.next(entry.tonnage, d.rng) ?? DEFAULT);
      const assembly = generateAssembly(
        drawn === DEFAULT
          ? { chassisCode: entry.code, role: defaultRole }
          : { chassisCode: entry.code, role: d === undefined ? 'brawler' : defaultRole, family: drawn },
        new Rng(assemblySeed),
      );
      const def = assemblyToChassisDef(assembly);
      const id = `${def.id}~fs${index}${side}${i}`;
      registerDynamicChassis({ ...def, id });
      units.push({ id: `${side}${i}`, side, chassis: id, col: 0, row: 0, tier: PILOT_TIER });
    }
  }
  const size = mapSizeFor(perSide * 2);
  const report = runBattle({
    seed: baseSeed(job),
    units,
    width: size,
    height: size,
    map: { biome },
    swapZones: job.swap,
  });
  let dealtPlayer = 0;
  let dealtOpfor = 0;
  for (const u of report.outcome.units) {
    let taken = 0;
    for (const z of u.unit.zones) taken += z.maxArmor - z.armor + (z.maxStructure - z.structure);
    if (u.side === 'player') dealtOpfor += taken;
    else dealtPlayer += taken;
  }
  // Строка — всегда с точки зрения семейства `a`.
  const dealtA = job.swap ? dealtOpfor : dealtPlayer;
  const dealtB = job.swap ? dealtPlayer : dealtOpfor;
  const winA = report.winner === (job.swap ? 'opfor' : 'player') ? 1 : 0;
  const winB = report.winner === (job.swap ? 'player' : 'opfor') ? 1 : 0;
  return [biome, job.cls, job.tech, job.a, job.b, job.seed, job.swap ? 1 : 0, winA, winB, dealtA, dealtB, report.turns].join(',');
}

const HEADER = 'biome,class,tech,a,b,seed,swap,winA,winB,dealtA,dealtB,turns';

if (part !== '') {
  const [k, n] = part.split('/').map(Number) as [number, number];
  JOBS.forEach((job, index) => {
    if (index % n === k) process.stdout.write(`${play(job, index)}\n`);
  });
} else {
  if (JOBS.length > BATTLE_LIMIT) {
    throw new Error(
      `Прогон на ${JOBS.length} тактических боёв — больше лимита ${BATTLE_LIMIT} (CLAUDE.md). Урежьте сиды, семейства или классы.`,
    );
  }
  const started = Date.now();
  process.stderr.write(`familystat: ${JOBS.length} боёв, ${perSide} на ${perSide}, ${jobs} процесса\n`);
  const self = fileURLToPath(import.meta.url);
  const children = Array.from({ length: jobs }, (_, k) =>
    new Promise<string>((ok, fail) => {
      const child = spawn(resolve('node_modules/.bin/vite-node'), [self, '--', ...args, '--part', `${k}/${jobs}`], {
        stdio: ['ignore', 'pipe', 'inherit'],
      });
      let buf = '';
      child.stdout.on('data', (d: Buffer) => (buf += d.toString()));
      child.on('close', (code) => (code === 0 ? ok(buf) : fail(new Error(`процесс ${k} завершился с кодом ${code}`))));
    }),
  );
  const lines = (await Promise.all(children)).join('').split('\n').filter((l) => l !== '');
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, `${HEADER}\n${lines.join('\n')}\n`);

  // Сводка: у каждого семейства — средняя доля урона и победы против всех остальных.
  const cells = new Map<string, { share: number[]; wins: number; losses: number }>();
  const add = (key: string, share: number, win: number, loss: number): void => {
    const c = cells.get(key) ?? { share: [], wins: 0, losses: 0 };
    c.share.push(share);
    c.wins += win;
    c.losses += loss;
    cells.set(key, c);
  };
  for (const line of lines) {
    const [biome, cls, tech, a, b, , , wA, wB, dA, dB] = line.split(',');
    const total = Number(dA) + Number(dB);
    const shareA = total > 0 ? Number(dA) / total : 0.5;
    const where = `${eachBiome ? biome : '*'},${cls},${tech}`;
    add(`${where},${a}`, shareA, Number(wA), Number(wB));
    add(`${where},${b}`, 1 - shareA, Number(wB), Number(wA));
  }
  console.log(`\n${perSide} на ${perSide}, биомы ${biomes.join('/')}, сиды ${seedFrom}..${seedTo}; доля урона семейства против всех остальных`);
  console.log('биом       класс    техбаза  семейство   боёв  доля урона (±95 %)   побед / поражений');
  for (const [key, c] of [...cells.entries()].sort()) {
    const [biome, cls, tech, fam] = key.split(',');
    const n = c.share.length;
    const mean = c.share.reduce((x, y) => x + y, 0) / n;
    const sd = Math.sqrt(c.share.reduce((x, y) => x + (y - mean) ** 2, 0) / Math.max(1, n - 1));
    console.log(
      `${biome!.padEnd(10)} ${cls!.padEnd(8)} ${tech!.padEnd(8)} ${fam!.padEnd(10)} ${String(n).padStart(4)}  ${(mean * 100).toFixed(1).padStart(5)} % ± ${((1.96 * sd) / Math.sqrt(n) * 100).toFixed(1).padStart(4)}   ${String(c.wins).padStart(4)} / ${c.losses}`,
    );
  }
  console.log(`\nCSV: ${out}; ${((Date.now() - started) / 1000).toFixed(0)} с`);
}

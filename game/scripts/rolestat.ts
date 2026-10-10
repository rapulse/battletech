/**
 * Турнир ролей по биомам — `pnpm rolestat` (шаг 71, ступень Г).
 *
 * Вопрос: **какая роль (то есть какой подход к вооружению) работает на каком
 * биоме и в каком весовом классе.** Ответ идёт в `construction.json` — веса
 * ролей и пулы главного калибра по биому, — а не берётся на глаз.
 *
 * УСТРОЙСТВО БОЯ. Звено на звено, четыре на четыре, все восемь машин одного
 * класса и одной техбазы, поле контракта (`mapSizeFor(8)`). Сторона A — четыре
 * машины ИСПЫТУЕМОЙ роли. Сторона B — ТЕ ЖЕ четыре шасси с теми же пилотами, а
 * роли тянутся жребием по весам класса, как их тянет игра: соперник — не одна
 * роль, а обычный парк, иначе замер свёлся бы к камню-ножницам-бумаге.
 *
 * ПАРНЫЙ ЗАМЕР. Шасси, пилоты, роли стороны B и карта зависят только от сида,
 * класса и техбазы — не от испытуемой роли. Все шесть ролей встречают на одном
 * сиде одного и того же соперника на одной и той же карте, и разница между
 * ролями — это разница навесок, а не удачи жребия. Каждый сид играется на
 * обоих углах (`swapZones`).
 *
 * ЧТО МЕРЯЕТСЯ. Доля урона стороны A — снятая броня и структура соперника к
 * сумме снятого обеими сторонами. Величина непрерывная, её разброс меньше, чем
 * у «победил или нет», и тот же интервал выходит за меньшее число боёв. Победы
 * пишутся тоже.
 *
 * ЛИМИТ. Не больше 1400 тактических боёв за прогон (CLAUDE.md): скрипт считает
 * бои заранее и отказывается запускаться сверх лимита. Бои раздаются
 * `--jobs` процессам (не больше двух — правило пользователя 2026-10-01, CLAUDE.md), время прогона
 * делится, лимит — нет.
 *
 * Ключи:
 *   --biomes jungle            биомы через запятую; сид перебирает их по кругу
 *   --classes heavy,assault    весовые классы (light, medium, heavy, assault)
 *   --tech is,clan             техбазы
 *   --roles brawler,sniper     испытуемые роли (по умолчанию все шесть)
 *   --seeds 1..10              сиды; боёв на ячейку — вдвое больше (два угла)
 *   --min-weight 0.1           пропустить роль в классе с весом ниже (`roles.weightByClass`):
 *                              штурмовой разведчик и лёгкий юггернаут в парке — редкость
 *   --jobs 2                   параллельных процессов (не больше двух)
 *   --each-biome               каждый биом из --biomes — отдельная ячейка сводки, а не круг по сидам
 *   --out ../tools/out/rolestat.csv
 */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mapSizeFor } from '../src/core/campaign/index.js';
import { BIOMES, CHASSIS_CATALOG_LIST, CONSTRUCTION, registerDynamicChassis } from '../src/core/data/tables.js';
import { Rng } from '../src/core/rng/index.js';
import {
  ASSEMBLY_ROLES,
  assemblyToChassisDef,
  generateAssembly,
  pickWeightedRole,
  weightClassOf,
  type AssemblyRole,
} from '../src/core/rules/index.js';
import { runBattle } from '../src/sim/autoBattle.js';
import type { UnitSpec } from '../src/sim/scenario.js';

const BATTLE_LIMIT = 1400;
const PER_SIDE = 4;
const PILOT_TIER = 4;
const CLASSES = ['light', 'medium', 'heavy', 'assault'] as const;
type WeightClassId = (typeof CLASSES)[number];

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
const classes = list('--classes', CLASSES.join(',')) as WeightClassId[];
for (const c of classes) if (!CLASSES.includes(c)) throw new Error(`Неизвестный класс «${c}»`);
const techs = list('--tech', 'is,clan') as ('is' | 'clan')[];
/**
 * Испытуемый подход: роль генератора или `mirror` — сторона A точная копия B.
 * Зеркало — проверка честности самого замера: на обоих углах оно обязано дать
 * около 50 %, иначе перекос в сторонах или картах, а не в ролях.
 */
/**
 * `newold` — новая схема сборки против старой (вопрос пользователя 2026-09-25): обе
 * стороны — одни шасси, роли, пилоты и сид сборки, сторона A собрана нынешними
 * данными, сторона B — с ручками шага 71 в нейтральном положении (ступени
 * разбиты на одиночные, добор выключен). Нейтральные ручки дают сборки байт в
 * байт как до шага — это держит `test/assemblyRollback.test.ts`.
 */
type Approach = AssemblyRole | 'mirror' | 'newold' | `v:${string}`;

/**
 * ВАРИАНТЫ ВООРУЖЕНИЯ (`v:имя`) — роль юггернаута со своими пулами: и главный
 * калибр, и вспомогательный набор. Одной роли для такого вопроса мало:
 * вспомогательный набор подмешал бы тяжёлые стволы к «лазерной» машине. Пулы
 * подменяются в разобранных данных на время сборки стороны A и сразу
 * возвращаются — генератор тот же, что в игре.
 *
 * Вопрос пользователя (2026-09-25): в джунглях тяжёлым и штурмовым, возможно,
 * лучше не тяжёлое оружие, а ракеты и средние лазеры.
 */
type Tiers = (string | string[])[];
interface Variant {
  readonly primary: { readonly is: Tiers; readonly clan: Tiers };
  readonly secondary: { readonly is: string[]; readonly clan: string[] };
}
const VARIANTS: Record<string, Variant> = {
  // Тяжёлые пушки: АП/20 и Ultra, добор — пушки поменьше и ближние ракеты.
  gun: {
    primary: { is: ['is_ac20', 'is_ac10'], clan: ['cl_uac20', 'cl_uac10'] },
    secondary: { is: ['is_ac10', 'is_srm6', 'is_ml', 'is_mpl'], clan: ['cl_uac10', 'cl_srm6', 'cl_er_ml', 'cl_mpl'] },
  },
  // Средние лазеры: главный калибр — средние и импульсные, добор — лазеры и РБД.
  laser: {
    primary: { is: ['is_ml', 'is_mpl'], clan: ['cl_er_ml', 'cl_mpl'] },
    secondary: { is: ['is_ml', 'is_mpl', 'is_ll', 'is_srm6'], clan: ['cl_er_ml', 'cl_mpl', 'cl_er_ll', 'cl_srm6'] },
  },
  // Пушки и ракеты вместе: «2× Ultra АП/20 и 2× РДД-15» пользователя. Главный
  // калибр — пушка: наоборот (РДД главным) вспомогательная пушка не пролезает
  // по плотности, и выходит почти чистый ракетный.
  mixed: {
    primary: { is: ['is_ac20', 'is_ac10'], clan: ['cl_uac20', 'cl_uac10'] },
    secondary: { is: ['is_lrm15', 'is_lrm10', 'is_srm6', 'is_ml'], clan: ['cl_lrm15', 'cl_lrm10', 'cl_srm6', 'cl_er_ml'] },
  },
};
const VARIANT_ROLE: AssemblyRole = 'juggernaut';

const roles = list('--roles', ASSEMBLY_ROLES.join(',')) as Approach[];
for (const r of roles) {
  if (r === 'mirror' || r === 'newold') continue;
  if (r.startsWith('v:')) {
    if (VARIANTS[r.slice(2)] === undefined) throw new Error(`Неизвестный вариант «${r}»`);
  } else if (!ASSEMBLY_ROLES.includes(r as AssemblyRole)) throw new Error(`Неизвестная роль «${r}»`);
}

/** Собрать старой схемой: ручки шага 71 в нейтраль на время вызова. */
function withOldScheme<T>(build: () => T): T {
  const w = CONSTRUCTION.weapons as unknown as {
    primaryByRole: Record<string, { is: Tiers; clan: Tiers }>;
    fillUnusedPayload: boolean;
  };
  const saved = { pools: w.primaryByRole, fill: w.fillUnusedPayload };
  w.primaryByRole = Object.fromEntries(
    Object.entries(saved.pools).map(([k, v]) => [k, { is: v.is.flat(), clan: v.clan.flat() }]),
  );
  w.fillUnusedPayload = false;
  try {
    return build();
  } finally {
    w.primaryByRole = saved.pools;
    w.fillUnusedPayload = saved.fill;
  }
}

/** Собрать под вариантом: подменить пулы на время вызова и вернуть. */
function withVariant<T>(name: string, build: () => T): T {
  const v = VARIANTS[name]!;
  const w = CONSTRUCTION.weapons as unknown as {
    primaryByRole: Record<string, { is: Tiers; clan: Tiers }>;
    secondaryByPayload: Record<'small' | 'medium' | 'large' | 'huge', { is: string[]; clan: string[] }>;
  };
  const savedPrimary = w.primaryByRole[VARIANT_ROLE]!;
  const bands = ['small', 'medium', 'large', 'huge'] as const;
  const savedSecondary = bands.map((b) => ({ is: w.secondaryByPayload[b].is, clan: w.secondaryByPayload[b].clan }));
  w.primaryByRole[VARIANT_ROLE] = v.primary;
  for (const b of bands) {
    w.secondaryByPayload[b].is = v.secondary.is;
    w.secondaryByPayload[b].clan = v.secondary.clan;
  }
  try {
    return build();
  } finally {
    w.primaryByRole[VARIANT_ROLE] = savedPrimary;
    bands.forEach((b, i) => {
      w.secondaryByPayload[b].is = savedSecondary[i]!.is;
      w.secondaryByPayload[b].clan = savedSecondary[i]!.clan;
    });
  }
}
const seedSpec = /^(\d+)\.\.(\d+)$/.exec(str('--seeds', '1..10'));
if (seedSpec === null) throw new Error('Ключ --seeds ждёт диапазон вида 1..10');
const seedFrom = Number(seedSpec[1]);
const seedTo = Number(seedSpec[2]);
const jobs = Math.max(1, Number(str('--jobs', '2')));
const minWeight = Number(str('--min-weight', '0'));
const out = resolve(str('--out', '../tools/out/rolestat.csv'));
const part = str('--part', '');

interface Job {
  readonly cls: WeightClassId;
  readonly tech: 'is' | 'clan';
  readonly role: Approach;
  readonly seed: number;
  readonly swap: boolean;
  /** Биом ячейки при `--each-biome`; иначе биом берётся по кругу от сида. */
  readonly biome?: string;
}

const eachBiome = args.includes('--each-biome');
const JOBS: Job[] = [];
for (const b of eachBiome ? biomes : [undefined])
for (const cls of classes)
  for (const tech of techs)
    for (const role of roles)
      if (role === 'mirror' || role === 'newold' || role.startsWith('v:') || (CONSTRUCTION.roles.weightByClass[role]?.[cls] ?? 1) >= minWeight)
      for (let seed = seedFrom; seed <= seedTo; seed++)
        for (const swap of [false, true]) JOBS.push({ cls, tech, role, seed, swap, ...(b !== undefined ? { biome: b } : {}) });

/** Сид, от которого зависят шасси, пилоты, соперник и карта, — но не испытуемая роль. */
function baseSeed(job: Job): number {
  return job.seed * 1009 + CLASSES.indexOf(job.cls) * 101 + (job.tech === 'clan' ? 53 : 0);
}

interface Row {
  readonly biome: string;
  readonly cls: WeightClassId;
  readonly tech: 'is' | 'clan';
  readonly role: Approach;
  readonly seed: number;
  readonly swap: boolean;
  readonly winner: string;
  /** Снято брони и структуры у соперника: стороной A и стороной B. */
  readonly dealtA: number;
  readonly dealtB: number;
  readonly lostA: number;
  readonly lostB: number;
  readonly turns: number;
  /** Сколько машин стороны A собраны иначе, чем их пара на стороне B. */
  readonly changed: number;
}

function play(job: Job, index: number): Row {
  const biome = job.biome ?? biomes[(job.seed - seedFrom) % biomes.length]!;
  const rng = new Rng(baseSeed(job));
  const pool = CHASSIS_CATALOG_LIST.filter(
    (c) => c.techBase === job.tech && weightClassOf(c.tonnage) === job.cls,
  );
  const units: UnitSpec[] = [];
  let changed = 0;
  for (let i = 0; i < PER_SIDE; i++) {
    const entry = rng.pick(pool);
    const rivalRole = pickWeightedRole(entry.tonnage, rng);
    // Свой поток на каждую машину: сборка стороны A не сдвигает сборку B.
    const assemblySeed = rng.int(1, 2 ** 30);
    let pairA = '';
    const sides = [
      {
        side: 'player' as const,
        role:
          job.role === 'mirror' || job.role === 'newold'
            ? rivalRole
            : job.role.startsWith('v:')
              ? VARIANT_ROLE
              : (job.role as AssemblyRole),
        tag: 'a',
      },
      { side: 'opfor' as const, role: rivalRole, tag: 'b' },
    ];
    for (const s of sides) {
      const build = (): ReturnType<typeof generateAssembly> =>
        generateAssembly(
          { chassisCode: entry.code, role: s.role },
          new Rng(assemblySeed + (s.tag === 'a' && job.role !== 'mirror' && job.role !== 'newold' ? 0 : 7919)),
        );
      const assembly =
        s.tag === 'a' && job.role.startsWith('v:')
          ? withVariant(job.role.slice(2), build)
          : s.tag === 'b' && job.role === 'newold'
            ? withOldScheme(build)
            : build();
      if (s.tag === 'a') pairA = JSON.stringify(assembly.items);
      else if (JSON.stringify(assembly.items) !== pairA) changed++;
      const def = assemblyToChassisDef(assembly);
      const id = `${def.id}~bs${index}${s.tag}${i}`;
      registerDynamicChassis({ ...def, id });
      units.push({ id: `${s.tag}${i}`, side: s.side, chassis: id, col: 0, row: 0, tier: PILOT_TIER });
    }
  }

  const size = mapSizeFor(PER_SIDE * 2);
  const report = runBattle({
    seed: baseSeed(job),
    units,
    width: size,
    height: size,
    map: { biome },
    swapZones: job.swap,
  });

  let dealtA = 0;
  let dealtB = 0;
  let lostA = 0;
  let lostB = 0;
  for (const u of report.outcome.units) {
    let taken = 0;
    for (const z of u.unit.zones) taken += z.maxArmor - z.armor + (z.maxStructure - z.structure);
    const out = u.unit.destroyed ? 1 : 0;
    if (u.side === 'player') {
      dealtB += taken;
      lostA += out;
    } else {
      dealtA += taken;
      lostB += out;
    }
  }
  return {
    biome,
    cls: job.cls,
    tech: job.tech,
    role: job.role,
    seed: job.seed,
    swap: job.swap,
    winner: report.winner,
    dealtA,
    dealtB,
    lostA,
    lostB,
    turns: report.turns,
    changed,
  };
}

const HEADER = 'biome,class,tech,role,seed,swap,winner,dealtA,dealtB,lostA,lostB,turns,changed';
const toCsv = (r: Row): string =>
  [r.biome, r.cls, r.tech, r.role, r.seed, r.swap ? 1 : 0, r.winner, r.dealtA, r.dealtB, r.lostA, r.lostB, r.turns, r.changed].join(
    ',',
  );

if (part !== '') {
  // Дочерний процесс: свои бои по модулю, строки CSV — в stdout.
  const [k, n] = part.split('/').map(Number) as [number, number];
  JOBS.forEach((job, index) => {
    if (index % n === k) process.stdout.write(`${toCsv(play(job, index))}\n`);
  });
} else {
  if (JOBS.length > BATTLE_LIMIT) {
    throw new Error(
      `Прогон на ${JOBS.length} тактических боёв — больше лимита ${BATTLE_LIMIT} (CLAUDE.md). Урежьте сиды, роли или классы.`,
    );
  }
  const started = Date.now();
  process.stderr.write(`rolestat: ${JOBS.length} боёв, ${jobs} процесса, биомы ${biomes.join('/')}\n`);
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

  // Сводка: доля урона и победы по ячейке «класс × техбаза × роль».
  const cells = new Map<string, { share: number[]; wins: number; losses: number; n: number; changed: number }>();
  for (const line of lines) {
    const [biome, cls, tech, role, , , winner, dA, dB, , , , changed] = line.split(',');
    const key = `${eachBiome ? biome : '*'},${cls},${tech},${role}`;
    const c = cells.get(key) ?? { share: [], wins: 0, losses: 0, n: 0, changed: 0 };
    c.changed += Number(changed);
    if (winner === 'opfor') c.losses++;
    const total = Number(dA) + Number(dB);
    c.share.push(total > 0 ? Number(dA) / total : 0.5);
    if (winner === 'player') c.wins++;
    c.n++;
    cells.set(key, c);
  }
  console.log(`\nбиомы ${biomes.join('/')}, сиды ${seedFrom}..${seedTo}, два угла; сторона B — те же шасси, роли по весам класса`);
  console.log('биом       класс    техбаза  роль           боёв  доля урона A (±95 %)   побед A / B   машин A иначе');
  for (const [key, c] of [...cells.entries()].sort()) {
    const [biome, cls, tech, role] = key.split(',');
    const mean = c.share.reduce((a, b) => a + b, 0) / c.n;
    const sd = Math.sqrt(c.share.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, c.n - 1));
    const ci = (1.96 * sd) / Math.sqrt(c.n);
    console.log(
      `${biome!.padEnd(10)} ${cls!.padEnd(8)} ${tech!.padEnd(8)} ${role!.padEnd(14)} ${String(c.n).padStart(4)}  ${(mean * 100).toFixed(1).padStart(5)} % ± ${(ci * 100).toFixed(1).padStart(4)}      ${String(c.wins).padStart(3)} / ${String(c.losses).padEnd(3)}     ${((c.changed / (c.n * PER_SIDE)) * 100).toFixed(0).padStart(3)} %`,
    );
  }
  console.log(`\nCSV: ${out}; ${((Date.now() - started) / 1000).toFixed(0)} с`);
}

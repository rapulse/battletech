/**
 * Замер класса исполнения (шаг 11, часть E).
 *
 * Вопрос, на который отвечает прогон: **значит ли класс что-нибудь в бою** —
 * и насколько. Всё, кроме класса, зафиксировано: одно шасси, одна роль, один
 * генератор сборки, одни и те же пилоты, зеркальные стороны. Разница в долях
 * побед — это и есть цена класса.
 *
 * Устройство пары: испытуемый класс против СЕРИЙНОГО. Серийный против серийного
 * идёт контролем — он обязан дать примерно 50 %, и если не даёт, замер меряет
 * не класс, а собственный шум.
 *
 * Лимит проекта — 1400 боёв за прогон (CLAUDE.md), поэтому умолчание такое:
 * 4 пары × 175 сидов × 2 зеркала = 1400.
 *
 * Запуск: pnpm qualitystat [--seeds N] [--chassis CODE] [--role R]
 */
import { QUALITY_CLASS_IDS, type MechQuality, type QualityClass } from '../src/core/model/index.js';
import { registerDynamicChassis } from '../src/core/data/tables.js';
import {
  assemblyToChassisDef,
  generateAssembly,
  makePlatform,
  type AssemblyRole,
} from '../src/core/rules/index.js';
import { Rng } from '../src/core/rng/index.js';
import { runBattle } from '../src/sim/autoBattle.js';
import type { UnitSpec } from '../src/sim/scenario.js';

const args = process.argv.slice(2);
const num = (flag: string, fallback: number): number => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : fallback;
};
const str = (flag: string, fallback: string): string => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] !== undefined ? String(args[i + 1]) : fallback;
};

const code = str('--chassis', 'IS-H55-R3F2');
const role = str('--role', 'brawler') as AssemblyRole;
/**
 * Сколько РАЗНЫХ сборок гонять на класс (2026-09-16).
 *
 * До этой правки сборка была одна: генератор звался с прошитым сидом 80080, и
 * весь прогон мерил ОДИН жребий навески. Этого хватало, пока навески у классов
 * различались мало; при структуре 1.3 разброс сборок стал больше разницы
 * классов, и замер начал показывать то, чего нет, — например «армейский
 * проигрывает серийному» на одной неудачной сборке с тремя малыми лазерами
 * (`notes.md` §10m). Теперь класс меряется МЕДИАНОЙ по нескольким сборкам, а
 * бюджет боёв делится между ними.
 */
const builds = num('--builds', 10);
const seeds = num('--seeds', Math.max(1, Math.round(1400 / (QUALITY_CLASS_IDS.length * builds * 2))));

/**
 * Сборка строится ОДНИМ фиксированным ГПСЧ на все классы: навеска обязана быть
 * одной и той же, иначе прогон померяет разницу сборок, а не классов.
 */
function chassisFor(quality: MechQuality, build: number): string {
  const assembly = generateAssembly({ chassisCode: code, role, quality }, new Rng(80080 + build * 37));
  const def = assemblyToChassisDef(assembly);
  registerDynamicChassis(def);
  return def.id;
}

const STANDARD: MechQuality = { reactor: 'standard', frame: 'standard' };

/**
 * Противник — серийная машина ТОЙ ЖЕ сборки по счёту.
 *
 * Иначе жребий навески достался бы только испытуемому, а контроль стоял бы на
 * одной и той же машине: перевес читался бы как цена класса, хотя половину его
 * давал бы разброс сборок.
 */
function pair(test: QualityClass, build: number): readonly UnitSpec[] {
  const testId = chassisFor({ reactor: test, frame: test }, build);
  const standardId = chassisFor(STANDARD, build);
  return [
    { id: 'Испытуемый', side: 'player', chassis: testId, col: 3, row: 12, tier: 4 },
    { id: 'Серийный', side: 'opfor', chassis: standardId, col: 11, row: 2, tier: 4 },
  ];
}

console.log(`шасси ${code}, роль ${role}: ${builds} сборок × ${seeds} сидов × 2 зеркала на класс`);
console.log(`всего боёв: ${QUALITY_CLASS_IDS.length * builds * seeds * 2}\n`);

interface Row {
  readonly cls: QualityClass;
  readonly winRate: number;
  readonly winSpread: readonly [number, number];
  readonly draws: number;
  readonly turns: number;
  readonly damage: number;
}

const median = (xs: readonly number[]): number => {
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 === 0 ? ((a[m - 1] ?? 0) + (a[m] ?? 0)) / 2 : (a[m] ?? 0);
};

function play(cls: QualityClass): Row {
  const perBuild: number[] = [];
  let draws = 0;
  let played = 0;
  let turns = 0;
  let damage = 0;

  for (let b = 0; b < builds; b++) {
    const units = pair(cls, b);
    let wins = 0;
    let n = 0;
    for (let s = 0; s < seeds; s++) {
      for (const swapZones of [false, true]) {
        const report = runBattle({ seed: 9000 + b * 1000 + s, units, swapZones, keepLog: false });
        n++;
        played++;
        turns += report.turns;
        damage += report.stats.damage;
        if (report.winner === 'player') wins++;
        else if (report.winner === 'draw') draws++;
      }
    }
    perBuild.push((wins / n) * 100);
  }

  const sorted = [...perBuild].sort((x, y) => x - y);
  return {
    cls,
    // МЕДИАНА по сборкам, а не доля побед по всем боям: одна дикая сборка не
    // должна утаскивать за собой оценку класса.
    winRate: median(perBuild),
    winSpread: [sorted[0] ?? 0, sorted[sorted.length - 1] ?? 0],
    draws: (draws / played) * 100,
    turns: turns / played,
    damage: damage / played,
  };
}

const rows = QUALITY_CLASS_IDS.map(play);

/**
 * Контроль — серийный против серийного.
 *
 * Он обязан дать примерно 50 %, и отклонение от них — собственный шум замера:
 * ничьи, перекос углов, остаточная несимметрия карты. Именно поэтому цена
 * класса читается как перевес НАД контролем, а не как сырая доля побед: сырая
 * доля приписала бы классу ещё и весь шум прогона.
 */
const control = rows.find((r) => r.cls === 'standard');
const base = control?.winRate ?? 50;

const head = ['класс', 'побед(мед)', 'над контр.', 'разброс', 'ничьих', 'ходов', 'урон/бой', 'масса нав.', 'структура', 'рассеив.'];
console.log(head.map((s) => s.padEnd(12)).join(''));

// Тоннаж и тиры — РАЗБИРАЮТСЯ ИЗ КОДА ШАССИ, а не прошиты пятьдесят пятой:
// с ключом `--chassis` колонки платформы показывали числа чужой машины.
const spec = code.match(/^(IS|CL)-[HN](\d+)-R(\d)F(\d)$/);
if (spec === null) throw new Error(`Не разобран код шасси: ${code}`);
const tonnage = Number(spec[2]);
const reactorTier = Number(spec[3]);
const frameTier = Number(spec[4]);
const techBase = spec[1] === 'CL' ? 'clan' : 'is';

for (const r of rows) {
  const p = makePlatform(techBase, tonnage, reactorTier, frameTier, { reactor: r.cls, frame: r.cls });
  const delta = r.winRate - base;
  console.log(
    [
      r.cls,
      `${r.winRate.toFixed(1)} %`,
      `${delta >= 0 ? '+' : ''}${delta.toFixed(1)} п.п.`,
      `${r.winSpread[0].toFixed(0)}-${r.winSpread[1].toFixed(0)} %`,
      `${r.draws.toFixed(1)} %`,
      r.turns.toFixed(2),
      r.damage.toFixed(0),
      `${p.payloadMass.toFixed(2)} т`,
      String(p.totalStructure),
      String(p.baseHeatDiss),
    ]
      .map((s) => s.padEnd(12))
      .join(''),
  );
}

console.log(`\nконтроль (серийный против серийного): ${base.toFixed(1)} % — собственный шум замера`);

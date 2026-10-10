import {
  CampaignState,
  GALAXY,
  contractThreat,
  foundingInit,
  judgedContracts,
  lanceThreat,
  opforCount,
  opforTonsAverage,
  worldProfile,
} from '../src/core/campaign/index.js';
import { SCALE_IDS, type ScaleId } from '../src/core/campaign/contracts/schema.js';

/**
 * Диагностика биржи: КАКОГО РАЗМЕРА работа где водится (шаг 44, план Б).
 *
 * Отвечает ровно на два вопроса, от которых зависит вся ступень 44a:
 *
 * 1. Осталась ли медиана биржи копейной. Крупная работа задумана хвостом
 *    распределения, а не новой нормой: разъедься медиана, и фон вместе с
 *    экономикой роты поехали бы вслед за ней.
 * 2. Есть ли у стартовой роты работа по силам. Разброс сложности бесполезен,
 *    если в захолустье не осталось ничего, за что берётся тройка лёгких.
 *
 *   pnpm boardstat                 вся карта, декада 0
 *   pnpm boardstat --decades 4     четыре декады подряд (шире выборка)
 */

interface Args {
  readonly decades: number;
}

function parseArgs(argv: readonly string[]): Args {
  let decades = 1;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--decades') decades = Number(argv[++i]);
    else if (argv[i]?.startsWith('--')) throw new Error(`Неизвестный ключ: ${argv[i]}`);
  }
  return { decades };
}

function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2 : (sorted[mid] as number);
}

function pct(part: number, total: number): string {
  return total === 0 ? '—' : `${((part / total) * 100).toFixed(1)} %`;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const state = new CampaignState(1, { worldSeed: 42, company: foundingInit(1) });

  // Мерило «по силам»: стартовая рота. Её оценка берётся тем же `lanceThreat`,
  // которым меряют себя соперники и бот-менеджер, — второй формулы силы звена в
  // проекте нет и заводить её здесь нельзя.
  const starter = lanceThreat(state.company, state.company.mechs);

  const units: number[] = [];
  const tons: number[] = [];
  const force: number[] = [];
  const payouts: number[] = [];
  const doableForce: number[] = [];
  const doablePayouts: number[] = [];
  const byScale = new Map<ScaleId, number>(SCALE_IDS.map((id) => [id, 0]));
  const byClass = new Map<string, { offers: number; doable: number; units: number[] }>();
  let offersTotal = 0;
  let doableTotal = 0;

  for (let i = 0; i < GALAXY.count; i++) {
    const id = GALAXY.id(i);
    const profile = worldProfile(state.worldSeed, state.deltas, i);
    const cls = profile.marketClass;
    const bucket = byClass.get(cls) ?? { offers: 0, doable: 0, units: [] };

    for (let d = 0; d < args.decades; d++) {
      // Смотрим ВСЮ разыгранную биржу, включая закрытое порогом репутации
      // (`judgedContracts`): распределение масштаба — свойство мира, а не
      // послужного списка роты, и мерить его по видимой части значило бы мерить
      // репутацию.
      const board = judgedContracts(state.worldSeed, state.deltas, id, d * 10, state.reputation, state.war);
      for (const { contract: c, allowed } of board) {
        offersTotal++;
        units.push(opforCount(c));
        tons.push(c.opforTons);
        force.push(opforCount(c) * opforTonsAverage(c));
        payouts.push(c.payout);
        byScale.set(c.scale, (byScale.get(c.scale) ?? 0) + 1);
        bucket.offers++;
        bucket.units.push(opforCount(c));
        if (allowed && contractThreat(c) <= starter) {
          doableTotal++;
          bucket.doable++;
          doableForce.push(opforCount(c) * opforTonsAverage(c));
          doablePayouts.push(c.payout);
        }
      }
    }
    byClass.set(cls, bucket);
  }

  const avg = (v: readonly number[]): number => (v.length === 0 ? 0 : v.reduce((s, x) => s + x, 0) / v.length);

  process.stdout.write(
    [
      `биржа: ${offersTotal} предложений (${GALAXY.count} систем × ${args.decades} декад)`,
      `машин противника: медиана ${median(units)}, среднее ${avg(units).toFixed(2)}, максимум ${Math.max(...units)}`,
      `потолок тоннажа: медиана ${median(tons)}, среднее ${avg(tons).toFixed(1)}`,
      `сила работы (машино-тонны): медиана ${median(force).toFixed(1)}, среднее ${avg(force).toFixed(1)}`,
      `гонорар: медиана ${Math.round(median(payouts))}, среднее ${Math.round(avg(payouts))}, максимум ${Math.max(...payouts)}`,
      `по силам стартовой роте (оценка ${starter.toFixed(2)}): ${doableTotal} — ${pct(doableTotal, offersTotal)}`,
      `  из них: сила медиана ${median(doableForce).toFixed(1)} машино-тонн, гонорар медиана ${Math.round(median(doablePayouts))}`,
      '',
      'ступени масштаба:',
    ].join('\n'),
  );
  for (const id of SCALE_IDS) {
    const n = byScale.get(id) ?? 0;
    process.stdout.write(`  ${id.padEnd(11)} ${String(n).padStart(6)}  ${pct(n, offersTotal)}\n`);
  }

  process.stdout.write('\nпо классу рынка:\n');
  const classes = [...byClass.entries()].sort((a, b) => b[1].offers - a[1].offers);
  for (const [cls, b] of classes) {
    process.stdout.write(
      `  ${cls.padEnd(11)} предложений ${String(b.offers).padStart(5)}, машин в среднем ${avg(b.units).toFixed(2)}, по силам ${pct(b.doable, b.offers)}\n`,
    );
  }
}

main();

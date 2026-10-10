import { CampaignState, FACTIONS, WAR, ownerOf, GALAXY, type CampaignEvent } from '../src/core/campaign/index.js';
import { advanceAnswering } from '../src/sim/campaign/worldEvents.js';

/**
 * Кто с кем воюет в мире без игрока (проба 2026-09-28, перенесена шагом 82 из `tools/out/`).
 *
 * Пары захватов, набегов и даней, договоры, замыслы, подряды полков — и отдельной сводкой
 * великие полки: у кого подряды, сколько перелётов, где полк стоит в конце. Ради этой
 * сводки сборщик и перенесён: находка §10zg п. 8 («все 651 подряд — у Марика») пришла
 * отсюда, и проверяет её он же.
 *
 * `pnpm worldpairs --seed 1 --ticks 365`; `--pairs` печатает все пары, без него — только сводку.
 */
const arg = (name: string, fallback: number): number => {
  const i = process.argv.indexOf(name);
  return i < 0 ? fallback : Number(process.argv[i + 1]);
};
const seed = arg('--seed', 1);
const ticks = arg('--ticks', 365);
const showPairs = process.argv.includes('--pairs');

const kindOf = (id: string): string => FACTIONS.get(id)?.kind ?? '?';
const s = new CampaignState(seed);
const cnt = new Map<string, number>();
const inc = (map: Map<string, number>, k: string, n = 1): void => void map.set(k, (map.get(k) ?? 0) + n);
const byEmployer = new Map<string, number>();
const byPair = new Map<string, number>();
const regWon = new Map<string, number>();
const regJobs = new Map<string, number>();
const regMoves = new Map<string, number>();
const startOwners = new Map<string, number>();
for (let i = 0; i < GALAXY.count; i++) inc(startOwners, ownerOf(s.deltas, i));

for (let t = 1; t <= ticks; t++) {
  const r = advanceAnswering(s, t * WAR.economy.tickDays);
  if (!r.ok) throw new Error(String(r.reason));
  for (const e of r.events as readonly CampaignEvent[]) {
    if (e.kind === 'frontMoved') inc(cnt, `front ${e.kindOfMove} ${e.attacker}→${e.defender}`);
    else if (e.kind === 'diplomacyMoved') inc(cnt, `dipl ${e.move} ${e.over}→${e.under}${e.pact ? ' ' + e.pact : ''}`);
    else if (e.kind === 'warPlan') inc(cnt, `plan ${e.result} ${e.factionId}→${e.against}`);
    else if (e.kind === 'regimentCommission') {
      inc(byEmployer, e.employer);
      inc(byPair, `${e.employer}→${e.target}`);
      inc(regJobs, e.regimentName);
      if (e.won) inc(regWon, e.regimentName);
    } else if (e.kind === 'regimentMoved') inc(regMoves, e.regimentName);
    else if (e.kind === 'rivalContract') inc(cnt, `rival ${e.rivalName} ${e.result}`);
  }
}

const end = new Map<string, number>();
for (let i = 0; i < GALAXY.count; i++) inc(end, ownerOf(s.deltas, i));
const sorted = (m: Map<string, number>): [string, number][] => [...m].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));

console.log(`сид ${seed}, ${ticks} декад`);
if (showPairs) for (const [k, v] of sorted(cnt)) console.log(`${String(v).padStart(5)}  ${k}`);
const jobs = [...byEmployer.values()].reduce((a, b) => a + b, 0);
console.log(`\nподряды полков: ${jobs}, нанимателей ${byEmployer.size}`);
console.log('  по нанимателю: ' + sorted(byEmployer).map(([k, v]) => `${k} ${v}`).join(', '));
console.log('  пары (первые 12): ' + sorted(byPair).slice(0, 12).map(([k, v]) => `${k} ${v}`).join(', '));
console.log('полки (подряды / выиграно / перелёты → где в конце):');
for (const r of s.rivals.regiments) {
  const at = GALAXY.require(r.systemId);
  console.log(
    `  ${r.name}: ${regJobs.get(r.name) ?? 0} / ${regWon.get(r.name) ?? 0} / ${regMoves.get(r.name) ?? 0} → ` +
      `${r.systemId} (${ownerOf(s.deltas, at)}), ${r.mechs}/${r.fullMechs} машин`,
  );
}
console.log('\nмиры: ' + sorted(end).map(([f, n]) => `${f}(${kindOf(f)}) ${startOwners.get(f) ?? 0}→${n}`).join('; '));
const pair = (a: string, b: string): number =>
  [...cnt].filter(([k]) => k.startsWith('front capture') && (k.endsWith(`${a}→${b}`) || k.endsWith(`${b}→${a}`))).reduce((n, [, v]) => n + v, 0);
console.log(`захваты Марик — Штайнер: ${pair('marik', 'steiner')}; Лиао — Дэвион: ${pair('liao', 'davion')}`);

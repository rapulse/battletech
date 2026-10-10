/**
 * Снабжение частей противника на бирже (шаг 21a, часть C).
 *
 * Отвечает на вопрос замера: СДВИНУЛАСЬ ли средняя сложность биржи от привязки
 * снаряжения к экономике — и насколько разошлись фракции. Связь откалибрована
 * около нуля, поэтому среднее обязано стоять, а разброс — вырасти.
 *
 *   pnpm supplystat [сид] [сколько систем]
 */
import { CampaignState } from '../src/core/campaign/state.js';
import { contractBoard } from '../src/core/campaign/contracts/board.js';
import { CONTRACTS } from '../src/core/campaign/contracts/schema.js';
import { GALAXY } from '../src/core/campaign/galaxy/catalog.js';
import { factionKind } from '../src/core/campaign/contracts/relations.js';
import { supplyCount, supplyOutfit } from '../src/core/campaign/contracts/supply.js';

const seed = Number(process.argv[2] ?? 1);
const sample = Number(process.argv[3] ?? 400);
const state = new CampaignState(seed);

const step = Math.max(1, Math.floor(GALAXY.count / sample));
const supplies: number[] = [];
const threats: number[] = [];
const byType = new Map<string, number>();
const byFaction = new Map<string, { n: number; supply: number; threat: number }>();
const armor: number[] = [];
const isLadder: boolean[] = [];
const counts: number[] = [];
const missing: number[] = [];

for (let i = 0; i < GALAXY.count; i += step) {
  for (const c of contractBoard(state.worldSeed, state.deltas, GALAXY.id(i), 0, state.reputation, state.war)) {
    const threat = CONTRACTS.opfor.types[c.opforType].threat;
    const base = CONTRACTS.opfor.types[c.opforType].outfit;
    const out = supplyOutfit(base, c.supply);
    armor.push((out.armorShare[0] + out.armorShare[1]) / 2);
    missing.push((out.missingItems[0] + out.missingItems[1]) / 2);
    const kind = factionKind(c.target);
    isLadder.push(kind === 'house' || kind === 'comstar' || kind === 'mercenary');
    counts.push(supplyCount(c.supply));
    supplies.push(c.supply);
    threats.push(threat);
    byType.set(c.opforType, (byType.get(c.opforType) ?? 0) + 1);
    const row = byFaction.get(c.target) ?? { n: 0, supply: 0, threat: 0 };
    byFaction.set(c.target, { n: row.n + 1, supply: row.supply + c.supply, threat: row.threat + threat });
  }
}

const avg = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;
const sd = (a: number[]): number => {
  const m = avg(a);
  return Math.sqrt(avg(a.map((v) => (v - m) * (v - m))));
};

console.log(`сид ${seed}, систем ${Math.ceil(GALAXY.count / step)}, предложений ${supplies.length}`);
console.log(`link = ${CONTRACTS.opfor.supply.link}`);
console.log(`снабжение: сред ${avg(supplies).toFixed(4)}  разброс ${sd(supplies).toFixed(4)}  мин ${Math.min(...supplies).toFixed(3)}  макс ${Math.max(...supplies).toFixed(3)}`);
console.log(`угроза типа: сред ${avg(threats).toFixed(4)}  разброс ${sd(threats).toFixed(4)}`);
// Срез по Домам и КомСтару: только у них есть лестница militia → line → guard,
// на которую экономика вообще может подвинуть часть. Пираты, периферия и кланы
// стоят на своём типе при любой казне, и общее среднее по бирже — на 84 %
// пиратское — прячет весь эффект шага.
const ladder: number[] = [];
const ladderArmor: number[] = [];
const ladderSupply: number[] = [];
for (let k = 0; k < supplies.length; k++) {
  if (!isLadder[k]) continue;
  ladder.push(threats[k] as number);
  ladderArmor.push(armor[k] as number);
  ladderSupply.push(supplies[k] as number);
}
console.log(
  `ЛЕСТНИЧНЫЕ цели (${ladder.length} предл.): снабжение сред ${avg(ladderSupply).toFixed(4)}` +
    `  угроза сред ${avg(ladder).toFixed(4)} разброс ${sd(ladder).toFixed(4)}` +
    `  броня сред ${avg(ladderArmor).toFixed(4)} разброс ${sd(ladderArmor).toFixed(4)}`,
);
console.log(`машин против звена: сред ${avg(counts).toFixed(4)}  разброс ${sd(counts).toFixed(4)}`);
console.log(`броня противника: сред ${avg(armor).toFixed(4)}  разброс ${sd(armor).toFixed(4)}`);
console.log(`не поставлено стволов: сред ${avg(missing).toFixed(4)}  разброс ${sd(missing).toFixed(4)}`);
console.log('типы частей:', [...byType].sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${((n / supplies.length) * 100).toFixed(1)}%`).join('  '));

console.log('\nпо фракции цели (снабжение / средняя угроза типа):');
for (const [id, r] of [...byFaction].sort((a, b) => b[1].supply / b[1].n - a[1].supply / a[1].n)) {
  console.log(
    id.padEnd(15),
    (factionKind(id) ?? '').padEnd(11),
    String(r.n).padStart(5),
    (r.supply / r.n).toFixed(3).padStart(7),
    (r.threat / r.n).toFixed(3).padStart(7),
  );
}

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  FACTIONS,
  GALAXY,
  PLAYER_ACTOR_ID,
  WAR,
  dateOf,
  frontSectors,
  frontShares,
  frontWeights,
  ownerOf,
  sectorForces,
  standingOf,
  withDelta,
  withStanding,
  worldContributionAt,
  type CampaignCommand,
  type CampaignEvent,
} from '../src/core/campaign/index.js';
import { frontierIndexAt } from '../src/core/campaign/contracts/index.js';
import { prosperityOf } from '../src/core/campaign/war/economy.js';
import { pushOf, type FrontSector } from '../src/core/campaign/war/front.js';
import { planWeight } from '../src/core/campaign/war/plans.js';
import type { Storage } from '../src/platform/Storage.js';
import { CampaignUi } from '../src/ui/state/campaign.svelte.js';
import { advanceAnswering } from '../src/sim/campaign/worldEvents.js';

/**
 * Игра державой по ходам из терминала — проба к шагу 77, не инструмент замера.
 *
 * Один запуск — один ход игрока: загрузить сохранение тем же путём, что «Продолжить» в меню
 * (`CampaignUi.continueCampaign`), отдать команды тем же `run`, что и кнопки экрана, прокрутить
 * время и напечатать то, что игрок видит на вкладке «Держава». Прокрутка идёт `execute` напрямую,
 * чтобы напечатать события, касающиеся державы.
 *
 *   pnpm vite-node scripts/realmplay.ts -- setup [--seed 5] [--day 1680] [--cbills 10800000]
 *   pnpm vite-node scripts/realmplay.ts -- status
 *   pnpm vite-node scripts/realmplay.ts -- do '{"kind":"raiseRegiment","mechs":10}'
 *   pnpm vite-node scripts/realmplay.ts -- adv 30
 */

const DIR = join(import.meta.dirname, '.realmplay', process.env.REALM_SLOT ?? '');

class FileStorage implements Storage {
  save(slot: string, data: Uint8Array): Promise<void> {
    mkdirSync(DIR, { recursive: true });
    writeFileSync(join(DIR, slot), data);
    return Promise.resolve();
  }
  load(slot: string): Promise<Uint8Array | null> {
    const p = join(DIR, slot);
    return Promise.resolve(existsSync(p) ? new Uint8Array(readFileSync(p)) : null);
  }
  list(): Promise<string[]> {
    return Promise.resolve(existsSync(DIR) ? readdirSync(DIR).sort() : []);
  }
  remove(slot: string): Promise<void> {
    rmSync(join(DIR, slot), { force: true });
    return Promise.resolve();
  }
}

const M = (n: number): string => `${(n / 1e6).toFixed(2)} млн`;
const fname = (id: string): string => (id === PLAYER_ACTOR_ID ? 'РОТА' : (FACTIONS.get(id)?.name ?? id));
const sname = (id: string | number): string => GALAXY.name(typeof id === 'number' ? id : GALAXY.require(id));
const date = (day: number): string => {
  const d = dateOf(day);
  return `${String(d.day).padStart(2, '0')}.${String(d.month).padStart(2, '0')}.${d.year}`;
};

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? fallback : Number(process.argv[i + 1]);
}

async function load(): Promise<CampaignUi> {
  const ui = new CampaignUi(new FileStorage());
  if (!(await ui.continueCampaign())) throw new Error('нет сохранения: сначала setup');
  return ui;
}

/**
 * Старт: мир прокручен до дня, на котором бот сида 5 (`pnpm camp --seeds 5 --contracts 60 --fidelity
 * fast`) закончил контракты, и рота получает то, что бот заработал: кассу, славу, отношение 100 с
 * нанимателем. Три победы на пограничном мире за его владельца — условие лена; их бот и набирает
 * контрактами, здесь они выставлены прямо. Мир выбирает скрипт: самый доходный не-столичный мир
 * Великого Дома с фронтовым индексом от `grantFrontier` и соседом-Домом другого флага.
 */
async function setup(): Promise<void> {
  rmSync(DIR, { recursive: true, force: true });
  const seed = arg('seed', 5);
  const ui = new CampaignUi(new FileStorage());
  ui.newCampaign({ seed, name: 'Проба', commander: '', emblem: 0 });
  const s = ui.state;
  s.company = { ...s.company, cbills: 1e12 };
  advanceAnswering(s, arg('day', 1680));

  let best = -Infinity;
  let bestIdx = -1;
  for (let i = 0; i < GALAXY.count; i++) {
    if (GALAXY.hasFlag(i, 'capital')) continue;
    const owner = ownerOf(s.deltas, i);
    if (FACTIONS.get(owner)?.kind !== 'house') continue;
    const houseFoe = GALAXY.neighbors(i).some((j) => {
      const o = ownerOf(s.deltas, j);
      return o !== owner && FACTIONS.get(o)?.kind === 'house';
    });
    if (!houseFoe) continue;
    const f = frontierIndexAt(s.deltas, s.reputation, s.war, i);
    if (f < WAR.domain.grantFrontier) continue;
    // Игрок выбирает, на каком мире служить, и видит его доход на карточке системы.
    const c = worldContributionAt(s.worldSeed, s.deltas, i);
    const score = c.income - c.upkeep;
    if (score > best) {
      best = score;
      bestIdx = i;
    }
  }
  if (bestIdx < 0) throw new Error('нет мира под лен');
  const owner = ownerOf(s.deltas, bestIdx);
  const id = GALAXY.id(bestIdx);
  s.systemId = id;
  s.travel = null;
  s.reputation = withStanding(s.reputation, owner, 100 - standingOf(s.reputation, owner));
  s.reputation = { ...s.reputation, fame: 100 };
  s.deltas = withDelta(s.deltas, id, { fought: 3, foughtWon: 3, foughtFor: owner, foughtYear: dateOf(s.day).year });
  s.company = { ...s.company, cbills: arg('cbills', 10_800_000) };
  console.log(`старт: ${date(s.day)}, мир ${sname(id)} (${fname(owner)}), итог мира ${M(best)} / декаду при плече 0`);
  console.log('лен:', ui.why({ kind: 'claimGrant' }) ?? 'можно');
  await ui.save();
}

function status(ui: CampaignUi): void {
  const s = ui.state;
  console.log(`\n=== ${date(s.day)} (день ${s.day}) · касса ${M(s.company.cbills)} · стоим: ${sname(s.systemId)}`);
  if (!ui.hasRealm) {
    console.log('державы нет');
    return;
  }
  const r = ui.realm;
  console.log(`держава: миров ${r.worlds}, доход ${M(r.income)}, содержание ${M(r.upkeep)}, дань ${M(r.flows)}, итог ${M(r.net)} / декаду`);
  for (const w of ui.realmWorlds) {
    const threats = w.threats.map((t) => fname(t.attacker)).join(', ');
    console.log(
      `  ${w.capital ? '★' : ' '} ${w.name}: доход ${M(w.income)}, содерж. ${M(w.upkeep)}, мощн. ${w.capacity.toFixed(1)}, фокус ${w.focus}, разв. ${w.development}, разор. ${w.ruined}` +
        (w.tributeTo ? `, ДАНЬ → ${fname(w.tributeTo)}` : '') +
        (threats ? `, угрозы: ${threats}` : ''),
    );
  }
  const a = ui.realmArmy;
  console.log(`армия: всего ${a.total}, резерв ${a.reserve}, потолок ${a.cap} (мощн. ${a.capacity.toFixed(1)}), машина ${M(a.mechPrice)}; театры: ${a.theaters.map((t) => `${fname(t.against)} ${t.mechs}`).join(', ') || '—'}`);
  const p = ui.realmPrices;
  if (p) console.log(`цены: договор ${M(p.pact)}, протекторат ${M(p.protectorate)}, фокус ${M(p.focus)}, развитие ${M(p.develop)}`);
  console.log('соседи:');
  for (const n of ui.realmNeighbours) {
    console.log(
      `  ${fname(n.factionId)} [${n.factionId}]: отношение ${n.standing.toFixed(0)}${n.atWar ? ', ВОЙНА' : ''}${n.pact ? `, договор ${n.pact.kind} до ${date(n.pact.untilDay)}` : ''}${n.vassal ? ', вассал' : ''}`,
    );
    for (const x of n.systems) {
      const c = worldContributionAt(s.worldSeed, s.deltas, GALAXY.require(x.id));
      console.log(
        `      ${x.name}${x.capital ? ' (столица)' : ''}${x.tributeTo ? ` дань→${fname(x.tributeTo)}` : ''}: цена ${M(ui.worldPriceAt(x.id))}, доход ${M(c.income)}, содерж. у владельца ${M(c.upkeep)}`,
      );
    }
  }
  for (const w of ui.realmWars) {
    console.log(`война с ${fname(w.factionId)}: с ${date(w.since)}, взято ${w.won}, потеряно ${w.lost}, мир: ${JSON.stringify(w.terms)}`);
  }
  const sectors = frontSectors(s.war, s.reputation, s.deltas, s.day);
  const shares = frontShares(frontWeights(sectors));
  const ours = sectors.filter((x) => x.attacker === PLAYER_ACTOR_ID || x.defender === PLAYER_ACTOR_ID);
  // Вес выбора участка — формула `front.ts::pickSector`, повторённая здесь для показа.
  const pick = (x: FrontSector): number =>
    x.enmity * x.adjacent * prosperityOf(s.war, x.attacker) * pushOf(s.war, x.attacker, x.defender) * planWeight(s.war, x);
  const total = sectors.reduce((acc, x) => acc + pick(x), 0);
  const share = (xs: FrontSector[]): number => xs.reduce((acc, x) => acc + pick(x), 0) / total;
  if (ours.length > 0) {
    const att = ours.filter((x) => x.attacker === PLAYER_ACTOR_ID);
    const def = ours.filter((x) => x.defender === PLAYER_ACTOR_ID);
    const perDecade = (WAR.front.attemptsMin + WAR.front.attemptsMax) / 2;
    console.log(
      `участки фронта с ротой (${ours.length} из ${sectors.length}): доля в выборе такта — наступление роты ${(share(att) * 100).toFixed(2)} %, на роту ${(share(def) * 100).toFixed(2)} %; ` +
        `ожидаемо боёв роты за декаду ${(share(att) * perDecade).toFixed(3)}, на роту ${(share(def) * perDecade).toFixed(3)}`,
    );
    for (const x of ours) {
      const f = sectorForces(s.war, s.worldSeed, s.deltas, x, shares);
      console.log(`  ${fname(x.attacker)} → ${sname(x.system)} (${fname(x.defender)}): шанс ${(f.odds * 100).toFixed(0)} %, силы ${f.attack.toFixed(2)} / ${f.defence.toFixed(2)}`);
    }
  }
}

function involvesPlayer(e: CampaignEvent): boolean {
  const v = e as unknown as Record<string, unknown>;
  return ['attacker', 'defender', 'over', 'under', 'owner', 'from', 'to'].some((k) => v[k] === PLAYER_ACTOR_ID);
}

const ALWAYS = new Set([
  'domainTicked',
  'realmChanged',
  'regimentRaised',
  'worldGranted',
  'worldBought',
  'worldConquered',
  'worldAbandoned',
  'peaceMade',
  'capitalMoved',
  'tributeBought',
  'contractResolved',
  'payrollPaid',
]);

function printEvents(ui: CampaignUi, events: readonly CampaignEvent[]): void {
  let day = ui.state.day;
  let income = 0;
  let upkeep = 0;
  let payroll = 0;
  let ticks = 0;
  for (const e of events) {
    if (e.kind === 'taskDue') day = e.day;
    if (e.kind === 'domainTicked') {
      income += e.income;
      upkeep += e.upkeep;
      ticks++;
      continue;
    }
    if (e.kind === 'payrollPaid') {
      payroll += e.amount;
      continue;
    }
    if (!ALWAYS.has(e.kind) && !involvesPlayer(e)) continue;
    const { kind, ...rest } = e as unknown as { kind: string } & Record<string, unknown>;
    console.log(`  ${date(day)} ${kind} ${JSON.stringify(rest)}`);
  }
  if (ticks > 0) console.log(`  домен за ${ticks} декад: доход ${M(income)}, содержание ${M(upkeep)}`);
  if (payroll > 0) console.log(`  жалованье роты: ${M(payroll)}`);
}

async function main(): Promise<void> {
  const [cmd, a1] = process.argv.slice(2).filter((x) => x !== '--');
  if (cmd === 'setup') return setup();
  const ui = await load();
  if (cmd === 'do') {
    const command = JSON.parse(a1 as string) as CampaignCommand;
    const why = ui.why(command);
    const ok = ui.run(command);
    console.log(`${command.kind}: ${ok ? 'сделано' : `отказ — ${why ?? ui.rejectText}`}`);
    if (ok) console.log('  журнал:', JSON.stringify(ui.logs[0] ?? null));
  } else if (cmd === 'wins') {
    // Допущение пробы: три победы роты на этом мире за его владельца — то, что дали бы контракты здесь.
    const s = ui.state;
    const owner = ownerOf(s.deltas, GALAXY.require(s.systemId));
    s.deltas = withDelta(s.deltas, s.systemId, { fought: 3, foughtWon: 3, foughtFor: owner, foughtYear: dateOf(s.day).year });
    console.log(`допущение: 3 победы на ${sname(s.systemId)} за ${fname(owner)}`);
  } else if (cmd === 'adv') {
    const r = advanceAnswering(ui.state, ui.state.day + Number(a1 ?? 10));
    if (!r.ok) console.log('прокрутка: отказ', r.reason);
    else printEvents(ui, r.events);
  }
  status(ui);
  await ui.save();
}

void main();

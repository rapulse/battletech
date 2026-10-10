import { beforeAll, describe, expect, it } from 'vitest';
import { CampaignState } from '../src/core/campaign/state.js';
import { BUILDING_KINDS } from '../src/core/campaign/war/schema.js';
import { restore, snapshot } from '../src/core/campaign/save.js';
import { hashCampaignState } from '../src/core/campaign/hash.js';
import { FACTIONS, FACTION_LIST, GALAXY } from '../src/core/campaign/galaxy/catalog.js';
import { ownerOf } from '../src/core/campaign/galaxy/delta.js';
import {
  EVENTS,
  PLAYER_ACTOR_ID,
  economyOf,
  makeWarState,
  pendingEvents,
  totalArmy,
} from '../src/core/campaign/war/index.js';
import { advanceAnswering } from '../src/sim/campaign/worldEvents.js';
import { playRealmState, type RealmSeedResult } from '../src/sim/campaign/realmBot.js';
import { shipboardMechs } from '../src/core/campaign/company/garrison.js';
import { mechCapacityOf } from '../src/core/campaign/company/types.js';

/**
 * ЗДОРОВЬЕ ВТОРОЙ ЧАСТИ — мир и держава на длинной дистанции.
 *
 * Остальные тесты мира проверяют правила по одному: такт воспроизводим, мир берётся при таком-то
 * условии. Здесь — весь цикл целиком, тем же кодом, что в игре (`execute` через
 * `advanceAnswering`): десять лет фонового мира и два года бота державы. Утверждения — инварианты
 * и коридоры `wiki/overview/corridors.md` §4, которые до сих пор сверялись только глазами по выводу
 * `pnpm worldstat` / `pnpm realm`. Дорого (около полутора минут), и это цена: поломка, которая
 * видна только на пятом году, иначе всплывает лишь на замере шага.
 */

const YEARS = 10;
const DAYS = YEARS * 365;

describe('здоровье второй части: фоновый мир за десять лет (сид 1)', () => {
  let s: CampaignState;
  beforeAll(async () => {
    s = new CampaignState(1);
    // По году за раз, отдавая управление между годами: десять лет одним синхронным куском держат
    // поток воркера минуту, и vitest не успевает получить от него отчёт («Timeout calling
    // onTaskUpdate» при зелёных тестах).
    for (let year = 1; year <= YEARS; year++) {
      const r = advanceAnswering(s, year * 365);
      if (!r.ok) throw new Error(`прокрутка отклонена: ${String(r.reason)}`);
      await new Promise((done) => setTimeout(done, 0));
    }
  }, 300_000);

  it('мир дошёл до конца, открытых карточек нет', () => {
    expect(s.day).toBe(DAYS);
    expect(pendingEvents(s.war)).toEqual([]);
  });

  it('у каждого мира известный владелец, числа экономики и армий конечны', () => {
    for (let i = 0; i < GALAXY.count; i++) {
      const o = ownerOf(s.deltas, i);
      expect(o === PLAYER_ACTOR_ID || FACTIONS.has(o), `${GALAXY.id(i)}: ${o}`).toBe(true);
    }
    for (const f of FACTION_LIST) {
      const e = economyOf(s.war, f.id);
      for (const [k, v] of Object.entries(e)) expect(Number.isFinite(v), `${f.id}.${k} = ${v}`).toBe(true);
      expect(totalArmy(s.war, f.id)).toBeGreaterThanOrEqual(0);
    }
  });

  it('приращение экономики сходится с пересчётом с нуля', () => {
    // Тот же инвариант, что у `war.test.ts` («ловушка суммы»), но через настоящую очередь: с
    // соперниками, полками, развитием и событиями мира, которых тестовый марш тактов не зовёт.
    const rebuilt = makeWarState(s.worldSeed, s.deltas);
    for (const f of FACTION_LIST) {
      const live = economyOf(s.war, f.id);
      const fresh = economyOf(rebuilt, f.id);
      expect(live.worlds, f.id).toBe(fresh.worlds);
      expect(live.income, f.id).toBe(fresh.income);
      expect(live.upkeep, f.id).toBe(fresh.upkeep);
      expect(live.capacity, f.id).toBe(fresh.capacity);
    }
  });

  it('карта не схлопывается: крупнейший не больше четверти, Великие Дома живы', () => {
    const count = new Map<string, number>();
    for (let i = 0; i < GALAXY.count; i++) {
      const o = ownerOf(s.deltas, i);
      count.set(o, (count.get(o) ?? 0) + 1);
    }
    const largest = Math.max(...count.values());
    expect(largest / GALAXY.count).toBeLessThanOrEqual(0.25);
    for (const f of FACTION_LIST) {
      if (f.kind === 'house') expect(count.get(f.id) ?? 0, f.id).toBeGreaterThanOrEqual(100);
    }
  });

  it('великие полки укомплектованы не ниже коридора 0.75 (corridors.md §4)', () => {
    const regs = s.rivals.regiments;
    expect(regs.length).toBeGreaterThan(0);
    const share = regs.reduce((a, r) => a + r.mechs / r.fullMechs, 0) / regs.length;
    expect(share).toBeGreaterThanOrEqual(0.75);
    for (const r of regs) expect(Number.isFinite(r.cbills), r.id).toBe(true);
  });

  // Известное нарушение коридора (notes.md §10zh п. 1): гонорар полка из фонда живого фронта, а
  // содержания у полка нет. Тест «падает, как и ожидается»; когда касса полков вернётся в коридор,
  // он упадёт по-настоящему — тогда снять `.fails`.
  it.fails('касса великого полка не выше 150 млн (коридор нарушен, §10zh)', () => {
    for (const r of s.rivals.regiments) expect(r.cbills, r.id).toBeLessThanOrEqual(150_000_000);
  });

  it('вехи эпохи сработали в своих окнах и закрыты', () => {
    const fired = Object.keys(s.war.events);
    // На сиде 1 за десять лет — Отказ, Уиттинг, «Бульдог», ФедКом; Коты отменены по условию.
    for (const id of ['refusal-war', 'whitting-conference', 'operation-bulldog', 'fedcom-civil-war']) {
      expect(fired, id).toContain(id);
    }
    for (const id of fired) {
      expect(EVENTS.events.some((e) => e.id === id)).toBe(true);
      expect(s.war.events[id]?.pending).toBe(false);
    }
  });

  it('снимок через десять лет восстанавливается в то же состояние', () => {
    const back = restore(JSON.parse(JSON.stringify(snapshot(s))));
    expect(hashCampaignState(back)).toBe(hashCampaignState(s));
  });
});

describe('здоровье второй части: держава бота за два года (сид 1)', () => {
  let r: RealmSeedResult;
  let end: CampaignState;
  beforeAll(() => {
    // Тот же бот, что у `pnpm realm` (`sim/campaign/realmBot.ts`): лен, армия, бюджет войны, война
    // соседу, приказы армии, мир.
    ({ result: r, state: end } = playRealmState(1, {
      seeds: [1],
      years: 2,
      startDay: 720,
      cash: 10_800_000,
      policy: 'war',
      warShare: 0.75,
      noArmy: false,
      joinCoalition: false,
      noRevolt: false,
      lead: false,
      // Гарнизон (шаг 86b) и стройка (шаг 87) — включены: инварианты ниже проверяют и их.
      garrison: true,
      build: true,
      govern: false,
      hire: false,
      pirates: false,
      warWork: false,
      verbose: false,
    }));
  }, 300_000);

  it('держава жива, числа конечны', () => {
    expect(r.realmLost).toBe(false);
    expect(r.worldsEnd).toBeGreaterThanOrEqual(1);
    expect(r.worldsMax).toBeGreaterThanOrEqual(r.worldsEnd);
    for (const [k, v] of Object.entries(r)) {
      if (typeof v === 'number') expect(Number.isFinite(v), `${k} = ${v}`).toBe(true);
    }
  });

  it('держава воюет: война объявлена, армия выходит в бой, приказы идут', () => {
    expect(r.wars).toBeGreaterThanOrEqual(1);
    expect(r.battlesAttack + r.battlesDefence).toBeGreaterThan(0);
    expect(r.orders).toBeGreaterThan(0);
    expect(r.armyEnd).toBeGreaterThan(0);
  });

  it('лояльность (шаг 85): есть ровно у миров державы, 0–100, с прежним владельцем; восстание — только у неё', () => {
    for (const [id, d] of Object.entries(end.deltas)) {
      const own = d.owner === PLAYER_ACTOR_ID;
      expect(d.loyalty !== undefined, id).toBe(own);
      expect(d.formerOwner !== undefined, id).toBe(own);
      if (d.revoltSince !== undefined) expect(own, id).toBe(true);
      if (d.loyalty !== undefined) {
        expect(d.loyalty, id).toBeGreaterThanOrEqual(0);
        expect(d.loyalty, id).toBeLessThanOrEqual(100);
      }
      expect(d.formerOwner, id).not.toBe(PLAYER_ACTOR_ID);
    }
    expect(r.loyaltyEnd).toBeGreaterThan(0);
    expect(r.suppressed).toBeLessThanOrEqual(r.revolts);
  });

  it('гарнизон (шаг 86b): пост — у машины роты на мире державы; место в ангаре — по машинам на корабле', () => {
    const ids = new Set(end.company.mechs.map((m) => m.id));
    for (const [id, post] of Object.entries(end.garrison.posts)) {
      expect(ids.has(id), id).toBe(true);
      expect(end.deltas[post.systemId]?.owner, id).toBe(PLAYER_ACTOR_ID);
    }
    expect(r.garrisonWorldDecades).toBeGreaterThan(0);
    expect(shipboardMechs(end.company, end.garrison).length).toBeLessThanOrEqual(mechCapacityOf(end.company));
  });

  it('постройки (шаг 87): стройка идёт только на мире державы, готовые — без повторов, в порядке видов', () => {
    // Сколько построено, здесь не проверяется: держава в один мир при бюджете 0.75 за два года копит около
    // 2.5 млн (сид 1) — меньше самой дешёвой постройки. Срок и такт стройки — `buildings.test.ts`.
    for (const [id, d] of Object.entries(end.deltas)) {
      if (d.building !== undefined) expect(d.owner, id).toBe(PLAYER_ACTOR_ID);
      expect(d.buildProgress !== undefined, id).toBe(d.building !== undefined);
      if (d.buildings !== undefined) {
        expect(d.buildings.length, id).toBeGreaterThan(0);
        expect([...d.buildings], id).toEqual(BUILDING_KINDS.filter((k) => d.buildings?.includes(k)));
      }
    }
  });
});

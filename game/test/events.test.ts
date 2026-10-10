import { describe, expect, it } from 'vitest';
import { CampaignState } from '../src/core/campaign/state.js';
import { execute } from '../src/core/campaign/commands/execute.js';
import { CampaignRejectReason } from '../src/core/campaign/commands/types.js';
import { restore, snapshot } from '../src/core/campaign/save.js';
import { hashCampaignState } from '../src/core/campaign/hash.js';
import { GALAXY } from '../src/core/campaign/galaxy/catalog.js';
import { ownerOf, withDelta, type GalaxyDeltas } from '../src/core/campaign/galaxy/delta.js';
import { relationOf, standingOf } from '../src/core/campaign/reputation/state.js';
import {
  EVENTS,
  PLAYER_ACTOR_ID,
  atWarWithPlayer,
  eventDef,
  eventTick,
  eventWindow,
  frontSectors,
  pactOf,
  pendingEvents,
  planOf,
} from '../src/core/campaign/war/index.js';
import { advanceAnswering } from '../src/sim/campaign/worldEvents.js';

/**
 * События мира (шаг 84): вехи эпохи из `data/events.json`. Такт — `war/events.ts::eventTick`,
 * остановка прокрутки — `commands/execute.ts::executeAdvance`, ответ — команда `answerEvent`.
 */

function def(id: string) {
  const d = eventDef(id);
  if (d === undefined) throw new Error(`нет события ${id}`);
  return d;
}

/** Все миры `from` отдать `to` — «фракции больше нет». */
function hand(deltas: GalaxyDeltas, from: string, to: string): GalaxyDeltas {
  let out = deltas;
  for (let i = 0; i < GALAXY.count; i++) if (ownerOf(out, i) === from) out = withDelta(out, GALAXY.id(i), { owner: to });
  return out;
}

/** Мир Куриты, соседний с Ягуарами, — граница державы с Ягуарами, если отдать его роте. */
function kuritaOnJaguarBorder(deltas: GalaxyDeltas): string {
  for (let i = 0; i < GALAXY.count; i++) {
    if (ownerOf(deltas, i) !== 'kurita' || GALAXY.hasFlag(i, 'capital')) continue;
    if (GALAXY.neighbors(i).some((j) => ownerOf(deltas, j) === 'smoke_jaguar')) return GALAXY.id(i);
  }
  throw new Error('нет мира Куриты у границы Ягуаров');
}

describe('события мира (шаг 84)', () => {
  it('таблица читается: окна в порядке, у каждого события есть действия', () => {
    expect(EVENTS.events.length).toBeGreaterThanOrEqual(6);
    for (const e of EVENTS.events) {
      const w = eventWindow(e);
      expect(w.until).toBeGreaterThan(w.from);
      expect(e.do.length).toBeGreaterThan(0);
    }
  });

  it('срабатывает в окне один раз, отдаёт команды и ждёт ответа', () => {
    const s = new CampaignState(1);
    const until = eventWindow(def('refusal-war')).until;
    const before = relationOf(s.reputation, 'jade_falcon', 'wolf');
    const first = eventTick(s.war, s.reputation, s.deltas, s.worldSeed, until);
    expect(first.fired.map((f) => f.id)).toContain('refusal-war');
    expect(first.war.events['refusal-war']).toMatchObject({ day: until, pending: true, realm: false });
    expect(relationOf(first.reputation, 'jade_falcon', 'wolf')).toBe(Math.min(before, -0.6));
    expect(planOf(first.war, 'jade_falcon')?.against).toBe('wolf');

    // Второй раз — нет: событие одно на кампанию.
    const again = eventTick(first.war, first.reputation, s.deltas, s.worldSeed, until);
    expect(again.fired.map((f) => f.id)).not.toContain('refusal-war');
  });

  it('вне окна и при невыполненном условии — не срабатывает', () => {
    const s = new CampaignState(1);
    const w = eventWindow(def('operation-bulldog'));
    const ids = (day: number, deltas = s.deltas): string[] =>
      eventTick(s.war, s.reputation, deltas, s.worldSeed, day).fired.map((f) => f.id);
    expect(ids(w.from - 1)).not.toContain('operation-bulldog');
    expect(ids(w.until + 1)).not.toContain('operation-bulldog');
    // Ягуаров съели Новые Коты — «Бульдогу» бить не по кому.
    const eaten = hand(s.deltas, 'smoke_jaguar', 'nova_cat');
    const r = eventTick(s.war, s.reputation, eaten, s.worldSeed, w.until);
    expect(r.fired.map((f) => f.id)).not.toContain('operation-bulldog');
    expect(r.war.truceLifted).toEqual([]);
  });

  it('день срабатывания воспроизводим по сиду мира', () => {
    const firedDay = (seed: number): number | undefined => {
      const s = new CampaignState(seed);
      const w = eventWindow(def('whitting-conference'));
      for (let day = w.from; day <= w.until; day += 10) {
        const r = eventTick(s.war, s.reputation, s.deltas, s.worldSeed, day);
        if (r.fired.some((f) => f.id === 'whitting-conference')) return day;
      }
      return undefined;
    };
    const a = firedDay(3);
    expect(a).toBeDefined();
    expect(firedDay(3)).toBe(a);
  });

  it('«Бульдог» снимает перемирие Тукайида с пары: Курита берёт миры Ягуаров, а не набегает', () => {
    const s = new CampaignState(1);
    const day = eventWindow(def('operation-bulldog')).until;
    const r = eventTick(s.war, s.reputation, s.deltas, s.worldSeed, day);
    expect(r.war.truceLifted).toContain('kurita|smoke_jaguar');
    expect(planOf(r.war, 'kurita')?.against).toBe('smoke_jaguar');
    const sectors = frontSectors(r.war, r.reputation, s.deltas, day);
    const onJaguars = sectors.filter((x) => x.attacker === 'kurita' && x.defender === 'smoke_jaguar');
    expect(onJaguars.length).toBeGreaterThan(0);
    expect(sectors.filter((x) => x.attacker === 'smoke_jaguar' && x.defender === 'kurita').every((x) => !x.raid)).toBe(true);
    // Без события — ни одного участка Сферы на Ягуаров: перемирие держит.
    expect(frontSectors(s.war, s.reputation, s.deltas, day).some((x) => x.defender === 'smoke_jaguar' && x.attacker === 'kurita')).toBe(false);
  });

  it('ФедКом: вражда Штайнер — Дэвион без общей границы (её нет в каталоге)', () => {
    const s = new CampaignState(1);
    const r = eventTick(s.war, s.reputation, s.deltas, s.worldSeed, eventWindow(def('fedcom-civil-war')).until);
    expect(r.fired.map((f) => f.id)).toContain('fedcom-civil-war');
    expect(relationOf(r.reputation, 'steiner', 'davion')).toBeLessThanOrEqual(-0.2);
  });

  it('Уиттинг — перемирия между граничащими Домами', () => {
    const s = new CampaignState(1);
    const day = eventWindow(def('whitting-conference')).until;
    const r = eventTick(s.war, s.reputation, s.deltas, s.worldSeed, day);
    expect(pactOf(r.war, 'davion', 'liao')?.kind).toBe('truce');
    expect(pactOf(r.war, 'kurita', 'steiner')?.kind).toBe('truce');
  });

  it('карточка останавливает прокрутку в день события, ответ отпускает время', () => {
    const w = eventWindow(def('whitting-conference'));
    const s = new CampaignState(2, { startDay: w.until - 25 });
    const target = w.until + 40;
    const r = execute(s, { kind: 'advanceTo', day: target });
    expect(r.ok).toBe(true);
    expect(s.day).toBeLessThan(target);
    const pending = pendingEvents(s.war);
    expect(pending.length).toBeGreaterThan(0);
    expect(r.ok && r.events.some((e) => e.kind === 'worldEvent')).toBe(true);

    const blocked = execute(s, { kind: 'advance', days: 1 });
    expect(blocked.ok ? null : blocked.reason).toBe(CampaignRejectReason.EventPending);
    expect(execute(s, { kind: 'answerEvent', id: 'no-such' }).ok).toBe(false);

    for (const id of pending) expect(execute(s, { kind: 'answerEvent', id }).ok).toBe(true);
    expect(execute(s, { kind: 'advanceTo', day: target }).ok).toBe(true);
    expect(s.day).toBe(target);
  });

  it('приглашение в коалицию: без ответа не закрыть; принять — война и прибавка союзникам', () => {
    const s = new CampaignState(1);
    const mine = kuritaOnJaguarBorder(s.deltas);
    s.deltas = withDelta(s.deltas, mine, { owner: PLAYER_ACTOR_ID });
    const day = eventWindow(def('operation-bulldog')).until;
    const r = eventTick(s.war, s.reputation, s.deltas, s.worldSeed, day);
    s.war = r.war;
    s.reputation = r.reputation;
    const record = s.war.events['operation-bulldog'];
    expect(record?.realm).toBe(true);
    expect(record?.invite?.against).toBe('smoke_jaguar');
    expect(record?.invite?.allies).toContain('kurita');

    const noAnswer = execute(s, { kind: 'answerEvent', id: 'operation-bulldog' });
    expect(noAnswer.ok ? null : noAnswer.reason).toBe(CampaignRejectReason.EventAnswerRequired);

    const kuritaBefore = standingOf(s.reputation, 'kurita');
    const accepted = execute(s, { kind: 'answerEvent', id: 'operation-bulldog', accept: true });
    expect(accepted.ok).toBe(true);
    expect(atWarWithPlayer(s.war, s.reputation, 'smoke_jaguar', s.day)).toBe(true);
    expect(standingOf(s.reputation, 'kurita')).toBe(kuritaBefore + 10);
    expect(s.war.events['operation-bulldog']?.pending).toBe(false);
  });

  // Держава роты под перемирием Тукайида не стоит (шаг 72d), и клан ей враг от рождения: по вражде
  // она уже «воюет» с Ягуарами. Отказ записи войны не заводит и стоит отношения союзников.
  it('отказ от приглашения стоит отношения союзников и записи войны не заводит', () => {
    const s = new CampaignState(1);
    s.deltas = withDelta(s.deltas, kuritaOnJaguarBorder(s.deltas), { owner: PLAYER_ACTOR_ID });
    const r = eventTick(s.war, s.reputation, s.deltas, s.worldSeed, eventWindow(def('operation-bulldog')).until);
    s.war = r.war;
    s.reputation = r.reputation;
    const before = standingOf(s.reputation, 'kurita');
    expect(execute(s, { kind: 'answerEvent', id: 'operation-bulldog', accept: false }).ok).toBe(true);
    expect(standingOf(s.reputation, 'kurita')).toBe(before - 5);
    expect(s.war.playerWars?.smoke_jaguar).toBeUndefined();
  });

  it('сработавшие события и снятое перемирие — в снимке', () => {
    const s = new CampaignState(1);
    s.deltas = withDelta(s.deltas, kuritaOnJaguarBorder(s.deltas), { owner: PLAYER_ACTOR_ID });
    const r = eventTick(s.war, s.reputation, s.deltas, s.worldSeed, eventWindow(def('operation-bulldog')).until);
    s.war = r.war;
    s.reputation = r.reputation;
    const back = restore(JSON.parse(JSON.stringify(snapshot(s))));
    expect(back.war.events).toEqual(s.war.events);
    expect(back.war.truceLifted).toEqual(s.war.truceLifted);
    expect(hashCampaignState(back)).toBe(hashCampaignState(s));
  });

  it('бот закрывает карточки сам и доходит до дня', () => {
    const w = eventWindow(def('whitting-conference'));
    const s = new CampaignState(2, { startDay: w.until - 25 });
    const r = advanceAnswering(s, w.until + 40);
    expect(r.ok).toBe(true);
    expect(s.day).toBe(w.until + 40);
    expect(pendingEvents(s.war)).toEqual([]);
    expect(s.war.events['whitting-conference']?.pending).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import {
  CampaignState,
  GALAXY,
  PLAYER_ACTOR_ID,
  campaignProgress,
  makeRecord,
  playerRank,
  serializeCampaignState,
  withDelta,
  type CampaignProgress,
  type MechRecord,
} from '../src/core/campaign/index.js';
import { MILESTONES } from '../src/core/data/index.js';
import { generateAssembly, makePilot } from '../src/core/rules/index.js';
import { Rng } from '../src/core/rng/index.js';
import { hasKey } from '../src/ui/i18n/index.js';

/**
 * Шаг 70 — главы кампании.
 *
 * Прогресс — чистая функция от состояния, поэтому состояние здесь собирается
 * руками: полем за полем ровно то, что проверяет веха. Главное, что охраняется:
 * прогресс не растёт от ничего, идёт назад вместе с состоянием и не
 * перескакивает непройденную главу.
 */

const WORLD = 1;
const CHAPTERS = MILESTONES.campaigns.merc.chapters;

function fresh(): CampaignState {
  return new CampaignState(1, { worldSeed: WORLD });
}

function chapter(p: CampaignProgress, id: string) {
  const c = p.chapters.find((x) => x.id === id);
  if (c === undefined) throw new Error(`нет главы ${id}`);
  return c;
}

function milestone(p: CampaignProgress, id: string): boolean {
  const m = p.chapters.flatMap((c) => c.milestones).find((x) => x.id === id);
  if (m === undefined) throw new Error(`нет вехи ${id}`);
  return m.done;
}

/** Парк из `n` машин, в каждой — пилот: в рейтинг MRBC идут только машины с экипажем. */
function fleet(n: number, code = 'IS-H55-R1F1', tier = 4): Pick<CampaignState['company'], 'mechs' | 'pilots'> {
  const pilots = Array.from({ length: n }, (_, k) => makePilot(new Rng(k + 7), { id: `P-${k}`, callsign: `P${k}`, tier }));
  const mechs: MechRecord[] = Array.from({ length: n }, (_, k) => ({
    ...makeRecord({ id: `M-${k}`, assembly: generateAssembly({ chassisCode: code, role: 'brawler' }, new Rng(k + 1)) }),
    pilotId: `P-${k}`,
  }));
  return { mechs, pilots };
}

/** Первые `n` миров каталога — во владение роты. */
function ownWorlds(state: CampaignState, n: number): string[] {
  const ids = Array.from({ length: n }, (_, i) => GALAXY.id(i));
  for (const id of ids) state.deltas = withDelta(state.deltas, id, { owner: PLAYER_ACTOR_ID });
  return ids;
}

/** Главы 1–2 пройдены: победа, полная рота, Union, известность штурма. */
function company(state: CampaignState): void {
  state.deltas = withDelta(state.deltas, GALAXY.id(0), { fought: 1, foughtWon: 1 });
  state.company = { ...state.company, ...fleet(12), dropship: 'union' };
  state.reputation = { ...state.reputation, fame: 30 };
}

describe('главы кампании: данные', () => {
  it('у каждой главы и вехи есть слова в словаре', () => {
    for (const c of CHAPTERS) {
      expect(hasKey(`progress.chapter.${c.id}.name`), `нет progress.chapter.${c.id}.name`).toBe(true);
      expect(hasKey(`progress.chapter.${c.id}.desc`), `нет progress.chapter.${c.id}.desc`).toBe(true);
      for (const m of c.milestones) {
        expect(hasKey(`progress.milestone.${m.id}.name`), `нет progress.milestone.${m.id}.name`).toBe(true);
        expect(hasKey(`progress.milestone.${m.id}.hint`), `нет progress.milestone.${m.id}.hint`).toBe(true);
      }
    }
  });

  it('последняя глава — не проходится в этой версии: первая веха — высший титул (шаг 89), остальные за версией', () => {
    const p = campaignProgress(fresh());
    // Целиком за версией глав нет: у «Звёздной Лиги» достижима веха титула.
    expect(p.chapters.map((c) => c.beyondVersion)).toEqual(CHAPTERS.map(() => false));
    const last = p.chapters[p.chapters.length - 1]!;
    expect(last.milestones.map((m) => m.beyondVersion)).toEqual(last.milestones.map((_, i) => i > 0));
    // Остальные главы проходимы целиком.
    for (const c of p.chapters.slice(0, -1)) expect(c.milestones.some((m) => m.beyondVersion)).toBe(false);
  });
});

describe('главы кампании: из состояния', () => {
  it('новая рота — первая глава, ни одной вехи', () => {
    const p = campaignProgress(fresh());
    expect(p.current).toBe(0);
    expect(p.chapters.flatMap((c) => c.milestones).filter((m) => m.done)).toEqual([]);
  });

  it('состояние не менялось — прогресс тот же, и само состояние он не трогает', () => {
    const state = fresh();
    company(state);
    const before = serializeCampaignState(state);
    expect(campaignProgress(state)).toEqual(campaignProgress(state));
    expect(serializeCampaignState(state)).toBe(before);
  });

  it('Union и полная рота без известности — глава «Рота», две вехи из трёх', () => {
    const state = fresh();
    company(state);
    state.reputation = { ...state.reputation, fame: 29 };
    const p = campaignProgress(state);
    expect(CHAPTERS[p.current]?.id).toBe('company');
    expect(chapter(p, 'company').milestones.map((m) => m.done)).toEqual([true, true, false]);
  });

  it('веха дальней главы отмечена, но непройденную главу не перескакивает', () => {
    const state = fresh();
    ownWorlds(state, 1);
    const p = campaignProgress(state);
    expect(milestone(p, 'firstWorld')).toBe(true);
    expect(chapter(p, 'planet').done).toBe(true);
    expect(p.current).toBe(0);
  });

  it('прогресс идёт назад: мир ушёл — глава «Планета» снова текущая', () => {
    const state = fresh();
    company(state);
    state.company = { ...state.company, ...fleet(12, 'IS-H100-R1F1', 6), dropship: 'overlord' };
    state.reputation = { ...state.reputation, fame: 60 };
    // Место в рейтинге считается от парка с экипажами против реестра —
    // проверяем, что этот парк его действительно берёт, иначе тест мерил бы не то.
    expect(playerRank(state)).toBeLessThanOrEqual(8);
    const [id] = ownWorlds(state, 1) as [string];
    expect(CHAPTERS[campaignProgress(state).current]?.id).toBe('realm');

    state.deltas = withDelta(state.deltas, id, { owner: undefined });
    const p = campaignProgress(state);
    expect(milestone(p, 'firstWorld')).toBe(false);
    expect(CHAPTERS[p.current]?.id).toBe('planet');
  });

  it('дипломатия: действующий договор или дань роте, истёкший — нет', () => {
    const state = fresh();
    state.day = 100;
    expect(milestone(campaignProgress(state), 'firstTreaty')).toBe(false);

    state.war = { ...state.war, pacts: { [`davion|${PLAYER_ACTOR_ID}`]: { kind: 'trade', untilDay: 100 } } };
    expect(milestone(campaignProgress(state), 'firstTreaty')).toBe(false);
    state.war = { ...state.war, pacts: { [`davion|${PLAYER_ACTOR_ID}`]: { kind: 'trade', untilDay: 101 } } };
    expect(milestone(campaignProgress(state), 'firstTreaty')).toBe(true);

    state.war = { ...state.war, pacts: {} };
    state.deltas = withDelta(state.deltas, GALAXY.id(5), { tribute: PLAYER_ACTOR_ID, tributeUntil: 101 });
    expect(milestone(campaignProgress(state), 'firstTreaty')).toBe(true);
    state.deltas = withDelta(state.deltas, GALAXY.id(5), { tribute: 'davion', tributeUntil: 101 });
    expect(milestone(campaignProgress(state), 'firstTreaty')).toBe(false);
  });

  it('вассал: сюзерен — рота, а не чужая держава', () => {
    const state = fresh();
    expect(milestone(campaignProgress(state), 'vassal')).toBe(false);
    state.war = { ...state.war, vassals: { davion: { suzerain: PLAYER_ACTOR_ID, sinceDay: 0 } } };
    expect(milestone(campaignProgress(state), 'vassal')).toBe(true);
    state.war = { ...state.war, vassals: { davion: { suzerain: 'kurita', sinceDay: 0 } } };
    expect(milestone(campaignProgress(state), 'vassal')).toBe(false);
  });
});

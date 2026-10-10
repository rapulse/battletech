import { describe, expect, it } from 'vitest';
import {
  CampaignState,
  FACTIONS,
  GALAXY,
  PLAYER_ACTOR_ID,
  WAR,
  applySystemCapture,
  diplomacyTick,
  execute,
  frontierIndexAt,
  ownerOf,
  tributeOf,
  withDelta,
  withStanding,
  withWorldMemory,
  worldPrice,
} from '../src/core/campaign/index.js';
import { Rng } from '../src/core/rng/index.js';

/**
 * Смена владельца снимает дань (решение пользователя 2026-10-07): дань — договор
 * владельца с получателем, новый хозяин чужих обязательств не наследует, каким бы
 * путём мир ни перешёл. Правило живёт в `galaxy/delta.ts::withDelta`.
 */

/** Первый не столичный мир владельца вида `kind`. */
function worldOf(state: CampaignState, kind: string): { i: number; id: string; owner: string } {
  for (let i = 0; i < GALAXY.count; i++) {
    if (GALAXY.hasFlag(i, 'capital')) continue;
    const owner = ownerOf(state.deltas, i);
    if (FACTIONS.get(owner)?.kind !== kind) continue;
    return { i, id: GALAXY.id(i), owner };
  }
  throw new Error(`в каталоге нет мира с владельцем вида «${kind}»`);
}

/** Мир платит дань `to` на десять декад вперёд. */
function underTribute(state: CampaignState, id: string, to = 'davion'): void {
  state.deltas = withDelta(state.deltas, id, { tribute: to, tributeUntil: state.day + 100 });
  expect(tributeOf(state.deltas, id, state.day)).toBe(to);
}

function capture(state: CampaignState, i: number, attacker: string, defender: string): void {
  state.deltas = applySystemCapture(
    state.war, state.deltas, state.worldSeed, i, attacker, defender, new Rng(1), state.day,
  ).deltas;
}

describe('смена владельца снимает дань', () => {
  it('захват командой роты', () => {
    const state = new CampaignState(3);
    const target = worldOf(state, 'independent');
    state.systemId = target.id;
    for (let n = 0; n < WAR.domain.conquerWins; n++) {
      state.deltas = withWorldMemory(state.deltas, target.id, 'davion', true, 3053);
    }
    underTribute(state, target.id);

    expect(execute(state, { kind: 'conquerWorld' }).ok).toBe(true);
    expect(ownerOf(state.deltas, target.i)).toBe(PLAYER_ACTOR_ID);
    expect(tributeOf(state.deltas, target.id, state.day)).toBeUndefined();
    expect(state.deltas[target.id]?.tribute).toBeUndefined();
    expect(state.deltas[target.id]?.tributeUntil).toBeUndefined();
  });

  it('покупка мира', () => {
    const state = new CampaignState(3);
    const target = worldOf(state, 'independent');
    state.systemId = target.id;
    state.reputation = withStanding(state.reputation, target.owner, 200);
    state.company = { ...state.company, cbills: worldPrice(state.worldSeed, state.deltas, target.i) };
    underTribute(state, target.id);

    expect(execute(state, { kind: 'buyWorld' }).ok).toBe(true);
    expect(ownerOf(state.deltas, target.i)).toBe(PLAYER_ACTOR_ID);
    expect(tributeOf(state.deltas, target.id, state.day)).toBeUndefined();
  });

  it('захват армией роты и захват фракцией у фракции — одним швом фронта', () => {
    const state = new CampaignState(3);
    const target = worldOf(state, 'independent');
    underTribute(state, target.id);
    const start = state.deltas;

    capture(state, target.i, PLAYER_ACTOR_ID, target.owner);
    expect(tributeOf(state.deltas, target.id, state.day)).toBeUndefined();

    state.deltas = start;
    capture(state, target.i, 'kurita', target.owner);
    expect(tributeOf(state.deltas, target.id, state.day)).toBeUndefined();
  });

  it('мир, отбитый прежним владельцем, дань обратно не получает', () => {
    const state = new CampaignState(3);
    const target = worldOf(state, 'independent');
    underTribute(state, target.id);
    capture(state, target.i, 'kurita', target.owner);
    capture(state, target.i, target.owner, 'kurita');
    expect(ownerOf(state.deltas, target.i)).toBe(target.owner);
    expect(tributeOf(state.deltas, target.id, state.day)).toBeUndefined();
  });

  it('правка мира без смены владельца дань не трогает', () => {
    const state = new CampaignState(3);
    const target = worldOf(state, 'independent');
    underTribute(state, target.id);
    state.deltas = withDelta(state.deltas, target.id, { owner: target.owner, ruined: 0.3 });
    expect(tributeOf(state.deltas, target.id, state.day)).toBe('davion');
    // И такт дипломатии её не снимает до срока.
    const tick = diplomacyTick(state.war, state.deltas, state.reputation, state.day);
    expect(tributeOf(tick.deltas, target.id, state.day)).toBe('davion');
  });

  it('лен: прежняя дань третьей стороне снята, новая — жалующему Дому', () => {
    const state = new CampaignState(3);
    const D = WAR.domain;
    let border = -1;
    for (let i = 0; i < GALAXY.count && border < 0; i++) {
      if (GALAXY.hasFlag(i, 'capital')) continue;
      if (FACTIONS.get(ownerOf(state.deltas, i))?.kind !== 'house') continue;
      if (frontierIndexAt(state.deltas, state.reputation, state.war, i) >= D.grantFrontier) border = i;
    }
    expect(border).toBeGreaterThanOrEqual(0);
    const id = GALAXY.id(border);
    const owner = ownerOf(state.deltas, border);
    const third = owner === 'kurita' ? 'davion' : 'kurita';
    state.systemId = id;
    state.reputation = { ...withStanding(state.reputation, owner, 100), fame: 100 };
    for (let n = 0; n < D.grantWins; n++) state.deltas = withWorldMemory(state.deltas, id, owner, true, 3053);
    underTribute(state, id, third);

    expect(execute(state, { kind: 'claimGrant' }).ok).toBe(true);
    expect(ownerOf(state.deltas, border)).toBe(PLAYER_ACTOR_ID);
    expect(tributeOf(state.deltas, id, state.day)).toBe(owner);
    // Своя, меньшая доля лена (шаг 90); новая дань или смена владельца её снимает.
    expect(state.deltas[id]?.tributeShare).toBe(WAR.diplomacy.grantTributeShare);
    expect(withDelta(state.deltas, id, { tribute: third, tributeUntil: state.day + 100 })[id]?.tributeShare).toBeUndefined();
    expect(withDelta(state.deltas, id, { owner: third })[id]?.tributeShare).toBeUndefined();
  });
});

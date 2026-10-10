import { describe, expect, it } from 'vitest';
import { FACTIONS, GALAXY, ownerOf, withStanding } from '../src/core/campaign/index.js';
import { MemoryStorage } from '../src/platform/MemoryStorage.js';
import { CampaignUi } from '../src/ui/state/campaign.svelte.js';
import { buildRealmMap } from '../src/ui/realm/realmMapModel.js';

/**
 * Модель карты державы (шаг 93): на карте те же миры и те же числа, что у списка и карточек, а
 * соседи — ровно системы в прыжке от своих миров.
 */

function withWorlds(count: number): CampaignUi {
  const ui = new CampaignUi(new MemoryStorage());
  ui.newCampaign({ seed: 3, name: 'Hounds', commander: 'Wolf', emblem: 0 });
  for (let i = 0; i < GALAXY.count && ui.realmWorlds.length < count; i++) {
    if (GALAXY.hasFlag(i, 'capital')) continue;
    const owner = ownerOf(ui.state.deltas, i);
    if (FACTIONS.get(owner)?.kind !== 'house') continue;
    ui.state.systemId = GALAXY.id(i);
    ui.state.reputation = withStanding(ui.state.reputation, owner, 200);
    ui.state.company = { ...ui.state.company, cbills: ui.state.company.cbills + ui.worldPriceAt(GALAXY.id(i)) };
    ui.run({ kind: 'buyWorld' });
  }
  return ui;
}

function modelOf(ui: CampaignUi): ReturnType<typeof buildRealmMap> {
  return buildRealmMap({
    worlds: ui.realmWorlds,
    sectors: ui.realmSectors.sectors,
    neighbours: ui.realmNeighbours,
    wars: ui.realmWars,
    owners: ui.owners,
  });
}

describe('карта державы: модель', () => {
  it('без миров карта пуста', () => {
    const ui = new CampaignUi(new MemoryStorage());
    ui.newCampaign({ seed: 3, name: 'Hounds', commander: 'Wolf', emblem: 0 });
    const m = modelOf(ui);
    expect(m.worlds).toEqual([]);
    expect(m.foreign).toEqual([]);
    expect(m.lanes).toEqual([]);
  });

  it('свои миры — все и с итогом списка, соседи — ровно системы в прыжке', () => {
    const ui = withWorlds(3);
    const m = modelOf(ui);
    expect(m.worlds.map((w) => w.id).sort()).toEqual(ui.realmWorlds.map((w) => w.id).sort());
    for (const w of m.worlds) {
      const src = ui.realmWorlds.find((r) => r.id === w.id);
      expect(w.net).toBe((src?.income ?? 0) - (src?.upkeep ?? 0));
      expect(w.x).toBe(GALAXY.x[w.i]);
    }
    const own = new Set(m.worlds.map((w) => w.i));
    const expected = new Set<number>();
    for (const i of own) for (const j of GALAXY.neighbors(i)) if (!own.has(j)) expected.add(j);
    expect(new Set(m.foreign.map((f) => f.i))).toEqual(expected);
    for (const f of m.foreign) expect(f.owner).toBe(ui.owners[f.i]);
  });

  it('дорожки касаются своих миров и связывают системы в прыжке; охват — все показанные системы', () => {
    const ui = withWorlds(3);
    const m = modelOf(ui);
    const own = new Set(m.worlds.map((w) => w.i));
    for (const l of m.lanes) {
      expect(own.has(l.a) || own.has(l.b)).toBe(true);
      expect(GALAXY.neighbors(l.a)).toContain(l.b);
    }
    for (const s of [...m.worlds, ...m.foreign]) {
      expect(s.x).toBeGreaterThanOrEqual(m.bounds.minX);
      expect(s.x).toBeLessThanOrEqual(m.bounds.maxX);
      expect(s.y).toBeGreaterThanOrEqual(m.bounds.minY);
      expect(s.y).toBeLessThanOrEqual(m.bounds.maxY);
    }
  });

  it('фронт — только к соседу во вражде или войне, и с войной — тоже', () => {
    const ui = withWorlds(2);
    const nb = ui.realmNeighbours[0];
    expect(nb).toBeDefined();
    const before = modelOf(ui);
    const hostile = new Set(ui.realmNeighbours.filter((n) => n.atWar).map((n) => n.factionId));
    for (const f of before.fronts) expect(hostile.has(f.owner)).toBe(true);

    ui.state.company = { ...ui.state.company, cbills: 1_000_000_000 };
    const declared = ui.run({ kind: 'declareWar', factionId: nb?.factionId ?? '' });
    expect(declared).toBe(true);
    const after = modelOf(ui);
    const warFronts = after.fronts.filter((f) => f.owner === nb?.factionId);
    expect(warFronts.length).toBeGreaterThan(0);
    for (const f of warFronts) expect(f.state).toBe('war');
  });
});

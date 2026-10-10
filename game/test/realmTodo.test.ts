import { describe, expect, it } from 'vitest';
import { FACTIONS, GALAXY, ownerOf, withStanding } from '../src/core/campaign/index.js';
import { MemoryStorage } from '../src/platform/MemoryStorage.js';
import { CampaignUi, type RealmNeighbour, type RealmWorld } from '../src/ui/state/campaign.svelte.js';
import { PACT_SOON_DAYS, realmTodo } from '../src/ui/realm/realmTodo.js';

/** «Требует решения» в Штабе (шаг 93): что попадает в список и в каком порядке. */

function realWorlds(): readonly RealmWorld[] {
  const ui = new CampaignUi(new MemoryStorage());
  ui.newCampaign({ seed: 3, name: 'Hounds', commander: 'Wolf', emblem: 0 });
  for (let i = 0; i < GALAXY.count && ui.realmWorlds.length < 2; i++) {
    if (GALAXY.hasFlag(i, 'capital')) continue;
    const owner = ownerOf(ui.state.deltas, i);
    if (FACTIONS.get(owner)?.kind !== 'house') continue;
    ui.state.systemId = GALAXY.id(i);
    ui.state.reputation = withStanding(ui.state.reputation, owner, 200);
    ui.state.company = { ...ui.state.company, cbills: ui.state.company.cbills + ui.worldPriceAt(GALAXY.id(i)) };
    ui.run({ kind: 'buyWorld' });
  }
  return ui.realmWorlds;
}

const neighbour = (pact: RealmNeighbour['pact']): RealmNeighbour => ({
  factionId: 'davion',
  standing: 30,
  pact,
  vassal: false,
  payingUs: 0,
  atWar: false,
  alarm: 0,
  systems: [],
});

describe('Штаб: «Требует решения»', () => {
  it('спокойная держава — пусто', () => {
    const worlds = realWorlds();
    expect(realmTodo({ day: 100, worlds, sectors: [], sectorLimit: 0, wars: [], neighbours: [], idleWorlds: 0 })).toEqual([]);
  });

  it('восстание — первым, разорение — после свободных секторов, простой стройки — последним', () => {
    const [a, b] = realWorlds();
    expect(a).toBeDefined();
    expect(b).toBeDefined();
    const worlds = [
      { ...(a as RealmWorld), ruined: 100 },
      { ...(b as RealmWorld), revoltUntil: 500 },
    ];
    const kinds = realmTodo({ day: 100, worlds, sectors: [], sectorLimit: 1, wars: [], neighbours: [], idleWorlds: 3 }).map((x) =>
      x.kind === 'world' ? x.alert : x.kind,
    );
    expect(kinds).toEqual(['revolt', 'slots', 'ruin', 'idle']);
  });

  it('договор попадает в список только в последние три декады', () => {
    const worlds = realWorlds();
    const soon = realmTodo({
      day: 100,
      worlds,
      sectors: [],
      sectorLimit: 0,
      wars: [],
      neighbours: [neighbour({ kind: 'truce', untilDay: 100 + PACT_SOON_DAYS })],
      idleWorlds: 0,
    });
    expect(soon).toEqual([{ kind: 'pact', factionId: 'davion', until: 100 + PACT_SOON_DAYS }]);
    const later = realmTodo({
      day: 100,
      worlds,
      sectors: [],
      sectorLimit: 0,
      wars: [],
      neighbours: [neighbour({ kind: 'truce', untilDay: 101 + PACT_SOON_DAYS })],
      idleWorlds: 0,
    });
    expect(later).toEqual([]);
  });
});

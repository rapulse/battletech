import { describe, expect, it } from 'vitest';
import {
  CampaignRejectReason,
  canExecute,
  FACTIONS,
  GALAXY,
  ownerOf,
  restore,
  sectorJumps,
  sectorMap,
  snapshot,
  stanceTarget,
  withStanding,
} from '../src/core/campaign/index.js';
import type { CampaignCommand } from '../src/core/campaign/commands/types.js';
import { MemoryStorage } from '../src/platform/MemoryStorage.js';
import { CampaignUi } from '../src/ui/state/campaign.svelte.js';

/**
 * Выбор игрока в державе (шаг 93): явная принадлежность мира сектору и цель стойки «наступать». Без выбора
 * поведение прежнее, поля нет — старое сохранение читается как есть.
 */

function buy(ui: CampaignUi, i: number): boolean {
  const owner = ownerOf(ui.state.deltas, i);
  ui.state.systemId = GALAXY.id(i);
  ui.state.reputation = withStanding(ui.state.reputation, owner, 200);
  ui.state.company = { ...ui.state.company, cbills: ui.state.company.cbills + ui.worldPriceAt(GALAXY.id(i)) };
  return ui.run({ kind: 'buyWorld' });
}

const reasonOf = (ui: CampaignUi, command: CampaignCommand): CampaignRejectReason | null => canExecute(ui.state, command);

/** Связная держава из миров одного Дома: от первого подходящего мира — обходом по соседям. */
function cluster(size: number): CampaignUi {
  for (let start = 0; start < GALAXY.count; start++) {
    const ui = new CampaignUi(new MemoryStorage());
    ui.newCampaign({ seed: 3, name: 'Hounds', commander: 'Wolf', emblem: 0 });
    const owner = ownerOf(ui.state.deltas, start);
    if (GALAXY.hasFlag(start, 'capital') || FACTIONS.get(owner)?.kind !== 'house') continue;
    const queue = [start];
    const seen = new Set(queue);
    while (queue.length > 0 && ui.realmWorlds.length < size) {
      const i = queue.shift() as number;
      if (GALAXY.hasFlag(i, 'capital') || ownerOf(ui.state.deltas, i) !== owner) continue;
      if (!buy(ui, i)) continue;
      for (const j of GALAXY.neighbors(i)) {
        if (seen.has(j)) continue;
        seen.add(j);
        queue.push(j);
      }
    }
    if (ui.realmWorlds.length >= size) return ui;
  }
  throw new Error('нет связной группы миров');
}

/** Два сектора с общим миром в радиусе обоих: геометрия отдаёт его первому. */
function twoSectors(): { ui: CampaignUi; a: string; b: string; shared: string } {
  const ui = cluster(8);
  const own = ui.realmWorlds.map((w) => w.id);
  const pilots = ui.state.company.pilots.filter((p) => p.status === 'active');
  for (const a of own) {
    for (const b of own) {
      if (a === b) continue;
      ui.state.realm = {
        ...ui.state.realm,
        sectors: [
          { center: a, governor: pilots[0]?.id ?? null, priority: 'income' },
          { center: b, governor: pilots[1]?.id ?? null, priority: 'income' },
        ],
      };
      const map = sectorMap(ui.state.deltas, ui.state.realm);
      const shared = own.find((w) => w !== a && w !== b && map.get(w) === a && ui.why({ kind: 'assignWorldSector', systemId: w, center: b }) === null);
      if (shared !== undefined) return { ui, a, b, shared };
    }
  }
  throw new Error('нет мира в радиусе двух секторов');
}

describe('держава: мир в сектор вручную', () => {
  it('мир в радиусе обоих секторов переходит ко второму и обратно — к геометрии', () => {
    const { ui, a, b, shared } = twoSectors();
    expect(ui.run({ kind: 'assignWorldSector', systemId: shared, center: b })).toBe(true);
    expect(sectorMap(ui.state.deltas, ui.state.realm).get(shared)).toBe(b);
    expect(ui.why({ kind: 'assignWorldSector', systemId: shared, center: b })).not.toBeNull();
    expect(ui.run({ kind: 'assignWorldSector', systemId: shared, center: null })).toBe(true);
    expect(sectorMap(ui.state.deltas, ui.state.realm).get(shared)).toBe(a);
    expect(ui.state.realm.assigned).toBeUndefined();
  });

  it('отказы: чужой мир, нет сектора, дальше радиуса', () => {
    const { ui, b } = twoSectors();
    const owned = new Set(ui.realmWorlds.map((w) => w.id));
    let foreign = 0;
    while (owned.has(GALAXY.id(foreign))) foreign++;
    expect(reasonOf(ui, { kind: 'assignWorldSector', systemId: GALAXY.id(foreign), center: b })).toBe(CampaignRejectReason.NotOwned);
    const own = ui.realmWorlds[0]?.id as string;
    expect(reasonOf(ui, { kind: 'assignWorldSector', systemId: own, center: GALAXY.id(foreign) })).toBe(CampaignRejectReason.NoSector);
    // Дальний свой мир: Дома, вне радиуса центра b.
    let far = -1;
    for (let i = 0; i < GALAXY.count && far < 0; i++) {
      if (GALAXY.hasFlag(i, 'capital') || FACTIONS.get(ownerOf(ui.state.deltas, i))?.kind !== 'house') continue;
      if (sectorJumps(b, GALAXY.id(i)) !== undefined) continue;
      if (buy(ui, i)) far = i;
    }
    expect(far).toBeGreaterThanOrEqual(0);
    expect(reasonOf(ui, { kind: 'assignWorldSector', systemId: GALAXY.id(far), center: b })).toBe(CampaignRejectReason.SectorTooFar);
  });

  it('распущенный сектор уносит ручные отнесения, сохранение их хранит', () => {
    const { ui, b, shared } = twoSectors();
    ui.run({ kind: 'assignWorldSector', systemId: shared, center: b });
    const back = restore(snapshot(ui.state));
    expect(back.realm.assigned).toEqual({ [shared]: b });
    expect(ui.run({ kind: 'releaseGovernor', centerId: b })).toBe(true);
    expect(ui.state.realm.assigned).toBeUndefined();
  });

  it('держава без выбора сохраняется без новых полей', () => {
    const ui = cluster(2);
    const snap = snapshot(ui.state) as unknown as { realm: Record<string, unknown> };
    expect('assigned' in snap.realm).toBe(false);
    expect('targets' in snap.realm).toBe(false);
  });
});

describe('держава: цель стойки игроком', () => {
  function atWar(): { ui: CampaignUi; foe: string; targets: readonly string[] } {
    const ui = cluster(4);
    ui.state.company = { ...ui.state.company, cbills: 2_000_000_000 };
    for (const nb of ui.realmNeighbours) {
      if (!ui.run({ kind: 'declareWar', factionId: nb.factionId })) continue;
      const front = ui.realmOffensives.fronts.find((f) => f.factionId === nb.factionId);
      const targets = front?.targets.map((x) => x.id) ?? [];
      if (targets.length > 0) return { ui, foe: nb.factionId, targets };
    }
    throw new Error('нет войны с участками фронта');
  }

  it('без войны — отказ; не участок фронта — отказ', () => {
    const { ui, foe, targets } = atWar();
    expect(reasonOf(ui, { kind: 'setStanceTarget', factionId: 'nobody', systemId: targets[0] as string })).toBe(
      CampaignRejectReason.NotAtWar,
    );
    const own = ui.realmWorlds[0]?.id as string;
    expect(reasonOf(ui, { kind: 'setStanceTarget', factionId: foe, systemId: own })).toBe(CampaignRejectReason.NotOnFront);
  });

  it('выбранный участок — цель стойки, пока он участок фронта; снятие возвращает выбор ядру', () => {
    const { ui, foe, targets } = atWar();
    const auto = stanceTarget(ui.state, foe);
    const chosen = targets.find((id) => GALAXY.require(id) !== auto) ?? (targets[0] as string);
    expect(ui.run({ kind: 'setStanceTarget', factionId: foe, systemId: chosen })).toBe(true);
    const now = stanceTarget(ui.state, foe);
    // Стойка бьёт только выбранный участок; не проходит по шансу — ждёт, а не бьёт в другое место.
    expect(now === undefined || now === GALAXY.require(chosen)).toBe(true);
    expect(ui.realmWars.find((w) => w.factionId === foe)?.stanceFocusId).toBe(chosen);
    expect(restore(snapshot(ui.state)).realm.targets).toEqual({ [foe]: chosen });
    expect(ui.run({ kind: 'setStanceTarget', factionId: foe, systemId: null })).toBe(true);
    expect(stanceTarget(ui.state, foe)).toBe(auto);
    expect(ui.state.realm.targets).toBeUndefined();
  });
});

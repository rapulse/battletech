import { describe, expect, it } from 'vitest';
import { FACTIONS, GALAXY, ownerOf, withStanding } from '../src/core/campaign/index.js';
import { MemoryStorage } from '../src/platform/MemoryStorage.js';
import { CampaignUi } from '../src/ui/state/campaign.svelte.js';

/**
 * Режим шапки «рота / держава» выводится из открытого экрана: экран меняют и кнопки внутри
 * экранов (разбор → ангар, карта → держава), и вкладки шапки обязаны идти следом.
 */

function withWorld(): CampaignUi {
  const ui = new CampaignUi(new MemoryStorage());
  ui.newCampaign({ seed: 3, name: 'Hounds', commander: 'Wolf', emblem: 0 });
  for (let i = 0; i < GALAXY.count; i++) {
    if (GALAXY.hasFlag(i, 'capital')) continue;
    const owner = ownerOf(ui.state.deltas, i);
    if (FACTIONS.get(owner)?.kind !== 'house') continue;
    ui.state.systemId = GALAXY.id(i);
    ui.state.reputation = withStanding(ui.state.reputation, owner, 200);
    ui.state.company = { ...ui.state.company, cbills: ui.state.company.cbills + ui.worldPriceAt(GALAXY.id(i)) };
    if (ui.run({ kind: 'buyWorld' })) return ui;
  }
  throw new Error('нет мира на продажу');
}

describe('режим шапки: рота или держава', () => {
  it('без мира — всегда рота, даже на экране войны', () => {
    const ui = new CampaignUi(new MemoryStorage());
    ui.newCampaign({ seed: 3, name: 'Hounds', commander: 'Wolf', emblem: 0 });
    ui.screen = 'war';
    expect(ui.scope).toBe('company');
  });

  it('идёт за экраном, куда бы его ни переключили', () => {
    const ui = withWorld();
    expect(ui.scope).toBe('company');

    // Кнопка «Открыть державу» на карте ставит экран напрямую.
    ui.screen = 'realm';
    expect(ui.scope).toBe('realm');

    // Разбор, гарнизон и прочие переходы уводят в ангар — шапка возвращается к роте.
    ui.screen = 'hangar';
    expect(ui.scope).toBe('company');
  });

  it('карта и война помнят, из чьих вкладок их открыли', () => {
    const ui = withWorld();
    for (const screen of ['starmap', 'war'] as const) {
      ui.openShared(screen, 'realm');
      expect(ui.scope).toBe('realm');
      ui.setScope('company');
      expect(ui.screen).toBe(screen);
      expect(ui.scope).toBe('company');
      ui.openShared(screen, 'company');
      expect(ui.scope).toBe('company');
    }
  });

  it('держава открывается на своей вкладке, рота — на последнем своём экране', () => {
    const ui = withWorld();
    ui.screen = 'market';
    ui.setScope('realm');
    expect(ui.screen).toBe('realm');
    ui.setRealmTab('legacy');
    ui.setScope('company');
    expect(ui.screen).toBe('market');
    ui.setScope('realm');
    expect(ui.realmTab).toBe('legacy');
  });

  it('уход в державу кнопкой с карты тоже запоминает экран роты', () => {
    const ui = withWorld();
    ui.openShared('starmap', 'company');
    ui.screen = 'realm';
    ui.setScope('company');
    expect(ui.screen).toBe('starmap');
    expect(ui.scope).toBe('company');
  });

  it('закрытый к возврату разбор заменяется ангаром', () => {
    const ui = withWorld();
    ui.screen = 'debrief';
    ui.setScope('realm');
    ui.setScope('company');
    expect(ui.screen).toBe('hangar');
  });

  it('новая кампания начинает с роты, ангара и сводки державы', () => {
    const ui = withWorld();
    ui.screen = 'market';
    ui.setRealmTab('legacy');
    ui.newCampaign({ seed: 4, name: 'Hounds', commander: 'Wolf', emblem: 0 });
    expect(ui.realmTab).toBe('hq');
    expect(ui.scope).toBe('company');
    expect(ui.screen).toBe('hangar');
  });
});

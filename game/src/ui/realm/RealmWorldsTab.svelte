<script lang="ts">
  import { BUILDING_KINDS, GALAXY, type BuildingKind } from '../../core/campaign/index.js';
  import { campaign, type RealmWorld } from '../state/campaign.svelte.js';
  import { t } from '../i18n/index.js';
  import { shortMoney } from './money.js';
  import { loyaltyValue } from './loyaltyText.js';
  import { sectorColor } from './realmMapModel.js';
  import WorldCard from './WorldCard.svelte';
  import WikiHelp from '../wiki/WikiHelp.svelte';
  import { worldAlerts } from './worldAlerts.js';
  import RealmIcon from './RealmIcon.svelte';
  import { ALERT_ICON, FOCUS_ICON } from './realmIcons.js';

  /**
   * Вкладка «Миры» (шаг 93): все миры державы таблицей — сравнить и найти — и полная карточка выбранного.
   * Столбец сортирует по клику, повторный клик — в обратную сторону.
   */
  const worlds = $derived(campaign.realmWorlds);
  const sectors = $derived(campaign.realmSectors.sectors);
  const sectorIndex = $derived(new Map(sectors.map((s, n) => [s.center, n])));

  type Col = 'name' | 'sector' | 'focus' | 'dev' | 'loyalty' | 'income' | 'upkeep' | 'net' | 'built' | 'garrison' | 'alerts';
  const COLS: readonly Col[] = ['name', 'alerts', 'sector', 'focus', 'dev', 'loyalty', 'income', 'upkeep', 'net', 'built', 'garrison'];
  let sortBy = $state<Col>('alerts');
  let desc = $state(true);
  let sectorFilter = $state<string>('');
  let alertsOnly = $state(false);

  const detail = $derived.by(() => {
    const out = new Map<string, { built: ReadonlySet<BuildingKind>; building: BuildingKind | null; garrison: number }>();
    for (const w of worlds) {
      const b = campaign.buildingsView(w.id);
      out.set(w.id, {
        built: new Set(b.rows.filter((r) => r.built).map((r) => r.kind)),
        building: b.construction?.kind ?? null,
        garrison: campaign.garrisonView(w.id).count,
      });
    }
    return out;
  });

  const net = (w: RealmWorld): number => w.income - w.upkeep;
  const sectorName = (center: string | null): string => (center === null ? '' : GALAXY.name(GALAXY.require(center)));

  function key(w: RealmWorld, col: Col): number | string {
    switch (col) {
      case 'name':
        return w.name;
      case 'sector':
        return sectorName(w.sector);
      case 'focus':
        return t(`focus.${w.focus}`);
      case 'dev':
        return w.development;
      case 'loyalty':
        return w.loyalty ?? -1;
      case 'income':
        return w.income;
      case 'upkeep':
        return w.upkeep;
      case 'net':
        return net(w);
      case 'built':
        return detail.get(w.id)?.built.size ?? 0;
      case 'garrison':
        return detail.get(w.id)?.garrison ?? 0;
      case 'alerts':
        return worldAlerts(w).length * 1e12 + net(w);
    }
  }

  const rows = $derived.by(() => {
    const list = worlds.filter(
      (w) => (sectorFilter === '' || (w.sector ?? '-') === sectorFilter) && (!alertsOnly || worldAlerts(w).length > 0),
    );
    return [...list].sort((a, b) => {
      const ka = key(a, sortBy);
      const kb = key(b, sortBy);
      const c = typeof ka === 'string' ? ka.localeCompare(kb as string) : ka - (kb as number);
      return desc ? -c : c;
    });
  });

  function sort(col: Col): void {
    if (sortBy === col) desc = !desc;
    else {
      sortBy = col;
      desc = col !== 'name' && col !== 'sector' && col !== 'focus';
    }
  }

  const pickedId = $derived(campaign.realmPick?.kind === 'world' ? campaign.realmPick.id : null);
  const selected = $derived(worlds.find((w) => w.id === pickedId) ?? rows[0] ?? null);
  function select(id: string): void {
    campaign.realmPick = { kind: 'world', id };
  }
</script>

{#if worlds.length === 0}
  <section class="panel panel-body empty"><p class="dim">{t('realm.empty')}</p></section>
{:else}
  <div class="worlds-tab">
    <section class="panel panel-scroll">
      <div class="panel-header">
        <span>{t('realm.hq.worlds.title')}</span>
        <span class="badge badge-dim">{rows.length} / {worlds.length}</span>
        <span class="spacer"></span>
        <select class="filter" bind:value={sectorFilter}>
          <option value="">{t('realm.hq.worlds.allSectors')}</option>
          {#each sectors as s (s.center)}
            <option value={s.center}>{s.centerName}</option>
          {/each}
          <option value="-">{t('realm.hq.outside')}</option>
        </select>
        <label class="only"><input type="checkbox" bind:checked={alertsOnly} /> {t('realm.hq.alertsOnly')}</label>
        <WikiHelp doc="domain.md" section="4. Развитие и фокус" align="right" label="?" />
      </div>
      <div class="scroll-area">
        <table class="wt">
          <thead>
            <tr>
              {#each COLS as col (col)}
                <th class:num={col !== 'name' && col !== 'sector' && col !== 'focus' && col !== 'alerts' && col !== 'built'} class:active={sortBy === col} onclick={() => sort(col)}>
                  {t(`realm.hq.worlds.col.${col}`)}{#if sortBy === col}<span class="arrow">{desc ? '▼' : '▲'}</span>{/if}
                </th>
              {/each}
            </tr>
          </thead>
          <tbody>
            {#each rows as w (w.id)}
              {@const d = detail.get(w.id)}
              {@const n = w.sector === null ? undefined : sectorIndex.get(w.sector)}
              <tr class:selected={selected?.id === w.id} data-system={w.id} onclick={() => select(w.id)}>
                <td class="name">{w.name}{#if w.capital}<span class="gold"> ★</span>{/if}{#if w.pinned}<span class="dim"> ⚑</span>{/if}</td>
                <td>
                  <span class="alerts">
                    {#each worldAlerts(w) as a (a)}
                      <RealmIcon index={ALERT_ICON[a]} size={16} title={t(`realm.hq.alert.${a}`)} />
                    {/each}
                  </span>
                </td>
                <td>
                  {#if n !== undefined}<span class="swatch" style:background={sectorColor(n)}></span>{/if}
                  {sectorName(w.sector)}
                </td>
                <td><span class="with-icon"><RealmIcon index={FOCUS_ICON[w.focus]} size={16} />{t(`focus.${w.focus}`)}</span></td>
                <td class="num">{w.development}</td>
                <td class="num" class:danger={w.loyalty !== null && w.loyalty < 30} class:gold={w.loyalty !== null && w.loyalty >= 30 && w.loyalty < 60}>
                  {w.loyalty === null ? '—' : loyaltyValue(w.loyalty)}{#if w.loyalty !== null}<span class="dim tiny"> {w.loyaltyDrift > 0 ? '↑' : w.loyaltyDrift < 0 ? '↓' : '·'}</span>{/if}
                </td>
                <td class="num ok">{shortMoney(w.income)}</td>
                <td class="num danger">{shortMoney(-w.upkeep)}</td>
                <td class="num" class:ok={net(w) >= 0} class:danger={net(w) < 0}>{shortMoney(net(w))}</td>
                <td>
                  <span class="pips">
                    {#each BUILDING_KINDS as kind (kind)}
                      <span class="pip" class:built={d?.built.has(kind)} class:building={d?.building === kind} title={t(`realm.world.building.${kind}`)}></span>
                    {/each}
                  </span>
                </td>
                <td class="num">{d !== undefined && d.garrison > 0 ? d.garrison : ''}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    </section>
    <section class="panel panel-scroll">
      <div class="scroll-area panel-body">
        {#if selected !== null}
          {#key selected.id}
            <WorldCard world={selected} />
          {/key}
        {/if}
      </div>
    </section>
  </div>
{/if}

<style>
  .worlds-tab {
    display: grid;
    grid-template-columns: minmax(0, 1.15fr) minmax(420px, 1fr);
    gap: 10px;
    height: 100%;
    padding: 10px;
    min-height: 0;
    overflow: hidden;
  }
  .with-icon {
    display: inline-flex;
    align-items: center;
    gap: 5px;
  }
  .spacer {
    flex: 1;
  }
  .filter {
    background: var(--color-panel-sub);
    color: var(--color-text);
    border: 1px solid var(--color-border);
    font-size: 11px;
  }
  .only {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    color: var(--color-text-dim);
    text-transform: none;
    letter-spacing: 0;
  }
  .wt {
    width: 100%;
    border-collapse: collapse;
    font-family: var(--font-mono);
    font-size: 11.5px;
  }
  .wt th {
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 5px 6px;
    background: var(--color-panel);
    border-bottom: 1px solid var(--color-border);
    color: var(--color-text-dim);
    font-weight: 400;
    text-align: left;
    white-space: nowrap;
    cursor: pointer;
    user-select: none;
  }
  .wt th.active {
    color: var(--color-gold);
  }
  .arrow {
    margin-left: 3px;
    font-size: 9px;
  }
  .wt td {
    padding: 4px 6px;
    border-bottom: 1px solid rgba(48, 54, 61, 0.5);
    white-space: nowrap;
  }
  .wt tr {
    cursor: pointer;
  }
  .wt tbody tr:hover {
    background: rgba(255, 255, 255, 0.03);
  }
  .wt tr.selected {
    background: rgba(88, 166, 255, 0.1);
  }
  .num {
    text-align: right;
  }
  .name {
    font-weight: 700;
  }
  .swatch {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 4px;
    border-radius: 2px;
  }
  .pips {
    display: inline-flex;
    gap: 2px;
  }
  .pip {
    width: 6px;
    height: 6px;
    border: 1px solid var(--color-text-dim);
    opacity: 0.6;
  }
  .pip.built {
    background: var(--color-ok);
    border-color: var(--color-ok);
    opacity: 1;
  }
  .pip.building {
    background: var(--color-gold);
    border-color: var(--color-gold);
    opacity: 1;
  }
  .alerts {
    display: inline-flex;
    gap: 3px;
    vertical-align: middle;
  }
  .empty {
    margin: 10px;
  }
</style>

<script lang="ts">
  import { GALAXY } from '../../core/campaign/galaxy/index.js';
  import { WAR } from '../../core/campaign/index.js';
  import { t, tn } from '../i18n/index.js';
  import { campaign, type RealmWorld, type SectorView } from '../state/campaign.svelte.js';
  import { sectorColor } from './realmMapModel.js';
  import { shortMoney } from './money.js';
  import { worldAlerts } from './worldAlerts.js';
  import RealmIcon from './RealmIcon.svelte';
  import { ALERT_ICON, FOCUS_ICON } from './realmIcons.js';

  /**
   * Миры державы по секторам (шаг 93) — левая колонка Штаба. Группа сектора сворачивается; наведение и
   * выбор общие с картой: навёл строку — мир подсвечен на карте, и наоборот.
   */
  let {
    worlds,
    sectors,
    selected,
    hovered,
    onselect,
    onsector,
    ondropworld,
    onhover,
  }: {
    worlds: readonly RealmWorld[];
    sectors: readonly SectorView[];
    selected: number | null;
    hovered: number | null;
    onselect: (i: number) => void;
    /** Открыть сектор (клик по его имени). */
    onsector: (center: string) => void;
    /** Мир перетащен на группу сектора. */
    ondropworld: (worldId: string, center: string) => void;
    onhover: (i: number | null) => void;
  } = $props();

  /** Предел секторов: свободный слот — золотом, это повод назначить губернатора. */
  const sectorView = $derived(campaign.realmSectors);

  /** Перетаскиваемый мир и группа, над которой он сейчас: подсветка «можно» или «нельзя». */
  let dragging = $state<string | null>(null);
  let over = $state<string | null>(null);
  const dropWhy = (center: string): string | null =>
    dragging === null ? null : campaign.why({ kind: 'assignWorldSector', systemId: dragging, center });

  type Sort = 'alerts' | 'net' | 'name';
  let sort = $state<Sort>('alerts');
  let alertsOnly = $state(false);
  let collapsed = $state<ReadonlySet<string>>(new Set());

  const OUTSIDE = '';

  interface Group {
    readonly key: string;
    readonly color: string | null;
    readonly sector: SectorView | null;
    readonly worlds: readonly RealmWorld[];
    readonly net: number;
  }

  const net = (w: RealmWorld): number => w.income - w.upkeep;

  function sorted(list: readonly RealmWorld[]): RealmWorld[] {
    const out = [...list];
    if (sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name));
    else if (sort === 'net') out.sort((a, b) => net(b) - net(a));
    else out.sort((a, b) => worldAlerts(b).length - worldAlerts(a).length || net(b) - net(a));
    return out;
  }

  const groups = $derived.by((): Group[] => {
    const visible = alertsOnly ? worlds.filter((w) => worldAlerts(w).length > 0) : worlds;
    const out: Group[] = sectors.map((s, n) => {
      const list = visible.filter((w) => w.sector === s.center);
      return { key: s.center, color: sectorColor(n), sector: s, worlds: sorted(list), net: list.reduce((a, w) => a + net(w), 0) };
    });
    const rest = visible.filter((w) => w.sector === null);
    if (rest.length > 0 || sectors.length === 0) {
      out.push({ key: OUTSIDE, color: null, sector: null, worlds: sorted(rest), net: rest.reduce((a, w) => a + net(w), 0) });
    }
    return out;
  });

  function toggle(key: string): void {
    const next = new Set(collapsed);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    collapsed = next;
  }
</script>

<div class="tree panel panel-scroll">
  <div class="panel-header">
    <span>{t('realm.hq.worldsTitle')}</span>
    <span class="badge badge-dim">{worlds.length}</span>
    <span class="spacer"></span>
    <span
      class="badge"
      class:badge-dim={sectorView.used >= sectorView.limit}
      class:badge-gold={sectorView.used < sectorView.limit}
      title={t('realm.sector.hint', { jumps: tn('count.jumps', WAR.realm.sectorJumps), per: tn('count.worlds', WAR.realm.worldsPerSector) })}
    >
      {t('realm.hq.sectorsUsed', { used: sectorView.used, limit: sectorView.limit })}
    </span>
  </div>
  <div class="tools">
    <div class="seg">
      {#each ['alerts', 'net', 'name'] as const as s (s)}
        <button class="seg-btn" class:active={sort === s} onclick={() => (sort = s)}>{t(`realm.hq.sort.${s}`)}</button>
      {/each}
    </div>
    <label class="only">
      <input type="checkbox" bind:checked={alertsOnly} />
      {t('realm.hq.alertsOnly')}
    </label>
  </div>

  <div class="scroll-area groups">
    {#each groups as g (g.key)}
      <div
        class="group"
        class:drop-ok={dragging !== null && over === g.key && g.sector !== null && dropWhy(g.key) === null}
        class:drop-no={dragging !== null && over === g.key && (g.sector === null || dropWhy(g.key) !== null)}
        data-sector={g.key || undefined}
        role="group"
        ondragover={(e) => {
          if (g.sector === null || dragging === null) return;
          over = g.key;
          if (dropWhy(g.key) === null) e.preventDefault();
        }}
        ondragleave={() => {
          if (over === g.key) over = null;
        }}
        ondrop={(e) => {
          e.preventDefault();
          if (g.sector !== null && dragging !== null && dropWhy(g.key) === null) ondropworld(dragging, g.key);
          dragging = null;
          over = null;
        }}
      >
        <div class="group-head">
          <button class="caret" onclick={() => toggle(g.key)}>{collapsed.has(g.key) ? '▸' : '▾'}</button>
          <span class="swatch" style:background={g.color ?? 'transparent'} class:empty={g.color === null}></span>
          {#if g.sector === null}
            <span class="group-name">{t('realm.hq.outside')}</span>
          {:else}
            {@const center = g.sector.center}
            <button class="group-name link" title={t('realm.hq.side.openSector', { name: GALAXY.name(GALAXY.require(center)) })} onclick={() => onsector(center)}>
              {GALAXY.name(GALAXY.require(center))}
            </button>
          {/if}
          <span class="group-net" class:neg={g.net < 0}>{shortMoney(g.net)}</span>
        </div>
        {#if dragging !== null && over === g.key && g.sector !== null && dropWhy(g.key) !== null}
          <div class="drop-why">{dropWhy(g.key)}</div>
        {/if}
        {#if g.sector !== null}
          <div class="group-sub">
            {#if g.sector.governor === null}
              <span class="danger">{t('realm.hq.vacant')}</span>
            {:else}
              <span>{g.sector.governor.callsign}</span>
            {/if}
            · {t(`realm.sector.priority.${g.sector.priority}`)} · {tn('count.worlds', g.sector.worlds.length)}
          </div>
        {/if}
        {#if !collapsed.has(g.key)}
          {#each g.worlds as w (w.id)}
            {@const i = GALAXY.require(w.id)}
            <button
              class="row"
              class:selected={selected === i}
              class:hover={hovered === i}
              class:dragging={dragging === w.id}
              data-system={w.id}
              draggable="true"
              ondragstart={(e) => {
                dragging = w.id;
                e.dataTransfer?.setData('text/plain', w.id);
              }}
              ondragend={() => {
                dragging = null;
                over = null;
              }}
              onclick={() => onselect(i)}
              onpointerenter={() => onhover(i)}
              onpointerleave={() => onhover(null)}
            >
              <RealmIcon index={FOCUS_ICON[w.focus]} size={16} title={t(`focus.${w.focus}`)} />
              <span class="name">
                {w.name}{#if w.capital}<span class="gold"> ★</span>{/if}{#if w.pinned}<span class="dim"> ⚑</span>{/if}
              </span>
              <span class="alerts">
                {#each worldAlerts(w) as a (a)}
                  <RealmIcon index={ALERT_ICON[a]} size={16} title={t(`realm.hq.alert.${a}`)} />
                {/each}
              </span>
              <span class="net" class:neg={net(w) < 0}>{shortMoney(net(w))}</span>
            </button>
          {/each}
        {/if}
      </div>
    {/each}
  </div>
</div>

<style>
  .tree {
    height: 100%;
  }
  .spacer {
    flex: 1;
  }
  .tools {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 6px 10px;
    border-bottom: 1px solid var(--color-border);
  }
  .seg {
    display: flex;
  }
  .seg-btn {
    padding: 2px 7px;
    font-size: 10.5px;
    background: transparent;
    border: 1px solid var(--color-border);
    color: var(--color-text-dim);
    cursor: pointer;
  }
  .seg-btn + .seg-btn {
    margin-left: -1px;
  }
  .seg-btn.active {
    color: var(--color-gold);
    border-color: var(--color-gold);
    position: relative;
  }
  .only {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10.5px;
    color: var(--color-text-dim);
    cursor: pointer;
  }
  .groups {
    padding: 4px 0;
  }
  .group + .group {
    border-top: 1px solid var(--color-border);
  }
  .group-head {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 10px 2px;
    color: var(--color-text);
    font-family: var(--font-display);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    text-align: left;
  }
  .caret {
    width: 14px;
    padding: 0;
    background: none;
    border: none;
    color: var(--color-text-dim);
    cursor: pointer;
  }
  .group-name.link {
    padding: 0;
    background: none;
    border: none;
    color: inherit;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    text-align: left;
    cursor: pointer;
  }
  .group-name.link:hover {
    color: var(--color-accent);
  }
  .group.drop-ok {
    background: rgba(63, 185, 80, 0.08);
    outline: 1px dashed var(--color-ok);
  }
  .group.drop-no {
    background: rgba(248, 81, 73, 0.06);
  }
  .drop-why {
    padding: 0 10px 4px 36px;
    font-size: 10.5px;
    color: var(--color-danger);
  }
  .row.dragging {
    opacity: 0.5;
  }
  .swatch {
    width: 9px;
    height: 9px;
    border-radius: 2px;
    flex-shrink: 0;
  }
  .swatch.empty {
    border: 1px dashed var(--color-text-dim);
  }
  .group-name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .group-net,
  .net {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--color-ok);
    white-space: nowrap;
  }
  .neg {
    color: var(--color-danger);
  }
  .group-sub {
    padding: 0 10px 4px 36px;
    font-size: 10.5px;
    color: var(--color-text-dim);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 3px 10px 3px 20px;
    background: none;
    border: none;
    border-left: 2px solid transparent;
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: 11.5px;
    text-align: left;
    cursor: pointer;
  }
  .row.hover {
    background: rgba(255, 255, 255, 0.04);
  }
  .row.selected {
    background: rgba(88, 166, 255, 0.1);
    border-left-color: var(--color-border-active);
  }
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .alerts {
    display: flex;
    gap: 2px;
  }
</style>

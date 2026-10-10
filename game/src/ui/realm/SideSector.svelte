<script lang="ts">
  import { GALAXY } from '../../core/campaign/galaxy/index.js';
  import { GOVERNOR_PRIORITIES } from '../../core/campaign/index.js';
  import { tr } from '../../core/log/index.js';
  import { MAX_SKILL } from '../../core/model/Pilot.js';
  import { campaign } from '../state/campaign.svelte.js';
  import { cbills, t, tn } from '../i18n/index.js';
  import PilotPortrait from '../components/PilotPortrait.svelte';
  import GovernorPicker from './GovernorPicker.svelte';
  import RealmIcon from './RealmIcon.svelte';
  import { GOVERNOR_ICON, PRIORITY_ICON } from './realmIcons.js';
  import { priorityHint } from './sectorText.js';

  /**
   * Сектор в правой колонке Штаба (шаг 93): губернатор с портретом и навыками, приоритет, миры, резерв кассы.
   * Миры в сектор переносят на карте в режиме «Секторы» или перетаскиванием в списке слева.
   */
  let { center, onshow }: { center: string; onshow: (i: number) => void } = $props();

  const view = $derived(campaign.realmSectors);
  const sector = $derived(view.sectors.find((s) => s.center === center) ?? null);
  const pilot = $derived(sector?.governor == null ? undefined : campaign.pilots.find((p) => p.id === sector.governor?.id));

  let changing = $state(false);
  let confirmRelease = $state(false);
  const pct = (v: number): string => `${Math.round(v * 100)} %`;
</script>

{#if sector !== null}
  <div class="head">
    {#if pilot !== undefined}
      <PilotPortrait {pilot} width={48} />
    {:else}
      <div class="vacant"><RealmIcon index={GOVERNOR_ICON} size={40} /></div>
    {/if}
    <div>
      <div class="strong big">{t('realm.hq.side.sectorTitle', { name: sector.centerName })}</div>
      {#if sector.governor === null}
        <div class="danger tiny">{t('realm.sector.vacant')}</div>
      {:else}
        <div class="dim tiny">{sector.governor.callsign}</div>
      {/if}
    </div>
  </div>

  {#if sector.governor !== null}
    {@const g = sector.governor}
    <div class="skills">
      {#each [['presence', g.presence], ['tech', g.tech], ['tactics', g.tactics]] as const as [k, v] (k)}
        <div class="skill">
          <span class="dim tiny">{tr(`skill.${k}`)}</span>
          <div class="bar"><div class="fill" style:width="{(v / MAX_SKILL) * 100}%"></div></div>
          <span class="tiny">{v}</span>
        </div>
      {/each}
    </div>
    <p class="dim tiny">
      {t('realm.sector.bonus', { loyalty: g.bonus.loyalty.toFixed(1), points: g.bonus.points, defence: pct(g.bonus.defence - 1) })}
    </p>
  {/if}

  <div class="sec">{t('realm.sector.priorityTitle')}</div>
  <div class="seg">
    {#each GOVERNOR_PRIORITIES as pr (pr)}
      <button
        class="seg-btn"
        class:active={sector.priority === pr}
        disabled={sector.priority === pr}
        title={priorityHint(pr)}
        onclick={() => campaign.run({ kind: 'setSectorPriority', centerId: center, priority: pr })}
      >
        <RealmIcon index={PRIORITY_ICON[pr]} size={16} />{t(`realm.sector.priority.${pr}`)}
      </button>
    {/each}
  </div>
  <p class="dim tiny">{priorityHint(sector.priority)}</p>

  <div class="sec">{tn('count.worlds', sector.worlds.length)}</div>
  <div class="worlds">
    {#each sector.worlds as w (w.id)}
      <button class="world-link" onclick={() => onshow(GALAXY.require(w.id))}>
        {w.name}{#if w.pinned}<span class="dim"> ⚑</span>{/if}
      </button>
    {/each}
  </div>
  <p class="dim tiny">{t('realm.hq.side.dragHint')}</p>

  <div class="sec">{t('realm.sector.reserve')}</div>
  <div class="seg">
    {#each view.reserveSteps as step (step)}
      <button
        class="seg-btn"
        class:active={view.reserve === step}
        disabled={view.reserve === step}
        onclick={() => campaign.run({ kind: 'setRealmReserve', amount: step })}
      >
        {cbills(step)}
      </button>
    {/each}
  </div>
  <p class="dim tiny">{t('realm.sector.reserveHint')}</p>

  <div class="sec">{sector.governor === null ? t('realm.sector.appoint') : t('realm.hq.side.governor')}</div>
  {#if sector.governor === null || changing}
    <GovernorPicker {center} priority={sector.priority} />
  {:else}
    <button class="btn btn-sm" onclick={() => (changing = true)}>{t('realm.hq.side.changeGovernor')}</button>
  {/if}

  <div class="danger-zone">
    {#if confirmRelease}
      <p class="danger tiny">{t('realm.hq.side.releaseConfirm')}</p>
      <div class="row">
        <button class="btn btn-sm btn-danger" onclick={() => campaign.run({ kind: 'releaseGovernor', centerId: center })}>
          {t('realm.sector.release')}
        </button>
        <button class="btn btn-sm" onclick={() => (confirmRelease = false)}>{t('common.cancel')}</button>
      </div>
    {:else}
      <button class="link-btn" onclick={() => (confirmRelease = true)}>⋯ {t('realm.sector.release')}</button>
    {/if}
  </div>
{/if}

<style>
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .vacant {
    width: 48px;
    height: 48px;
    display: grid;
    place-items: center;
    border: 1px dashed var(--color-danger);
    color: var(--color-danger);
    font-weight: 700;
    font-size: 20px;
  }
  .vacant :global(.ri) {
    opacity: 0.5;
  }
  .big {
    font-size: 14px;
  }
  .skills {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .skill {
    display: grid;
    grid-template-columns: 90px 1fr 20px;
    align-items: center;
    gap: 6px;
  }
  .bar {
    height: 5px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
  }
  .fill {
    height: 100%;
    background: var(--color-accent);
  }
  .sec {
    margin-top: 8px;
    padding-bottom: 3px;
    border-bottom: 1px solid var(--color-border);
    font-family: var(--font-display);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }
  .seg {
    display: flex;
    flex-wrap: wrap;
  }
  .seg-btn :global(.ri) {
    opacity: 0.55;
  }
  .seg-btn.active :global(.ri),
  .seg-btn:hover :global(.ri) {
    opacity: 1;
  }
  .seg-btn {
    padding: 2px 7px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: 10.5px;
    background: transparent;
    border: 1px solid var(--color-border);
    color: var(--color-text-dim);
    cursor: pointer;
    margin: 0 -1px -1px 0;
  }
  .seg-btn.active {
    color: var(--color-gold);
    border-color: var(--color-gold);
    position: relative;
    cursor: default;
  }
  .worlds {
    display: flex;
    flex-wrap: wrap;
    gap: 3px;
  }
  .world-link {
    padding: 1px 6px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    color: var(--color-text);
    font-size: 11px;
    cursor: pointer;
  }
  .world-link:hover {
    border-color: var(--color-border-active);
  }
  .danger-zone {
    margin-top: 12px;
  }
  .row {
    display: flex;
    gap: 6px;
  }
  .link-btn {
    background: none;
    border: none;
    padding: 0;
    color: var(--color-text-dim);
    font-size: 11px;
    cursor: pointer;
  }
  .link-btn:hover {
    color: var(--color-danger);
  }
</style>

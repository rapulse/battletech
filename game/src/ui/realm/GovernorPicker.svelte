<script lang="ts">
  import { GOVERNOR_PRIORITIES, type GovernorPriority } from '../../core/campaign/index.js';
  import { tr } from '../../core/log/index.js';
  import { campaign } from '../state/campaign.svelte.js';
  import { t } from '../i18n/index.js';
  import PilotPortrait from '../components/PilotPortrait.svelte';
  import { priorityHint } from './sectorText.js';
  import RealmIcon from './RealmIcon.svelte';
  import { PRIORITY_ICON } from './realmIcons.js';

  /**
   * Выбор губернатора для сектора с этим центром (шаг 93): новый сектор, пустой пост или смена. Пилоты — с
   * портретами и навыками, что дают бонус; назначает та же команда `appointGovernor`, что у прежнего экрана.
   */
  let { center, priority: initial = 'income' }: { center: string; priority?: GovernorPriority } = $props();

  const pilots = $derived(campaign.realmSectors.pilots);
  const byId = $derived(new Map(campaign.pilots.map((p) => [p.id, p])));
  /** Лучшие для сектора — сверху: сумма навыков, что дают бонус. */
  const ordered = $derived([...pilots].sort((a, b) => b.presence + b.tech + b.tactics - (a.presence + a.tech + a.tactics)));

  let pick = $state<string | null>(null);
  let priority = $state<GovernorPriority>('income');
  $effect(() => {
    priority = initial;
  });

  const cmd = $derived(pick === null ? null : ({ kind: 'appointGovernor', centerId: center, pilotId: pick, priority } as const));
  const why = $derived(cmd === null ? null : campaign.why(cmd));
</script>

<div class="picker">
  {#if ordered.length === 0}
    <p class="dim tiny">{t('realm.hq.side.noPilots')}</p>
  {:else}
    <div class="pilots">
      {#each ordered as p (p.id)}
        {@const pilot = byId.get(p.id)}
        <button class="pilot" class:active={pick === p.id} data-pilot={p.id} onclick={() => (pick = p.id)}>
          {#if pilot !== undefined}<PilotPortrait {pilot} width={32} bordered={false} />{/if}
          <span class="who">
            <span class="strong">{p.callsign}</span>
            <span class="dim tiny">{tr('skill.presence')} {p.presence} · {tr('skill.tech')} {p.tech} · {tr('skill.tactics')} {p.tactics}</span>
          </span>
        </button>
      {/each}
    </div>
    <div class="seg">
      {#each GOVERNOR_PRIORITIES as pr (pr)}
        <button class="seg-btn" class:active={priority === pr} title={priorityHint(pr)} onclick={() => (priority = pr)}>
          <RealmIcon index={PRIORITY_ICON[pr]} size={16} />{t(`realm.sector.priority.${pr}`)}
        </button>
      {/each}
    </div>
    <button class="btn btn-sm btn-gold" disabled={cmd === null || why !== null} onclick={() => cmd !== null && campaign.run(cmd)}>
      {t('realm.sector.appointGo')}
    </button>
    {#if why !== null}<p class="dim tiny">{why}</p>{/if}
  {/if}
</div>

<style>
  .picker {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .pilots {
    display: flex;
    flex-direction: column;
    gap: 3px;
    max-height: 210px;
    overflow-y: auto;
  }
  .pilot {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 6px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    color: var(--color-text);
    text-align: left;
    cursor: pointer;
  }
  .pilot.active {
    border-color: var(--color-gold);
    background: rgba(227, 179, 65, 0.1);
  }
  .who {
    display: flex;
    flex-direction: column;
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
  }
</style>

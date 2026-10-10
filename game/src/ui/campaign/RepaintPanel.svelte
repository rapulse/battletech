<script lang="ts">
  import type { MechRecord } from '../../core/campaign/mech/MechRecord.js';
  import { REPAINT_DAYS, repaintCost } from '../../core/campaign/mech/repaint.js';
  import { campaign } from '../state/campaign.svelte.js';
  import { cbills, days as daysText, t } from '../i18n/index.js';
  import {
    mechArtThumbUrl,
    paintOfFaction,
    paintOfRecord,
    paintsOf,
    pickMechArt,
    resolvePaint,
  } from '../components/mechArt.js';

  /**
   * Перекраска машины (шаг 50) — под крупным портретом в мехлабе.
   *
   * Предлагает только те раскраски, которые у рисунка этой машины реально
   * нарисованы (`paintsOf`), без тех цветов, в которых машина уже ходит, и
   * «как досталась» — вернуть цвета происхождения, если машину перекрашивали.
   * Цена, срок и причина отказа — словами ядра (`campaign.why`): своих проверок
   * экран не держит.
   */
  let {
    mech,
    onPreview,
  }: {
    mech: MechRecord;
    onPreview?: ((paint: string | null) => void) | undefined;
  } = $props();

  interface Option {
    /** Что уйдёт в команду: id раскраски или `null` — цвета происхождения. */
    readonly paint: string | null;
    /** Какую картинку показать на образце. */
    readonly shows: string;
    readonly label: string;
  }

  const pick = $derived(pickMechArt(mech.assembly.chassisCode));
  const shown = $derived(pick === null ? null : resolvePaint(pick.base, paintOfRecord(mech)));
  const job = $derived(campaign.jobOf(mech.id));
  const cost = $derived(repaintCost(mech));

  const options = $derived.by((): Option[] => {
    if (pick === null) return [];
    const list: Option[] = paintsOf(pick.base)
      .filter((p) => p !== shown)
      .map((p) => ({ paint: p, shows: p, label: t(`paint.${p}`) }));
    const origin = resolvePaint(pick.base, paintOfFaction(mech.originFaction));
    if (mech.paint !== undefined && origin !== null && origin !== shown) {
      list.unshift({ paint: null, shows: origin, label: t('mechlab.repaint.origin') });
    }
    return list;
  });

  let open = $state(false);
  let chosen = $state<Option | null>(null);

  $effect(() => {
    const p = chosen?.shows ?? null;
    onPreview?.(p);
    return () => {
      onPreview?.(null);
    };
  });

  const command = $derived(
    chosen === null ? null : ({ kind: 'repaintMech', recordId: mech.id, paint: chosen.paint } as const),
  );
  const why = $derived(command === null ? null : campaign.why(command));

  function close(): void {
    open = false;
    chosen = null;
  }

  function confirm(): void {
    if (command !== null && campaign.run(command)) close();
  }
</script>

{#if job !== null && job.work === 'repaintMech'}
  <p class="note gold tiny">
    {t('mechlab.repaint.inWork', { days: daysText(Math.max(0, job.day - campaign.day)) })}
  </p>
{:else if !open}
  <button class="btn btn-sm btn-wide" disabled={options.length === 0} onclick={() => (open = true)}>
    {t('mechlab.repaint.open')}
  </button>
  {#if options.length === 0}
    <p class="note dim tiny">{t('mechlab.repaint.none')}</p>
  {/if}
{:else if pick !== null}
  <div class="repaint">
    <div class="head">
      <span class="cyan tiny bold">{t('mechlab.repaint.title')}</span>
      <span class="dim tiny">
        {t('mechlab.repaint.hint', { days: daysText(REPAINT_DAYS), sum: cbills(cost) })}
      </span>
    </div>
    <div class="swatches">
      {#each options as o (o.paint ?? '')}
        <button
          type="button"
          class="swatch"
          class:active={chosen?.paint === o.paint}
          title={o.label}
          onclick={() => (chosen = chosen?.paint === o.paint ? null : o)}
        >
          <img src={mechArtThumbUrl(pick, o.shows)} alt="" loading="lazy" decoding="async" />
          <span class="tiny">{o.label}</span>
        </button>
      {/each}
    </div>
    <div class="buttons">
      <button class="btn btn-sm" onclick={close}>{t('common.cancel')}</button>
      <button
        class="btn btn-sm"
        disabled={chosen === null || why !== null}
        title={why ?? ''}
        onclick={confirm}
      >
        {chosen === null ? t('mechlab.repaint.open') : t('mechlab.repaint.confirm', { paint: chosen.label })}
      </button>
    </div>
    {#if why !== null}
      <p class="note danger tiny">{why}</p>
    {/if}
  </div>
{/if}

<style>
  .note {
    margin: 4px 0 0;
    text-align: center;
  }
  .repaint {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 8px;
  }
  .swatches {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
    gap: 6px;
  }
  .swatch {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 4px;
    font: inherit;
    color: inherit;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    border-radius: 2px;
    cursor: pointer;
  }
  .swatch:hover {
    border-color: var(--color-border-active);
  }
  .swatch.active {
    border-color: var(--color-accent);
  }
  .swatch img {
    display: block;
    width: 100%;
    aspect-ratio: 1;
    object-fit: cover;
  }
  .buttons {
    display: flex;
    justify-content: flex-end;
    gap: 6px;
  }
</style>

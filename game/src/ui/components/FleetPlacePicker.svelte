<script lang="ts">
  import { campaign } from '../state/campaign.svelte.js';
  import type { FleetPlace } from '../state/fleetPlaces.js';
  import { t } from '../i18n/index.js';
  import { dropshipName } from '../i18n/names.js';

  /**
   * Выбор места над списком парка: корабль всегда первым, дальше миры. Пока
   * выбирать не из чего (одни машины на борту), выбора нет вовсе. Место общее
   * для ангара и мехлаба — `campaign.hangarPlace`.
   */
  interface Props {
    places: readonly FleetPlace[];
    /** Показанное место: выбранный мир, если экран его допускает, иначе корабль. */
    place: string | null;
  }
  const { places, place }: Props = $props();
</script>

{#if places.length > 0}
  <div class="place-row">
    <select
      class="place-select"
      aria-label={t('hangar.placeLabel')}
      value={place ?? ''}
      onchange={(e) => (campaign.hangarPlace = e.currentTarget.value === '' ? null : e.currentTarget.value)}
    >
      <option value="">
        {t('hangar.placeShip', {
          ship: dropshipName(campaign.dropshipDef.id, campaign.dropshipDef.name),
          count: campaign.aboardCount,
        })}
      </option>
      {#each places as p (p.id)}
        <option value={p.id}>{t('hangar.placeWorld', { system: p.name, count: p.count })}</option>
      {/each}
    </select>
  </div>
{/if}

<style>
  .place-row {
    padding: 8px 10px 0;
  }
  .place-select {
    width: 100%;
    background: var(--color-bg);
    border: 1px solid var(--color-border);
    border-radius: 2px;
    color: var(--color-text);
    font-family: var(--font-mono);
    font-size: 12px;
    padding: 6px 8px;
    cursor: pointer;
  }
  .place-select:focus {
    outline: none;
    border-color: var(--color-accent);
    box-shadow: 0 0 8px var(--glow-cyan);
  }
</style>

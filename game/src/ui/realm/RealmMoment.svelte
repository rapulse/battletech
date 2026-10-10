<script lang="ts">
  import { campaign } from '../state/campaign.svelte.js';
  import { formatDate, t } from '../i18n/index.js';
  import { dateOf } from '../campaign/relations.js';
  import { warLineText } from '../campaign/warLineText.js';
  import { latestMoment, MOMENT_IMAGE } from './realmMoment.js';

  /**
   * Поворот державы картинкой (после шага 93): последний за `MOMENT_DAYS` — война, мир, восстание, взятый или
   * потерянный мир. Время не останавливает; подпись — та же строка сводки, что в ленте ниже.
   */
  const shown = $derived(latestMoment(campaign.warLog.filter((l) => l.realm === true), campaign.day));
  const url = (path: string): string => `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
</script>

{#if shown !== null}
  <div class="moment" class:bad={shown.moment === 'lost' || shown.moment === 'revolt' || shown.moment === 'war'} data-moment={shown.moment}>
    <img src={url(MOMENT_IMAGE[shown.moment])} alt={t(`realm.hq.moment.${shown.moment}`)} />
    <div class="cap">
      <span class="kind">{t(`realm.hq.moment.${shown.moment}`)}</span>
      <span class="date">{formatDate(dateOf(shown.line.day))}</span>
    </div>
    <p class="line">{warLineText(shown.line)}</p>
  </div>
{/if}

<style>
  .moment {
    position: relative;
    max-width: 560px;
    border: 1px solid var(--color-border);
    background: var(--color-panel-sub);
  }
  .moment img {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 7;
    object-fit: cover;
  }
  .cap {
    position: absolute;
    left: 0;
    right: 0;
    top: 0;
    display: flex;
    justify-content: space-between;
    padding: 4px 8px;
    background: linear-gradient(rgba(13, 17, 23, 0.85), rgba(13, 17, 23, 0));
    font-size: 11px;
  }
  .kind {
    font-family: var(--font-display);
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--color-gold);
  }
  .moment.bad .kind {
    color: var(--color-danger);
  }
  .date {
    color: var(--color-text-dim);
  }
  .line {
    margin: 0;
    padding: 5px 8px;
    font-size: 11px;
  }
</style>

<script lang="ts">
  import { campaign } from '../state/campaign.svelte.js';
  import { formatDate, t } from '../i18n/index.js';
  import { dateOf, factionName } from './relations.js';

  /**
   * Карточка события мира (шаг 84): веха эпохи из `data/events.json`.
   *
   * Пока карточка открыта, время стоит — ядро отказывает прокрутке (`eventPending`), и закрыть её
   * можно только ответом. Поэтому у подложки нет «клика мимо» и Escape: карточка — не справка,
   * а остановка, как ожидающий бой. Заголовок и текст — `worldEvent.<id>.*`, картинка — из данных;
   * у события без картинки на её месте пустая рамка. Путь в данных — от `public/`, склеивается с
   * `BASE_URL`: игра лежит в подпапке Pages (`tools/deploy_play.md`).
   */
  const ev = $derived(campaign.pendingWorldEvent);
  const imageUrl = $derived(ev?.image === undefined ? null : `${import.meta.env.BASE_URL}${ev.image.replace(/^\//, '')}`);

  function signed(n: number): string {
    return n > 0 ? `+${n}` : String(n);
  }
</script>

{#if ev !== null}
  <div class="modal-backdrop" role="presentation">
    <div class="modal event-modal" role="dialog" aria-modal="true" aria-labelledby="event-title" tabindex="-1">
      <div class="panel-header">
        <span class="dim small">{t('worldEvent.card.header')} · {formatDate(dateOf(ev.day))}</span>
      </div>

      <div class="event-body">
        <h2 id="event-title" class="gold">{t(`worldEvent.${ev.id}.title`)}</h2>
        {#if imageUrl !== null}
          <img class="art" src={imageUrl} alt={t(`worldEvent.${ev.id}.title`)} />
        {:else}
          <div class="art placeholder dim small">{t('worldEvent.card.image')}</div>
        {/if}
        <p>{t(`worldEvent.${ev.id}.body`)}</p>
        {#if ev.realm}
          <p class="cyan">{t('worldEvent.card.realm')}</p>
        {/if}

        {#if ev.invite !== null}
          {@const inv = ev.invite}
          <p>
            {t('worldEvent.card.invite', {
              allies: inv.allies.map(factionName).join(', '),
              against: factionName(inv.against),
            })}
          </p>
          <div class="choices">
            <button
              class="btn"
              disabled={!campaign.can({ kind: 'answerEvent', id: ev.id, accept: true })}
              onclick={() => campaign.answerWorldEvent(ev.id, true)}
            >
              {t('worldEvent.card.accept')}
            </button>
            <span class="dim small">{t('worldEvent.card.acceptHint', { standing: signed(inv.accept) })}</span>
            <button class="btn" onclick={() => campaign.answerWorldEvent(ev.id, false)}>
              {t('worldEvent.card.decline')}
            </button>
            <span class="dim small">{t('worldEvent.card.declineHint', { standing: signed(inv.decline) })}</span>
          </div>
        {:else}
          <div class="choices">
            <button class="btn" onclick={() => campaign.answerWorldEvent(ev.id)}>{t('worldEvent.card.ok')}</button>
          </div>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .event-modal {
    max-width: 560px;
  }
  .event-body {
    padding: 12px 16px 16px;
    min-height: 0;
    overflow-y: auto;
  }
  h2 {
    margin: 0 0 10px;
    font-size: 18px;
  }
  .art {
    display: block;
    width: 100%;
    aspect-ratio: 16 / 7;
    object-fit: cover;
    margin-bottom: 10px;
  }
  .placeholder {
    display: grid;
    place-items: center;
    border: 1px dashed var(--color-border);
  }
  .choices {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 8px 12px;
    align-items: center;
    margin-top: 12px;
  }
  .small {
    font-size: 11px;
  }
</style>

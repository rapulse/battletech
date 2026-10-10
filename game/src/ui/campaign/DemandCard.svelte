<script lang="ts">
  import { campaign } from '../state/campaign.svelte.js';
  import { cbills, formatDate, t } from '../i18n/index.js';
  import { dateOf, factionName } from './relations.js';
  import { WAR } from '../../core/campaign/index.js';

  /**
   * Карточка требования соседа (шаг 89): сильный сосед требует дань с пограничного мира державы.
   *
   * Как карточка события мира (шаг 84), это остановка, а не справка: прокрутка стоит, пока игрок не ответит, у
   * подложки нет «клика мимо» и Escape. Числа — те же, что исполнит ответ (`war/demands.ts`).
   */
  const d = $derived(campaign.pendingDemand);

  function signed(n: number): string {
    return n > 0 ? `+${n}` : String(n);
  }
</script>

{#if d !== null && campaign.pendingWorldEvent === null}
  <div class="modal-backdrop" role="presentation">
    <div class="modal demand-modal" role="dialog" aria-modal="true" aria-labelledby="demand-title" tabindex="-1">
      <div class="panel-header">
        <span class="dim small">{t('demand.header')} · {formatDate(dateOf(d.day))}</span>
      </div>
      <div class="demand-body">
        <h2 id="demand-title" class="gold">{t('demand.title', { faction: factionName(d.from) })}</h2>
        <p>
          {t('demand.body', {
            faction: factionName(d.from),
            system: d.system,
            sum: cbills(d.perDecade),
            decades: d.decades,
          })}
        </p>
        <p class="dim small">
          {Number.isFinite(d.ratio)
            ? t('demand.force', { ratio: d.ratio.toFixed(1) })
            : t('demand.forceNone')}
          · {t('demand.standing', { standing: Math.round(d.standing) })}
        </p>
        <div class="choices">
          <button class="btn" onclick={() => campaign.answerDemand(true)}>{t('demand.accept')}</button>
          <span class="dim small">{t('demand.acceptHint', { standing: signed(WAR.demands.acceptStanding) })}</span>
          <button class="btn" onclick={() => campaign.answerDemand(false)}>{t('demand.refuse')}</button>
          <span class="dim small">
            {t('demand.refuseHint', {
              standing: signed(WAR.demands.refuseStanding),
              war: WAR.playerWar.aiDeclareStanding,
              raid: Math.round(WAR.demands.refuseRaidChance * 100),
            })}
          </span>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .demand-modal {
    max-width: 560px;
  }
  .demand-body {
    padding: 12px 16px 16px;
  }
  h2 {
    margin: 0 0 10px;
    font-size: 18px;
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

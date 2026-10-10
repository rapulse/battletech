<script lang="ts">
  import { FRONT_STANCES, GALAXY, WAR } from '../../core/campaign/index.js';
  import { campaign } from '../state/campaign.svelte.js';
  import { cbills, t, tn } from '../i18n/index.js';
  import { factionName } from '../campaign/relations.js';
  import RealmIcon from './RealmIcon.svelte';
  import { STANCE_ICON } from './realmIcons.js';

  /**
   * Война державы с владельцем выбранной системы — в правой колонке Штаба (шаг 93): счёт, усталость сторон,
   * стойка и её цель, приказ на эту систему с шансом. Те же команды, что у прежнего экрана.
   * Враг с первого дня (участок фронта есть, записи войны нет) — только приказ: стойка и цель ждут первого боя.
   */
  let { factionId, systemId }: { factionId: string; systemId: string } = $props();

  const war = $derived(campaign.realmWars.find((w) => w.factionId === factionId) ?? null);
  const front = $derived(campaign.realmOffensives.fronts.find((f) => f.factionId === factionId) ?? null);
  const here = $derived(front?.targets.find((x) => x.id === systemId) ?? null);
  const minOdds = Math.round(WAR.realm.stanceMinOdds * 100);
  const pct = (v: number): number => Math.round(v * 100);
  const nameOf = (id: string): string => GALAXY.name(GALAXY.require(id));

  const targetCmd = $derived({ kind: 'setStanceTarget', factionId, systemId } as const);
  const targetWhy = $derived(campaign.why(targetCmd));
</script>

{#if war === null && front !== null}
  <div class="sec">{t('realm.hq.side.warTitle', { faction: factionName(factionId) })}</div>
  <p class="danger tiny">{t('realm.hq.forces.bornEnemy')}</p>
  <p class="dim tiny">{t('realm.hq.forces.bornEnemyHint')}</p>
{/if}
{#if war !== null}
  <div class="sec">{t('realm.hq.side.warTitle', { faction: factionName(factionId) })}</div>
  <p class="tiny dim">{t('realm.war.since', { date: campaign.dateText(war.since), won: war.won, lost: war.lost })}</p>

  <div class="fatigue">
    <span class="tiny dim">{t('realm.hq.side.fatigueRealm')}</span>
    <div class="bar"><div class="fill" style:width="{pct(war.fatigue)}%"></div></div>
    <span class="tiny">{pct(war.fatigue)} %</span>
    <span class="tiny dim">{factionName(factionId)}</span>
    <div class="bar"><div class="fill foe" style:width="{pct(war.foeFatigue)}%"></div></div>
    <span class="tiny">{pct(war.foeFatigue)} %</span>
  </div>
  {#if war.offerUntil !== null}
    <p class="ok tiny">{t('realm.war.offer', { date: campaign.dateText(war.offerUntil) })}</p>
  {/if}
  {#if war.foeGoal.length > 0}
    <p class="danger tiny">{t('realm.war.foeGoal', { systems: war.foeGoal.join(', ') })}</p>
  {/if}

  <div class="sec">{t('realm.stance.title')}</div>
  <div class="seg" title={t('realm.stance.hint', { odds: minOdds })}>
    {#each FRONT_STANCES as st (st)}
      <button
        class="seg-btn"
        class:active={war.stance === st}
        disabled={war.stance === st}
        onclick={() => campaign.run({ kind: 'setFrontStance', factionId, stance: st })}
      >
        <RealmIcon index={STANCE_ICON[st]} size={16} />{t(`realm.stance.${st}`)}
      </button>
    {/each}
  </div>
  {#if war.stanceFocusId !== null}
    <p class="tiny gold">{t('realm.hq.side.targetChosen', { system: nameOf(war.stanceFocusId) })}</p>
    <button class="link-btn" onclick={() => campaign.run({ kind: 'setStanceTarget', factionId, systemId: null })}>
      {t('realm.hq.side.targetClear')}
    </button>
  {:else if war.stanceTarget !== null}
    <p class="tiny dim">{t('realm.hq.side.targetAuto', { system: war.stanceTarget })}</p>
  {:else}
    <p class="tiny dim">{t('realm.stance.noTarget', { odds: minOdds })}</p>
  {/if}
{/if}

{#if war !== null || front !== null}
  {#if here !== null}
    <div class="sec">{nameOf(systemId)}</div>
    <p class="small">{t('realm.map.oddsLine', { odds: pct(here.odds) })}</p>
    {#if war !== null && war.stanceFocusId !== systemId}
      <button class="btn btn-sm btn-gold" disabled={targetWhy !== null} title={targetWhy ?? t('realm.hq.side.targetHint', { odds: minOdds })} onclick={() => campaign.run(targetCmd)}>
        {t('realm.hq.side.makeTarget')}
      </button>
    {/if}
    <button
      class="btn btn-sm btn-danger"
      disabled={here.why !== null}
      title={here.why ?? t('realm.offensive.oddsHint')}
      onclick={() => campaign.run({ kind: 'orderOffensive', systemId })}
    >
      {t('realm.offensive.order', { system: nameOf(systemId), odds: pct(here.odds) })}
    </button>
    {#if front !== null}<p class="dim tiny">{t('realm.hq.side.orderCost', { sum: cbills(front.cost), mechs: tn('count.mechs', front.mechs) })}</p>{/if}
    {#if here.lance > 0}<p class="dim tiny">{t('realm.offensive.company', { mechs: tn('count.mechs', here.lance) })}</p>{/if}
    {#if here.readyDay !== null}
      <p class="dim tiny">{t('realm.offensive.ready', { date: campaign.dateText(here.readyDay) })}</p>
    {:else if here.why !== null}
      <p class="dim tiny">{here.why}</p>
    {/if}
  {:else}
    <p class="dim tiny">{t('realm.hq.side.notTarget')}</p>
  {/if}
{/if}

<style>
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
  .fatigue {
    display: grid;
    grid-template-columns: auto 1fr 36px;
    align-items: center;
    gap: 3px 6px;
  }
  .bar {
    height: 5px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
  }
  .fill {
    height: 100%;
    background: var(--color-gold);
  }
  .fill.foe {
    background: var(--color-danger);
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
  .link-btn {
    align-self: flex-start;
    background: none;
    border: none;
    padding: 0;
    color: var(--color-text-dim);
    font-size: 11px;
    cursor: pointer;
  }
  .link-btn:hover {
    color: var(--color-text);
  }
</style>

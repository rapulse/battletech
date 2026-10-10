<script lang="ts">
  import { WAR } from '../../core/campaign/index.js';
  import { campaign } from '../state/campaign.svelte.js';
  import { cbills, t, tn } from '../i18n/index.js';
  import { factionName } from '../campaign/relations.js';
  import FactionEmblem from '../components/FactionEmblem.svelte';
  import WikiHelp from '../wiki/WikiHelp.svelte';
  import WarLogList from '../campaign/WarLogList.svelte';
  import WarCard from './WarCard.svelte';
  import RealmMoment from './RealmMoment.svelte';

  /**
   * Вкладка «Армия и фронты» (шаг 93): полевая армия, бюджет войны и фонд — слева; каждая война целиком — справа.
   * Команды те же, что у прежнего экрана; пояснения правил — в подсказках.
   */
  const army = $derived(campaign.realmArmy);
  const wars = $derived(campaign.realmWars);
  /**
   * Враги с первого дня — участок фронта под приказ есть, записи войны ещё нет (вольница, кланы): их карточка идёт
   * за войнами, иначе приказ на них не отдать нигде.
   */
  const bornEnemies = $derived(
    campaign.realmOffensives.fronts.map((f) => f.factionId).filter((id) => !wars.some((w) => w.factionId === id)),
  );
  const feed = $derived(campaign.warLog.filter((l) => l.realm === true).slice(0, 10));

  /** Шаг набора и роспуска — по масштабу армии: одна машина, десятая часть потолка, до потолка. */
  const tenth = $derived(Math.max(1, Math.round(army.cap / 10)));
  const fill = $derived(Math.max(1, army.cap - army.total));
  type Step = 'one' | 'tenth' | 'fill';
  let step = $state<Step>('tenth');
  const n = $derived(step === 'one' ? 1 : step === 'tenth' ? tenth : fill);
  const raiseTake = $derived(Math.max(0, Math.min(n, army.cap - army.total)));
  const disbandTake = $derived(Math.min(n, army.total));
  const raiseCmd = $derived({ kind: 'raiseRegiment', mechs: n } as const);
  const disbandCmd = $derived({ kind: 'raiseRegiment', mechs: -n } as const);
  const raiseWhy = $derived(campaign.why(raiseCmd));
  const disbandWhy = $derived(campaign.why(disbandCmd));

  /** Взнос кассы в военный фонд — три ступени, как у прежнего экрана. */
  const FUND_STEPS = [1_000_000, 5_000_000, 20_000_000] as const;

  /** Потолок армии полосой по частям: мощность, призыв, постройки; титул — доля сверху (шаг 90). */
  const parts = $derived.by(() => {
    const p = army.capParts;
    const base = p.capacity + p.draft + p.buildings;
    const total = Math.max(1, army.cap);
    return [
      { key: 'capacity', value: p.capacity, share: p.capacity / total },
      { key: 'draft', value: p.draft, share: p.draft / total },
      { key: 'buildings', value: p.buildings, share: p.buildings / total },
      { key: 'title', value: army.cap - base, share: Math.max(0, army.cap - base) / total },
    ];
  });

  /** Сверх этой доли нормы готовность театра не растёт (`logistics.ts::theaterReadiness`). */
  const THEATER_USEFUL = 1.5;
  /** Доля содержания, которую снимают казармы и учебные лагеря. */
  const upkeepCut = $derived(Math.round((1 - army.upkeep.factor) * 100));

  const frontFoes = $derived(new Set(army.theaters.map((th) => th.against)));
  const farFunds = $derived(army.funds.filter((f) => !frontFoes.has(f.against)));
</script>

<div class="forces">
  <section class="panel panel-scroll">
    <div class="panel-header">
      <span>{t('realm.army.title')}</span>
      <WikiHelp doc="glossary.md" section="полевая армия и гарнизон" align="right" label="?" />
    </div>
    <div class="scroll-area panel-body stack">
      <div class="tiles">
        <div class="tile"><span class="k">{t('realm.army.total')}</span><span>{army.total} / {army.cap}</span></div>
        <div class="tile"><span class="k">{t('realm.army.reserve')}</span><span>{army.reserve}</span></div>
        <div class="tile" title={t('realm.army.upkeepLine', { sum: cbills(army.upkeep.total), mechs: tn('count.mechs', army.upkeep.mechs), cut: upkeepCut })}>
          <span class="k">{t('realm.hq.forces.upkeep')}</span>
          <span><span class="danger">{cbills(army.upkeep.total)}</span>{#if upkeepCut > 0}<span class="ok tiny cut">−{upkeepCut} %</span>{/if}</span>
        </div>
        <div class="tile"><span class="k">{t('realm.hq.warFund')}</span><span class="cyan">{cbills(campaign.realmOffensives.fund)}</span></div>
      </div>

      <div class="cap" title={t('realm.army.capHint')}>
        <div class="cap-bar">
          {#each parts as part (part.key)}
            <div class="cap-part {part.key}" style:width="{part.share * 100}%" title={t(`realm.hq.forces.cap.${part.key}`, { value: part.value })}></div>
          {/each}
          <div class="cap-used" style:left="{Math.min(100, (army.total / Math.max(1, army.cap)) * 100)}%"></div>
        </div>
        <div class="legend">
          {#each parts as part (part.key)}
            <span><i class="sw {part.key}"></i>{t(`realm.hq.forces.cap.${part.key}`, { value: part.value })}</span>
          {/each}
        </div>
      </div>
      {#if army.total > army.cap}
        <p class="gold tiny">{t('realm.army.overCap', { mechs: tn('count.mechs', army.total - army.cap), sum: cbills((army.total - army.cap) * army.mechUpkeep) })}</p>
      {/if}

      <div class="sec" title={t('realm.army.priceHint', { sum: cbills(army.mechPrice), upkeep: cbills(army.mechUpkeep) })}>{t('realm.army.orders')}</div>
      <div class="seg">
        <button class="seg-btn" class:active={step === 'one'} onclick={() => (step = 'one')}>{tn('count.mechs', 1)}</button>
        <button class="seg-btn" class:active={step === 'tenth'} onclick={() => (step = 'tenth')}>{tn('count.mechs', tenth)}</button>
        <button class="seg-btn" class:active={step === 'fill'} onclick={() => (step = 'fill')}>{t('realm.hq.forces.toCap')}</button>
      </div>
      <div class="row">
        <button class="btn btn-sm btn-primary" disabled={raiseWhy !== null} title={raiseWhy ?? ''} onclick={() => campaign.run(raiseCmd)}>
          {t('realm.army.raise', { mechs: tn('count.mechsAcc', raiseTake), sum: cbills(campaign.regimentPriceOf(raiseTake)) })}
        </button>
        <button class="btn btn-sm btn-danger" disabled={disbandWhy !== null} title={disbandWhy ?? ''} onclick={() => campaign.run(disbandCmd)}>
          {t('realm.army.disband', { mechs: tn('count.mechsAcc', disbandTake), sum: cbills(campaign.regimentRefundOf(disbandTake)) })}
        </button>
      </div>
      {#if raiseWhy !== null}<p class="dim tiny">{raiseWhy}</p>{/if}
      {#if disbandWhy !== null && disbandWhy !== raiseWhy}<p class="dim tiny">{disbandWhy}</p>{/if}

      <div class="sec" title={t('realm.army.theatersHint')}>{t('realm.army.theaters')}</div>
      {#each army.theaters as th (th.against)}
        <div class="line">
          <FactionEmblem factionId={th.against} size={16} />
          <span class="small grow">{factionName(th.against)}</span>
          <span class="small mono" class:gold={th.reference > 0 && th.mechs > th.reference * THEATER_USEFUL}>{th.reference > 0 ? `${th.mechs} / ${th.reference}` : th.mechs}</span>
        </div>
      {:else}
        <p class="dim tiny">{t('realm.army.noTheaters')}</p>
      {/each}
      {#if army.theaters.some((th) => th.reference > 0)}
        <p class="dim tiny">{t('realm.army.theaterNormHint', { share: THEATER_USEFUL })}</p>
      {/if}

      <div class="sec" title={t('realm.army.budgetHint')}>{t('realm.army.budget')}</div>
      <div class="seg">
        {#each army.warSteps as share (share)}
          {@const cmd = { kind: 'setWarBudget', share } as const}
          {@const why = campaign.why(cmd)}
          <button class="seg-btn" class:active={army.warShare === share} disabled={army.warShare === share || why !== null} title={why ?? ''} onclick={() => campaign.run(cmd)}>
            {t('realm.army.budgetStep', { percent: Math.round(share * 100) })}
          </button>
        {/each}
      </div>
      {#each army.funds.filter((f) => frontFoes.has(f.against)) as f (f.against)}
        <div class="line">
          <FactionEmblem factionId={f.against} size={16} />
          <span class="small grow">{factionName(f.against)}</span>
          <span class="small mono cyan">{cbills(f.amount)}</span>
          <span class="dim tiny" title={t('realm.hq.forces.pushHint')}>×{f.push.toFixed(2)}</span>
        </div>
      {/each}
      {#if farFunds.length > 0}
        <p class="dim tiny">
          {t('realm.army.fundFar', { count: farFunds.length, sum: cbills(farFunds.reduce((s, f) => s + f.amount, 0)), percent: Math.round(WAR.economy.idleRelease * 100) })}
        </p>
      {/if}

      <div class="sec" title={t('realm.army.fundHint')}>{t('realm.army.fundTitle')}</div>
      <div class="row">
        {#each FUND_STEPS as amount (amount)}
          {@const cmd = { kind: 'fundWar', amount } as const}
          {@const why = campaign.why(cmd)}
          <button class="btn btn-sm" disabled={why !== null} title={why ?? ''} onclick={() => campaign.run(cmd)}>
            {t('realm.army.fundStep', { sum: cbills(amount) })}
          </button>
        {/each}
      </div>
    </div>
  </section>

  <section class="panel panel-scroll">
    <div class="panel-header">
      <span>{t('realm.war.title')}</span>
      <span class="badge badge-dim">{wars.length + bornEnemies.length}</span>
    </div>
    <div class="scroll-area panel-body stack">
      <RealmMoment />
      {#each wars as w (w.factionId)}
        <WarCard factionId={w.factionId} war={w} />
      {/each}
      {#each bornEnemies as id (id)}
        <WarCard factionId={id} war={null} />
      {/each}
      {#if wars.length === 0 && bornEnemies.length === 0}
        <p class="dim tiny">{t('realm.war.none')}</p>
        <p class="dim tiny">{t('realm.status.enemies')}</p>
      {/if}
      <div class="sec">{t('realm.feed.title')}</div>
      {#if feed.length === 0}
        <p class="dim tiny">{t('realm.feed.empty')}</p>
      {:else}
        <WarLogList lines={feed} />
      {/if}
    </div>
  </section>
</div>

<style>
  .forces {
    display: grid;
    grid-template-columns: minmax(360px, 1fr) minmax(0, 1.4fr);
    gap: 10px;
    height: 100%;
    padding: 10px;
    min-height: 0;
    overflow: hidden;
  }
  .cut {
    margin-left: 6px;
  }
  .stack {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .tiles {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
  }
  .tile {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 5px 7px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .k {
    font-size: 9.5px;
    letter-spacing: 0.6px;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }
  .cap-bar {
    position: relative;
    display: flex;
    height: 10px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
  }
  .cap-part.capacity,
  .sw.capacity {
    background: var(--color-accent);
  }
  .cap-part.draft,
  .sw.draft {
    background: var(--color-border-active);
  }
  .cap-part.buildings,
  .sw.buildings {
    background: var(--color-ok);
  }
  .cap-part.title,
  .sw.title {
    background: var(--color-gold);
  }
  .cap-used {
    position: absolute;
    top: -3px;
    bottom: -3px;
    width: 2px;
    background: var(--color-text);
  }
  .legend {
    display: flex;
    flex-wrap: wrap;
    gap: 2px 12px;
    margin-top: 4px;
    font-size: 10.5px;
    color: var(--color-text-dim);
  }
  .sw {
    display: inline-block;
    width: 8px;
    height: 8px;
    margin-right: 4px;
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
  }
  .seg-btn {
    padding: 2px 8px;
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
    position: relative;
    color: var(--color-gold);
    border-color: var(--color-gold);
  }
  .row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .line {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .grow {
    flex: 1;
  }
  .mono {
    font-family: var(--font-mono);
  }
</style>

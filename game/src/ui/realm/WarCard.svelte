<script lang="ts">
  import { FRONT_STANCES, GALAXY, RIVALS, WAR } from '../../core/campaign/index.js';
  import { campaign, type RealmWar } from '../state/campaign.svelte.js';
  import { cbills, days as daysText, t, tn } from '../i18n/index.js';
  import { factionName } from '../campaign/relations.js';
  import FactionEmblem from '../components/FactionEmblem.svelte';
  import MercenaryEmblem from '../components/MercenaryEmblem.svelte';
  import RealmIcon from './RealmIcon.svelte';
  import { STANCE_ICON } from './realmIcons.js';

  /**
   * Одна война державы целиком (шаг 93, вкладка «Армия и фронты»): цель и требования врага, усталость сторон,
   * стойка и её цель, приказы с шансом, мир, наём полка, театр и фонд против врага. Раньше это было разнесено
   * между «Дипломатией» и «Армией» прежнего экрана; команды те же.
   *
   * `war: null` — враг с первого дня (вольница, кланы, испорченный Дом): `atWarWithPlayer` по вражде, а записи войны
   * ещё нет. Наступать на него можно, а стойка, цель, мир и наём полка ждут записи — её заводит первый бой.
   */
  let { factionId, war: w }: { factionId: string; war: RealmWar | null } = $props();

  const front = $derived(campaign.realmOffensives.fronts.find((f) => f.factionId === factionId) ?? null);
  const army = $derived(campaign.realmArmy);
  const theater = $derived(army.theaters.find((x) => x.against === factionId) ?? null);
  const fund = $derived(army.funds.find((x) => x.against === factionId) ?? null);
  const regiments = $derived(campaign.greatRegiments);
  const worlds = $derived(campaign.realmWorlds);
  const minOdds = Math.round(WAR.realm.stanceMinOdds * 100);
  const pct = (v: number): number => Math.round(v * 100);
  const nameOf = (id: string): string => GALAXY.name(GALAXY.require(id));

  /** Сверх этой доли нормы готовность театра не растёт (`logistics.ts::theaterReadiness`, там же литералом). */
  const THEATER_USEFUL = 1.5;

  let openHire = $state(false);

  /** Система врага для «На карте»: цель стойки, иначе первый участок фронта. */
  const mapTarget = $derived(w?.stanceFocusId ?? w?.stanceTargetId ?? front?.targets[0]?.id ?? null);
  /** Театр сверх полезной доли нормы: машины там силы не прибавляют. */
  const overNorm = $derived(theater !== null && theater.reference > 0 && theater.mechs > theater.reference * THEATER_USEFUL);
</script>

<div class="war" data-war={factionId}>
  <div class="head">
    <FactionEmblem factionId={factionId} size={28} />
    <div class="head-main">
      <div class="strong">{factionName(factionId)}</div>
      {#if w !== null}
        <div class="dim tiny">{t('realm.war.since', { date: campaign.dateText(w.since), won: w.won, lost: w.lost })}</div>
      {:else}
        <div class="danger tiny">{t('realm.hq.forces.bornEnemy')}</div>
      {/if}
    </div>
    {#if mapTarget !== null}
      <button class="btn btn-sm" onclick={() => campaign.openRealm('hq', { kind: 'foreign', id: mapTarget })}>{t('realm.hq.side.onRealmMap')}</button>
    {/if}
  </div>

  {#if w === null}
    <p class="dim tiny">{t('realm.hq.forces.bornEnemyHint')}</p>
  {:else if w.terms.kind !== 'noPolitics'}
    <p class="tiny">
      {w.goal === null
        ? t('realm.war.goalNone')
        : w.goal.kind === 'worlds'
          ? t('realm.war.goalWorlds', { systems: w.goal.systems.join(', ') })
          : w.goal.kind === 'tribute'
            ? t('realm.war.goalTribute', { systems: w.goal.systems.join(', ') })
            : t('realm.war.goalHumiliation')}
    </p>
    {#if w.foeGoal.length > 0}<p class="danger tiny">{t('realm.war.foeGoal', { systems: w.foeGoal.join(', ') })}</p>{/if}
    <div class="fatigue" title={t('realm.war.fatigueHint', { threshold: pct(WAR.playerWar.fatigueThreshold) })}>
      <span class="tiny dim">{t('realm.hq.side.fatigueRealm')}</span>
      <div class="bar"><div class="fill" style:width="{pct(w.fatigue)}%"></div></div>
      <span class="tiny">{pct(w.fatigue)} %</span>
      <span class="tiny dim">{factionName(factionId)}</span>
      <div class="bar"><div class="fill foe" style:width="{pct(w.foeFatigue)}%"></div></div>
      <span class="tiny">{pct(w.foeFatigue)} %</span>
    </div>
  {/if}

  <!-- Армия на направлении -->
  <div class="tiles">
    <div class="tile" title={t('realm.army.theaterNormHint', { share: THEATER_USEFUL })}>
      <span class="k">{t('realm.hq.forces.theater')}</span>
      <span class:gold={overNorm}>{theater !== null && theater.reference > 0 ? `${theater.mechs} / ${theater.reference}` : (theater?.mechs ?? 0)}</span>
    </div>
    <div class="tile">
      <span class="k">{t('realm.hq.warFund')}</span>
      <span class="cyan">{cbills(fund?.amount ?? 0)}</span>
    </div>
  </div>

  {#if w !== null}
    <div class="sec">{t('realm.stance.title')}</div>
    <div class="seg" title={t('realm.stance.hint', { odds: minOdds })}>
      {#each FRONT_STANCES as st (st)}
        <button class="seg-btn" class:active={w.stance === st} disabled={w.stance === st} onclick={() => campaign.run({ kind: 'setFrontStance', factionId, stance: st })}>
          <RealmIcon index={STANCE_ICON[st]} size={16} />{t(`realm.stance.${st}`)}
        </button>
      {/each}
    </div>
    {#if w.stanceFocusId !== null}
      <p class="tiny gold">
        {t('realm.hq.side.targetChosen', { system: nameOf(w.stanceFocusId) })}
        <button class="link-btn" onclick={() => campaign.run({ kind: 'setStanceTarget', factionId, systemId: null })}>{t('realm.hq.side.targetClear')}</button>
      </p>
    {:else if w.stance === 'advance'}
      <p class="tiny dim">
        {w.stanceTarget === null ? t('realm.stance.noTarget', { odds: minOdds }) : t('realm.hq.side.targetAuto', { system: w.stanceTarget })}
      </p>
    {:else if w.stance === 'yield'}
      <p class="dim tiny">{t('realm.stance.yieldLine')}</p>
    {/if}
  {/if}

  {#if front !== null}
    <div class="sec">{t('realm.offensive.title')}</div>
    <p class="dim tiny">{t('realm.offensive.frontCost', { sum: cbills(front.cost), mechs: tn('count.mechs', front.mechs) })}</p>
    {#each front.targets as tg, k (tg.id)}
      <div class="target">
        <span class="small">{tg.name}</span>
        <span class="odds" class:low={tg.odds < WAR.realm.stanceMinOdds}>{pct(tg.odds)} %</span>
        {#if w !== null && w.stanceFocusId !== tg.id}
          <button class="btn btn-sm" title={t('realm.hq.side.targetHint', { odds: minOdds })} onclick={() => campaign.run({ kind: 'setStanceTarget', factionId, systemId: tg.id })}>
            ◎
          </button>
        {:else if w !== null}
          <span class="gold tiny">◎</span>
        {/if}
        <button class="btn btn-sm btn-danger" disabled={tg.why !== null} title={tg.why ?? t('realm.offensive.oddsHint')} onclick={() => campaign.run({ kind: 'orderOffensive', systemId: tg.id })}>
          {t('realm.hq.forces.attack')}
        </button>
        {#if tg.lance > 0}<span class="dim tiny">{t('realm.offensive.company', { mechs: tn('count.mechs', tg.lance) })}</span>{/if}
      </div>
      {#if tg.readyDay !== null}
        {#if k === 0 || front.targets[k - 1]?.readyDay !== tg.readyDay}
          <p class="dim tiny">{t('realm.offensive.ready', { date: campaign.dateText(tg.readyDay) })}</p>
        {/if}
      {:else if tg.why !== null && (k === 0 || front.targets[k - 1]?.why !== tg.why)}
        <p class="dim tiny">{tg.why}</p>
      {/if}
    {/each}
  {/if}

  {#if w !== null}
    <!-- Мир -->
    <div class="sec">{t('realm.hq.forces.peace')}</div>
    {#if w.offerUntil !== null}<p class="ok tiny">{t('realm.war.offer', { date: campaign.dateText(w.offerUntil) })}</p>{/if}
    {#if w.terms.kind === 'tooEarly'}
      <p class="dim tiny">{t('realm.war.tooEarly', { date: campaign.dateText(w.terms.readyDay) })}</p>
    {:else if w.terms.kind === 'noPolitics'}
      <p class="dim tiny">{t('realm.war.noPolitics')}</p>
    {:else if w.terms.kind === 'free'}
      <div class="row">
        <button
          class="btn btn-sm btn-gold"
          title={w.terms.offered ? '' : t(w.terms.yields === true ? 'realm.war.peaceYieldHint' : 'realm.war.peaceFreeHint', { days: daysText(w.truceDays) })}
          onclick={() => campaign.run({ kind: 'makePeace', factionId })}
        >
          {w.terms.offered ? t('realm.war.peaceGoal') : w.terms.yields === true ? t('realm.war.peaceYield') : t('realm.war.peaceFree')}
        </button>
        {#if w.protectorate}
          <button class="btn btn-sm btn-gold" title={t('realm.war.peaceProtectorateHint')} onclick={() => campaign.run({ kind: 'makePeace', factionId, protectorate: true })}>
            {t('realm.war.peaceProtectorate')}
          </button>
        {/if}
      </div>
    {:else if w.terms.kind === 'pay'}
      {@const payWhy = campaign.why({ kind: 'makePeace', factionId })}
      <div class="row">
        <button class="btn btn-sm btn-gold" disabled={payWhy !== null} title={payWhy ?? t('realm.war.peacePayHint', { days: daysText(w.truceDays) })} onclick={() => campaign.run({ kind: 'makePeace', factionId })}>
          {t('realm.war.peacePay', { sum: cbills(w.terms.cost) })}
        </button>
        {#if w.terms.cede !== undefined}
          {@const cedeId = w.terms.cede}
          <button class="btn btn-sm btn-danger" title={t('realm.war.peaceCedeHint')} onclick={() => campaign.run({ kind: 'makePeace', factionId, cede: true })}>
            {t('realm.war.peaceCede', { system: worlds.find((x) => x.id === cedeId)?.name ?? cedeId })}
          </button>
        {/if}
      </div>
      {#if payWhy !== null}<p class="dim tiny">{payWhy}</p>{/if}
    {/if}
    {#if w.terms.kind === 'free' || w.terms.kind === 'pay'}
      {#if w.outcome.gained.length > 0}<p class="ok tiny">{t('realm.war.outGained', { systems: w.outcome.gained.join(', ') })}</p>{/if}
      {#if w.outcome.tributaries.length > 0}<p class="ok tiny">{t('realm.war.outTributaries', { systems: w.outcome.tributaries.join(', ') })}</p>{/if}
      {#if w.outcome.humiliation}<p class="ok tiny">{t('realm.war.outHumiliation')}</p>{/if}
      {#if w.outcome.returned.length > 0}<p class="danger tiny">{t('realm.war.outReturned', { systems: w.outcome.returned.join(', ') })}</p>{/if}
      {#if w.outcome.ceded.length > 0}<p class="danger tiny">{t('realm.war.outCeded', { systems: w.outcome.ceded.join(', ') })}</p>{/if}
    {/if}

    <!-- Наём великого полка -->
    {#each regiments.filter((g) => g.hire?.against === factionId) as g (g.id)}
      <p class="tiny ok">{t('realm.hire.serving', { regiment: g.name, system: g.hire?.system ?? '', date: campaign.dateText(g.hire?.until ?? 0) })}</p>
    {/each}
    <button class="link-btn" title={t('realm.hire.hint', { decades: RIVALS.regiment.hire.termDecades })} onclick={() => (openHire = !openHire)}>
      {t('realm.hire.open')} {openHire ? '▴' : '▾'}
    </button>
    {#if openHire}
      <div class="list">
        {#each regiments.filter((g) => g.hire === null) as g (g.id)}
          {@const cmd = { kind: 'hireGreatRegiment', regimentId: g.id, against: factionId } as const}
          {@const why = campaign.why(cmd)}
          <div class="target">
            {#if g.emblem >= 0}<MercenaryEmblem index={g.emblem} size={22} />{/if}
            <span class="small">{g.name}</span>
            <span class="dim tiny">{tn('count.mechs', g.mechs)}</span>
            <button class="btn btn-sm" disabled={why !== null} title={why ?? t('realm.hire.hint', { decades: RIVALS.regiment.hire.termDecades })} onclick={() => campaign.run(cmd)}>
              {t('realm.hire.button', { sum: cbills(g.price) })}
            </button>
          </div>
        {:else}
          <p class="dim tiny">{t('realm.hire.none')}</p>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .war {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 10px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    border-left: 3px solid var(--color-danger);
  }
  .head {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .head-main {
    flex: 1;
  }
  .fatigue {
    display: grid;
    grid-template-columns: auto 1fr 36px;
    align-items: center;
    gap: 3px 6px;
  }
  .bar {
    height: 5px;
    background: var(--color-panel);
    border: 1px solid var(--color-border);
  }
  .fill {
    height: 100%;
    background: var(--color-gold);
  }
  .fill.foe {
    background: var(--color-danger);
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
    padding: 4px 7px;
    background: var(--color-panel);
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
  .sec {
    margin-top: 6px;
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
  .seg-btn :global(.ri) {
    opacity: 0.55;
  }
  .seg-btn.active :global(.ri),
  .seg-btn:hover :global(.ri) {
    opacity: 1;
  }
  .seg-btn {
    padding: 2px 8px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
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
    cursor: default;
  }
  .target {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .target .small {
    flex: 1;
  }
  .odds {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-gold);
  }
  .odds.low {
    color: var(--color-text-dim);
  }
  .row {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .link-btn {
    align-self: flex-start;
    background: none;
    border: none;
    padding: 0;
    color: var(--color-accent);
    font-size: 11px;
    cursor: pointer;
  }
</style>

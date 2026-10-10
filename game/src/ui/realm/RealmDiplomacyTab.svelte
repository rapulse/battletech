<script lang="ts">
  import { GALAXY, PLAYER_ACTOR_ID, REPUTATION, WAR, type WarGoal } from '../../core/campaign/index.js';
  import { campaign } from '../state/campaign.svelte.js';
  import { cbills, days as daysText, t, tn } from '../i18n/index.js';
  import { factionName } from '../campaign/relations.js';
  import { factionFullName } from '../i18n/names.js';
  import FactionEmblem from '../components/FactionEmblem.svelte';
  import WikiHelp from '../wiki/WikiHelp.svelte';
  import RealmIcon from './RealmIcon.svelte';
  import { DIPLOMACY_ICON } from './realmIcons.js';

  /**
   * Вкладка «Дипломатия» (шаг 93): соседи державы списком и выбранный сосед целиком — герб, полное имя,
   * отношение полосой с порогами, тревога, договор, дань в обе стороны, протекторат, объявление войны с целью.
   * Война после объявления ведётся во вкладке «Армия и фронты». Команды те же, что у прежнего экрана.
   */
  const neighbours = $derived(campaign.realmNeighbours);
  const prices = $derived(campaign.realmPrices);
  const vassals = $derived(campaign.realmVassals);

  /** Сосед из общего выбора державы (система соседа на карте), иначе первый. */
  const fromPick = $derived.by((): string | null => {
    const pick = campaign.realmPick;
    if (pick?.kind !== 'foreign' || GALAXY.index(pick.id) < 0) return null;
    return campaign.owners[GALAXY.require(pick.id)] ?? null;
  });
  let chosen = $state<string | null>(null);
  const current = $derived(
    neighbours.find((n) => n.factionId === (chosen ?? fromPick)) ?? neighbours[0] ?? null,
  );

  /** Пороги отношения на полосе: договор, коалиция против державы, объявление войны соседом. */
  const MARKS = [
    { key: 'pact', value: REPUTATION.diplomacy.minStanding },
    { key: 'coalition', value: WAR.resistance.coalitionStanding },
    { key: 'war', value: WAR.playerWar.aiDeclareStanding },
  ] as const;
  /** Шкала отношения −100…+100 → доля полосы. */
  const pos = (v: number): number => (Math.max(-100, Math.min(100, v)) + 100) / 2;

  let confirmWar = $state(false);
  let goalKind = $state<WarGoal['kind']>('worlds');
  let goalPick = $state<string[]>([]);
  const goal = $derived<WarGoal>(goalKind === 'humiliation' ? { kind: 'humiliation' } : { kind: goalKind, systems: goalPick });
  $effect(() => {
    void current?.factionId;
    confirmWar = false;
    goalKind = 'worlds';
    goalPick = [];
  });
  function toggleGoal(id: string): void {
    goalPick = goalPick.includes(id) ? goalPick.filter((x) => x !== id) : [...goalPick, id];
  }
</script>

{#if neighbours.length === 0}
  <section class="panel panel-body empty"><p class="dim">{t('realm.dip.noNeighbours')}</p></section>
{:else}
  <div class="dip">
    <section class="panel panel-scroll">
      <div class="panel-header">
        <span>{t('realm.dip.neighbours')}</span>
        <span class="badge badge-dim">{neighbours.length}</span>
        <span class="spacer"></span>
        <WikiHelp doc="domain.md" section="7. Дипломатия" align="right" label="?" />
      </div>
      <div class="scroll-area list">
        {#each neighbours as nb (nb.factionId)}
          <button class="nb" class:active={current?.factionId === nb.factionId} data-faction={nb.factionId} onclick={() => (chosen = nb.factionId)}>
            <FactionEmblem factionId={nb.factionId} size={32} />
            <span class="nb-main">
              <span class="strong">{factionName(nb.factionId)}</span>
              <span class="mini-bar"><span class="mini-fill" class:neg={nb.standing < 0} style:left="{Math.min(50, pos(nb.standing))}%" style:width="{Math.abs(pos(nb.standing) - 50)}%"></span></span>
              <span class="tags">
                {#if nb.atWar}<span class="tag danger"><RealmIcon index={DIPLOMACY_ICON.war} size={14} />{t('realm.dip.atWar')}</span>{/if}
                {#if nb.vassal}<span class="tag gold"><RealmIcon index={DIPLOMACY_ICON.vassal} size={14} />{t('realm.dip.vassal')}</span>{/if}
                {#if nb.pact !== null}<span class="tag cyan"><RealmIcon index={DIPLOMACY_ICON[nb.pact.kind]} size={14} />{t(`realm.pact.${nb.pact.kind}`)}</span>{/if}
                {#if nb.alarm > 0}<span class="gold">↓{(Math.round(nb.alarm * 10) / 10).toFixed(1)}</span>{/if}
              </span>
            </span>
            <span class="mono" class:ok={nb.standing > 0} class:danger={nb.standing < 0}>{Math.round(nb.standing)}</span>
          </button>
        {/each}
        {#if vassals.length > 0}
          <div class="sec pad">{t('realm.dip.vassals')}</div>
          {#each vassals as v (v)}
            <div class="vassal"><FactionEmblem factionId={v} size={16} /><span class="small">{factionName(v)}</span></div>
          {/each}
        {/if}
        <div class="rules dim tiny">
          <p>{t('realm.dip.rules1')}</p>
          <p>{t('realm.dip.rules2')}</p>
          <p>{t('realm.dip.rulesNote')}</p>
        </div>
      </div>
    </section>

    {#if current !== null}
      {@const nb = current}
      {@const truce = { kind: 'proposePact', factionId: nb.factionId, pact: 'truce' } as const}
      {@const trade = { kind: 'proposePact', factionId: nb.factionId, pact: 'trade' } as const}
      {@const protect = { kind: 'offerProtectorate', factionId: nb.factionId } as const}
      {@const truceWhy = campaign.why(truce)}
      {@const tradeWhy = campaign.why(trade)}
      {@const protectWhy = campaign.why(protect)}
      <section class="panel panel-scroll">
        <div class="scroll-area panel-body detail">
          <div class="head">
            <FactionEmblem factionId={nb.factionId} size={72} />
            <div>
              <div class="title">{factionFullName(nb.factionId, factionName(nb.factionId))}</div>
              <div class="tags big">
                {#if nb.atWar}<span class="badge badge-danger">{t('realm.dip.atWar')}</span>{/if}
                {#if nb.vassal}<span class="badge badge-gold">{t('realm.dip.vassal')}</span>{/if}
                {#if nb.payingUs > 0}<span class="badge badge-ok">{t('realm.dip.payingUs', { count: nb.payingUs })}</span>{/if}
              </div>
            </div>
          </div>

          <!-- Отношение полосой с порогами: где договор, где коалиция, где война. -->
          <div class="sec">{t('realm.dip.standing', { value: Math.round(nb.standing) })}</div>
          <div class="rel">
            <div class="rel-bar">
              <div class="rel-zero"></div>
              <div class="rel-fill" class:neg={nb.standing < 0} style:left="{Math.min(50, pos(nb.standing))}%" style:width="{Math.abs(pos(nb.standing) - 50)}%"></div>
              {#each MARKS as m (m.key)}
                <div class="rel-mark {m.key}" style:left="{pos(m.value)}%" title={t(`realm.hq.dip.mark.${m.key}`, { value: m.value })}></div>
              {/each}
            </div>
            <div class="rel-legend">
              {#each MARKS as m (m.key)}
                <span class="{m.key}">▏{t(`realm.hq.dip.mark.${m.key}`, { value: m.value })}</span>
              {/each}
            </div>
          </div>
          {#if nb.alarm > 0}
            <p class="gold small" title={t('realm.dip.alarmHint', { coalition: WAR.resistance.coalitionStanding, declare: WAR.playerWar.aiDeclareStanding, pact: REPUTATION.diplomacy.minStanding })}>
              {t('realm.dip.alarm', { value: (Math.round(nb.alarm * 10) / 10).toFixed(1) })}
            </p>
          {/if}

          <div class="sec">{t('realm.hq.dip.pacts')}</div>
          {#if nb.pact !== null}
            <p class="cyan small tag"><RealmIcon index={DIPLOMACY_ICON[nb.pact.kind]} size={18} />{t('realm.dip.pactActive', { pact: t(`realm.pact.${nb.pact.kind}`), date: campaign.dateText(nb.pact.untilDay) })}</p>
            <p class="dim tiny">{t('realm.hq.dip.daysLeft', { days: daysText(Math.max(0, nb.pact.untilDay - campaign.day)) })}</p>
          {:else}
            <div class="row">
              <button class="btn btn-sm icon-btn" disabled={truceWhy !== null} title={truceWhy ?? t('realm.dip.truceHint')} onclick={() => campaign.run(truce)}><RealmIcon index={DIPLOMACY_ICON.truce} size={16} />{t('realm.dip.truce')}</button>
              <button class="btn btn-sm icon-btn" disabled={tradeWhy !== null} title={tradeWhy ?? t('realm.dip.tradeHint')} onclick={() => campaign.run(trade)}><RealmIcon index={DIPLOMACY_ICON.trade} size={16} />{t('realm.dip.trade')}</button>
              <span class="dim tiny">{prices === null ? '' : cbills(prices.pact)}</span>
            </div>
            {#if truceWhy !== null && truceWhy === tradeWhy}<p class="dim tiny">{truceWhy}</p>{/if}
          {/if}

          {#if !nb.vassal}
            <div class="sec">{t('realm.dip.protect')}</div>
            <div class="row">
              <button class="btn btn-sm btn-gold icon-btn" disabled={protectWhy !== null} title={protectWhy ?? t('realm.dip.protectHint')} onclick={() => campaign.run(protect)}>
                <RealmIcon index={DIPLOMACY_ICON.vassal} size={16} />{t('realm.dip.protect')}
              </button>
              <span class="dim tiny">{prices === null ? '' : cbills(prices.protectorate)}</span>
            </div>
            {#if protectWhy !== null}<p class="dim tiny">{protectWhy}</p>{/if}
          {/if}

          <div class="sec" title={t('realm.dip.demandHint')}>{t('realm.hq.dip.borderWorlds')} <span class="dim">· {tn('count.worlds', nb.systems.length)}</span></div>
          <div class="systems">
            {#each nb.systems as sys (sys.id)}
              {@const cmd = { kind: 'demandTribute', systemId: sys.id } as const}
              {@const why = campaign.why(cmd)}
              <div class="sys">
                <span class="small grow">{sys.name}{#if sys.capital}<span class="dim"> ★</span>{/if}</span>
                {#if sys.tributeTo !== null}
                  <span class="tiny" class:ok={sys.tributeTo === PLAYER_ACTOR_ID} class:dim={sys.tributeTo !== PLAYER_ACTOR_ID}>
                    {sys.tributeTo === PLAYER_ACTOR_ID ? t('realm.dip.paysUs') : t('realm.dip.paysOther', { faction: factionName(sys.tributeTo) })}
                  </span>
                {/if}
                <button class="btn btn-sm" title={t('realm.hq.side.onRealmMap')} onclick={() => campaign.openRealm('hq', { kind: 'foreign', id: sys.id })}>◎</button>
                <button class="btn btn-sm" disabled={why !== null} title={why ?? t('realm.dip.demandHint')} onclick={() => campaign.run(cmd)}>
                  {t('realm.dip.demand', { sum: cbills(campaign.tributePriceAt(sys.id)) })}
                </button>
              </div>
            {/each}
          </div>

          {#if nb.atWar}
            <button class="btn btn-sm" onclick={() => campaign.setRealmTab('forces')}>{t('realm.hq.dip.toWar')}</button>
          {:else}
            {@const warCmd = { kind: 'declareWar', factionId: nb.factionId } as const}
            {@const warWhy = campaign.why(warCmd)}
            <div class="sec danger-sec">{t('realm.dip.declare')}</div>
            {#if confirmWar}
              {@const goalCmd = { kind: 'declareWar', factionId: nb.factionId, goal } as const}
              {@const goalWhy = campaign.why(goalCmd)}
              <p class="danger small">{t('realm.dip.declareConfirm', { faction: factionName(nb.factionId), days: daysText(WAR.playerWar.minWarDays) })}</p>
              <div class="seg">
                {#each ['worlds', 'tribute', 'humiliation'] as const as k (k)}
                  <button class="seg-btn" class:active={goalKind === k} onclick={() => (goalKind = k)}>
                    {t(k === 'worlds' ? 'realm.dip.goalWorlds' : k === 'tribute' ? 'realm.dip.goalTribute' : 'realm.dip.goalHumiliation')}
                  </button>
                {/each}
              </div>
              {#if goalKind === 'humiliation'}
                <p class="dim tiny">{t('realm.dip.goalHumiliationHint')}</p>
              {:else}
                <p class="dim tiny">
                  {goalKind === 'worlds' ? t('realm.dip.goalWorldsHint') : t('realm.dip.goalTributeHint', { decades: WAR.diplomacy.tributeDecades })}
                  {t('realm.dip.goalPick', { max: WAR.playerWar.goalWorldsMax })}
                </p>
                <div class="systems">
                  {#each nb.systems.filter((x) => !x.capital) as sys (sys.id)}
                    {@const picked = goalPick.includes(sys.id)}
                    <label class="sys small">
                      <input type="checkbox" checked={picked} disabled={!picked && goalPick.length >= WAR.playerWar.goalWorldsMax} onchange={() => toggleGoal(sys.id)} />
                      {sys.name}
                    </label>
                  {/each}
                </div>
              {/if}
              <div class="row">
                <button class="btn btn-sm btn-danger" disabled={goalWhy !== null} title={goalWhy ?? ''} onclick={() => { campaign.run(goalCmd); confirmWar = false; }}>
                  {t('realm.dip.declareDo')}
                </button>
                <button class="btn btn-sm" onclick={() => (confirmWar = false)}>{t('common.cancel')}</button>
              </div>
              {#if goalWhy !== null && goalWhy !== warWhy}<p class="dim tiny">{goalWhy}</p>{/if}
            {:else}
              <button class="btn btn-sm btn-danger" disabled={warWhy !== null} title={warWhy ?? t('realm.dip.declareHint')} onclick={() => (confirmWar = true)}>
                {t('realm.dip.declare')}
              </button>
              {#if warWhy !== null && nb.pact === null}<p class="dim tiny">{warWhy}</p>{/if}
            {/if}
          {/if}
        </div>
      </section>
    {/if}
  </div>
{/if}

<style>
  .dip {
    display: grid;
    grid-template-columns: minmax(280px, 0.8fr) minmax(0, 1.6fr);
    gap: 10px;
    height: 100%;
    padding: 10px;
    min-height: 0;
    overflow: hidden;
  }
  .list {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 6px;
  }
  .nb {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 8px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    color: var(--color-text);
    text-align: left;
    cursor: pointer;
  }
  .nb.active {
    border-color: var(--color-gold);
    background: rgba(227, 179, 65, 0.08);
  }
  .nb-main {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 3px;
    min-width: 0;
  }
  .mini-bar {
    position: relative;
    height: 4px;
    background: var(--color-panel);
    border: 1px solid var(--color-border);
  }
  .mini-fill {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--color-ok);
  }
  .mini-fill.neg {
    background: var(--color-danger);
  }
  .tags {
    display: flex;
    gap: 8px;
    font-size: 10.5px;
  }
  .tags.big {
    margin-top: 4px;
  }
  .mono {
    font-family: var(--font-mono);
    font-size: 12px;
  }
  .vassal {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 8px;
  }
  .detail {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .head {
    display: flex;
    align-items: center;
    gap: 14px;
  }
  .title {
    font-family: var(--font-display);
    font-size: 18px;
    font-weight: 700;
    letter-spacing: 1px;
  }
  .sec {
    margin-top: 10px;
    padding-bottom: 3px;
    border-bottom: 1px solid var(--color-border);
    font-family: var(--font-display);
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1px;
    text-transform: uppercase;
    color: var(--color-text-dim);
  }
  .tag,
  .icon-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .spacer {
    flex: 1;
  }
  .rules {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-top: auto;
    padding: 10px 4px 2px;
  }
  .sec.pad {
    margin: 8px 4px 2px;
  }
  .danger-sec {
    color: var(--color-danger);
  }
  .rel-bar {
    position: relative;
    height: 12px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
  }
  .rel-zero {
    position: absolute;
    left: 50%;
    top: -2px;
    bottom: -2px;
    width: 1px;
    background: var(--color-text-dim);
  }
  .rel-fill {
    position: absolute;
    top: 0;
    bottom: 0;
    background: var(--color-ok);
    opacity: 0.8;
  }
  .rel-fill.neg {
    background: var(--color-danger);
  }
  .rel-mark {
    position: absolute;
    top: -4px;
    bottom: -4px;
    width: 2px;
  }
  .rel-mark.pact {
    background: var(--color-accent);
  }
  .rel-legend .pact {
    color: var(--color-accent);
  }
  .rel-mark.coalition {
    background: var(--color-gold);
  }
  .rel-mark.war {
    background: var(--color-danger);
  }
  .rel-legend {
    display: flex;
    gap: 14px;
    margin-top: 4px;
    font-size: 10.5px;
  }
  .rel-legend .coalition {
    color: var(--color-gold);
  }
  .rel-legend .war {
    color: var(--color-danger);
  }
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .systems {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .sys {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .grow {
    flex: 1;
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
  .empty {
    margin: 10px;
  }
</style>

<script lang="ts">
  import { ZONE_IDS, zoneFromId } from '../../core/model/HitZone.js';
  import { recordChassisDef } from '../../core/campaign/mech/MechRecord.js';
  import { mechValue } from '../../core/campaign/market/pricing.js';
  import { treatmentDays } from '../../core/campaign/company/medbay.js';
  import { campaign } from '../state/campaign.svelte.js';
  import { battle } from '../state/battle.svelte.js';
  import { downloadText } from '../../platform/download.js';
  import { tr } from '../../core/log/index.js';

  // Выгрузка журнала боя (шаг 29): содержимое считает ядро, файл отдаёт platform.
  function saveText(): void {
    downloadText(battle.reportText(), battle.reportFileName('txt'), 'text/plain;charset=utf-8');
  }

  function saveJson(): void {
    downloadText(battle.reportJson(), battle.reportFileName('json'), 'application/json');
  }
  import { cbills, days as daysText, signedCbills, t } from '../i18n/index.js';
  import { intelSurpriseText } from '../state/intelText.js';
  import AchievementBadge from '../components/AchievementBadge.svelte';
  import { achievementDef, achievementHint, achievementName } from './achievements.js';

  /**
   * Тактический разбор — шов боя в роту, отданный игроку.
   *
   * Экран стоит МЕЖДУ боем и командой `ResolveContract` и делает ровно одно,
   * чего движок сделать за игрока не должен: выбор трофеев. Список и число
   * очков берутся у `contracts/salvage.ts::salvageOffer` — она чистая и
   * состояния не трогает, поэтому её можно звать при каждой перерисовке.
   *
   * Разбор идёт в два приёма, и это не украшение. До команды видно то, что
   * ЗНАЕТ БОЙ: кто вернулся, с чем и кто по кому попадал. После команды — то,
   * что решила КАМПАНИЯ: расчёт с нанимателем, лазарет, потери, опыт. Свести
   * их в один экран значило бы показать до команды числа, которых ещё нет.
   */

  const pending = $derived(campaign.pendingBattle);
  const offer = $derived(campaign.salvage);
  /**
   * Сколько машин противника ушло с поля СВОИМ ХОДОМ (шаг 43).
   *
   * Без этой строки игрок видит только укоротившийся список трофеев и не
   * понимает, куда делись машины: они целы, но увёз их хозяин, а не рота.
   */
  const enemyWithdrew = $derived(pending?.outcome.enemyWithdrew ?? 0);
  const report = $derived(campaign.resolvedReport);
  /** Разведка ошиблась в этом вылете (шаг 61): живёт и в ожидающем бое, и в закрытом отчёте. */
  const surprise = $derived(report?.intelSurprise ?? pending?.intelSurprise ?? null);
  /** Смета «починить всё» — та же, что в ангаре (шаг 39). */
  const repairPlan = $derived(campaign.repairAllPlan());
  /** Сколько нарядов по машинам этого звена уже принято цехом. */
  const inRepairCount = $derived(
    (pending?.outcome.units ?? [])
      .filter((u) => u.side === 'player' && !u.unit.ally)
      .reduce(
        (count, u) =>
          count +
          campaign.state.queue.filter(
            (e) => e.task.kind === 'repairJob' && e.task.recordId === u.recordId,
          ).length,
        0,
      ),
  );

  /** Наши машины, вернувшиеся с поля, с разницей против того, чем уходили. */
  const ours = $derived(
    pending === null
      ? []
      : pending.outcome.units
          .filter((u) => u.side === 'player' && !u.unit.ally)
          .map((u) => {
            const before = pending.before.get(u.recordId);
            const armor = u.unit.zones.reduce((n, z) => n + z.armor, 0);
            const structure = u.unit.zones.reduce((n, z) => n + z.structure, 0);
            return {
              id: u.recordId,
              name: before?.name ?? u.recordId,
              pilot: before?.pilot ?? null,
              armorLost: Math.max(0, Math.round((before?.armor ?? armor) - armor)),
              structureLost: Math.max(0, Math.round((before?.structure ?? structure) - structure)),
              destroyed: ZONE_IDS.filter((z) => u.unit.zones[zoneFromId(z)]?.destroyed === true),
              lost: u.unit.destroyed,
              hits: u.hits,
              kills: u.kills,
              injuries: u.unit.pilot.injuries,
              pilotStatus: u.unit.pilot.status,
            };
          }),
  );

  const points = $derived(offer?.points ?? 0);
  /** Доля трофеев по контракту: ею объясняется, почему очков может не хватить. */
  /*
    Доля берётся из ПРЕДЛОЖЕНИЯ, а не из условий контракта: за разгром сверх
    задачи наниматель делится охотнее (`beyond.salvageBonus`), и экран обязан
    показывать ту долю, по которой на самом деле посчитаны очки, — иначе игрок
    читает одно число, а работает другое.
  */
  const share = $derived(offer?.share ?? pending?.contract.salvageShare ?? 0);
  // Очко тратится и на целую машину, и на разбор: это выбор ФОРМЫ трофея, а не
  // способ получить больше (шаг 34).
  const used = $derived(campaign.salvagePicked.size + campaign.salvageScrapped.size);
</script>

<div class="debrief">
  {#if pending === null && report === null}
    <div class="panel empty">
      <p class="dim">{t('debrief.empty')}</p>
      <button class="btn btn-primary" onclick={() => (campaign.screen = 'hangar')}>
        {t('debrief.close')}
      </button>
    </div>
  {:else}
    <main class="panel panel-scroll sheet">
      <div class="panel-header">
        <span class="hdr">
          {t('debrief.title')} //
          {#if report !== null}
            <span
              class:ok={report.result === 'won'}
              class:gold={report.result === 'withdrawn'}
              class:danger={report.result === 'lost'}
            >
              {t(`debrief.result.${report.result}`)}
            </span>
          {:else if offer !== null}
            <span
              class:ok={offer.result === 'won'}
              class:gold={offer.result === 'withdrawn'}
              class:danger={offer.result === 'lost'}
            >
              {t(`debrief.result.${offer.result}`)}
            </span>
          {/if}
        </span>
        {#if battle.shots.shots > 0}
          <!--
            Выгрузка журнала боя (шаг 29). Стоит именно здесь: вопрос «почему я
            не попал» возникает на этом экране, а не в бою, и к этому моменту
            бой уже кончился — переспросить его нечем. Файл несёт сиды карты и
            боя, состав сторон с оружием по зонам и все события, поэтому бой
            восстанавливается целиком, а не пересказывается.
          -->
          <span class="dl">
            <button class="btn btn-sm" onclick={saveText} title={t('debrief.logTxtHint')}>
              {t('debrief.logTxt')}
            </button>
            <button class="btn btn-sm" onclick={saveJson} title={t('debrief.logJsonHint')}>
              {t('debrief.logJson')}
            </button>
          </span>
        {/if}
        {#if report !== null}
          <span class="badge" class:badge-gold={report.settlement >= 0} class:badge-danger={report.settlement < 0}>
            {signedCbills(report.settlement)}
          </span>
        {/if}
      </div>

      <div class="scroll-area body">
        {#if surprise !== null}
          <p class="gold small">{intelSurpriseText(surprise, 'debrief')}</p>
        {/if}
        {#if report === null && offer !== null}
          <!-- Приём первый: трофеи. Выбирает игрок. -->
          <section class="block">
            <div class="sec-title spread">
              <span>{t('debrief.salvage')}</span>
              <span class="badge" class:badge-danger={used > points} class:badge-cyan={used <= points}>
                {t('debrief.salvagePoints', { used, total: points })}
              </span>
            </div>

            {#if enemyWithdrew > 0}
              <p class="gold small">{t('debrief.enemyWithdrew', { count: enemyWithdrew })}</p>
            {/if}

            {#if !offer.heldField}
              <p class="dim">{t('debrief.salvageNoField')}</p>
            {:else if offer.trophies.length === 0}
              <p class="dim">{t('debrief.salvageEmpty')}</p>
            {:else}
              {#if points === 0}
                <!--
                  Доля трофеев — условие контракта, и «40 % от одной машины» это
                  ноль машин, а не половина: очки выбора считаются в машинах
                  целиком (`salvage.ts::salvagePointsOf`). Список при этом
                  показывается: игрок должен видеть, ЧТО он не смог увезти.
                -->
                <p class="gold small">
                  {t('debrief.salvageNoPoints', {
                    percent: Math.round(share * 100),
                    count: offer.trophies.length,
                  })}
                </p>
                <!--
                  Но с пустыми руками рота с удержанного поля не уходит: за
                  долю, не дотянувшую до целой машины, наниматель платит
                  деньгами. Сумма показана ДО подтверждения — это часть расчёта,
                  а не сюрприз в журнале.
                -->
                {#if offer.compensation > 0}
                  <p class="ok small">
                    {t('debrief.salvageCompensation', {
                      sum: cbills(offer.compensation),
                      percent: Math.round(share * 100),
                    })}
                  </p>
                {/if}
              {/if}
              <div class="trophies">
                {#each offer.trophies as trophy (trophy.id)}
                  {@const picked = campaign.salvagePicked.has(trophy.id)}
                  {@const scrapped = campaign.salvageScrapped.has(trophy.id)}
                  {@const full = !picked && !scrapped && used >= points}
                  <div class="trophy-row">
                    <button
                      class="pick trophy"
                      class:active={picked}
                      disabled={full}
                      title={full ? t('debrief.salvageFull') : ''}
                      onclick={() => campaign.toggleSalvage(trophy.id)}
                    >
                      <span class="t-top">
                        <span class="glow-cyan strong">{trophy.assembly.chassisCode}</span>
                        <span class="badge" class:badge-ok={picked} class:badge-dim={!picked}>
                          {picked ? t('debrief.salvageTaken') : t('debrief.salvageTake')}
                        </span>
                      </span>
                      <span class="t-foot">
                        <span class="dim">{recordChassisDef(trophy).tons} {t('common.tons')}</span>
                        <span class="gold">{t('debrief.trophyValue', { sum: cbills(mechValue(trophy)) })}</span>
                      </span>
                    </button>
                    <!--
                      Разбор на поле (шаг 34): корпус остаётся, железо идёт на
                      склад. Трюм запчастей стойками корабля не ограничен, и
                      это единственный способ не потерять трофей, когда ангар
                      полон.
                    -->
                    <button
                      class="btn btn-sm scrap"
                      class:active={scrapped}
                      disabled={full}
                      title={t('debrief.salvageScrapHint')}
                      onclick={() => campaign.toggleScrap(trophy.id)}
                    >
                      {t('debrief.salvageScrap')}
                    </button>
                  </div>
                {/each}
              </div>
              {#if campaign.salvageUnused > 0}
                <p class="gold small">
                  {t('debrief.salvageBuyout', { count: campaign.salvageUnused })}
                </p>
              {/if}
              {#if points > 0}
                <button class="btn btn-sm" title={t('debrief.salvageAutoHint')} onclick={() => campaign.salvageDefault()}>
                  {t('debrief.salvageAuto')}
                </button>
              {/if}
            {/if}
          </section>

          <!-- Что бой сделал со звеном. Числа боя, а не кампании. -->
          <section class="block">
            <div class="sec-title">{t('debrief.damage')}</div>
            <div class="rows">
              {#each ours as m (m.id)}
                <div class="row">
                  <span class="strong">{m.name}</span>
                  <span class="stats">
                    {#if m.lost}
                      <span class="badge badge-danger">{t('debrief.lostMech')}</span>
                    {:else if m.armorLost === 0 && m.structureLost === 0 && m.destroyed.length === 0}
                      <span class="ok">{t('debrief.intact')}</span>
                    {:else}
                      <span class="gold">{t('debrief.armorLost', { value: m.armorLost })}</span>
                      <span class="danger">{t('debrief.structureLost', { value: m.structureLost })}</span>
                    {/if}
                    {#if m.destroyed.length > 0}
                      <span class="badge badge-danger">
                        {t('debrief.zonesDestroyed', {
                          zones: m.destroyed.map((z) => t(`zone.${z}`)).join(', '),
                        })}
                      </span>
                    {/if}
                  </span>
                </div>
              {/each}
            </div>
          </section>

          <section class="block">
            <div class="sec-title">{t('debrief.pilots')}</div>
            <div class="rows">
              {#each ours as m (m.id)}
                <div class="row">
                  <span class="strong">{m.pilot ?? m.name}</span>
                  <span class="stats">
                    <span class="dim">{t('debrief.kills', { count: m.kills })}</span>
                    {#if m.pilotStatus === 'lost'}
                      <span class="badge badge-danger">{t('debrief.pilotLost')}</span>
                    {:else if m.injuries > 0}
                      <span class="badge badge-gold">
                        <!-- Срок лечения считает ядро (`company/medbay.ts`), а не экран. -->
                        {t('debrief.injured', { days: daysText(Math.ceil(treatmentDays(m.injuries))) })}
                      </span>
                    {:else}
                      <span class="badge badge-ok">{t('debrief.inService')}</span>
                    {/if}
                  </span>
                </div>
              {/each}
            </div>
          </section>

          <button class="btn btn-gold btn-wide finish" onclick={() => campaign.resolve()}>
            {t('debrief.close')}
          </button>
          {#if campaign.rejectText !== null}
            <p class="danger">{campaign.rejectText}</p>
          {/if}
        {:else if report !== null}
          <!-- Приём второй: что решила кампания. -->
          <!-- Достижения этого расчёта (шаг 69) — первыми: ради них бой и
               играли руками, а расчёт штаба боевых не даёт вовсе. -->
          {#if report.achievements.length > 0}
            <section class="block">
              <div class="sec-title">{t('debrief.achievements')}</div>
              <div class="ach-row">
                {#each report.achievements as id (id)}
                  {@const def = achievementDef(id)}
                  {#if def !== undefined}
                    <div class="ach">
                      <AchievementBadge {def} unlocked size={48} title={achievementHint(def)} />
                      <div class="ach-text">
                        <span class="gold">{achievementName(id)}</span>
                        <span class="dim small">{achievementHint(def)}</span>
                      </div>
                    </div>
                  {/if}
                {/each}
              </div>
            </section>
          {/if}

          <section class="block">
            <div class="sec-title">{t('debrief.settlement')}</div>
            <div class="row-kv">
              <span>{t('debrief.settlement')}</span>
              <span class:ok={report.settlement > 0} class:danger={report.settlement < 0}>
                {signedCbills(report.settlement)}
              </span>
            </div>
            <p class="dim small">{t('debrief.settlementHint')}</p>
          </section>

          <section class="block">
            <div class="sec-title">{t('debrief.salvage')}</div>
            <div class="row-kv">
              <span>{t('debrief.salvagePoints', { used: report.trophies.length, total: report.salvagePoints })}</span>
              <span class="dim">{report.salvageAvailable}</span>
            </div>
            {#if report.trophies.length === 0}
              <p class="dim">{t('debrief.salvageEmpty')}</p>
            {:else}
              <div class="tags">
                {#each report.trophies as name, i (i)}
                  <span class="badge badge-ok">{name}</span>
                {/each}
              </div>
            {/if}
            {#if report.lost.length > 0}
              <div class="tags">
                {#each report.lost as name, i (i)}
                  <span class="badge badge-danger">{t('debrief.lostMech')}: {name}</span>
                {/each}
              </div>
            {/if}
          </section>

          <section class="block">
            <div class="sec-title">{t('debrief.pilots')}</div>
            <div class="tags">
              {#each report.xpGain as g, i (i)}
                <span class="badge badge-cyan">{g.pilot} {t('debrief.xp', { value: g.xp })}</span>
              {/each}
              <!-- Навыки растут сами (`settleTraining`): разбор — единственное
                   место, где игрок узнаёт, что пилот стал лучше. -->
              {#each report.levelUps as u, i (i)}
                <span class="badge badge-gold">
                  {t('debrief.levelUp', { pilot: u.pilot, skill: tr(u.skill), level: u.level })}
                </span>
              {/each}
              {#each report.admitted as a, i (i)}
                <span class="badge badge-gold">{a.pilot}: {t('debrief.injured', { days: daysText(a.days) })}</span>
              {/each}
              {#each report.lostPilots as p, i (i)}
                <span class="badge badge-danger">{p}: {t('debrief.pilotLost')}</span>
              {/each}
            </div>
          </section>

          <!--
            ПОЧИНИТЬ ВСЁ ЗВЕНО прямо здесь (шаг 39). Дебрифинг — то самое место,
            где боль и возникает: машины только что вернулись побитыми, и до
            этого шага игрок шёл в ангар кликать по зонам одну за другой.

            Оторванные конечности кнопка не трогает: их судьба решается отдельно,
            в ангаре, и бейдж об этом честно предупреждает.
          -->
          {#if repairPlan.zones.length > 0 || repairPlan.tornLimbs > 0 || inRepairCount > 0}
            <section class="repair-all">
              {#if repairPlan.zones.length > 0}
                <button class="btn btn-wide" onclick={() => campaign.repairAll()}>
                  {t('hangar.repairAll')} · {cbills(repairPlan.cost)} · {t('hangar.action.duration', {
                    days: daysText(repairPlan.days),
                  })}
                </button>
              {:else if inRepairCount > 0}
                <button class="btn btn-wide" disabled>
                  ✓ {t('hangar.repairAllInQueue')} ({inRepairCount})
                </button>
              {/if}
              {#if repairPlan.tornLimbs > 0}
                <p class="warn small">{t('hangar.repairAllTorn', { count: repairPlan.tornLimbs })}</p>
              {/if}
            </section>
          {/if}

          <button class="btn btn-primary btn-wide finish" onclick={() => campaign.closeDebrief()}>
            {t('debrief.close')}
          </button>
        {/if}
      </div>
    </main>
  {/if}
</div>

<style>
  .repair-all {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 8px;
  }
  .debrief {
    display: flex;
    justify-content: center;
    height: 100%;
    padding: 12px;
    overflow: hidden;
  }
  .sheet {
    width: 880px;
    max-width: 100%;
  }
  .empty {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 14px;
    margin: auto;
    padding: 34px;
  }
  .hdr {
    display: flex;
    gap: 8px;
    align-items: baseline;
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px;
  }
  .block {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 11px 13px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    border-radius: 2px;
  }
  .spread {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .trophy-row {
    display: flex;
    align-items: stretch;
    gap: 4px;
  }
  .trophy-row .trophy {
    flex: 1;
  }
  .scrap.active {
    border-color: #d29922;
    color: #d29922;
  }
  .trophies {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
  .trophy {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .t-top,
  .t-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    font-size: 11.5px;
  }
  .t-foot {
    border-top: 1px solid var(--color-border);
    padding-top: 5px;
  }
  .strong {
    font-weight: 700;
  }
  .rows {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 5px 9px;
    background: rgba(13, 17, 23, 0.55);
    border: 1px solid var(--color-border);
    border-radius: 2px;
    font-size: 11.5px;
  }
  .stats {
    display: flex;
    align-items: center;
    gap: 9px;
    flex-wrap: wrap;
    justify-content: flex-end;
  }
  .tags {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
  }
  .ach-row {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .ach {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .ach-text {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .finish {
    padding: 12px;
    font-size: 13px;
  }
  .small {
    font-size: 10.5px;
  }
  p {
    margin: 0;
    line-height: 1.45;
  }
</style>

<script lang="ts">
  import type { MechRecord } from '../../core/campaign/mech/MechRecord.js';
  import { recordQuality } from '../../core/campaign/mech/MechRecord.js';
  import {
    getChassisCatalogEntry,
    makePlatform,
    frameTiersFor,
    REACTOR_TIER_COUNT,
  } from '../../core/rules/construction.js';
  import { CONSTRUCTION, REPAIR } from '../../core/data/index.js';
  import { QUALITY_CLASS_IDS, type QualityClass } from '../../core/model/QualityClass.js';
  import { campaign } from '../state/campaign.svelte.js';
  import { cbills, days as daysText, t } from '../i18n/index.js';

  interface Props {
    mech: MechRecord;
  }

  const { mech }: Props = $props();

  const chassis = $derived(getChassisCatalogEntry(mech.assembly.chassisCode));
  const installedQuality = $derived(recordQuality(mech));
  const techBase = $derived(chassis.techBase);
  const tonnage = $derived(chassis.tonnage);
  const weightClass = $derived(chassis.weightClass);
  const prefix = $derived(techBase === 'clan' ? 'CL' : 'IS');

  const wearMax = REPAIR.wear.threshold;
  const wearReset = REPAIR.wear.resetTo;

  /**
   * Запас прочности каркаса (шаг 66): сколько удачных полевых замен оторванных
   * конечностей уже накоплено с последней заводской переборки. Реактор сюда не
   * попадает — он теряет класс только износом, поле есть только у каркаса.
   */
  const frameLossMax = REPAIR.frameLoss.perStep;
  const frameLossCount = $derived(mech.condition.frameLossCount ?? 0);

  let overrideRTier = $state<number | null>(null);
  let overrideRQuality = $state<QualityClass | null>(null);
  let overrideFTier = $state<number | null>(null);
  let overrideFQuality = $state<QualityClass | null>(null);
  let lastMechId = $state<string>('');

  $effect(() => {
    if (mech.id !== lastMechId) {
      lastMechId = mech.id;
      overrideRTier = null;
      overrideRQuality = null;
      overrideFTier = null;
      overrideFQuality = null;
    }
  });

  function resetReactor() {
    overrideRTier = null;
    overrideRQuality = null;
  }

  function resetFrame() {
    overrideFTier = null;
    overrideFQuality = null;
  }

  const previewRTier = $derived(overrideRTier ?? chassis.reactorTier);
  const previewRQuality = $derived(overrideRQuality ?? installedQuality.reactor);
  const previewFTier = $derived(overrideFTier ?? chassis.frameTier);
  const previewFQuality = $derived(overrideFQuality ?? installedQuality.frame);

  const installedPlatform = $derived(
    makePlatform(
      techBase,
      tonnage,
      chassis.reactorTier,
      chassis.frameTier,
      installedQuality,
      chassis.locomotion,
    ),
  );

  /**
   * Линейки тиров выводятся из данных, а не пишутся литералами.
   *
   * У каркаса это стало обязательным вместе с локомоцией (2026-09-10): у
   * негуманоида F1 не существует, и захардкоженная `[1, 2, 3]` предлагала бы
   * игроку кнопку, на которой подмена всякий раз отклоняется — `withNodeTier`
   * ищет получившийся код в каталоге и не находит.
   */
  const reactorTiers = Array.from({ length: REACTOR_TIER_COUNT }, (_, i) => i + 1);
  const frameTiers = $derived(frameTiersFor(chassis.locomotion));

  const previewPlatform = $derived(
    makePlatform(
      techBase,
      tonnage,
      previewRTier,
      previewFTier,
      {
        reactor: previewRQuality,
        frame: previewFQuality,
      },
      chassis.locomotion,
    ),
  );

  // --- Реактор ---
  const rIsPreview = $derived(
    previewRTier !== chassis.reactorTier || previewRQuality !== installedQuality.reactor,
  );

  const deltaWalk = $derived(previewPlatform.walkMP - installedPlatform.walkMP);
  const deltaRun = $derived(previewPlatform.runMP - installedPlatform.runMP);
  const deltaRMass = $derived(
    Math.round((previewPlatform.reactorMass - installedPlatform.reactorMass) * 100) / 100,
  );
  const deltaDiss = $derived(previewPlatform.baseHeatDiss - installedPlatform.baseHeatDiss);
  const deltaCritHeat = $derived(
    previewPlatform.reactorCritHeat - installedPlatform.reactorCritHeat,
  );
  const rMassPercent = $derived(
    Math.round((previewPlatform.reactorMass / tonnage) * 100),
  );

  // --- Каркас ---
  const fIsPreview = $derived(
    previewFTier !== chassis.frameTier || previewFQuality !== installedQuality.frame,
  );

  const deltaFMass = $derived(
    Math.round((previewPlatform.frameMass - installedPlatform.frameMass) * 100) / 100,
  );
  const deltaSlots = $derived(
    previewPlatform.freeSlotsTotal - installedPlatform.freeSlotsTotal,
  );
  const deltaStructure = $derived(
    previewPlatform.totalStructure - installedPlatform.totalStructure,
  );
  const deltaArmor = $derived(
    previewPlatform.maxArmorPts - installedPlatform.maxArmorPts,
  );
  const fMassPercent = $derived(
    Math.round((previewPlatform.frameMass / tonnage) * 100),
  );

  const QUALITY_STARS: Record<QualityClass, string> = {
    recovered: '★',
    standard: '★★',
    military: '★★★★',
    master: '★★★★★',
  };

  function frameTierName(tier: number): string {
    if (tier === 1) return t('hangar.frameTierBase');
    if (tier === 2) return t('hangar.frameTierLight');
    return t('hangar.frameTierEndo');
  }

  function getReactorSpeed(wClass: 'light' | 'medium' | 'heavy' | 'assault', tier: number): { walk: number; run: number } {
    const walk = CONSTRUCTION.reactors.walkMP[wClass][tier - 1] ?? 0;
    const run = Math.floor(walk * 1.5);
    return { walk, run };
  }

  function getFrameStats(tBase: 'is' | 'clan', tier: number): { penalty: number; massPct: number } {
    const penalty = CONSTRUCTION.frames.slotPenalty[tBase][tier - 1] ?? 0;
    const massPct = Math.round((CONSTRUCTION.frames.massPercent[tier - 1] ?? 0) * 100);
    return { penalty, massPct };
  }

  /**
   * Счёт за собранную связку (шаг 45).
   *
   * До этого шага панель умела только показывать «а что если»: игрок собирал
   * R3/F1 армейские, видел прибавку хода — и не мог с этим сделать ничего.
   * Тир доставался исключительно случайной находкой на прилавке, и связка из
   * двух узлов практически не выпадала. Теперь подобранное здесь же и
   * заказывается: цена, срок и годность считаются до оплаты.
   */
  const quote = $derived(
    campaign.orderQuote(mech, {
      reactor: { tier: previewRTier, cls: previewRQuality },
      frame: { tier: previewFTier, cls: previewFQuality },
    }),
  );

  const orderCmd = $derived({ kind: 'orderPart', items: quote.toOrder } as const);
  /** Почему заказ нельзя оформить прямо сейчас: правило ядра, а не догадка панели. */
  const orderWhy = $derived(quote.toOrder.length > 0 ? campaign.why(orderCmd) : null);

  const canOrder = $derived(
    quote.toOrder.length > 0 && quote.deliverable && quote.fits && orderWhy === null,
  );

  function order(): void {
    if (!canOrder) return;
    campaign.run({ kind: 'orderPart', items: quote.toOrder });
  }

  function install(partId: string): void {
    campaign.run({ kind: 'installPart', recordId: mech.id, partId });
  }
</script>

<div class="node-inspector">
  <!-- БЛОК РЕАКТОРА -->
  <div class="node-card" class:is-preview={rIsPreview}>
    <div class="card-header">
      <div class="header-main-row">
        <span class="card-title">{t('hangar.reactor')}</span>
        <span
          class="badge"
          class:badge-danger={previewRQuality === 'recovered'}
          class:badge-dim={previewRQuality === 'standard'}
          class:badge-cyan={previewRQuality === 'military'}
          class:badge-gold={previewRQuality === 'master'}
        >
          {t(`quality.${previewRQuality}`)} {QUALITY_STARS[previewRQuality]}
        </span>
      </div>

      <div class="header-sub-row">
        <span class="installed-tag" class:cyan={rIsPreview}>
          {#if rIsPreview}
            {t('hangar.preview')}: {prefix}-R{previewRTier}
          {:else}
            {t('hangar.installed')}: {prefix}-R{chassis.reactorTier}
          {/if}
        </span>
        <button
          type="button"
          class="btn-reset"
          class:hidden={!rIsPreview}
          onclick={resetReactor}
          title={t('hangar.resetToInstalled')}
        >
          ↺ {t('hangar.reset')}
        </button>
      </div>
    </div>

    <!-- Линейка тиров R1..R5 -->
    <div class="ruler-group">
      <div class="ruler-header">
        <span class="ruler-label">{t('hangar.tierRuler')}</span>
        <span class="dim small">{t('hangar.tierSpeedHint')}</span>
      </div>
      <div class="tier-ruler" role="group" aria-label={t('hangar.reactorTierRulerLabel')}>
        {#each reactorTiers as tier}
          {@const isInst = tier === chassis.reactorTier}
          {@const isAct = tier === previewRTier}
          {@const spd = getReactorSpeed(weightClass, tier)}
          <button
            type="button"
            class="tier-btn"
            class:installed={isInst}
            class:active={isAct}
            onclick={() => (overrideRTier = tier)}
            title="R{tier}: {spd.walk} / {spd.run} {t('hangar.hexes')}"
          >
            <span class="tier-top">
              <span class="tier-num">R{tier}</span>
              {#if isInst}
                <span class="tag-installed" title={t('hangar.installed')}>•</span>
              {/if}
            </span>
            <span class="tier-sub">{spd.walk}/{spd.run}</span>
          </button>
        {/each}
      </div>
    </div>

    <!-- Линейка качества В, С, А, М -->
    <div class="ruler-group">
      <div class="ruler-header">
        <span class="ruler-label">{t('hangar.qualityRuler')}</span>
        <span class="dim small">{t('hangar.qualityLettersHint')}</span>
      </div>
      <div class="quality-ruler" role="group" aria-label={t('hangar.reactorQualityLabel')}>
        {#each QUALITY_CLASS_IDS as q}
          {@const isInst = q === installedQuality.reactor}
          {@const isAct = q === previewRQuality}
          <button
            type="button"
            class="quality-btn q-{q}"
            class:installed={isInst}
            class:active={isAct}
            onclick={() => (overrideRQuality = q)}
            title={t(`quality.hints.reactor.${q}`)}
          >
            <span class="q-letter">{t(`quality.letter.${q}`)}</span>
            <span class="q-stars">{QUALITY_STARS[q]}</span>
            {#if isInst}
              <span class="q-dot" title={t('hangar.installed')}>•</span>
            {/if}
          </button>
        {/each}
      </div>
    </div>

    <!-- Сетка характеристик -->
    <div class="stats-grid">
      <div class="stat-item">
        <span class="stat-k">{t('hangar.speed')}</span>
        <span class="stat-v">
          {previewPlatform.walkMP} / {previewPlatform.runMP} {t('hangar.hexes')}
          {#if rIsPreview && (deltaWalk !== 0 || deltaRun !== 0)}
            <span class="delta" class:ok={deltaWalk > 0} class:danger={deltaWalk < 0}>
              ({deltaWalk >= 0 ? `+${deltaWalk}` : deltaWalk} / {deltaRun >= 0 ? `+${deltaRun}` : deltaRun})
            </span>
          {/if}
        </span>
      </div>

      <div class="stat-item">
        <span class="stat-k">{t('hangar.nodeMass')}</span>
        <span class="stat-v">
          {t('hangar.massTons', { n: previewPlatform.reactorMass.toFixed(2) })}
          <span class="dim small">({rMassPercent}%)</span>
          {#if rIsPreview && deltaRMass !== 0}
            <span class="delta" class:ok={deltaRMass < 0} class:danger={deltaRMass > 0}>
              {t('hangar.deltaTons', { delta: deltaRMass > 0 ? `+${deltaRMass.toFixed(2)}` : deltaRMass.toFixed(2) })}
            </span>
          {/if}
        </span>
      </div>

      <div class="stat-item">
        <span class="stat-k">{t('hangar.dissipation')}</span>
        <span class="stat-v">
          {previewPlatform.baseHeatDiss} {t('hangar.heatPerTurn')}
          {#if rIsPreview && deltaDiss !== 0}
            <span class="delta" class:ok={deltaDiss > 0} class:danger={deltaDiss < 0}>
              ({deltaDiss > 0 ? `+${deltaDiss}` : deltaDiss})
            </span>
          {/if}
        </span>
      </div>

      <div class="stat-item">
        <span class="stat-k">{t('hangar.critHeat')}</span>
        <span class="stat-v">
          +{previewPlatform.reactorCritHeat} {t('hangar.heatPerCrit')}
          {#if rIsPreview && deltaCritHeat !== 0}
            <span class="delta" class:ok={deltaCritHeat < 0} class:danger={deltaCritHeat > 0}>
              ({deltaCritHeat > 0 ? `+${deltaCritHeat}` : deltaCritHeat})
            </span>
          {/if}
        </span>
      </div>
    </div>

    <!-- Износ -->
    <div class="wear-row" title={t('hangar.wearHint', { reset: wearReset })}>
      <div class="wear-info">
        <span class="dim small">
          {t('hangar.wear')}: <b>{Math.round(mech.wear.reactor)}</b> / {wearMax}
        </span>
        <span class="dim small wear-rule">
          {t('hangar.wearRuleShort', { max: wearMax, reset: wearReset })}
        </span>
      </div>
      <span class="meter wear-meter" class:danger={mech.wear.reactor >= wearMax * 0.7}>
        <i style:width="{Math.min(100, (mech.wear.reactor / wearMax) * 100)}%"></i>
      </span>
    </div>
  </div>

  <!-- БЛОК СИЛОВОГО КАРКАСА -->
  <div class="node-card" class:is-preview={fIsPreview}>
    <div class="card-header">
      <div class="header-main-row">
        <span class="card-title">{t('hangar.frame')}</span>
        <span
          class="badge"
          class:badge-danger={previewFQuality === 'recovered'}
          class:badge-dim={previewFQuality === 'standard'}
          class:badge-cyan={previewFQuality === 'military'}
          class:badge-gold={previewFQuality === 'master'}
        >
          {t(`quality.${previewFQuality}`)} {QUALITY_STARS[previewFQuality]}
        </span>
      </div>

      <div class="header-sub-row">
        <span class="installed-tag" class:cyan={fIsPreview}>
          {#if fIsPreview}
            {t('hangar.preview')}: {prefix}-F{previewFTier}
          {:else}
            {t('hangar.installed')}: {prefix}-F{chassis.frameTier}
          {/if}
        </span>
        <button
          type="button"
          class="btn-reset"
          class:hidden={!fIsPreview}
          onclick={resetFrame}
          title={t('hangar.resetToInstalled')}
        >
          ↺ {t('hangar.reset')}
        </button>
      </div>
    </div>

    <!-- Линейка тиров F1..F3 -->
    <div class="ruler-group">
      <div class="ruler-header">
        <span class="ruler-label">{t('hangar.tierRuler')}</span>
        <span class="dim small">{t('hangar.tierSlotsHint')}</span>
      </div>
      <div class="tier-ruler frame-ruler" role="group" aria-label={t('hangar.frameTierRulerLabel')}>
        {#each frameTiers as tier}
          {@const isInst = tier === chassis.frameTier}
          {@const isAct = tier === previewFTier}
          {@const fStats = getFrameStats(techBase, tier)}
          <button
            type="button"
            class="tier-btn frame-tier-btn"
            class:installed={isInst}
            class:active={isAct}
            onclick={() => (overrideFTier = tier)}
            title={t('hangar.frameTierTitle', {
              tier,
              name: frameTierName(tier),
              mass: fStats.massPct,
              penalty: fStats.penalty === 0 ? t('hangar.slotPenaltyNone') : t('hangar.slotPenalty', { n: fStats.penalty }),
            })}
          >
            <span class="tier-top">
              <span class="tier-num">F{tier} · {frameTierName(tier)}</span>
              {#if isInst}
                <span class="tag-installed" title={t('hangar.installed')}>•</span>
              {/if}
            </span>
            <span class="tier-sub">
              {fStats.penalty === 0
                ? t('hangar.frameTierSubNone', { mass: fStats.massPct })
                : t('hangar.frameTierSub', { mass: fStats.massPct, n: fStats.penalty })}
            </span>
          </button>
        {/each}
      </div>
    </div>

    <!-- Линейка качества В, С, А, М -->
    <div class="ruler-group">
      <div class="ruler-header">
        <span class="ruler-label">{t('hangar.qualityRuler')}</span>
        <span class="dim small">{t('hangar.qualityLettersHint')}</span>
      </div>
      <div class="quality-ruler" role="group" aria-label={t('hangar.frameQualityLabel')}>
        {#each QUALITY_CLASS_IDS as q}
          {@const isInst = q === installedQuality.frame}
          {@const isAct = q === previewFQuality}
          <button
            type="button"
            class="quality-btn q-{q}"
            class:installed={isInst}
            class:active={isAct}
            onclick={() => (overrideFQuality = q)}
            title={t(`quality.hints.frame.${q}`)}
          >
            <span class="q-letter">{t(`quality.letter.${q}`)}</span>
            <span class="q-stars">{QUALITY_STARS[q]}</span>
            {#if isInst}
              <span class="q-dot" title={t('hangar.installed')}>•</span>
            {/if}
          </button>
        {/each}
      </div>
    </div>

    <!-- Сетка характеристик -->
    <div class="stats-grid">
      <div class="stat-item">
        <span class="stat-k">{t('hangar.nodeMass')}</span>
        <span class="stat-v">
          {t('hangar.massTons', { n: previewPlatform.frameMass.toFixed(2) })}
          <span class="dim small">({fMassPercent}%)</span>
          {#if fIsPreview && deltaFMass !== 0}
            <span class="delta" class:ok={deltaFMass < 0} class:danger={deltaFMass > 0}>
              {t('hangar.deltaTons', { delta: deltaFMass > 0 ? `+${deltaFMass.toFixed(2)}` : deltaFMass.toFixed(2) })}
            </span>
          {/if}
        </span>
      </div>

      <div class="stat-item">
        <span class="stat-k">{t('hangar.slotsAvailable')}</span>
        <span class="stat-v">
          {previewPlatform.freeSlotsTotal} {t('hangar.slotsUnit')}
          {#if previewPlatform.frameSlotPenalty > 0}
            <span class="dim small">(-{previewPlatform.frameSlotPenalty})</span>
          {/if}
          {#if fIsPreview && deltaSlots !== 0}
            <span class="delta" class:ok={deltaSlots > 0} class:danger={deltaSlots < 0}>
              {t('hangar.deltaSlots', { delta: deltaSlots > 0 ? `+${deltaSlots}` : deltaSlots })}
            </span>
          {/if}
        </span>
      </div>

      <div class="stat-item">
        <span class="stat-k">{t('hangar.structure')}</span>
        <span class="stat-v">
          {previewPlatform.totalStructure} {t('hangar.pts')}
          {#if fIsPreview && deltaStructure !== 0}
            <span class="delta" class:ok={deltaStructure > 0} class:danger={deltaStructure < 0}>
              ({deltaStructure > 0 ? `+${deltaStructure}` : deltaStructure})
            </span>
          {/if}
        </span>
      </div>

      <div class="stat-item">
        <span class="stat-k">{t('hangar.maxArmor')}</span>
        <span class="stat-v">
          {previewPlatform.maxArmorPts} {t('hangar.pts')}
          {#if fIsPreview && deltaArmor !== 0}
            <span class="delta" class:ok={deltaArmor > 0} class:danger={deltaArmor < 0}>
              ({deltaArmor > 0 ? `+${deltaArmor}` : deltaArmor})
            </span>
          {/if}
        </span>
      </div>
    </div>

    <!-- Износ -->
    <div class="wear-row" title={t('hangar.wearHint', { reset: wearReset })}>
      <div class="wear-info">
        <span class="dim small">
          {t('hangar.wear')}: <b>{Math.round(mech.wear.frame)}</b> / {wearMax}
        </span>
        <span class="dim small wear-rule">
          {t('hangar.wearRuleShort', { max: wearMax, reset: wearReset })}
        </span>
      </div>
      <span class="meter wear-meter" class:danger={mech.wear.frame >= wearMax * 0.7}>
        <i style:width="{Math.min(100, (mech.wear.frame / wearMax) * 100)}%"></i>
      </span>
    </div>

    <!-- Запас прочности (шаг 66): оторванные конечности, а не износ. -->
    <div class="wear-row" title={t('hangar.frameLossHint', { max: frameLossMax })}>
      <div class="wear-info">
        <span class="dim small">
          {t('hangar.frameLossLabel')}: <b>{frameLossCount}</b> / {frameLossMax}
        </span>
        <span class="dim small wear-rule">
          {t('hangar.frameLossRuleShort', { max: frameLossMax })}
        </span>
      </div>
      <span class="meter wear-meter" class:danger={frameLossCount >= frameLossMax - 1}>
        <i style:width="{Math.min(100, (frameLossCount / frameLossMax) * 100)}%"></i>
      </span>
    </div>
  </div>

  <!--
    Заказ подобранной связки (шаг 45).

    Подвал появляется только когда связка отличается от установленной: пока
    игрок просто смотрит на свою машину, кнопки нет и мешать она не может.
  -->
  {#if quote.items.length > 0}
    <div class="order-bar" class:blocked={!quote.fits || !quote.deliverable}>
      <div class="order-lines">
        {#each quote.items as item (item.node)}
          <span class="order-line">
            <span class="cyan">{t(`hangar.${item.node}`)}</span>
            {item.node === 'reactor' ? 'R' : 'F'}{item.tier} · {t(`quality.${item.targetClass}`)}
          </span>
        {/each}
      </div>

      {#if !quote.fits}
        <p class="danger small">{t('hangar.orderNoFit')}</p>
      {:else if !quote.deliverable}
        <p class="warn small">{t('hangar.orderNoDelivery')}</p>
      {:else}
        <p class="dim small">
          {t('hangar.orderStowed', {
            nodes: quote.stowed.map((n) => t(`hangar.${n.node}`)).join(', '),
          })}
        </p>
      {/if}
      {#if quote.inTransit.length > 0}
        <p class="ok small">
          {t('hangar.orderInTransit', {
            nodes: quote.inTransit.map((n) => t(`hangar.${n.node}`)).join(', '),
            date: campaign.dateText(Math.max(...quote.inTransit.map((n) => n.day))),
          })}
        </p>
      {/if}
      {#if quote.ready.length > 0}
        <p class="ok small">
          {t('hangar.orderReady', {
            nodes: quote.ready.map((n) => t(`hangar.${n.node}`)).join(', '),
          })}
        </p>
      {/if}

      <!--
        Круг замыкается здесь же: доехавший заказ, снятый с другой машины узел
        или трофей ставится прямо из ангара, а не через отдельный экран склада.
        Каждый узел — своя работа цеха, поэтому и кнопок столько же, сколько
        узлов: два стапеля занять одной кнопкой нельзя.
      -->
      {#each quote.ready as have (have.node)}
        {@const cmd = { kind: 'installPart', recordId: mech.id, partId: have.partId } as const}
        {@const why = campaign.why(cmd)}
        <button
          type="button"
          class="btn btn-primary btn-wide"
          disabled={why !== null || !quote.fits}
          title={why ?? t('hangar.installFromStockHint')}
          onclick={() => install(have.partId)}
        >
          {t('hangar.installFromStock', { node: t(`hangar.${have.node}`) })}
        </button>
      {/each}

      {#if quote.toOrder.length > 0}
        <button
          type="button"
          class="btn btn-primary btn-wide"
          disabled={!canOrder}
          title={quote.deliverable ? t('hangar.orderHint', { days: daysText(quote.days) }) : ''}
          onclick={order}
        >
          {t('hangar.orderDo')} · {cbills(quote.orderCost)}
          {#if quote.deliverable}· {daysText(quote.days)}{/if}
        </button>
      {:else if quote.inTransit.length > 0 && quote.ready.length === 0}
        <!-- Заказ оплачен: кнопка остаётся на месте, но серая, и говорит, что всё прошло. -->
        <button type="button" class="btn btn-primary btn-wide" disabled>
          {t('hangar.orderPlaced', {
            date: campaign.dateText(Math.max(...quote.inTransit.map((n) => n.day))),
          })}
        </button>
        <!-- Кнопка без объяснения выглядит сломанной: причину отказа ядра показываем рядом. -->
        {#if quote.fits && quote.deliverable && orderWhy !== null}
          <p class="danger small">{orderWhy}</p>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  /* Подвал заказа: единственное действие панели, поэтому отбит от карточек. */
  .order-bar {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    padding: 0.6rem;
    border: 1px solid var(--line, #2a3a44);
    border-radius: 4px;
    background: rgb(0 0 0 / 18%);
  }
  .order-bar.blocked {
    opacity: 0.85;
  }
  .order-lines {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .order-line {
    font-size: 0.85em;
  }
  .order-bar p {
    margin: 0;
  }

  .node-inspector {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .node-card {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 9px 11px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    border-radius: 2px;
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  .node-card.is-preview {
    border-color: rgba(57, 197, 187, 0.45);
    background: linear-gradient(180deg, rgba(57, 197, 187, 0.04) 0%, var(--color-panel-sub) 100%);
  }

  /* Шапка карточки */
  .card-header {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .header-main-row,
  .header-sub-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    min-height: 20px;
  }

  .card-title {
    font-family: var(--font-display);
    font-size: 13px;
    font-weight: 700;
    letter-spacing: 0.8px;
    text-transform: uppercase;
    color: var(--color-text);
    line-height: 1;
  }

  .installed-tag {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 11px;
    font-family: var(--font-mono);
    color: var(--color-text-dim);
    line-height: 1;
    white-space: nowrap;
  }

  .installed-tag.cyan {
    color: var(--color-accent);
    font-weight: 600;
  }

  .btn-reset {
    background: rgba(57, 197, 187, 0.1);
    border: 1px solid var(--color-accent);
    color: var(--color-accent);
    font-family: var(--font-mono);
    font-size: 10px;
    padding: 1px 7px;
    border-radius: 2px;
    cursor: pointer;
    transition: all 0.15s;
    line-height: 1.3;
    white-space: nowrap;
  }

  .btn-reset:hover {
    background: var(--color-accent);
    color: #0b1318;
  }

  .btn-reset.hidden {
    visibility: hidden;
    pointer-events: none;
  }

  /* Группа линейки */
  .ruler-group {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .ruler-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    font-size: 11px;
  }

  .ruler-label {
    font-family: var(--font-display);
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.6px;
    color: var(--color-text-dim);
  }

  /* Линейка тиров */
  .tier-ruler {
    display: grid;
    grid-template-columns: repeat(5, 1fr);
    gap: 4px;
    width: 100%;
  }

  .tier-ruler.frame-ruler {
    grid-template-columns: repeat(3, 1fr);
  }

  .tier-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4px 2px;
    background: rgba(13, 17, 23, 0.7);
    border: 1px solid var(--color-border);
    border-radius: 2px;
    color: var(--color-text);
    cursor: pointer;
    transition: all 0.15s;
    user-select: none;
  }

  .tier-btn:hover {
    border-color: var(--color-text-dim);
    background: rgba(22, 27, 34, 0.9);
  }

  .tier-btn.installed {
    border-color: #485360;
  }

  .tier-btn.active {
    border-color: var(--color-accent);
    background: rgba(57, 197, 187, 0.15);
    box-shadow: 0 0 6px var(--glow-cyan);
    color: var(--color-accent);
  }

  .tier-btn.active .tier-sub {
    color: #bbf2ee;
  }

  .tier-top {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 3px;
    line-height: 1.1;
  }

  .tier-num {
    font-family: var(--font-display);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.5px;
  }

  .tag-installed {
    font-size: 10px;
    color: var(--color-accent);
    line-height: 1;
  }

  .tier-sub {
    font-size: 9.5px;
    font-family: var(--font-mono);
    color: var(--color-text-dim);
    line-height: 1.1;
    margin-top: 1px;
    white-space: nowrap;
  }

  /* Линейка классов В, С, А, М */
  .quality-ruler {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 4px;
    width: 100%;
  }

  .quality-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 4px 6px;
    background: rgba(13, 17, 23, 0.7);
    border: 1px solid var(--color-border);
    border-radius: 2px;
    cursor: pointer;
    transition: all 0.15s;
    user-select: none;
  }

  .quality-btn:hover {
    border-color: var(--color-text-dim);
  }

  .q-letter {
    font-family: var(--font-display);
    font-size: 12px;
    font-weight: 700;
  }

  .q-stars {
    font-size: 8px;
    letter-spacing: -1px;
    opacity: 0.85;
  }

  .q-dot {
    font-size: 10px;
    color: var(--color-accent);
    line-height: 1;
    margin-left: -1px;
  }

  /* Расцветки классов */
  .quality-btn.q-recovered {
    color: var(--color-danger);
  }
  .quality-btn.q-recovered.active {
    border-color: var(--color-danger);
    background: rgba(248, 81, 73, 0.15);
    box-shadow: 0 0 6px var(--glow-red);
  }

  .quality-btn.q-standard {
    color: var(--color-text-dim);
  }
  .quality-btn.q-standard.active {
    border-color: var(--color-text-dim);
    color: var(--color-text);
    background: rgba(139, 148, 158, 0.15);
  }

  .quality-btn.q-military {
    color: var(--color-accent);
  }
  .quality-btn.q-military.active {
    border-color: var(--color-accent);
    background: rgba(57, 197, 187, 0.15);
    box-shadow: 0 0 6px var(--glow-cyan);
  }

  .quality-btn.q-master {
    color: var(--color-gold);
  }
  .quality-btn.q-master.active {
    border-color: var(--color-gold);
    background: rgba(227, 179, 65, 0.15);
    box-shadow: 0 0 6px var(--glow-gold);
  }

  /* Сетка характеристик */
  .stats-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 5px;
  }

  .stat-item {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 1px;
    padding: 3px 7px;
    min-height: 38px;
    box-sizing: border-box;
    background: rgba(13, 17, 23, 0.5);
    border: 1px solid rgba(48, 54, 61, 0.4);
    border-radius: 2px;
  }

  .stat-k {
    font-size: 9.5px;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--color-text-dim);
  }

  .stat-v {
    font-size: 11.5px;
    font-family: var(--font-mono);
    color: var(--color-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .delta {
    font-size: 10.5px;
    font-weight: 700;
    margin-left: 2px;
  }

  .delta.ok {
    color: var(--color-ok);
  }

  .delta.danger {
    color: var(--color-danger);
  }

  /* Износ */
  .wear-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-top: 5px;
    border-top: 1px solid rgba(48, 54, 61, 0.5);
  }

  .wear-info {
    display: flex;
    flex-direction: column;
    gap: 1px;
  }

  .wear-rule {
    font-size: 9px;
    color: var(--color-text-dim);
  }

  .wear-meter {
    width: 110px;
    flex-shrink: 0;
  }

  .small {
    font-size: 10px;
  }

  .dim {
    color: var(--color-text-dim);
  }
</style>

<script lang="ts">
  import { battle } from '../state/battle.svelte.js';
  import { Phase } from '../../core/model/index.js';
  import { t } from '../i18n/index.js';

  /**
   * Подпись боя. По умолчанию — свободный бой; кампания подставляет сюда
   * контракт, чтобы игрок в бою видел, за что дерётся.
   */
  let {
    title = t('battle.header.title'),
    subtitle = t('battle.header.subtitle'),
  }: { title?: string | undefined; subtitle?: string | undefined } = $props();

  let detailsOpen = $state(false);

  let hexCount = $derived(battle.descriptor.width * battle.descriptor.height);

  let nextPhaseLabel = $derived(
    battle.phase === Phase.Movement
      ? t('battle.header.toFire')
      : battle.phase === Phase.Attack
        ? t('battle.header.nextTurn')
        : t('battle.header.nextPhase'),
  );
</script>

<header class="app-header">
  <div class="header-left">
    <div class="logo-group">
      <div class="logo-icon">⬢</div>
      <div>
        <h1 class="logo-title">{title}</h1>
        <span class="logo-subtitle">{subtitle}</span>
      </div>
    </div>

    <div class="quick-stats">
      <button
        type="button"
        class="stat-pill stat-toggle"
        class:open={detailsOpen}
        title={detailsOpen
          ? t('battle.header.collapseMap')
          : t('battle.header.mapParams', {
              w: battle.descriptor.width,
              h: battle.descriptor.height,
              hexes: hexCount,
              biome: battle.descriptor.biome.toUpperCase(),
              fps: battle.fps,
            })}
        onclick={() => (detailsOpen = !detailsOpen)}
      >
        <span class="toggle-arrow">{detailsOpen ? '▾' : '▸'}</span>
        <span class="toggle-text">{t('battle.header.info')}</span>
      </button>

      {#if detailsOpen}
        <button
          type="button"
          class="stat-pill clickable"
          onclick={() => (detailsOpen = false)}
          title={t('battle.header.clickToCollapse')}
        >
          <span class="label">{t('battle.header.grid')}</span>
          <span>{battle.descriptor.width} × {battle.descriptor.height} ({hexCount} HEX)</span>
        </button>
        <button
          type="button"
          class="stat-pill clickable"
          onclick={() => (detailsOpen = false)}
          title={t('battle.header.clickToCollapse')}
        >
          <span class="label">{t('battle.header.biome')}</span>
          <span>{battle.descriptor.biome.toUpperCase()}</span>
        </button>
        <button
          type="button"
          class="stat-pill clickable"
          onclick={() => (detailsOpen = false)}
          title={t('battle.header.clickToCollapse')}
        >
          <span class="label">FPS:</span>
          <span>{battle.fps}</span>
        </button>
        <button
          type="button"
          class="stat-pill clickable"
          onclick={() => (detailsOpen = false)}
          title={t('battle.header.clickToCollapse')}
        >
          <span class="label">{t('battle.header.seed')}</span>
          <span>#{battle.descriptor.seed}/#{battle.options.battleSeed}</span>
        </button>
      {/if}

      <div class="stat-pill">
        <span class="label">{t('battle.header.turn')}</span>
        <span class="glow-val" class:hot={battle.phase === Phase.Attack}>
          {battle.turn} · {battle.phaseName}
        </span>
      </div>
      {#if battle.objective !== null}
        <div class="stat-pill">
          <span class="label">{t('battle.header.objective')}</span>
          <span class="glow-val" class:done={battle.objective.done}>{battle.objective.text}</span>
        </div>
      {/if}
    </div>
  </div>

  <div class="top-actions">
    {#if battle.botThinking}
      <span class="thinking">{t('battle.header.enemyThinking')}</span>
    {/if}
    <button
      class="btn btn-phase"
      class:hot={battle.phase === Phase.Attack}
      disabled={battle.botThinking || battle.finished}
      title={battle.phase === Phase.Movement
        ? t('battle.header.endMoveTitle')
        : t('battle.header.endAttackTitle')}
      onclick={() => void battle.endPhase()}
    >
      {nextPhaseLabel}
    </button>
  </div>
</header>

<style>
  .app-header {
    height: 52px;
    background: #161b22;
    border-bottom: 1px solid #30363d;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 16px;
    gap: 16px;
    z-index: 10;
    flex-shrink: 0;
  }
  .header-left {
    display: flex;
    align-items: center;
    gap: 16px;
    min-width: 0;
    flex-wrap: nowrap;
  }
  .logo-group { display: flex; align-items: center; gap: 10px; flex-shrink: 0; }
  .logo-icon { color: #39c5bb; font-size: 24px; text-shadow: 0 0 8px rgba(57, 197, 187, 0.6); }
  .logo-title {
    margin: 0; font-size: 13px; letter-spacing: 1px; color: #e6edf3;
    font-family: monospace; font-weight: bold;
  }
  .logo-subtitle {
    font-size: 9px; color: #8b949e; letter-spacing: 0.5px; display: block; font-family: monospace;
  }
  .quick-stats { display: flex; gap: 8px; align-items: center; flex-wrap: nowrap; }
  .done { color: var(--ok, #5cd6a0); }
  .stat-pill {
    background: rgba(13, 17, 23, 0.8);
    border: 1px solid #30363d;
    padding: 4px 10px;
    border-radius: 20px;
    font-size: 11px;
    font-family: monospace;
    color: #e6edf3;
    white-space: nowrap;
  }
  .stat-pill .label { color: #8b949e; margin-right: 4px; }
  .stat-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: rgba(13, 17, 23, 0.65);
    border: 1px solid #30363d;
    cursor: pointer;
    font-family: inherit;
    font-size: 11px;
    transition: all 0.15s ease;
  }
  .stat-toggle:hover {
    background: rgba(22, 27, 34, 0.95);
    border-color: #58a6ff;
  }
  .stat-toggle.open {
    border-color: rgba(57, 197, 187, 0.5);
    background: rgba(57, 197, 187, 0.08);
  }
  .toggle-arrow {
    color: #6e7681;
    font-size: 10px;
    line-height: 1;
    transition: color 0.15s;
  }
  .stat-toggle:hover .toggle-arrow {
    color: #58a6ff;
  }
  .stat-toggle.open .toggle-arrow {
    color: #39c5bb;
  }
  .toggle-text {
    color: #8b949e;
    font-weight: bold;
    letter-spacing: 0.5px;
  }
  .stat-toggle:hover .toggle-text {
    color: #e6edf3;
  }
  .stat-toggle.open .toggle-text {
    color: #39c5bb;
  }
  button.stat-pill.clickable {
    cursor: pointer;
    font-family: inherit;
    transition: border-color 0.15s, background 0.15s;
  }
  button.stat-pill.clickable:hover {
    border-color: #58a6ff;
    background: rgba(22, 27, 34, 0.95);
  }
  .glow-val { font-weight: bold; color: #39c5bb; }
  .glow-val.hot { color: #ff7b72; }
  .top-actions { display: flex; gap: 8px; align-items: center; }
  .thinking {
    font-family: monospace; font-size: 11px; color: #e3b341;
    animation: blink 1.1s ease-in-out infinite;
  }
  @keyframes blink { 50% { opacity: 0.35; } }
  .btn {
    display: flex; align-items: center; gap: 6px;
    padding: 6px 14px; border-radius: 4px;
    font-size: 12px; font-weight: bold; font-family: monospace;
    cursor: pointer; transition: all 0.15s;
  }
  .btn:disabled { opacity: 0.4; cursor: default; }
  .btn-phase {
    background: rgba(57, 197, 187, 0.15);
    border: 1px solid rgba(57, 197, 187, 0.4);
    color: #39c5bb;
  }
  .btn-phase:hover:not(:disabled) { background: rgba(57, 197, 187, 0.3); }
  .btn-phase.hot {
    background: rgba(248, 81, 73, 0.18);
    border-color: rgba(248, 81, 73, 0.5);
    color: #ff7b72;
    box-shadow: 0 0 10px rgba(248, 81, 73, 0.25);
  }
  .btn-phase.hot:hover:not(:disabled) {
    background: rgba(248, 81, 73, 0.35);
  }
</style>

<script lang="ts">
  import { battle } from '../state/battle.svelte.js';
  import { t } from '../i18n/index.js';

  let listEl = $state<HTMLDivElement | null>(null);
  let expandedIds = $state<Set<string>>(new Set());

  function toggleExpand(id: string) {
    if (expandedIds.has(id)) {
      expandedIds.delete(id);
    } else {
      expandedIds.add(id);
    }
    expandedIds = new Set(expandedIds);
  }

  $effect(() => {
    void battle.tickerItems.length;
    if (listEl !== null) {
      listEl.scrollTop = listEl.scrollHeight;
    }
  });
</script>

<div class="ticker" class:collapsed={battle.tickerCollapsed}>
  <div class="ticker-header">
    <div class="ticker-title">
      <span class="pulse-icon">⚡</span>
      {t('battle.feed.title')}
      {#if battle.tickerItems.length > 0}
        <span class="count-badge">{battle.tickerItems.length}</span>
      {/if}
    </div>
    <div class="header-actions">
      {#if battle.tickerItems.length > 0}
        <button
          class="btn-action"
          title={t('battle.feed.clear')}
          onclick={() => battle.clearTicker()}
        >✕</button>
      {/if}
      <button
        class="btn-action toggle-btn"
        title={battle.tickerCollapsed ? t('battle.feed.expand') : t('battle.feed.collapse')}
        onclick={() => (battle.tickerCollapsed = !battle.tickerCollapsed)}
      >{battle.tickerCollapsed ? '+' : '−'}</button>
    </div>
  </div>

  {#if !battle.tickerCollapsed}
    <div class="ticker-body" bind:this={listEl}>
      {#if battle.tickerItems.length === 0}
        <div class="empty-feed">
          <div class="empty-icon">🛡️</div>
          <div>{t('battle.feed.empty')}</div>
          <div class="empty-hint">{t('battle.feed.emptyHint')}</div>
        </div>
      {:else}
        {#each battle.tickerItems as item (item.id)}
          <div class="event-card {item.kind}">
            <div class="card-main">
              <span class="badge {item.badgeClass}">{item.badge}</span>
              <div class="summary-line">
                <span class="summary-text">{item.summary}</span>
                {#if item.damageSummary}
                  <span class="damage-tag">{item.damageSummary}</span>
                {/if}
              </div>
              {#if item.details && item.details.length > 0}
                <button
                  class="details-toggle"
                  title={t('battle.feed.details')}
                  onclick={() => toggleExpand(item.id)}
                >
                  {expandedIds.has(item.id) ? '▴' : '▾'}
                </button>
              {/if}
            </div>

            {#if expandedIds.has(item.id) && item.details}
              <div class="details-box">
                {#each item.details as line, i (i)}
                  <div class="detail-line">• {line}</div>
                {/each}
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  {/if}
</div>

<style>
  .ticker {
    position: absolute;
    bottom: 54px;
    right: 16px;
    width: 440px;
    max-width: calc(100vw - 32px);
    background: rgba(13, 17, 23, 0.94);
    backdrop-filter: blur(10px);
    border: 1px solid #30363d;
    border-radius: 6px;
    z-index: 6;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.7);
    overflow: hidden;
    font-family: monospace;
  }

  .ticker.collapsed {
    width: auto;
    min-width: 170px;
  }

  .ticker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 10px;
    background: #161b22;
    border-bottom: 1px solid #30363d;
  }

  .ticker-title {
    font-size: 11px;
    font-weight: bold;
    color: #e3b341;
    display: flex;
    align-items: center;
    gap: 6px;
    letter-spacing: 0.5px;
  }

  .pulse-icon {
    color: #e3b341;
    font-size: 12px;
  }

  .count-badge {
    background: rgba(227, 179, 65, 0.2);
    color: #e3b341;
    border: 1px solid rgba(227, 179, 65, 0.4);
    border-radius: 10px;
    padding: 0 5px;
    font-size: 9.5px;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .btn-action {
    background: none;
    border: none;
    color: #8b949e;
    cursor: pointer;
    font-size: 13px;
    padding: 1px 4px;
    border-radius: 3px;
    line-height: 1;
  }

  .btn-action:hover {
    color: #f0f6fc;
    background: rgba(255, 255, 255, 0.1);
  }

  .ticker-body {
    max-height: 190px;
    overflow-y: auto;
    padding: 6px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }

  .empty-feed {
    padding: 14px 10px;
    text-align: center;
    color: #8b949e;
    font-size: 11px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }

  .empty-icon {
    font-size: 18px;
    opacity: 0.6;
    margin-bottom: 2px;
  }

  .empty-hint {
    font-size: 9.5px;
    color: #484f58;
  }

  .event-card {
    background: rgba(22, 27, 34, 0.85);
    border: 1px solid #30363d;
    border-left: 3px solid #8b949e;
    border-radius: 4px;
    padding: 5px 8px;
    display: flex;
    flex-direction: column;
    gap: 4px;
    transition: background 0.15s;
  }

  .event-card.hit {
    border-left-color: #3fb950;
    background: rgba(18, 38, 24, 0.6);
  }

  .event-card.miss {
    border-left-color: #484f58;
    opacity: 0.88;
  }

  .event-card.shutdown {
    border-left-color: #f85149;
    background: rgba(45, 14, 18, 0.75);
    box-shadow: inset 0 0 12px rgba(248, 81, 73, 0.15);
  }

  .event-card.fell {
    border-left-color: #e3b341;
    background: rgba(40, 32, 12, 0.65);
  }

  .event-card.crit {
    border-left-color: #bc8cff;
    background: rgba(35, 18, 48, 0.7);
  }

  .card-main {
    display: flex;
    align-items: center;
    gap: 7px;
    font-size: 11px;
  }

  .badge {
    font-size: 9.5px;
    font-weight: bold;
    padding: 1px 5px;
    border-radius: 3px;
    white-space: nowrap;
    text-transform: uppercase;
  }

  .badge.hit {
    background: rgba(63, 185, 80, 0.2);
    color: #3fb950;
    border: 1px solid rgba(63, 185, 80, 0.4);
  }

  .badge.miss {
    background: rgba(139, 148, 158, 0.15);
    color: #8b949e;
    border: 1px solid rgba(139, 148, 158, 0.3);
  }

  .badge.danger {
    background: rgba(248, 81, 73, 0.25);
    color: #ff7b72;
    border: 1px solid rgba(248, 81, 73, 0.5);
    animation: danger-pulse 1.8s infinite;
  }

  .badge.warning {
    background: rgba(227, 179, 65, 0.2);
    color: #e3b341;
    border: 1px solid rgba(227, 179, 65, 0.4);
  }

  .badge.purple {
    background: rgba(188, 140, 255, 0.2);
    color: #d2a8ff;
    border: 1px solid rgba(188, 140, 255, 0.4);
  }

  .badge.info {
    background: rgba(57, 197, 187, 0.2);
    color: #39c5bb;
    border: 1px solid rgba(57, 197, 187, 0.4);
  }

  @keyframes danger-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.65; }
  }

  .summary-line {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    line-height: 1.35;
    word-break: break-word;
  }

  .summary-text {
    color: #c9d1d9;
  }

  .damage-tag {
    color: #f0883e;
    font-weight: bold;
    font-size: 10.5px;
  }

  .details-toggle {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid #30363d;
    color: #8b949e;
    cursor: pointer;
    font-size: 10px;
    padding: 2px 5px;
    border-radius: 3px;
    line-height: 1;
  }

  .details-toggle:hover {
    color: #39c5bb;
    border-color: #39c5bb;
  }

  .details-box {
    background: rgba(10, 13, 18, 0.9);
    border: 1px dashed #30363d;
    border-radius: 3px;
    padding: 5px 8px;
    font-size: 10px;
    color: #8b949e;
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-top: 2px;
  }

  .detail-line {
    line-height: 1.4;
  }
</style>

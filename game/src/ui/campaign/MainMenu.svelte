<script lang="ts">
  import { campaign } from '../state/campaign.svelte.js';
  import { t } from '../i18n/index.js';
  import { LANGUAGE_IDS, LANGUAGE_NAMES } from '../i18n/languages.js';
  import { settings } from '../state/settings.svelte.js';

  /**
   * Главное меню — оно же место, где кампания попадает в игру и уходит из неё.
   *
   * Загрузка файла стоит рядом с «продолжить» намеренно: поставка сайтом
   * (решение 2026-09-02) означает, что кампания живёт в IndexedDB и пропадает
   * вместе с очисткой данных сайта. Файл — не резервная копия «на всякий
   * случай», а единственный способ унести кампанию на другую машину, и прятать
   * его в настройки нельзя.
   *
   * Язык — тоже здесь, в шапке, самоназваниями: игрок, не читающий по-русски, видит «English»
   * с первого экрана и не ищет его в «Настройках».
   */

  let fileInput = $state<HTMLInputElement | null>(null);

  async function pick(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file === undefined) return;
    await campaign.importFile(file);
  }
</script>

<div class="menu">
  <div class="panel sheet">
    <div class="panel-header">
      <span>{t('app.menu.title')}</span>
      <span class="head-right">
        <span class="langs" role="radiogroup" aria-label={t('settings.interfaceLanguage')}>
          {#each LANGUAGE_IDS as id (id)}
            <button
              class="lang"
              class:active={settings.interfaceLanguage === id}
              role="radio"
              aria-checked={settings.interfaceLanguage === id}
              onclick={() => settings.setLanguage(id)}
            >
              {LANGUAGE_NAMES[id]}
            </button>
          {/each}
        </span>
        <span class="badge badge-dim">3053</span>
      </span>
    </div>
    <div class="panel-body body">
      <p class="dim sub">{t('app.menu.subtitle')}</p>

      {#if campaign.notice !== null}
        <p class="notice danger">{campaign.notice}</p>
      {/if}
      {#if campaign.storageFailed}
        <p class="notice gold">{t('app.menu.storageFailed')}</p>
      {/if}

      <div class="options">
        {#if campaign.started}
          <button class="opt primary" onclick={() => (campaign.mode = 'campaign')}>
            <span class="opt-title">{t('app.menu.continue')}</span>
            <span class="opt-hint">
              {t('app.menu.continueHint', { day: campaign.day, system: campaign.system.name })}
            </span>
          </button>
        {:else if campaign.hasSave}
          <button class="opt primary" onclick={() => void campaign.continueCampaign()}>
            <span class="opt-title">{t('app.menu.continue')}</span>
            <span class="opt-hint">{t('app.menu.importHint')}</span>
          </button>
        {:else}
          <div class="opt disabled">
            <span class="opt-title dim">{t('app.menu.noSave')}</span>
          </div>
        {/if}

        <button class="opt" onclick={() => { campaign.mode = 'campaign'; campaign.screen = 'setup'; }}>
          <span class="opt-title">{t('app.menu.newCampaign')}</span>
          <span class="opt-hint">{t('app.menu.newCampaignHint')}</span>
        </button>

        <button class="opt" onclick={() => fileInput?.click()}>
          <span class="opt-title">{t('app.menu.importSave')}</span>
          <span class="opt-hint">{t('app.menu.importHint')}</span>
        </button>

        <button class="opt" onclick={() => campaign.openSandbox()}>
          <span class="opt-title">{t('app.menu.sandbox')}</span>
          <span class="opt-hint">{t('app.menu.sandboxHint')}</span>
        </button>

        <button class="opt" onclick={() => campaign.openSettings()}>
          <span class="opt-title">{t('app.menu.settings')}</span>
          <span class="opt-hint">{t('app.menu.settingsHint')}</span>
        </button>

        <a class="opt" href="./wiki.html" target="_blank" rel="noopener noreferrer">
          <span class="opt-title">{t('app.menu.wiki')}</span>
          <span class="opt-hint">{t('app.menu.wikiHint')}</span>
        </a>
      </div>

      <input
        bind:this={fileInput}
        class="hidden-input"
        type="file"
        accept="application/json,.json"
        onchange={(e) => void pick(e)}
      />
    </div>
  </div>
</div>

<style>
  .menu {
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 24px;
  }
  .sheet {
    width: 560px;
    max-width: 100%;
  }
  .head-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .langs {
    display: inline-flex;
    gap: 3px;
  }
  .lang {
    padding: 2px 8px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    border-radius: 2px;
    color: var(--color-text-dim);
    font: inherit;
    font-size: 11px;
    letter-spacing: 0.5px;
    text-transform: none;
    cursor: pointer;
  }
  .lang:hover {
    border-color: var(--color-border-active);
    color: #fff;
  }
  .lang.active {
    border-color: var(--color-accent);
    color: var(--color-accent);
  }
  .body {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .sub {
    margin: 0;
    font-size: 11.5px;
  }
  .notice {
    margin: 0;
    padding: 9px 11px;
    border: 1px solid currentColor;
    border-radius: 2px;
    font-size: 11px;
    line-height: 1.5;
  }
  .options {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .opt {
    display: flex;
    flex-direction: column;
    gap: 3px;
    padding: 12px 14px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    border-radius: 2px;
    color: inherit;
    font: inherit;
    text-align: left;
    text-decoration: none;
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      background 0.15s ease;
  }
  .opt:hover:not(.disabled) {
    border-color: var(--color-border-active);
    background: rgba(255, 255, 255, 0.03);
  }
  .opt.primary {
    border-color: var(--color-accent);
    background: rgba(57, 197, 187, 0.1);
  }
  .opt.disabled {
    cursor: default;
    opacity: 0.6;
  }
  .opt-title {
    font-family: var(--font-display);
    font-size: 15px;
    font-weight: 700;
    letter-spacing: 1.2px;
    text-transform: uppercase;
  }
  .opt-hint {
    font-size: 10.5px;
    color: var(--color-text-dim);
  }
  .hidden-input {
    display: none;
  }
</style>

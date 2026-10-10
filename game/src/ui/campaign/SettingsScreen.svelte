<script lang="ts">
  import { tr } from '../../core/log/index.js';
  import { campaign } from '../state/campaign.svelte.js';
  import { settings } from '../state/settings.svelte.js';
  import { t } from '../i18n/index.js';
  import { LANGUAGE_IDS, LANGUAGE_NAMES } from '../i18n/languages.js';
  import { version } from '../../../package.json';

  /**
   * Настройки игрока (шаг 52): два языка по отдельности.
   *
   * Язык интерфейса — все подписи, журнал боя и события. Язык оружия и систем —
   * названия оружия, оборудования и боезапаса: термины BattleTech канонически
   * английские, и держать их по-английски при русском интерфейсе — законный
   * выбор (решение пользователя 2026-09-15). Названия языков в кнопках — их
   * самоназвания и не переводятся: выбравший незнакомый язык найдёт дорогу назад.
   *
   * Строки развёртки (CRT) переехали сюда из шапки кампании: включают их раз, а
   * место в шапке нужно каждый день.
   */
</script>

<div class="settings">
  <div class="panel sheet">
    <div class="panel-header">
      <span>{t('settings.title')}</span>
    </div>
    <div class="panel-body body">
      <section class="group">
        <div class="group-title">{t('settings.interfaceLanguage')}</div>
        <p class="dim hint">{t('settings.interfaceLanguageHint')}</p>
        <div class="choices" role="radiogroup" aria-label={t('settings.interfaceLanguage')}>
          {#each LANGUAGE_IDS as id (id)}
            <button
              class="choice"
              class:active={settings.interfaceLanguage === id}
              role="radio"
              aria-checked={settings.interfaceLanguage === id}
              onclick={() => settings.setInterfaceLanguage(id)}
            >
              {LANGUAGE_NAMES[id]}
            </button>
          {/each}
        </div>
      </section>

      <section class="group">
        <div class="group-title">{t('settings.termsLanguage')}</div>
        <p class="dim hint">{t('settings.termsLanguageHint')}</p>
        <div class="choices" role="radiogroup" aria-label={t('settings.termsLanguage')}>
          {#each LANGUAGE_IDS as id (id)}
            <button
              class="choice"
              class:active={settings.termsLanguage === id}
              role="radio"
              aria-checked={settings.termsLanguage === id}
              onclick={() => settings.setTermsLanguage(id)}
            >
              {LANGUAGE_NAMES[id]}
            </button>
          {/each}
        </div>
        <p class="example">
          {t('settings.termsExample', { weapon: tr('weapon.is_ml'), equipment: tr('equipment.is_dhs') })}
        </p>
      </section>

      <section class="group">
        <div class="group-title">{t('settings.screen')}</div>
        <p class="dim hint">{t('settings.crtHint')}</p>
        <div class="choices" role="radiogroup" aria-label={t('settings.screen')}>
          {#each [false, true] as on (on)}
            <button
              class="choice"
              class:active={campaign.crt === on}
              role="radio"
              aria-checked={campaign.crt === on}
              onclick={() => (campaign.crt = on)}
            >
              {t(on ? 'settings.crtOn' : 'settings.crtOff')}
            </button>
          {/each}
        </div>
      </section>

      <p class="dim note">{t('settings.draftNote')}</p>

      <button class="btn btn-primary back" onclick={() => campaign.closeSettings()}>
        {t('common.back')}
      </button>
    </div>
  </div>
  <span class="version">{t('settings.version', { version })}</span>
</div>

<style>
  .settings {
    position: relative;
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
  .body {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }
  .group {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .group-title {
    font-family: var(--font-display);
    font-size: 14px;
    font-weight: 700;
    letter-spacing: 1.2px;
    text-transform: uppercase;
  }
  .hint,
  .note {
    margin: 0;
    font-size: 11px;
    line-height: 1.5;
  }
  .choices {
    display: flex;
    gap: 8px;
  }
  .choice {
    flex: 1;
    padding: 10px 12px;
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    border-radius: 2px;
    color: inherit;
    font: inherit;
    cursor: pointer;
    transition:
      border-color 0.15s ease,
      background 0.15s ease;
  }
  .choice:hover {
    border-color: var(--color-border-active);
  }
  .choice.active {
    border-color: var(--color-accent);
    background: rgba(57, 197, 187, 0.1);
  }
  .example {
    margin: 0;
    font-size: 11px;
    color: var(--color-accent);
  }
  .back {
    align-self: flex-start;
  }
  .version {
    position: absolute;
    right: 12px;
    bottom: 8px;
    font-size: 11px;
    color: var(--color-text-dim);
  }
</style>

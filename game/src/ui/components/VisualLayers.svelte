<script lang="ts">
  import { battle } from '../state/battle.svelte.js';
  import { THEME_NAMES } from '../../render/biomePalette.js';
  import { hasKey, t } from '../i18n/index.js';

  const LAYER_KEYS: readonly (keyof typeof battle.layers)[] = [
    'grid',
    'numbers',
    'elevations',
    'organicForest',
    'treesDetail',
    'weaponRanges',
    'movementTrails',
    'waterAnim',
    'fogAnim',
  ];

  /** Схема без подписи в словаре показывается своим id. */
  function themeName(theme: string): string {
    const key = `battle.layers.themeName.${theme}`;
    return hasKey(key) ? t(key) : theme;
  }
</script>

<div class="panel-section">
  <h4 class="section-title">{t('battle.layers.title')}</h4>
  <div class="toggle-list">
    {#each LAYER_KEYS as key (key)}
      <label class="toggle-item">
        <input type="checkbox" bind:checked={battle.layers[key]} />
        <span>{t(`battle.layers.item.${key}`)}</span>
      </label>
    {/each}
  </div>
</div>

<div class="panel-section">
  <h4 class="section-title">{t('battle.layers.styleTitle')}</h4>
  <div class="control-row">
    <label for="theme-select">{t('battle.layers.theme')}</label>
    <select id="theme-select" class="select-field" bind:value={battle.mapTheme}>
      {#each THEME_NAMES as theme (theme)}
        <option value={theme}>{themeName(theme)}</option>
      {/each}
    </select>
  </div>
  <p class="hint">{t('battle.layers.themeHint')}</p>
</div>

<style>
  .panel-section {
    padding: 12px; background: #161b22;
    border: 1px solid #30363d; border-radius: 6px;
  }
  .section-title {
    margin: 0 0 10px 0; font-size: 11px; color: #8b949e;
    letter-spacing: 0.5px; font-family: monospace;
  }
  .toggle-list { display: flex; flex-direction: column; gap: 7px; }
  .toggle-item {
    display: flex; align-items: center; gap: 8px;
    font-size: 10.5px; color: #c9d1d9; font-family: monospace; cursor: pointer;
  }
  .toggle-item input { accent-color: #39c5bb; }
  label { font-size: 10.5px; color: #8b949e; font-family: monospace; display: block; margin-bottom: 4px; }
  .select-field {
    width: 100%; background: #0d1117; border: 1px solid #30363d;
    color: #e6edf3; padding: 5px 6px; border-radius: 4px;
    font-family: monospace; font-size: 11px;
  }
  .hint {
    margin: 8px 0 0; font-family: monospace; font-size: 9.5px;
    color: #6e7681; line-height: 1.45;
  }
</style>

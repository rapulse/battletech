<script lang="ts">
  import { battle } from '../state/battle.svelte.js';
  import { BIOME_LIST } from '../../core/data/tables.js';
  import { MAP_SIZES } from '../../core/map/index.js';
  import { hasKey, t } from '../i18n/index.js';

  let { onGenerate }: { onGenerate: () => void } = $props();

  /** Описание биома для списка; биом без описания показывается своим id. */
  function biomeText(id: string): string {
    const key = `battle.generator.biomeText.${id}`;
    return hasKey(key) ? t(key) : id;
  }

  const SIZES: { label: string; value: number }[] = (['duel', 'lance', 'company', 'operational'] as const).map(
    (size) => ({ label: t(`battle.generator.sizeName.${size}`, { n: MAP_SIZES[size] }), value: MAP_SIZES[size] }),
  );

  function randomSeed() {
    // Одно из двух мест в интерфейсе, где случайность уместна (второе —
    // `App.svelte:regenerate()`, тот же диапазон для сида боя): игрок просит
    // новый сид карты. Дальше карта детерминирована этим числом целиком.
    battle.options.seed = Math.floor(Math.random() * 900_000) + 100_000;
    onGenerate();
  }
</script>

<div class="panel-section">
  <h4 class="section-title">{t('battle.generator.title')}</h4>

  <div class="control-row">
    <label for="gen-size">{t('battle.generator.size')}</label>
    <select id="gen-size" class="select-field" bind:value={battle.options.size}>
      {#each SIZES as s (s.value)}
        <option value={s.value}>{s.label}</option>
      {/each}
    </select>
  </div>

  <div class="control-row">
    <label for="gen-biome">{t('battle.generator.biome')}</label>
    <select id="gen-biome" class="select-field" bind:value={battle.options.biome}>
      {#each BIOME_LIST as b (b.id)}
        <option value={b.id}>{biomeText(b.id)}</option>
      {/each}
    </select>
  </div>

  <div class="control-row">
    <label for="gen-forest">{t('battle.generator.forest')}</label>
    <div class="range-wrap">
      <input id="gen-forest" type="range" min="0" max="1" step="0.05" bind:value={battle.options.forestDensity} />
      <span class="range-num">{Math.round(battle.options.forestDensity * 100)}%</span>
    </div>
  </div>

  <div class="control-row">
    <label for="gen-rough">{t('battle.generator.roughness')}</label>
    <div class="range-wrap">
      <input id="gen-rough" type="range" min="0" max="1" step="0.05" bind:value={battle.options.roughness} />
      <span class="range-num">{Math.round(battle.options.roughness * 100)}%</span>
    </div>
  </div>

  <div class="control-row inline">
    <label for="gen-river">{t('battle.generator.rivers')}</label>
    <input id="gen-river" type="checkbox" bind:checked={battle.options.rivers} />
  </div>
  <div class="control-row inline">
    <label for="gen-lake">{t('battle.generator.lakes')}</label>
    <input id="gen-lake" type="checkbox" bind:checked={battle.options.lakes} />
  </div>
  <div class="control-row inline">
    <label for="gen-road">{t('battle.generator.roads')}</label>
    <input id="gen-road" type="checkbox" bind:checked={battle.options.roads} />
  </div>
  <div class="control-row inline">
    <label for="gen-ruins">{t('battle.generator.ruins')}</label>
    <input id="gen-ruins" type="checkbox" bind:checked={battle.options.ruins} />
  </div>

  <div class="control-row">
    <label for="gen-seed">{t('battle.generator.seed')}</label>
    <div class="input-with-btn">
      <input id="gen-seed" type="number" class="text-input" bind:value={battle.options.seed} />
      <button class="btn-sm" title={t('battle.generator.randomSeed')} onclick={randomSeed}>🎲</button>
    </div>
  </div>

  <button class="btn-primary full" onclick={onGenerate}>{t('battle.generator.regenerate')}</button>
</div>

<div class="panel-section">
  <h4 class="section-title">{t('battle.generator.metricsTitle')}</h4>
  <!--
    Числа генератора показаны игроку намеренно. Карта — первый объект в
    проекте, у которого нет «правильного» значения, и единственный способ
    отличить хорошую от плохой — посмотреть на её показатели (шаг 9a, часть E).
  -->
  <div class="metric-row"><span>{t('battle.generator.metricCover')}</span><b>{(battle.metrics.coverShare * 100).toFixed(0)} %</b></div>
  <div class="metric-row"><span>{t('battle.generator.metricPatch')}</span><b>{battle.metrics.avgPatchSize.toFixed(1)} / {battle.metrics.medianPatchSize.toFixed(0)}</b></div>
  <div class="metric-row"><span>{t('battle.generator.metricLongSight')}</span><b>{(battle.metrics.longSightShare * 100).toFixed(0)} %</b></div>
  <div class="metric-row"><span>{t('battle.generator.metricWater')}</span><b>{(battle.metrics.waterShare * 100).toFixed(0)} %</b></div>
  <div class="metric-row"><span>{t('battle.generator.metricPath')}</span><b>{battle.metrics.startPathCost ?? '—'} MP</b></div>
  <div class="metric-row" class:bad={battle.metrics.unreachable > 0}>
    <span>{t('battle.generator.metricUnreachable')}</span><b>{battle.metrics.unreachable}</b>
  </div>
  <div class="metric-row"><span>{t('battle.generator.metricRepairs')}</span><b>{battle.metrics.repairs}</b></div>
</div>

<style>
  .panel-section {
    padding: 12px;
    background: #161b22;
    border: 1px solid #30363d;
    border-radius: 6px;
  }
  .section-title {
    margin: 0 0 10px 0;
    font-size: 11px;
    color: #8b949e;
    letter-spacing: 0.5px;
    font-family: monospace;
  }
  .control-row { margin-bottom: 10px; }
  .control-row.inline {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 6px;
  }
  label { display: block; font-size: 10.5px; color: #8b949e; margin-bottom: 4px; font-family: monospace; }
  .control-row.inline label { margin-bottom: 0; }
  .select-field, .text-input {
    width: 100%;
    background: #0d1117;
    border: 1px solid #30363d;
    color: #e6edf3;
    padding: 5px 6px;
    border-radius: 4px;
    font-family: monospace;
    font-size: 11px;
  }
  .range-wrap { display: flex; align-items: center; gap: 8px; }
  .range-wrap input { flex: 1; accent-color: #39c5bb; }
  .range-num { font-family: monospace; font-size: 10.5px; color: #e6edf3; width: 38px; text-align: right; }
  .input-with-btn { display: flex; gap: 4px; }
  .btn-sm {
    background: #21262d; border: 1px solid #30363d; color: #e6edf3;
    border-radius: 4px; padding: 0 8px; cursor: pointer;
  }
  .btn-sm:hover { border-color: #39c5bb; }
  .btn-primary.full {
    width: 100%; margin-top: 6px; padding: 8px;
    background: #238636; border: 1px solid #2ea043; color: #fff;
    border-radius: 4px; font-family: monospace; font-weight: bold; font-size: 11px;
    cursor: pointer;
  }
  .btn-primary.full:hover { background: #2ea043; }
  input[type='checkbox'] { accent-color: #39c5bb; }
  .metric-row {
    display: flex; justify-content: space-between;
    font-family: monospace; font-size: 10.5px; color: #8b949e;
    padding: 2px 0;
  }
  .metric-row b { color: #e6edf3; }
  .metric-row.bad b { color: #f85149; }
</style>

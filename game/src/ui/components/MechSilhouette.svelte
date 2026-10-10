<script lang="ts">
  import type { Snippet } from 'svelte';
  import { CHASSIS_CATALOG } from '../../core/data/index.js';
  import { t } from '../i18n/index.js';
  import { mechArtFullUrl, mechArtThumbUrl, paintOfFaction, pickMechArt } from './mechArt.js';

  export interface SilhouetteActionsContext {
    readonly onPreview: (paint: string | null) => void;
  }

  /**
   * Портрет машины — рисунок шасси в раскраске фракции (шаги 48, 50).
   *
   * ЧТО ПОКАЗЫВАЕТ, а что нет. Картинка говорит про КЛАСС ШАССИ: техбаза,
   * локомоция, весовая полоса — и про то, чьи цвета машина носит. Она НЕ
   * показывает сборку — ни вооружения, ни брони, ни повреждений, — и не
   * меняется при переоборудовании. Это прямое следствие решения 2026-09-01
   * («растр только для стационарного, что не несёт состояния»): один статичный
   * кадр не покажет оторванную руку и три стадии ремонта поверх 850 шасси,
   * поэтому куклу зон и иконки оружия по-прежнему рисует код (`Paperdoll.svelte`).
   *
   * КАК ВЫБИРАЕТСЯ КАРТИНКА — в `mechArt.ts`: группа по техбазе и локомоции,
   * весовой класс по тоннажу, дальше из пула класса выбирает хэш кода шасси.
   * Раскраску решает вызывающий (`paintOfRecord`, `paintOfFaction`): компонент
   * не знает, чья это машина. Здесь остаётся показ.
   *
   * ДВА РАЗМЕРА. Списки берут квадрат 256 px (~17 КБ): машина крупнее, срезаны
   * ступни и пол ангара. Крупный показ по щелчку берёт отдельный файл во весь
   * рост. Оба грузятся лениво — браузер забирает только то, что на экране.
   */
  let {
    chassisCode,
    name,
    paint,
    width = 54,
    bordered = true,
    faction = true,
    zoomable = false,
    actions,
  }: {
    chassisCode: string;
    name?: string;
    /** Id раскраски из `data/paints.json`. Не задана — раскраска роты игрока. */
    paint?: string;
    width?: number | string;
    bordered?: boolean;
    /** Метка техбазы цветом рамки. Рисуется кодом, а не ищется в картинке. */
    faction?: boolean;
    /** Щелчок открывает картинку крупно. Включается там, где есть что разглядывать. */
    zoomable?: boolean;
    /**
     * Действия под крупным показом. Компонент общий — рынок, ангар, бой, — и
     * знать о перекраске не должен: мехлаб кладёт её сюда сам (шаг 50).
     */
    actions?: Snippet<[SilhouetteActionsContext]>;
  } = $props();

  const entry = $derived(CHASSIS_CATALOG.get(chassisCode) ?? null);
  const picked = $derived(pickMechArt(chassisCode));
  const wantPaint = $derived(paint ?? paintOfFaction(undefined));
  const isClan = $derived(entry?.techBase === 'clan');
  const dim = $derived(typeof width === 'number' ? `${width}px` : width);
  const displayName = $derived(name ?? entry?.canonName ?? entry?.code ?? chassisCode);

  let zoomed = $state(false);
  let previewPaint = $state<string | null>(null);
  const activePaint = $derived(previewPaint ?? wantPaint);
  const isPreview = $derived(previewPaint !== null && previewPaint !== wantPaint);

  function closeZoom(): void {
    zoomed = false;
    previewPaint = null;
  }

  $effect(() => {
    void chassisCode;
    void paint;
    previewPaint = null;
  });
</script>

<svelte:window
  onkeydown={(e) => {
    if (e.key === 'Escape' && zoomed) closeZoom();
  }}
/>

{#snippet thumb(src: string)}
  <span class="atlas" class:bordered style:width={dim}>
    <img {src} alt="" loading="lazy" decoding="async" />
  </span>
{/snippet}

{#if picked === null}
  <!--
    Пусто, а не сломано. Рисунка для этой группы может ещё не быть или код шасси
    прийти из сохранения старого каталога — вёрстка в обоих случаях обязана
    остаться на месте.
  -->
  <div class="silhouette empty" class:bordered style:width={dim}></div>
{:else if zoomable}
  <button
    type="button"
    class="silhouette zoom-trigger"
    class:clan={faction && isClan}
    class:sphere={faction && !isClan}
    title={t('mechlab.silhouetteZoom')}
    onclick={() => (zoomed = true)}
  >
    {@render thumb(mechArtThumbUrl(picked, wantPaint))}
  </button>
{:else}
  <div class="silhouette" class:clan={faction && isClan} class:sphere={faction && !isClan}>
    {@render thumb(mechArtThumbUrl(picked, wantPaint))}
  </div>
{/if}

{#if zoomed && picked !== null && entry !== null}
  <!--
    Крупный показ. Щелчок по фону и Escape закрывают — тот же приём, что у
    развёртки в контрактах, и те же классы `.modal-backdrop` / `.modal` из
    `terminal.css`: новых сущностей не заводим.
  -->
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={(e) => {
      if (e.target === e.currentTarget) closeZoom();
    }}
  >
    <div class="modal zoom" role="dialog" aria-modal="true" tabindex="-1">
      <div class="panel-header">
        <span class="title">
          <span class="glow-cyan">{displayName}</span>
          {#if displayName !== entry.code}
            <span class="badge badge-dim">{entry.code}</span>
          {/if}
          <span class="badge badge-dim">{t(`weightClass.${picked.wanted}`)}</span>
          <span class="badge badge-dim">{entry.tonnage} {t('common.tons')}</span>
          <span class="badge" class:badge-cyan={isClan} class:badge-dim={!isClan}>
            {t(isClan ? 'common.techClan' : 'common.techSphere')}
          </span>
        </span>
        <button class="btn btn-sm" onclick={closeZoom}>{t('common.close')}</button>
      </div>
      <div class="zoom-body">
        <div class="zoom-frame">
          <img src={mechArtFullUrl(picked, activePaint)} alt="" class:preview-active={isPreview} />
          {#if isPreview}
            <span class="preview-badge badge badge-gold">{t('mechlab.repaint.preview')}</span>
          {/if}
        </div>
      </div>
      {#if actions !== undefined}
        <div class="zoom-actions">
          {@render actions({
            onPreview: (p) => {
              previewPaint = p;
            },
          })}
        </div>
      {/if}
      <p class="zoom-note dim tiny">{t('mechlab.silhouetteNote')}</p>
    </div>
  </div>
{/if}

<style>
  .silhouette {
    display: inline-block;
    vertical-align: middle;
    line-height: 0;
  }

  /* Рамка и тень — те же, что у ячейки атласа (`AtlasImage`): один регистр
     портретов на весь интерфейс, пилоты и машины рядом не спорят. Углы прямые. */
  .atlas {
    position: relative;
    display: inline-block;
    vertical-align: middle;
    overflow: hidden;
    flex-shrink: 0;
    aspect-ratio: 1;
    background: var(--color-bg);
    border-radius: 2px;
  }
  .atlas.bordered {
    border: 1px solid var(--color-border);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
  }
  .atlas img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .zoom-trigger {
    padding: 0;
    border: 0;
    background: none;
    cursor: zoom-in;
  }
  .zoom-trigger:hover .atlas.bordered {
    border-color: var(--color-border-active);
  }
  .zoom-trigger:focus-visible .atlas {
    outline: 1px solid var(--color-accent);
    outline-offset: 2px;
  }

  .empty {
    aspect-ratio: 1;
    background: var(--color-panel-sub);
  }
  .empty.bordered {
    border: 1px solid var(--color-border);
  }

  .modal.zoom {
    max-width: min(560px, 92vw);
    line-height: 1.4;
  }
  .zoom-body {
    display: flex;
    justify-content: center;
    padding: 10px;
    min-height: 0;
  }
  .zoom-frame {
    position: relative;
    display: inline-flex;
    justify-content: center;
    max-height: min(72vh, 640px);
    max-width: 100%;
    line-height: 0;
  }
  .zoom-frame img {
    display: block;
    /* Высота ведёт, а не ширина: портрет 3:4 обязан целиком влезать в невысокое
       окно, иначе машине срезает ноги — а ноги половина силуэта. */
    max-height: min(72vh, 640px);
    max-width: 100%;
    width: auto;
    object-fit: contain;
    border: 1px solid var(--color-border);
    transition: border-color 0.15s ease;
  }
  .zoom-frame img.preview-active {
    border-color: var(--color-gold);
  }
  .preview-badge {
    position: absolute;
    top: 10px;
    left: 10px;
    z-index: 2;
    pointer-events: none;
    background: rgba(10, 14, 20, 0.88);
    border: 1px solid var(--color-gold);
    color: var(--color-gold);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.65);
    text-shadow: 0 0 6px rgba(227, 179, 65, 0.4);
  }
  .title {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    min-width: 0;
    line-height: 1.2;
  }
  .zoom-actions {
    padding: 0 14px 8px;
  }
  .zoom-note {
    padding: 4px 14px 10px;
    margin: 0;
    text-align: center;
    font-size: 11px;
    line-height: 1.4;
    color: var(--color-text-dim);
  }
</style>

<script lang="ts">
  import { onMount } from 'svelte';
  import { battle, type BeamFxEvent, type TextFxEvent } from '../state/battle.svelte.js';
  import { TacticalRenderer, type RenderScene, type RenderUnit } from '../../render/tacticalRenderer.js';
  import { hexToPixel, pixelToHex } from '../../render/hexView.js';
  import { drawLosProfile, type LosProfileVerdict } from '../../render/losProfile.js';
  import { biomePalette } from '../../render/biomePalette.js';
  import { ContactLevel, Phase } from '../../core/model/index.js';
  import TacticalRadar from './TacticalRadar.svelte';
  import TacticalTicker from './TacticalTicker.svelte';
  import { t, tParts } from '../i18n/index.js';
  import { renderLabels } from './renderLabels.js';

  // Надпись промаха над целью. Берётся здесь, а не в очереди эффектов: там `t` — время кадра.
  const MISS_LABEL = t('battle.fx.miss');

  let canvasElem = $state<HTMLCanvasElement | null>(null);
  let container = $state<HTMLDivElement | null>(null);
  let losCanvas = $state<HTMLCanvasElement | null>(null);
  let radar = $state<ReturnType<typeof TacticalRadar> | null>(null);
  let renderer: TacticalRenderer | null = null;

  let verdict = $state<LosProfileVerdict | null>(null);

  let dragging = false;
  let moved = false;
  let dragFrom = { x: 0, y: 0 };

  export function centerMap(): void {
    if (renderer !== null) renderer.centerMap(battle.mapView);
  }

  function resize(): void {
    if (container === null || renderer === null) return;
    renderer.resize(container.clientWidth, container.clientHeight);
  }

  function zoomBy(factor: number): void {
    if (renderer === null) return;
    const cam = renderer.camera;
    const next = Math.max(cam.minZoom, Math.min(cam.maxZoom, cam.zoom * factor));
    const cx = renderer.width / 2;
    const cy = renderer.height / 2;
    const before = renderer.screenToWorld(cx, cy);
    cam.zoom = next;
    const after = renderer.screenToWorld(cx, cy);
    cam.x += (after.x - before.x) * next;
    cam.y += (after.y - before.y) * next;
  }

  function hexUnder(e: MouseEvent): { col: number; row: number } | null {
    if (renderer === null || canvasElem === null) return null;
    const rect = canvasElem.getBoundingClientRect();
    const world = renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
    const cell = pixelToHex(world.x, world.y);
    const view = battle.mapView;
    if (cell.col < 0 || cell.col >= view.cols || cell.row < 0 || cell.row >= view.rows) return null;
    return cell;
  }

  function onMouseDown(e: MouseEvent): void {
    if (e.button !== 0) return;
    dragging = true;
    moved = false;
    dragFrom = { x: e.clientX, y: e.clientY };
  }

  /**
   * Разбор прицела уезжает ВНИЗ, когда встал бы поверх цели (2026-09-16).
   *
   * Панель приколочена к верхнему правому углу поля, и на маленьком экране это
   * ломало игру, а не только вид: у неё не был выключен приём мыши, поэтому
   * робот под ней переставал ловить курсор — по цели нельзя было ни навести, ни
   * выстрелить, пока карту не сдвинут. Приём мыши выключен отдельно (CSS), а
   * здесь решается вторая половина: видеть попадания.
   *
   * Решает ПЕРЕСЕЧЕНИЕ, а не «цель в верхней половине»: панель не должна
   * прыгать, когда перекрытия нет. Проверяется всегда прямоугольник ВЕРХНЕГО
   * положения — тогда решение не зависит от того, где панель стоит сейчас, и
   * она не мечется между двумя местами.
   */
  let aimW = $state(0);
  let aimH = $state(0);
  let aimLow = $state(false);
  /**
   * Высота панели линии огня: внизу они стоят в одном месте, и разбор прицела
   * обязан вставать НАД ней, а не поверх. Меряется, а не пишется числом, —
   * внутри неё канвас профиля, и его высота меняется вместе с разметкой.
   */
  let losH = $state(0);

  /**
   * Запас сверху и снизу от прямоугольника панели, в пикселях экрана.
   *
   * Курсор стоит на гексе, а спрайт машины выше и крупнее его: без запаса
   * панель уходила бы вниз, только когда накрыла робота уже наполовину.
   */
  const AIM_CLEARANCE = 64;

  function updateAimSide(e: MouseEvent): void {
    if (container === null || aimW === 0) return;
    const r = container.getBoundingClientRect();
    const left = r.right - 16 - aimW - AIM_CLEARANCE;
    const top = r.top + 16 - AIM_CLEARANCE;
    const bottom = r.top + 16 + aimH + AIM_CLEARANCE;
    aimLow = e.clientX >= left && e.clientY >= top && e.clientY <= bottom;
  }

  function onMouseMove(e: MouseEvent): void {
    if (renderer === null) return;
    updateAimSide(e);
    if (dragging) {
      const dx = e.clientX - dragFrom.x;
      const dy = e.clientY - dragFrom.y;
      if (Math.hypot(dx, dy) > 3) moved = true;
      renderer.camera.x += dx;
      renderer.camera.y += dy;
      dragFrom = { x: e.clientX, y: e.clientY };
    }
    battle.hover = hexUnder(e);
  }

  function onMouseUp(e: MouseEvent): void {
    if (dragging && !moved && e.button === 0) {
      const cell = hexUnder(e);
      if (cell !== null) battle.clickHex(cell.col, cell.row);
    }
    dragging = false;
  }

  function onContextMenu(e: MouseEvent): void {
    e.preventDefault();
    if (renderer === null || canvasElem === null) return;
    const cell = hexUnder(e);
    const rect = canvasElem.getBoundingClientRect();
    const world = renderer.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);

    // 1. Поворот выбранной машины в сторону курсора (команда turn):
    const unit = battle.selected;
    if (unit !== undefined && unit.side === battle.viewer && !unit.destroyed) {
      const scene = battle.scene;
      const self = scene.units.find((u) => u.id === unit.id);
      if (self !== undefined) {
        const centre = hexToPixel(self.col, self.row);
        battle.turnTo(Math.atan2(world.y - centre.y, world.x - centre.x));
      }
    }

    // 2. Если кликнули правой кнопкой по роботу противника — сразу открываем инспекцию / информацию о нём:
    if (cell !== null) {
      const targetUnit = battle.unitAt(cell.col, cell.row);
      if (
        targetUnit !== undefined &&
        targetUnit.side !== battle.viewer &&
        battle.contactOf(targetUnit) !== ContactLevel.None
      ) {
        battle.select(targetUnit.id);
      }
    }
  }

  function onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (renderer === null || canvasElem === null) return;
    const rect = canvasElem.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const cam = renderer.camera;
    const next = Math.max(cam.minZoom, Math.min(cam.maxZoom, cam.zoom * (e.deltaY < 0 ? 1.12 : 0.89)));
    const before = renderer.screenToWorld(mx, my);
    cam.zoom = next;
    const after = renderer.screenToWorld(mx, my);
    cam.x += (after.x - before.x) * next;
    cam.y += (after.y - before.y) * next;
  }

  function onKeyDown(e: KeyboardEvent): void {
    const target = e.target as HTMLElement | null;
    if (target !== null && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return;

    if (e.code === 'Escape') {
      e.preventDefault();
      // 1. Если выбрана вражеская цель для инспекции — возвращаемся к своему роботу:
      const current = battle.selected;
      if (current !== undefined && current.side !== battle.viewer) {
        battle.selectFirstOwn();
      }
      // 2. Если открыт режим LOS — закрываем его и переходим в режим движения:
      if (battle.mode === 'los') {
        battle.setMode('move');
      }
      return;
    }
    if (e.code === 'KeyM') {
      e.preventDefault();
      battle.minimapCollapsed = !battle.minimapCollapsed;
      return;
    }
    if (e.code === 'Tab') {
      e.preventDefault();
      const own = battle.ownUnits;
      if (own.length === 0) return;
      const i = own.findIndex((u) => u.id === battle.selectedId);
      const next = own[(i + (e.shiftKey ? -1 : 1) + own.length) % own.length];
      if (next !== undefined) {
        battle.select(next.id);
        focusSelected();
      }
      return;
    }
    if (e.code === 'KeyQ' || e.code === 'ArrowLeft') battle.rotateBy(-1);
    else if (e.code === 'KeyE' || e.code === 'ArrowRight') battle.rotateBy(1);
    else if (e.code === 'Space') {
      e.preventDefault();
      void battle.endPhase();
    }
  }

  function focusSelected(): void {
    if (renderer === null) return;
    const unit = battle.scene.selectedUnit;
    if (unit !== null) renderer.focusOnHex(unit.col, unit.row);
  }

  onMount(() => {
    let raf = 0;
    let frames = 0;
    let last = performance.now();

    // Очередь показа эффектов: симуляция считает ход мгновенно, и без неё пять
    // выстрелов подряд вспыхивают в один кадр. Растягивается только ПОКАЗ,
    // счёт боя не тормозится. Надписи идут через ту же очередь, чтобы не
    // обгонять выстрелы, а последствия выстрела (урон, крит, промах)
    // всплывают в момент попадания — у снаряда и ракет это после полёта.
    const fxQueue: Array<BeamFxEvent | TextFxEvent> = [];
    const pendingTexts: Array<TextFxEvent & { due: number }> = [];
    let lastShotAt = -Infinity;

    /** Шаг между выстрелами сжимается, если очередь копится (быстрый бот, фоновая вкладка). */
    const shotGap = (): number => (fxQueue.length > 12 ? 0 : fxQueue.length > 4 ? 45 : 110);
    const FOLLOWUP_STAGGER_MS = 140;

    // Состояние боя уже посчитано, и уничтоженная цель сразу стала бы обломками —
    // раньше, чем до неё долетят ракеты. Пока по цели есть выстрел в очереди или
    // в полёте, показ держит её целой. Счётчик, а не флаг: залп из нескольких
    // стволов — несколько выстрелов по одной цели.
    const held = new Map<string, number>();
    const releases: Array<{ id: string; due: number }> = [];
    const hold = (id: string, delta: number): void => {
      const n = (held.get(id) ?? 0) + delta;
      if (n > 0) held.set(id, n);
      else held.delete(id);
    };

    /** Сцена, в которой придержанные цели ещё не обломки. */
    const shownScene = (scene: RenderScene): RenderScene => {
      if (held.size === 0) return scene;
      const keep = (u: RenderUnit): RenderUnit => (u.destroyed === true && held.has(u.id) ? { ...u, destroyed: false } : u);
      return {
        ...scene,
        units: scene.units.map(keep),
        selectedUnit: scene.selectedUnit === null ? null : keep(scene.selectedUnit),
      };
    };

    const drainFx = (r: TacticalRenderer, t: number): void => {
      while (fxQueue.length > 0) {
        const head = fxQueue[0]!;
        if (head.type === 'beam' && t - lastShotAt < shotGap()) break;
        fxQueue.shift();
        if (head.type === 'text') {
          r.addFloatingText(head.col, head.row, head.text, head.color);
          continue;
        }
        const impactIn = r.addBeam(head.fromCol, head.fromRow, head.toCol, head.toRow, head.weapon, head.indirect);
        const texts = head.miss
          ? [{ type: 'text', col: head.toCol, row: head.toRow, text: MISS_LABEL, color: '#8b949e' } as const, ...head.followups]
          : head.followups;
        texts.forEach((f, i) => pendingTexts.push({ ...f, due: t + impactIn + i * FOLLOWUP_STAGGER_MS }));
        releases.push({ id: head.targetId, due: t + impactIn });
        lastShotAt = t;
      }
      for (let i = releases.length - 1; i >= 0; i--) {
        const rel = releases[i]!;
        if (rel.due > t) continue;
        releases.splice(i, 1);
        hold(rel.id, -1);
      }
      for (let i = pendingTexts.length - 1; i >= 0; i--) {
        const f = pendingTexts[i]!;
        if (f.due > t) continue;
        pendingTexts.splice(i, 1);
        r.addFloatingText(f.col, f.row, f.text, f.color);
      }
    };

    if (canvasElem === null) return;
    renderer = new TacticalRenderer(canvasElem, renderLabels());
    resize();
    centerMap();
    window.addEventListener('resize', resize);

    const onFX = (fx: BeamFxEvent | TextFxEvent): void => {
      if (fx.type === 'beam') hold(fx.targetId, +1);
      fxQueue.push(fx);
    };
    battle.onFX = onFX;
    // Занят, пока выстрел ждёт очереди или летит (`releases` снимается в момент
    // попадания); всплывающие надписи после попадания ход не держат.
    const fxBusy = (): boolean => fxQueue.length > 0 || releases.length > 0;
    battle.fxBusy = fxBusy;

    const loop = (t: number): void => {
      frames++;
      if (t - last >= 1000) {
        battle.fps = Math.round((frames * 1000) / (t - last));
        frames = 0;
        last = t;
      }

      if (renderer !== null) {
        drainFx(renderer, t);

        renderer.layers = battle.layers;
        renderer.theme = battle.mapTheme;
        const scene = shownScene(battle.scene);
        renderer.render(battle.mapView, scene, t);

        const mini = radar?.getCanvas?.();
        if (mini != null && !battle.minimapCollapsed) {
          renderer.renderMinimap(mini, battle.mapView, scene, t);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(raf);
      if (battle.onFX === onFX) battle.onFX = null;
      if (battle.fxBusy === fxBusy) battle.fxBusy = null;
      fxQueue.length = 0;
      pendingTexts.length = 0;
      releases.length = 0;
      held.clear();
    };
  });

  // Боковой профиль перерисовывается при смене цели, машины или карты в режиме LOS.
  $effect(() => {
    if (battle.mode !== 'los' || losCanvas === null) {
      verdict = null;
      return;
    }
    const shooter = battle.scene.selectedUnit;
    const target = battle.hover;
    verdict = drawLosProfile(
      losCanvas,
      battle.rawMap,
      battle.mapView,
      biomePalette(battle.mapView.biome, battle.mapTheme),
      shooter ? { col: shooter.col, row: shooter.row } : null,
      target,
      renderLabels(),
      battle.scene.units,
    );
  });

  let hovered = $derived(battle.hoverHex);
  let aim = $derived(battle.aim);
  let hoverCost = $derived(battle.hoverCost());

  let targetCursorClass = $derived.by(() => {
    if (battle.phase !== Phase.Attack || aim === null) return '';
    if (!aim.possible) return 'cursor-target-blocked';
    if (aim.band === 'short' || aim.band === 'min') return 'cursor-target-short';
    if (aim.band === 'medium') return 'cursor-target-medium';
    if (aim.band === 'long') return 'cursor-target-long';
    return 'cursor-target-blocked';
  });
</script>

<svelte:window onkeydown={onKeyDown} />

<div class="canvas-container" bind:this={container}>
  <canvas
    bind:this={canvasElem}
    class={targetCursorClass}
    onmousedown={onMouseDown}
    onmousemove={onMouseMove}
    onmouseup={onMouseUp}
    oncontextmenu={onContextMenu}
    onwheel={onWheel}
  ></canvas>

  <div class="map-controls">
    {#if battle.initiative !== null}
      <!-- Не кнопка: пунктир и курсор-вопрос вместо рамки и подсветки. Надпись —
           кто в этом ходу действует первым: «МЫ» или «ПР» (противник). -->
      <div class="initiative" role="status" title={battle.initiative.text} aria-label={battle.initiative.text}>
        {battle.initiative.weFirst ? t('battle.canvas.weFirst') : t('battle.canvas.enemyFirst')}
      </div>
    {/if}
    <button onclick={() => zoomBy(1.2)} title={t('battle.canvas.zoomIn')}>+</button>
    <button onclick={() => { if (renderer !== null) renderer.camera.zoom = 1; centerMap(); }} title={t('battle.canvas.zoomReset')}>⌂</button>
    <button onclick={() => zoomBy(0.83)} title={t('battle.canvas.zoomOut')}>−</button>
    <button
      class="btn-autoturn"
      class:thinking={battle.autoPlaying}
      disabled={battle.botThinking || battle.autoPlaying || battle.finished}
      onclick={() => void battle.playAutoTurn()}
      title={t('battle.canvas.autoTurn')}
    >⚡</button>
    <button onclick={focusSelected} title={t('battle.canvas.focusSelected')}>◎</button>
    <button
      class:active={battle.mode === 'los'}
      onclick={() => battle.setMode(battle.mode === 'los' ? 'move' : 'los')}
      title={t('battle.canvas.losToggle')}
    >📐</button>
  </div>

  <TacticalRadar
    bind:this={radar}
    onJump={(mx, my) => {
      if (renderer === null) return;
      const world = renderer.minimapToWorld(mx, my);
      if (world === null) return;
      renderer.camera.x = renderer.width / 2 - world.x * renderer.camera.zoom;
      renderer.camera.y = renderer.height / 2 - world.y * renderer.camera.zoom;
    }}
  />

  <TacticalTicker />

  <div class="hud">
    <div class="hud-item"><span class="k">{t('battle.canvas.hudHex')}</span> <span class="v">{hovered?.coord ?? '--'}</span></div>
    <div class="hud-item">
      <span class="k">{t('battle.canvas.hudType')}</span>
      <span class="v">{hovered === null ? '--' : battle.terrainLabel(hovered)}</span>
    </div>
    <div class="hud-item"><span class="k">{t('battle.canvas.hudElevation')}</span> <span class="v">{hovered === null ? '--' : `LEVEL ${hovered.elevation}`}</span></div>
    <div class="hud-item">
      <span class="k">{t('battle.canvas.hudMoveCost')}</span>
      <span class="v">{hoverCost === null ? '—' : `${hoverCost} MP`}</span>
    </div>
    <div class="hud-item">
      <span class="k">{t('battle.canvas.hudCover')}</span>
      <span class="v">{hovered === null ? '--' : `+${hovered.cover}`}</span>
    </div>
  </div>

  {#if aim !== null}
    <!--
      Разбор целевого числа ДО броска. Все слагаемые приходят готовыми из
      `toHitBreakdown` — те же самые, что ядро положит в событие выстрела.
      Показ здесь ничего не считает: скрытая арифметика читается игроком как
      несправедливость, а посчитанная дважды — как ошибка (шаг 9, часть B).
    -->
    <div
      class="aim-dock"
      class:low={aimLow}
      style:bottom={aimLow ? `${54 + (losH > 0 ? losH + 8 : 0)}px` : ''}
      bind:clientWidth={aimW}
      bind:clientHeight={aimH}
    >
      <div class="aim-head">
        <span class="aim-title">{t('battle.canvas.aimTarget', { name: aim.targetName })}</span>
        {#if aim.possible}
          <span class="aim-chance">{Math.round(aim.chance * 100)} %</span>
        {:else}
          <span class="aim-chance bad">{aim.reason}</span>
        {/if}
      </div>
      {#if aim.possible}
        <div class="aim-sum">
          {#each tParts('battle.canvas.aimNeed', { need: `${aim.target}+`, base: aim.base }) as p, i (i)}{#if p.name === 'need'}<b>{p.text}</b>{:else}{p.text}{/if}{/each}
          {#each aim.factors as f (f.label)}
            <span class="factor" class:plus={f.amount > 0} class:minus={f.amount < 0}>
              {f.amount >= 0 ? '+' : ''}{f.amount} {f.label}
            </span>
          {/each}
        </div>
        <div class="aim-meta">
          {#each tParts('battle.canvas.aimMeta', { distance: aim.distance, band: aim.band.toUpperCase(), table: aim.zoneTable }) as p, i (i)}{#if p.name === 'table'}<b class:table-alt={aim.zoneTable !== 'Main'}>{p.text}</b>{:else}{p.text}{/if}{/each}
          {#if battle.phase !== Phase.Attack}&bull; <span class="warn">{t('battle.canvas.notAttackPhase')}</span>{/if}
        </div>
      {/if}
    </div>
  {/if}

  {#if battle.mode === 'los'}
    <div class="los-dock" bind:clientHeight={losH}>
      <div class="los-head">
        <div class="los-title">{t('battle.canvas.losTitle')}</div>
        <div class="los-badge {verdict?.badgeKind ?? 'clear'}">{verdict?.badge ?? t('battle.canvas.losMode')}</div>
      </div>
      <div class="los-canvas-wrap">
        <canvas bind:this={losCanvas} width="600" height="118"></canvas>
      </div>
      <div class="los-foot">
        {#if verdict !== null && verdict.range > 0}
          {#each tParts('battle.canvas.losFoot', {
            range: verdict.range,
            cover: verdict.coverMod,
            targetCover: verdict.targetCover,
            advantage: `${verdict.levelAdvantage > 0 ? '+' : ''}${verdict.levelAdvantage}`,
            table: verdict.zoneTable,
          }) as p, i (i)}{#if p.name === 'table'}<b class:table-alt={verdict.zoneTable !== 'Main'}>{p.text}</b>{:else}{p.text}{/if}{/each}
          {#if verdict.partialCover}&bull; {t('battle.canvas.losPartial')}{/if}
        {:else}
          {t('battle.canvas.losPrompt')}
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .canvas-container { flex: 1; position: relative; overflow: hidden; background: #080a0c; }
  canvas { display: block; width: 100%; height: 100%; }
  .map-controls {
    position: absolute; top: 16px; left: 16px;
    display: flex; flex-direction: column; gap: 4px; z-index: 5;
  }
  .map-controls button {
    width: 34px; height: 34px;
    background: rgba(22, 27, 34, 0.85);
    backdrop-filter: blur(6px);
    color: #e6edf3; border: 1px solid #30363d; border-radius: 4px;
    font-size: 15px; font-weight: bold; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: all 0.15s;
  }
  .map-controls button:hover { background: #21262d; border-color: #39c5bb; color: #39c5bb; }
  .map-controls button.active { background: rgba(57, 197, 187, 0.2); border-color: #39c5bb; color: #39c5bb; }
  .initiative {
    width: 34px; height: 34px; margin-bottom: 6px;
    background: rgba(22, 27, 34, 0.85);
    backdrop-filter: blur(6px);
    color: #e6edf3; border: 1px dashed #30363d; border-radius: 4px;
    font-family: monospace; font-size: 11px; font-weight: bold; line-height: 1;
    display: flex; align-items: center; justify-content: center;
    cursor: help; user-select: none;
  }
  .map-controls .btn-autoturn {
    background: rgba(217, 119, 6, 0.16);
    border-color: rgba(217, 119, 6, 0.5);
    color: #f59e0b;
    font-size: 14px;
  }
  .map-controls .btn-autoturn:hover {
    background: rgba(217, 119, 6, 0.35);
    border-color: #f59e0b;
    color: #fbbf24;
    box-shadow: 0 0 10px rgba(245, 158, 11, 0.5);
  }
  .map-controls .btn-autoturn.thinking {
    animation: pulse-auto 0.8s infinite alternate;
    background: rgba(217, 119, 6, 0.45);
    border-color: #f59e0b;
    color: #fff;
  }
  @keyframes pulse-auto {
    from { transform: scale(0.95); box-shadow: 0 0 4px rgba(245, 158, 11, 0.4); }
    to { transform: scale(1.06); box-shadow: 0 0 14px rgba(245, 158, 11, 0.8); }
  }
  .hud {
    position: absolute; bottom: 12px; left: 16px; right: 16px;
    background: rgba(14, 17, 23, 0.9); backdrop-filter: blur(8px);
    border: 1px solid #30363d; border-left: 3px solid #39c5bb; border-radius: 4px;
    padding: 8px 14px; display: flex; gap: 16px;
    font-family: monospace; font-size: 11.5px; z-index: 5;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.6);
    white-space: nowrap; overflow-x: auto;
  }
  .hud-item .k { color: #8b949e; margin-right: 4px; }
  .hud-item .v { color: #fff; font-weight: bold; }
  .aim-dock {
    position: absolute; top: 16px; right: 16px;
    /*
      Панель ТОЛЬКО ЧИТАЕТСЯ — кликать в ней нечего, и ловить мышь она не
      должна. Без этого робот под ней переставал ловить курсор: по цели нельзя
      было ни навести, ни выстрелить, пока карту не сдвинут. У соседней
      `.los-dock` приём мыши выключен с самого начала, у этой забыли.
    */
    pointer-events: none;
    transition: top 0.15s, bottom 0.15s;
    background: rgba(14, 17, 23, 0.93); backdrop-filter: blur(10px);
    border: 1px solid #30363d; border-top: 2px solid #e3b341; border-radius: 6px;
    padding: 8px 12px; z-index: 6; max-width: 460px;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6); font-family: monospace;
  }
  /* Нижнее положение — над полосой сводки, там же, где стоит `.los-dock`. */
  .aim-dock.low { top: auto; bottom: 54px; }
  .aim-head { display: flex; justify-content: space-between; gap: 16px; align-items: baseline; }
  .aim-title { font-size: 11px; color: #e3b341; font-weight: bold; }
  .aim-chance { font-size: 15px; color: #3fb950; font-weight: bold; }
  .aim-chance.bad { font-size: 11px; color: #f85149; }
  .aim-sum { margin-top: 5px; font-size: 10.5px; color: #c9d1d9; line-height: 1.7; }
  .aim-sum b { color: #fff; font-size: 12px; }
  .factor {
    display: inline-block; margin-left: 6px; padding: 1px 5px;
    border-radius: 3px; background: rgba(255, 255, 255, 0.05);
  }
  .factor.plus { color: #f85149; }
  .factor.minus { color: #3fb950; }
  .aim-meta { margin-top: 4px; font-size: 9.5px; color: #8b949e; }
  .warn { color: #e3b341; }
  /* Таблица зон не ровная — часть зон вычеркнута, это видно сразу. */
  .table-alt { color: #3fb950; }

  /* Прицельные курсоры по полосам дальности оружия */
  :global(.cursor-target-short) {
    cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='8' stroke='rgba(0,0,0,0.85)' stroke-width='3.5' fill='none'/%3E%3Cline x1='16' y1='2' x2='16' y2='8' stroke='rgba(0,0,0,0.85)' stroke-width='3.5'/%3E%3Cline x1='16' y1='24' x2='16' y2='30' stroke='rgba(0,0,0,0.85)' stroke-width='3.5'/%3E%3Cline x1='2' y1='16' x2='8' y2='16' stroke='rgba(0,0,0,0.85)' stroke-width='3.5'/%3E%3Cline x1='24' y1='16' x2='30' y2='16' stroke='rgba(0,0,0,0.85)' stroke-width='3.5'/%3E%3Ccircle cx='16' cy='16' r='8' stroke='%233fb950' stroke-width='1.8' fill='none'/%3E%3Ccircle cx='16' cy='16' r='2' fill='%233fb950'/%3E%3Cline x1='16' y1='2' x2='16' y2='8' stroke='%233fb950' stroke-width='1.8' stroke-linecap='round'/%3E%3Cline x1='16' y1='24' x2='16' y2='30' stroke='%233fb950' stroke-width='1.8' stroke-linecap='round'/%3E%3Cline x1='2' y1='16' x2='8' y2='16' stroke='%233fb950' stroke-width='1.8' stroke-linecap='round'/%3E%3Cline x1='24' y1='16' x2='30' y2='16' stroke='%233fb950' stroke-width='1.8' stroke-linecap='round'/%3E%3C/svg%3E") 16 16, crosshair !important;
  }
  :global(.cursor-target-medium) {
    cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='8' stroke='rgba(0,0,0,0.85)' stroke-width='3.5' fill='none'/%3E%3Cline x1='16' y1='2' x2='16' y2='8' stroke='rgba(0,0,0,0.85)' stroke-width='3.5'/%3E%3Cline x1='16' y1='24' x2='16' y2='30' stroke='rgba(0,0,0,0.85)' stroke-width='3.5'/%3E%3Cline x1='2' y1='16' x2='8' y2='16' stroke='rgba(0,0,0,0.85)' stroke-width='3.5'/%3E%3Cline x1='24' y1='16' x2='30' y2='16' stroke='rgba(0,0,0,0.85)' stroke-width='3.5'/%3E%3Ccircle cx='16' cy='16' r='8' stroke='%23e3b341' stroke-width='1.8' fill='none'/%3E%3Ccircle cx='16' cy='16' r='2' fill='%23e3b341'/%3E%3Cline x1='16' y1='2' x2='16' y2='8' stroke='%23e3b341' stroke-width='1.8' stroke-linecap='round'/%3E%3Cline x1='16' y1='24' x2='16' y2='30' stroke='%23e3b341' stroke-width='1.8' stroke-linecap='round'/%3E%3Cline x1='2' y1='16' x2='8' y2='16' stroke='%23e3b341' stroke-width='1.8' stroke-linecap='round'/%3E%3Cline x1='24' y1='16' x2='30' y2='16' stroke='%23e3b341' stroke-width='1.8' stroke-linecap='round'/%3E%3C/svg%3E") 16 16, crosshair !important;
  }
  :global(.cursor-target-long) {
    cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'%3E%3Ccircle cx='16' cy='16' r='8' stroke='rgba(0,0,0,0.85)' stroke-width='3.5' fill='none'/%3E%3Cline x1='16' y1='2' x2='16' y2='8' stroke='rgba(0,0,0,0.85)' stroke-width='3.5'/%3E%3Cline x1='16' y1='24' x2='16' y2='30' stroke='rgba(0,0,0,0.85)' stroke-width='3.5'/%3E%3Cline x1='2' y1='16' x2='8' y2='16' stroke='rgba(0,0,0,0.85)' stroke-width='3.5'/%3E%3Cline x1='24' y1='16' x2='30' y2='16' stroke='rgba(0,0,0,0.85)' stroke-width='3.5'/%3E%3Ccircle cx='16' cy='16' r='8' stroke='%23ff7b72' stroke-width='1.8' fill='none'/%3E%3Ccircle cx='16' cy='16' r='2' fill='%23ff7b72'/%3E%3Cline x1='16' y1='2' x2='16' y2='8' stroke='%23ff7b72' stroke-width='1.8' stroke-linecap='round'/%3E%3Cline x1='16' y1='24' x2='16' y2='30' stroke='%23ff7b72' stroke-width='1.8' stroke-linecap='round'/%3E%3Cline x1='2' y1='16' x2='8' y2='16' stroke='%23ff7b72' stroke-width='1.8' stroke-linecap='round'/%3E%3Cline x1='24' y1='16' x2='30' y2='16' stroke='%23ff7b72' stroke-width='1.8' stroke-linecap='round'/%3E%3C/svg%3E") 16 16, crosshair !important;
  }
  :global(.cursor-target-blocked) {
    cursor: not-allowed !important;
  }
  /* Док профиля стоит НАД строкой наведения, а не рядом: рядом они
     перекрывались, и высота с типом клетки уходили под панель. */
  .los-dock {
    position: absolute; bottom: 54px; right: 16px;
    background: rgba(14, 17, 23, 0.93); backdrop-filter: blur(10px);
    border: 1px solid #30363d; border-radius: 6px; padding: 10px;
    z-index: 6; box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6);
    transition: opacity 0.15s;
  }
  .los-dock.hidden { opacity: 0; pointer-events: none; }
  .los-head {
    display: flex; justify-content: space-between; align-items: center;
    margin-bottom: 8px; font-family: monospace; font-size: 10.5px; font-weight: bold;
    gap: 20px;
  }
  .los-title { color: #39c5bb; }
  .los-badge {
    padding: 2px 8px; border-radius: 4px; font-size: 9.5px;
    background: rgba(63, 185, 80, 0.2); color: #3fb950;
  }
  .los-badge.cover { background: rgba(227, 179, 65, 0.2); color: #ffd54f; }
  .los-badge.blocked { background: rgba(248, 81, 73, 0.2); color: #f85149; }
  .los-canvas-wrap {
    background: #090c10; border: 1px solid #30363d; border-radius: 4px; overflow: hidden;
  }
  .los-canvas-wrap canvas { width: 600px; height: 118px; }
  .los-foot {
    margin-top: 6px; font-family: monospace; font-size: 9.5px;
    color: #8b949e; text-align: center; min-height: 12px;
  }
</style>

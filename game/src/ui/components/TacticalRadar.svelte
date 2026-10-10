<script lang="ts">
  import { battle } from '../state/battle.svelte.js';
  import { t } from '../i18n/index.js';

  let canvas = $state<HTMLCanvasElement | null>(null);
  let { onJump }: { onJump: (x: number, y: number) => void } = $props();

  export function getCanvas(): HTMLCanvasElement | null {
    return canvas;
  }

  let dragging = false;

  function jump(e: MouseEvent) {
    if (canvas === null) return;
    const rect = canvas.getBoundingClientRect();
    onJump(
      ((e.clientX - rect.left) / rect.width) * canvas.width,
      ((e.clientY - rect.top) / rect.height) * canvas.height,
    );
  }
</script>

<svelte:window
  onmousemove={(e) => dragging && jump(e)}
  onmouseup={() => (dragging = false)}
/>

<div class="radar" class:collapsed={battle.minimapCollapsed}>
  <div class="radar-header">
    <div class="radar-title"><span class="dot"></span> {t('battle.radar.title')}</div>
    <button
      class="toggle"
      title={t('battle.radar.toggle')}
      onclick={() => (battle.minimapCollapsed = !battle.minimapCollapsed)}
    >{battle.minimapCollapsed ? '+' : '−'}</button>
  </div>
  {#if !battle.minimapCollapsed}
    <div class="radar-body">
      <canvas
        bind:this={canvas}
        width="170"
        height="170"
        onmousedown={(e) => {
          dragging = true;
          jump(e);
        }}
      ></canvas>
    </div>
  {/if}
</div>

<style>
  .radar {
    position: absolute;
    bottom: 54px;
    left: 16px;
    background: rgba(14, 17, 23, 0.9);
    backdrop-filter: blur(8px);
    border: 1px solid #30363d;
    border-radius: 6px;
    overflow: hidden;
    z-index: 6;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.6);
  }
  .radar-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 4px 8px; background: #161b22; border-bottom: 1px solid #30363d;
    gap: 10px;
  }
  .radar-title {
    font-family: monospace; font-size: 10px; font-weight: bold; color: #39c5bb;
    display: flex; align-items: center; gap: 5px;
  }
  .dot {
    width: 6px; height: 6px; border-radius: 50%; background: #3fb950;
    box-shadow: 0 0 6px #3fb950;
  }
  .toggle {
    background: none; border: none; color: #8b949e; cursor: pointer;
    font-size: 14px; line-height: 1; padding: 0 2px;
  }
  .toggle:hover { color: #39c5bb; }
  .radar-body { padding: 5px; }
  canvas { display: block; cursor: crosshair; border-radius: 3px; }
</style>

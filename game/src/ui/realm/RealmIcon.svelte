<script lang="ts">
  import AtlasImage from '../components/AtlasImage.svelte';

  /**
   * Значок державы из атласа `realm_icons` (номер ячейки — `realmIcons.ts`). Смысл значка несёт подсказка
   * `title`: на 20 px картинка узнаётся, но не читается словами.
   */
  let { index, size = 20, title = '' }: { index: number; size?: number; title?: string } = $props();
</script>

<span class="ri" {title}><AtlasImage atlas="realm_icons" {index} width={size} alt={title} /></span>

<style>
  .ri {
    display: inline-flex;
    flex-shrink: 0;
    line-height: 0;
  }
  .ri :global(.atlas) {
    border-radius: 3px;
  }
</style>

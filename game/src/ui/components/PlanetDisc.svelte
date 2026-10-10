<script lang="ts">
  import AtlasImage from './AtlasImage.svelte';

  /**
   * Диск планеты по её боевому биому.
   *
   * Биомов в правилах шесть (`data/biomes.json`) — ровно те, для которых
   * строится карта боя. Атлас на шестнадцать сюжетов, поэтому выбирается тот,
   * что ближе по виду; лишние ячейки просто не используются.
   */
  let { biome, width = '100%' }: { biome: string; width?: number | string } = $props();

  const CELL: Readonly<Record<string, number>> = {
    temperate: 3, // континентальный мир земного типа
    desert: 0,
    tundra: 4, // ледяной мир
    jungle: 2,
    volcanic: 5,
    lunar: 6, // безатмосферный
  };

  const index = $derived(CELL[biome] ?? 3);
</script>

<AtlasImage atlas="planets" {index} {width} bordered />

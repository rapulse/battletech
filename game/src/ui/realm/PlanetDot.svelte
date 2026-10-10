<script lang="ts">
  import AtlasImage from '../components/AtlasImage.svelte';

  /**
   * Планета целым шаром для карты, панели и карточки державы (шаг 93; атлас `planets_round` — после шага 93).
   * Широкий атлас `planets` с куполами остаётся у досье системы (`PlanetDisc`); здесь кружок, и ему нужен шар с
   * краем и объёмом, а не квадрат поверхности, вырезанный из купола.
   */
  let { biome, size }: { biome: string; size: number } = $props();

  /** Ячейка атласа `planets_round` по боевому биому (`data/biomes.json`), порядок сетки — `tools/pack_ui_atlases.py`. */
  const CELL: Readonly<Record<string, number>> = {
    temperate: 0,
    desert: 1,
    tundra: 2,
    jungle: 3,
    volcanic: 4,
    lunar: 5,
  };
</script>

<AtlasImage atlas="planets_round" index={CELL[biome] ?? 0} width={size} round />

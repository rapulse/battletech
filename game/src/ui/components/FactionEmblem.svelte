<script lang="ts">
  import { FACTIONS } from '../../core/campaign/galaxy/index.js';
  import AtlasImage from './AtlasImage.svelte';
  import { factionFullName } from '../i18n/names.js';

  /**
   * Знак фракции.
   *
   * Раскладка атласа привязана к `data/galaxy/factions.json`: ключ здесь — тот
   * же id, что в данных, и список обязан покрывать их все. Незнакомый id даёт
   * знак независимых миров, а не пустое место: фракция может приехать из данных
   * раньше, чем художник нарисует ей герб, и дыра на экране в этот момент
   * читается ошибкой вёрстки.
   */
  let {
    factionId,
    size = 28,
    bordered = false,
  }: { factionId: string; size?: number | string; bordered?: boolean } = $props();

  /** Ячейка атласа `ui/factions.jpg` (4×4) по id фракции. */
  const CELL: Readonly<Record<string, number>> = {
    comstar: 0,
    steiner: 1,
    kurita: 2,
    davion: 3,
    liao: 4,
    marik: 5,
    dragoons: 6,
    independent: 7,
    wolf: 8,
    jade_falcon: 9,
    ghost_bear: 10,
    smoke_jaguar: 11,
    nova_cat: 11,
    steel_viper: 12,
    taurian: 13,
    marian: 13,
    canopus: 14,
    outworlds: 14,
    pirates: 15,
    circinus: 15,
  };

  const index = $derived(CELL[factionId] ?? CELL['independent'] ?? 7);
  const title = $derived(factionFullName(factionId, FACTIONS.get(factionId)?.name ?? factionId));
</script>

<AtlasImage atlas="factions" {index} width={size} round {bordered} alt={title} />

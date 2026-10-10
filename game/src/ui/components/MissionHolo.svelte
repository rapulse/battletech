<script lang="ts">
  import type { MissionType } from '../../core/campaign/contracts/schema.js';
  import AtlasImage from './AtlasImage.svelte';

  /**
   * Голограмма боевой задачи.
   *
   * Пять типов миссий ядра (`contracts/schema.ts::MISSION_TYPES`) разложены по
   * ячейкам атласа `ui/missions.jpg` (4×3). Соответствие ручное и должно им
   * оставаться: атлас нарисован под сюжеты, а не под ключи, и подбирать
   * картинку под смысл задачи — работа глаз, а не формулы.
   */
  let {
    mission,
    width = '100%',
  }: { mission: MissionType; width?: number | string } = $props();

  const CELL: Readonly<Record<MissionType, number>> = {
    garrison: 2, // сопровождение колонны: гарнизонная служба — это охрана
    assault: 1, // штурм укреплённой базы
    recon: 4, // разведка боем
    raid: 5, // диверсия на промышленном объекте
    defense: 10, // оборона рубежа до последнего
  };
</script>

<AtlasImage atlas="missions" index={CELL[mission]} {width} />

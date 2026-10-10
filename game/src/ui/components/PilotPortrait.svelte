<script lang="ts">
  import type { Pilot } from '../../core/model/index.js';
  import { isClan } from '../../core/rules/names.js';
  import AtlasImage from './AtlasImage.svelte';

  /**
   * Портрет пилота.
   *
   * Лицо ЛЕЖИТ В ЗАПИСИ (`pilot.face`), а не выводится из хэша id, и это правка
   * найма 2026-09-10. Хэш годился, пока лица были взаимозаменяемы: пол пилота
   * никого не касался, кланов не было, атлас был один. Теперь лицо связано с
   * именем (имя подобрано под пол нарисованного человека) и с принадлежностью
   * (у клана свой атлас, где РЯД — это клан), и вывести всё это из строки id
   * нельзя: первая же перестановка ячеек в атласе сделала бы из Керенского
   * женщину из Дома Ляо.
   *
   * Атлас выбирается по принадлежности: клановые лица лежат отдельным файлом с
   * гербом клана на фоне, сферные — общим на все Дома.
   */
  let {
    pilot,
    width = 54,
    bordered = true,
  }: { pilot: Pilot; width?: number | string; bordered?: boolean } = $props();

  const atlas = $derived(isClan(pilot.affiliation) ? 'pilots_clans' : 'pilots');
</script>

<AtlasImage {atlas} index={pilot.face} {width} {bordered} />

<script lang="ts">
  import AtlasImage from './AtlasImage.svelte';

  /**
   * Герб наёмного отряда — ячейка набора `ui/mercenaries.jpg` (шаг 22).
   *
   * Отдельный компонент от `CompanyEmblem`, а не параметр к нему, и это не
   * дублирование: наборы разные (`ui/company.jpg` против `ui/mercenaries.jpg`),
   * и один и тот же номер в них показывает разные картинки. Общий компонент с
   * ключом «чей герб» означал бы, что перепутать набор можно молча.
   *
   * Номер лежит в состоянии (`Rival.emblem`) и привязан к ИМЕНИ отряда через
   * реестр MRBC (`data/rivals.json` → `registry`): герб принадлежит отряду.
   */
  let {
    index = 0,
    size = 26,
    bordered = false,
  }: { index?: number; size?: number | string; bordered?: boolean } = $props();
</script>

<AtlasImage atlas="mercenaries" {index} width={size} round {bordered} />

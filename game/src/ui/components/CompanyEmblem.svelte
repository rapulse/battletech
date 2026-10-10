<script lang="ts">
  import AtlasImage from './AtlasImage.svelte';

  /**
   * Герб роты игрока — номер в наборе из шестнадцати (`ui/company.jpg`).
   *
   * Номер лежит в состоянии кампании (`Company.emblem`), а не здесь: выбор
   * игрока обязан пережить выгрузку кампании в файл. Этот компонент только
   * показывает картинку по номеру.
   */
  let {
    index = 0,
    size = 36,
    bordered = false,
  }: { index?: number; size?: number | string; bordered?: boolean } = $props();
</script>

<AtlasImage atlas="company" {index} width={size} round {bordered} />

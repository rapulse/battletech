<script lang="ts">
  import { EQUIPMENT, WEAPONS } from '../../core/data/tables.js';

  /**
   * ТАКТИЧЕСКАЯ ПИКТОГРАММА УСТАНОВКИ (шаг 40, часть Б).
   *
   * **Боль.** На экранах рынка и мехлаба всё вооружение выводилось текстом с
   * мелкими бейджами. Ассортимент не считывался взглядом: чтобы понять, лежит ли
   * на витрине что-то энергетическое, приходилось читать список целиком.
   *
   * **Категория, а не модель.** Иконок ровно пять — по родам установок, — и это
   * решение, а не экономия. Полсотни рисунков «на каждый ствол» пришлось бы
   * рисовать заново с каждым новым оружием каталога, а различать AC/2 и AC/5 по
   * силуэту в шестнадцать пикселей всё равно нельзя. Род читается мгновенно,
   * модель дочитывается текстом рядом.
   *
   * Монохромная векторная графика, цвет берётся из палитры художественного
   * регламента (`game_core.md` §11): янтарь и бирюза, без градиентов и теней.
   */
  interface Props {
    itemId: string;
    size?: number;
  }
  const { itemId, size = 14 }: Props = $props();

  type Family = 'energy' | 'ballistic' | 'missile' | 'gear' | 'ammo';

  const family = $derived<Family>(familyOf(itemId));

  function familyOf(id: string): Family {
    const w = WEAPONS.get(id);
    if (w !== undefined) {
      if (w.category === 'energy') return 'energy';
      if (w.category === 'ballistic') return 'ballistic';
      return 'missile';
    }
    const eq = EQUIPMENT.get(id);
    return eq?.category === 'ammo' ? 'ammo' : 'gear';
  }

  /** Янтарь — то, что стреляет, бирюза — то, что обслуживает. Регламент §11. */
  const tint = $derived(family === 'gear' || family === 'ammo' ? '#39c5cf' : '#d29922');
</script>

<svg
  class="item-icon"
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke={tint}
  stroke-width="1.4"
  stroke-linecap="square"
  aria-hidden="true"
>
  {#if family === 'energy'}
    <!-- Луч: ствол и расходящийся импульс. -->
    <path d="M2 8h7" />
    <path d="M9 5l4 3-4 3z" fill={tint} stroke="none" />
  {:else if family === 'ballistic'}
    <!-- Снаряд в стволе: сплошное тело и дульный срез. -->
    <rect x="2" y="6" width="8" height="4" />
    <path d="M10 6.5h3v3h-3" />
  {:else if family === 'missile'}
    <!-- Блок пусковых: сетка ячеек. -->
    <rect x="2.5" y="2.5" width="11" height="11" />
    <path d="M2.5 8h11M8 2.5v11" />
  {:else if family === 'ammo'}
    <!-- Ящик боепитания. -->
    <rect x="2.5" y="4.5" width="11" height="8" />
    <path d="M2.5 7.5h11M6 4.5v-2h4v2" />
  {:else}
    <!-- Оборудование: радиатор с рёбрами. -->
    <rect x="2.5" y="3.5" width="11" height="9" />
    <path d="M5.5 3.5v9M8 3.5v9M10.5 3.5v9" />
  {/if}
</svg>

<style>
  .item-icon {
    flex: none;
    vertical-align: middle;
    opacity: 0.9;
  }
</style>

<script lang="ts">
  import type { ZoneLine } from '../state/battle.svelte.js';
  import { t } from '../i18n/index.js';

  /**
   * Диаграмма брони на ШЕСТЬ зон ядра.
   *
   * В макете зон было одиннадцать — с разделённым торсом и тыловой бронёй. В
   * правилах проекта торс единый, тыловой брони нет, и рисовать пять секций,
   * за которыми ничего не стоит, значило бы завести на экране ровно ту пустоту,
   * которую восемь шагов подряд из проекта вычищали. Освободившееся место
   * отдано тому, чего в макете не было: структуре под бронёй — она в правилах
   * есть, отдельно считается и отдельно кончается.
   */
  let {
    zones = [],
    hidden = false,
    selectable = false,
    selected = $bindable<string | null>(null),
  }: {
    zones?: ZoneLine[];
    hidden?: boolean;
    /**
     * Зону можно выбрать щелчком (шаг 17, ангар): цех чинит зону, и выбирать
     * её удобнее на самой кукле, чем в списке рядом с ней. В бою выбор не
     * нужен — там зона не действие, а показание.
     */
    selectable?: boolean;
    selected?: string | null;
  } = $props();

  const SHAPES: Record<string, { poly: string; tx: number; ty: number; lx: number; ly: number }> = {
    head: { poly: '40,6 66,6 64,26 42,26', tx: 53, ty: 16, lx: 53, ly: 23 },
    torso: { poly: '34,28 72,28 69,74 60,80 46,80 37,74', tx: 53, ty: 48, lx: 53, ly: 58 },
    leftArm: { poly: '4,28 30,28 30,78 12,78 4,64', tx: 17, ty: 50, lx: 17, ly: 60 },
    rightArm: { poly: '102,28 76,28 76,78 94,78 102,64', tx: 89, ty: 50, lx: 89, ly: 60 },
    leftLeg: { poly: '30,84 50,84 48,104 52,112 52,138 26,138 26,112 30,104', tx: 39, ty: 118, lx: 39, ly: 128 },
    rightLeg: { poly: '56,84 76,84 76,104 80,112 80,138 54,138 54,112 56,104', tx: 67, ty: 118, lx: 67, ly: 128 },
  };

  const SHORT: Record<string, string> = {
    head: 'HD',
    torso: 'CT',
    leftArm: 'LA',
    rightArm: 'RA',
    leftLeg: 'LL',
    rightLeg: 'RL',
  };

  /**
   * Цвет зоны говорит о ПОВРЕЖДЕНИИ — о том, что чинит цех. Недокомплект
   * (навесили меньше, чем держит корпус) цветом НЕ показывается: он не
   * лечится ремонтом, и красная рука на целой машине означала бы «почини
   * меня» там, где чинить нечего. Его показывают числа в списке зон и блок
   * комплектности рядом.
   */
  function style(z: ZoneLine | undefined, isSelected: boolean) {
    const dash = z?.hasItems ? 'none' : '3 2';
    if (isSelected) return { fill: 'rgba(88, 166, 255, 0.18)', stroke: '#58a6ff', dash };
    if (z === undefined || hidden) {
      return { fill: 'rgba(227, 179, 65, 0.12)', stroke: '#ffd54f', dash: '3 2' };
    }
    if (z.destroyed) return { fill: 'rgba(22, 27, 34, 0.7)', stroke: '#484f58', dash };
    const total = z.maxArmor + z.maxStructure;
    const left = total === 0 ? 0 : (z.armor + z.structure) / total;
    if (left >= 0.75) return { fill: 'rgba(63, 185, 80, 0.18)', stroke: '#3fb950', dash };
    if (left >= 0.4) return { fill: 'rgba(227, 179, 65, 0.22)', stroke: '#e3b341', dash };
    if (left > 0) return { fill: 'rgba(248, 81, 73, 0.28)', stroke: '#f85149', dash };
    return { fill: 'rgba(22, 27, 34, 0.6)', stroke: '#484f58', dash };
  }

  const order = ['head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'];
  let byId = $derived(new Map(zones.map((z) => [z.id, z])));
</script>

<div class="paperdoll-box">
  <div class="paperdoll-header">
    {t('battle.paperdoll.title')}
    {#if hidden}<span class="unknown">{t('battle.paperdoll.unknown')}</span>{/if}
  </div>
  <div class="paperdoll-body">
    <svg class="paperdoll-svg" viewBox="0 0 106 148">
      {#each order as id (id)}
        {@const z = byId.get(id)}
        {@const st = style(z, selectable && selected === id)}
        {@const shape = SHAPES[id]}
        {#if shape}
          <!--
            Клавиатурный доступ к зонам даёт СПИСОК зон рядом с куклой (ангар),
            а не сам полигон: `tabindex` на шести фигурах внутри SVG заставил бы
            игрока прощёлкать их все, чтобы дойти до кнопок цеха. Здесь мышь.
          -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <g
            class:pickable={selectable}
            role={selectable ? 'button' : undefined}
            tabindex={selectable ? -1 : undefined}
            aria-label={selectable ? z?.label : undefined}
            onclick={selectable ? () => (selected = id) : undefined}
            onkeydown={selectable
              ? (e: KeyboardEvent) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selected = id;
                  }
                }
              : undefined}
          >
            <polygon
              points={shape.poly}
              fill={st.fill}
              stroke={st.stroke}
              stroke-width={selectable && selected === id ? '1.4' : '0.7'}
              stroke-dasharray={st.dash}
              stroke-linejoin="round"
            />
            <text x={shape.tx} y={shape.ty} class="pd-val" pointer-events="none">
              {#if hidden || z === undefined}?{:else}{z.armor}<tspan class="pd-struct">/{z.structure}</tspan>{/if}
            </text>
            <text x={shape.lx} y={shape.ly} class="pd-lbl" pointer-events="none">{SHORT[id]}</text>
          </g>
        {/if}
      {/each}
      <text x="53" y="146" class="pd-section-lbl" pointer-events="none">{t('battle.paperdoll.legend')}</text>
    </svg>
  </div>
</div>

<style>
  .paperdoll-box {
    margin-top: 12px;
    background: rgba(13, 17, 23, 0.85);
    border: 1px solid #30363d;
    border-radius: 6px;
    overflow: hidden;
  }
  .paperdoll-header {
    background: #161b22;
    padding: 4px 8px;
    font-size: 10px;
    font-weight: bold;
    color: #8b949e;
    letter-spacing: 0.5px;
    border-bottom: 1px solid #30363d;
    display: flex;
    justify-content: space-between;
  }
  .unknown {
    color: #ffd54f;
  }
  .paperdoll-body {
    padding: 6px;
    display: flex;
    justify-content: center;
  }
  .paperdoll-svg {
    width: 100%;
    max-width: 200px;
    height: auto;
  }
  .pickable {
    cursor: pointer;
    outline: none;
  }
  .pickable:hover polygon {
    filter: drop-shadow(0 0 5px #39c5bb);
  }
  .pd-val {
    fill: #ffffff;
    font-size: 9px;
    font-family: monospace;
    font-weight: bold;
    text-anchor: middle;
    pointer-events: none;
    user-select: none;
  }
  .pd-struct {
    fill: rgba(255, 255, 255, 0.5);
    font-size: 7px;
    pointer-events: none;
    user-select: none;
  }
  .pd-lbl {
    fill: rgba(255, 255, 255, 0.45);
    font-size: 7px;
    font-family: monospace;
    text-anchor: middle;
    pointer-events: none;
    user-select: none;
  }
  .pd-section-lbl {
    fill: #39c5bb;
    font-size: 7px;
    font-family: monospace;
    font-weight: bold;
    text-anchor: middle;
    pointer-events: none;
    user-select: none;
  }
</style>

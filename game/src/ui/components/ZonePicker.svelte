<script lang="ts">
  import { ZONE_IDS, type ZoneId } from '../../core/model/HitZone.js';
  import { t } from '../i18n/index.js';

  /**
   * ВЫБОР ЗОНЫ ОДНИМ НАЖАТИЕМ (шаг 40, часть В).
   *
   * **Боль.** Куда поставить установку и куда её перенести, мехлаб спрашивал
   * выпадающими списками. Список прячет главное: он показывает одну строку, а
   * шасси — шесть зон, и какие из них вообще годятся, видно только после того,
   * как список раскрыт. Ещё хуже было у склада: там зона выбиралась ГЛОБАЛЬНО,
   * одним селектором на всю полку, и «Поставить» у каждой позиции означало
   * «поставить туда, что выбрано где-то внизу».
   *
   * **Решение — силуэт машины строкой.** Шесть кнопок в том же порядке, в каком
   * зоны стоят на кукле: голова, торс, руки, ноги. Годность видна БЕЗ нажатия:
   * годная зона ярче и обведена сплошной линией, негодная — тусклее и обведена
   * пунктиром, текущая (та, где установка уже стоит) горит цветом акцента.
   * Нажатие сразу и есть действие: выбирать зону отдельно от команды больше не
   * надо.
   *
   * **Правил зон компонент не знает.** Он спрашивает годность у того, кто его
   * позвал (`can`), а тот — у ядра (`mountIssue` и смета ячеек валидатора).
   * Второго свода правил в интерфейсе нет и быть не должно.
   */
  interface Props {
    /** Годится ли зона под это действие. Ответ приходит из ядра, не отсюда. */
    can: (zone: ZoneId) => boolean;
    /** Подсказка на кнопку: почему годится или почему нет. */
    hint: (zone: ZoneId) => string;
    /** Зона, в которой установка стоит сейчас. `null` — ставим со склада. */
    current?: ZoneId | null;
    pick: (zone: ZoneId) => void;
  }
  const { can, hint, current = null, pick }: Props = $props();

  /**
   * Порядок и деление на группы — силуэт, а не алфавит: голова, торс, пара рук,
   * пара ног. Разделители ставятся ровно между этими группами
   * («ГЛ · ТР · ЛР ПР · ЛН ПН») и держат взгляд на симметрии машины: пара рук и
   * пара ног читаются как пары, а не как четыре отдельные кнопки.
   */
  const GROUPS: readonly (readonly ZoneId[])[] = [
    ['head'],
    ['torso'],
    ['leftArm', 'rightArm'],
    ['leftLeg', 'rightLeg'],
  ];

  // Ловушка: новая зона в ядре не должна молча выпасть из строки выбора.
  const MISSING = ZONE_IDS.filter((z) => !GROUPS.some((g) => g.includes(z as ZoneId)));
</script>

<div class="zone-picker" role="group">
  {#each GROUPS as group, gi (gi)}
    {#if gi > 0}<span class="sep" aria-hidden="true">·</span>{/if}
    {#each group as z (z)}
      <button
        type="button"
        class="zone-key"
        class:fits={can(z)}
        class:here={z === current}
        disabled={!can(z)}
        title={hint(z)}
        aria-label={t(`zone.${z}`)}
        onclick={() => pick(z)}
      >
        {t(`zone.${z}Short`)}
      </button>
    {/each}
  {/each}
  {#each MISSING as z (z)}
    <button
      type="button"
      class="zone-key"
      class:fits={can(z)}
      class:here={z === current}
      disabled={!can(z)}
      title={hint(z)}
      onclick={() => pick(z)}
    >
      {t(`zone.${z}Short`)}
    </button>
  {/each}
</div>

<style>
  /* Одна строка и только одна: перенос разорвал бы силуэт машины пополам. */
  .zone-picker {
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: 3px;
  }

  .sep {
    color: var(--color-border);
    font-size: 11px;
    line-height: 1;
    padding: 0 1px;
  }

  /*
   * Клавиша зоны. Три состояния читаются с одного взгляда и НЕ полагаются
   * только на цвет: негодная обведена пунктиром, годная — сплошной линией,
   * текущая — сплошной линией цвета акцента с заливкой.
   */
  .zone-key {
    font-family: var(--font-display);
    font-size: 10.5px;
    font-weight: 700;
    letter-spacing: 0.6px;
    min-width: 26px;
    padding: 2px 4px;
    border-radius: 2px;
    cursor: pointer;
    transition:
      background 0.12s ease,
      border-color 0.12s ease,
      color 0.12s ease;

    /* Негодная зона: тусклее и пунктиром. */
    color: var(--color-text-dim);
    background: transparent;
    border: 1px dashed var(--color-border);
    opacity: 0.5;
  }

  .zone-key.fits {
    color: var(--color-text);
    background: var(--color-panel-sub);
    border: 1px solid var(--color-border);
    opacity: 1;
  }

  .zone-key.fits:hover {
    color: #fff;
    border-color: var(--color-border-active);
    box-shadow: 0 0 8px var(--glow-cyan);
  }

  .zone-key.fits:active {
    transform: translateY(1px);
  }

  .zone-key.here {
    color: var(--color-accent);
    background: rgba(57, 197, 187, 0.15);
    border: 1px solid var(--color-accent);
    opacity: 1;
  }

  .zone-key:disabled {
    cursor: not-allowed;
  }
</style>

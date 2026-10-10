<script lang="ts">
  import ATLASES from './atlases.json';

  /**
   * Одна ячейка растрового атласа.
   *
   * Растр в проекте разрешён УЗКО (решение 2026-09-01, Трек Б): только
   * стационарные изображения, которые не несут состояния, — портреты пилотов,
   * диски планет, эмблемы, голограммы типов миссий. Всё, что показывает
   * состояние машины, рисуется кодом: кукла брони — полигоны, иконки оружия —
   * форма по категории. Причина простая: растр не умеет показать оторванную
   * руку и восстановленный реактор поверх 510 шасси, а один статичный кадр на
   * этом месте будет врать.
   *
   * Почему один компонент на все атласы, а не пять почти одинаковых: разница
   * между эмблемой и диском планеты — это имя атласа и номер ячейки. Пять
   * копий одной и той же арифметики `background-position` разошлись бы ровно
   * тогда, когда у одного из атласов сменится число рядов.
   *
   * ГЕОМЕТРИЯ БЕРЁТСЯ ИЗ МАНИФЕСТА (`atlases.json`), а не выводится из числа
   * колонок. Между ячейками лежит зазор — без него браузер на дробном масштабе
   * прихватывает край соседней картинки, и над голограммой контракта видна
   * полоска чужого рисунка. Манифест пишет `tools/pack_ui_atlases.py`, и это
   * единственное место, где размеры атласа записаны: переписать их сюда
   * вторыми числами значило бы завести расхождение, которое проявляется
   * полоской в один пиксель и ищется полдня.
   */

  type AtlasName = Exclude<keyof typeof ATLASES, '$comment'>;

  let {
    atlas,
    index = 0,
    width = '100%',
    round = false,
    bordered = false,
    alt = '',
  }: {
    atlas: AtlasName;
    /** Номер ячейки слева направо, сверху вниз. Выходящий за набор заворачивается. */
    index?: number;
    width?: number | string;
    round?: boolean;
    bordered?: boolean;
    alt?: string;
  } = $props();

  /**
   * Разметка атласа в удобном виде.
   *
   * JSON приходит с массивами, а не кортежами, и при `noUncheckedIndexedAccess`
   * каждое обращение к `cell[0]` — это `number | undefined`. Разбирается один
   * раз здесь, чтобы формулы ниже читались формулами, а не цепочкой проверок.
   */
  const geo = $derived.by(() => {
    const raw = ATLASES[atlas];
    return {
      file: raw.file,
      cols: raw.cols,
      rows: raw.rows,
      cellW: raw.cell[0] ?? 1,
      cellH: raw.cell[1] ?? 1,
      gutter: raw.gutter,
      width: raw.size[0] ?? 1,
      height: raw.size[1] ?? 1,
    };
  });

  const cell = $derived.by(() => {
    const total = geo.cols * geo.rows;
    return ((index % total) + total) % total;
  });

  /**
   * Смещение фона в процентах.
   *
   * `background-position` в процентах меряет сдвиг не в ячейках, а в остатке:
   * 100 % — это «правый край фона совпал с правым краем окна». Поэтому в
   * знаменателе стоит «размер атласа минус ячейка», а не ширина атласа.
   */
  const posX = $derived.by(() => {
    const rest = geo.width - geo.cellW;
    return rest <= 0 ? 0 : (((cell % geo.cols) * (geo.cellW + geo.gutter)) / rest) * 100;
  });

  const posY = $derived.by(() => {
    const rest = geo.height - geo.cellH;
    return rest <= 0 ? 0 : ((Math.floor(cell / geo.cols) * (geo.cellH + geo.gutter)) / rest) * 100;
  });

  const sizeX = $derived((geo.width / geo.cellW) * 100);
  const sizeY = $derived((geo.height / geo.cellH) * 100);
  const ratio = $derived(geo.cellW / geo.cellH);

  const dim = $derived(typeof width === 'number' ? `${width}px` : width);
  const fileUrl = $derived(`${import.meta.env.BASE_URL}${geo.file.replace(/^\//, '')}`);
</script>

<div
  class="atlas"
  class:round
  class:bordered
  style:width={dim}
  style:aspect-ratio={String(ratio)}
  role={alt === '' ? 'presentation' : 'img'}
  aria-label={alt === '' ? undefined : alt}
>
  <div
    class="cell"
    style:background-image="url('{fileUrl}')"
    style:background-size="{sizeX}% {sizeY}%"
    style:background-position="{posX}% {posY}%"
  ></div>
</div>

<style>
  .atlas {
    position: relative;
    display: inline-block;
    vertical-align: middle;
    overflow: hidden;
    flex-shrink: 0;
    background: var(--color-bg);
    border-radius: 2px;
  }
  .atlas.round {
    border-radius: 50%;
  }
  .atlas.bordered {
    border: 1px solid var(--color-border);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
  }
  .cell {
    width: 100%;
    height: 100%;
    background-repeat: no-repeat;
  }
</style>

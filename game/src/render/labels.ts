/**
 * Подписи, которые рендер рисует на канвасе (шаг 52).
 *
 * Рендер — слой поверх ядра и не знает словаря интерфейса: импорт `ui/i18n`
 * отсюда развернул бы зависимость обратно. Поэтому слова приходят снаружи,
 * готовыми формулировками: интерфейс собирает этот набор через `t()`
 * (`ui/components/renderLabels.ts`) и отдаёт рендеру, а рендер только
 * подставляет числа и имена и рисует. Смена языка — новый набор, рисование не
 * меняется.
 */
export interface RenderLabels {
  /** Непростреливаемая зона оружия: «МИН. ДИСТАНЦИЯ: 3H». */
  readonly rangeMin: (hexes: number) => string;
  /** Полосы дальности со штрафом: «БЛИЖНЯЯ: 5H (+0)». */
  readonly rangeShort: (hexes: number) => string;
  readonly rangeMedium: (hexes: number) => string;
  readonly rangeLong: (hexes: number) => string;
  /** Дальняя граница всего арсенала машины, когда оружие не выбрано. */
  readonly rangeMax: (hexes: number) => string;

  readonly blip: string;
  readonly unidentified: string;
  /** Тоннаж в подсказке над машиной: «35т». */
  readonly tons: (tons: number) => string;
  /** Число стволов в подсказке: «🔫 4 ор.». */
  readonly weaponCount: (count: number) => string;

  readonly wreckTag: (id: string) => string;
  readonly wreckTitle: string;
  readonly wreckElevation: string;

  readonly losPrompt: string;
  readonly losMode: string;
  readonly losBlocked: string;
  readonly losCover: (mod: number) => string;
  readonly losClear: string;
}

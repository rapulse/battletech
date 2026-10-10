import { PAINTS, REPAIR } from '../../data/index.js';
import { recordChassisDef, type MechRecord } from './MechRecord.js';

/**
 * Перекраска машины (шаг 50).
 *
 * Работа стапеля, как ремонт и переоснащение: срок, цена, место в цеху, отмена
 * с возвратом половины. Косметика — на правила боя и цену машины не влияет.
 *
 * Ядро знает только ПЕРЕЧЕНЬ раскрасок (`data/paints.json`), а не картинки: у
 * какого рисунка какая раскраска нарисована, решает показ. Поэтому ядро и не
 * отказывает в раскраске, которой нет у рисунка, — показ её просто не
 * предлагает, а если она всё же записана, откатывается на имеющуюся.
 */

/** Срок перекраски в сутках. */
export const REPAINT_DAYS: number = REPAIR.repaint.days;

/** Цена перекраски: основа плюс тонны — штурмовик красить дольше и дороже разведчика. */
export function repaintCost(record: MechRecord): number {
  return Math.round(REPAIR.repaint.base + REPAIR.repaint.perTon * recordChassisDef(record).tons);
}

/** Есть ли такая раскраска в реестре. */
export function isPaintId(id: string): boolean {
  return Object.prototype.hasOwnProperty.call(PAINTS.paints, id);
}

/**
 * Машина в новых цветах. `undefined` — снять перекраску и вернуть цвета того,
 * от кого машина пришла: поле удаляется, а не пишется пустым, чтобы снимок
 * перекрашенной и возвращённой машины совпадал с неперекрашенной.
 */
export function withPaint(record: MechRecord, paint: string | undefined): MechRecord {
  if (paint !== undefined) return { ...record, paint };
  const { paint: dropped, ...rest } = record;
  void dropped;
  return rest;
}

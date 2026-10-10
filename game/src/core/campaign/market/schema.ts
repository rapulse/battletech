import { z } from 'zod';
import marketJson from '../../../../data/market.json';
import { QUALITY_CLASS_IDS, type QualityClass } from '../../model/QualityClass.js';
import { MARKET_CLASSES, type MarketClass } from '../galaxy/schema.js';

/**
 * Схема рынка (шаг 15) — `data/market.json`.
 *
 * Тот же порядок, что у боевых таблиц (`core/data/schema.ts`) и у галактики
 * (`galaxy/schema.ts`): у каждой таблицы своя схема, разбор один раз при
 * загрузке модуля. Файл лежит в кампании, а не в `core/data/tables.ts`, по
 * одной причине: класс рынка (`MARKET_CLASSES`) — понятие кампании, а боевому
 * ядру запрещено импортировать `core/campaign/` (решение 1 §2 пайплайна).
 */

const nonNeg = z.number().nonnegative();
const comment = z.string().optional();

/** Веса классов исполнения. Ноль — «этого класса тут не бывает вовсе», и это запирает лестницу. */
const qualityWeights = z
  .object(
    Object.fromEntries(QUALITY_CLASS_IDS.map((id) => [id, nonNeg])) as Record<QualityClass, typeof nonNeg>,
  )
  .strict();

const marketClassRow = z
  .object({
    priceFactor: z.number().positive(),
    sellFactor: z.number().positive(),
    lots: z.number().int().min(0),
    /** 0 — заказать отсюда нельзя вовсе (периферия). */
    orderDays: z.number().int().min(0),
    orderFactor: nonNeg,
    quality: qualityWeights,
  })
  .strict();

const byMarketClass = <T extends z.ZodTypeAny>(value: T) =>
  z.object(Object.fromEntries(MARKET_CLASSES.map((c) => [c, value])) as Record<MarketClass, T>).strict();

export const marketFileSchema = z
  .object({
    $comment: comment,
    $comment2: comment,
    $comment3: comment,
    decadeDays: z.number().int().positive(),
    classes: byMarketClass(marketClassRow).extend({ $comment: comment }).strict(),
    flags: z
      .object({
        $comment: comment,
        mechFactory: z
          .object({ lots: z.number().int().min(0), priceFactor: z.number().positive(), quality: qualityWeights })
          .strict(),
        blackMarket: z
          .object({ lots: z.number().int().min(0), priceFactor: z.number().positive(), quality: qualityWeights })
          .strict(),
      })
      .strict(),
    clan: z
      .object({
        $comment: comment,
        chanceByClass: byMarketClass(z.number().min(0).max(1)).strict(),
        clanOwnerBonus: nonNeg,
        blackMarketBonus: nonNeg,
        priceFactor: z.number().positive(),
      })
      .strict(),
    stock: z
      .object({
        $comment: comment,
        $comment2: comment,
        supplyCategories: z.array(z.string()).min(1),
      })
      .strict(),
    item: z
      .object({
        $comment: comment,
        perTon: z
          .object({
            energy: z.number().positive(),
            ballistic: z.number().positive(),
            missile: z.number().positive(),
            heatsink: z.number().positive(),
            ammo: z.number().positive(),
            jump_jet: z.number().positive(),
            protection: z.number().positive(),
            electronics: z.number().positive(),
          })
          .strict(),
        minimum: nonNeg,
      })
      .strict(),
    weightClass: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        priceFactor: z
          .object({
            light: z.number().positive(),
            medium: z.number().positive(),
            heavy: z.number().positive(),
            assault: z.number().positive(),
          })
          .strict(),
      })
      .strict(),
    sell: z
      .object({
        $comment: comment,
        spread: z.number().positive().max(1),
        wearDiscount: z.number().min(0).max(1),
        demand: z
          .object({
            low: z.number().positive(),
            high: z.number().positive(),
            lowShare: z.number().min(0).max(1),
            highShare: z.number().min(0).max(1),
          })
          .strict(),
      })
      .strict(),
    scrap: z
      .object({
        $comment: comment,
        $comment2: comment,
        baseCost: nonNeg,
        costPerTon: nonNeg,
        daysBase: nonNeg,
        daysPerTon: nonNeg,
        /** Износ, с которым реактор сходит с машины, у которой разрушен торс (шаг 45). */
        wreckedNodeWear: nonNeg,
      })
      .strict(),
    install: z
      .object({ $comment: comment, labourShare: z.number().min(0).max(1), days: z.number().positive() })
      .strict(),
    /**
     * Переоснащение (шаг 19a). Платится РАБОТА цеха долей от цены установки:
     * само железо уже куплено, снято с трофея или переставлено с другой машины
     * роты. Броня и боезапас доливаются по ценам `repair.json` — они расходник,
     * а не складская запись (то же правило, что у разбора).
     */
    refit: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        $comment4: comment,
        $comment5: comment,
        labourShare: z.number().min(0).max(1),
        minimumLabour: nonNeg,
        /** Плоский сбор за снятие детали на склад: техники уже на жалованье. */
        removalFee: nonNeg,
        /** Множитель работы от тоннажа платформы: base + tonnage * perTon. */
        tonnageFactor: z
          .object({ base: z.number().positive(), perTon: z.number().min(0) })
          .strict(),
        daysPerItem: nonNeg,
        minimumDays: z.number().positive(),
      })
      .strict(),
    /**
     * Машины на прилавке (шаг 19a). Подержанный корпус с чужой навеской:
     * комплектность — такая же ось, как у отрядов противника
     * (`core/campaign/mech/outfit.ts`), и форма диапазонов совпадает с ней
     * намеренно.
     */
    mechs: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        lotsByClass: byMarketClass(z.number().int().min(0)).strict(),
        factoryBonus: z.number().int().min(0),
        blackMarketBonus: z.number().int().min(0),
        markup: z.number().positive(),
        outfit: z
          .object({
            armorShare: z.tuple([z.number().min(0).max(1), z.number().min(0).max(1)]),
            missingItems: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export type MarketFile = z.infer<typeof marketFileSchema>;

function fail(what: string, err: unknown): never {
  const detail = err instanceof Error ? err.message : String(err);
  throw new Error(`Ошибка в данных рынка (${what}):\n${detail}`);
}

function parse<T>(what: string, schema: { parse: (v: unknown) => T }, raw: unknown): T {
  try {
    return schema.parse(raw);
  } catch (err) {
    return fail(what, err);
  }
}

/** Числа рынка: доступность по классу системы, цены, сроки заказа, разбор, установка. */
export const MARKET: MarketFile = parse('data/market.json', marketFileSchema, marketJson);

// Спред покупки и продажи — ПРАВИЛО, а не настройка (ловушка 3 брифинга шага 15).
// Схема допускает `spread <= 1`, но единица означала бы «продал за столько же,
// за сколько купил», то есть бесконечную петлю торговли между системами. Порог
// проверяется здесь, при загрузке, а не тестом: испорченный этим числом файл
// ломает экономику всей кампании, а не один сценарий.
if (MARKET.sell.spread > 0.8) {
  fail(
    'data/market.json',
    new Error(
      `sell.spread = ${MARKET.sell.spread}: цена продажи обязана быть ЗАМЕТНО ниже цены покупки, ` +
        'иначе перевозка узлов между системами становится бесконечным доходом (ловушка 3 шага 15)',
    ),
  );
}

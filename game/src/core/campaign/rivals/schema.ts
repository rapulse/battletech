import { z } from 'zod';
import rivalsJson from '../../../../data/rivals.json';
import { FACTIONS, GALAXY } from '../galaxy/catalog.js';

/**
 * Схема таблицы соперников (шаг 22) — `data/rivals.json`.
 *
 * Тот же порядок, что у контрактов, рынка, галактики, репутации и войны: своя
 * схема на таблицу, разбор один раз при загрузке модуля, строгие объекты.
 * Опечатка в ступени или пропущенный вес останавливают загрузку здесь, а не
 * всплывают через полкампании таблицей рейтинга из восьми одинаковых строк.
 *
 * Файл лежит в кампании (`data/`, разбирается кампанией), а не в
 * `core/data/tables.ts`, по той же причине, что `contracts.json`,
 * `reputation.json` и `war.json`: отряд наёмников — понятие кампании, а боевому
 * ядру запрещено импортировать `core/campaign/` (решение 1 §2 пайплайна).
 */

const comment = z.string().optional();
const money = z.number().nonnegative();
const share = z.number().min(0).max(1);
const range = z.tuple([z.number(), z.number()]);

const tierSchema = z
  .object({
    id: z.string().min(1),
    weightClasses: z.array(z.enum(['light', 'medium', 'heavy', 'assault'])).min(1),
    maxReactorTier: z.number().int().positive(),
    maxFrameTier: z.number().int().positive(),
    pilotTierMin: z.number().int().positive(),
    pilotTierMax: z.number().int().positive(),
    armorShare: range,
    missingItems: range,
    cbills: money,
  })
  .strict();

/**
 * Отряд реестра MRBC: канон Внутренней Сферы 3053 года.
 *
 * `emblem` — номер ячейки в атласе `ui/mercenaries.jpg`, и он привязан к ИМЕНИ,
 * а не к строке таблицы: герб принадлежит отряду. Разъедься они — Гончие Келла
 * вышли бы под черепом Рейнджеров Уако.
 *
 * `great` делит реестр по МАСШТАБУ, и это не украшение. Полк и крупнее в игре не
 * симулируется: он не берёт работу и не стоит в системе, он — потолок карьеры,
 * и сила его считается той же формулой, что и ваша, из канонического состава
 * (`registry.ts`). Отряды без `great` — ротного масштаба, и вот они живут по
 * общим правилам; `tier` у них обязателен — им же они и основываются.
 */
const registryUnitSchema = z
  .object({
    id: z.string().min(1),
    emblem: z.number().int().nonnegative(),
    name: z.string().min(1),
    /** Сертификат MRBC: A*, A, B, C. Описание, в правилах не участвует. */
    cert: z.string().min(1),
    base: z.string().min(1),
    /** Ступень основания — только у отрядов ротного масштаба. */
    tier: z.string().min(1).optional(),
    great: z
      .object({
        /**
         * Канонический мир базы на 3053 — id системы каталога (шаг 82). `base` рядом —
         * подпись для таблицы, этот — место основания полка.
         */
        baseSystemId: z.string().min(1),
        /** Дом, которому полк верен по канону: его фронт весит больше (`regiment.loyaltyWeight`). */
        loyalTo: z.string().min(1).optional(),
        force: z.string().min(1),
        mechs: z.number().int().positive(),
        quality: z.enum(['recovered', 'standard', 'military', 'master']),
        tons: z.number().positive(),
        skill: z.number().positive(),
        /** Отряд ВЛАДЕЕТ своим миром, а не просто базируется на нём. */
        holdsWorld: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const rivalsFileSchema = z
  .object({
    $comment: comment,
    $comment2: comment,
    $comment3: comment,
    $comment4: comment,
    $comment5: comment,
    $comment6: comment,
    $comment7: comment,
    $comment8: comment,
    $comment9: comment,
    $comment10: comment,
    $comment11: comment,
    $comment12: comment,
    $comment13: comment,
    $comment14: comment,
    $comment19: comment,
    $comment18: comment,
    $comment17: comment,
    $comment16: comment,
    $comment15: comment,
    $comment15a: comment,
    $comment15b: comment,
    /**
     * Сколько отрядов РОТНОГО масштаба живёт в мире. Ноль — ВЫКЛЮЧАТЕЛЬ шага 22: контрольный угол
     * замера гоняется тем же кодом с `count: 0`, ровно как шаг 21b гонял свой
     * с `front.attempts` в ноль. Выключатель в данных, а не флаг в CLI: он
     * обязан выключать механику целиком, включая конструктор состояния.
     */
    companies: z.number().int().nonnegative(),
    spawnJumps: z.number().int().nonnegative(),
    readyShare: share,
    contractOdds: z.number().positive(),
    repairShare: share,
    reserveMonths: z.number().nonnegative(),
    moveJumps: z.number().int().nonnegative(),
    moveCost: money,
    tiers: z.array(tierSchema).min(1),
    /** Как зовут безымянный вольный отряд. `{n}` — его номер. */
    freeName: z.string().min(1),
    /** Сколько отрядов в среднем формируется за декаду на освободившиеся места. */
    formationPerTick: z.number().nonnegative(),
    $comment20: comment,
    $comment21: comment,
    $comment22: comment,
    $comment23: comment,
    regiment: z
      .object({
        commissionChance: z.number().min(0).max(1),
        /** Какую долю состава полк выводит на подряд: батальон, а не всё сразу. */
        deployShare: range,
        /** Гонорар за машину выведенного состава — платит наниматель из военного фонда. */
        feePerMech: money,
        /** Во что полку обходится замена машины. */
        mechCost: money,
        /** Доля кассы, которую полк за такт вкладывает в пополнение. */
        repairShare: z.number().min(0).max(1),
        rebuildPerTick: z.number().min(0).max(1),
        /** Ниже этой доли канонического состава полк не падает: реестр MRBC не пустеет. */
        minShare: z.number().min(0).max(1),
        /** Во сколько раз сила противостоящей полку части отличается от него самого. */
        opposingShare: range,
        /** Шанс за декаду без подряда перелететь к миру у фронта (шаг 82). */
        moveChance: z.number().min(0).max(1),
        /** Досягаемость полка в прыжках: здесь он ищет мир для перелёта и цель подряда. */
        moveJumps: z.number().int().positive(),
        /** Затухание веса мира с расстоянием: 1 / (1 + прыжки / moveFalloffJumps). */
        moveFalloffJumps: z.number().positive(),
        /** Во сколько раз мир у фронта Дома `loyalTo` весит больше прочих. */
        loyaltyWeight: z.number().positive(),
        /** Доля противостоящей части против клана: подряд берут при составе 1 к 2 (шаг 82). */
        clanOpposingShare: z.number().positive(),
        /** Наём полка державой роты (шаг 89, `rivals/hire.ts`). */
        hire: z
          .object({
            /** Цена найма за машину полка на декаду срока — из кассы роты разом. */
            pricePerMechDecade: money,
            /** Срок найма в декадах. */
            termDecades: z.number().int().positive(),
            /** Фонд державы против врага после вклада подряда — не выше стольких тактов её дохода. */
            fundCapTicks: z.number().nonnegative(),
          })
          .strict(),
      })
      .strict(),
    registry: z.array(registryUnitSchema).min(1),
    sealEmblem: z.number().int().nonnegative(),
    detachmentTier: z.string().min(1),
  })
  .strict();

export type RivalsTable = z.infer<typeof rivalsFileSchema>;
export type RivalTier = z.infer<typeof tierSchema>;
export type RegistryUnit = z.infer<typeof registryUnitSchema>;

export const RIVALS: RivalsTable = (() => {
  try {
    const table = rivalsFileSchema.parse(rivalsJson);

    // Ссылки внутри таблицы проверяются один раз здесь, а не всплывают потом
    // отрядом без герба или ступенью, которой нет.
    const tiers = new Set(table.tiers.map((t) => t.id));
    if (!tiers.has(table.detachmentTier)) {
      throw new Error(`ступень откомандирования «${table.detachmentTier}» не значится в tiers`);
    }
    const seen = new Set<number>();
    for (const unit of table.registry) {
      if (seen.has(unit.emblem)) {
        throw new Error(`герб ${unit.emblem} занят дважды (${unit.id})`);
      }
      seen.add(unit.emblem);
      if (unit.great === undefined && (unit.tier === undefined || !tiers.has(unit.tier))) {
        throw new Error(`у отряда ротного масштаба «${unit.id}» нет годной ступени`);
      }
      if (unit.great !== undefined && unit.tier !== undefined) {
        throw new Error(`отряд «${unit.id}» и полк, и ротного масштаба разом — выберите одно`);
      }
      if (unit.great !== undefined && !GALAXY.has(unit.great.baseSystemId)) {
        throw new Error(`база полка «${unit.id}» — «${unit.great.baseSystemId}» — не значится в каталоге систем`);
      }
      const loyal = unit.great?.loyalTo;
      if (loyal !== undefined && !FACTIONS.has(loyal)) {
        throw new Error(`полк «${unit.id}» верен фракции «${loyal}», которой нет в factions.json`);
      }
    }
    if (seen.has(table.sealEmblem)) {
      throw new Error(`ячейка печати MRBC ${table.sealEmblem} занята отрядом`);
    }

    // Полк обязан быть хоть один: иначе верх реестра пуст, и «до чего тянуться»
    // ответа не имеет.
    if (!table.registry.some((u) => u.great !== undefined)) {
      throw new Error('в реестре нет ни одного великого полка');
    }
    return table;
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Ошибка в игровых данных (data/rivals.json):\n${detail}`);
  }
})();

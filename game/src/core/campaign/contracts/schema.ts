import { z } from 'zod';
import contractsJson from '../../../../data/contracts.json';
import relationsJson from '../../../../data/galaxy/relations.json';
import { QUALITY_CLASS_IDS, type QualityClass } from '../../model/QualityClass.js';
import { FACTION_KINDS, MARKET_CLASSES, type MarketClass } from '../galaxy/schema.js';

/**
 * Схемы контрактов (шаг 16) — `data/contracts.json` и `data/galaxy/relations.json`.
 *
 * Тот же порядок, что у рынка (`market/schema.ts`) и галактики
 * (`galaxy/schema.ts`): своя схема на таблицу, разбор один раз при загрузке
 * модуля, строгие объекты. Опечатка в имени фракции или в типе миссии
 * останавливает загрузку здесь, а не всплывает пустой биржей через месяц.
 *
 * Файлы лежат в кампании, а не в `core/data/tables.ts`, по той же причине, что
 * и `market.json`: класс рынка и вид актора — понятия кампании, а боевому ядру
 * запрещено импортировать `core/campaign/` (решение 1 §2 пайплайна).
 */

const comment = z.string().optional();
const nonNeg = z.number().nonnegative();
const share = z.number().min(0).max(1);

// --- relations.json -----------------------------------------------------------

/**
 * Вражда — число 0..1 и СИММЕТРИЧНАЯ величина: «кто с кем воюет», а не «как
 * относятся к отряду». Второе — репутация (шаг 20), и она эту таблицу
 * перекроет, а не заменит.
 */
const enmity = z.number().min(0).max(1);

const kindPairSchema = z
  .object({ $note: comment, a: z.enum(FACTION_KINDS), b: z.enum(FACTION_KINDS), enmity })
  .strict();

const factionPairSchema = z
  .object({ $note: comment, a: z.string().min(1), b: z.string().min(1), enmity })
  .strict();

/**
 * Полосы живого отношения (шаг 26) — пороги, по которым число −1..+1
 * превращается в слово. Наружу идёт полоса, внутрь — число: та же дисциплина,
 * что у полосы достатка (`war.json` → `prosperity.bands`) и полосы гарнизона.
 *
 * Полос шесть, порогов пять: ниже `feud` — «война», выше `alliance` — «союз».
 */
const relationBandsSchema = z
  .object({
    feud: z.number().min(-1).max(1),
    cold: z.number().min(-1).max(1),
    neutral: z.number().min(-1).max(1),
    accord: z.number().min(-1).max(1),
    alliance: z.number().min(-1).max(1),
  })
  .strict();

/**
 * Насколько событие двигает пару в матрице (шаг 26). Все величины
 * ПОЛОЖИТЕЛЬНЫЕ: знак задаёт не таблица, а то место, которое подвижку
 * применяет, — иначе «вниз» и «вверх» пришлось бы читать по минусу в данных.
 */
const relationMovesSchema = z
  .object({
    $note: comment,
    /** Мир обложен данью и дань принята: подчинение — способ не воевать. */
    tribute: z.number().nonnegative(),
    /** Заключён торговый договор или перемирие. */
    pact: z.number().nonnegative(),
    /** Установлен протекторат: сюзерен и вассал не воюют по определению. */
    protectorate: z.number().nonnegative(),
    /** Обе стороны наступали на третью в одну декаду — «враг моего врага». */
    commonEnemy: z.number().nonnegative(),
    /** Набег на чужого данника: вниз. */
    raidOnTributary: z.number().nonnegative(),
    /** Договор разорван: вниз, и сильнее, чем он поднял. */
    pactBroken: z.number().nonnegative(),
  })
  .strict();

export const relationsFileSchema = z
  .object({
    $comment: comment,
    $comment2: comment,
    $comment3: comment,
    $comment4: comment,
    $comment5: comment,
    $comment6: comment,
    bands: relationBandsSchema,
    moves: relationMovesSchema,
    default: enmity,
    kinds: z.array(kindPairSchema),
    pairs: z.array(factionPairSchema),
  })
  .strict();

export type RelationsFile = z.infer<typeof relationsFileSchema>;

// --- contracts.json -----------------------------------------------------------

const byMarketClass = <T extends z.ZodTypeAny>(value: T) =>
  z.object(Object.fromEntries(MARKET_CLASSES.map((c) => [c, value])) as Record<MarketClass, T>).strict();

/** Веса классов исполнения. Ноль — «у такой части этого не бывает вовсе». */
const qualityWeights = z
  .object(
    Object.fromEntries(QUALITY_CLASS_IDS.map((id) => [id, nonNeg])) as Record<QualityClass, typeof nonNeg>,
  )
  .strict();

export const MISSION_TYPES = ['garrison', 'recon', 'raid', 'defense', 'assault'] as const;
export type MissionType = (typeof MISSION_TYPES)[number];

export const OPFOR_TYPES = ['militia', 'line', 'guard', 'clan'] as const;
export type OpforType = (typeof OPFOR_TYPES)[number];

/**
 * Ступени масштаба работы (шаг 44, план Б), от патруля до батальона.
 *
 * Порядок списка — это шкала: `maxScale` типа работы отсекает всё, что правее,
 * и потому разведка боем не бывает ротной, а оборона ключевого мира бывает.
 */
export const SCALE_IDS = ['patrol', 'lance', 'reinforced', 'company', 'battalion'] as const;
export type ScaleId = (typeof SCALE_IDS)[number];

/**
 * Задача боя (шаг 19b) — зеркало `BattleObjective` из боевого ядра.
 *
 * Объявлена здесь заново, а не выведена из типа ядра: схема разбирает ДАННЫЕ, а
 * тип ядра — это то, во что данные превращаются. Полнота проверяется тем же
 * способом, что и везде, — строгим объединением по `kind`, и опечатка в имени
 * задачи останавливает загрузку здесь, а не всплывает боем без условия победы.
 */
const objectiveSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('destroy') }).strict(),
  z.object({ kind: z.literal('hold'), rounds: z.number().int().positive() }).strict(),
  z.object({ kind: z.literal('cripple'), share: z.number().gt(0).max(1) }).strict(),
  z.object({ kind: z.literal('destroyTargets') }).strict(),
  z.object({ kind: z.literal('protectTargets'), rounds: z.number().int().positive() }).strict(),
]);

const missionSchema = z
  .object({
    /**
     * Наступает наниматель этим типом работы или обороняется (шаг 21b):
     * +1 наступление, −1 оборона, 0 разведка. Вес типа на бирже зависит от того,
     * чья на участке инициатива (`war/front.ts::initiativeOf`).
     */
    posture: z.number().int().min(-1).max(1),
    /**
     * Чьё поле (шаг 73a): `enemy` — земля противника, где бывают засады и
     * огневые точки; `own` — земля нанимателя.
     */
    field: z.enum(['enemy', 'own']),
    /** Шанс, что наниматель выведет рядом с ротой своё звено (шаг 73b). */
    allyChance: share,
    /** Порог вражды из `relations.json`, ниже которого такой работы не бывает. */
    enmityMin: enmity,
    /**
     * Потолок масштаба для этого типа работы (шаг 44, план Б).
     *
     * Число машин противника разыгрывается лестницей `opfor.scales`, но не всякая
     * работа бывает любого размера: разведка боем и гарнизонная служба кончаются
     * копьём, рейд — усиленным отрядом, а батальон бывает только там, где идёт
     * оборона ключевого мира или штурм.
     */
    maxScale: z.enum(SCALE_IDS),
    /**
     * Нижняя ступень масштаба для этого типа работы (шаг 56). Не задана — любая.
     *
     * Заведена против казуса смотра биржи: «Штурм» (глубина вражды 0.75, самый
     * дорогой тип работы) выпадал патрульным масштабом против ОДНОЙ машины, а
     * «Оборона ключевой системы» — против одной в четверти случаев. Лестница
     * `opfor.scales` одна на все типы, и патрульная ступень весит на ней больше
     * всех; без нижней границы тяжёлый тип работы читался как насмешка.
     */
    minScale: z.enum(SCALE_IDS).optional(),
    /**
     * ЕДИНСТВЕННЫЙ множитель типа работы к оплате (шаг 56).
     *
     * До шага 56 их было два: рядом жило поле `strength`, множившее цену второй
     * раз (гарнизон ×0.49 и штурм ×3.30 вместо ×0.70 и ×1.65). Смысл у второго
     * множителя был до шага 44, пока `strength` правила ЧИСЛО машин противника;
     * когда число стало свойством предложения, скидка осталась висеть ни за что.
     * Подробности и замер — `data/contracts.json` → `missions.$comment3`.
     */
    payFactor: z.number().positive(),
    days: z.number().int().positive(),
    advanceShare: share,
    salvageShare: share,
    penaltyShare: nonNeg,
    /** Чем этот тип миссии отличается ВНУТРИ боя (шаг 19b). */
    objective: objectiveSchema,
  })
  .strict();

const opforTypeSchema = z
  .object({
    /** Грубая мера боевой силы одной машины такой части — ТОЛЬКО для оценки до боя. */
    threat: z.number().positive(),
    quality: qualityWeights,
    /** Комплектность: сколько брони и навески у такой части на самом деле есть (`mech/outfit.ts`). */
    outfit: z
      .object({
        armorShare: z.tuple([share, share]),
        missingItems: z.tuple([z.number().int().min(0), z.number().int().min(0)]),
      })
      .strict(),
    pilotTierMin: z.number().int().min(1),
    pilotTierMax: z.number().int().min(1),
  })
  .strict();

export const contractsFileSchema = z
  .object({
    $comment: comment,
    $comment2: comment,
    $comment3: comment,
    $comment4: comment,
    board: z
      .object({
        $comment: comment,
        decadeDays: z.number().int().positive(),
        offersByClass: byMarketClass(z.number().int().min(0)),
        hpgBonus: z.number().int().min(0),
        blackMarketBonus: z.number().int().min(0),
        minEnmity: enmity,
        $comment2: comment,
        $comment3: comment,
        $comment4: comment,
        /** Насколько напряжённость участка поднимает вражду, которую видит биржа (шаг 21b). */
        tensionEnmity: nonNeg,
        /** Насколько разорение мира сушит его биржу (шаг 21b, решение 6). */
        ruinWeight: share,
        $comment5: comment,
        $comment6: comment,
        /** Сколько предложений добавляет горячая граница сверх обычной работы (шаг 21b). */
        frontOffers: nonNeg,
        frontOffersMax: z.number().int().min(0),
        $commentWarWork: comment,
        /** Сколько работ державы против владельца выставляет мир врага в войне (шаг 90). */
        warWorkOffers: z.number().int().min(0),
        /** Насколько инициатива на участке двигает вес типа миссии (шаг 21b). */
        posturePull: nonNeg,
        $commentLocals: comment,
        $commentLocals2: comment,
        $commentNovice: comment,
        /** Доля предложений, которую разбирают местные отряды и которая до биржи не доходит. */
        localsTake: z.number().min(0).max(1),
        /** Работа новичку (2026-10-04): доля пиратских предложений сверх обычных при известности 0. */
        noviceOffers: z.number().min(0),
        /** Известность, к которой прибавка новичку сходит на нет. */
        noviceFame: z.number().positive(),
        enemyRangeJumps: z.number().int().min(1),
      })
      .strict(),
    $commentPirates: comment,
    $commentPirates2: comment,
    /** Пиратский тыл (шаг 37): где вольница бывает, а где её вытесняют регулярные части. */
    pirates: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        $comment4: comment,
        $comment5: comment,
        $comment6: comment,
        /** Степень спада пиратского риска по фронтовому индексу. */
        frontierPower: z.number().positive(),
        /** Насколько напряжённость участка поднимает фронтовой индекс. */
        tensionBoost: nonNeg,
        /** Гарнизон (шкала профиля 0-5), при котором набег не окупается вовсе. */
        garrisonFull: z.number().positive(),
        byMarketClass: byMarketClass(nonNeg),
        blackMarketBonus: nonNeg,
        rimBonus: nonNeg,
        ruinWeight: share,
        $comment7: comment,
        $comment8: comment,
        $comment9: comment,
        $comment10: comment,
        $comment11: comment,
        /** Зачистка (шаг 37a): сколько вычищенности даёт один выигранный подряд. */
        clearPerWin: share,
        /** Доля того же приращения соседям за один прыжок. */
        clearNeighbourShare: share,
        /** Насколько вычищенность зарастает за декаду. */
        regrowPerTick: share,
        /** Сколько попыток набега разыгрывается за декаду по всей карте. */
        raidsPerTick: z.number().int().min(0),
        /** Множитель успеха набега к пиратскому риску цели. */
        raidSuccess: share,
        raidRuinMin: share,
        raidRuinMax: share,
        $comment13: comment,
        /** С какой вероятностью прорвавшийся набег сбивает ступень развития мира. */
        raidSackChance: share,
        $comment14: comment,
        /** Награда за логово (шаг 72f): предложений против вольницы на её собственном мире. */
        bountyOffers: z.number().int().min(0),
        $comment15: comment,
        /** Пираты у дома (шаг 89): сколько декад после прорыва на мире роты висит работа обороны. */
        homeRaidDecades: z.number().int().min(1),
      })
      .strict(),
    missions: z
      .object(Object.fromEntries(MISSION_TYPES.map((m) => [m, missionSchema])) as Record<
        MissionType,
        typeof missionSchema
      >)
      .extend({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        $comment4: comment,
        $comment5: comment,
        $comment6: comment,
      })
      .strict(),
    opfor: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        $comment5: comment,
        types: z
          .object(Object.fromEntries(OPFOR_TYPES.map((t) => [t, opforTypeSchema])) as Record<
            OpforType,
            typeof opforTypeSchema
          >)
          .strict(),
        $comment4: comment,
        threatByQuality: z
          .object(
            Object.fromEntries(QUALITY_CLASS_IDS.map((id) => [id, z.number().positive()])) as Record<
              QualityClass,
              z.ZodNumber
            >,
          )
          .strict(),
        supply: z
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
            link: nonNeg,
            mid: z.number().positive(),
            militaryMid: nonNeg,
            militaryWeight: nonNeg,
            ruinWeight: nonNeg,
            min: z.number().positive(),
            max: z.number().positive(),
            guardShift: nonNeg,
            militiaBelow: z.number(),
            countShift: nonNeg,
            threatShift: nonNeg,
            armorShift: nonNeg,
            missingShift: nonNeg,
          })
          .strict(),
        guardFrom: z.number().int().min(0),
        garrisonWeight: nonNeg,
        strengthSpread: share,
        maxUnits: z.number().int().positive(),
        $comment6: comment,
        threatNumbersPower: z.number().min(1),
        power: z
          .object({
            $comment: comment,
            $comment2: comment,
            $comment3: comment,
            model: z.enum(['tonnage', 'power']),
            ranges: z.array(z.number().int().positive()).min(1),
            fieldToHit: z.number(),
            samples: z.number().int().positive(),
            reference: z.number().positive(),
          })
          .strict(),
        simple: z
          .object({
            $comment: comment,
            clanFactor: z.number().positive(),
          })
          .strict(),
        $commentScales: comment,
        $commentScales2: comment,
        scales: z
          .array(
            z
              .object({
                id: z.enum(SCALE_IDS),
                units: z.tuple([z.number().int().positive(), z.number().int().positive()]),
                base: nonNeg,
                perGarrison: nonNeg,
                perTension: nonNeg,
                garrisonMin: nonNeg,
              })
              .strict(),
          )
          .nonempty(),
        $commentSector: comment,
        $commentSector2: comment,
        sector: z
          .object({
            minScale: z.enum(SCALE_IDS),
            minTension: share,
            missions: z.array(z.enum(MISSION_TYPES)).nonempty(),
          })
          .strict(),
        $commentTons: comment,
        $commentTons2: comment,
        tons: z
          .object({
            byType: z
              .object(
                Object.fromEntries(
                  OPFOR_TYPES.map((id) => [
                    id,
                    z.tuple([z.number().positive(), z.number().positive()]),
                  ]),
                ) as Record<OpforType, z.ZodTuple<[z.ZodNumber, z.ZodNumber]>>,
              )
              .strict(),
            floor: share,
            perGarrison: nonNeg,
          })
          .strict(),
      })
      .strict(),
    payout: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        $comment4: comment,
        $comment5: comment,
        $comment9: comment,
        referenceShare: z.number().positive(),
        strengthWeight: nonNeg,
        garrisonBonus: nonNeg,
        spread: share,
        /** Опасность и оплата из одного источника (шаг 21b, решение 7). */
        opforReference: z.number().positive(),
        dangerWeight: nonNeg,
        $comment8: comment,
        forceReference: z.number().positive(),
        forceWeight: nonNeg,
        tensionBonus: nonNeg,
        byMarketClass: byMarketClass(z.number().positive()),
      })
      .strict(),
    /**
     * ДОСТОВЕРНОСТЬ РАЗВЕДДАННЫХ (шаг 57): насколько объявленному составу
     * противника можно верить и как широко он гуляет на вылете.
     *
     * Разброс разыгрывается в `contracts/opfor.ts::actualForce` — НА ВЫЛЕТЕ, а
     * не при рождении предложения. Цена и читаемая опасность считаются по
     * объявленным числам, иначе гонорар выдавал бы сюрприз до подписи.
     */
    intel: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        $comment4: comment,
        $comment5: comment,
        $comment6: comment,
        $comment7: comment,
        base: share,
        hpgBonus: nonNeg,
        surveyedBonus: nonNeg,
        pirateTargetPenalty: nonNeg,
        tensionPenalty: nonNeg,
        standingWeight: nonNeg,
        missionShift: z
          .object(
            Object.fromEntries(MISSION_TYPES.map((m) => [m, z.number()])) as Record<
              MissionType,
              z.ZodNumber
            >,
          )
          .strict(),
        min: share,
        max: share,
        unitsSpread: nonNeg,
        tonsSpread: nonNeg,
        tonsStep: z.number().int().positive(),
        $comment8: comment,
        ambushChance: share,
      })
      .strict(),
    /** Огневые точки на поле противника (шаг 73c). */
    emplacements: z
      .object({
        $comment: comment,
        $comment2: comment,
        chance: share,
        countByScale: z
          .object(
            Object.fromEntries(
              SCALE_IDS.map((id) => [id, z.tuple([z.number().int().min(0), z.number().int().min(0)])]),
            ) as Record<(typeof SCALE_IDS)[number], z.ZodTuple<[z.ZodNumber, z.ZodNumber]>>,
          )
          .strict()
          .refine((c) => Object.values(c).every(([lo, hi]) => lo <= hi), {
            message: 'emplacements.countByScale: нижняя граница выше верхней',
          }),
        mix: z.record(z.string(), z.number().positive()),
      })
      .strict(),
    /** Укреплённая работа (шаг 73d). */
    fortified: z
      .object({
        $comment: comment,
        $comment2: comment,
        missions: z
          .object(
            Object.fromEntries(
              MISSION_TYPES.map((m) => [m, z.object({ chance: share, objective: objectiveSchema }).strict().optional()]),
            ) as Record<MissionType, z.ZodOptional<z.ZodObject<{ chance: typeof share; objective: typeof objectiveSchema }>>>,
          )
          .strict(),
        targets: z.tuple([z.number().int().min(1), z.number().int().min(1)]),
        targetKinds: z.array(z.string().min(1)).min(1),
        bunkersByScale: z
          .object(
            Object.fromEntries(
              SCALE_IDS.map((id) => [id, z.tuple([z.number().int().min(0), z.number().int().min(0)])]),
            ) as Record<(typeof SCALE_IDS)[number], z.ZodTuple<[z.ZodNumber, z.ZodNumber]>>,
          )
          .strict(),
        bunkerWeapons: z.record(z.string(), z.number().positive()),
        payFactor: z.number().positive(),
      })
      .strict(),
    /** Работа «только на поле» (шаг 74): надбавка к гонорару за обязательный выход на карту. */
    fieldOnly: z
      .object({
        $comment: comment,
        $comment2: comment,
        payBonus: z.number().min(0),
      })
      .strict(),
    /** Союзное звено нанимателя (шаг 73b). */
    allies: z
      .object({
        $comment: comment,
        $comment2: comment,
        maxShare: share,
        salvageFactor: share,
      })
      .strict(),
    /** Премия за разгром сверх задачи: множитель к оплате и прибавка к доле трофеев. */
    beyond: z
      .object({
        $comment: comment,
        $comment2: comment,
        payFactor: z.number().positive(),
        salvageBonus: share,
      })
      .strict(),
    lanceSize: z.number().int().positive(),
    /**
     * Сторона поля боя по числу машин на нём. Шаги читаются сверху вниз:
     * первый, в который силы помещаются, и задаёт размер.
     */
    map: z
      .object({
        $comment: comment,
        steps: z
          .array(
            z
              .object({ maxUnits: z.number().int().positive(), size: z.number().int().positive() })
              .strict(),
          )
          .min(1),
      })
      .strict(),
  })
  .strict();

export type ContractsFile = z.infer<typeof contractsFileSchema>;

function fail(what: string, err: unknown): never {
  const detail = err instanceof Error ? err.message : String(err);
  throw new Error(`Ошибка в данных контрактов (${what}):\n${detail}`);
}

function parse<T>(what: string, schema: { parse: (v: unknown) => T }, raw: unknown): T {
  try {
    return schema.parse(raw);
  } catch (err) {
    return fail(what, err);
  }
}

export const RELATIONS: RelationsFile = parse(
  'data/galaxy/relations.json',
  relationsFileSchema,
  relationsJson,
);

// Пороги полос отношения обязаны идти снизу вверх и лежать внутри −1..+1:
// перевёрнутая пара молча дала бы полосу, в которую не попадает ни одна пара
// фракций, и «союз» читался бы там, где идёт война. Проверка при загрузке, а не
// тестом: тест ловит это на минуту позже, чем игра.
{
  const b = RELATIONS.bands;
  if (!(b.feud < b.cold && b.cold < b.neutral && b.neutral < b.accord && b.accord < b.alliance)) {
    fail(
      'data/galaxy/relations.json',
      new Error(
        `пороги полос отношения не возрастают: ${b.feud}, ${b.cold}, ${b.neutral}, ${b.accord}, ${b.alliance}`,
      ),
    );
  }
}

export const CONTRACTS: ContractsFile = parse('data/contracts.json', contractsFileSchema, contractsJson);

// Каждый тип отряда обязан иметь хоть один класс исполнения с ненулевым весом:
// таблица без единого класса — это отряд без машин, и проверять такое тестом
// поздно (упадёт посреди генерации боя, а не при загрузке).
for (const type of OPFOR_TYPES) {
  const weights = CONTRACTS.opfor.types[type].quality;
  if (QUALITY_CLASS_IDS.every((c) => weights[c] === 0)) {
    fail('data/contracts.json', new Error(`тип отряда «${type}»: все классы исполнения с нулевым весом`));
  }
  const { pilotTierMin, pilotTierMax } = CONTRACTS.opfor.types[type];
  if (pilotTierMin > pilotTierMax) {
    fail('data/contracts.json', new Error(`тип отряда «${type}»: pilotTierMin больше pilotTierMax`));
  }
}

// Гарнизонная работа обязана быть доступна при нулевой вражде — иначе биржа
// пуста везде, где соседи не воюют, а это половина карты.
if (CONTRACTS.missions.garrison.enmityMin > CONTRACTS.board.minEnmity) {
  fail(
    'data/contracts.json',
    new Error(
      `missions.garrison.enmityMin = ${CONTRACTS.missions.garrison.enmityMin} выше board.minEnmity = ` +
        `${CONTRACTS.board.minEnmity}: при такой паре в системе бывают предложения, для которых нет ни одного типа миссии`,
    ),
  );
}

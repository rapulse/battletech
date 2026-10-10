import { z } from 'zod';
import { ZONE_IDS } from '../model/HitZone.js';
import { QUALITY_CLASS_IDS } from '../model/QualityClass.js';
import { REPAIR_WORKS } from './clock.js';
import { MISSION_TYPES, OPFOR_TYPES, SCALE_IDS } from './contracts/schema.js';
import { COMPANY_EMBLEM_COUNT, WAREHOUSE_ITEM_KINDS } from './company/types.js';
import { GALAXY_RULES } from './galaxy/catalog.js';
import { WORLD_FOCUSES } from './galaxy/schema.js';
import { BUILDING_KINDS, GOVERNOR_PRIORITIES, WAR } from './war/schema.js';
import { CAMPAIGN_STREAMS } from './rng.js';
import { CAMPAIGN_RULES_VERSION } from './state.js';
import type { CampaignSnapshot } from './save.js';

/**
 * Схемы сохранения кампании (game_core.md §8).
 *
 * Смысл тот же, что у схем данных: испорченный или устаревший файл
 * останавливает загрузку внятным сообщением здесь и сейчас, а не всплывает
 * через час игры кампанией без половины полей. Схемы строгие — лишние ключи
 * запрещены.
 */

const int = z.number().int();
const nonNeg = int.min(0);

const zoneIdSchema = z.enum(ZONE_IDS);
const qualityClassSchema = z.enum(QUALITY_CLASS_IDS);
const wearNodeSchema = z.enum(['reactor', 'frame']);

/**
 * Складская запись двух сортов (шаг 15): узел с классом и износом либо целая
 * установка. Схема стоит выше очереди задач намеренно — заказ с доставкой
 * несёт узел прямо в задаче.
 */
const warehousePartSchema = z
  .object({
    sort: z.literal('node'),
    id: z.string().min(1),
    node: wearNodeSchema,
    quality: qualityClassSchema,
    wear: z.number().nonnegative(),
    sourceTonnage: int.min(1),
    tier: int.min(1),
  })
  .strict();

const warehouseItemSchema = z
  .object({
    sort: z.literal('item'),
    id: z.string().min(1),
    itemId: z.string().min(1),
    kind: z.enum(WAREHOUSE_ITEM_KINDS),
  })
  .strict();

const warehouseEntrySchema = z.discriminatedUnion('sort', [warehousePartSchema, warehouseItemSchema]);

/**
 * Сборка машины. Объявлена ВЫШЕ очереди задач намеренно: с шага 19a работа
 * переоснащения несёт целевую сборку прямо в задаче, и схема задачи ссылается
 * на эту — то же соображение порядка, что и у складской записи выше.
 */
const mountedItemSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(WAREHOUSE_ITEM_KINDS),
    zone: zoneIdSchema,
    ammo: int.nullable().optional(),
  })
  .strict();

const mechQualitySchema = z.object({ reactor: qualityClassSchema, frame: qualityClassSchema }).strict();

const mechAssemblySchema = z
  .object({
    chassisCode: z.string().min(1),
    name: z.string().optional(),
    quality: mechQualitySchema.optional(),
    role: z.enum(['brawler', 'sniper', 'missile_boat', 'skirmisher', 'scout', 'juggernaut']),
    techBase: z.enum(['is', 'clan']),
    tonnage: int.min(1),
    armorTons: z.number().nonnegative(),
    armorZoneAllocation: z.record(zoneIdSchema, z.number()).optional(),
    items: z.array(mountedItemSchema),
  })
  .strict();

const scheduledTaskSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('debug'), label: z.string() }).strict(),
  z.object({ kind: z.literal('payroll') }).strict(),
  z.object({ kind: z.literal('medbayDone'), pilotId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('restTick') }).strict(),
  z
    .object({
      kind: z.literal('repairJob'),
      jobId: z.string().min(1),
      recordId: z.string().min(1),
      work: z.enum(REPAIR_WORKS),
      zone: zoneIdSchema.optional(),
      node: wearNodeSchema.optional(),
      targetClass: qualityClassSchema.optional(),
      partId: z.string().min(1).optional(),
      /** Переоснащение (шаг 19a): целевая сборка и занятые ею складские записи. */
      assembly: mechAssemblySchema.optional(),
      partIds: z.array(z.string().min(1)).optional(),
      /** Перекраска (шаг 50): раскраска, в которую красят. Нет — вернуть цвета происхождения. */
      paint: z.string().min(1).optional(),
      /** Наземный цех мира (шаг 87): работа на его стапеле. */
      workshop: z.string().min(1).optional(),
      cost: nonNeg,
    })
    .strict(),
  z.object({ kind: z.literal('travelLeg'), leg: nonNeg }).strict(),
  z.object({ kind: z.literal('surveyDone'), systemId: z.string().min(1) }).strict(),
  z
    .object({
      kind: z.literal('deliveryArrived'),
      orderId: z.string().min(1),
      part: warehousePartSchema,
    })
    .strict(),
  z.object({ kind: z.literal('contractExpired'), contractId: z.string().min(1) }).strict(),
  z.object({ kind: z.literal('baysUpgraded'), to: int.min(1) }).strict(),
  z.object({ kind: z.literal('hangarUpgraded'), to: int.min(1) }).strict(),
  z.object({ kind: z.literal('decayTick') }).strict(),
  z.object({ kind: z.literal('economyTick') }).strict(),
  z.object({ kind: z.literal('frontTick') }).strict(),
  z.object({ kind: z.literal('developmentTick') }).strict(),
  z.object({ kind: z.literal('eventTick') }).strict(),
  z.object({ kind: z.literal('rivalTick') }).strict(),
]);

const scheduledEventSchema = z
  .object({
    day: int,
    seq: nonNeg,
    task: scheduledTaskSchema,
  })
  .strict();

/**
 * Состояния потоков ГПСЧ.
 *
 * Ключи выводятся из `CAMPAIGN_STREAMS`, а не переписываются руками: список
 * потоков растёт шагами 11–16, и второй список тех же имён рано или поздно
 * разошёлся бы с первым.
 */
const rngStateSchema = z.record(z.enum(CAMPAIGN_STREAMS), nonNeg);

// --- рота (шаг 13) ------------------------------------------------------------

const zoneConditionSchema = z
  .object({
    armor: z.number(),
    structure: z.number(),
    destroyed: z.boolean(),
  })
  .strict();

const mechConditionSchema = z
  .object({
    zones: z.array(zoneConditionSchema),
    destroyedSlots: z.array(z.array(nonNeg)),
    ammo: z.array(int.nullable()),
    destroyedMounts: z.array(z.boolean()),
    /**
     * Кустарные латки по зонам (шаг 33). Необязательное поле: сохранения,
     * сделанные до шага, его не имеют и читаются как машина без латок.
     */
    patchedZones: z.array(z.boolean()).optional(),
    /**
     * Запас прочности каркаса (шаг 66). Необязательное поле: сохранения,
     * сделанные до шага, его не имеют и читаются как машина без накопленного
     * запаса — ровно как `patchedZones`.
     */
    frameLossCount: nonNeg.optional(),
  })
  .strict();

const mechRecordSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    assembly: mechAssemblySchema,
    condition: mechConditionSchema,
    wear: z.object({ reactor: z.number().nonnegative(), frame: z.number().nonnegative() }).strict(),
    pilotId: z.string().nullable(),
    battles: nonNeg,
    /**
     * Происхождение и перекраска (шаг 50). Необязательные: сохранения до шага их
     * не имеют и читаются как машины своей роты в своей раскраске.
     */
    originFaction: z.string().min(1).optional(),
    paint: z.string().min(1).optional(),
  })
  .strict();

const skillMapSchema = z.record(z.string(), z.number());

const pilotSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    callsign: z.string(),
    origin: z.string(),
    affiliation: z.string().min(1),
    gender: z.enum(['male', 'female']),
    face: nonNeg,
    skills: skillMapSchema,
    caps: skillMapSchema,
    xp: skillMapSchema,
    injuries: nonNeg,
    status: z.enum(['active', 'out', 'ejected', 'lost']),
    firstBattle: z.boolean(),
  })
  .strict();

const companySchema = z
  .object({
    cbills: int,
    mechs: z.array(mechRecordSchema),
    pilots: z.array(pilotSchema),
    warehouse: z.array(warehouseEntrySchema),
    bays: int.min(1),
    bankrupt: z.boolean(),
    bankruptDay: int.nullable(),
    emblem: nonNeg.max(COMPANY_EMBLEM_COUNT - 1),
    commander: z.string().min(1),
    dropship: z.enum(['leopard', 'union', 'overlord']).default('leopard'),
    /** Непогашенный заём Гильдии (шаг 35). Нет поля — долга нет. */
    loan: z.object({ debt: nonNeg, installment: nonNeg }).strict().optional(),
    /** Долг по кредитам песочницы (шаг 74). Нет поля — долга нет. */
    sandboxDebt: nonNeg.optional(),
    /** Открытые ячейки ангара (шаг 75). */
    hangar: int.min(1),
  })
  .strict();

// --- галактика (шаг 14) -------------------------------------------------------

const travelSchema = z
  .object({
    path: z.array(z.string().min(1)).min(2),
    legIndex: nonNeg,
    startDay: int,
    arrivalDay: int,
    cost: nonNeg,
  })
  .strict();

/**
 * Дельта системы. Каталог и профиль в сохранение НЕ попадают — там только то,
 * чем мир отличается от выводимого (решение 4 §2 `часть2-pipeline.md`).
 */
const systemDeltaSchema = z
  .object({
    owner: z.string().min(1).optional(),
    ruined: z.number().min(0).max(1).optional(),
    /** Вычищенность от вольницы (шаг 37a): здесь поработал наёмный отряд. */
    cleared: z.number().min(0).max(1).optional(),
    development: z
      .number()
      .int()
      .min(GALAXY_RULES.profile.development.min)
      // Космопорт роты поднимает потолок мира (`galaxy/profile.ts::developmentMaxAt`). Проверка при разборе, а
      // не при сборке схемы: ручку правит на лету зонд замера.
      .refine((v) => v <= GALAXY_RULES.profile.development.max + WAR.buildings.spaceportDevelopMax, {
        message: 'развитие выше потолка',
      })
      .optional(),
    /** Фокус мира — отклонение от естественного (шаг 25, часть A). */
    focus: z.enum(WORLD_FOCUSES).optional(),
    focusTo: z.enum(WORLD_FOCUSES).optional(),
    focusUntil: int.optional(),
    /** Дань (шаг 26): кому мир платит и до какого дня. Снимаются вместе. */
    tribute: z.string().min(1).optional(),
    tributeUntil: int.optional(),
    /** Своя доля дани мира (шаг 90, лен). */
    tributeShare: z.number().min(0).max(1).optional(),
    /** Столица державы роты (шаг 72a): день, когда её перенесли на этот мир (72b). */
    realmCapitalSince: int.optional(),
    realmCapital: z.literal(true).optional(),
    abandonedUntil: int.optional(),
    /** Лояльность мира роты (шаг 85): у кого получен и с какого дня восстал. */
    loyalty: z.number().min(0).max(100).optional(),
    formerOwner: z.string().min(1).optional(),
    revoltSince: int.optional(),
    /** Пираты у дома (шаг 89): до какого дня висит оборона против вольницы. */
    raidedUntil: int.optional(),
    /** Победы работы державы над владельцем мира (шаг 90): право флага на мир врага. */
    realmWon: nonNeg.optional(),
    /** Постройки роты (шаг 87): готовые, идущая стройка и её очки. */
    buildings: z.array(z.enum(BUILDING_KINDS)).optional(),
    building: z.enum(BUILDING_KINDS).optional(),
    buildProgress: nonNeg.optional(),
    /** Память мира о роте (шаг 27a, часть B): бои, победы, наниматель, год. */
    fought: nonNeg.optional(),
    foughtWon: nonNeg.optional(),
    foughtFor: z.string().min(1).optional(),
    foughtYear: int.optional(),
    surveyed: z.boolean().optional(),
    visited: z.boolean().optional(),
    boughtDecade: int.optional(),
    bought: z.array(z.string().min(1)).optional(),
    takenDecade: int.optional(),
    taken: z.array(z.string().min(1)).optional(),
  })
  .strict();

// --- контракты (шаг 16) -------------------------------------------------------

/**
 * Взятый контракт. Биржа в снимок не попадает — она выводится (`contracts/board.ts`);
 * здесь лежит ровно то, что подписано, и оно обязано пережить смену декады.
 */
const contractSchema = z
  .object({
    id: z.string().min(1),
    systemId: z.string().min(1),
    employer: z.string().min(1),
    target: z.string().min(1),
    enmity: z.number().min(0).max(1),
    mission: z.enum(MISSION_TYPES),
    opforType: z.enum(OPFOR_TYPES),
    opforTechBase: z.enum(['is', 'clan']),
    /** Снабжение части противника (шаг 21a): подписано вместе с контрактом. */
    supply: z.number().positive(),
    /** Напряжённость участка (шаг 21b): из неё взяты и опасность, и оплата. */
    tension: z.number().min(0).max(1),
    strength: z.number().positive(),
    /** Силы противника, записанные в предложении (шаг 44, план Б). */
    opforUnits: int.min(1),
    opforTons: z.number().positive(),
    /** Достоверность разведданных (шаг 57), 0..1. */
    intel: z.number().min(0).max(1),
    scale: z.enum(SCALE_IDS),
    /** Что стоит на кону (шаг 44e): обычная работа или судьба сектора. */
    stakes: z.enum(['none', 'sector']),
    biome: z.string().min(1),
    payout: nonNeg,
    advance: nonNeg,
    penalty: nonNeg,
    salvageShare: z.number().min(0).max(1),
    durationDays: int.min(1),
    offerUntil: int,
    /**
     * Искупительный контракт (2026-09-14): без оплаты и трофеев, плата —
     * отношение нанимателя. Поле необязательное и пишется только у таких
     * контрактов, поэтому сохранения, сделанные до него, читаются как есть.
     */
    atonement: z.literal(true).optional(),
    /** Подавить восстание на мире роты (шаг 85). */
    revolt: z.literal(true).optional(),
    homeRaid: z.literal(true).optional(),
    /** Работа державы на мире врага (шаг 90). */
    warWork: z.literal(true).optional(),
    /** Союзное звено нанимателя (шаг 73b). Необязательное — как `atonement`. */
    allies: z
      .object({
        units: int.min(1),
        opforType: z.enum(OPFOR_TYPES),
        techBase: z.enum(['is', 'clan']),
        supply: z.number().positive(),
        share: z.number().min(0).max(1),
      })
      .strict()
      .optional(),
    /** Укрепление (шаг 73d). Необязательное — как `allies`. */
    fortified: z
      .object({
        targets: z.array(z.string().min(1)).min(1),
        bunkers: z.array(z.array(z.string().min(1))),
      })
      .strict()
      .optional(),
  })
  .strict();

const activeContractSchema = z
  .object({
    contract: contractSchema,
    takenDay: int,
    deadlineDay: int,
    advancePaid: nonNeg,
    sortie: z
      .object({
        recordIds: z.array(z.string().min(1)).min(1),
        battleSeed: nonNeg,
        mapSeed: nonNeg,
      })
      .strict()
      .nullable(),
  })
  .strict();

// --- репутация (шаг 20) -------------------------------------------------------

/**
 * Три оси и матрица отношений фракций. Обе карты РАЗРЕЖЁННЫЕ: ключи в них
 * появляются только у того, что отличается от начального, поэтому схема
 * проверяет диапазон значений, а не список фракций — реестр акторов один
 * (`data/galaxy/factions.json`), и второй его копией схема быть не должна.
 */
const reputationSchema = z
  .object({
    standing: z.record(z.string().min(1), z.number().min(-100).max(100)),
    fame: z.number().min(0).max(100),
    reliability: z.number().min(0).max(100),
    relations: z.record(z.string().min(1), z.number().min(-1).max(1)),
  })
  .strict();

// --- война (шаг 21a) ----------------------------------------------------------

/**
 * Экономика фракций и военный фонд по направлениям.
 *
 * Карта экономик проверяется по диапазонам значений, а не по списку фракций:
 * реестр акторов один (`data/galaxy/factions.json`), и второй его копией схема
 * быть не должна — тем же правилом, что и репутация выше.
 *
 * Фонд — вложенная карта «откуда → против кого → сколько», и вложенность здесь
 * несёт смысл: направление НАПРАВЛЕНО. «Дэвион копит против Куриты» и «Курита
 * копит против Дэвиона» — два разных числа, в отличие от вражды и отношений,
 * которые описывают пару целиком.
 */
const warSchema = z
  .object({
    economy: z.record(
      z.string().min(1),
      z
        .object({
          treasury: z.number().nonnegative(),
          income: z.number(),
          upkeep: z.number().nonnegative(),
          worlds: nonNeg,
          /**
           * Промышленная мощность (шаг 25, часть B): сколько машин держава
           * способна построить за декаду. Целое по построению — на этом стоит
           * сходимость приращения с полным пересчётом.
           */
          capacity: z.number().nonnegative(),
          /**
           * РЕЗЕРВ (шаг 27): машины, ещё не отправленные на фронт. До шага 27
           * это была вся армия; теперь вся армия — это резерв плюс все театры
           * фракции, и всякое место, которому нужна держава целиком, зовёт
           * `totalArmy`.
           */
          army: z.number().nonnegative(),
          /** Подъёмная сила (шаг 27): машино-прыжков за декаду. */
          lift: z.number().nonnegative(),
        })
        .strict(),
    ),
    funds: z.record(z.string().min(1), z.record(z.string().min(1), z.number().nonnegative())),
    /**
     * ТЕАТРЫ (шаг 27): полевые полки по направлениям, «откуда → против кого →
     * сколько машин». Та же форма и та же разрежённость, что у военного фонда,
     * — и тот же смысл направленности: «Дэвион держит полки против Куриты» и
     * «Курита против Дэвиона» — два разных числа.
     */
    theaters: z.record(z.string().min(1), z.record(z.string().min(1), z.number().nonnegative())),
    /**
     * Замыслы государств (шаг 23, часть B). Карта разрежённая: запись есть,
     * пока наступление объявлено. Цель хранится ИМЕНЕМ системы, а не индексом
     * каталога, — индекс сдвинется при первом же его пополнении.
     */
    plans: z.record(
      z.string().min(1),
      z
        .object({
          against: z.string().min(1),
          target: z.string().min(1),
          fromDay: int,
          untilDay: int,
          taken: nonNeg,
        })
        .strict(),
    ),
    /**
     * Протектораты (шаг 26). Ключ — ВАССАЛ: сюзерен у вассала ровно один
     * (вассала вассала не бывает), а вассалов у сюзерена несколько.
     */
    vassals: z.record(
      z.string().min(1),
      z.object({ suzerain: z.string().min(1), sinceDay: int }).strict(),
    ),
    /**
     * Договоры пар (шаг 26). Ключ — пара (`factionPairKey`), а не направление:
     * договор описывает пару целиком, в отличие от военного фонда.
     */
    pacts: z.record(
      z.string().min(1),
      z.object({ kind: z.enum(['truce', 'trade']), untilDay: int }).strict(),
    ),
    /** Войны державы роты (шаг 76). Нет поля — войн нет; сохранения до шага его не несут. */
    playerWars: z
      .record(
        z.string().min(1),
        z
          .object({
            since: int,
            won: nonNeg,
            lost: nonNeg,
            offerUntil: int.optional(),
            lastOffensive: int.optional(),
            // Шаг 81: цель, кто объявил, усталость сторон и взятое ротой. Нет полей — сохранение до шага.
            goal: z
              .discriminatedUnion('kind', [
                z.object({ kind: z.enum(['worlds', 'tribute']), systems: z.array(z.string().min(1)).min(1) }).strict(),
                z.object({ kind: z.literal('humiliation') }).strict(),
              ])
              .optional(),
            byRealm: z.literal(true).optional(),
            fatigue: z.number().min(0).max(1).optional(),
            foeFatigue: z.number().min(0).max(1).optional(),
            taken: z.array(z.string().min(1)).optional(),
            // Шаг 83: цель фракции у войны, объявленной по угрозе. Нет поля — фракция ничего не требует.
            foeGoal: z.array(z.string().min(1)).min(1).optional(),
            // Шаг 91: день последнего наступления фракции на мир её цели.
            lastFoeOffensive: int.optional(),
          })
          .strict(),
      )
      .optional(),
    /** Доля итога державы в военный фонд (проект державы, шаг 2). Нет поля — ноль. */
    realmWarShare: z.number().min(0).max(1).optional(),
    /** Память захватов (шаг 83). */
    conquests: z.record(z.string().min(1), z.number().positive()),
    /** Сработавшие события мира (шаг 84). */
    events: z.record(
      z.string().min(1),
      z
        .object({
          day: int,
          pending: z.boolean(),
          realm: z.boolean(),
          invite: z
            .object({ against: z.string().min(1), allies: z.array(z.string().min(1)).min(1) })
            .strict()
            .optional(),
        })
        .strict(),
    ),
    /** Пары, с которых событие сняло перемирие Тукайида (шаг 84). */
    truceLifted: z.array(z.string().min(1)),
    /** Требования соседей к державе (шаг 89): открытая карточка и откат по соседям. Нет поля — требований не было. */
    demands: z
      .object({
        pending: z.object({ from: z.string().min(1), systemId: z.string().min(1), day: int }).strict().optional(),
        last: z.record(z.string().min(1), int),
        quiet: z.record(z.string().min(1), int).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

// --- соперники (шаг 22) --------------------------------------------------------

/**
 * Отряды-соперники.
 *
 * Схема переиспользует `companySchema` целиком и не заводит НИ ОДНОГО своего
 * описания машины, пилота или склада — и это не экономия строк, а проверка
 * главного решения шага: соперник — та же структура данных, что рота игрока.
 * Пришлось бы завести вторую — значит, модель выбрана неправильно.
 *
 * Список плотный: в отличие от дельт, репутации и военного фонда, здесь нет
 * понятия «отличается от начального».
 */
const rivalSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    /**
     * Отряд реестра MRBC, чьё имя и герб носит соперник. Пустая строка —
     * вольный отряд: в реестре он не значится, и ссылаться ему не на что.
     */
    unitId: z.string(),
    /** Ячейка набора НАЁМНИКОВ (`ui/mercenaries.jpg`); −1 — отряда нет в реестре MRBC. */
    emblem: int.min(-1),
    tier: z.string().min(1),
    registered: z.boolean(),
    company: companySchema,
    systemId: z.string().min(1),
    reputation: reputationSchema,
    contracts: nonNeg,
    wins: nonNeg,
    ratingBefore: z.number().nonnegative(),
  })
  .strict();

/**
 * Великий полк: состав, а не список записей.
 *
 * Полный парк семи полков весил бы в снимке больше всей остальной кампании
 * (замер шага 22c), поэтому полк хранится агрегатом и материализуется в машины
 * только на бой — той же границей точности, на которой стоят армии фракций.
 */
const regimentSchema = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    emblem: nonNeg,
    cert: z.string().min(1),
    base: z.string().min(1),
    holdsWorld: z.boolean(),
    fullMechs: int.min(1),
    mechs: int.min(0),
    /** Касса полка: гонорары за подряды, из них же чинится и докупается (шаг 22c). */
    cbills: z.number(),
    quality: z.enum(['recovered', 'standard', 'military', 'master']),
    tons: z.number().positive(),
    skill: z.number().positive(),
    systemId: z.string().min(1),
    /** Чей был мир, когда полк на него встал (шаг 82). */
    employer: z.string().min(1),
    contracts: nonNeg,
    wins: nonNeg,
    ratingBefore: z.number().nonnegative(),
    /** Наём державой роты (шаг 89): против кого и до какого дня. */
    hire: z.object({ against: z.string().min(1), until: nonNeg }).strict().optional(),
  })
  .strict();

const rivalsSchema = z
  .object({
    list: z.array(rivalSchema),
    regiments: z.array(regimentSchema),
    playerRatingBefore: z.number().nonnegative(),
    bankrupt: nonNeg,
    formed: nonNeg,
    nextId: nonNeg,
  })
  .strict();

export const campaignSnapshotSchema = z
  .object({
    rulesVersion: nonNeg,
    seed: nonNeg,
    day: int,
    companyName: z.string().min(1),
    /** Режим кампании (шаг 74). */
    mode: z.enum(['standard', 'sandbox']),
    nextSeq: nonNeg,
    queue: z.array(scheduledEventSchema),
    rng: rngStateSchema,
    company: companySchema,
    worldSeed: nonNeg,
    systemId: z.string().min(1),
    travel: travelSchema.nullable(),
    hireReadyDay: int,
    recruit: pilotSchema.nullable(),
    contract: activeContractSchema.nullable(),
    deltas: z.record(z.string().min(1), systemDeltaSchema),
    reputation: reputationSchema,
    war: warSchema,
    rivals: rivalsSchema,
    /** Достижения (шаг 69). */
    achievements: z
      .object({
        unlocked: z.array(z.object({ id: z.string().min(1), day: int }).strict()),
        kills: nonNeg,
      })
      .strict(),
    /** Гарнизоны миров из машин роты (шаг 86b). */
    garrison: z
      .object({
        posts: z.record(
          z.string().min(1),
          z.object({ systemId: z.string().min(1), arrives: int, depot: z.literal(true).optional() }).strict(),
        ),
        withdraw: z.array(z.string().min(1)),
      })
      .strict(),
    /** Секторы, губернаторы, резерв, закреплённые миры и стойки фронтов (шаг 88). */
    realm: z
      .object({
        sectors: z.array(
          z
            .object({
              center: z.string().min(1),
              governor: z.string().min(1).nullable(),
              priority: z.enum(GOVERNOR_PRIORITIES),
            })
            .strict(),
        ),
        pinned: z.array(z.string().min(1)),
        reserve: nonNeg,
        stances: z.record(z.string().min(1), z.enum(['advance', 'yield'])),
        /** Шаг 93: ручная принадлежность мира сектору и цели стоек; нет поля — нет записей. */
        assigned: z.record(z.string().min(1), z.string().min(1)).optional(),
        targets: z.record(z.string().min(1), z.string().min(1)).optional(),
      })
      .strict(),
  })
  .strict();

export const saveFileSchema = z
  .object({
    /** Метка формата: чужой JSON отсекается до разбора полей. */
    format: z.literal('battletech-campaign'),
    state: campaignSnapshotSchema,
  })
  .strict();

export type SaveFile = z.infer<typeof saveFileSchema>;

/** Сохранение записано другой версией правил и не будет подгоняться на ходу. */
export class IncompatibleSaveError extends Error {
  readonly fileVersion: number;
  readonly expected: number;

  constructor(fileVersion: number) {
    super(
      `Сохранение записано версией правил ${fileVersion}, ` +
        `текущая — ${CAMPAIGN_RULES_VERSION}. Загрузка отменена.`,
    );
    this.name = 'IncompatibleSaveError';
    this.fileVersion = fileVersion;
    this.expected = CAMPAIGN_RULES_VERSION;
  }
}

export function makeSaveFile(snap: CampaignSnapshot): SaveFile {
  return saveFileSchema.parse({ format: 'battletech-campaign', state: snap });
}

/**
 * Разбор файла сохранения.
 *
 * Две проверки, и они разные по смыслу: схема ловит испорченный файл,
 * версия — устаревший. Устаревший файл не чинится молча: подогнанное под новые
 * правила сохранение — это не совместимость, а тихо испорченная кампания.
 */
export function parseSaveFile(data: unknown): CampaignSnapshot {
  const file = saveFileSchema.parse(data);
  if (file.state.rulesVersion !== CAMPAIGN_RULES_VERSION) {
    throw new IncompatibleSaveError(file.state.rulesVersion);
  }
  return file.state as CampaignSnapshot;
}

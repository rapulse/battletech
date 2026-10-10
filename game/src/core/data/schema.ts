import { z } from 'zod';
import { ZONE_IDS } from '../model/HitZone.js';
import { QUALITY_CLASS_IDS } from '../model/QualityClass.js';
import { TERRAIN_IDS } from '../map/TerrainType.js';

/**
 * Схемы JSON-таблиц (game_core.md §8).
 *
 * Смысл не в типах — типы дал бы и `as const`. Смысл в том, что опечатка в данных
 * останавливает загрузку с внятным сообщением здесь и сейчас, а не всплывает через
 * месяц кривым балансом. Поэтому схемы строгие: лишние ключи запрещены, диапазоны
 * проверяются, ссылки между таблицами сверяются при сборке (см. tables.ts).
 */

/** Ключи с `$` — комментарии внутри JSON. Разрешены везде, в разбор не идут. */
const comment = z.string().optional();

/** Метка тепла от отвода машины: отвод × share + plus (`core/rules/heat.ts`). */
const heatMarkSchema = z.object({ share: z.number().nonnegative(), plus: z.number() }).strict();

const int = z.number().int();
const nonNeg = int.min(0);
const chance = z.number().min(0).max(1);
/** Таблица на 10 уровней навыка: элемент 0 — уровень 1. */
const level10 = <T extends z.ZodTypeAny>(item: T) => z.array(item).length(10);

const zoneIdSchema = z.enum(ZONE_IDS);

// --- terrain.json ------------------------------------------------------------

export const terrainEntrySchema = z
  .object({
    id: z.string().min(1),
    enterCost: nonNeg,
    objHeight: nonNeg,
    toHitMod: int,
    heatPerTurn: int,
    pilotingOnRun: z.boolean(),
    hardCover: z.boolean(),
    walkable: z.boolean(),
    partialCover: z.boolean(),
  })
  .strict();

/** Вклад динамического слоя в видимость и наводку. Ключ, а не порядок: биты маски менять нельзя. */
const overlayEntrySchema = z
  .object({ objHeight: nonNeg, toHitMod: int, blockPoints: nonNeg })
  .strict();

export const terrainFileSchema = z
  .object({
    $comment: comment,
    terrain: z.array(terrainEntrySchema).min(1),
    $comment2: comment,
    overlays: z
      .object({ smoke: overlayEntrySchema, fire: overlayEntrySchema, ice: overlayEntrySchema })
      .strict(),
    $comment3: comment,
    edges: z.object({ wallHeight: nonNeg }).strict(),
  })
  .strict();

// --- biomes.json -------------------------------------------------------------

/**
 * Биом — таблица перераспределения СУЩЕСТВУЮЩИХ типов рельефа, и ничего кроме.
 * Схема намеренно не даёт завести здесь ни новый тип, ни новое число правил:
 * `terrainId` — замкнутый перечень из `TerrainType`, и добавить в него что-то
 * из данных нельзя (шаг 9a, часть B).
 */
const terrainIdSchema = z.enum(TERRAIN_IDS);

/** Пара «тип рельефа — относительный вес». Веса нормируются при загрузке. */
const terrainWeightSchema = z.tuple([terrainIdSchema, z.number().min(0)]);

const moistureBandSchema = z
  .object({
    dry: z.array(terrainWeightSchema).min(1),
    normal: z.array(terrainWeightSchema).min(1),
    wet: z.array(terrainWeightSchema).min(1),
  })
  .strict();

export const biomeSchema = z
  .object({
    id: z.string().min(1),
    key: z.string().min(1),
    /** Имя набора рамп в palette.json. Свои цвета биом не заводит. */
    palette: z.string().min(1),
    elevation: z
      .object({
        /** Насколько высоко поднимается поле высот, в уровнях. */
        amplitude: int.min(0).max(5),
        /** Доля гребневого шума: 0 — округлые холмы, 1 — рваные хребты. */
        ridged: chance,
        /** Какая доля карты лежит ниже нуля — будущие низины и озёрные чаши. */
        lowlandShare: chance,
        /** Сколько крупных форм рельефа на карту любого размера. */
        macroForms: int.min(1).max(8),
      })
      .strict(),
    moisture: z.object({ mean: chance, spread: chance }).strict(),
    hydrology: z
      .object({
        /** Целевая доля клеток под водой. */
        lakeShare: chance,
        /** Сколько рек прокладывается. */
        rivers: nonNeg.max(4),
        /** Замерзают ли водоёмы: оверлей `ice` поверх воды. */
        frozen: z.boolean(),
      })
      .strict(),
    settlement: z.object({ roads: nonNeg.max(4) }).strict(),
    /**
     * Развалины — редкое компактное пятно (заброшенное поселение/поле боя), а не
     * диффузная скальная россыпь: та уже задаётся весами `terrain.*` через тип
     * `rubble` и здесь не участвует (шаг 9c, ревизия).
     */
    ruins: z
      .object({
        /** Вероятность того, что на КОНКРЕТНОЙ карте вообще появится хоть одно пятно. */
        chance: chance,
        /** Сколько пятен, если появились: от 1 до этого числа. */
        maxPatches: int.min(1).max(4),
        /** Целевой размер пятна в клетках. */
        patchSize: int.min(2).max(6),
      })
      .strict(),
    terrain: z
      .object({ low: moistureBandSchema, mid: moistureBandSchema, high: moistureBandSchema })
      .strict(),
  })
  .strict();

export const biomesFileSchema = z
  .object({ $comment: comment, $comment2: comment, biomes: z.array(biomeSchema).min(1) })
  .strict();

// --- weapons.json ------------------------------------------------------------

export const weaponSchema = z
  .object({
    id: z.string().min(1),
    code: z.string().min(1),
    key: z.string().min(1),
    techBase: z.enum(['is', 'clan']),
    category: z.enum(['energy', 'ballistic', 'missile']),
    mass: z.number().positive(),
    slots: int.min(1),
    damage: int.min(1),
    shots: int.min(1),
    cluster: z.boolean().default(false),
    short: int.min(1),
    medium: int.min(1),
    long: int.min(1),
    minRange: nonNeg,
    heat: nonNeg,
    ammo: int.min(1).nullable(),
    impact: nonNeg.default(0),
    toHitMod: int.default(0),
  })
  .strict()
  .refine((w) => w.short <= w.medium && w.medium <= w.long, {
    message: 'Дальности обязаны возрастать: short <= medium <= long',
  })
  .refine((w) => w.minRange < w.short, {
    message: 'Минимальная дальность обязана быть меньше близкой',
  });

export const weaponsFileSchema = z
  .object({ $comment: comment, weapons: z.array(weaponSchema).min(1) })
  .strict();

// --- combat.json -------------------------------------------------------------

// Ровная таблица — шесть зон, Above/Below — четыре: они вычёркивают невидимое,
// а не перевешивают оставшееся. Длина задана явно, чтобы «лишняя» зона в данных
// не превратилась молча в перекос долей.
const flatZoneTableSchema = z.array(zoneIdSchema).length(6);
const cutZoneTableSchema = z.array(zoneIdSchema).length(4);

export const combatFileSchema = z
  .object({
    $comment: comment,
    /** Разрешённые режимы движения: бег выключается одним флагом (решение 2026-09-08). */
    movement: z
      .object({
        $comment: comment,
        runAllowed: z.boolean(),
      })
      .strict(),
    toHit: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        $comment4: comment,
        maxSituational: int.min(1),
        $comment5: comment,
        indirectFire: int.min(0),
        $comment6: comment,
        indirectRequiresSpotter: z.boolean(),
        rangeShort: int,
        rangeMedium: int,
        rangeLong: int,
        minRangePenaltyPerHex: int,
        attackerMove: z.object({ still: int, walk: int, run: int, jump: int }).strict(),
        targetMove: z.array(z.object({ upTo: int, mod: int }).strict()).min(1),
        targetProne: int,
        targetPartialCover: int,
        attackerProne: int,
        maxTarget: int,
        minTarget: int,
      })
      .strict(),
    detection: z
      .object({
        $comment: comment,
        sensorRange: int.min(1),
        identifyRange: int.min(1),
        $comment2: comment,
        identifyPenaltyPerCover: nonNeg,
        identifyAfterShots: int.min(1),
        $comment3: comment,
        toHitBlip: int,
        toHitSilhouette: int,
        $comment4: comment,
        contactFloorAtSilhouette: z.boolean(),
      })
      .strict()
      .refine((d) => d.toHitBlip >= d.toHitSilhouette, {
        message: 'detection.toHitBlip обязан быть не меньше toHitSilhouette: по засветке стрелять труднее, чем по силуэту',
      }),
    hitLocation: z
      .object({
        $comment: comment,
        tables: z
          .object({ above: cutZoneTableSchema, level: flatZoneTableSchema, below: cutZoneTableSchema })
          .strict(),
        angle: z
          .object({
            $comment: comment,
            maxRange: int.min(1),
            arcingCategories: z.array(z.enum(['energy', 'ballistic', 'missile'])),
          })
          .strict(),
        headConfirm: z
          .object({ $comment: comment, confirmOn: int.min(0).max(6), glanceZone: zoneIdSchema })
          .strict(),
      })
      .strict(),
    damage: z
      .object({
        $comment: comment,
        massiveDamagePerTurn: int.min(1),
        fallDamagePerLevel: nonNeg,
        criticalOnStructureHit: z.boolean(),
      })
      .strict(),
    piloting: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        $comment4: comment,
        routineImmunitySkill: int.min(1).max(10),
        checksPerMove: int.min(1),
        massiveDamageCheck: z.boolean(),
        $comment5: comment,
        fallDamageByClass: z
          .object({ light: int.min(1), medium: int.min(1), heavy: int.min(1), assault: int.min(1) })
          .strict(),
        onHit: z.object({ massiveDamage: int, gyroHit: int, legActuatorHit: int }).strict(),
      })
      .strict(),
    critical: z
      .object({
        $comment: comment,
        chanceByCategory: z
          .object({
            ballistic: chance,
            missile: chance,
            energy: chance,
          })
          .strict(),
        reactor: z.object({ heatPerHit: nonNeg, maxHits: int.min(1) }).strict(),
        gyro: z.object({ pilotingPenaltyPerHit: nonNeg, maxHits: int.min(1) }).strict(),
        sensors: z.object({ toHitPenaltyPerHit: nonNeg }).strict(),
        actuators: z
          .object({ $comment: comment, toHitPenaltyPerHit: nonNeg, pilotingPenaltyPerHit: nonNeg })
          .strict(),
      })
      .strict(),
    /**
     * Пороги тепла — метки от отвода машины: отвод × share + plus
     * (`core/rules/heat.ts`). Общих чисел на всю игру здесь больше нет.
     */
    heat: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        hullReserve: z
          .object({ light: nonNeg, medium: nonNeg, heavy: nonNeg, assault: nonNeg })
          .strict(),
        runHeat: nonNeg,
        jumpHeatPerHex: nonNeg,
        shutdown: heatMarkSchema,
        ammoRisk: heatMarkSchema,
        ammoExplosionChance: chance,
        pilotRisk: heatMarkSchema,
        max: heatMarkSchema,
        toHitSteps: z.array(heatMarkSchema.extend({ mod: int })),
        mpPenaltySteps: z.array(heatMarkSchema.extend({ mp: nonNeg })),
      })
      .strict(),
    initiative: z.object({ $comment: comment }).strict(),
    /**
     * Мораль стороны (шаг 43). Все веса неотрицательны, знак задаёт не
     * таблица, а правило: давление складывается, стойкость вычитается.
     */
    morale: z
      .object({
        $comment: comment,
        $comment2: comment,
        enabled: z.boolean(),
        /** Раньше этого хода мораль не проверяется вовсе: бой ещё не начался. */
        checkFromTurn: z.number().int().positive(),
        /** Меньше этого числа машин В БОЮ — сторона не «отряд», и морали у неё нет. */
        minUnits: z.number().int().positive(),
        lossWeight: z.number().nonnegative(),
        damageWeight: z.number().nonnegative(),
        outnumberedWeight: z.number().nonnegative(),
        commanderWeight: z.number().nonnegative(),
        threshold: z.number().positive(),
        /** Уровень Хладнокровия, при котором поправки нет вовсе. */
        composureMid: z.number().nonnegative(),
        composureWeight: z.number().nonnegative(),
        /**
         * Сколько клеток от края карты уже считается «ушёл с поля».
         *
         * Ноль означал бы ровно крайний ряд, а крайний ряд бывает и водой, и
         * обрывом: машина упиралась бы в непроходимую клетку и торчала на поле
         * до потолка ходов. Единица — полоса, до которой можно дойти всегда.
         */
        exitBand: z.number().int().nonnegative(),
      })
      .strict(),
    ambush: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        spotRange: z.number().int().min(1),
        diagonal: z
          .object({ width: z.number().min(0), peak: z.number().gt(0).lt(1) })
          .strict(),
        band: z
          .object({ from: z.number().min(0).max(1), to: z.number().min(0).max(1) })
          .strict()
          .refine((b) => b.from < b.to, { message: 'ambush.band: from обязан быть меньше to' }),
        spacing: z.number().int().min(1),
      })
      .strict(),
    fortress: z
      .object({
        $comment: comment,
        band: z
          .object({ from: z.number().min(0).max(1), to: z.number().min(0).max(1) })
          .strict()
          .refine((b) => b.from < b.to, { message: 'fortress.band: from обязан быть меньше to' }),
        spacing: z.number().int().min(1),
      })
      .strict(),
    ai: z
      .object({
        $comment: comment,
        formationBaseLeash: nonNeg,
        formationLeashPerWalkMp: z.number().nonnegative(),
        $comment2: comment,
        objectiveWeight: z.number().positive(),
        objectivePull: nonNeg,
        objectiveGuard: nonNeg,
      })
      .strict(),
  })
  .strict();

// --- emplacements.json -------------------------------------------------------

/** Огневые точки и укрепления (шаги 73c, 73d): неподвижные установки. */
export const emplacementsFileSchema = z
  .object({
    $comment: comment,
    $comment2: comment,
    $comment3: comment,
    base: z.number().positive(),
    kinds: z
      .array(
        z
          .object({
            id: z.string().min(1),
            weapon: z.string().min(1),
            structure: z.number().positive(),
            ammo: z.number().int().positive().nullable(),
          })
          .strict(),
      )
      .min(1),
    structures: z
      .array(
        z
          .object({
            id: z.string().min(1),
            mounts: z.number().int().min(0),
            factor: z.number().positive(),
            objective: z.boolean(),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export type EmplacementKind = z.infer<typeof emplacementsFileSchema>['kinds'][number];
export type StructureKind = z.infer<typeof emplacementsFileSchema>['structures'][number];

// --- pilots.json -------------------------------------------------------------

const skillDefSchema = z
  .object({
    id: z.string().min(1),
    key: z.string().min(1),
    group: z.enum(['cockpit', 'personal']),
  })
  .strict();

/** Имена причин ранения — на них ссылаются поводы катапультирования. */
const injuryCauseId = z.enum([
  'headArmor',
  'headStructure',
  'massiveDamage',
  'fall',
  'heat',
  'ammoExplosion',
  'ejectVoluntary',
  'ejectTorso',
  'ejectHead',
]);

/**
 * Повод катапультироваться: шанс уйти, влияет ли на него обстановка, и по какой
 * причине бросается ранение при приземлении.
 */
const ejectionTrigger = z
  .object({
    base: chance,
    situational: z.boolean(),
    /** Свой нижний порог: у добровольного ухода он высокий, у кокпита низкий. */
    minChance: chance,
    injury: injuryCauseId,
  })
  .strict();

/**
 * Полоса найма: от какой ступени до какой и с каким весом каждая.
 *
 * Весов ровно столько, сколько ступеней в полосе, — иначе «чем лучше, тем реже»
 * молча перестаёт держаться на верхнем конце.
 */
const recruitBandSchema = z
  .object({
    minTier: int.min(1).max(10),
    maxTier: int.min(1).max(10),
    weights: z.array(int.min(0)).min(1),
    /** Потолок таланта этой полосы: докуда пилот вообще способен вырасти. */
    capMin: int.min(1).max(10),
    capMax: int.min(1).max(10),
  })
  .strict()
  .refine((b) => b.capMax >= b.capMin, { message: 'capMax полосы найма меньше capMin' })
  .refine((b) => b.maxTier >= b.minTier, { message: 'maxTier полосы найма меньше minTier' })
  .refine((b) => b.weights.length === b.maxTier - b.minTier + 1, {
    message: 'весов в полосе найма не столько, сколько ступеней',
  })
  .refine((b) => b.weights.some((w) => w > 0), { message: 'все веса полосы найма нулевые' });

/**
 * Каталог имён (`data/names.json`).
 *
 * Дома проверяются поимённо, а не `catchall`: пул имени обязан существовать для
 * каждой фракции-дома реестра, и опечатка в ключе должна падать здесь, а не
 * оборачиваться пилотом по имени `undefined` на третьем часу игры. Кланы — тем
 * же порядком: их четыре, ровно столько, сколько нарисовано портретов.
 */
const namePoolSchema = z
  .object({
    $comment: comment,
    male: z.array(z.string().min(1)).min(4),
    female: z.array(z.string().min(1)).min(4),
    family: z.array(z.string().min(1)).min(4),
  })
  .strict();

export const namesFileSchema = z
  .object({
    $comment: comment,
    $comment2: comment,
    sphere: z
      .object({
        davion: namePoolSchema,
        steiner: namePoolSchema,
        marik: namePoolSchema,
        liao: namePoolSchema,
        kurita: namePoolSchema,
      })
      .strict(),
    /**
     * У клановца только личное имя: фамилий у кланов нет, а родовое имя
     * (`bloodname`) — редкость, и его носитель не пойдёт в наёмники Сферы.
     * Именник общий на все кланы: имена клану не принадлежат, в отличие от
     * родовых имён.
     */
    clan: z
      .object({
        $comment: comment,
        $comment2: comment,
        given: z
          .object({
            male: z.array(z.string().min(1)).min(4),
            female: z.array(z.string().min(1)).min(4),
          })
          .strict(),
      })
      .strict(),
    /** Имена и позывные, которые ядро ставит само (шаг 52): имена собственные, не подписи. */
    defaults: z
      .object({
        $comment: comment,
        commander: z.string().min(1),
        companyName: z.string().min(1),
        opforCallsign: z.string().min(1),
        regimentCallsign: z.string().min(1),
        regimentFoeCallsign: z.string().min(1),
        frontAttackerCallsign: z.string().min(1),
        frontDefenderCallsign: z.string().min(1),
        rivalPilotCallsign: z.string().includes('{n}'),
        clanGiven: z.string().min(1),
        sphereGiven: z.string().min(1),
      })
      .strict(),
    /** База названий наёмных отрядов (шаг 74). Доступны для случайного выбора и переброса при старте. */
    companyNames: z.array(z.string().min(1)).min(10),
    companyNamesEn: z.array(z.string().min(1)).min(10),
    /** База позывных командиров (шаг 74). Доступны для случайного выбора и переброса при старте. */
    commanderNames: z.array(z.string().min(1)).min(10),
    commanderNamesEn: z.array(z.string().min(1)).min(10),
  })
  .strict();

export const pilotsFileSchema = z
  .object({
    $comment: comment,
    skills: z.array(skillDefSchema).min(1),
    $comment3: comment,
    tables: z
      .object({
        gunneryBase: level10(int.min(2).max(12)),
        pilotingTarget: level10(int.min(2).max(12)),
        composureBotch: level10(chance),
        tacticsInitiative: level10(int),
        tacticsNoise: level10(chance),
        enduranceInjuryMul: level10(z.number().min(0)),
      })
      .strict(),
    execution: z
      .object({
        $comment: comment,
        maxBotch: chance,
        situational: z
          .object({
            heatHigh: chance,
            heavyDamageThisTurn: chance,
            structureBreached: chance,
            fellThisTurn: chance,
            perInjury: chance,
            firstBattle: chance,
          })
          .strict(),
        poise: z
          .object({ $comment: comment, minLevel: int.min(1).max(10), chancePerLevelAbove: chance })
          .strict(),
      })
      .strict(),
    injury: z
      .object({
        $comment: comment,
        $comment2: comment,
        causes: z
          .object({
            headArmor: chance,
            headStructure: chance,
            massiveDamage: chance,
            fall: chance,
            heat: chance,
            ammoExplosion: chance,
            ejectVoluntary: chance,
            ejectTorso: chance,
            ejectHead: chance,
          })
          .strict(),
        outAt: int.min(1),
        skillPenaltyPerInjuries: int.min(1),
      })
      .strict(),
    ejection: z
      .object({
        $comment: comment,
        $comment2: comment,
        triggers: z
          .object({
            voluntary: ejectionTrigger,
            torso: ejectionTrigger,
            head: ejectionTrigger,
          })
          .strict(),
        situational: z
          .object({
            prone: z.number(),
            submerged: z.number(),
            heatHigh: z.number(),
            perInjury: z.number(),
            pilotingBonusPerLevel: z.number(),
          })
          .strict(),
        maxChance: chance,
      })
      .strict(),
    cockpitBreach: z
      .object({
        $comment: comment,
        $comment2: comment,
        die: int.min(2),
        lostFrom: int.min(1),
      })
      .strict()
      .refine((c) => c.lostFrom <= c.die, {
        message: 'cockpitBreach.lostFrom должен быть не больше cockpitBreach.die: иначе пробитие никогда не опасно',
      }),
    progression: z
      .object({
        levelCostBase: int.min(1),
        minLevel: int.min(1),
        maxLevel: int.min(1),
        talentCapMin: int.min(1),
        talentCapMax: int.min(1),
        /**
         * С какой вероятности срыва действие считается сделанным ПОД ДАВЛЕНИЕМ
         * (событие `heldUnderPressure`). Ниже порога Хладнокровие не растёт:
         * иначе оно росло бы с каждого выстрела и было бы вторым счётчиком
         * попаданий.
         */
        pressureFrom: chance,
        /**
         * Опыт за событие. Навыков у события может быть несколько: «контракт
         * выполнен» платит всем задействованным сразу, а попадание — одной
         * Стрельбе. Список, а не строка с запятыми и не два разных поля: один
         * способ сказать одно и то же.
         */
        xp: z.record(
          z.string(),
          z.object({ skills: z.array(z.string().min(1)).min(1), amount: int.min(1) }).strict(),
        ),
      })
      .strict(),
    /** Кто приходит на объявление о найме: полосы выучки и вес каждой ступени. */
    recruits: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        clanChance: chance,
        sphere: recruitBandSchema,
        clan: recruitBandSchema,
      })
      .strict(),
    /** Лица по принадлежности: номера ячеек атласа, разведённые по полу. */
    faces: z
      .object({ $comment: comment, $comment2: comment })
      .catchall(
        z
          .object({ male: z.array(int.min(0)), female: z.array(int.min(0)) })
          .strict()
          .refine((f) => f.male.length + f.female.length > 0, {
            message: 'у принадлежности должно быть хотя бы одно лицо',
          }),
      ),
    origins: z.array(
      z
        .object({
          id: z.string().min(1),
          /** Откуда родом: клановое происхождение не встречается у сферного наёмника и наоборот. */
          side: z.enum(['clan', 'sphere']),
          key: z.string().min(1),
          strong: z.array(z.string().min(1)),
          weak: z.array(z.string().min(1)),
        })
        .strict(),
    ),
  })
  .strict();

// --- chassis.json ------------------------------------------------------------

const zoneArmorSchema = z.object({ armor: nonNeg, structure: int.min(1) }).strict();

export const chassisSchema = z
  .object({
    id: z.string().min(1),
    key: z.string().min(1),
    weightClass: z.enum(['light', 'medium', 'heavy', 'assault']),
    /** Техбаза шасси. Читается правилами: кланский CASE встроен и бесплатен. */
    techBase: z.enum(['is', 'clan']),
    tons: int.min(1),
    /** Полный отвод машины за ход, в очках (шаг 46: та же единица, что и тепло). */
    heatSinks: nonNeg,
    /**
     * Сколько из этих очков сидит ВНУТРИ реактора: ячеек не занимают и критом
     * не выбиваются. Это база реактора — 10 у Сферы, 20 у Кланов, ±2…4 от
     * класса исполнения, — а не общая константа: с константой 10 у кланового
     * реактора десять очков собственного охлаждения оказывались развешены по
     * корпусу выбиваемыми ячейками (`notes.md` §10d).
     *
     * Необязательно: каталожные шасси `chassis.json` несут каноничный счёт
     * радиаторов, у них встроенных ровно десять.
     */
    integralHeatSinks: nonNeg.optional(),
    /**
     * Входы сборки. Хранятся вместе с результатом, чтобы шасси можно было
     * пересобрать уравнением и сверить: числа зон обязаны сходиться с
     * makePlatform + allocateByZone, иначе файл правили руками.
     */
    reactorTier: int.min(1).max(5),
    frameTier: int.min(1),
    armorTons: z.number().nonnegative(),
    zones: z
      .object({
        head: zoneArmorSchema,
        torso: zoneArmorSchema,
        leftArm: zoneArmorSchema,
        rightArm: zoneArmorSchema,
        leftLeg: zoneArmorSchema,
        rightLeg: zoneArmorSchema,
      })
      .strict(),
    mounts: z
      .array(
        z
          .object({
            weapon: z.string().min(1),
            zone: zoneIdSchema,
            ammo: int.min(1).nullable(),
          })
          .strict(),
      )
      .min(1),
    equipment: z
      .array(
        z
          .object({
            id: z.string().min(1),
            zone: zoneIdSchema,
          })
          .strict(),
      )
      .optional(),
    /**
     * Тепло за каждый крит реактора (шаг 11).
     *
     * Свойство машины, а не общая константа: восстановленный реактор греет
     * сильнее, мастерский слабее (`data/quality.json`). Поле необязательное —
     * его отсутствие означает `combat.json` → `critical.reactor.heatPerHit`,
     * поэтому все 850 шасси каталога остались нетронутыми.
     */
    reactorHeatPerHit: nonNeg.optional(),
    /**
     * Класс исполнения реактора и каркаса — для ПОКАЗА в бою (карточка цели,
     * 2026-09-15). Правил боя он не меняет: всё, что класс даёт (отвод, тепло
     * крита, структура), уже посчитано в числах этого шасси. Отсутствие поля —
     * серийная машина, так что 850 шасси каталога остаются нетронутыми.
     */
    quality: z
      .object({ reactor: z.enum(QUALITY_CLASS_IDS), frame: z.enum(QUALITY_CLASS_IDS) })
      .strict()
      .optional(),
  })
  .strict();

export const chassisFileSchema = z
  .object({ $comment: comment, chassis: z.array(chassisSchema).min(1) })
  .strict();

// --- construction.json -------------------------------------------------------

/**
 * Пул идентификаторов оружия на обе техбазы.
 *
 * Существование самих идентификаторов проверяется НЕ здесь, а в `tables.ts`:
 * схема разбирает файл конструирования раньше, чем каталог оружия построен, и
 * сослаться на него отсюда нельзя. Опечатка иначе всплыла бы пустым пулом
 * посреди генерации.
 */
const techPools = z
  .object({
    is: z.array(z.string().min(1)).min(1),
    clan: z.array(z.string().min(1)).min(1),
  })
  .strict();

/**
 * Пул главного калибра — список СТУПЕНЕЙ ПРИОРИТЕТА (шаг 71).
 *
 * Ступень — один ствол или массив равноправных стволов. Генератор берёт первую
 * ступень, в которой что-то помещается, и тянет жребий только внутри неё.
 * Ступень из одного ствола жребия не бросает, поэтому пул из одиночных ступеней
 * даёт ровно прежний порядок «первый подходящий».
 *
 * Своя схема, а не `techPools`: вспомогательные пулы — плоский список для
 * жребия, ступеней генератор там не понимает.
 */
const tierPool = z.array(z.union([z.string().min(1), z.array(z.string().min(1)).min(1)])).min(1);
const primaryTechPools = z.object({ is: tierPool, clan: tierPool }).strict();

/**
 * Шкала тиров. Длина не задаётся числом: число тиров — решение игрового
 * дизайна, а не формы записи (шаг 7 сократил каркас с пяти ступеней до трёх).
 * Схема требует другого и более полезного — чтобы все шкалы ОДНОГО семейства
 * были одной длины, иначе таблицы разъедутся молча.
 */
const tierNumbers = z.array(z.number()).min(2);
const tierInts = z.array(int).min(2);

/** Все шкалы семейства одной длины — иначе тир существует в одной таблице и не существует в другой. */
const sameLength = (arrays: readonly (readonly unknown[])[]): boolean =>
  arrays.every((a) => a.length === arrays[0]!.length);

/**
 * Доли зон обязаны давать в сумме единицу: по ним делится и структура, и броня,
 * и любой перекос молча уводит суммарный запас от расчётного.
 */
const zoneShares = z
  .object({
    $comment: comment,
    $comment2: comment,
    head: chance,
    torso: chance,
    leftArm: chance,
    rightArm: chance,
    leftLeg: chance,
    rightLeg: chance,
  })
  .strict()
  .refine(
    (v) =>
      Math.abs(v.head + v.torso + v.leftArm + v.rightArm + v.leftLeg + v.rightLeg - 1) < 1e-9,
    { message: 'Доли зон обязаны давать в сумме ровно 1' },
  );

// --- quality.json -----------------------------------------------------------

/**
 * Класс исполнения (`wiki/design/mechs/classification.md` §5).
 *
 * Порядок записей обязан совпадать с `QUALITY_CLASS_IDS`: на этот порядок
 * опирается шкала «хуже → лучше», по которой ходят повышение класса ремонтом и
 * понижение износом. Сверка порядка — в `tables.ts`, как у рельефа.
 */
export const qualityClassSchema = z
  .object({
    $comment: comment,
    id: z.enum(QUALITY_CLASS_IDS),
    stars: int.min(1).max(5),
    reactor: z
      .object({
        massFactor: z.number().positive(),
        dissipationDelta: int,
        critHeatPerHit: nonNeg,
      })
      .strict(),
    frame: z
      .object({
        massFactor: z.number().positive(),
        slotDelta: int,
        structureFactor: z.number().positive(),
      })
      .strict(),
  })
  .strict();

export const qualityFileSchema = z
  .object({
    $comment: comment,
    $comment2: comment,
    classes: z.array(qualityClassSchema).length(QUALITY_CLASS_IDS.length),
    tierPrice: z
      .object({
        $comment: comment,
        groups: z
          .array(z.object({ maxTier: int.min(1), factor: z.number().positive() }).strict())
          .min(1),
      })
      .strict(),
  })
  .strict();

export type QualityClassDef = z.infer<typeof qualityClassSchema>;
export type QualityFile = z.infer<typeof qualityFileSchema>;

// --- repair.json ------------------------------------------------------------

/**
 * Цены, сроки и износ (шаг 11).
 *
 * Числа первичные: порядок величин задан здесь, а выверяются они замером
 * кампании на шагах 13 и 16 — «сначала числа, потом целевые значения», как это
 * делалось с балансом боя.
 */
export const repairFileSchema = z
  .object({
    $comment: comment,
    $comment2: comment,
    cost: z
      .object({
        $comment: comment,
        armorPoint: nonNeg,
        structurePoint: nonNeg,
        slot: nonNeg,
        /** Полный бункер боекомплекта одной установки. Неполный считается долей. */
        ammoBin: nonNeg,
        reactorPerTon: nonNeg,
        framePerTon: nonNeg,
        /** Доля цены нового узла, которую стоит восстановление изношенного. */
        restoreShare: chance,
      })
      .strict(),
    days: z
      .object({
        $comment: comment,
        armorPointsPerDay: z.number().positive(),
        structurePointsPerDay: z.number().positive(),
        perSlot: z.number().nonnegative(),
        perAmmoBin: z.number().nonnegative(),
        partSwap: z.number().nonnegative(),
        minimum: z.number().nonnegative(),
      })
      .strict(),
    /** Перекраска (шаг 50): срок и цена от тоннажа. */
    repaint: z
      .object({ $comment: comment, days: z.number().positive(), base: nonNeg, perTon: nonNeg })
      .strict(),
    patch: z
      .object({ $comment: comment, $comment2: comment, structurePenalty: chance })
      .strict(),
    /** Запас прочности каркаса (шаг 66): сколько успешных полевых замен подряд копится до потери ступени. */
    frameLoss: z.object({ $comment: comment, perStep: int.min(1) }).strict(),
    wear: z
      .object({
        $comment: comment,
        perBattle: z.number().nonnegative(),
        perStructurePoint: z.number().nonnegative(),
        perOverheatTurn: z.number().nonnegative(),
        perReactorHit: z.number().nonnegative(),
        perDestroyedZone: z.number().nonnegative(),
        /** Разброс броска износа: 1 ± jitter. */
        jitter: chance,
        threshold: z.number().positive(),
        resetTo: z.number().nonnegative(),
      })
      .strict()
      .refine((w) => w.resetTo < w.threshold, {
        message: 'wear: resetTo обязан быть ниже threshold, иначе узел деградирует бесконечно',
      }),
  })
  .strict();

export type RepairFile = z.infer<typeof repairFileSchema>;

/**
 * Раскраски мехов (шаг 50, `data/paints.json`).
 *
 * Показ и паковщик картинок читают один и тот же файл, ядро — только перечень
 * id (перекраска на стапеле не может заказать раскраску, которой нет). Ссылки
 * между разделами файла проверяет `tables.ts`, ссылки на фракции — тест: ядро
 * данных не импортирует галактику.
 */
const paintId = z.string().regex(/^[a-z][a-z0-9_]*$/, 'id раскраски: латиница в нижнем регистре');

export const paintsFileSchema = z
  .object({
    $comment: comment,
    $comment2: comment,
    $comment3: comment,
    paints: z.record(paintId, z.object({ letter: z.string().regex(/^[a-z]+$/) }).strict()),
    byFaction: z.record(z.string().min(1), paintId),
    byKind: z.record(z.string().min(1), paintId),
    player: paintId,
  })
  .strict();

export type PaintsFile = z.infer<typeof paintsFileSchema>;

export const dropshipIdSchema = z.enum(['leopard', 'union', 'overlord']);
export type DropshipId = z.infer<typeof dropshipIdSchema>;

// --- условия состояния роты: общие для достижений и глав (шаги 69, 70) ---------

/**
 * Условие, которое выводится из состояния роты: вид проверки плюс параметры.
 * Одна функция на вид — `core/campaign/conditions.ts`; её зовут и достижения,
 * и вехи глав кампании, поэтому «Union» в значке и «Union» в главе — одна и та
 * же проверка, а не две похожие.
 */
const stateConditionOptions = [
  z.object({ type: z.literal('contractsWon'), min: int.min(1) }).strict(),
  z.object({ type: z.literal('cbills'), min: z.number().positive() }).strict(),
  z.object({ type: z.literal('dropship'), ships: z.array(dropshipIdSchema).min(1) }).strict(),
  z.object({ type: z.literal('fleetSize'), min: int.min(1) }).strict(),
  z.object({ type: z.literal('mechBattles'), min: int.min(1) }).strict(),
  z.object({ type: z.literal('fame'), min: z.number().positive() }).strict(),
  z.object({ type: z.literal('totalKills'), min: int.min(1) }).strict(),
  z.object({ type: z.literal('worldsFought'), min: int.min(1) }).strict(),
  z.object({ type: z.literal('pilotSkill'), min: int.min(1) }).strict(),
  z.object({ type: z.literal('masterQuality') }).strict(),
  /** Место отряда в рейтинге MRBC — это или выше (1 — первое). */
  z.object({ type: z.literal('ratingRank'), max: int.min(1) }).strict(),
  /** Своих миров у роты. */
  z.object({ type: z.literal('worlds'), min: int.min(1) }).strict(),
  /** Действующих договоров роты и миров, платящих ей дань, вместе. */
  z.object({ type: z.literal('diplomacy'), min: int.min(1) }).strict(),
  /** Вассалов у державы роты. */
  z.object({ type: z.literal('vassals'), min: int.min(1) }).strict(),
  /** Титул державы роты — этот или выше (шаг 89, `war.json → realm.titles`; id сверяет тест данных). */
  z.object({ type: z.literal('realmTitle'), id: z.string().min(1) }).strict(),
] as const;

export type StateCondition = z.infer<(typeof stateConditionOptions)[number]>;

// --- достижения (шаг 69) ------------------------------------------------------

/**
 * Условие достижения: вид проверки плюс параметры. Боевые виды — функции в
 * `core/campaign/achievements/index.ts`, виды состояния — общие с главами
 * (`core/campaign/conditions.ts`); новое достижение того же вида — строка в
 * JSON, без кода.
 */
const achievementConditionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('trophy') }).strict(),
  z.object({ type: z.literal('clanTrophy') }).strict(),
  z.object({ type: z.literal('enemyDown'), minTons: z.number().positive() }).strict(),
  z.object({ type: z.literal('headshot') }).strict(),
  z.object({ type: z.literal('soloWin') }).strict(),
  z.object({ type: z.literal('outnumbered'), ratio: z.number().positive() }).strict(),
  z.object({ type: z.literal('wipeout'), minEnemies: int.min(1) }).strict(),
  z.object({ type: z.literal('flawless') }).strict(),
  z.object({ type: z.literal('beyond') }).strict(),
  z.object({ type: z.literal('lightWin'), maxTons: z.number().positive(), minMechs: int.min(1) }).strict(),
  z
    .object({ type: z.literal('giantKill'), maxOwnTons: z.number().positive(), minVictimTons: z.number().positive() })
    .strict(),
  z.object({ type: z.literal('limpHome') }).strict(),
  ...stateConditionOptions,
  /** Переход, а не состояние: заём был до команды — и погашен ею. */
  z.object({ type: z.literal('loanRepaid') }).strict(),
]);

export type AchievementCondition = z.infer<typeof achievementConditionSchema>;

export const achievementsFileSchema = z
  .object({
    $comment: comment,
    $comment2: comment,
    $comment3: comment,
    achievements: z.array(
      z
        .object({
          id: z.string().regex(/^[a-z][A-Za-z0-9]*$/, 'id достижения: латиница, camelCase'),
          /** Ячейка атласа `ui/achievements.jpg`, слева направо, сверху вниз. */
          icon: nonNeg,
          hidden: z.boolean(),
          condition: achievementConditionSchema,
        })
        .strict(),
    ),
  })
  .strict();

export type AchievementsFile = z.infer<typeof achievementsFileSchema>;
export type AchievementDef = AchievementsFile['achievements'][number];

// --- главы кампании (шаг 70) --------------------------------------------------

/**
 * Условие вехи — условие состояния роты либо `beyondVersion`: веха того, чего в
 * этой версии игры нет (Звёздная Лига), и она не выполняется никогда. Так
 * закрытая глава стоит в данных на общих правах, а не особым случаем экрана.
 */
const milestoneConditionSchema = z.discriminatedUnion('type', [
  ...stateConditionOptions,
  z.object({ type: z.literal('beyondVersion') }).strict(),
]);

export type MilestoneCondition = z.infer<typeof milestoneConditionSchema>;

const campaignIdSchema = z.string().regex(/^[a-z][A-Za-z0-9]*$/, 'id главы или вехи: латиница, camelCase');

export const milestonesFileSchema = z
  .object({
    $comment: comment,
    $comment2: comment,
    /**
     * Наборы глав по пути игрока. Сейчас только `merc`; путь клана заведётся
     * своим набором того же формата.
     */
    campaigns: z
      .object({
        merc: z
          .object({
            chapters: z
              .array(
                z
                  .object({
                    id: campaignIdSchema,
                    milestones: z
                      .array(z.object({ id: campaignIdSchema, condition: milestoneConditionSchema }).strict())
                      .min(1),
                  })
                  .strict(),
              )
              .min(1),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export type MilestonesFile = z.infer<typeof milestonesFileSchema>;
export type ChapterDef = MilestonesFile['campaigns']['merc']['chapters'][number];
export type MilestoneDef = ChapterDef['milestones'][number];

export const dropshipClassSchema = z.enum(['light', 'medium', 'heavy']);
export type DropshipClass = z.infer<typeof dropshipClassSchema>;

export const dropshipDefSchema = z
  .object({
    id: dropshipIdSchema,
    name: z.string().min(1),
    class: dropshipClassSchema,
    /** Потолок ангара (шаг 75): до скольких машин ячейки выкупаются лестницей `bays.steps`. */
    mechCapacity: int.min(1),
    /** Сколько ячеек ангара открыто у корабля сразу (шаг 75) — как `minBays` у цеха. */
    minMechs: int.min(1),
    minBays: int.min(1),
    maxBays: int.min(1),
    upgradeCost: nonNeg,
    shipRent: nonNeg,
  })
  .strict();
export type DropshipDef = z.infer<typeof dropshipDefSchema>;

/**
 * Экономика роты (шаг 13): деньги, содержание, найм, лазарет, полевой ремонт
 * разрушенной зоны. Числа первичные — тот же принцип, что у `repair.json`.
 */
export const economyFileSchema = z
  .object({
    $comment: comment,
    $comment2: comment,
    dropships: z.record(dropshipIdSchema, dropshipDefSchema),
    company: z
      .object({
        startingCbills: nonNeg,
        bays: int.min(1),
      })
      .strict(),
    /**
     * Лестница цеха (шаг 19a, вариант Б решения 2026-09-02).
     *
     * Ступени списком, а не формулой: их две, и обе — заметное решение игрока.
     * Монотонность (`to` строго растёт и начинается выше стартового `bays`)
     * проверяется ниже, при загрузке: ступень «улучшить с четырёх до четырёх»
     * прошла бы схему и обнаружилась бы только тем, что игрок заплатил ни за
     * что.
     */
    bays: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        steps: z
          .array(
            z
              .object({ to: int.min(1), cost: nonNeg, days: z.number().positive() })
              .strict(),
          )
          .min(1),
      })
      .strict(),
    /**
     * Стартовая рота (шаг 16a). Форма `armorShare`/`missingItems` совпадает с
     * `OutfitSpec` из `core/campaign/mech/outfit.ts` намеренно и объявлена
     * здесь заново: боевому ядру запрещено импортировать `core/campaign/`
     * (решение 1 §2 пайплайна), а `economy.json` разбирается тут.
     */
    founding: z
      .object({
        $comment: comment,
        $comment2: comment,
        weightClasses: z.array(z.enum(['light', 'medium', 'heavy', 'assault'])).min(1),
        maxReactorTier: int.min(1),
        maxFrameTier: int.min(1),
        armorShare: z.tuple([chance, chance]),
        missingItems: z.tuple([int.min(0), int.min(0)]),
        pilotTierMin: int.min(1),
        pilotTierMax: int.min(1),
      })
      .strict(),
    payroll: z
      .object({
        $comment: comment,
        intervalDays: int.min(1),
        shipRent: nonNeg,
        pilotSalary: nonNeg,
        mechUpkeepPerTon: nonNeg,
      })
      .strict(),
    hiring: z
      .object({
        $comment: comment,
        $comment2: comment,
        /** Плата за ПОПЫТКУ поиска, а не за пилота: отказ её не возвращает. */
        searchFee: nonNeg,
        /** Раз в сколько суток даётся попытка. Попытки не копятся. */
        searchIntervalDays: int.min(1),
      })
      .strict(),
    medbay: z
      .object({
        $comment: comment,
        $comment2: comment,
        daysPerInjury: z.number().nonnegative(),
        minimumDays: z.number().nonnegative(),
        /** Через сколько суток отдыха у пилота в строю заживает одна травма. */
        restDays: z.number().positive(),
      })
      .strict(),
    replacePart: z
      .object({
        $comment: comment,
        $comment2: comment,
        successChance: chance,
        /** Надбавка за полевые работы: base + tonnage * perTon (шаг 33). */
        surcharge: z.object({ base: nonNeg, perTon: nonNeg }).strict(),
      })
      .strict(),
    loan: z
      .object({
        $comment: comment,
        $comment2: comment,
        principal: nonNeg,
        interest: z.number().min(0),
        installments: int.min(1),
        eligibleBelow: nonNeg,
      })
      .strict(),
    sandbox: z
      .object({
        $comment: comment,
        $comment2: comment,
        /** Шаг кредита песочницы (шаг 74): столько берётся и возвращается за раз. */
        loanStep: int.min(1),
        /** Сколько самых сильных машин звена оплачивает наниматель в песочнице. */
        landingMechs: int.min(1),
      })
      .strict(),
    sortie: z
      .object({
        $comment: comment,
        days: nonNeg,
        landing: z
          .object({
            $comment: comment,
            $comment2: comment,
            $comment3: comment,
            $comment4: comment,
            /** Норма нанимателя: доля силы противника, высадку которой он оплачивает сам. */
            norm: z.number().nonnegative(),
            /** Опорная точка прямой: при этом отношении сил плата равна `anchorShare` гонорара. */
            anchorRatio: z.number().positive(),
            /** Доля гонорара в опорной точке. Ноль — правило выключено. */
            anchorShare: z.number().nonnegative(),
            /** Потолок доли: больше этой части гонорара высадка не стоит никогда. */
            maxShare: z.number().positive(),
          })
          .strict()
          .refine((l) => l.anchorRatio > l.norm, 'anchorRatio обязан быть выше norm'),
      })
      .strict(),
    salvage: z
      .object({
        $comment: comment,
        buyoutShare: chance,
        $comment2: comment,
        wreckRecoveryShare: chance,
      })
      .strict(),
    cancellation: z
      .object({
        $comment: comment,
        refundShare: chance,
      })
      .strict(),
  })
  .strict();

export type EconomyFile = z.infer<typeof economyFileSchema>;

export const constructionFileSchema = z
  .object({
    $comment: comment,
    tonnages: z.array(int.min(20).max(100)).min(1),
    reactors: z
      .object({
        $comment: comment,
        walkMP: z
          .object({ light: tierInts, medium: tierInts, heavy: tierInts, assault: tierInts })
          .strict(),
        runMultiplier: z.number().positive(),
        massPercent: z.object({ is: tierNumbers, clan: tierNumbers }).strict(),
        baseDissipation: z.object({ is: nonNeg, clan: nonNeg }).strict(),
        $commentAlpha: comment,
        alphaHeatTarget: z.number().positive(),
      })
      .strict()
      .refine(
        (r) =>
          sameLength([
            r.walkMP.light, r.walkMP.medium, r.walkMP.heavy, r.walkMP.assault,
            r.massPercent.is, r.massPercent.clan,
          ]),
        { message: 'reactors: все шкалы тиров обязаны быть одной длины' },
      ),
    frames: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        $comment4: comment,
        massPercent: tierNumbers,
        slotPenalty: z.object({ is: tierInts, clan: tierInts }).strict(),
        /**
         * Тиры каркаса, доступные локомоции (2026-09-10). Гуманоид берёт всю
         * шкалу, негуманоид — только облегчённые. Единственное отличие H от N:
         * характеристики платформы от локомоции не зависят вовсе.
         */
        byLocomotion: z
          .object({
            H: z.array(int.min(1)).min(1),
            N: z.array(int.min(1)).min(1),
          })
          .strict(),
      })
      .strict()
      .refine(
        (f) => sameLength([f.massPercent, f.slotPenalty.is, f.slotPenalty.clan]),
        { message: 'frames: все шкалы тиров обязаны быть одной длины' },
      )
      .refine(
        (f) =>
          Object.values(f.byLocomotion).every(
            (tiers) =>
              tiers.every((t) => t >= 1 && t <= f.massPercent.length) &&
              new Set(tiers).size === tiers.length &&
              tiers.every((t, i, a) => i === 0 || t > a[i - 1]!),
          ),
        {
          message:
            'frames.byLocomotion: тиры обязаны идти по возрастанию, без повторов и в пределах шкалы',
        },
      ),
    armor: z
      .object({
        $comment: comment,
        pointsPerTon: z.object({ is: nonNeg, clan: nonNeg }).strict(),
        maxPerStructurePoint: z.number().positive(),
        defaultFillRatio: chance,
        $commentMinPayload: comment,
        minPayloadTons: z.number().min(0),
      })
      .strict(),
    systems: z
      .object({
        $comment: comment,
        $comment2: comment,
        cockpitMass: z.number().min(0),
        gyroMassPercent: chance,
      })
      .strict(),
    structure: z
      .object({ $comment: comment, $comment2: comment, perTon: z.number().positive() })
      .strict(),
    mountRules: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        byZone: z.record(
          z.string(),
          z
            .object({
              deny: z.array(z.string()).default([]),
              /** Сколько ячеек может занимать оружие в этой зоне; 0 — нельзя вовсе. */
              allowWeaponSlots: int.min(0),
            })
            .strict(),
        ),
      })
      .strict(),
    zoneShares: zoneShares,
    weapons: z
      .object({
        $comment: comment,
        $commentPools: comment,
        $commentJunk: comment,
        $commentMinLong: comment,
        $commentDensity: comment,
        $commentMaxPrimary: comment,
        $commentAmmo: comment,
        $commentTiers: comment,
        $commentFill: comment,
        /** Границы полос свободной навески (тонны, по возрастанию). */
        payloadBands: z.array(z.number().positive()).length(3),
        primaryByRole: z.record(z.string(), primaryTechPools),
        /** Добор неистраченных тонн заменой ствола вместе с охлаждением (шаг 71, ступень Б). */
        fillUnusedPayload: z.boolean(),
        $commentFamilies: comment,
        /**
         * Семейства вооружения (шаг 71b): свои ступени главного калибра и свой
         * вспомогательный пул. Какое семейство выходит на каком биоме и в
         * каком классе — `roles.familyByBiome`.
         */
        families: z.record(
          z.string().min(1),
          z.object({ $comment: comment, primary: primaryTechPools, secondary: techPools }).strict(),
        ),
        secondaryByPayload: z
          .object({
            $comment: comment,
            small: techPools,
            medium: techPools,
            large: techPools,
            huge: techPools.extend({ $comment: comment }),
          })
          .strict(),
        minLongByClass: z
          .object({ light: nonNeg, medium: nonNeg, heavy: nonNeg, assault: nonNeg })
          .strict(),
        densityFactor: chance,
        maxPrimary: int.min(1),
        ammoVolleys: int.min(1),
      })
      .strict()
      .refine((w) => w.payloadBands.every((b, i, a) => i === 0 || b > a[i - 1]!), {
        message: 'weapons: payloadBands обязаны идти по возрастанию',
      }),
    roles: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        $comment4: comment,
        $comment5: comment,
        /**
         * Границы ВЕСОВЫХ КЛАССОВ в тоннах по возрастанию: три границы = четыре
         * класса (шаг 49). Единственное объявление в проекте — его читает
         * `weightClassOf`; имя ключа и место в `roles` исторические.
         */
        classBands: z.array(int.min(20).max(100)).length(3),
        weightByClass: z.record(
          z.string(),
          z
            .object({
              light: z.number().nonnegative(),
              medium: z.number().nonnegative(),
              heavy: z.number().nonnegative(),
              assault: z.number().nonnegative(),
            })
            .strict(),
        ),
        $commentBiome: comment,
        /**
         * Группы биомов (шаг 71): биомы, одинаковые для боя, делят одну строку
         * весов. Каждый биом `biomes.json` обязан стоять ровно в одной группе —
         * это проверяет `tables.ts`, где известны оба файла.
         */
        biomeGroups: z.record(z.string().min(1), z.array(z.string().min(1)).min(1)),
        $commentFamily: comment,
        /** Веса семейств вооружения: группа биома → «техбаза.класс» → семейство → вес (шаг 71b). */
        familyByBiome: z.record(
          z.string().min(1),
          z.record(z.string().min(1), z.record(z.string().min(1), z.number().nonnegative())),
        ),
        $commentFamilyMaxShare: comment,
        /** Потолок доли семейства в составе: max(1, ⌊машин × доля⌋). */
        familyMaxShare: z.record(z.string().min(1), z.number().gt(0).max(1)),
        $commentSpecialists: comment,
        /** Специалисты звена: группа биома → семейство → машин на каждые четыре (шаг 71b). */
        familySpecialists: z.record(z.string().min(1), z.record(z.string().min(1), int.min(0).max(4))),
      })
      .strict()
      .refine((r) => r.classBands.every((b, i, a) => i === 0 || b > a[i - 1]!), {
        message: 'roles: classBands обязаны идти по возрастанию',
      }),
    zones: z
      .object({
        $comment: comment,
        baseSlots: z
          .object({
            head: int.min(1),
            torso: int.min(1),
            leftArm: int.min(1),
            rightArm: int.min(1),
            leftLeg: int.min(1),
            rightLeg: int.min(1),
          })
          .strict(),
        fixedSlots: z
          .object({
            head: nonNeg,
            torso: nonNeg,
            leftArm: nonNeg,
            rightArm: nonNeg,
            leftLeg: nonNeg,
            rightLeg: nonNeg,
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export const chassisCatalogEntrySchema = z
  .object({
    code: z.string().min(1),
    canonName: z.string(),
    techBase: z.enum(['is', 'clan']),
    locomotion: z.enum(['H', 'N']),
    weightClass: z.enum(['light', 'medium', 'heavy', 'assault']),
    tonnage: int.min(20).max(100),
    reactorTier: int.min(1).max(5),
    frameTier: int.min(1),
    role: z.string().min(1),
    walkMP: nonNeg,
    runMP: nonNeg,
    baseHeatDiss: nonNeg,
    reactorMass: z.number().nonnegative(),
    frameMass: z.number().nonnegative(),
    /** Кабина плюс гироскоп с приводами (шаг 31). */
    systemsMass: z.number().nonnegative(),
    maxArmorPts: nonNeg,
    defArmorMass: z.number().nonnegative(),
    payloadMass: z.number(),
    frameSlotPenalty: nonNeg,
    freeSlotsTotal: nonNeg,
    freeSlotsTorso: nonNeg,
    freeSlotsArm: nonNeg,
  })
  .strict();

export const chassisCatalogFileSchema = z
  .object({ $comment: comment, chassis: z.array(chassisCatalogEntrySchema).min(1) })
  .strict();

// --- equipment.json ----------------------------------------------------------

export const equipmentSchema = z
  .object({
    id: z.string().min(1),
    code: z.string().min(1),
    key: z.string().min(1),
    techBase: z.enum(['is', 'clan', 'both']),
    category: z.enum(['heatsink', 'jump_jet', 'protection', 'electronics', 'ammo']),
    mass: z.number().nonnegative(),
    slots: nonNeg,
    heatDissipation: nonNeg.optional(),
    jumpMP: nonNeg.optional(),
    maxTonnage: nonNeg.optional(),
    preventTransfer: z.boolean().optional(),
    internalContainment: z.boolean().optional(),
    ecmRange: nonNeg.optional(),
    probeRange: nonNeg.optional(),
    shots: nonNeg.optional(),
    explosionDamage: nonNeg.optional(),
  })
  .strict();

export const equipmentFileSchema = z
  .object({ $comment: comment, equipment: z.array(equipmentSchema).min(1) })
  .strict();

export type TerrainFile = z.infer<typeof terrainFileSchema>;
export type BiomeDef = z.infer<typeof biomeSchema>;
export type BiomesFile = z.infer<typeof biomesFileSchema>;
export type WeaponsFile = z.infer<typeof weaponsFileSchema>;
export type CombatFile = z.infer<typeof combatFileSchema>;
export type PilotsFile = z.infer<typeof pilotsFileSchema>;
export type ChassisFile = z.infer<typeof chassisFileSchema>;
export type ConstructionFile = z.infer<typeof constructionFileSchema>;
export type ChassisCatalogEntry = z.infer<typeof chassisCatalogEntrySchema>;
export type ChassisCatalogFile = z.infer<typeof chassisCatalogFileSchema>;
export type EquipmentDef = z.infer<typeof equipmentSchema>;
export type EquipmentFile = z.infer<typeof equipmentFileSchema>;

export type WeaponDef = z.infer<typeof weaponSchema>;
export type ChassisDef = z.infer<typeof chassisSchema>;

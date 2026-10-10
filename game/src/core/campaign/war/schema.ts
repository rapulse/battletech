import { z } from 'zod';
import warJson from '../../../../data/war.json';
import { WORLD_FOCUSES } from '../galaxy/schema.js';

/**
 * Схема таблицы войны (шаг 21a) — `data/war.json`.
 *
 * Тот же порядок, что у контрактов, рынка, галактики и репутации: своя схема на
 * таблицу, разбор один раз при загрузке модуля, строгие объекты. Опечатка в
 * классе космопорта или пропущенный порог останавливают загрузку здесь, а не
 * всплывают через год игры фракцией с нулевым доходом.
 *
 * Файл лежит в кампании (`data/`, разбирается кампанией), а не в
 * `core/data/tables.ts`, по той же причине, что `contracts.json` и
 * `reputation.json`: фракция — понятие кампании, а боевому ядру запрещено
 * импортировать `core/campaign/` (решение 1 §2 пайплайна).
 */

/**
 * Виды построек мира роты (шаг 87), в порядке показа и хранения: готовые постройки в дельте мира лежат
 * в этом порядке, чтобы снимок и хэш не зависели от того, что построили раньше.
 */
export const BUILDING_KINDS = ['workshop', 'depot', 'barracks', 'defence', 'spaceport', 'factory', 'drill'] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];

/** Приоритеты губернатора сектора (шаг 88), в порядке показа. */
export const GOVERNOR_PRIORITIES = ['income', 'defence', 'army', 'development', 'loyalty'] as const;
export type GovernorPriority = (typeof GOVERNOR_PRIORITIES)[number];

const comment = z.string().optional();
const money = z.number().nonnegative();

/** Правило приоритета губернатора (шаг 88): порядок всех шести построек, развитие, фокус. */
const priorityRule = z
  .object({
    // Порядок всех шести построек: пропущенная постройка у приоритета не строилась бы никогда.
    buildings: z
      .array(z.enum(BUILDING_KINDS))
      .refine((a) => a.length === BUILDING_KINDS.length && new Set(a).size === a.length),
    develop: z.boolean(),
    focus: z.enum(WORLD_FOCUSES).nullable(),
  })
  .strict();

/** Классы космопорта из `galaxy/profile.ts`: A — лучший, F — грунтовая площадка. */
export const SPACEPORT_CLASSES = ['A', 'B', 'C', 'D', 'E', 'F'] as const;
export type SpaceportClass = (typeof SPACEPORT_CLASSES)[number];

/**
 * Множитель на каждый фокус мира (шаг 25). Строгий объект: забытый фокус
 * останавливает загрузку, а не всплывает через год нулевым множителем.
 */
const focusTable = z
  .object(
    Object.fromEntries(WORLD_FOCUSES.map((f) => [f, z.number().nonnegative()])) as Record<
      string,
      z.ZodNumber
    >,
  )
  .strict();

const spaceportTable = z
  .object(
    Object.fromEntries(SPACEPORT_CLASSES.map((c) => [c, z.number().positive()])) as Record<
      SpaceportClass,
      z.ZodNumber
    >,
  )
  .strict();

export const warFileSchema = z
  .object({
    $comment: comment,
    $comment2: comment,
    $comment3: comment,
    economy: z
      .object({
        $comment: comment,
        $comment4: comment,
        $comment5: comment,
        $comment6: comment,
        tickDays: z.number().int().positive(),
        income: z
          .object({
            $comment: comment,
            $comment2: comment,
            perCivil: money,
            perMilitary: money,
            spaceportByClass: spaceportTable,
            capitalBonus: z.number().positive(),
          })
          .strict(),
        upkeep: z
          .object({ $comment: comment, perGarrison: money, perWorld: money })
          .strict(),
        $commentArmy: comment,
        $commentArmy2: comment,
        $commentArmy3: comment,
        /** Машин на мир: из этого начальная армия и цель восстановления. */
        armyPerWorld: z.number().positive(),
        /** Содержание одной машины за такт. */
        armyUpkeep: money,
        /** Доля свободной казны, идущая на пополнение армии за такт. */
        rebuildShare: z.number().min(0).max(1),
        mechCost: money,
        /** Ниже этой доли от цели армия не падает: государство не исчезает от одного проигранного рейда. */
        armyMinShare: z.number().min(0).max(1),
        treasuryStartTicks: z.number().nonnegative(),
        warFundShare: z.number().min(0).max(1),
        fundMinEnmity: z.number().min(0).max(1),
        $comment7: comment,
        $comment8: comment,
        /** Доля фонда, возвращаемая в казну с направления, где не стреляли (шаг 26). */
        idleRelease: z.number().min(0).max(1),
      })
      .strict(),
    /**
     * Промышленная мощность (шаг 25, часть B) — пропускная способность державы,
     * второй макро-поток рядом с деньгами.
     */
    industry: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        $comment4: comment,
        $comment5: comment,
        $comment6: comment,
        $comment7: comment,
        $commentF: comment,
        $commentF2: comment,
        $commentF3: comment,
        qualityPower: z.number().positive(),
        focusCapacity: focusTable,
        focusIncome: focusTable,
        focusUpkeep: focusTable,
        focusDefence: focusTable,
        mechsPerCapacity: z.number().positive(),
        buildPerCapacity: z.number().positive(),
      })
      .strict(),
    /** Смена фокуса мира (шаг 25, часть A): цена, срок и гистерезис. */
    focus: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        $comment4: comment,
        cost: money,
        changeDays: z.number().int().positive(),
        investShare: z.number().min(0).max(1),
      })
      .strict(),
    /** Домен игрока (шаг 25, часть C): почём мир и кому его продадут. */
    domain: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        priceIncomeTicks: z.number().positive(),
        priceMin: money,
        minStanding: z.number(),
        $comment4: comment,
        $comment5: comment,
        $comment6: comment,
        /** Захват (шаг 38): побед роты на этом мире, без которых флаг не поднять. */
        conquerWins: z.number().int().min(0),
        /** Для пиратского мира сверх побед — вычищенность логова (шаг 37a). */
        conquerCleared: z.number().min(0).max(1),
        /** Пожалование (шаг 38): отношение, известность, победы и приграничность. */
        grantStanding: z.number(),
        grantFame: z.number(),
        grantWins: z.number().int().min(0),
        grantFrontier: z.number().min(0).max(1),
        $comment7: comment,
        /** Перенос столицы роты (шаг 72a). */
        capitalMoveCost: money,
        $comment8: comment,
        /** Сколько суток после переноса столицу нельзя перенести снова (шаг 72b). */
        capitalMoveCooldownDays: z.number().int().min(0),
        $comment9: comment,
        /** Доля цены мира, которую рота получает при продаже (шаг 72e). */
        abandonHoldDays: z.number().int().min(0),
        $comment10: comment,
        /** Содержание машины полевой армии роты за декаду (проект державы, шаг 1). */
        armyUpkeep: money,
        $comment11: comment,
        /** Шаги доли военного бюджета державы роты (проект державы, шаг 2). Ноль обязателен. */
        warBudgetSteps: z.array(z.number().min(0).max(1)).min(1).refine((a) => a.includes(0)),
        $comment12: comment,
        $commentArmy: comment,
        /** Призыв: машин потолка армии за каждый мир державы (шаг 90). */
        armyPerWorld: z.number().int().min(0),
        /** Вес направления с записью войны в логистике державы против фронта одной вражды (шаг 90). */
        warFrontWeight: z.number().min(1),
        /** Цена приказа армии наступать — за машину армии на направлении (шаг 90; до него — такт дохода). */
        offensiveCostPerMech: money,
        $commentArmyEconomy: comment,
        /** Трофеи (шаг 90, ступень 8): казна взятого мира в тактах его дохода; доля фонда врага за выигранный приказ. */
        captureLootTicks: z.number().min(0),
        offensiveLootShare: z.number().min(0).max(1),
      })
      .strict(),
    /** Лояльность мира роты (шаг 85): `war/loyalty.ts`. */
    loyalty: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        $comment4: comment,
        /** Множитель дохода и мощности мира: `mulBase + лояльность × mulPerPoint`. */
        mulBase: z.number().min(0).max(1),
        mulPerPoint: z.number().min(0),
        /** Стартовая лояльность по способу получения мира. */
        startForce: z.number().min(0).max(100),
        startBought: z.number().min(0).max(100),
        startGrant: z.number().min(0).max(100),
        startPeace: z.number().min(0).max(100),
        /** Рост за декаду (× (1 − разорение)); вниз за декаду войны с прежним владельцем; победа роты на мире. */
        growth: z.number().min(0),
        warDecay: z.number().min(0),
        win: z.number().min(0),
        /** Порог восстания, прибавка за подавление, декад до отпадения. */
        revoltBelow: z.number().min(0).max(100),
        revoltWin: z.number().min(0),
        revoltDecades: z.number().int().positive(),
        $commentStep90: comment,
        /** Армия державы подавляет восстание в последнюю декаду срока: сколько машин нужно и сколько теряется (шаг 90). */
        armyQuellMechs: z.number().int().min(1),
        armyQuellLoss: z.number().int().min(0),
      })
      .strict(),
    /** Постройки мира роты (шаг 87): `war/buildings.ts`. */
    buildings: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        $comment4: comment,
        $comment5: comment,
        $comment6: comment,
        $comment7: comment,
        /** Цена (C-Bills) и трудоёмкость (очки стройки) каждого вида. */
        kinds: z
          .object(
            Object.fromEntries(
              BUILDING_KINDS.map((k) => [k, z.object({ cost: money, work: z.number().int().positive() }).strict()]),
            ) as Record<BuildingKind, z.ZodObject<{ cost: z.ZodNumber; work: z.ZodNumber }>>,
          )
          .strict(),
        minPoints: z.number().int().positive(),
        upkeepShare: z.number().min(0).max(1),
        cancelRefund: z.number().min(0).max(1),
        surviveLoss: z.number().min(0).max(1),
        workshopBays: z.number().int().positive(),
        workshopCost: z.number().positive().max(1),
        workshopDays: z.number().positive().max(1),
        depotSlots: z.number().int().positive(),
        garrisonCap: z.number().int().positive(),
        garrisonCapBarracks: z.number().int().positive(),
        barracksLoyalty: z.number().min(0),
        barracksHireFee: z.number().min(0).max(1),
        orbitalDefence: z.number().min(1),
        factoryMilitary: z.number().int().min(0),
        factoryArmyCut: z.number().min(0).max(1),
        factoryArmyFloor: z.number().min(0).max(1),
        /** Прибавка к потолку армии державы за казармы и за завод на мире (шаг 90). */
        barracksArmy: z.number().int().min(0),
        factoryArmy: z.number().int().min(0),
        /** Экономика армии державы (шаг 90, ступень 8): скидки содержания за казармы и учебный лагерь, их пол. */
        barracksUpkeepCut: z.number().min(0).max(1),
        drillArmy: z.number().int().min(0),
        drillUpkeepCut: z.number().min(0).max(1),
        sectorUpkeepFactor: z.number().min(1),
        armyUpkeepFloor: z.number().min(0).max(1),
        /** Прибавка к доле торгового договора державы за каждый её космопорт (шаг 90, ступень 8). */
        spaceportTradeShare: z.number().min(0).max(1),
        factoryMechPrice: z.number().positive().max(1),
        /** Космопорт роты (2026-10-04): скидка на ступень развития мира, доля цены. */
        spaceportDevelopCut: z.number().min(0).max(1),
        /** Космопорт: очки стройки за декаду на этом мире сверх мощности. */
        spaceportPoints: z.number().int().min(0),
        /** Космопорт: ступеней развития сверх общего потолка на этом мире. */
        spaceportDevelopMax: z.number().int().min(0),
        /** Космопорт: на сколько классов выше считается порт мира (доход, подъёмная сила). */
        spaceportPortSteps: z.number().int().min(0).max(5),
      })
      .strict(),
    /** Секторы, губернаторы и стойки фронтов (шаг 88): `realm/`. */
    realm: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        $comment4: comment,
        $comment5: comment,
        $comment6: comment,
        sectorJumps: z.number().int().positive(),
        worldsPerSector: z.number().int().positive(),
        reserveSteps: z.array(money).min(1).refine((a) => a.includes(0)),
        reserveDefault: money,
        stanceMinOdds: z.number().min(0).max(1),
        governor: z
          .object({
            skillFloor: z.number().int().min(0),
            loyaltyPerLevel: z.number().min(0),
            pointsPerLevel: z.number().min(0),
            defencePerLevel: z.number().min(0),
          })
          .strict(),
        priorities: z
          .object({
            income: priorityRule,
            defence: priorityRule,
            army: priorityRule,
            development: priorityRule,
            loyalty: priorityRule,
          } satisfies Record<GovernorPriority, typeof priorityRule>)
          .strict(),
        $comment7: comment,
        /** Титулы державы по числу миров (шаг 89, `realm/titles.ts`): по возрастанию `worlds`, прибавки копятся. */
        titles: z
          .array(
            z
              .object({
                id: z.string().regex(/^[a-z]+$/),
                worlds: z.number().int().min(1),
                loyalty: z.number().min(0).optional(),
                points: z.number().min(0).optional(),
                sectors: z.number().int().min(0).optional(),
                /** Прибавка титула к потолку армии, доля (шаг 90). */
                army: z.number().min(0).optional(),
              })
              .strict(),
          )
          .min(1)
          .refine((t) => t.every((x, k) => k === 0 || x.worlds > (t[k - 1] as { worlds: number }).worlds), {
            message: 'титулы — по возрастанию числа миров',
          }),
      })
      .strict()
      .refine((r) => r.reserveSteps.includes(r.reserveDefault)),
    front: z
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
        tickDays: z.number().int().positive(),
        minEnmity: z.number().min(0).max(1),
        /** Год, до которого действует перемирие Тукайида (решение 1). Разбор — `front.ts`. */
        truceUntilYear: z.number().int(),
        attemptsMin: z.number().int().nonnegative(),
        attemptsMax: z.number().int().nonnegative(),
        garrisonBase: z.number().positive(),
        attackWeight: z.number().positive(),
        pushScale: z.number().positive(),
        pushBase: z.number().positive(),
        attemptCost: z.number().min(0).max(1),
        captureCost: z.number().min(0).max(1),
        captureRuinMin: z.number().min(0).max(1),
        captureRuinMax: z.number().min(0).max(1),
        raidRuinMin: z.number().min(0).max(1),
        raidRuinMax: z.number().min(0).max(1),
        healPerTick: z.number().min(0).max(1),
        proximityFalloff: z.number().min(0).max(1),
        tensionScale: z.number().positive(),
        companyShare: z.number().nonnegative(),
        /** Насколько один захват портит отношения пары фракций (шаг 21b). */
        $commentBreak: comment,
        /** Доля выбитых, за которой соединение сломлено и бой кончается (`cripple`). */
        breakShare: z.number().min(0).max(1),
        $commentBattle: comment,
        $commentBattle2: comment,
        $commentBattle3: comment,
        /** Вес стороны → машины. Перевод, а не вторая мера силы (`battle.ts`). */
        mechsPerWeight: z.number().positive(),
        forceMin: z.number().int().positive(),
        forceMax: z.number().int().positive(),
        /** Машин на одну ступень потолка раундов и сколько ступеней максимум. */
        roundScaleUnits: z.number().positive(),
        roundScaleMax: z.number().positive(),
        armyTonnageCap: z.number().positive(),
        relationPerMove: z.number().min(0).max(2),
        /** Доля выжженных миров, с которой фракция читается разорённой (шаг 21b). */
        ruinedBandFrom: z.number().min(0).max(1),
      })
      .strict(),
    $commentDiplomacy: comment,
    $commentDiplomacy2: comment,
    /**
     * Дипломатия (шаг 26): три ступени подчинения и они же — сток военного
     * фонда, долг, записанный шагом 21a.
     */
    /** Война и мир роты с фракциями (шаг 76): `war/playerWar.ts`. */
    playerWar: z
      .object({
        $comment: comment,
        $comment2: comment,
        warRelation: z.number().min(-1).max(1),
        declareStanding: z.number(),
        aiDeclareStanding: z.number(),
        minWarDays: z.number().int().min(0),
        peaceRelation: z.number().min(-1).max(1),
        cedeFrom: z.number().int().min(1),
        offerDays: z.number().int().positive(),
        $comment3: comment,
        /** Надбавка к перемирию после мира — суток за мир, взятый ротой в войне (шаг 3b). */
        truceDaysPerWorld: z.number().int().min(0),
        $commentTruce: comment,
        /** База перемирия после мира роты и его потолок (шаг 90). */
        truceBaseDays: z.number().int().min(0),
        truceMaxDays: z.number().int().min(0),
        $comment4: comment,
        $comment5: comment,
        /** Сколько пограничных миров можно заявить целью войны (шаг 81). */
        goalWorldsMax: z.number().int().min(1),
        /** Прирост усталости стороны за такт фронта (шаг 81). */
        fatiguePerDecade: z.number().min(0).max(1),
        /** Прирост усталости за театр против этого врага, выбитый в бою целиком (шаг 81). */
        fatigueLossWeight: z.number().min(0),
        $comment8: comment,
        fatiguePerWorld: z.number().min(0),
        /** С какой усталости фракция предлагает мир на цели роты, а отступные роты начинают падать. */
        fatigueThreshold: z.number().min(0).lt(1),
        /** Сила волны по сети отношений при мире на цели «унижение» (шаг 81). */
        humiliationStanding: z.number().min(0),
        $comment6: comment,
        /** Сколько отношения пары «рота — фракция» прибавляет такт перемирия, до `peaceRelation` (шаг 81). */
        thawPerDecade: z.number().min(0),
        /** Надбавка к перемирию, если войну объявила рота (шаг 81). */
        declarerTruceDays: z.number().int().min(0),
        $comment7: comment,
        /** С какой угрозы от державы сосед, сильнее её на границе, объявляет ей войну (шаг 83). */
        aiDeclareThreat: z.number().positive(),
      })
      .strict(),
    $commentDemands: comment,
    /** Требования соседей к державе роты (шаг 89): `war/demands.ts`. */
    demands: z
      .object({
        /** Во сколько раз сосед должен быть сильнее державы на общей границе. */
        forceRatio: z.number().positive(),
        /** Откат пары: следующее требование того же соседа — не раньше. */
        cooldownDecades: z.number().int().min(1),
        /** Сдвиг отношения соседа к роте: принять — вверх, отказать — вниз. */
        acceptStanding: z.number(),
        refuseStanding: z.number(),
        /** Шанс, что сосед ответит на отказ набегом на мир, а не отношением вниз. */
        refuseRaidChance: z.number().min(0).max(1),
        $commentQuiet: comment,
        /** Сколько суток после конца перемирия с державой сосед не требует дани (шаг 90). */
        afterTruceDays: z.number().int().min(0),
      })
      .strict(),
    $commentResistance: comment,
    /** Сопротивление растущей державе роты (шаг 91): тревога, коалиция, подстрекательство, наступления ИИ. */
    resistance: z
      .object({
        $comment: comment,
        /** С какой угрозы от державы сосед теряет отношение к роте, сколько за единицу угрозы и потолок за декаду. */
        alarmMin: z.number().min(0),
        alarmStanding: z.number().min(0),
        alarmStandingMax: z.number().min(0),
        $comment2: comment,
        /** Кто входит в коалицию: отношение к роте не выше, угроза не ниже; сколько нужно без чужого объявления. */
        coalitionStanding: z.number(),
        coalitionThreat: z.number().min(0),
        coalitionMin: z.number().int().min(1),
        $comment3: comment,
        /** Подстрекательство: порог отношения прежнего владельца, падение лояльности за декаду; благосостояние за ступень. */
        inciteStanding: z.number(),
        inciteDecay: z.number().min(0),
        welfarePerStep: z.number().min(0),
        $comment4: comment,
        /** Раз в сколько декад фракция наступает на мир своей цели. */
        foeOrderDecades: z.number().int().min(1),
        $comment5: comment,
        /** Шаг 92: порог силы для объявления по отношению (0 — без проверки). */
        standingWarForce: z.number().min(0),
        /** Шаг 92: сколько сил державы на границе фракция выводит к ней в день объявления (0 — нисколько). */
        declareMuster: z.number().min(0),
        /** Шаг 92: темп наступлений в войне, объявленной фракцией (0 — общий `foeOrderDecades`). */
        declaredOrderDecades: z.number().int().min(0),
      })
      .strict(),
    diplomacy: z
      .object({
        /** Какая доля дохода мира течёт тому, кому он платит дань. */
        tributeShare: z.number().min(0).max(1),
        $commentGrant: comment,
        /** Доля дохода, которую лен платит жалующему Дому (шаг 90). */
        grantTributeShare: z.number().min(0).max(1),
        /** Срок дани в декадах. Конечен намеренно: иначе это вечная рента. */
        tributeDecades: z.number().int().positive(),
        /** Доля фонда направления, которую стоит наложить дань. */
        tributeCost: z.number().min(0).max(1),
        /** Доля фонда направления за декаду на удержание ОДНОГО данника. */
        enforceCost: z.number().min(0).max(1),

        $commentVassal: comment,
        $commentVassal2: comment,
        /** Какая доля дохода вассала уходит в военный фонд сюзерена. */
        vassalShare: z.number().min(0).max(1),
        /** Сколько миров державы под данью соседа, чтобы она признала сюзеренитет. */
        vassalFromTributes: z.number().int().positive(),
        /** Какая доля миров державы обязана платить дань одному соседу. */
        vassalTributeShare: z.number().min(0).max(1),
        /** Во сколько раз сюзерен обязан быть крупнее вассала. */
        vassalSizeRatio: z.number().positive(),
        $commentPeaceVassal: comment,
        /** Во сколько раз держава с вассалами должна быть не меньше фракции, чтобы та признала сюзеренитет миром (шаг 90). */
        peaceVassalRatio: z.number().positive(),
        /** Потолок вассалов у одного сюзерена — предохранитель от каскада. */
        vassalMax: z.number().int().positive(),
        /** Ниже этой готовности сюзерена вассал уходит. */
        breakReadiness: z.number().positive(),
        /** Ниже этого отношения вассал уходит. */
        breakRelation: z.number().min(-1).max(1),

        $commentPact: comment,
        pactDecades: z.number().int().positive(),
        /** Прибавка к доходу обеим сторонам торгового договора. */
        tradeIncomeShare: z.number().min(0).max(1),
        /** Доля фонда направления за заключение договора. */
        pactCost: z.number().min(0).max(1),
        /** Ниже этого отношения договор не заключают вовсе. */
        pactMinRelation: z.number().min(-1).max(1),
        $commentPact2: comment,
        /** На скольких направлениях надо воевать, чтобы искать мира. */
        pactMinFronts: z.number().int().positive(),
        /** Ниже какой готовности армии держава просит мира. */
        pactReadiness: z.number().positive(),
        $commentSecondFront: comment,
        /** На скольких направлениях враг должен перевешивать театром, чтобы искать перемирия (шаг 83). */
        secondFrontMin: z.number().int().min(1),
        /** Сколько чистой потери миров в памяти захватов делает врага партнёром перемирия (шаг 83). */
        secondFrontLossMin: z.number().positive(),
        $commentTrade: comment,
        /** Ниже этого отношения ИИ торговых договоров не подписывает (шаг 83). */
        tradeMinRelation: z.number().min(-1).lt(1),
        /** Шанс договора за декаду при отношении 1 (шаг 83). */
        tradeChanceMax: z.number().min(0).max(1),
        $commentThreat: comment,
        /** Во сколько раз память захватов тает за декаду (шаг 83). */
        conquestDecay: z.number().min(0).lt(1),
        /** С какой угрозы она двигает отношения (шаг 83). */
        threatMin: z.number().positive(),
        /** Падение отношения к угрожающему за декаду на единицу угрозы и его потолок. */
        threatRelation: z.number().min(0),
        threatRelationMax: z.number().min(0),
        /** Сближение тех, кому угрожает один сосед, за декаду на единицу угрозы и его потолок. */
        threatBond: z.number().min(0),
        threatBondMax: z.number().min(0),
        /** Пределы соотношения сил в угрозе. */
        powerMin: z.number().positive(),
        powerMax: z.number().positive(),

        $commentChoice: comment,
        choice: z
          .object({
            unprofitable: z.number(),
            size: z.number(),
            distance: z.number(),
            distanceLy: z.number().positive(),
            capacity: z.number(),
            capacityMid: z.number().positive(),
            weak: z.number(),
            plan: z.number(),
            hate: z.number(),
            threshold: z.number(),
          })
          .strict(),
      })
      .strict(),
    plans: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        $comment4: comment,
        $comment5: comment,
        sectorWeight: z.number().positive(),
        fundWeight: z.number().positive(),
        radiusLy: z.number().positive(),
        decadesMin: z.number().int().positive(),
        decadesMax: z.number().int().positive(),
        goal: z.number().int().positive(),
        minReadiness: z.number().min(0).max(1.5),
        $commentFund26: comment,
        minFundTicks: z.number().nonnegative(),
        fundScale: z.number().positive(),
      })
      .strict(),
    development: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        $comment4: comment,
        $comment5: comment,
        $comment6: comment,
        $comment27: comment,
        $comment28: comment,
        investShare: z.number().min(0).max(1),
        stepCost: money,
        maxStepsPerTick: z.number().int().nonnegative(),
        ruinBlock: z.number().min(0).max(1),
        declineRuinFrom: z.number().min(0).max(1),
        declineChance: z.number().min(0).max(1),
      })
      .strict(),
    $commentLogistics: comment,
    /**
     * ЛОГИСТИКА И ДВА ЭШЕЛОНА (шаг 27, фаза 4 Части 3).
     *
     * Подъёмная сила меряется в МАШИНО-ПРЫЖКАХ за декаду, и это не украшение
     * единицы: перевезти одну машину на N прыжков стоит N машино-прыжков,
     * поэтому дальний фронт питается медленнее ближнего сам собой, без
     * отдельного множителя расстояния.
     */
    logistics: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        /** Вклад мира в подъёмную силу по классу его космопорта, машино-прыжков за декаду. */
        spaceportLift: spaceportTable,
        $comment4: comment,
        /**
         * Канонический флот державы сверх её космопортов. ПОЛ, а не прибавка по
         * размеру: анклав из пятнадцати миров иначе не перебросил бы ничего.
         */
        fleetByKind: z.record(z.string().min(1), z.number().nonnegative()),
        $comment5: comment,
        /** Потолок плеча в прыжках: без него недостижимая столица делила бы силу на бесконечность. */
        jumpsMax: z.number().positive(),
        $comment6: comment,
        $comment7: comment,
        /** Прибавка к содержанию мира за каждый прыжок до столицы владельца. */
        upkeepPerJump: money,
        $comment8: comment,
        /** Какую долю армии держава не отправляет на направления вовсе. */
        reserveShare: z.number().min(0).max(1),
        $comment9: comment,
        /** Во сколько раз дороже отвести полк с направления, чем отправить на него. */
        crossCost: z.number().min(1),
        $comment10: comment,
        /** Доля обороны, которую держит ополчение — эшелон 1. */
        militiaShare: z.number().min(0).max(1),
        $comment11: comment,
        /** Ниже скольких машин переброска за декаду не разыгрывается. */
        minMove: z.number().positive(),
      })
      .strict(),
    prosperity: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        $comment4: comment,
        min: z.number().positive(),
        max: z.number().positive(),
        bands: z
          .object({ poor: z.number().positive(), fair: z.number().positive(), strong: z.number().positive() })
          .strict(),
      })
      .strict(),
  })
  .strict();

export type WarFile = z.infer<typeof warFileSchema>;

function parse(): WarFile {
  try {
    return warFileSchema.parse(warJson);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Ошибка в данных войны (data/war.json):\n${detail}`);
  }
}

export const WAR: WarFile = parse();

// Полоса достатка обязана иметь ненулевую ширину и включать середину: достаток
// нормирован к средневзвешенному по Сфере, и полоса, не накрывающая единицу,
// означала бы, что средняя фракция сама себе не средняя. Проверка при загрузке,
// а не тестом: тест ловит это на минуту позже, чем игра.
if (WAR.prosperity.min >= WAR.prosperity.max) {
  throw new Error(
    `Ошибка в данных войны (data/war.json):\n` +
      `полоса достатка пуста: min=${WAR.prosperity.min} не меньше max=${WAR.prosperity.max}`,
  );
}
if (WAR.prosperity.min > 1 || WAR.prosperity.max < 1) {
  throw new Error(
    `Ошибка в данных войны (data/war.json):\n` +
      `полоса достатка ${WAR.prosperity.min}..${WAR.prosperity.max} не накрывает середину (1.0)`,
  );
}

// Срок замысла обязан идти снизу вверх: перевёрнутая пара молча выдала бы
// `rng.int` с min > max и дала бы наступление, выдохшееся раньше, чем объявлено.
if (WAR.plans.decadesMin > WAR.plans.decadesMax) {
  throw new Error(
    `Ошибка в данных войны (data/war.json):\n` +
      `срок замысла перевёрнут: ${WAR.plans.decadesMin}..${WAR.plans.decadesMax} декад`,
  );
}

// Разброс разорения обязан быть непустым и идти снизу вверх: перевёрнутая пара
// молча выдала бы `rng.next()` за пределами полосы и дала бы отрицательное
// разорение, то есть мир, ЧИНЯЩИЙСЯ от набега.
{
  const f = WAR.front;
  if (f.captureRuinMin > f.captureRuinMax || f.raidRuinMin > f.raidRuinMax) {
    throw new Error(
      `Ошибка в данных войны (data/war.json):\n` +
        `полоса разорения перевёрнута: захват ${f.captureRuinMin}..${f.captureRuinMax}, ` +
        `набег ${f.raidRuinMin}..${f.raidRuinMax}`,
    );
  }
  if (f.attemptsMin > f.attemptsMax) {
    throw new Error(
      `Ошибка в данных войны (data/war.json):\n` +
        `число наступлений за такт перевёрнуто: ${f.attemptsMin}..${f.attemptsMax}`,
    );
  }
}

// Пороги полос показа идут снизу вверх и лежат внутри полосы достатка: иначе
// на экране была бы ступень, в которую не попадает ни одна фракция.
{
  const b = WAR.prosperity.bands;
  if (!(b.poor < b.fair && b.fair < b.strong)) {
    throw new Error(
      `Ошибка в данных войны (data/war.json):\n` +
        `пороги полос достатка не возрастают: poor=${b.poor}, fair=${b.fair}, strong=${b.strong}`,
    );
  }
  // Нижний порог имеет право СОВПАСТЬ с полом полосы: тогда ступень «разорена»
  // от одной бедности недостижима, и слово означает войну, а не мелкий размер
  // фракции. Ровно так оно и выставлено до 21b. Ниже пола — уже опечатка.
  if (b.poor < WAR.prosperity.min || b.strong >= WAR.prosperity.max) {
    throw new Error(
      `Ошибка в данных войны (data/war.json):\n` +
        `пороги полос ${b.poor}..${b.strong} выходят за полосу достатка ${WAR.prosperity.min}..${WAR.prosperity.max}`,
    );
  }
}

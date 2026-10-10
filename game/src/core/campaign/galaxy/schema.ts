import { z } from 'zod';
import { BIOME_LIST } from '../../data/tables.js';

/**
 * Схемы галактики (шаг 14). Тот же порядок, что у боевых таблиц
 * (`core/data/schema.ts`): каждая таблица со схемой, ссылки между таблицами
 * проверяются при загрузке, а не всплывают через месяц кривой картой.
 *
 * Проверяются три файла:
 *   `galaxy/systems.json`  — слой канона, генерируется `tools/generate_galaxy.ts`
 *   `galaxy/factions.json` — реестр акторов; владелец системы ссылается сюда
 *   `galaxy/galaxy.json`   — числа: логистика прыжка и вывод профиля
 */

const int = z.number().int();
const nonNeg = int.min(0);

export const STAR_CLASSES = ['O', 'B', 'A', 'F', 'G', 'K', 'M'] as const;
export type StarClass = (typeof STAR_CLASSES)[number];

export const MARKET_CLASSES = [
  'capital',
  'industrial',
  'developed',
  'agrarian',
  'backwater',
  'periphery',
] as const;
export type MarketClass = (typeof MARKET_CLASSES)[number];

export const ATMOSPHERES = ['vacuum', 'thin', 'standard', 'dense', 'toxic'] as const;
export type Atmosphere = (typeof ATMOSPHERES)[number];

/**
 * Фокус мира (шаг 25, часть A) — чем планета занята.
 *
 * Пять ролей вместо тридцати зданий: одно решение раз в игровой год, а не
 * рутина каждую декаду (§2 дорожной карты Части 3). Порядок закреплён — на нём
 * стоят и разбор данных, и порядок проверки порогов естественного фокуса.
 */
export const WORLD_FOCUSES = ['granary', 'mining', 'arsenal', 'metropolis', 'fortress'] as const;
export type WorldFocus = (typeof WORLD_FOCUSES)[number];

/**
 * Флаги слоя канона — битовая маска, а не набор булевых полей: их читают
 * и вывод профиля, и рынок (шаг 15), и генератор контрактов (шаг 16), а в
 * файле на 2000 строк каждое лишнее поле стоит килобайты.
 */
export const SYSTEM_FLAG = {
  capital: 1,
  industrial: 2,
  mechFactory: 4,
  blackMarket: 8,
  hpg: 16,
  anchor: 32,
} as const;

export type SystemFlag = keyof typeof SYSTEM_FLAG;

// --- systems.json -------------------------------------------------------------

export const systemsFileSchema = z
  .object({
    $comment: z.string().optional(),
    $flags: z.string().optional(),
    generatorSeed: nonNeg,
    jumpRangeLy: z.number().positive(),
    starClasses: z.array(z.enum(STAR_CLASSES)),
    columns: z
      .object({
        id: z.array(z.string().min(1)),
        name: z.array(z.string().min(1)),
        x: z.array(z.number()),
        y: z.array(z.number()),
        star: z.array(nonNeg),
        owner: z.array(z.string().min(1)),
        flags: z.array(nonNeg),
      })
      .strict(),
  })
  .strict();

export type SystemsFile = z.infer<typeof systemsFileSchema>;

// --- factions.json ------------------------------------------------------------

/**
 * Вид актора.
 *
 * `clan` и `mercenary` — не задел, а действующие виды: эпоха каталога 3053 год,
 * четыре зоны оккупации кланов уже стоят на карте, а Аутрич принадлежит Волчьим
 * Драгунам. Ровно на этом и проверяется правило «владелец — ссылка в реестр»
 * (`wiki/design/campaign/planets.md` §9): наёмный отряд владеет системой той же
 * ссылкой, что и Великий Дом, и ни одна строка кода об этом не спрашивает.
 */
export const FACTION_KINDS = [
  'house',
  'comstar',
  'periphery',
  'independent',
  'pirates',
  'mercenary',
  'clan',
] as const;
export type FactionKind = (typeof FACTION_KINDS)[number];

export const factionsFileSchema = z
  .object({
    $comment: z.string().optional(),
    $comment2: z.string().optional(),
    $comment3: z.string().optional(),
    $comment4: z.string().optional(),
    $comment5: z.string().optional(),
    factions: z.array(
      z
        .object({
          id: z.string().min(1),
          kind: z.enum(FACTION_KINDS),
          name: z.string().min(1),
          short: z.string().min(1),
          color: z.string().regex(/^#[0-9a-f]{6}$/),
          capital: z.string().min(1).optional(),
          /**
           * Внетерриториальный доход за такт (шаг 21a), C-Bills. Необязателен:
           * у кого его нет, тот живёт только со своих миров.
           *
           * Заведён потому, что доход строго по территории делает беднейшими
           * фракциями Сферы КомСтар (один мир, Терра) и Волчьих Драгун (один
           * мир, Аутрич — стартовая система роты). КомСтар живёт с монополии на
           * ГПГ, Драгуны — с контрактов, пираты — с набегов, и всё это не
           * считается по владению планетами.
           */
          income: z.number().nonnegative().optional(),
        })
        .strict(),
    ),
  })
  .strict();

export type FactionDef = z.infer<typeof factionsFileSchema>['factions'][number];

// --- galaxy.json --------------------------------------------------------------

const comment = z.string().optional();
const biomeIds = BIOME_LIST.map((b) => b.id) as [string, ...string[]];
const biomeRecord = <T extends z.ZodTypeAny>(value: T) =>
  z.object(Object.fromEntries(biomeIds.map((id) => [id, value])) as Record<string, T>).strict();

export const galaxyFileSchema = z
  .object({
    $comment: comment,
    $comment2: comment,
    jump: z
      .object({
        $comment: comment,
        rangeLy: z.number().positive(),
        transitDays: z.number().positive(),
        rechargeHoursByStar: z.object(
          Object.fromEntries(STAR_CLASSES.map((c) => [c, z.number().positive()])) as Record<
            StarClass,
            z.ZodNumber
          >,
        ).strict(),
        costPerJump: nonNeg,
        costPerTransitDay: nonNeg,
      })
      .strict(),
    start: z.object({ $comment: comment, systemId: z.string().min(1) }).strict(),
    survey: z.object({ $comment: comment, cost: nonNeg, days: z.number().positive() }).strict(),
    profile: z
      .object({
        $comment: comment,
        capitalPullLy: z.number().positive(),
        borderRangeLy: z.number().positive(),
        population: z
          .object({
            $comment: comment,
            minLog: z.number(),
            maxLog: z.number(),
            skew: z.number().positive(),
            capitalPullBonus: z.number(),
            capitalFlagBonus: z.number(),
            industrialFlagBonus: z.number(),
          })
          .strict(),
        industry: z
          .object({
            $comment: comment,
            civilSpread: nonNeg,
            militaryBorderWeight: z.number(),
            militarySpread: nonNeg,
            mechFactoryBonus: nonNeg,
          })
          .strict(),
        tech: z
          .object({
            $comment: comment,
            perMilitary: z.number().positive(),
            mechFactoryBonus: nonNeg,
            clanBonus: nonNeg,
          })
          .strict(),
        development: z
          .object({
            $comment: comment,
            $comment2: comment,
            $comment3: comment,
            min: z.number().int().nonpositive(),
            max: z.number().int().nonnegative(),
            populationPerStep: z.number().nonnegative(),
          })
          .strict(),
        market: z
          .object({
            $comment: comment,
            industrialMilitary: nonNeg,
            developedPopulation: z.number().positive(),
            agrarianCivil: nonNeg,
            agrarianMilitaryMax: nonNeg,
            backwaterPopulation: z.number().positive(),
          })
          .strict(),
        garrison: z
          .object({
            $comment: comment,
            perMilitary: z.number(),
            borderWeight: z.number(),
            capitalBonus: z.number(),
            spread: nonNeg,
            moderateFrom: nonNeg,
            strongFrom: nonNeg,
          })
          .strict(),
        biomeWeights: biomeRecord(z.number().nonnegative()),
        /**
         * Канонические биомы столиц: id системы → id биома. Значение проверяется
         * по списку биомов, чтобы опечатка не прошла молча; ключи — id систем,
         * их сверяет `galaxy.test.ts` (каталог систем схеме не виден).
         */
        canonicalBiomes: z
          .object({ $comment: comment })
          .catchall(z.enum(biomeIds))
          .optional(),
        /**
         * Экономика биома (шаг 24). Идёт через тот же `biomeRecord`, что и веса:
         * он требует запись НА КАЖДЫЙ биом из `biomes.json`, поэтому забытый биом
         * остановит загрузку, а не всплывёт через год перекошенным замером.
         *
         * `populationCapM: null` — «потолка нет»: у умеренного мира его и не должно
         * быть, а необязательное поле молча простило бы забытый потолок.
         */
        biomeEconomy: biomeRecord(
          z
            .object({
              habitability: z.number(),
              populationCapM: z.number().positive().nullable(),
              richness: z.number().min(0).max(1),
            })
            .strict(),
        )
          .extend({
            $comment: comment,
            $comment2: comment,
            $comment3: comment,
            $comment4: comment,
            richnessBonus: z.number().nonnegative(),
            capitalCapLog: z.number(),
            factoryCapLog: z.number(),
          })
          .strict(),
        temperatureC: biomeRecord(z.tuple([z.number(), z.number()]))
          .extend({
            $comment: comment,
            starShiftC: z.object(
              Object.fromEntries(STAR_CLASSES.map((c) => [c, z.number()])) as Record<StarClass, z.ZodNumber>,
            ).strict(),
          })
          .strict(),
        gravityG: z.object({ min: z.number(), max: z.number(), peak: z.number() }).strict(),
        atmosphereByBiome: biomeRecord(
          z.object(
            Object.fromEntries(ATMOSPHERES.map((a) => [a, z.number().nonnegative()])) as Record<
              Atmosphere,
              z.ZodNumber
            >,
          ).strict(),
        ),
        spaceportByCivil: z.array(z.number()),
        /**
         * Пороги естественного фокуса (шаг 25). Чистые числа, без бросков:
         * фокус, который никто не менял, обязан выводиться из профиля так же,
         * как выводится сам профиль.
         */
        focus: z
          .object({
            $comment: comment,
            $comment2: comment,
            metropolisPopulationM: z.number().positive(),
            fortressGarrison: nonNeg,
            fortressBorder: z.number().min(0).max(1),
            arsenalMilitary: nonNeg,
            miningRichness: z.number().min(0).max(1),
            miningPopulationM: z.number().positive(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export type GalaxyFile = z.infer<typeof galaxyFileSchema>;

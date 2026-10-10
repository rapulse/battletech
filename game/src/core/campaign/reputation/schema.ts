import { z } from 'zod';
import reputationJson from '../../../../data/reputation.json';
import { FACTION_KINDS } from '../galaxy/schema.js';
import { MISSION_TYPES, type MissionType } from '../contracts/schema.js';

/**
 * Схема таблицы репутации (шаг 20) — `data/reputation.json`.
 *
 * Тот же порядок, что у контрактов, рынка и галактики: своя схема на таблицу,
 * разбор один раз при загрузке модуля, строгие объекты. Опечатка в имени типа
 * миссии или пропущенный порог останавливают загрузку здесь, а не всплывают
 * биржей без половины предложений через месяц игры.
 *
 * Файл лежит в кампании (`data/`, разбирается кампанией), а не в
 * `core/data/tables.ts`, по той же причине, что `contracts.json` и
 * `market.json`: фракция и тип миссии — понятия кампании, а боевому ядру
 * запрещено импортировать `core/campaign/` (решение 1 §2 пайплайна).
 */

const comment = z.string().optional();

/**
 * Строка исхода контракта.
 *
 * min/max разведены по УРОВНЮ контракта: у гарнизона берётся min, у штурма —
 * max, между ними линейно. Отдельной таблицы «дельта по типу миссии» нет
 * намеренно: она была бы вторым списком типов миссий рядом с
 * `data/contracts.json`, и второй список однажды разошёлся бы с первым.
 */
const outcomeSchema = z
  .object({
    employerMin: z.number(),
    employerMax: z.number(),
    targetMin: z.number(),
    targetMax: z.number(),
    fame: z.number().nonnegative(),
    reliability: z.number(),
  })
  .strict();

/** Множитель по оси отношения: −100 → atWorst, 0 → atNeutral, +100 → atBest. */
const standingCurveSchema = z
  .object({
    atWorst: z.number().positive(),
    atNeutral: z.number().positive(),
    atBest: z.number().positive(),
  })
  .strict();

const accessRowSchema = z
  .object({ standingMin: z.number(), fameMin: z.number().nonnegative() })
  .strict();

export const reputationFileSchema = z
  .object({
    $comment: comment,
    $comment2: comment,
    axes: z
      .object({
        $comment: comment,
        standingMin: z.number().negative(),
        standingMax: z.number().positive(),
        fameMax: z.number().positive(),
        reliabilityMax: z.number().positive(),
        reliabilityStart: z.number().nonnegative(),
      })
      .strict(),
    contract: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        won: outcomeSchema,
        beyond: outcomeSchema,
        lost: outcomeSchema,
        withdrawn: outcomeSchema,
        abandoned: outcomeSchema,
        expired: outcomeSchema,
      })
      .strict(),
    network: z
      .object({ $comment: comment, k: z.number().nonnegative(), minSpread: z.number().nonnegative() })
      .strict(),
    decay: z
      .object({
        $comment: comment,
        intervalDays: z.number().int().positive(),
        standingPerTick: z.number().nonnegative(),
        famePerTick: z.number().nonnegative(),
        /** Затухание ниже нижнего порога доступа: глубокая вражда остывает быстрее (2026-09-14). */
        hostileStandingPerTick: z.number().nonnegative(),
      })
      .strict(),
    $commentAtonement: comment,
    atonement: z
      .object({
        /** Сколько искупительных контрактов выставляет враждебный наниматель на своей бирже. */
        offers: z.number().int().min(0),
        /** Во сколько раз прибавка отношения за искупление больше обычной прибавки уровня миссии. */
        standingFactor: z.number().positive(),
      })
      .strict(),
    $commentDiplomacy: comment,
    /**
     * Дипломатия державы игрока (шаг 26, часть C). Ступеней доступа нет с шага
     * 72c: держава — это рота, у которой есть хоть один мир.
     */
    diplomacy: z
      .object({
        $commentCost: comment,
        /** Насколько соглашение поднимает отношение с партнёром. */
        pactStanding: z.number().nonnegative(),
        /** Цены дипломатических шагов — в тактах дохода мира, о котором речь. */
        pactCostTicks: z.number().nonnegative(),
        tributeCostTicks: z.number().nonnegative(),
        protectorateCostTicks: z.number().nonnegative(),
        /** Ниже этого отношения с партнёром переговоров не бывает вовсе. */
        minStanding: z.number(),
      })
      .strict(),
    access: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        ungatedKinds: z.array(z.enum(FACTION_KINDS)),
        missions: z
          .object(
            Object.fromEntries(MISSION_TYPES.map((m) => [m, accessRowSchema])) as Record<
              MissionType,
              typeof accessRowSchema
            >,
          )
          .strict(),
      })
      .strict(),
    effects: z
      .object({
        $comment: comment,
        $comment2: comment,
        $comment3: comment,
        $comment4: comment,
        payout: standingCurveSchema,
        salvage: standingCurveSchema,
        advance: z
          .object({
            atZero: z.number().nonnegative(),
            atStart: z.number().nonnegative(),
            atMax: z.number().nonnegative(),
          })
          .strict(),
        market: standingCurveSchema,
        hireTierPerFame: z.number().nonnegative(),
      })
      .strict(),
  })
  .strict();

export type ReputationFile = z.infer<typeof reputationFileSchema>;

/** Исходы контракта, за которые начисляется репутация. Ключи строки `contract` таблицы. */
export const REPUTATION_OUTCOMES = ['won', 'beyond', 'lost', 'withdrawn', 'abandoned', 'expired'] as const;
export type ReputationOutcome = (typeof REPUTATION_OUTCOMES)[number];

function parse(): ReputationFile {
  try {
    return reputationFileSchema.parse(reputationJson);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Ошибка в данных репутации (data/reputation.json):\n${detail}`);
  }
}

export const REPUTATION: ReputationFile = parse();

// Стартовая надёжность обязана лежать внутри оси: отряд, начинающий за её
// пределами, получил бы аванс по множителю, которого нет ни на одном конце
// шкалы. Проверка при загрузке, а не тестом: тест ловит это на минуту позже,
// чем игра.
if (
  REPUTATION.axes.reliabilityStart < 0 ||
  REPUTATION.axes.reliabilityStart > REPUTATION.axes.reliabilityMax
) {
  throw new Error(
    `Ошибка в данных репутации (data/reputation.json):\n` +
      `стартовая надёжность ${REPUTATION.axes.reliabilityStart} вне оси 0..${REPUTATION.axes.reliabilityMax}`,
  );
}

// Гарнизонная работа обязана быть доступна отряду без единого контракта:
// нулевая известность и нулевое отношение — это состояние КАЖДОЙ кампании в
// первый день. Порог выше нуля здесь означал бы биржу, пустую с самого начала,
// и заметили бы это не тестом, а прогоном на семьдесят сидов.
{
  const first = REPUTATION.access.missions.garrison;
  if (first.standingMin > 0 || first.fameMin > 0) {
    throw new Error(
      `Ошибка в данных репутации (data/reputation.json):\n` +
        `гарнизонная работа недоступна отряду с нулевой репутацией (standingMin=${first.standingMin}, fameMin=${first.fameMin})`,
    );
  }
}

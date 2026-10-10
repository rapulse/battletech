import { z } from 'zod';
import eventsJson from '../../../../data/events.json';
import { FACTIONS } from '../galaxy/catalog.js';

/**
 * Схема таблицы событий мира (шаг 84) — `data/events.json`.
 *
 * Тот же порядок, что у `war.json`: своя схема, разбор один раз при загрузке модуля, строгие
 * объекты. Опечатка в id фракции останавливает загрузку здесь, а не молча отменяет веху через
 * пять лет игры.
 */

const comment = z.string().optional();
const factionId = z.string().refine((id) => FACTIONS.has(id), { message: 'нет такой фракции' });

/** Сторона действия: id фракции, `@house`, `@clan` или `@realm` (держава роты). */
export const EVENT_GROUPS = ['@house', '@clan', '@realm'] as const;
const side = z.array(z.union([z.enum(EVENT_GROUPS), factionId])).min(1);

const month = z
  .object({ year: z.number().int(), month: z.number().int().min(1).max(12) })
  .strict();

const condition = z.discriminatedUnion('kind', [
  /** Фракция держит не меньше `min` миров (`min` 1 — «жива»). */
  z.object({ kind: z.literal('worlds'), faction: factionId, min: z.number().int().min(1) }).strict(),
  /** У пары есть общая граница. */
  z.object({ kind: z.literal('border'), a: factionId, b: factionId }).strict(),
]);

const action = z.discriminatedUnion('kind', [
  /** Отношение пар: не выше `atMost` (вражда) или не ниже `atLeast` (сближение). */
  z
    .object({
      kind: z.literal('relation'),
      a: side,
      b: side,
      atMost: z.number().min(-1).max(1).optional(),
      atLeast: z.number().min(-1).max(1).optional(),
      border: z.boolean(),
    })
    .strict()
    .refine((r) => (r.atMost === undefined) !== (r.atLeast === undefined), {
      message: 'relation: ровно одно из atMost и atLeast',
    }),
  /** Перемирие на срок договора (`diplomacy.ts::signPact`). */
  z.object({ kind: z.literal('truce'), a: side, b: side, border: z.boolean() }).strict(),
  /** Перемирие Тукайида для пар снято: клан и Сфера воюют на общих правах. */
  z.object({ kind: z.literal('liftTukayyid'), a: side, b: side, border: z.boolean() }).strict(),
  /** Замысел наступления каждой стороны `by` против `against` у их общей границы. */
  z
    .object({ kind: z.literal('plan'), by: side, against: side, decades: z.number().int().min(1) })
    .strict(),
  /**
   * Приглашение державы роты в коалицию против `against`: только если у державы есть граница с
   * ним. Союзники — стороны `allies` с той же границей. Принять — война державы с `against` и
   * `acceptStanding` к отношению союзников к роте; отказать — `declineStanding`.
   */
  z
    .object({
      kind: z.literal('invite'),
      against: factionId,
      allies: side,
      acceptStanding: z.number(),
      declineStanding: z.number(),
    })
    .strict(),
]);

const event = z
  .object({
    id: z.string().regex(/^[a-z0-9-]+$/),
    $note: comment,
    /** Картинка карточки (путь в `public/`). Пока картинок нет — на карточке пустое место под неё. */
    image: z.string().min(1).optional(),
    from: month,
    until: month,
    when: z.array(condition),
    do: z.array(action).min(1),
  })
  .strict()
  .refine((e) => e.from.year * 12 + e.from.month <= e.until.year * 12 + e.until.month, {
    message: 'окно события: from позже until',
  })
  .refine((e) => e.do.filter((a) => a.kind === 'invite').length <= 1, {
    message: 'у события не больше одного приглашения',
  });

const eventsFileSchema = z
  .object({
    $comment: comment,
    $commentSelectors: comment,
    events: z.array(event),
  })
  .strict()
  .refine((f) => new Set(f.events.map((e) => e.id)).size === f.events.length, {
    message: 'id событий повторяются',
  });

export type EventsFile = z.infer<typeof eventsFileSchema>;
export type WorldEventDef = EventsFile['events'][number];
export type EventAction = WorldEventDef['do'][number];
export type EventCondition = WorldEventDef['when'][number];
export type EventSide = z.infer<typeof side>;

function parse(): EventsFile {
  try {
    return eventsFileSchema.parse(eventsJson);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`Ошибка в данных событий (data/events.json):\n${detail}`);
  }
}

export const EVENTS: EventsFile = parse();

import { PLAYER_ACTOR_ID } from '../../core/campaign/index.js';
import type { WarLine } from '../state/campaign.svelte.js';

/**
 * Поворот державы (после шага 93): строка сводки, которую стоит показать картинкой, — объявлена война, война кончилась,
 * мир восстал, держава взяла или потеряла мир. Показ — без остановки времени (решение пользователя 2026-10-09): миры
 * при стойке «наступать» берутся часто, и карточка-остановка сбивала бы темп.
 */
export const REALM_MOMENTS = ['war', 'peace', 'revolt', 'taken', 'lost'] as const;
export type RealmMoment = (typeof REALM_MOMENTS)[number];

/** Картинка поворота — из `public/`, собирает `tools/pack_event_art.py`. */
export const MOMENT_IMAGE: Readonly<Record<RealmMoment, string>> = {
  war: '/ui/events/realm-war-declared.webp',
  peace: '/ui/events/realm-peace.webp',
  revolt: '/ui/events/realm-revolt.webp',
  taken: '/ui/events/realm-world-taken.webp',
  lost: '/ui/events/realm-world-lost.webp',
};

/** Сколько дней поворот висит в Штабе: дальше он — просто строка ленты. */
export const MOMENT_DAYS = 90;

export function momentOf(line: WarLine): RealmMoment | null {
  switch (line.kind) {
    case 'warDeclared':
      return 'war';
    case 'warEnded':
      return line.ended === 'realmFallen' ? null : 'peace';
    case 'revolt':
      return line.detail === 'won' ? null : 'revolt';
    case 'seceded':
      return 'lost';
    case 'capture':
      return line.attacker === PLAYER_ACTOR_ID ? 'taken' : line.defender === PLAYER_ACTOR_ID ? 'lost' : null;
    case 'clash': {
      if (line.clash?.outcome !== 'captured') return null;
      return line.attacker === PLAYER_ACTOR_ID ? 'taken' : line.defender === PLAYER_ACTOR_ID ? 'lost' : null;
    }
    default:
      return null;
  }
}

/** Последний поворот среди строк (новые сверху) не старше `MOMENT_DAYS`. */
export function latestMoment(lines: readonly WarLine[], day: number): { moment: RealmMoment; line: WarLine } | null {
  for (const line of lines) {
    if (day - line.day > MOMENT_DAYS) return null;
    const moment = momentOf(line);
    if (moment !== null) return { moment, line };
  }
  return null;
}

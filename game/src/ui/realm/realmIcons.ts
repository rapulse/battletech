import type { FrontStance, GovernorPriority, WorldFocus } from '../../core/campaign/index.js';
import type { WorldAlert } from './worldAlerts.js';

/**
 * Ячейки атласа `realm_icons` (`tools/pack_ui_atlases.py`, сетка 5×5 по строкам): фокусы мира, приоритеты
 * губернатора, тревоги, стойки с гарнизоном и губернатором, дипломатия. Значок — второй канал к подписи, а не
 * замена ей: слово остаётся в подсказке или рядом.
 */
export const FOCUS_ICON: Readonly<Record<WorldFocus, number>> = {
  granary: 0,
  mining: 1,
  arsenal: 2,
  metropolis: 3,
  fortress: 4,
};

export const PRIORITY_ICON: Readonly<Record<GovernorPriority, number>> = {
  income: 5,
  defence: 6,
  army: 7,
  development: 8,
  loyalty: 9,
};

export const ALERT_ICON: Readonly<Record<WorldAlert, number>> = {
  revolt: 10,
  loyalty: 11,
  threat: 12,
  ruin: 13,
  tribute: 14,
};

export const STANCE_ICON: Readonly<Record<FrontStance, number>> = {
  advance: 15,
  hold: 16,
  yield: 17,
};

export const GARRISON_ICON = 18;
export const GOVERNOR_ICON = 19;

/** Дипломатия: договоры (`realm.pact.*`), протекторат и вассал, война, военный фонд. */
export const DIPLOMACY_ICON = {
  truce: 20,
  trade: 21,
  vassal: 22,
  war: 23,
  fund: 24,
} as const;

/** Ячейки атласа `realm_titles`: лестница титулов (`war.json → realm.titles`), шестая — следующий, ещё закрытый. */
export const TITLE_ICON: Readonly<Record<string, number>> = {
  barony: 0,
  county: 1,
  duchy: 2,
  principality: 3,
  claimant: 4,
};
export const TITLE_LOCKED = 5;

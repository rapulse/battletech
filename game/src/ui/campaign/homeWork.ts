import type { Contract } from '../../core/campaign/index.js';

/**
 * Виды работы державы на бирже (шаги 85, 89, 90): дома, подавить восстание, пираты у дома, работа на мире врага.
 * Заголовок и подсказка карточки — ключи `contracts.<вид>` и `contracts.<вид>Hint`; набор сверяет `test/i18n.test.ts`.
 */
export const HOME_WORK_KINDS = ['home', 'revolt', 'homeRaid', 'warWork'] as const;
export type HomeWorkKind = (typeof HOME_WORK_KINDS)[number];

export function homeKind(c: Contract): HomeWorkKind {
  return c.revolt === true ? 'revolt' : c.homeRaid === true ? 'homeRaid' : c.warWork === true ? 'warWork' : 'home';
}

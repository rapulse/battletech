import { FACTIONS, REPUTATION } from '../../core/campaign/index.js';
import { factionShortName } from '../i18n/names.js';

export { dateOf } from '../../core/campaign/index.js';

/**
 * Показ отношений (шаг 20).
 *
 * Ни одного числа своего: имя фракции берётся из реестра акторов, а границы
 * словесной шкалы — из ПОРОГОВ ДОСТУПНОСТИ (`data/reputation.json`). Слово на
 * экране обязано означать последствие, а не настроение художника: «терпят» —
 * это ровно «дадут только гарнизон», «доверяют» — «доверят оборону».
 * Выдуманные отдельно границы разошлись бы с порогами при первом же тюнинге,
 * и игрок читал бы «ценят» там, где работы уже не дают.
 */

export function factionName(id: string): string {
  return factionShortName(id, FACTIONS.get(id)?.short ?? id);
}

export type StandingBand = 'hostile' | 'cold' | 'neutral' | 'warm' | 'trusted';

/**
 * Слово по отношению.
 *
 * Считает по ОКРУГЛЁННОМУ значению — тому же, которое стоит рядом числом.
 * Иначе отношение −0.4 показывалось бы как «0 · терпят», и игрок читал бы
 * расхождение слова с числом как ошибку, а не как округление.
 *
 * Границы — пороги доступности: «враги» это ровно «не дадут даже гарнизона»,
 * «ценят» — «доверят оборону».
 */
export function standingBand(standing: number): StandingBand {
  const gate = REPUTATION.access.missions;
  const v = Math.round(standing);
  if (v < gate.garrison.standingMin) return 'hostile';
  if (v < 0) return 'cold';
  if (v === 0) return 'neutral';
  if (v < gate.defense.standingMin) return 'warm';
  return 'trusted';
}

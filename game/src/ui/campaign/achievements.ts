import { ACHIEVEMENTS, type AchievementDef } from '../../core/data/index.js';
import { cbills, t } from '../i18n/index.js';

/**
 * Слова для достижений (шаг 69): название и подсказка по id.
 *
 * Числа в подсказке — параметры условия из `data/achievements.json`, а не
 * вписанные в словарь: порог правится в данных, и подсказка обязана сказать
 * ровно тот, по которому ядро открывает значок.
 */

export function achievementDef(id: string): AchievementDef | undefined {
  return ACHIEVEMENTS.achievements.find((a) => a.id === id);
}

export function achievementName(id: string): string {
  return t(`achievement.${id}.name`);
}

export function achievementHint(def: AchievementDef): string {
  const params: Record<string, string | number> = {};
  for (const [key, value] of Object.entries(def.condition)) {
    if (typeof value === 'number') params[key] = value;
  }
  if (def.condition.type === 'cbills') params.min = cbills(def.condition.min);
  return t(`achievement.${def.id}.hint`, params);
}

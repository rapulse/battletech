import { MILESTONES, type MilestoneDef } from '../../core/data/index.js';
import { t } from '../i18n/index.js';

/**
 * Слова для глав кампании (шаг 70): название, описание, подсказка по id.
 *
 * Числа в подсказке — параметры условия из `data/milestones.json`, а не
 * вписанные в словарь: порог правится в данных, и подсказка обязана назвать
 * ровно тот, по которому ядро отмечает веху. Тот же приём, что у достижений.
 */

function milestoneDef(id: string): MilestoneDef | undefined {
  for (const c of MILESTONES.campaigns.merc.chapters) {
    const m = c.milestones.find((x) => x.id === id);
    if (m !== undefined) return m;
  }
  return undefined;
}

export function chapterName(id: string): string {
  return t(`progress.chapter.${id}.name`);
}

export function chapterDesc(id: string): string {
  return t(`progress.chapter.${id}.desc`);
}

export function milestoneName(id: string): string {
  return t(`progress.milestone.${id}.name`);
}

export function milestoneHint(id: string): string {
  const params: Record<string, string | number> = {};
  const def = milestoneDef(id);
  if (def !== undefined) {
    for (const [key, value] of Object.entries(def.condition)) {
      if (typeof value === 'number') params[key] = value;
    }
  }
  return t(`progress.milestone.${id}.hint`, params);
}

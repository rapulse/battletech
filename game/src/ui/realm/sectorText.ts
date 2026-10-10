import { WAR, type GovernorPriority } from '../../core/campaign/index.js';
import { t } from '../i18n/index.js';

/** Что делает приоритет губернатора — из данных (`realm.priorities`): порядок стройки, развитие, фокус. */
export function priorityHint(pr: GovernorPriority): string {
  const rule = WAR.realm.priorities[pr];
  const parts = [t('realm.sector.orderLine', { list: rule.buildings.map((k) => t(`realm.world.building.${k}`)).join(' → ') })];
  if (rule.develop) parts.push(t('realm.sector.developLine'));
  if (rule.focus !== null) parts.push(t('realm.sector.focusLine', { focus: t(`focus.${rule.focus}`) }));
  return parts.join(' ');
}

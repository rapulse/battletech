import type { IntelSurprise } from '../../core/campaign/contracts/intel.js';
import { t, tn } from '../i18n/index.js';

/**
 * Расхождение сводки с фактом словами (шаг 61). Ядро отдаёт два числа, а «недооценила» это
 * или «переоценила» — решает экран: разброс разведки симметричен (`intel.ts`), и обе
 * формулировки одинаково законны. `scope` — где строка стоит: шапка боя («battle») коротка,
 * разбор («debrief») договаривает про задачу.
 */
export function intelSurpriseText(s: IntelSurprise, scope: 'battle' | 'debrief'): string {
  const key = s.actual > s.declared ? 'intelUnder' : 'intelOver';
  return t(`${scope}.${key}`, { actual: tn('count.mechs', s.actual), declared: s.declared });
}

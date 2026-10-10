import type { RenderLabels } from '../../render/labels.js';
import { t } from '../i18n/index.js';

/**
 * Подписи карты для рендера — из словаря интерфейса (шаг 52).
 *
 * Рендер словаря не знает (`render/labels.ts`), поэтому набор собирается
 * здесь и отдаётся ему целиком. Функция, а не константа: при смене языка набор
 * собирается заново.
 */
export function renderLabels(): RenderLabels {
  return {
    rangeMin: (n) => t('battle.map.rangeMin', { n }),
    rangeShort: (n) => t('battle.map.rangeShort', { n }),
    rangeMedium: (n) => t('battle.map.rangeMedium', { n }),
    rangeLong: (n) => t('battle.map.rangeLong', { n }),
    rangeMax: (n) => t('battle.map.rangeMax', { n }),
    blip: t('battle.map.blip'),
    unidentified: t('battle.map.unidentified'),
    tons: (n) => t('battle.map.tons', { n }),
    weaponCount: (n) => t('battle.map.weaponCount', { n }),
    wreckTag: (id) => t('battle.map.wreckTag', { id }),
    wreckTitle: t('battle.map.wreckTitle'),
    wreckElevation: t('battle.map.wreckElevation'),
    losPrompt: t('battle.map.losPrompt'),
    losMode: t('battle.map.losMode'),
    losBlocked: t('battle.map.losBlocked'),
    losCover: (n) => t('battle.map.losCover', { n }),
    losClear: t('battle.map.losClear'),
  };
}

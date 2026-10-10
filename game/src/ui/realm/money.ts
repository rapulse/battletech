import { t } from '../i18n/index.js';

/**
 * Итог мира или сектора коротко — для подписи на карте и строки списка Штаба (шаг 93): полная сумма
 * в 10 знаков там не читается. Меньше 100 тысяч — тысячами, иначе миллионами с десятой: −7 000 не
 * должно выглядеть как «−0.0 млн».
 */
export function shortMoney(n: number): string {
  const sign = n < 0 ? '−' : '+';
  const abs = Math.abs(n);
  if (abs < 100_000) return t('realm.map.thousands', { sum: `${sign}${Math.round(abs / 1000)}` });
  return t('realm.map.millions', { sum: `${sign}${(abs / 1_000_000).toFixed(1)}` });
}

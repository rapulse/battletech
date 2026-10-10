import { WAR } from '../../core/campaign/war/schema.js';
import type { RealmWorld } from '../state/campaign.svelte.js';

/**
 * Тревоги мира державы для списка и карты Штаба (шаг 93). Пороги — те же, что у прежнего экрана
 * (`RealmScreen.svelte::ruinAlert`, `loyaltyAlert`), чтобы (А) и Штаб показывали одно и то же.
 */
export type WorldAlert = 'revolt' | 'loyalty' | 'threat' | 'ruin' | 'tribute';

export const WORLD_ALERTS: readonly WorldAlert[] = ['revolt', 'loyalty', 'threat', 'ruin', 'tribute'];

export function worldAlerts(w: RealmWorld): readonly WorldAlert[] {
  const out: WorldAlert[] = [];
  if (w.revoltUntil !== null) out.push('revolt');
  else if (w.loyalty !== null && w.loyaltyDrift < 0 && w.loyalty < 2 * WAR.loyalty.revoltBelow) out.push('loyalty');
  if (w.threats.length > 0) out.push('threat');
  if (w.ruined >= WAR.development.ruinBlock) out.push('ruin');
  if (w.tributeTo !== null) out.push('tribute');
  return out;
}

/** Красные — мир можно потерять; янтарные — он работает хуже. */
export const ALERT_SEVERE: Readonly<Record<WorldAlert, boolean>> = {
  revolt: true,
  loyalty: true,
  threat: true,
  ruin: false,
  tribute: false,
};

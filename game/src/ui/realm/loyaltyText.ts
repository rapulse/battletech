/**
 * Лояльность мира для показа (шаг 93): ядро хранит её дробной, игроку — целое и сдвиг за декаду с десятой, как на
 * карточке мира прежнего экрана (`RealmScreen.svelte`, плитка «Лояльность»).
 */
export function loyaltyValue(v: number): number {
  return Math.round(v);
}

export function loyaltyDrift(d: number): string {
  const r = Math.round(d * 10) / 10;
  return `${r > 0 ? '+' : r < 0 ? '−' : ''}${Math.abs(r)}`;
}

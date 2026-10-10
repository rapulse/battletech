import { factionKind } from '../contracts/relations.js';
import { MISSION_TYPES, type MissionType } from '../contracts/schema.js';
import { REPUTATION } from './schema.js';

/**
 * Последствия репутации (шаг 20, часть C) — то, ради чего весь шаг и затеян.
 *
 * Без этого файла три оси остались бы красивыми числами, которые ни на что не
 * влияют. Здесь они превращаются в доступность работы, деньги, аванс, цены и
 * качество найма. Ни одного числа в коде: всё из `data/reputation.json`.
 *
 * Все кривые устроены одинаково и намеренно: при НУЛЕВОЙ репутации множитель
 * равен единице. Ровно поэтому баланс шагов 16–19 остаётся в силе на первом
 * контракте кампании, а шаг 20 добавляет разброс вокруг него, а не смещает всю
 * экономику разом.
 */

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Кривая по оси отношения: −100 → atWorst, 0 → atNeutral, +100 → atBest, между — линейно. */
function byStanding(
  curve: { readonly atWorst: number; readonly atNeutral: number; readonly atBest: number },
  standing: number,
): number {
  const s = clamp(standing, REPUTATION.axes.standingMin, REPUTATION.axes.standingMax);
  if (s >= 0) return curve.atNeutral + (curve.atBest - curve.atNeutral) * (s / REPUTATION.axes.standingMax);
  return curve.atNeutral + (curve.atWorst - curve.atNeutral) * (s / REPUTATION.axes.standingMin);
}

/**
 * Гейтится ли этот наниматель вообще — ПРЕДОХРАНИТЕЛЬ шага 20.
 *
 * У пиратской вольницы и у независимого мира нет политики: к ним идут, когда
 * больше некуда, и они берут кого угодно. Без этого дна порог доступности стал
 * бы первым правилом, способным оставить роту вовсе без работы, а тупик в
 * кампании про наёмника читается как поломка, а не как последствие (решение
 * 2026-09-03, вопрос 1 плана шага 20).
 */
export function gatedEmployer(employer: string): boolean {
  const kind = factionKind(employer);
  if (kind === undefined) return true;
  return !(REPUTATION.access.ungatedKinds as readonly string[]).includes(kind);
}

/**
 * Отношение, ниже которого наниматель не даёт отряду НИКАКОЙ обычной работы:
 * самый низкий порог доступа по типам контрактов (сейчас гарнизон, −20).
 *
 * Выводится из `access.missions`, а не хранится отдельным числом: порог
 * «вечной вражды» и порог гарнизонной службы — одно и то же по смыслу, и две
 * копии однажды разошлись бы. От него зависят искупительные контракты
 * (`contracts/board.ts`) и ускоренное затухание (`state.ts::decayReputation`).
 */
export function hostileFloor(): number {
  return Math.min(...MISSION_TYPES.map((m) => REPUTATION.access.missions[m].standingMin));
}

/**
 * Предлагает ли наниматель работу такого типа.
 *
 * Два независимых порога, и они отвечают на разные вопросы. **Отношение**
 * решает, кто с отрядом вообще разговаривает: штурм ключевой системы не доверят
 * тому, кого терпят. **Известность** решает, какого уровня работу предлагают в
 * принципе: о безымянном отряде просто не вспомнят, когда придёт большой заказ.
 */
export function missionAllowed(
  mission: MissionType,
  employer: string,
  standing: number,
  fame: number,
): boolean {
  if (!gatedEmployer(employer)) return true;
  const row = REPUTATION.access.missions[mission];
  return standing >= row.standingMin && fame >= row.fameMin;
}

/** Множитель к гонорару от отношения нанимателя. */
export function payoutFactor(standing: number): number {
  return byStanding(REPUTATION.effects.payout, standing);
}

/** Множитель к доле трофеев от отношения нанимателя. */
export function salvageFactor(standing: number): number {
  return byStanding(REPUTATION.effects.salvage, standing);
}

/**
 * Множитель к авансу — от НАДЁЖНОСТИ, а не от отношения (`reputation.md`).
 *
 * Кусочно-линейно через стартовую надёжность: у свежего отряда множитель ровно
 * единица, и аванс равен записанному в `data/contracts.json`. Ниже — вплоть до
 * нуля вперёд, выше — до полутора третей сверх.
 *
 * Это и есть то, чем закрывается эксплойт «подписал, взял аванс, отвёл звено на
 * первом ходу» (`questions.md`, п. 1): отход роняет надёжность, а надёжность
 * решает, сколько вперёд заплатит СЛЕДУЮЩИЙ наниматель.
 */
export function advanceFactor(reliability: number): number {
  const a = REPUTATION.effects.advance;
  const start = REPUTATION.axes.reliabilityStart;
  const r = clamp(reliability, 0, REPUTATION.axes.reliabilityMax);
  if (r <= start) return start <= 0 ? a.atStart : a.atZero + (a.atStart - a.atZero) * (r / start);
  const span = REPUTATION.axes.reliabilityMax - start;
  return span <= 0 ? a.atStart : a.atStart + (a.atMax - a.atStart) * ((r - start) / span);
}

/**
 * Множитель цен на территории фракции.
 *
 * Складывается в `priceFactor` рынка (`market/stock.ts`), поэтому разом
 * действует на узлы, установки, машины целиком, заказ с доставкой, цену продажи
 * и стоимость работ стапеля: снабжает роту та же фракция, чей это мир. Ниже
 * единицы при хорошем отношении — армейские склады открывают двери своим.
 */
export function marketFactor(standing: number): number {
  return byStanding(REPUTATION.effects.market, standing);
}

/**
 * Прибавка к тиру нанимаемого пилота по ИЗВЕСТНОСТИ.
 *
 * К известному отряду идут пилоты лучше — не потому, что казармы стали больше,
 * а потому, что в них стоит очередь. Округление вниз: пока известность не
 * набрана, найм остаётся ровно таким, каким его выставил шаг 13.
 */
export function hireTierBonus(fame: number): number {
  return Math.floor(clamp(fame, 0, REPUTATION.axes.fameMax) * REPUTATION.effects.hireTierPerFame);
}

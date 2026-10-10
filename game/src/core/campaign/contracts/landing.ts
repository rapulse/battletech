import { ECONOMY } from '../../data/index.js';
import type { MechRecord } from '../mech/MechRecord.js';
import type { CampaignMode } from '../state.js';
import type { Contract } from './board.js';
import { alliesSimpleThreat, contractSimpleThreat, lanceSimpleThreat, mechSimpleThreat } from './threat.js';

/**
 * Плата за высадку сверх нормы нанимателя (шаг 67, `notes.md` §10q).
 *
 * Наниматель оплачивает высадку той силы, которую нанял: звена до
 * `norm × силы противника` (1 к 1). Всё, что сверх, рота везёт за свой счёт.
 * Иначе выводить максимум машин выгодно всегда: против одного пирата высаживается
 * всё, что влезает в трюм, и бой выигрывается без царапины.
 *
 * Плата — ДОЛЯ ГОНОРАРА, растущая с перевесом линейно, а не ставка за тонну:
 * перевес одной величины обязан стоить одинаково и на дешёвой работе, и на
 * дорогой. Точки — решение пользователя 2026-09-29: 1 к 1 бесплатно, 1 к 2 —
 * половина гонорара, 1 к 3 — весь; через три точки на одной прямой кривая и
 * есть прямая. Сила сторон — ПРОСТАЯ оценка (`threat.ts::lanceSimpleThreat`:
 * тоннаж, класс узлов, комплектность, клан/Сфера; у противника — тип части и
 * снабжение), та же, что игрок видит на карточке контракта: выбор вооружения и
 * пилот не удорожают вылет, а дают перевес в бою.
 */

/** Доля гонорара, которую стоит высадка звена при отношении сил `ratio` (наши / их). */
export function landingShare(ratio: number): number {
  const l = ECONOMY.sortie.landing;
  if (l.anchorShare <= 0 || ratio <= l.norm) return 0;
  // Потолок: дальше него перевес ничего не добавляет — работа уже даром.
  return Math.min(l.maxShare, (l.anchorShare * (ratio - l.norm)) / (l.anchorRatio - l.norm));
}

/** Отношение сил (наши / их), с которого высадка забирает весь гонорар — точка потолка прямой. */
export function landingFullRatio(): number {
  const l = ECONOMY.sortie.landing;
  return l.norm + (l.maxShare * (l.anchorRatio - l.norm)) / l.anchorShare;
}

export interface LandingQuote {
  /** Сколько C-Bills спишется при вылете. */
  readonly fee: number;
  /** Отношение сил звена к противнику, наши / их. */
  readonly ratio: number;
  /** Сила противника на долю роты: за вычетом звена нанимателя (шаг 73b). */
  readonly theirs: number;
  /**
   * Перевес, по которому берётся плата: `norm + излишек / theirs`, 0 — противника нет.
   * С `ratio` совпадает, пока квоту задаёт противник; когда её задаёт самая сильная
   * машина звена, он меньше — плату объясняет он, а не `ratio`.
   */
  readonly feeRatio: number;
  /**
   * Сколько силы оплачивает наниматель, в тех же единицах, что оценка звена:
   * `norm × силы противника`, но не меньше самой сильной машины звена.
   */
  readonly allowance: number;
  /** Доля гонорара. */
  readonly share: number;
}

/**
 * Цена высадки этого звена на эту работу. Пустое звено ничего не стоит.
 *
 * **Одна машина — всегда за счёт нанимателя** (решение пользователя
 * 2026-09-23). Меньше одной машины не вывести, и без этого правила мелкая работа
 * против одного-трёх слабых противников была бы закрыта: одна средняя машина
 * против одиночного пирата — уже перевес около трёх. Поэтому оплачивается
 * большее из двух: норма от силы противника или самая сильная машина звена, а
 * кривая берёт только излишек сверх этого — как если бы звено стояло на норме
 * плюс излишек. Мелкая работа выходит бесплатной для одной машины любого веса,
 * но она и дешёвая; на крупной норма от противника больше любой машины, и
 * действует вся кривая.
 *
 * Считается по СВОДКЕ нанимателя (объявленные число машин, полоса тоннажа, тип
 * части и снабжение), а не по тому, что выйдет на поле: наниматель платит по своей
 * разведке, цена известна до вылета, ошибка разведки (шаг 57) — риск роты.
 *
 * **Песочница (шаг 74)** меняет только квоту: наниматель оплачивает
 * `sandbox.landingMechs` (24, трюм «Оверлорда») самых сильных машин звена, так
 * что любое звено укладывается в квоту и плата равна нулю. Формула остаётся
 * одна на оба режима.
 */
export function landingQuote(
  contract: Contract,
  lance: readonly MechRecord[],
  mode: CampaignMode,
): LandingQuote {
  const l = ECONOMY.sortie.landing;
  // Звено нанимателя (шаг 73b) уже закрывает свою часть противника: на долю
  // роты остаётся разница. Иначе союзник был бы бесплатным перевесом — рота
  // везла бы полный наряд, а наниматель ещё и своё звено.
  const theirs = Math.max(0, contractSimpleThreat(contract) - alliesSimpleThreat(contract));
  const ours = lanceSimpleThreat(lance);
  const strongest = lance.reduce((best, m) => Math.max(best, mechSimpleThreat(m)), 0);
  const allowance =
    mode === 'sandbox' ? ECONOMY.sandbox.landingMechs * strongest : Math.max(l.norm * theirs, strongest);
  const ratio = theirs > 0 ? ours / theirs : 0;
  const excess = Math.max(0, ours - allowance);
  const feeRatio = theirs > 0 ? l.norm + excess / theirs : 0;
  const share = theirs > 0 ? landingShare(feeRatio) : 0;
  return { fee: Math.round(contract.payout * share), ratio, theirs, feeRatio, allowance, share };
}

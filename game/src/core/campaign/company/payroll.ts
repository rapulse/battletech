import { ECONOMY } from '../../data/index.js';
import { dropshipDefOf, fleetTonnage, type Company } from './types.js';

/**
 * Содержание роты (шаг 13, решение 6 из §2 — вторая лестница, вниз).
 *
 * Раз в `ECONOMY.payroll.intervalDays` суток: аренда корабля (фиксированная,
 * платится всегда — рота держит десантный корабль, даже когда в ангаре пусто),
 * зарплаты пилотов и обслуживание парка по суммарному тоннажу.
 */
export function payrollAmount(company: Company): number {
  const p = ECONOMY.payroll;
  const shipRent = dropshipDefOf(company).shipRent;
  return shipRent + p.pilotSalary * company.pilots.length + p.mechUpkeepPerTon * fleetTonnage(company);
}

/**
 * Списание, от которого нельзя отказаться: содержание, неустойка за разрыв
 * контракта, штраф за провал по сроку.
 *
 * Отличается от `spend` в `commands/execute.ts` ровно одним, и это разница по
 * смыслу, а не по реализации: покупку без денег можно ОТКЛОНИТЬ, а неустойку
 * нельзя — она уже начислена. Уход в минус не останавливает роту, это
 * измеряемое разорение (`bankrupt`), а не game over.
 *
 * `bankrupt` — ИСТОРИЯ: «рота хоть раз уходила в минус» (с днём). Флаг не
 * снимается, и это нужно замерам кампании и соперникам, у которых разорение
 * распускает отряд. Сейчас ли рота в минусе — отдельный вопрос, `isInsolvent`.
 */
export function chargeUnavoidable(company: Company, amount: number, day: number): Company {
  const cbills = company.cbills - amount;
  if (cbills >= 0 || company.bankrupt) return { ...company, cbills };
  return { ...company, cbills, bankrupt: true, bankruptDay: day };
}

/**
 * Неплатёжеспособна ли рота СЕЙЧАС: касса ниже нуля.
 *
 * Отдельно от `bankrupt` (плейтест 2026-09-15): надпись «Рота неплатёжеспособна»
 * читала исторический флаг и висела при кассе в два с половиной миллиона — после
 * одного ухода в минус снять её было нечем. Показ спрашивает здесь: заработала
 * рота на плюс — надпись уходит.
 */
export function isInsolvent(company: Company): boolean {
  return company.cbills < 0;
}

/**
 * Взнос по займу Гильдии в эту ведомость (шаг 35). 0 — долга нет.
 *
 * Последний взнос гасит остаток целиком, чтобы округление не оставляло вечный
 * хвост в пару сотен C-Bills.
 */
export function loanInstallment(company: Company): number {
  const loan = company.loan;
  if (loan === undefined || loan.debt <= 0) return 0;
  return Math.min(loan.debt, loan.installment);
}

/**
 * Списание содержания и взноса по займу. Частный случай неотменяемого списания
 * — см. `chargeUnavoidable`.
 *
 * Взнос идёт ТЕМ ЖЕ неотменяемым списанием, что и жалованье: заём, который рота
 * не тянет, обязан доводить её до разорения, иначе страховка от тупика
 * превращается в бесплатные деньги.
 */
export function applyPayroll(company: Company, day: number): Company {
  const installment = loanInstallment(company);
  const next = chargeUnavoidable(company, payrollAmount(company) + installment, day);
  if (installment <= 0) return next;

  const debt = (next.loan?.debt ?? 0) - installment;
  if (debt <= 0) {
    const { loan: _paid, ...rest } = next;
    return rest;
  }
  return { ...next, loan: { debt, installment: next.loan!.installment } };
}

import { ECONOMY } from '../../data/index.js';
import type { BattleOutcome } from '../bridge/fromBattle.js';
import { collectTrophies } from '../debrief/index.js';
import { mechValue } from '../market/pricing.js';
import type { MechRecord } from '../mech/MechRecord.js';
import type { CampaignState } from '../state.js';
import type { ReputationOutcome } from '../reputation/schema.js';
import { contractBrief, missionObjective } from './active.js';
import { CONTRACTS, type MissionType } from './schema.js';

/**
 * Трофеи по итогам контракта (шаг 16, ручной выбор — 16a).
 *
 * Вынесено из `commands/execute.ts` по одной причине: **экран дебрифинга должен
 * показать список ДО того, как команда исполнена.** `ResolveContract` мутирует
 * состояние и тянет броски износа, поэтому «выполнить и посмотреть» не годится
 * — отклонённая или отменённая команда не имеет права оставить след.
 *
 * Всё, что здесь считается, от ГПСЧ не зависит вовсе: трофей выводится из
 * финального состояния вражеской машины (`debrief/index.ts::collectTrophies`),
 * а число очков выбора — из условий контракта. Поэтому предпросмотр можно
 * звать сколько угодно раз, и он ничего не сдвинет.
 */

/**
 * Чем кончился контракт.
 *
 * Отступление — ПОЛНОЦЕННЫЙ исход, а не поражение (ловушка 3 брифинга шага 16):
 * оно определяет, кто удержал поле, а значит и судьбу своих выбывших машин, —
 * но неустойки за собой не тянет. Ничья по потолку ходов читается так же:
 * поле не удержал никто, и рота ушла своим ходом.
 */
export type ContractResult = 'won' | 'withdrawn' | 'lost';

export function contractResultOf(outcome: BattleOutcome, withdrew: boolean): ContractResult {
  if (withdrew) return 'withdrawn';
  if (outcome.winner === 'player') return 'won';
  return outcome.winner === 'opfor' ? 'lost' : 'withdrawn';
}

/**
 * Чем этот исход считается для РЕПУТАЦИИ (шаг 20).
 *
 * Отличается от `ContractResult` ровно одним делением, и оно стало возможным
 * только с шага 19b: **выполнено** и **выполнено с превышением задачи** — разные
 * события. До задач боя различать было нечего, победа и полный разгром были
 * одним и тем же. Теперь оборона кончается по сроку, а рейд — по числу
 * подбитых, и «выбить противника целиком там, где хватало задачи» — это
 * измеримая работа сверх подписанного.
 *
 * У штурма превышения не бывает по определению: его задача И ЕСТЬ выбить
 * противника целиком (`data/contracts.json` → `missions.assault.objective`),
 * и премировать за неё вторично значило бы платить дважды за одно.
 */
export function reputationOutcomeOf(
  result: ContractResult,
  outcome: BattleOutcome,
  mission: MissionType,
): ReputationOutcome {
  if (result !== 'won') return result;
  if (missionObjective(mission).kind === 'destroy') return 'won';
  // ОТОШЕДШАЯ МАШИНА СЧИТАЕТСЯ ОСТАВШЕЙСЯ (шаг 43), и это решение, а не
  // недосмотр: `withdrawn` здесь сознательно НЕ проверяется. Премия `beyond`
  // платится за очищенное поле, а поле, с которого противник ушёл своим ходом,
  // очищено не ротой. Задача при этом выполнена — исход остаётся `won`.
  //
  // Отсюда и расхождение с `rules/objective.ts::isActive`, где ушедшая машина в
  // строю НЕ числится: там вопрос «кончился ли бой», здесь — «за что платить».
  const opforLeft = outcome.units.some(
    (u) => u.side === 'opfor' && !u.unit.destroyed && u.unit.pilot.status === 'active',
  );
  return opforLeft ? 'won' : 'beyond';
}

/**
 * Сколько трофеев рота имеет право забрать.
 *
 * Доля трофеев — условие контракта (брифинг, п. 3), и до шага 16 её не
 * соблюдал никто: разбор отдавал роте ВСЁ, что уцелело на поле, и ровно отсюда
 * росли 58 % дохода от продажи парка в замере шага 15. «Очки выбора» — это
 * число машин, а не процент от их цены: выбирает игрок, и выбирает он машины
 * целиком.
 */
export function salvagePointsOf(available: number, share: number): number {
  return Math.min(available, Math.round(available * share));
}

/**
 * ДОЛЯ ТРОФЕЕВ С ПРЕМИЕЙ ЗА РАЗГРОМ (решение пользователя 2026-09-08).
 *
 * Наниматель, которому поле очистили целиком там, где хватало продержаться
 * шесть ходов, делится охотнее: к подписанной доле прибавляется
 * `contracts.json → beyond.salvageBonus`. Это не подарок, а плата за работу
 * сверх подписанного — тот же исход `beyond`, за который уже платят
 * репутацией.
 *
 * Прибавка меняет дело именно там, где было обиднее всего: один остов и доля
 * 0.47 давали ноль очков (0.47 округляется вниз), а 0.47 + 0.15 = 0.62 — уже
 * одно, и клановая машина, которую рота выбила своими силами, наконец её.
 */
export function effectiveSalvageShare(share: number, outcome: ReputationOutcome): number {
  return outcome === 'beyond' ? Math.min(1, share + CONTRACTS.beyond.salvageBonus) : share;
}

/** Что лежит на поле после боя и сколько из этого можно увезти. */
export interface SalvageOffer {
  readonly result: ContractResult;
  /** Удержано ли поле. Трофеи берут только с удержанного (решение 3 §7). */
  readonly heldField: boolean;
  /** Машины противника, годные в трофей, — от дорогой к дешёвой. */
  readonly trophies: readonly MechRecord[];
  /** Сколько из них рота имеет право забрать по условиям контракта. */
  readonly points: number;
  /** Доля трофеев, по которой посчитаны очки: подписанная плюс премия за разгром. */
  readonly share: number;
  /**
   * Сколько наниматель платит за долю, которой не хватило на целую машину.
   * Ноль, если очки выбора есть или поле не удержано.
   */
  readonly compensation: number;
}

/**
 * Предпросмотр трофеев: что можно взять и сколько штук.
 *
 * Чистая функция от состояния и итога боя — ни состояния, ни ГПСЧ не трогает.
 * Список отсортирован по цене: и игрок, и бот-менеджер видят его в одном
 * порядке, а «взять по умолчанию самое дорогое» становится просто первыми
 * `points` строками.
 */
export function salvageOffer(
  state: CampaignState,
  outcome: BattleOutcome,
  withdrew = false,
): SalvageOffer {
  const result = contractResultOf(outcome, withdrew);
  const heldField = result === 'won' && outcome.heldField;
  const active = state.contract;
  if (active === null) {
    return { result, heldField, trophies: [], points: 0, share: 0, compensation: 0 };
  }

  const trophies = [...collectTrophies(contractBrief(state), outcome, heldField)].sort(
    (a, b) => mechValue(b) - mechValue(a),
  );
  const share = effectiveSalvageShare(
    active.contract.salvageShare,
    reputationOutcomeOf(result, outcome, active.contract.mission),
  );
  const points = salvagePointsOf(trophies.length, share);
  return {
    result,
    heldField,
    trophies,
    share,
    points,
    // КОМПЕНСАЦИЯ ЗА ДРОБНУЮ ДОЛЮ (решение пользователя 2026-09-08).
    //
    // Рота выигрывала бой, удерживала поле — и не получала с него НИЧЕГО, если
    // остов был один, а доля меньше половины: «42 % от одной машины» это ноль
    // машин. Условие контракта при этом честно называло долю, и то, что она
    // просто сгорала, читалось издевательством, а не правилом.
    //
    // Платится ровно за то, что рота не смогла увезти: доля от САМОГО ДОРОГОГО
    // остова на поле (его игрок и выбрал бы) по курсу выкупа — тому же, по
    // которому наниматель забирает невостребованные очки. Целую машину это не
    // заменяет и заменять не должно: за неё дают меньше половины цены.
    compensation:
      heldField && points === 0 && trophies.length > 0 && share > 0
        ? Math.round(mechValue(trophies[0] as MechRecord) * share * ECONOMY.salvage.buyoutShare)
        : 0,
  };
}

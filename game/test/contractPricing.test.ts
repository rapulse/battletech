import { describe, expect, it } from 'vitest';
import {
  CampaignState,
  CONTRACTS,
  GALAXY,
  MISSION_TYPES,
  contractThreat,
  foundingInit,
  judgedContracts,
  missionObjective,
  opforCount,
  opforTonsAverage,
  type Contract,
} from '../src/core/campaign/index.js';
import { crippleQuota } from '../src/core/rules/objective.js';

/**
 * РАЗУМНОСТЬ БИРЖИ (шаг 56): цена против опасности и условия против здравого
 * смысла.
 *
 * Шаг родился из живой игры: гарнизон против трёх линейных машин по 40 т платил
 * 320 тыс., пиратский подряд против двух двадцатипятитонников — 180 тыс. Риск
 * при этом отличался вшестеро, а трофей с гарнизона не доставался ни разу.
 * Причина была не в одном числе, а в том, что цену типа работы правили ДВА
 * множителя (`payFactor` и `strength`), из которых второй с шага 44 не менял ни
 * состава противника, ни читаемой опасности.
 *
 * Тесты ниже сторожат не конкретные суммы (они уедут с любой перекалибровкой), а
 * СООТНОШЕНИЯ, ради которых шаг и делался.
 */

/** Срез биржи: каждая восьмая система, первая декада. Хватает на статистику и на секунду времени. */
function boardSlice(): Contract[] {
  const state = new CampaignState(1, { worldSeed: 42, company: foundingInit(1) });
  const out: Contract[] = [];
  for (let i = 0; i < GALAXY.count; i += 8) {
    for (const { contract, allowed } of judgedContracts(
      state.worldSeed,
      state.deltas,
      GALAXY.id(i),
      0,
      state.reputation,
      state.war,
    )) {
      if (allowed) out.push(contract);
    }
  }
  return out;
}

function median(values: readonly number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? (s[m] as number) : ((s[m - 1] as number) + (s[m] as number)) / 2;
}

const BOARD = boardSlice();

describe('цена работы против её опасности', () => {
  it('биржа набралась — иначе проверять нечего', () => {
    expect(BOARD.length).toBeGreaterThan(200);
  });

  /**
   * Главная мерка шага. Цена единицы читаемой опасности — гонорар, делённый на
   * ту самую оценку сил, которую игрок видит до подписи. До шага 56 она
   * расходилась по типам работы в 5.7 раза: гарнизон 155 тыс., штурм 787 тыс.
   * за ту же единицу риска.
   */
  it('цена единицы опасности не расходится по типам работы больше чем вдвое', () => {
    const perType = MISSION_TYPES.map((m) => {
      const rows = BOARD.filter((c) => c.mission === m);
      return rows.length < 5 ? null : median(rows.map((c) => c.payout / contractThreat(c)));
    }).filter((x): x is number => x !== null);

    expect(perType.length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...perType) / Math.min(...perType)).toBeLessThan(2);
  });

  /**
   * Работа против Дома опаснее пиратской в разы, и платить за неё обязаны не
   * хуже: обратное («выгоднее и безопаснее разом») уже находил замер шага 20.
   */
  it('работа против Дома стоит единицы риска не дешевле пиратской', () => {
    const per = (rows: readonly Contract[]): number =>
      median(rows.map((c) => c.payout / contractThreat(c)));
    const pirates = BOARD.filter((c) => c.target === 'pirates');
    const houses = BOARD.filter((c) => c.target !== 'pirates');
    expect(pirates.length).toBeGreaterThan(20);
    expect(houses.length).toBeGreaterThan(20);
    expect(per(houses)).toBeGreaterThanOrEqual(per(pirates) * 0.95);
  });

  it('больше сил на поле — дороже работа', () => {
    // Сравниваются половины биржи по машино-тоннам: внутри одной работы размер
    // не с чем сравнивать, а по бирже связь обязана быть монотонной.
    const withForce = BOARD.map((c) => ({ force: opforCount(c) * opforTonsAverage(c), pay: c.payout }))
      .sort((a, b) => a.force - b.force);
    const half = Math.floor(withForce.length / 2);
    const light = median(withForce.slice(0, half).map((r) => r.pay));
    const heavy = median(withForce.slice(half).map((r) => r.pay));
    expect(heavy).toBeGreaterThan(light);
  });

  it('тип работы правит цену ОДНОЙ ручкой', () => {
    for (const m of MISSION_TYPES) {
      expect(CONTRACTS.missions[m]).not.toHaveProperty('strength');
    }
  });
});

describe('условия работы читаются без казусов', () => {
  /**
   * «Вывести из строя 65 % машин противника и уйти» против двух машин — это
   * разгром с другой подписью. В смотре ста предложений такой была половина
   * долевых работ, а треть приходилась на состав из ОДНОЙ машины.
   */
  it('долевая работа не бывает против одной машины и не требует выбить всех', () => {
    let checked = 0;
    for (const c of BOARD) {
      const task = missionObjective(c.mission);
      if (task.kind !== 'cripple') continue;
      checked++;
      expect(opforCount(c)).toBeGreaterThanOrEqual(2);
      expect(crippleQuota(task.share, opforCount(c))).toBeLessThan(opforCount(c));
    }
    expect(checked).toBeGreaterThan(50);
  });

  it('трофеи: вычищенное поле отдаёт остов при любом типе работы', () => {
    // Доля с премией за разгром (`beyond.salvageBonus`) обязана давать хотя бы
    // одно очко выбора с ОДНОГО уцелевшего остова: иначе «вычистил поле» и
    // «ушёл по сроку» кончаются одинаково — ничем.
    for (const m of MISSION_TYPES) {
      const share = Math.min(1, CONTRACTS.missions[m].salvageShare + CONTRACTS.beyond.salvageBonus);
      expect(Math.round(share * 1)).toBeGreaterThanOrEqual(1);
    }
  });

  it('аванс, неустойка и доля трофеев остаются долями в пределах смысла', () => {
    for (const m of MISSION_TYPES) {
      const row = CONTRACTS.missions[m];
      expect(row.advanceShare).toBeGreaterThan(0);
      expect(row.advanceShare).toBeLessThan(0.5);
      expect(row.penaltyShare).toBeGreaterThan(0);
      expect(row.penaltyShare).toBeLessThanOrEqual(1);
      expect(row.salvageShare).toBeGreaterThan(0);
      expect(row.salvageShare).toBeLessThanOrEqual(1);
    }
  });
});

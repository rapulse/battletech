import { describe, expect, it } from 'vitest';
import {
  CONTRACTS,
  MISSION_TYPES,
  contractBrief,
  execute,
  fastResolveDetailed,
  makeBattleFromBrief,
  missionObjective,
  type BattleBrief,
} from '../src/core/campaign/index.js';
import { CampaignState, foundingInit } from '../src/core/campaign/index.js';
import { DESTROY_ALL, hashBattleState, type BattleObjective } from '../src/core/model/index.js';
import { crippleNeed, crippleQuota, judgeObjective, progressOf } from '../src/core/rules/objective.js';
import { runBattle, runOn } from '../src/sim/autoBattle.js';
import { DUEL, LANCE_VS_LANCE, makeBattle } from '../src/sim/scenario.js';
import { chooseLance, crewUp, pickContract, repairStep } from '../src/sim/campaign/manager.js';
import { spreadStartSystem } from '../src/sim/campaign/batch.js';

/**
 * Шаг 19b — задачи боя как параметр `BattleState`.
 *
 * Проверяется ровно то, на чём стоит шаг: правило исхода ОДНО на две точности,
 * бой без задачи остался прежним боем Части 1, и каждая задача действительно
 * кончает бой при живом противнике — иначе она ничем не отличалась бы от
 * «вывести всех».
 */

/** Объектов-целей нет (шаг 73d): задачи до шага их не знают. */
const NO_TARGETS = { playerTargets: 0, opforTargets: 0, playerTargetsTotal: 0, opforTargetsTotal: 0 };

const HOLD: BattleObjective = { kind: 'hold', rounds: 3 };
const CRIPPLE: BattleObjective = { kind: 'cripple', share: 0.5 };

describe('правило исхода по задаче', () => {
  it('рота выбита — поражение при любой задаче', () => {
    for (const task of [DESTROY_ALL, HOLD, CRIPPLE]) {
      expect(
        judgeObjective(task, { roundsCompleted: 99, playerActive: 0, opforActive: 2, opforTotal: 4, ...NO_TARGETS }),
      ).toBe('opfor');
    }
  });

  it('обе стороны выбиты — ничья при любой задаче', () => {
    for (const task of [DESTROY_ALL, HOLD, CRIPPLE]) {
      expect(
        judgeObjective(task, { roundsCompleted: 1, playerActive: 0, opforActive: 0, opforTotal: 4, ...NO_TARGETS }),
      ).toBe('draw');
    }
  });

  it('противник выбит целиком — победа при любой задаче и досрочно', () => {
    for (const task of [DESTROY_ALL, HOLD, CRIPPLE]) {
      expect(
        judgeObjective(task, { roundsCompleted: 1, playerActive: 2, opforActive: 0, opforTotal: 4, ...NO_TARGETS }),
      ).toBe('player');
    }
  });

  it('оборона выигрывается в конце назначенного хода, а не в его начале', () => {
    const live = { playerActive: 2, opforActive: 3, opforTotal: 4, ...NO_TARGETS };
    expect(judgeObjective(HOLD, { ...live, roundsCompleted: 2 })).toBeNull();
    expect(judgeObjective(HOLD, { ...live, roundsCompleted: 3 })).toBe('player');
  });

  it('рейд кончается на нужной доле, а доля округляется вверх', () => {
    // Половина от трёх — две машины, а не полторы.
    expect(crippleQuota(0.5, 3)).toBe(2);
    expect(crippleQuota(0.34, 2)).toBe(1);
    expect(crippleQuota(0.5, 6)).toBe(3);

    const four = { roundsCompleted: 5, playerActive: 2, opforTotal: 4, ...NO_TARGETS };
    expect(judgeObjective(CRIPPLE, { ...four, opforActive: 3 })).toBeNull();
    expect(judgeObjective(CRIPPLE, { ...four, opforActive: 2 })).toBe('player');
  });

  /**
   * Условие контракта не растёт вместе с составом (шаг 61). Контракт обещал «вывести 1 из 2»,
   * разведка ошиблась, на поле вышло три: без `quota` доля 0.5 от трёх — две машины, и бой
   * ждал бы лишнего, о чём в контракте не сказано.
   */
  it('число, записанное контрактом, не зависит от состава на поле', () => {
    const fixed: BattleObjective = { kind: 'cripple', share: 0.5, quota: 1 };
    const three = { roundsCompleted: 2, playerActive: 3, opforTotal: 3, ...NO_TARGETS };
    expect(crippleNeed(fixed, 3)).toBe(1);
    expect(judgeObjective(fixed, { ...three, opforActive: 2 })).toBe('player');
    // Та же доля без записанного числа честно считается от состава на поле.
    expect(crippleNeed(CRIPPLE, 3)).toBe(2);
    expect(judgeObjective(CRIPPLE, { ...three, opforActive: 2 })).toBeNull();
  });

  it('обещали 3 из 4, а вышло три: записанное число не превращается в «выбить всех»', () => {
    const fixed: BattleObjective = { kind: 'cripple', share: 0.65, quota: 3 };
    expect(crippleNeed(fixed, 3)).toBe(2);
    expect(crippleNeed(fixed, 4)).toBe(3);
    expect(crippleNeed(fixed, 6)).toBe(3);
  });

  it('число из контракта не мешает выбить всех, если на поле вышло меньше обещанного', () => {
    const fixed: BattleObjective = { kind: 'cripple', share: 0.5, quota: 2 };
    const one = { roundsCompleted: 1, playerActive: 3, opforTotal: 1, ...NO_TARGETS };
    expect(judgeObjective(fixed, { ...one, opforActive: 1 })).toBeNull();
    expect(judgeObjective(fixed, { ...one, opforActive: 0 })).toBe('player');
  });

  it('число входит в хэш боя: другое условие — другой бой', () => {
    const state = makeBattle({ seed: 4, units: DUEL });
    state.objective = { kind: 'cripple', share: 0.5, quota: 1 };
    const a = hashBattleState(state);
    state.objective = { kind: 'cripple', share: 0.5, quota: 2 };
    expect(hashBattleState(state)).not.toBe(a);
  });

  /**
   * Шаг 56. «Вывести 65 % машин противника и уйти» против двойки требовало обе
   * машины — то есть ровно того же, что штурм, и уходить было не от кого.
   * Такой на смотре биржи оказалась КАЖДАЯ ВТОРАЯ долевая работа.
   */
  it('долевая задача никогда не значит «выбить всех»', () => {
    for (const total of [2, 3, 4, 6, 8, 12, 24]) {
      for (const share of [0.5, 0.65, 0.9, 1]) {
        expect(crippleQuota(share, total)).toBeLessThan(total);
        expect(crippleQuota(share, total)).toBeGreaterThan(0);
      }
    }
    // Рейд на двойку: выбить одного и уйти, а не выбить обоих.
    expect(crippleQuota(0.65, 2)).toBe(1);
    const two = { roundsCompleted: 4, playerActive: 3, opforTotal: 2, ...NO_TARGETS };
    expect(judgeObjective({ kind: 'cripple', share: 0.65 }, { ...two, opforActive: 1 })).toBe('player');
  });

  it('бой на выбывание не кончается, пока обе стороны живы', () => {
    expect(
      judgeObjective(DESTROY_ALL, { roundsCompleted: 40, playerActive: 1, opforActive: 1, opforTotal: 4, ...NO_TARGETS }),
    ).toBeNull();
  });
});

describe('задача — параметр состояния боя', () => {
  it('бой без задачи остался прежним боем Части 1', () => {
    const state = makeBattle({ seed: 4, units: DUEL });
    expect(state.objective).toEqual(DESTROY_ALL);
    // Умолчание в хэш не входит: эталонный бой обязан дать прежнее значение.
    const withDefault = hashBattleState(state);
    state.objective = { kind: 'hold', rounds: 5 };
    expect(hashBattleState(state)).not.toBe(withDefault);
  });

  it('оборона кончает бой по сроку, и обе стороны остаются на поле', () => {
    const state = makeBattle({ seed: 11, units: LANCE_VS_LANCE });
    state.objective = { kind: 'hold', rounds: 3 };
    const report = runOn(state, { seed: 11 });

    expect(report.turns).toBeLessThanOrEqual(4);
    expect(report.winner).toBe('player');
    // Задача выполнена при живом противнике — ровно то, чего до шага не было.
    const alive = report.outcome.units.filter(
      (u) => u.side === 'opfor' && !u.unit.destroyed && u.unit.pilot.status === 'active',
    );
    expect(alive.length).toBeGreaterThan(0);
  });

  it('тот же бой на выбывание идёт дольше и кончается иначе', () => {
    const hold = runOn(
      Object.assign(makeBattle({ seed: 11, units: LANCE_VS_LANCE }), {
        objective: { kind: 'hold', rounds: 3 } as BattleObjective,
      }),
      { seed: 11 },
    );
    const destroy = runBattle({ seed: 11, units: LANCE_VS_LANCE });
    expect(destroy.turns).toBeGreaterThan(hold.turns);
  });
});

describe('задача одинакова в обеих точностях', () => {
  /**
   * Политика бота на время сбора выборки. Сторону не выбирает
   * (`loyaltyThreshold: null`, шаг 20): тест сравнивает две ТОЧНОСТИ боя, и
   * сужать ему выборку разборчивостью бота незачем.
   */
  const POLICY = {
    repairThreshold: 0,
    fleetCap: 6,
    supplyThreshold: 600_000,
    supplyJumps: 2,
    contractOdds: 0.75,
    loyaltyThreshold: null,
  } as const;

  /** Настоящий брифинг кампании: побитые машины, живые пилоты, состав противника из контракта. */
  function campaignBrief(seed: number): BattleBrief | null {
    const state = new CampaignState(seed, {
      systemId: spreadStartSystem(seed),
      company: foundingInit(seed),
    });
    for (let i = 0; i < 6; i++) {
      crewUp(state);
      repairStep(state, POLICY);
      execute(state, { kind: 'advance', days: 14 });
      const offer = pickContract(state, POLICY);
      if (offer === null) continue;
      if (!execute(state, { kind: 'takeContract', contractId: offer.id }).ok) continue;
      const lance = chooseLance(state);
      if (lance.length === 0) {
        execute(state, { kind: 'abandonContract' });
        continue;
      }
      if (!execute(state, { kind: 'deploy', recordIds: lance.map((m) => m.id) }).ok) {
        execute(state, { kind: 'abandonContract' });
        continue;
      }
      return contractBrief(state);
    }
    return null;
  }

  it('брифинг контракта несёт задачу своего типа миссии', () => {
    let checked = 0;
    for (let seed = 1; seed <= 12 && checked < 3; seed++) {
      const brief = campaignBrief(seed);
      if (brief === null) continue;
      expect(brief.objective).toBeDefined();
      // Бой, собранный из брифинга, получает ту же задачу — иначе поле было бы
      // потеряно ровно на шве, ради которого весь мост и написан.
      expect(makeBattleFromBrief(brief).objective).toEqual(brief.objective);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('быстрый расчёт кончает бой по той же задаче, что и полный', () => {
    let checked = 0;
    for (let seed = 1; seed <= 12 && checked < 3; seed++) {
      const brief = campaignBrief(seed);
      if (brief === null) continue;
      const task = brief.objective;
      if (task === undefined || task.kind !== 'cripple') continue;

      const fast = fastResolveDetailed(brief);
      const p = progressOf(
        fast.outcome.units.map((u) => u.unit),
        fast.rounds,
      );
      if (fast.outcome.winner === 'player' && p.opforActive > 0) {
        // Победа при живом противнике возможна ТОЛЬКО по задаче — значит доля
        // выбита, и считается она тем же правилом, что в полном бою.
        expect(p.opforTotal - p.opforActive).toBeGreaterThanOrEqual(
          crippleNeed(task, p.opforTotal),
        );
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('данные типов миссий', () => {
  it('у каждого типа миссии есть задача боя', () => {
    for (const mission of MISSION_TYPES) {
      expect(missionObjective(mission)).toEqual(CONTRACTS.missions[mission].objective);
    }
  });

  it('лестница оплаты монотонна по глубине вражды', () => {
    // «Чем глубже вражда, тем тяжелее» — обещание `global-layer.md`. Задачи
    // различают типы ВНУТРИ боя, но не ломают эту лестницу.
    const rows = MISSION_TYPES.map((m) => CONTRACTS.missions[m]);
    const byEnmity = [...rows].sort((a, b) => a.enmityMin - b.enmityMin);
    for (let i = 1; i < byEnmity.length; i++) {
      expect(byEnmity[i]!.payFactor).toBeGreaterThan(byEnmity[i - 1]!.payFactor);
    }
  });
});

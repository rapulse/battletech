import { describe, expect, it } from 'vitest';
import {
  CampaignState,
  FAST,
  GALAXY,
  contractBrief,
  debrief,
  execute,
  fastResolve,
  fastResolveDetailed,
  foundingInit,
  makeBattleFromBrief,
  type BattleBrief,
  type BattleOutcome,
} from '../src/core/campaign/index.js';
import { HitZone } from '../src/core/model/HitZone.js';
import { FAST_FIDELITY, runCampaign } from '../src/sim/campaign/batch.js';
import { pickContract } from '../src/sim/campaign/manager.js';
import { runOn } from '../src/sim/autoBattle.js';

/**
 * Быстрый расчёт боя (шаг 18).
 *
 * Главный тест здесь — **допуск расхождения с полным боем**, пункт 3 брифинга
 * шага. Он не заменяет калибровку (`pnpm fastcalib`, сотни боёв с полным ходом
 * кампании): выборка здесь маленькая и коэффициенты по ней не подбирают. Его
 * работа другая — поймать день, когда быстрый расчёт разъехался с полным
 * настолько, что замер экономики на нём считать уже нельзя. Допуски поэтому
 * широкие: они отделяют «разошлось» от «шумит», а не проверяют точность.
 *
 * Числа калибровки на 400 боях со стабильной выборкой (см. `wiki/decisions.md`,
 * 2026-09-03): сводное расхождение по ключевым показателям 1–5 %, и быстрый
 * расчёт чуть ПЕССИМИСТИЧНЕЕ полного по целости роты. Направление важно:
 * оптимистичный быстрый расчёт утащил бы за собой всю настройку экономики
 * (ловушка шага 18).
 */

const POLICY = {
  repairThreshold: 0,
  fleetCap: 6,
  supplyThreshold: 600_000,
  supplyJumps: 3,
  contractOdds: 0.75,
  // Калибровка сравнивает две ТОЧНОСТИ боя на одной выборке: выбор стороны её
  // не касается и только сузил бы выборку (шаг 20).
  loyaltyThreshold: null,
};

/**
 * Выборка настоящих брифингов кампании: побитые машины, раненые пилоты,
 * подросшие навыки. Кампании-поставщики гоняются быстрым расчётом — тест
 * меряет расхождение НА ВЫБОРКЕ, а не саму выборку.
 */
function sampleBriefs(count: number): BattleBrief[] {
  const out: BattleBrief[] = [];
  for (let seed = 1; out.length < count && seed <= count; seed++) {
    runCampaign(seed, 20, POLICY, {
      resolve: FAST_FIDELITY,
      onBrief: (brief) => {
        if (out.length < count) out.push(brief);
      },
    });
  }
  return out;
}

/**
 * Выборка собирается один раз на файл: она одна и та же для всех проверок.
 *
 * Восемьдесят боёв было мало (2026-09-08). Потеря СВОЕЙ машины — событие
 * редкое, примерно раз в девять боёв, и на восьмидесяти это девять событий
 * против восемнадцати: пуассоновский разброс на такой девятке сам по себе
 * ломает двустороннюю рамку, ничего не говоря о моделях. Сто шестьдесят боёв
 * стоят вдвое дороже (около 25 секунд полного прогона) и снимают ровно эту
 * ложную тревогу; калибровка на трёхстах боях (`pnpm fastcalib`) на том же
 * коде даёт расхождение 10 % по ключевым показателям.
 */
// 320, а не 160 (шаг 67, 2026-09-23): с платой за высадку бот летает звеном в
// 1.8 машины почти на равных, и трофеи — редкий шумный счёт. На 160 брифингах
// отношение быстрый/полный по трофеям вышло 1.58, на 320 — 1.23 (та же политика);
// `pnpm fastcalib --battles 300` — 1.21. Выборка удвоена против шума, допуск прежний.
const BRIEFS = sampleBriefs(320);
const FIRST = BRIEFS[0] as BattleBrief;

interface Tally {
  battles: number;
  wins: number;
  ourLost: number;
  theirLost: number;
  trophies: number;
  integrity: number;
}

function collect(t: Tally, brief: BattleBrief, outcome: BattleOutcome): void {
  t.battles += 1;
  if (outcome.winner === 'player') t.wins += 1;
  let before = 0;
  for (const p of brief.company) for (const z of p.record.condition.zones) before += z.armor + z.structure;
  let after = 0;
  for (const u of outcome.units) {
    if (u.side === 'player') {
      if (u.unit.destroyed) t.ourLost += 1;
      for (const z of u.unit.zones) after += z.armor + z.structure;
    } else if (u.unit.destroyed) {
      t.theirLost += 1;
      const zones = u.unit.zones;
      if (zones[HitZone.Torso]?.destroyed !== true && zones[HitZone.Head]?.destroyed !== true) {
        t.trophies += 1;
      }
    }
  }
  t.integrity += before === 0 ? 0 : after / before;
}

const empty = (): Tally => ({ battles: 0, wins: 0, ourLost: 0, theirLost: 0, trophies: 0, integrity: 0 });

describe('быстрый расчёт боя', () => {
  it('исход выводится из брифинга: два вызова дают побайтово одно и то же', () => {
    const a = fastResolveDetailed(FIRST);
    const b = fastResolveDetailed(FIRST);
    expect(b.rounds).toBe(a.rounds);
    expect(JSON.stringify(b.outcome)).toBe(JSON.stringify(a.outcome));
  });

  it('в итогах есть каждая машина обеих сторон — иначе разбор не соберётся', () => {
    for (const brief of BRIEFS.slice(0, 5)) {
      const outcome = fastResolve(brief);
      const ours = new Set(outcome.units.filter((u) => u.side === 'player').map((u) => u.recordId));
      const theirs = new Set(outcome.units.filter((u) => u.side === 'opfor').map((u) => u.recordId));
      for (const p of brief.company) expect(ours.has(p.record.id)).toBe(true);
      for (const p of brief.enemy) expect(theirs.has(p.record.id)).toBe(true);
    }
  });

  it('послебоевой разбор принимает итог быстрого расчёта как любой другой', () => {
    // Галатея, а не Аутрич: с шага 37 биржа Аутрича пуста — гарнизон Драгун
    // 4.0 из 5 и класс «столица», вольнице там делать нечего. Аутрич остался
    // стартовой системой как рынок и мастерская, но работу берут не там.
    //
    // Система ищется, а не назначается: с шага 44 работа на бирже описана
    // абсолютно, и половина её лёгкой тройке не по зубам — на конкретном мире в
    // конкретную декаду посильного может не оказаться вовсе, и это не поломка, а
    // повод лететь дальше. Разбор трофеев, который проверяет тест, от того, на
    // каком мире взят подряд, не зависит.
    const state = new CampaignState(7, { systemId: 'galatea', company: foundingInit(7) });
    let offer = pickContract(state, POLICY);
    for (let i = 0; offer === null && i < GALAXY.count; i++) {
      state.systemId = GALAXY.id(i);
      offer = pickContract(state, POLICY);
    }
    expect(offer).not.toBeNull();
    expect(execute(state, { kind: 'takeContract', contractId: (offer as { id: string }).id }).ok).toBe(true);
    const lance = state.company.mechs.filter((m) => m.pilotId !== null).slice(0, 4);
    expect(execute(state, { kind: 'deploy', recordIds: lance.map((m) => m.id) }).ok).toBe(true);

    const brief = contractBrief(state);
    const outcome = fastResolve(brief);
    const result = debrief({ brief, outcome, rng: state.rng });
    expect(result.company.length + result.lostRecordIds.length).toBe(brief.company.length);

    // И тот же итог проходит настоящим швом `ResolveContract`, а не только разбором.
    const resolved = execute(state, { kind: 'resolveContract', outcome });
    expect(resolved.ok).toBe(true);
  });

  it('ничья по потолку раундов возможна: потолок в единицу оставляет обе стороны в строю', () => {
    // Коэффициенты берутся от рабочих и правятся точечно: перечислять их
    // здесь целиком значило бы чинить тест при каждом новом коэффициенте.
    const stalled = fastResolveDetailed(FIRST, {
      ...FAST,
      rounds: 1,
      fireChance: 0,
      pilotingChecksPerRound: 0,
    });
    expect(stalled.rounds).toBe(1);
    expect(stalled.outcome.winner).toBe('draw');
    expect(stalled.outcome.heldField).toBe(false);
  });

  it(
    'расхождение с полным боем в допуске — и не в оптимистичную сторону по целости',
    { timeout: 120_000 },
    () => {
      const briefs = BRIEFS;
      expect(briefs.length).toBe(320);

      const full = empty();
      const fast = empty();
      for (const brief of briefs) {
        collect(full, brief, runOn(makeBattleFromBrief(brief), { seed: brief.battleSeed }).outcome);
        collect(fast, brief, fastResolve(brief));
      }

      const per = (t: Tally, of: (t: Tally) => number): number => of(t) / t.battles;

      // Доля побед — то, на чём стоит вся экономика кампании.
      expect(Math.abs(per(fast, (t) => t.wins) - per(full, (t) => t.wins))).toBeLessThan(0.12);

      // Потери с обеих сторон: сколько машин выбывает за бой.
      //
      // У СВОИХ потерь допуск не только относительный, но и абсолютный, и это
      // не послабление, а исправление меры (шаг 32). Рота теряет машину примерно
      // раз в девять боёв: на выборке в 80 боёв это 9 событий против 15, и
      // относительное отношение 1.67 при пуассоновском разбросе ±3 на девятке
      // означает шум, а не расхождение моделей. Систематический уход
      // (быстрый теряет по полмашины за бой при 0.11 у полного) обе границы
      // ловят по-прежнему; шесть лишних потерь из восьмидесяти — нет.
      //
      // Верхняя граница расширена 2026-09-14 (×1.6/+0.1 → ×2/+0.15), когда
      // обучение пилотов стало автоматическим. До того пилоты батч-кампании не
      // росли вовсе — бот не нажимал «Учить», — а теперь растут, как у игрока.
      // Быстрый расчёт из навыков читает только Стрельбу, срывов Хладнокровия
      // не моделирует, и подросшая рота бережёт машины в полном бою сильнее,
      // чем в быстром: 23 против 39 на 160 боях (без роста было 37 против 45).
      // Расхождение пессимистичное и игрока не касается — его авторасчёт с
      // 2026-09-09 отыгрывает полный бой. Разбор — `notes.md` §10i.
      const ourFull = per(full, (t) => t.ourLost);
      const ourFast = per(fast, (t) => t.ourLost);
      expect(ourFast).toBeGreaterThan(Math.min(ourFull * 0.5, Math.max(0, ourFull - 0.1)));
      expect(ourFast).toBeLessThan(Math.max(ourFull * 2, ourFull + 0.15));
      expect(per(fast, (t) => t.theirLost)).toBeGreaterThan(per(full, (t) => t.theirLost) * 0.8);
      expect(per(fast, (t) => t.theirLost)).toBeLessThan(per(full, (t) => t.theirLost) * 1.2);

      // Трофеи — второй источник денег роты (шаг 15), и он обязан сойтись.
      expect(per(fast, (t) => t.trophies)).toBeGreaterThan(per(full, (t) => t.trophies) * 0.6);
      expect(per(fast, (t) => t.trophies)).toBeLessThan(per(full, (t) => t.trophies) * 1.4);

      // Целость роты после боя — это счёт за ремонт, то есть главная статья
      // расходов. Допуск односторонний намеренно: разойтись в пессимистичную
      // сторону не страшно, в оптимистичную — это и есть ловушка шага.
      const gap = per(full, (t) => t.integrity) - per(fast, (t) => t.integrity);
      expect(gap).toBeGreaterThan(-0.03);
      expect(gap).toBeLessThan(0.08);
    },
  );
});

import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng/index.js';
import { regimentTick, type CommissionReport } from '../src/core/campaign/rivals/regiments.js';
import { frontSectors } from '../src/core/campaign/war/index.js';
import { factionKind } from '../src/core/campaign/contracts/relations.js';
import type { Regiment } from '../src/core/campaign/rivals/types.js';
import {
  CampaignState,
  MRBC_REGISTRY,
  RIVALS,
  SECTOR_UNITS,
  forceRating,
  companyRating,
  contractDecadeOf,
  execute,
  GALAXY,
  systemProfile,
  foundRival,
  foundingInit,
  hashCampaignState,
  makeSaveFile,
  parseSaveFile,
  payrollAmount,
  playerRank,
  ratingTable,
  restore,
  snapshot,
  spawnCandidates,
  type CampaignEvent,
} from '../src/core/campaign/index.js';

/**
 * Соперники и рейтинг MRBC (шаг 22, M11-C).
 *
 * Проверяется не «работает ли ремонт соперника» — это те же функции, что у
 * роты, и на них уже есть свои тесты. Проверяется ровно то, что заводит шаг:
 * соперник — та же структура данных, работа действительно уходит другим, список
 * обновляется, а всё вместе переживает круг через сохранение.
 */

/** Прокрутить кампанию на столько суток, отдав события. */
function advance(state: CampaignState, days: number): readonly CampaignEvent[] {
  const result = execute(state, { kind: 'advance', days });
  if (!result.ok) throw new Error(`advance отклонена: ${result.reason}`);
  return result.events;
}

function fresh(seed = 11): CampaignState {
  return new CampaignState(seed, { company: foundingInit(seed) });
}

describe('соперники: порождение', () => {
  it('список заводится в конструкторе и одинаков для одного сида мира', () => {
    const a = fresh(3);
    const b = fresh(3);
    expect(a.rivals.list).toHaveLength(RIVALS.companies);
    expect(a.rivals.list.map((r) => r.name)).toEqual(b.rivals.list.map((r) => r.name));
    expect(a.rivals.list.map((r) => r.systemId)).toEqual(b.rivals.list.map((r) => r.systemId));
  }, 60_000);

  it('имена в стартовом населении не повторяются', () => {
    for (const seed of [1, 2, 3]) {
      const names = fresh(seed).rivals.list.map((r) => r.name);
      expect(new Set(names).size).toBe(names.length);
    }
  }, 60_000);

  it('всё население носит имена реестра, вольные приходят на освободившееся место', () => {
    // ПЕРЕПИСАНО 2026-09-07 вместе с решением сократить население с тридцати
    // отрядов до восьми. Раньше здесь проверялось обратное: что безымянных
    // БОЛЬШЕ, чем именных. Двадцать два безымянных отряда не видны в игре
    // нигде — рейтинг показывает игрока, семь великих полков, восемь именных
    // рот и только того вольного, кто стоит с ротой в одной системе, — и при
    // этом они летали, брали работу и с шага 37a вычищали миры от вольницы
    // перед игроком. Замер: тридцать отрядов давали роте 15.08 контракта за
    // кампанию, восемь — 17.42.
    //
    // Теперь мест ровно столько, сколько ротных строк в реестре, и на старте
    // все они именные. Безымянный приходит только на место разорившегося — и
    // тогда он в мире один-два, а не двадцать два.
    const state = fresh(4);
    const named = state.rivals.list.filter((r) => r.registered);
    const free = state.rivals.list.filter((r) => !r.registered);
    expect(named).toHaveLength(SECTOR_UNITS.length);
    expect(free).toHaveLength(0);
    // У вольного отряда герба нет: он не в реестре, и рисовать ему чужой герб
    // значило бы соврать.
    for (const r of free) expect(r.emblem).toBe(-1);
  }, 60_000);

  it('отряды расселены ПО ВСЕЙ Сфере, а не вокруг роты игрока', () => {
    // Прежнее расселение по трём прыжкам было подпоркой под замер: оно держало
    // конкуренцию видимой, но означало, что тысяча наёмников Сферы стоит в
    // одном секторе. Замер это и вскрыл — при трёхстах отрядах у роты не
    // оставалось ни одного контракта, `payout_in_mechs` падал в ноль.
    for (const seed of [5, 21, 44]) {
      const state = new CampaignState(seed, { company: foundingInit(seed) });
      const near = new Set(spawnCandidates(state.systemId, RIVALS.spawnJumps));
      const inNeighbourhood = state.rivals.list.filter((r) => near.has(GALAXY.require(r.systemId)));
      // Рядом с ротой их доля не больше, чем доля соседних систем во всей
      // галактике с запасом: скучиваться на игроке отряды не должны.
      expect(inNeighbourhood.length / state.rivals.list.length).toBeLessThan(0.2);
      // И при этом они не в одной точке: мир населён, а не составлен из клона.
      expect(new Set(state.rivals.list.map((r) => r.systemId)).size).toBeGreaterThan(
        state.rivals.list.length / 2,
      );
    }
  });

  it('отряды густеют там, где работа, а не ложатся ровным слоем', () => {
    // Вес расселения — число предложений биржи класса рынка, то есть ровно то,
    // ради чего наёмник в системе и стоит.
    const state = new CampaignState(11, { company: foundingInit(11) });
    const rich = state.rivals.list.filter((r) => {
      const cls = systemProfile(state.worldSeed, GALAXY.require(r.systemId)).marketClass;
      return cls === 'capital' || cls === 'industrial' || cls === 'developed';
    }).length;
    // Богатых систем на карте около 22 %, а отрядов на них должно стоять
    // заметно больше их доли.
    expect(rich / state.rivals.list.length).toBeGreaterThan(0.35);
  });

  it('соперник — та же Company, что рота: у него есть машины, пилоты и касса', () => {
    const rival = foundRival(1234, new CampaignState(1).systemId, 1, new Set());
    expect(rival.company.mechs.length).toBeGreaterThan(0);
    expect(rival.company.pilots.length).toBe(rival.company.mechs.length);
    expect(rival.company.cbills).toBeGreaterThan(0);
    // Ровно та же функция, которой считается сила роты игрока.
    expect(companyRating(rival.company).total).toBeGreaterThan(0);
    // И то же содержание: свой прайс-лист для соперника был бы вторым набором правил.
    expect(payrollAmount(rival.company)).toBeGreaterThan(0);
  }, 60_000);

  it('машины и пилоты соперников не сталкиваются id ни между собой, ни с ротой', () => {
    const state = fresh(9);
    const ids = new Set<string>(state.company.mechs.map((m) => m.id));
    for (const rival of state.rivals.list) {
      for (const mech of rival.company.mechs) {
        expect(ids.has(mech.id)).toBe(false);
        ids.add(mech.id);
      }
    }
  });
});

describe('соперники: такт', () => {
  it('такт стоит в очереди с первого дня и переставляет сам себя', () => {
    const state = fresh(4);
    expect(state.queue.some((e) => e.task.kind === 'rivalTick')).toBe(true);
    advance(state, 40);
    expect(state.queue.filter((e) => e.task.kind === 'rivalTick')).toHaveLength(1);
  }, 60_000);

  it('такт соперников идёт СЛЕДОМ за тактом фронта того же дня', () => {
    const state = fresh(4);
    const front = state.queue.find((e) => e.task.kind === 'frontTick');
    const rivals = state.queue.find((e) => e.task.kind === 'rivalTick');
    expect(front).toBeDefined();
    expect(rivals).toBeDefined();
    expect(rivals?.day).toBe(front?.day);
    expect(rivals?.seq).toBeGreaterThan(front?.seq as number);
  }, 60_000);

  it('соперники берут работу, и она вычёркивается из биржи тем же швом, что у роты', () => {
    const state = fresh(7);
    const events = advance(state, 100);
    const taken = events.filter((e) => e.kind === 'rivalContract');
    expect(taken.length).toBeGreaterThan(0);

    // Взятое лежит в дельте системы — там же, где взятое ротой. Второго способа
    // «контракт занят» в игре нет.
    const last = taken[taken.length - 1] as Extract<CampaignEvent, { kind: 'rivalContract' }>;
    const delta = state.deltas[last.systemId];
    expect(delta).toBeDefined();
    if (delta?.takenDecade === contractDecadeOf(state.day)) {
      expect(delta.taken ?? []).toContain(last.contractId);
    }
  }, 60_000);

  it('соперники дерутся по-настоящему: есть и победы, и потери', () => {
    const state = fresh(7);
    const events = advance(state, 200);
    const fought = events.filter(
      (e): e is Extract<CampaignEvent, { kind: 'rivalContract' }> => e.kind === 'rivalContract',
    );
    expect(fought.length).toBeGreaterThan(10);
    expect(fought.some((e) => e.result === 'won')).toBe(true);
    expect(fought.some((e) => e.result !== 'won' || e.mechsLost > 0)).toBe(true);
  }, 60_000);

  it('список обновляется: разорившийся отряд сменяется новым, и число мест не меняется', () => {
    const state = fresh(7);
    const events = advance(state, 600);
    const goneEvents = events.filter(
      (e): e is Extract<CampaignEvent, { kind: 'rivalGone' }> => e.kind === 'rivalGone',
    );
    // Население держится у целевого: разорения возмещаются формированием.
    expect(state.rivals.list.length).toBeGreaterThan(RIVALS.companies * 0.8);
    expect(state.rivals.list.length).toBeLessThanOrEqual(RIVALS.companies);
    if (goneEvents.length > 0) {
      expect(state.rivals.bankrupt).toBe(goneEvents.length);
      expect(state.rivals.nextId).toBeGreaterThan(RIVALS.companies);
    }
    expect(new Set(state.rivals.list.map((r) => r.id)).size).toBe(state.rivals.list.length);
  }, 60_000);

  it('деньги соперника двигаются: он платит содержание и получает за работу', () => {
    const state = fresh(7);
    const before = state.rivals.list.map((r) => r.company.cbills);
    advance(state, 100);
    const after = state.rivals.list.map((r) => r.company.cbills);
    expect(after.some((v, i) => v !== before[i])).toBe(true);
  });
});

describe('реестр MRBC: канон и его масштаб', () => {
  it('великие полки не симулируются: их нет среди соперников', () => {
    const state = fresh(6);
    const great = new Set(MRBC_REGISTRY.map((u) => u.id));
    // Полк — отдельное действующее лицо со своим списком: ротным отрядом он не
    // бывает никогда.
    for (const rival of state.rivals.list) {
      expect(great.has(rival.unitId)).toBe(false);
      expect(MRBC_REGISTRY.some((u) => u.name === rival.name)).toBe(false);
    }
    expect(state.rivals.regiments).toHaveLength(MRBC_REGISTRY.length);
  }, 60_000);

  it('сила полка считается ТОЙ ЖЕ формулой, что и сила роты, а не берётся из данных', () => {
    // Ни одного числа рейтинга в data/rivals.json: там только состав.
    for (const unit of MRBC_REGISTRY) {
      expect(unit.rating).toBeGreaterThan(0);
      expect(unit.mechs).toBeGreaterThan(0);
    }
    // Вдвое больше машин — вдвое больше силы: формула линейна по парку, как и
    // `companyRating`, который просто складывает машины.
    expect(forceRating(200, 'standard', 55, 4)).toBeCloseTo(2 * forceRating(100, 'standard', 55, 4), 5);
    // Эталон: сто серийных средних машин с обычным экипажем — ровно сто единиц.
    expect(forceRating(100, 'standard', 55, 4)).toBe(100);
  }, 60_000);

  it('великие полки на порядки выше роты: это потолок, а не соседняя ступень', () => {
    const state = fresh(6);
    const mine = ratingTable(state).find((r) => r.isPlayer)?.rating ?? 0;
    const top = MRBC_REGISTRY[0]?.rating ?? 0;
    expect(top).toBeGreaterThan(mine * 100);
  }, 60_000);

  it('герб принадлежит имени: ни одна ячейка набора не занята дважды', () => {
    const used = [...MRBC_REGISTRY.map((u) => u.emblem), ...SECTOR_UNITS.map((u) => u.emblem)];
    expect(new Set(used).size).toBe(used.length);
    expect(used).not.toContain(RIVALS.sealEmblem);
  });

  // Срок задан явно: четыре года кампании с восемью соперниками — это около
  // полутора тысяч быстрых боёв, и в пять секунд по умолчанию они не всегда
  // укладываются. Горизонт здесь не роскошь: короче — и весь состав сектора не
  // успевает смениться, а проверка перестаёт проверять то, ради чего написана.
  it('имена и гербы соперников не повторяются даже после смены всего состава', () => {
    const state = fresh(7);
    advance(state, 800);
    const names = state.rivals.list.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
    // Канонический отряд не исчезает: он возвращается под своим именем.
    for (const unit of SECTOR_UNITS) {
      expect(state.rivals.list.some((r) => r.name === unit.name)).toBe(true);
    }
  }, 60_000);
});

describe('рейтинг MRBC', () => {
  it('в таблице рота игрока и все живые соперники, по силе сверху вниз', () => {
    const state = fresh(6);
    const table = ratingTable(state);
    expect(table.length).toBeGreaterThan(1);
    expect(table.filter((r) => r.isPlayer)).toHaveLength(1);
    for (let i = 1; i < table.length; i++) {
      expect((table[i - 1] as { rating: number }).rating).toBeGreaterThanOrEqual(
        (table[i] as { rating: number }).rating,
      );
      expect((table[i] as { rank: number }).rank).toBe(i + 1);
    }
  }, 60_000);

  it('рота игрока считается ТОЙ ЖЕ формулой, что соперник', () => {
    const state = fresh(6);
    const mine = ratingTable(state).find((r) => r.isPlayer);
    expect(mine?.rating).toBe(companyRating(state.company).total);
    expect(playerRank(state)).toBe(mine?.rank);
  }, 60_000);

  it('соперник в системе роты помечен как прямая конкуренция', () => {
    const state = fresh(6);
    const rival = state.rivals.list[0];
    expect(rival).toBeDefined();
    state.systemId = (rival as { systemId: string }).systemId;
    expect(ratingTable(state).find((r) => r.id === rival?.id)?.here).toBe(true);
  });
});

describe('соперники в снимке', () => {
  it('переживают круг через сохранение вместе с хэшем состояния', () => {
    const state = fresh(7);
    advance(state, 150);

    const file = makeSaveFile(snapshot(state));
    const back = restore(parseSaveFile(JSON.parse(JSON.stringify(file))));

    expect(hashCampaignState(back)).toBe(hashCampaignState(state));
    expect(back.rivals.list.map((r) => r.id)).toEqual(state.rivals.list.map((r) => r.id));
    expect(back.rivals.list.map((r) => r.company.cbills)).toEqual(
      state.rivals.list.map((r) => r.company.cbills),
    );
    expect(back.rivals.bankrupt).toBe(state.rivals.bankrupt);
  }, 60_000);

  it('загруженная кампания идёт дальше тем же путём, что и незагруженная', () => {
    const a = fresh(13);
    advance(a, 150);
    const b = restore(parseSaveFile(JSON.parse(JSON.stringify(makeSaveFile(snapshot(a))))));

    advance(a, 100);
    advance(b, 100);
    expect(hashCampaignState(b)).toBe(hashCampaignState(a));
  }, 60_000);

  it('соперники входят в хэш: подменённая касса отряда его двигает', () => {
    const state = fresh(2);
    const before = hashCampaignState(state);
    const first = state.rivals.list[0];
    expect(first).toBeDefined();
    state.rivals = {
      ...state.rivals,
      list: state.rivals.list.map((r, i) =>
        i === 0 ? { ...r, company: { ...r.company, cbills: r.company.cbills + 1 } } : r,
      ),
    };
    expect(hashCampaignState(state)).not.toBe(before);
  });
});

describe('соперники и снимок мира', () => {
  it('биржа остаётся выводимой: в снимок уходит только факт взятия', () => {
    const state = fresh(7);
    advance(state, 150);
    const snap = snapshot(state);
    // Ни одного списка предложений в снимке: у дельты есть только `taken`.
    for (const id of Object.keys(snap.deltas)) {
      const keys = Object.keys(snap.deltas[id] as object);
      for (const key of keys) {
        expect([
          'owner',
          'ruined',
          'development',
          'surveyed',
          'visited',
          'boughtDecade',
          'bought',
          'takenDecade',
          'taken',
          // Шаг 25: фокус мира и незавершённая переделка — такое же отклонение
          // от выводимого, как владелец и развитие.
          'focus',
          'focusTo',
          'focusUntil',
          // Шаг 26: дань — кому и до какого дня платит мир. Тоже отклонение, и
          // тоже снимается целиком, когда срок вышел.
          'tribute',
          'tributeUntil',
          // Шаг 37a: вычищенность мира от вольницы. Отклонение того же рода,
          // что разорение, и снимается так же целиком, зарастая до нуля.
          'cleared',
        ]).toContain(key);
      }
    }
  });
});

/**
 * ВЕЛИКИЕ ПОЛКИ: круг «повоевал → получил → восстановился» (диагностика шага 36,
 * 2026-09-07).
 *
 * **Зачем этот блок появился раньше самого шага 36.** План части 3b собирался
 * править содержание полков по наблюдению «верхние два полка копят миллиард,
 * нижние три проседают до половины и сидят в убытке». Замер на восьми сидах ×
 * 365 декад эту картину НЕ подтвердил: крайности есть обе, но они не
 * закреплены за полком — на одном сиде укатывается в накопление один полк, на
 * другом другой, а средняя укомплектованность у всех семи лежит в 0.38–0.77.
 * То есть механика не «делит полки на богатых и бедных», а имеет ОГРОМНЫЙ
 * разброс исхода: 0.17–1.00 штата и от 1.4 до 458.8 млн кассы.
 *
 * Отсюда и правило, ради которого блок написан: шаг 36 обязан сузить разброс,
 * НЕ ЛОМАЯ того, что уже держится. Держатся четыре вещи ниже — и они проверяются
 * здесь, чтобы правка содержания не снесла их молча.
 *
 * Такт зовётся напрямую, а не через `advance`: полный круг мира на 365 декад
 * стоит минуты, а здесь нужны только полки.
 */
describe('великие полки: круг содержания и восстановления', () => {
  const HORIZON = 365;

  function driveRegiments(seed: number): readonly Regiment[] {
    const state = new CampaignState(seed, { company: foundingInit(seed) });
    const rng = new Rng(seed ^ 0x5eed);
    let regiments = state.rivals.regiments;
    let war = state.war;
    for (let tick = 0; tick < HORIZON; tick++) {
      const out = regimentTick(regiments, war, state.reputation, state.deltas, state.worldSeed, tick * 10, rng);
      regiments = out.regiments;
      war = out.war;
    }
    return regiments;
  }

  const runs = [1, 2, 3].map((seed) => ({ seed, regiments: driveRegiments(seed) }));

  it('полк редеет, но не сходит на нет: ниже minShare не падает никогда', () => {
    // Ровно то, что чинил шаг 22c: первая версия перемалывала Драгун с 540
    // машин до 83 за триста дней. Из реестра MRBC не выбывают.
    for (const run of runs) {
      for (const r of run.regiments) {
        expect(r.mechs, `${r.name} на сиде ${run.seed}`).toBeGreaterThanOrEqual(
          Math.round(r.fullMechs * RIVALS.regiment.minShare),
        );
      }
    }
  });

  it('полк не превышает канонического состава', () => {
    for (const run of runs) {
      for (const r of run.regiments) {
        expect(r.mechs, `${r.name} на сиде ${run.seed}`).toBeLessThanOrEqual(r.fullMechs);
      }
    }
  });

  it('касса полка не уходит в минус: закупка идёт по средствам, а не в долг', () => {
    for (const run of runs) {
      for (const r of run.regiments) {
        expect(r.cbills, `${r.name} на сиде ${run.seed}`).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('состав реестра неизменен: полки не разоряются и не появляются', () => {
    for (const run of runs) {
      const before = new CampaignState(run.seed, { company: foundingInit(run.seed) });
      expect(run.regiments.map((r) => r.id)).toEqual(before.rivals.regiments.map((r) => r.id));
    }
  });

  it('полк действительно работает: подряды берутся и часть из них выигрывается', () => {
    // Без этого все проверки выше проходили бы и на полке, который не сделал
    // ни одного хода за десять лет, — а «ничего не случилось» это не инвариант.
    for (const run of runs) {
      for (const r of run.regiments) {
        expect(r.contracts, `${r.name} на сиде ${run.seed}`).toBeGreaterThan(HORIZON / 10);
        expect(r.wins, `${r.name} на сиде ${run.seed}`).toBeGreaterThan(0);
        expect(r.wins).toBeLessThanOrEqual(r.contracts);
      }
    }
  });
});

/**
 * Шаг 82: великие полки идут к войне. До шага все семь основывались в шести прыжках от
 * Аутрича и не двигались — за десять лет мира все 651 подряд достались Марику, а цель
 * выбиралась по таблице вражды без расстояния.
 */
describe('великие полки: база и перелёт (шаг 82)', () => {
  const baseOf = (id: string): string | undefined => RIVALS.registry.find((u) => u.id === id)?.great?.baseSystemId;

  it('полки основываются на своих канонических базах из каталога', () => {
    const state = fresh(5);
    expect(state.rivals.regiments.length).toBe(MRBC_REGISTRY.length);
    for (const r of state.rivals.regiments) {
      const base = baseOf(r.id);
      expect(base, r.id).toBeDefined();
      expect(GALAXY.has(base as string), `${r.id}: ${base}`).toBe(true);
      expect(r.systemId, r.name).toBe(base);
    }
  });

  function drive(seed: number, ticks: number) {
    const state = fresh(seed);
    const rng = new Rng(seed ^ 0x5eed);
    let regiments = state.rivals.regiments;
    let war = state.war;
    const commissions: { c: CommissionReport; day: number }[] = [];
    let moved = 0;
    for (let tick = 0; tick < ticks; tick++) {
      const out = regimentTick(regiments, war, state.reputation, state.deltas, state.worldSeed, tick * 10, rng);
      regiments = out.regiments;
      war = out.war;
      moved += out.moves.length;
      for (const c of out.commissions) commissions.push({ c, day: tick * 10 });
    }
    return { state, regiments, commissions, moved };
  }

  const runs = [1, 2].map((seed) => drive(seed, 100));

  it('за 100 декад хотя бы половина полков сменила систему', () => {
    for (const run of runs) {
      const away = run.regiments.filter((r) => r.systemId !== baseOf(r.id)).length;
      expect(away, `сид ${run.state.worldSeed}`).toBeGreaterThanOrEqual(Math.ceil(run.regiments.length / 2));
      expect(run.moved).toBeGreaterThan(0);
    }
  });

  it('цель подряда — фракция с участком фронта против нанимателя, а наниматель нанимает', () => {
    for (const run of runs) {
      expect(run.commissions.length).toBeGreaterThan(0);
      // Мир в этом прогоне не двигается (такт фронта не зовётся), поэтому участки
      // считаются по стартовому состоянию — ровно тем, по которым выбирал такт.
      const sectors = frontSectors(run.state.war, run.state.reputation, run.state.deltas, 0);
      const pairs = new Set(sectors.flatMap((s) => [`${s.defender}|${s.attacker}`, `${s.attacker}|${s.defender}`]));
      for (const { c } of run.commissions) {
        expect(pairs.has(`${c.employer}|${c.target}`), `${c.regimentName}: ${c.employer} → ${c.target}`).toBe(true);
        expect(['house', 'periphery', 'comstar']).toContain(factionKind(c.employer));
      }
    }
  });

  it('с мира, где нанимать некому, полк уходит в первую же декаду: Драгуны покидают Аутрич', () => {
    const state = fresh(3);
    const dragoons = state.rivals.regiments.find((r) => r.id === 'wolfs_dragoons') as Regiment;
    expect(dragoons.systemId).toBe('outreach');
    const out = regimentTick([dragoons], state.war, state.reputation, state.deltas, state.worldSeed, 0, new Rng(1));
    expect(out.moves).toHaveLength(1);
    expect(out.commissions).toHaveLength(0);
    expect(out.regiments[0]?.systemId).not.toBe('outreach');
    expect(out.regiments[0]?.employer).toBe(out.moves[0]?.employer);
  });

  it('с захваченного мира полк уходит сразу, а не нанимается к захватчику', () => {
    const state = fresh(3);
    const highlanders = state.rivals.regiments.find((r) => r.id === 'highlanders') as Regiment;
    expect(highlanders.employer).toBe('davion');
    // Нортвинд теперь чужой: полк нанимался к Дэвиону, владелец сменился.
    const seized: Regiment = { ...highlanders, employer: 'liao' };
    for (let seed = 1; seed <= 5; seed++) {
      const out = regimentTick([seized], state.war, state.reputation, state.deltas, state.worldSeed, 0, new Rng(seed));
      expect(out.commissions).toHaveLength(0);
      expect(out.moves).toHaveLength(1);
    }
  });
});

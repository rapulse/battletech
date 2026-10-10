import { describe, expect, it } from 'vitest';
import {
  CampaignRejectReason,
  CampaignState,
  canExecute,
  CAMPAIGN_RULES_VERSION,
  CAMPAIGN_STREAMS,
  dateOf,
  dayOf,
  execute,
  hashCampaignState,
  IncompatibleSaveError,
  makeSaveFile,
  parseSaveFile,
  restore,
  serializeCampaignState,
  snapshot,
  type CampaignCommand,
  type CampaignEvent,
  GALAXY,
  clearedOf,
  contractBoard,
  frontierIndexAt,
  ownerOf,
  pirateRisk,
  denBounty,
  withPirateClearing,
  worldProfile,
  PIRATE_FACTION,
} from '../src/core/campaign/index.js';
import { MemoryStorage, loadCampaign, saveCampaign } from '../src/platform/index.js';

/**
 * Шаг 10 — каркас кампании. Проверяется ровно то, на чём стоят все следующие
 * шаги: календарь, порядок исполнения отложенных задач, отсутствие следа от
 * отклонённой команды и круговой прогон сохранения.
 */

function due(events: readonly CampaignEvent[]): string[] {
  return events
    .filter((e): e is Extract<CampaignEvent, { kind: 'taskDue' }> => e.kind === 'taskDue')
    .map((e) => (e.task.kind === 'debug' ? e.task.label : e.task.kind));
}

/**
 * Только помеченные задачи теста.
 *
 * Кампания сама ведёт свою жизнь: содержание роты, затухание репутации, такт
 * экономики фракций. Тест про ПОРЯДОК исполнения не должен переписываться
 * каждый раз, когда у мира появляется ещё одно самостоятельное дело, — поэтому
 * он смотрит только на свои вехи.
 */
function dueLabels(events: readonly CampaignEvent[]): string[] {
  return events
    .filter((e): e is Extract<CampaignEvent, { kind: 'taskDue' }> => e.kind === 'taskDue')
    .filter((e) => e.task.kind === 'debug')
    .map((e) => (e.task as { label: string }).label);
}

function run(state: CampaignState, command: CampaignCommand): readonly CampaignEvent[] {
  const result = execute(state, command);
  if (!result.ok) throw new Error(`Команда ${command.kind} отклонена: ${result.reason}`);
  return result.events;
}

describe('календарь кампании', () => {
  it('день 0 — 1 января 3053 года: перемирие Тукайида уже подписано', () => {
    expect(dateOf(0)).toEqual({ year: 3053, month: 1, day: 1 });
  });

  it('дата и номер дня обратимы на длинном отрезке', () => {
    // Двадцать лет через високосные и невисокосные годы: 3056 високосный,
    // 3100 — нет (столетие не кратно 400), и это как раз тот случай, на
    // котором самодельная формула календаря обычно и расходится.
    for (let day = -400; day < 7300; day += 7) {
      expect(dayOf(dateOf(day))).toBe(day);
    }
  });

  it('високосный и невисокосный год считаются по-разному', () => {
    expect(dayOf({ year: 3057, month: 1, day: 1 }) - dayOf({ year: 3056, month: 1, day: 1 })).toBe(366);
    expect(dayOf({ year: 3101, month: 1, day: 1 }) - dayOf({ year: 3100, month: 1, day: 1 })).toBe(365);
  });

  it('ядро не пользуется Date — календарь чистая арифметика', () => {
    // Косвенно, но по существу: результат не зависит от текущего момента.
    expect(dateOf(365)).toEqual(dateOf(365));
    expect(dateOf(365)).toEqual({ year: 3054, month: 1, day: 1 });
  });
});

describe('очередь отложенных задач', () => {
  it('задачи исполняются по срокам, а не пачкой в конце', () => {
    const state = new CampaignState(1);
    run(state, { kind: 'schedule', day: 10, task: { kind: 'debug', label: 'ремонт' } });
    run(state, { kind: 'schedule', day: 3, task: { kind: 'debug', label: 'прыжок' } });
    run(state, { kind: 'schedule', day: 45, task: { kind: 'debug', label: 'контракт' } });

    const events = run(state, { kind: 'advance', days: 15 });
    expect(dueLabels(events)).toEqual(['прыжок', 'ремонт']);
    expect(state.day).toBe(15);
    // Конструктор сам ставит восемь самоподдерживающихся задач: первую зарплату
    // на день 30 (шаг 13), первое затухание репутации на день 30 (шаг 20), отдых
    // роты на день 10 (заживление травм, правка 2026-09-08), первый такт
    // экономики фракций на день 10 (шаг 21a), такт фронта туда же (шаг 21b),
    // такт событий мира туда же (шаг 84), такт развития планет туда же (шаг 23)
    // и такт соперников туда же (шаг 22). Все шесть декадных тактов за эти
    // пятнадцать суток уже отработали и переставили себя на день 20, так что в
    // очереди остаются они, зарплата, затухание и «контракт» — а не только последний.
    expect(state.queue).toHaveLength(9);
  });

  it('при равном дне порядок задаётся номером постановки, а не порядком в массиве', () => {
    const state = new CampaignState(1);
    for (const label of ['первая', 'вторая', 'третья']) {
      run(state, { kind: 'schedule', day: 5, task: { kind: 'debug', label } });
    }
    expect(due(run(state, { kind: 'advance', days: 5 }))).toEqual(['первая', 'вторая', 'третья']);
  });

  it('время доходит до задачи, а не перепрыгивает её', () => {
    // На шагах 13–16 работа, поставленная другой работой, обязана считать срок
    // от своего дня. Если день сдвигать только в конце прокрутки, все сроки
    // внутри отрезка окажутся сдвинуты вперёд.
    const state = new CampaignState(1);
    run(state, { kind: 'schedule', day: 4, task: { kind: 'debug', label: 'веха' } });

    const seen: number[] = [];
    const result = execute(state, { kind: 'advance', days: 10 });
    if (!result.ok) throw new Error('прокрутка отклонена');
    for (const e of result.events) {
      if (e.kind === 'taskDue' && e.task.kind === 'debug') seen.push(e.day);
    }

    expect(seen).toEqual([4]);
    expect(state.day).toBe(10);
  });

  it('задача на сегодня допустима, задача на вчера отклоняется', () => {
    const state = new CampaignState(1);
    run(state, { kind: 'advance', days: 10 });

    expect(execute(state, { kind: 'schedule', day: 10, task: { kind: 'debug', label: 'сейчас' } }).ok).toBe(true);
    expect(execute(state, { kind: 'schedule', day: 9, task: { kind: 'debug', label: 'вчера' } })).toEqual({
      ok: false,
      reason: CampaignRejectReason.DayInPast,
    });
  });

  it('время идёт только вперёд', () => {
    const state = new CampaignState(1);
    run(state, { kind: 'advance', days: 5 });
    expect(execute(state, { kind: 'advance', days: 0 }).ok).toBe(false);
    expect(execute(state, { kind: 'advanceTo', day: 3 })).toEqual({
      ok: false,
      reason: CampaignRejectReason.NonPositiveSpan,
    });
  });
});

describe('детерминизм кампании', () => {
  it('отклонённая команда не оставляет следа', () => {
    // То же правило, что в бою: иначе повтор по журналу разойдётся с
    // оригиналом на первом же отказе.
    const state = new CampaignState(4242);
    run(state, { kind: 'advance', days: 12 });
    const before = hashCampaignState(state);
    const seqBefore = state.nextSeq;

    expect(execute(state, { kind: 'advance', days: -3 }).ok).toBe(false);
    expect(execute(state, { kind: 'schedule', day: 1, task: { kind: 'debug', label: 'поздно' } }).ok).toBe(false);
    expect(execute(state, { kind: 'setCompanyName', name: '   ' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.EmptyName,
    });

    expect(hashCampaignState(state)).toBe(before);
    // Не 0: конструктор сам ставит первую зарплату в очередь (шаг 13) — счётчик
    // сравнивается с тем, что был ДО отклонённых команд, а не с нулём.
    expect(state.nextSeq).toBe(seqBefore);
  });

  it('журнал команд воспроизводит кампанию до того же состояния', () => {
    const journal: CampaignCommand[] = [
      { kind: 'setCompanyName', name: 'Железный Авангард' },
      { kind: 'schedule', day: 7, task: { kind: 'debug', label: 'ремонт' } },
      { kind: 'schedule', day: 7, task: { kind: 'debug', label: 'найм' } },
      { kind: 'advance', days: 20 },
      { kind: 'schedule', day: 45, task: { kind: 'debug', label: 'контракт' } },
      { kind: 'advanceTo', day: 60 },
    ];

    const play = (): CampaignState => {
      const state = new CampaignState(20260901);
      for (const c of journal) run(state, c);
      return state;
    };

    expect(hashCampaignState(play())).toBe(hashCampaignState(play()));
    expect(serializeCampaignState(play())).toBe(serializeCampaignState(play()));
  });

  it('разные сиды дают разные потоки ГПСЧ — иначе сид не подключён', () => {
    const hashes = new Set(
      [1, 2, 3, 4, 5].map((seed) => JSON.stringify(new CampaignState(seed).rng.getState())),
    );
    expect(hashes.size).toBe(5);
  });

  it('потоки кампании независимы друг от друга', () => {
    const rng = new CampaignState(77).rng;
    const first = CAMPAIGN_STREAMS.map((n) => rng.stream(n).next());
    expect(new Set(first).size).toBe(CAMPAIGN_STREAMS.length);
  });

  it('потоки кампании не совпадают с боевыми по именам', () => {
    // Имя `campaign` в боевом наборе занято генерацией пилотов
    // (`sim/scenario.ts`). Одноимённые потоки тянули бы числа из одной
    // последовательности.
    expect(CAMPAIGN_STREAMS.every((n) => n.startsWith('camp.'))).toBe(true);
  });
});

describe('сохранение кампании', () => {
  it('снимок и восстановление дают то же состояние', () => {
    const state = new CampaignState(31337, { companyName: 'Гончие' });
    run(state, { kind: 'schedule', day: 90, task: { kind: 'debug', label: 'долг' } });
    run(state, { kind: 'advance', days: 30 });
    state.rng.stream('camp.market').d2d6();

    const back = restore(parseSaveFile(makeSaveFile(snapshot(state))));
    expect(hashCampaignState(back)).toBe(hashCampaignState(state));
    expect(back.queue).toEqual(state.queue);
    expect(back.nextSeq).toBe(state.nextSeq);
  });

  it('состояние ГПСЧ переживает сохранение', () => {
    // Иначе загрузка становится способом переиграть неудачный бросок: кампания
    // сохранилась, бросок не понравился, загрузились — и он другой.
    const state = new CampaignState(5);
    for (let i = 0; i < 10; i++) state.rng.stream('camp.salvage').d2d6();

    const file = makeSaveFile(snapshot(state));
    // Снимок сделан ДО этого броска — восстановленная кампания обязана выдать
    // ровно его, а не следующий и не начало последовательности.
    const expected = state.rng.stream('camp.salvage').d2d6();

    const back = restore(parseSaveFile(file));
    expect(back.rng.stream('camp.salvage').d2d6()).toBe(expected);
  });

  it('файл чужой версии правил не загружается, а отказывает', () => {
    const file = makeSaveFile(snapshot(new CampaignState(1)));
    const stale = { ...file, state: { ...file.state, rulesVersion: CAMPAIGN_RULES_VERSION + 1 } };
    expect(() => parseSaveFile(stale)).toThrow(IncompatibleSaveError);
  });

  it('испорченный файл падает на схеме, а не позже', () => {
    expect(() => parseSaveFile({ format: 'battletech-campaign' })).toThrow();
    expect(() => parseSaveFile({ format: 'что-то другое', state: {} })).toThrow();

    const file = makeSaveFile(snapshot(new CampaignState(1)));
    const { 'camp.market': _dropped, ...partialRng } = file.state.rng;
    expect(() => parseSaveFile({ ...file, state: { ...file.state, rng: partialRng } })).toThrow();
  });

  it('герб и позывной командира переживают выгрузку в файл (шаг 17)', () => {
    // Ради этого они и лежат в состоянии, а не рядом с ним: кампания, унесённая
    // файлом на другую машину, обязана приехать со своим гербом, а не с чужим.
    const state = new CampaignState(77, {
      companyName: 'Железный Авангард',
      company: { emblem: 11, commander: 'Вулкан' },
    });

    const back = restore(parseSaveFile(makeSaveFile(snapshot(state))));
    expect(back.company.emblem).toBe(11);
    expect(back.company.commander).toBe('Вулкан');
  });

  it('герб за пределами набора не попадает в состояние', () => {
    // Границы набора проверяет ядро, а не экран: номер входит в схему
    // сохранения, и проверять его обязано то же место, что и всё остальное.
    expect(new CampaignState(1, { company: { emblem: 99 } }).company.emblem).toBe(99 % 16);
    expect(new CampaignState(1, { company: { emblem: -3 } }).company.emblem).toBe(0);
    expect(new CampaignState(1, { company: { commander: '   ' } }).company.commander).toBe('Командир');
  });

  it('боезапас на складе валидируется схемой сохранения и восстанавливается', () => {
    const state = new CampaignState(1);
    state.company = {
      ...state.company,
      warehouse: [
        ...state.company.warehouse,
        { sort: 'item', id: 'w-ammo-1', itemId: 'ammo_ac20', kind: 'ammo' },
      ],
    };

    const file = makeSaveFile(snapshot(state));
    const back = restore(parseSaveFile(file));
    expect(back.company.warehouse.some((entry) => entry.sort === 'item' && entry.kind === 'ammo')).toBe(true);
  });

  it('круговой прогон через хранилище не теряет состояние', async () => {
    const storage = new MemoryStorage();
    const state = new CampaignState(999, { companyName: 'Легион' });
    run(state, { kind: 'advance', days: 200 });

    await saveCampaign(storage, 'slot1', state);
    expect(await storage.list()).toEqual(['slot1']);

    const back = await loadCampaign(storage, 'slot1');
    expect(back).not.toBeNull();
    expect(hashCampaignState(back!)).toBe(hashCampaignState(state));
    expect(await loadCampaign(storage, 'нет-такого')).toBeNull();
  });
});

/**
 * ТЕПЛОВЫЕ КАРТЫ ЗВЁЗДНОЙ КАРТЫ (шаг 41).
 *
 * Проверяется одно и главное: **карта рисует ровно то, что считает мир.**
 * Экран — слой показа, и своей формулы у него быть не может; карта, рисующая
 * не то, чем живёт биржа, хуже отсутствия карты — игрок полетит туда, где ему
 * обещали работу, и не найдёт её.
 */
describe('тепловые карты: слой показа не заводит своей арифметики', () => {
  it('слой пиратской угрозы совпадает с тем, что выдаёт биржа', () => {
    const state = new CampaignState(9);

    let checked = 0;
    let lawless = 0;
    let patrolled = 0;
    for (let i = 0; i < GALAXY.count; i += 11) {
      const id = GALAXY.id(i);
      const profile = worldProfile(state.worldSeed, state.deltas, i);
      const expected = pirateRisk(frontierIndexAt(state.deltas, state.reputation, state.war, i), {
        marketClass: profile.marketClass,
        garrison: profile.garrison,
        ruined: 0,
        owner: ownerOf(state.deltas, i),
        blackMarket: GALAXY.hasFlag(i, 'blackMarket'),
        cleared: 0,
      });
      // Награда за логово (шаг 72f) — вторая половина слоя: на мире вольницы
      // работа против неё идёт по `denBounty`, и карта берёт большее из двух.
      const shown = Math.max(expected, denBounty(state.deltas, i));
      // Биржа зовёт ту же функцию: если бы карта считала своим способом, эта
      // сверка развалилась бы на первой же системе с гарнизоном.
      const board = contractBoard(state.worldSeed, state.deltas, id, state.day, state.reputation, state.war);
      const hasPirates = board.some((c) => c.target === PIRATE_FACTION);
      if (shown === 0) {
        // Карта обещает «пиратской работы здесь не бывает» — и её нет.
        expect(hasPirates, `${id}: карта обещала тишину, а биржа дала пиратов`).toBe(false);
        patrolled++;
      }
      if (expected >= 0.9) lawless++;
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
    // Обе крайности обязаны существовать, иначе проверка выше прошла бы на
    // пустой выборке: карта, у которой везде ноль, тоже «не врёт».
    expect(patrolled).toBeGreaterThan(0);
    expect(lawless).toBeGreaterThan(0);
  });

  it('вычищенность видна на карте и снимает угрозу', () => {
    const state = new CampaignState(9);
    // Мир с вольницей: там, где карта показывает очаг.
    let target = -1;
    for (let i = 0; i < GALAXY.count && target < 0; i++) {
      const profile = worldProfile(state.worldSeed, state.deltas, i);
      const risk = pirateRisk(frontierIndexAt(state.deltas, state.reputation, state.war, i), {
        marketClass: profile.marketClass,
        garrison: profile.garrison,
        ruined: 0,
        owner: ownerOf(state.deltas, i),
        blackMarket: GALAXY.hasFlag(i, 'blackMarket'),
        cleared: 0,
      });
      if (risk >= 0.9) target = i;
    }
    expect(target).toBeGreaterThanOrEqual(0);

    const id = GALAXY.id(target);
    const facts = {
      marketClass: worldProfile(state.worldSeed, state.deltas, target).marketClass,
      garrison: worldProfile(state.worldSeed, state.deltas, target).garrison,
      ruined: 0,
      owner: ownerOf(state.deltas, target),
      blackMarket: GALAXY.hasFlag(target, 'blackMarket'),
    };
    const frontier = frontierIndexAt(state.deltas, state.reputation, state.war, target);
    const before = pirateRisk(frontier, { ...facts, cleared: 0 });
    const deltas = withPirateClearing(state.deltas, target);
    const after = pirateRisk(frontier, {
      ...facts,
      cleared: clearedOf(deltas, id),
    });
    expect(after).toBeLessThan(before);
  });
});

describe('доступность прокрутки (2026-10-04)', () => {
  it('canExecute отвечает про прокрутку без прогона — так же, как сама прокрутка', () => {
    const state = new CampaignState(9);
    const same = (s: CampaignState, command: CampaignCommand): void => {
      const probe = restore(snapshot(s));
      const r = execute(probe, command);
      expect(canExecute(s, command)).toBe(r.ok ? null : r.reason);
    };
    for (const days of [1, 7, 30, 0, -3]) same(state, { kind: 'advance', days });
    same(state, { kind: 'advanceTo', day: state.day });
    same(state, { kind: 'advanceTo', day: state.day + 12 });
    // Открытая карточка (требование соседа) останавливает время — и кнопка это знает.
    state.war = { ...state.war, demands: { pending: { from: 'davion', systemId: 'terra', day: state.day }, last: {} } };
    for (const days of [1, 30]) same(state, { kind: 'advance', days });
    expect(canExecute(state, { kind: 'advance', days: 1 })).toBe(CampaignRejectReason.EventPending);
  });
});

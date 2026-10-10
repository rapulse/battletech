import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_RULES_VERSION,
  CampaignState,
  GALAXY,
  REPUTATION,
  advanceFactor,
  applyReputation,
  atonementGain,
  hostileFloor,
  availableContracts,
  blockedOffers,
  contractBoard,
  contractReputation,
  decayReputation,
  execute,
  foundingInit,
  hashCampaignState,
  initialRelation,
  makeReputation,
  makeSaveFile,
  marketProfile,
  missionAllowed,
  missionLevel,
  parseSaveFile,
  payoutFactor,
  relationOf,
  restore,
  snapshot,
  standingList,
  standingOf,
  withRelation,
  withStanding,
  type CampaignCommand,
  type CampaignEvent,
} from '../src/core/campaign/index.js';
import { enmity } from '../src/core/campaign/contracts/relations.js';
import { CONTRACTS } from '../src/core/campaign/contracts/schema.js';

/**
 * Репутация отряда (шаг 20).
 *
 * Проверяется ровно то, что глазами не поймать и что дороже всего чинить потом:
 * разрежённость обеих карт, единственность места начисления, работа
 * политической сети поверх матрицы, порог доступности вместе с его
 * предохранителем и то, что оси действительно доезжают до сохранения.
 */

const WORLD = 4242;

function run(state: CampaignState, command: CampaignCommand): readonly CampaignEvent[] {
  const result = execute(state, command);
  if (!result.ok) throw new Error(`команда отклонена: ${result.reason}`);
  return result.events;
}

// --- состояние и разрежённость ------------------------------------------------

describe('оси репутации', () => {
  it('свежий отряд: отношение и известность с нуля, надёжность — стартовая', () => {
    const rep = makeReputation();
    expect(rep.fame).toBe(0);
    expect(rep.reliability).toBe(REPUTATION.axes.reliabilityStart);
    expect(standingOf(rep, 'kurita')).toBe(0);
    // Обе карты пустые: разрежённость — не оптимизация, а условие того, чтобы
    // сохранение не росло на 20 фракций и 190 пар с первого дня.
    expect(Object.keys(rep.standing)).toEqual([]);
    expect(Object.keys(rep.relations)).toEqual([]);
  });

  it('запись, вернувшаяся к нулю, из карты удаляется', () => {
    // Иначе разрежённость протекала бы через затухание: оно только и делает,
    // что тянет значения к нулю, и плотная карта собралась бы сама.
    const rep = withStanding(withStanding(makeReputation(), 'kurita', 12), 'kurita', -12);
    expect(standingOf(rep, 'kurita')).toBe(0);
    expect(Object.keys(rep.standing)).toEqual([]);
  });

  it('оси не выходят за края шкалы', () => {
    const rep = withStanding(makeReputation(), 'davion', 10_000);
    expect(standingOf(rep, 'davion')).toBe(REPUTATION.axes.standingMax);
    const low = withStanding(makeReputation(), 'davion', -10_000);
    expect(standingOf(low, 'davion')).toBe(REPUTATION.axes.standingMin);
  });

  it('матрица отношений выводится из статичной вражды, а не переписывается заново', () => {
    // «отношение = 1 − 2 × вражда»: тотальная война даёт −1, «воевать не о чем» — +1.
    expect(initialRelation('kurita', 'davion')).toBeCloseTo(1 - 2 * enmity('kurita', 'davion'), 6);
    expect(initialRelation('steiner', 'davion')).toBeGreaterThan(0.9);
    expect(initialRelation('kurita', 'davion')).toBeLessThan(-0.8);
    // Фракция сама с собой — тождество, а не запись в таблице.
    expect(relationOf(makeReputation(), 'kurita', 'kurita')).toBe(1);
  });

  it('переписанная пара матрицы читается сетью, а не украшает снимок', () => {
    // Матрицу двигает тикер войны (шаг 21). Этот тест доказывает, что поле
    // ЖИВОЕ: подменённая пара действительно меняет расход репутации по сети.
    const base = makeReputation();
    const flipped = withRelation(base, 'kurita', 'davion', 1);
    expect(relationOf(flipped, 'davion', 'kurita')).toBe(1);

    const before = contractReputation(base, 'won', 'raid', 'davion', 'pirates');
    const after = contractReputation(flipped, 'won', 'raid', 'davion', 'pirates');
    const kuritaBefore = before.standing.find((c) => c.factionId === 'kurita')?.delta ?? 0;
    const kuritaAfter = after.standing.find((c) => c.factionId === 'kurita')?.delta ?? 0;
    expect(kuritaAfter).toBeGreaterThan(kuritaBefore);

    // Возврат к выведенному значению убирает запись из разрежённой карты.
    const back = withRelation(flipped, 'kurita', 'davion', initialRelation('kurita', 'davion'));
    expect(Object.keys(back.relations)).toEqual([]);
  });
});

// --- начисление и политическая сеть -------------------------------------------

describe('начисление репутации', () => {
  it('уровень контракта растёт от гарнизона к штурму', () => {
    expect(missionLevel('garrison')).toBe(0);
    expect(missionLevel('assault')).toBe(1);
    expect(missionLevel('raid')).toBeGreaterThan(missionLevel('recon'));
  });

  it('выполненный контракт греет нанимателя и злит цель, тяжёлый — сильнее', () => {
    const rep = makeReputation();
    const light = contractReputation(rep, 'won', 'garrison', 'davion', 'kurita');
    const heavy = contractReputation(rep, 'won', 'assault', 'davion', 'kurita');

    const employer = (d: typeof light): number =>
      d.standing.find((c) => c.factionId === 'davion')?.delta ?? 0;
    const target = (d: typeof light): number =>
      d.standing.find((c) => c.factionId === 'kurita')?.delta ?? 0;

    expect(employer(light)).toBeGreaterThan(0);
    expect(target(light)).toBeLessThan(0);
    expect(employer(heavy)).toBeGreaterThan(employer(light));
    expect(target(heavy)).toBeLessThan(target(light));
  });

  it('превышение задачи ценится выше простого выполнения', () => {
    const rep = makeReputation();
    const won = contractReputation(rep, 'won', 'raid', 'davion', 'kurita');
    const beyond = contractReputation(rep, 'beyond', 'raid', 'davion', 'kurita');
    expect(beyond.fame).toBeGreaterThan(won.fame);
    expect(beyond.standing.find((c) => c.factionId === 'davion')?.delta ?? 0).toBeGreaterThan(
      won.standing.find((c) => c.factionId === 'davion')?.delta ?? 0,
    );
  });

  it('политическая сеть: враг цели теплеет, союзник цели холодеет', () => {
    // Ударили по Куритам за Штайнера. Дэвион — враг Куриты и союзник Штайнера,
    // и обе причины толкают его в одну сторону: он обязан потеплеть.
    const deltas = contractReputation(makeReputation(), 'won', 'raid', 'steiner', 'kurita');
    const davion = deltas.standing.find((c) => c.factionId === 'davion');
    expect(davion).toBeDefined();
    expect(davion?.delta ?? 0).toBeGreaterThan(0);
    expect(davion?.reason).toBe('network');

    // Прямые стороны сетью не пересчитываются: у них своя, прямая причина.
    const reasons = new Map(deltas.standing.map((c) => [c.factionId, c.reason]));
    expect(reasons.get('steiner')).toBe('employer');
    expect(reasons.get('kurita')).toBe('target');
  });

  it('сеть слабее прямого удара, иначе союзник получал бы столько же, сколько наниматель', () => {
    // Замер шага 20 нашёл ровно это: при большом коэффициенте вся Сфера
    // упиралась в потолок к двадцатому контракту.
    const deltas = contractReputation(makeReputation(), 'won', 'raid', 'davion', 'kurita');
    const employer = Math.abs(deltas.standing.find((c) => c.factionId === 'davion')?.delta ?? 0);
    for (const change of deltas.standing) {
      if (change.reason !== 'network') continue;
      expect(Math.abs(change.delta)).toBeLessThan(employer / 2);
    }
  });

  it('затухание тянет отношение к нулю, надёжность не трогает вовсе', () => {
    let rep = withStanding(makeReputation(), 'davion', 10);
    rep = withStanding(rep, 'kurita', -10);
    const before = rep.reliability;
    const after = decayReputation(rep);

    expect(standingOf(after, 'davion')).toBeLessThan(10);
    expect(standingOf(after, 'davion')).toBeGreaterThan(0);
    expect(standingOf(after, 'kurita')).toBeGreaterThan(-10);
    expect(after.reliability).toBe(before);
    // Матрицу фракций затухание не трогает: она про политическую карту, а не
    // про отряд.
    expect(after.relations).toEqual(rep.relations);
  });

  it('договор державы держит доброе отношение, обида тает как обычно (отладка 2026-10-03)', () => {
    let rep = withStanding(makeReputation(), 'davion', 40);
    rep = withStanding(rep, 'kurita', -10);
    const held = decayReputation(rep, new Set(['davion', 'kurita']));
    expect(standingOf(held, 'davion')).toBe(40);
    expect(standingOf(held, 'kurita')).toBeGreaterThan(-10);
    expect(standingOf(decayReputation(rep), 'davion')).toBeLessThan(40);
  });

  it('глубокая вражда остывает быстрее обычной', () => {
    // Ниже порога, за которым Дом не даёт никакой работы, — свой шаг затухания
    // (решение пользователя 2026-09-14): иначе из −60 рота выбиралась бы годами.
    const floor = hostileFloor();
    const deep = withStanding(makeReputation(), 'kurita', floor - 30);
    const mild = withStanding(makeReputation(), 'kurita', floor + 10);
    expect(standingOf(decayReputation(deep), 'kurita') - (floor - 30)).toBe(REPUTATION.decay.hostileStandingPerTick);
    expect(standingOf(decayReputation(mild), 'kurita') - (floor + 10)).toBe(REPUTATION.decay.standingPerTick);
  });

  it('затухание не проваливает отношение за ноль в другой знак', () => {
    const rep = withStanding(makeReputation(), 'davion', 0.5);
    expect(standingOf(decayReputation(rep), 'davion')).toBe(0);
  });
});

// --- одно место начисления ----------------------------------------------------

describe('репутация меняется только командами', () => {
  // Галатея, а не Аутрич, и не по вкусу. С шага 37 биржа Аутрича ПУСТА:
  // гарнизон Драгун 4.0 из 5, класс «столица», фронта рядом нет — вольнице там
  // делать нечего, а чужих флагов в двух прыжках не найти. Аутрич остался
  // стартовой системой кампании как рынок и мастерская, но работу берут не там.
  // Галатея — вторая наёмничья биржа Сферы, глубокий тыл без гарнизона.
  const HIRING_HALL = 'galatea';

  function startedCampaign(seed = 7): CampaignState {
    return new CampaignState(seed, { systemId: HIRING_HALL, company: foundingInit(seed) });
  }

  it('чтение биржи не двигает ни репутацию, ни хэш', () => {
    const state = startedCampaign();
    const before = hashCampaignState(state);
    contractBoard(state.worldSeed, state.deltas, state.systemId, state.day, state.reputation);
    availableContracts(state.worldSeed, state.deltas, state.systemId, state.day, [], state.reputation);
    blockedOffers(state.worldSeed, state.deltas, state.systemId, state.day, state.reputation);
    expect(hashCampaignState(state)).toBe(before);
  });

  it('разрыв контракта роняет надёжность и злит нанимателя', () => {
    const state = startedCampaign();
    // Биржа Галатеи не бывает пустой: тыл без гарнизона, вольницы там вдоволь.
    const board = availableContracts(state.worldSeed, state.deltas, state.systemId, state.day, [], state.reputation);
    expect(board.length).toBeGreaterThan(0);
    const taken = board[0]!;
    run(state, { kind: 'takeContract', contractId: taken.id });
    const reliabilityBefore = state.reputation.reliability;

    const events = run(state, { kind: 'abandonContract' });
    expect(state.reputation.reliability).toBeLessThan(reliabilityBefore);
    expect(standingOf(state.reputation, taken.employer)).toBeLessThan(0);

    // Журнал репутации собирается из событий, а не из второго списка в состоянии.
    const changed = events.filter((e) => e.kind === 'reputationChanged');
    expect(changed.length).toBeGreaterThan(0);
    const employerLine = changed.find(
      (e) => e.kind === 'reputationChanged' && e.factionId === taken.employer,
    );
    expect(employerLine).toBeDefined();
  });

  it('затухание идёт задачей очереди суток и переставляет себя дальше', () => {
    const state = startedCampaign();
    state.reputation = withStanding(state.reputation, 'davion', 20);

    run(state, { kind: 'advance', days: REPUTATION.decay.intervalDays + 1 });
    expect(standingOf(state.reputation, 'davion')).toBeLessThan(20);
    // Задача обязана стоять в очереди снова: месяц без контрактов не должен
    // останавливать затухание навсегда.
    expect(state.queue.some((e) => e.task.kind === 'decayTick')).toBe(true);
  });
});

// --- последствия --------------------------------------------------------------

/** См. пояснение у `HIRING_HALL` выше: биржа Аутрича с шага 37 пуста. */
const HIRING_HALL_ID = 'galatea';

describe('последствия репутации', () => {
  it('нулевая репутация ничего не меняет: баланс шагов 16–19 остаётся в силе', () => {
    expect(payoutFactor(0)).toBe(1);
    expect(advanceFactor(REPUTATION.axes.reliabilityStart)).toBe(1);
    expect(marketProfile(WORLD, 'outreach', 0).priceFactor).toBeCloseTo(
      marketProfile(WORLD, 'outreach').priceFactor,
      9,
    );
  });

  it('отношение двигает гонорар, надёжность — аванс', () => {
    expect(payoutFactor(100)).toBeGreaterThan(payoutFactor(0));
    expect(payoutFactor(-100)).toBeLessThan(payoutFactor(0));
    // Ровно это закрывает эксплойт с отходом: сбежал — следующий наниматель
    // платит вперёд меньше (`questions.md`, п. 1).
    expect(advanceFactor(0)).toBeLessThan(advanceFactor(REPUTATION.axes.reliabilityStart));
    expect(advanceFactor(100)).toBeGreaterThan(advanceFactor(REPUTATION.axes.reliabilityStart));
  });

  it('хорошее отношение удешевляет рынок на территории фракции', () => {
    expect(marketProfile(WORLD, 'outreach', 100).priceFactor).toBeLessThan(
      marketProfile(WORLD, 'outreach', -100).priceFactor,
    );
  });

  it('порог доступности закрывает работу, но оставляет дно', () => {
    // Дом с плохим отношением не даёт ничего, кроме гарнизона (решение
    // 2026-09-03, вопрос 1 плана шага 20).
    expect(missionAllowed('garrison', 'davion', -10, 0)).toBe(true);
    expect(missionAllowed('raid', 'davion', -10, 100)).toBe(false);
    expect(missionAllowed('assault', 'davion', 100, 0)).toBe(false);

    // ПРЕДОХРАНИТЕЛЬ: у пиратской вольницы политики нет, и она берёт кого
    // угодно. Тупик в кампании про наёмника читается как поломка.
    for (const mission of ['garrison', 'recon', 'raid', 'defense', 'assault'] as const) {
      expect(missionAllowed(mission, 'pirates', -100, 0)).toBe(true);
      expect(missionAllowed(mission, 'independent', -100, 0)).toBe(true);
    }
  });

  it('биржа вычёркивает недоступное, не сдвигая остальные предложения', () => {
    // Порог фильтрует ПОСЛЕ бросков: иначе вся биржа менялась бы от каждого
    // закрытого контракта, и это читалось бы как поломка генератора.
    const id = GALAXY.id(3);
    const open = contractBoard(WORLD, {}, id, 0);
    const hated = { ...makeReputation(), standing: { davion: -100, kurita: -100, steiner: -100 } };
    const limited = contractBoard(WORLD, {}, id, 0, hated);

    // Искупительные предложения (2026-09-14) дописываются враждебным нанимателем
    // В КОНЕЦ и своим ГПСЧ — это новые строки, а не сдвинутые старые; здесь
    // сравнивается обычная биржа.
    const regular = limited.filter((c) => c.atonement !== true);
    const openIds = new Set(open.map((c) => c.id));
    for (const c of regular) expect(openIds.has(c.id)).toBe(true);
    expect(regular.length).toBeLessThanOrEqual(open.length);
  });

  it('«сколько закрыто порогом» считается от полного списка, а не от чужой биржи', () => {
    // Ошибка, найденная после первого замера: базовой линией был вызов биржи
    // БЕЗ репутации, а он не «биржа без порога», а биржа отряда с нулевой
    // репутацией — тот же порог, только по нулям. Столбец замера показывал ноль
    // закрытых предложений там, где порог прятал пятую часть списка.
    const id = HIRING_HALL_ID;
    const rookie = makeReputation();
    const veteran = { ...makeReputation(), fame: 60, standing: { steiner: 100 } };

    const blockedRookie = blockedOffers(WORLD, {}, id, 0, rookie);
    const blockedVeteran = blockedOffers(WORLD, {}, id, 0, veteran);

    // Знаменатель один и тот же у обоих: порог вычёркивает из одного и того же
    // выброшенного списка. Сравнивается без работы новичку (2026-10-04): она
    // законно растит биржу малоизвестного отряда, а тест — про порог.
    const board = CONTRACTS.board as { noviceOffers: number };
    const novice = board.noviceOffers;
    board.noviceOffers = 0;
    try {
      expect(blockedOffers(WORLD, {}, id, 0, rookie).total).toBe(blockedOffers(WORLD, {}, id, 0, veteran).total);
    } finally {
      board.noviceOffers = novice;
    }
    expect(blockedRookie.total).toBeGreaterThanOrEqual(blockedVeteran.total);
    expect(blockedRookie.total).toBeGreaterThan(0);
    // И он сходится с тем, что видно на бирже.
    expect(blockedRookie.total - blockedRookie.count).toBe(
      contractBoard(WORLD, {}, id, 0, rookie).length,
    );
    // Ветеран видит не меньше новичка — порог только открывается с ростом.
    expect(blockedVeteran.count).toBeLessThanOrEqual(blockedRookie.count);
  });

  it('гонорар и аванс приходят на биржу уже с множителями', () => {
    const id = HIRING_HALL_ID;
    const employer = contractBoard(WORLD, {}, id, 0)[0]?.employer;
    expect(employer).toBeDefined();

    const loved = withStanding(makeReputation(), employer as string, 100);
    const plain = contractBoard(WORLD, {}, id, 0)[0];
    const rich = contractBoard(WORLD, {}, id, 0, loved).find((c) => c.id === plain?.id);
    expect(rich).toBeDefined();
    expect(rich?.payout ?? 0).toBeGreaterThan(plain?.payout ?? 0);
    expect(rich?.salvageShare ?? 0).toBeGreaterThanOrEqual(plain?.salvageShare ?? 0);
  });
});

describe('искупление: путь назад от вражды (2026-09-14)', () => {
  const id = HIRING_HALL_ID;
  const employerOf = (): string => contractBoard(WORLD, {}, id, 0)[0]?.employer as string;

  it('враждебный Дом выставляет работу против пиратов без денег и трофеев', () => {
    const employer = employerOf();
    const hated = withStanding(makeReputation(), employer, hostileFloor() - 20);
    const atonement = contractBoard(WORLD, {}, id, 0, hated).filter((c) => c.atonement === true);

    expect(atonement.length).toBe(REPUTATION.atonement.offers);
    for (const c of atonement) {
      expect(c.employer).toBe(employer);
      expect(c.target).toBe('pirates');
      expect(c.payout).toBe(0);
      expect(c.advance).toBe(0);
      expect(c.penalty).toBe(0);
      expect(c.salvageShare).toBe(0);
    }
  });

  it('пока с Домом можно работать, искупления нет', () => {
    const employer = employerOf();
    const cool = withStanding(makeReputation(), employer, hostileFloor());
    expect(contractBoard(WORLD, {}, id, 0, cool).some((c) => c.atonement === true)).toBe(false);
  });

  it('плата — отношение: множитель только на прибавку за победу', () => {
    const rep = makeReputation();
    const plain = contractReputation(rep, 'won', 'raid', 'davion', 'pirates');
    const atoned = contractReputation(rep, 'won', 'raid', 'davion', 'pirates', true);
    const gain = (d: typeof plain): number => d.standing.find((c) => c.factionId === 'davion')?.delta ?? 0;
    expect(gain(atoned)).toBeCloseTo(gain(plain) * REPUTATION.atonement.standingFactor, 1);
    expect(gain(atoned)).toBeCloseTo(atonementGain('raid'), 1);
    // Сложнее работа — больше плата.
    expect(atonementGain('assault')).toBeGreaterThan(atonementGain('garrison'));

    const lostPlain = contractReputation(rep, 'abandoned', 'raid', 'davion', 'pirates');
    const lostAtoned = contractReputation(rep, 'abandoned', 'raid', 'davion', 'pirates', true);
    expect(gain(lostAtoned)).toBe(gain(lostPlain));
  });

  it('взятый искупительный контракт переживает сохранение, старый формат не меняется', () => {
    const state = new CampaignState(11, { systemId: id, company: foundingInit(11) });
    const employer = contractBoard(state.worldSeed, state.deltas, state.systemId, state.day)[0]?.employer as string;
    state.reputation = withStanding(state.reputation, employer, hostileFloor() - 20);
    const offer = availableContracts(state.worldSeed, state.deltas, state.systemId, state.day, [], state.reputation).find(
      (c) => c.atonement === true,
    );
    expect(offer).toBeDefined();
    expect(execute(state, { kind: 'takeContract', contractId: (offer as { id: string }).id }).ok).toBe(true);

    const back = restore(parseSaveFile(JSON.parse(JSON.stringify(makeSaveFile(snapshot(state))))));
    expect(back.contract?.contract.atonement).toBe(true);
    expect(hashCampaignState(back)).toBe(hashCampaignState(state));
    expect(back.rulesVersion).toBe(CAMPAIGN_RULES_VERSION);
  });
});

// --- снимок и хэш -------------------------------------------------------------

describe('репутация в снимке', () => {
  it('версия правил поднята: старое сохранение не грузится молча', () => {
    expect(CAMPAIGN_RULES_VERSION).toBeGreaterThanOrEqual(8);
  });

  it('оси и обе карты переживают круговой прогон через файл', () => {
    const state = new CampaignState(11, { systemId: HIRING_HALL_ID, company: foundingInit(11) });
    state.reputation = withRelation(
      applyReputation(
        state.reputation,
        contractReputation(state.reputation, 'won', 'raid', 'steiner', 'kurita'),
      ),
      'kurita',
      'davion',
      0.5,
    );

    const before = hashCampaignState(state);
    const file = JSON.parse(JSON.stringify(makeSaveFile(snapshot(state))));
    const back = restore(parseSaveFile(file));

    expect(hashCampaignState(back)).toBe(before);
    expect(back.reputation.standing).toEqual(state.reputation.standing);
    expect(back.reputation.relations).toEqual(state.reputation.relations);
    expect(relationOf(back.reputation, 'davion', 'kurita')).toBe(0.5);
  });

  it('репутация входит в хэш: два состояния с разным отношением различимы', () => {
    const a = new CampaignState(11, { systemId: HIRING_HALL_ID, company: foundingInit(11) });
    const b = new CampaignState(11, { systemId: HIRING_HALL_ID, company: foundingInit(11) });
    expect(hashCampaignState(a)).toBe(hashCampaignState(b));

    b.reputation = withStanding(b.reputation, 'kurita', -30);
    expect(hashCampaignState(a)).not.toBe(hashCampaignState(b));
  });

  it('список фракций для экрана полон и отсортирован от лучшего к худшему', () => {
    const rep = withStanding(withStanding(makeReputation(), 'davion', 40), 'kurita', -40);
    const rows = standingList(rep);
    expect(rows[0]?.id).toBe('davion');
    expect(rows[rows.length - 1]?.id).toBe('kurita');
    // Ноль — тоже ответ: фракция, о которой отряд ничего не знает, в списке есть.
    expect(rows.length).toBeGreaterThan(10);
  });
});

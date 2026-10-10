import { describe, expect, it } from 'vitest';
import {
  FACTIONS,
  FACTION_LIST,
  GALAXY,
  PLAYER_ACTOR_ID,
  WAR,
  WORLD_FOCUSES,
  domainBorder,
  domainCapitalIndex,
  domainTally,
  execute,
  fundOf,
  fundsOf,
  tributeFlows,
  withFund,
  developmentStepMatters,
  frontSectors,
  makeSaveFile,
  makeWarState,
  parseSaveFile,
  snapshot,
  ownerOf,
  shift,
  tributeOf,
  withDelta,
  withStanding,
} from '../src/core/campaign/index.js';
import { MemoryStorage } from '../src/platform/MemoryStorage.js';
import { CampaignUi } from '../src/ui/state/campaign.svelte.js';
import { cbills, hasKey, t, tn } from '../src/ui/i18n/index.js';
import { factionShortName } from '../src/ui/i18n/names.js';
import { getWikiSection } from '../src/wiki/wikiData.js';

/**
 * Экран державы (шаг 72).
 *
 * Главное, что здесь охраняется, — ОДНИ ЦИФРЫ: сумма на кнопке обязана быть
 * той, что спишет команда, а потолок армии — тем, в который она упрётся. Экран
 * берёт их из ядра через стор, и тест ловит день, когда кто-то перепишет
 * формулу в одном месте, а не в другом.
 */

function makeUi(seed = 3): CampaignUi {
  const ui = new CampaignUi(new MemoryStorage());
  ui.newCampaign({ seed, name: 'Hounds', commander: 'Wolf', emblem: 0 });
  return ui;
}

/** Купить мир `i` той же командой, что и игрок: встать в системе, заслужить отношение, принести деньги. */
function buy(ui: CampaignUi, i: number): boolean {
  const state = ui.state;
  const owner = ownerOf(state.deltas, i);
  state.systemId = GALAXY.id(i);
  state.reputation = withStanding(state.reputation, owner, 200);
  state.company = { ...state.company, cbills: state.company.cbills + ui.worldPriceAt(GALAXY.id(i)) };
  return ui.run({ kind: 'buyWorld' });
}

/** Дать роте `count` миров Домов — первые подходящие по каталогу. */
function giveWorlds(ui: CampaignUi, count: number): number[] {
  const got: number[] = [];
  for (let i = 0; i < GALAXY.count && got.length < count; i++) {
    if (GALAXY.hasFlag(i, 'capital')) continue;
    if (FACTIONS.get(ownerOf(ui.state.deltas, i))?.kind !== 'house') continue;
    if (buy(ui, i)) got.push(i);
  }
  expect(got.length).toBe(count);
  return got;
}

/** Прокрутка на `days` суток с отказом на требования соседа (шаг 89): карточка останавливает время, а тест — о другом. */
function runThrough(ui: CampaignUi, days: number): boolean {
  const end = ui.state.day + days;
  for (;;) {
    if (ui.state.war.demands?.pending !== undefined && !ui.run({ kind: 'answerDemand', accept: false })) return false;
    if (ui.state.day >= end) return true;
    if (!ui.run({ kind: 'advanceTo', day: end })) return false;
  }
}

describe('экран державы: вкладка и сводка', () => {
  it('вкладка открывается с первым миром роты, а не раньше', () => {
    const ui = makeUi();
    expect(ui.hasRealm).toBe(false);
    expect(ui.realmPrices).toBeNull();
    giveWorlds(ui, 1);
    expect(ui.hasRealm).toBe(true);
    expect(ui.realmWorlds).toHaveLength(1);
    expect(ui.realmWorlds[0]?.capital).toBe(true);
  });

  it('доход и содержание сводки — те же, что кладёт в кассу такт домена', () => {
    const ui = makeUi();
    giveWorlds(ui, 2);
    const tally = domainTally(ui.state.worldSeed, ui.state.deltas);
    expect(ui.realm.worlds).toBe(2);
    expect(ui.realm.income).toBe(tally.income);
    expect(ui.realm.upkeep).toBe(tally.upkeep);
    expect(ui.realm.net).toBe(tally.income - tally.upkeep + ui.realm.flows);
    const rows = ui.realmWorlds;
    expect(rows.reduce((s, w) => s + w.income, 0)).toBe(tally.income);
  });

  it('держава с первого мира: дипломатия открыта без известности и признания (шаг 72c)', () => {
    const ui = makeUi();
    expect(ui.why({ kind: 'proposePact', factionId: 'davion', pact: 'truce' })).toBe(t('reject.diplomacyLocked'));
    giveWorlds(ui, 1);
    ui.state.reputation = { ...ui.state.reputation, fame: 0, reliability: 0 };
    const reason = ui.why({ kind: 'proposePact', factionId: 'davion', pact: 'truce' });
    expect(reason).not.toBe(t('reject.diplomacyLocked'));
  });

  it('отказ договора называет порог дипломатии, а на войне — войну, а не продажу мира (отладка 2026-10-03)', () => {
    const ui = makeUi();
    giveWorlds(ui, 1);
    const neighbour = domainBorder(ui.state.deltas).find((b) => FACTIONS.get(b.owner)?.kind === 'house')?.owner as string;
    expect(neighbour).toBeDefined();
    ui.state.reputation = withStanding(ui.state.reputation, neighbour, -200);
    expect(ui.why({ kind: 'proposePact', factionId: neighbour, pact: 'trade' })).toBe(t('reject.pactStandingTooLow'));
    ui.state.war = { ...ui.state.war, playerWars: { [neighbour]: { since: ui.state.day, won: 0, lost: 0 } } };
    expect(ui.why({ kind: 'proposePact', factionId: neighbour, pact: 'trade' })).toBe(t('reject.alreadyAtWar'));
  });
});

describe('содержание полевой армии роты (проект державы, шаг 1)', () => {
  it('такт домена списывает армию по domain.armyUpkeep за машину, и сводка показывает ту же сумму', () => {
    const ui = makeUi();
    giveWorlds(ui, 1);
    ui.state.company = { ...ui.state.company, cbills: ui.state.company.cbills + 4 * WAR.economy.mechCost };
    expect(ui.run({ kind: 'raiseRegiment', mechs: 4 })).toBe(true);
    const reserved = 4 * WAR.domain.armyUpkeep;
    expect(ui.realm.army).toBe(reserved);
    const tally = domainTally(ui.state.worldSeed, ui.state.deltas);
    expect(ui.realm.net).toBe(tally.income - tally.upkeep - ui.realm.army + ui.realm.flows);
    const r = execute(ui.state, { kind: 'advance', days: WAR.front.tickDays });
    expect(r.ok).toBe(true);
    const ticked = r.ok ? r.events.find((e) => e.kind === 'domainTicked') : undefined;
    expect(ticked?.kind === 'domainTicked' ? ticked.army : -1).toBe(reserved);
  });

  it('содержание построек сводка вычитает так же, как такт (отладка 2026-10-03)', () => {
    // До правки итог сводки не знал построек и показывал больше, чем ложилось в кассу.
    const ui = makeUi();
    const [i] = giveWorlds(ui, 1);
    const systemId = GALAXY.id(i as number);
    ui.state.deltas = withDelta(ui.state.deltas, systemId, { buildings: ['depot'] });
    expect(ui.realm.buildings).toBe(Math.round(WAR.buildings.kinds.depot.cost * WAR.buildings.upkeepShare));
    expect(ui.run({ kind: 'setWarBudget', share: 0.5 })).toBe(true);
    const shown = ui.realm;
    const tally = domainTally(ui.state.worldSeed, ui.state.deltas);
    expect(shown.net + shown.fund).toBe(tally.income - tally.upkeep - shown.buildings + shown.flows);
    const r = execute(ui.state, { kind: 'advance', days: WAR.front.tickDays });
    expect(r.ok).toBe(true);
    const ticked = r.ok ? r.events.find((e) => e.kind === 'domainTicked') : undefined;
    expect(ticked?.kind === 'domainTicked' ? ticked.buildings : -1).toBe(shown.buildings);
    expect(ticked?.kind === 'domainTicked' ? ticked.fund : -1).toBe(shown.fund);
  });
});

describe('военный бюджет державы (проект державы, шаг 2)', () => {
  it('команда берёт только шаги из данных, ноль снимает поле, доля переживает сохранение', () => {
    const ui = makeUi();
    expect(ui.why({ kind: 'setWarBudget', share: 0.5 })).toBe(t('reject.diplomacyLocked'));
    giveWorlds(ui, 1);
    expect(ui.why({ kind: 'setWarBudget', share: 0.33 })).toBe(t('reject.badWarBudget'));
    expect(ui.run({ kind: 'setWarBudget', share: 0.5 })).toBe(true);
    expect(ui.state.war.realmWarShare).toBe(0.5);
    expect(ui.realmArmy.warShare).toBe(0.5);
    const back = parseSaveFile(JSON.parse(JSON.stringify(makeSaveFile(snapshot(ui.state)))));
    expect(back.war.realmWarShare).toBe(0.5);
    expect(ui.run({ kind: 'setWarBudget', share: 0 })).toBe(true);
    expect('realmWarShare' in ui.state.war).toBe(false);
  });

  it('такт кладёт в фонд ту долю, что показала сводка, а в кассу — остальное', () => {
    const ui = makeUi();
    giveWorlds(ui, 1);
    expect(ui.run({ kind: 'setWarBudget', share: 0.5 })).toBe(true);
    // Пираты — враги державы от рождения (вражда 0.6), поэтому живой враг у фонда есть всегда.
    const shown = ui.realm.fund;
    expect(shown).toBeGreaterThan(0);
    const fundBefore = fundsOf(ui.state.war, PLAYER_ACTOR_ID).reduce((s, r) => s + r.amount, 0);
    const r = execute(ui.state, { kind: 'advance', days: WAR.front.tickDays });
    expect(r.ok).toBe(true);
    const ticked = r.ok ? r.events.find((e) => e.kind === 'domainTicked') : undefined;
    expect(ticked?.kind === 'domainTicked' ? ticked.fund : -1).toBe(shown);
    const fundAfter = fundsOf(ui.state.war, PLAYER_ACTOR_ID).reduce((s, x) => s + x.amount, 0);
    // Фонд вырос на отчисление минус роспуск по бездействию, ушедший обратно в кассу.
    expect(fundAfter).toBeGreaterThan(fundBefore);
    expect(fundAfter).toBeLessThanOrEqual(fundBefore + shown);
  });

  it('распущенный фонд возвращается в кассу, а не пропадает в отражении казны', () => {
    const ui = makeUi();
    giveWorlds(ui, 1);
    ui.state.war = withFund(ui.state.war, PLAYER_ACTOR_ID, 'pirates', 10_000_000);
    const before = ui.state.company.cbills;
    const r = execute(ui.state, { kind: 'advance', days: WAR.front.tickDays });
    expect(r.ok).toBe(true);
    const events = r.ok ? r.events : [];
    const domain = events.find((e) => e.kind === 'domainTicked');
    const net = domain?.kind === 'domainTicked' ? domain.income - domain.upkeep - domain.army - domain.fund : 0;
    const flows = tributeFlows(ui.state.war, ui.state.worldSeed, ui.state.deltas, ui.state.day)[PLAYER_ACTOR_ID] ?? 0;
    let payroll = 0;
    for (const e of events) if (e.kind === 'payrollPaid') payroll += e.amount;
    const released = 10_000_000 - fundOf(ui.state.war, PLAYER_ACTOR_ID, 'pirates');
    expect(released).toBeGreaterThan(0);
    expect(ui.state.company.cbills - before).toBe(net + flows + released - payroll);
  });
});

describe('экран державы: сумма на кнопке равна списанию', () => {
  it('развитие мира', () => {
    const ui = makeUi();
    const [i] = giveWorlds(ui, 1);
    const id = GALAXY.id(i as number);
    const price = ui.realmPrices?.develop ?? -1;
    ui.state.company = { ...ui.state.company, cbills: price + 1 };
    const before = ui.cbills;
    expect(ui.run({ kind: 'developWorld', systemId: id })).toBe(true);
    expect(before - ui.cbills).toBe(price);
    expect(ui.realmWorlds[0]?.development).toBe(1);
    expect(ui.logs[0]?.text).toBe(t('event.worldBuilt', { system: GALAXY.name(i as number), level: 1 }));
  });

  it('ступень, которая прибавила бы одних жителей, не продаётся: денег не списывает', () => {
    const ui = makeUi();
    let capped = -1;
    for (let i = 0; i < GALAXY.count && capped < 0; i++) {
      if (GALAXY.hasFlag(i, 'capital')) continue;
      if (FACTIONS.get(ownerOf(ui.state.deltas, i))?.kind !== 'house') continue;
      if (!developmentStepMatters(ui.state.worldSeed, ui.state.deltas, i)) capped = i;
    }
    expect(capped).toBeGreaterThanOrEqual(0);
    expect(buy(ui, capped)).toBe(true);
    const id = GALAXY.id(capped);
    ui.state.company = { ...ui.state.company, cbills: (ui.realmPrices?.develop ?? 0) + 1 };
    const before = ui.cbills;
    expect(ui.why({ kind: 'developWorld', systemId: id })).toBe(t('reject.developmentNoEffect'));
    expect(ui.run({ kind: 'developWorld', systemId: id })).toBe(false);
    expect(ui.cbills).toBe(before);
    expect(ui.realmWorlds[0]?.development).toBe(0);
  });

  it('смена фокуса: цена, срок и предпросмотр текущего фокуса совпадают со строкой мира', () => {
    const ui = makeUi();
    const [i] = giveWorlds(ui, 1);
    const id = GALAXY.id(i as number);
    const row = ui.realmWorlds[0];
    const current = ui.focusPreview(id).find((p) => p.focus === row?.focus);
    expect(current?.income).toBe(row?.income);
    expect(current?.upkeep).toBe(row?.upkeep);
    expect(current?.capacity).toBe(row?.capacity);

    const other = WORLD_FOCUSES.find((f) => f !== row?.focus);
    const price = ui.realmPrices?.focus ?? -1;
    ui.state.company = { ...ui.state.company, cbills: price };
    expect(ui.run({ kind: 'setWorldFocus', systemId: id, focus: other as (typeof WORLD_FOCUSES)[number] })).toBe(true);
    expect(ui.cbills).toBe(0);
    expect(ui.realmWorlds[0]?.focusTo).toBe(other);
    expect(ui.realmWorlds[0]?.focusUntil).toBe(ui.day + 360);
  });

  it('полевая армия: цена машины, потолок и возврат за роспуск', () => {
    const ui = makeUi();
    giveWorlds(ui, 2);
    const army = ui.realmArmy;
    expect(army.total).toBe(0);
    if (army.cap === 0) {
      // Мощности нет — и команда обязана сказать ровно это.
      expect(ui.why({ kind: 'raiseRegiment', mechs: 1 })).toBe(t('reject.armyMaxed'));
      return;
    }
    const take = Math.min(4, army.cap);
    ui.state.company = { ...ui.state.company, cbills: take * army.mechPrice };
    expect(ui.run({ kind: 'raiseRegiment', mechs: take })).toBe(true);
    expect(ui.cbills).toBe(0);
    expect(ui.realmArmy.total).toBe(take);
    expect(ui.logs[0]?.text).toBe(
      t('event.regimentRaised', { mechs: tn('count.mechsAcc', take), sum: cbills(take * army.mechPrice), army: take }),
    );

    const refund = ui.regimentRefundOf(take);
    expect(ui.run({ kind: 'raiseRegiment', mechs: -take })).toBe(true);
    expect(ui.cbills).toBe(refund);
    expect(ui.realmArmy.total).toBe(0);
  });

  it('выкуп дани со своего мира', () => {
    const ui = makeUi();
    const [i] = giveWorlds(ui, 1);
    const id = GALAXY.id(i as number);
    ui.state.deltas = withDelta(ui.state.deltas, id, { tribute: 'davion', tributeUntil: ui.day + 100 });
    expect(ui.realmWorlds[0]?.tributeTo).toBe('davion');

    const price = ui.tributePriceAt(id);
    ui.state.company = { ...ui.state.company, cbills: price };
    expect(ui.run({ kind: 'buyOffTribute', systemId: id })).toBe(true);
    expect(ui.cbills).toBe(0);
    expect(tributeOf(ui.state.deltas, id, ui.day)).toBeUndefined();
  });

  it('договор с соседом и дань с его мира: соседи и цены из той же границы, что проверяет команда', () => {
    const ui = makeUi();
    giveWorlds(ui, 1);

    const border = domainBorder(ui.state.deltas);
    expect(ui.realmNeighbours.map((n) => n.factionId)).toEqual(border.map((b) => b.owner));

    // Сосед с некапитальным миром на границе — с ним и договоримся, и его обложим.
    const nb = ui.realmNeighbours.find((n) => n.systems.some((s) => !s.capital && s.tributeTo === null));
    expect(nb).toBeDefined();
    const neighbour = nb as NonNullable<typeof nb>;
    ui.state.reputation = withStanding(ui.state.reputation, neighbour.factionId, 200);

    const pactPrice = ui.realmPrices?.pact ?? -1;
    ui.state.company = { ...ui.state.company, cbills: pactPrice };
    expect(ui.run({ kind: 'proposePact', factionId: neighbour.factionId, pact: 'truce' })).toBe(true);
    expect(ui.cbills).toBe(0);
    expect(ui.realmNeighbours.find((n) => n.factionId === neighbour.factionId)?.pact?.kind).toBe('truce');

    const sys = neighbour.systems.find((s) => !s.capital && s.tributeTo === null);
    const price = ui.tributePriceAt(sys?.id as string);
    ui.state.company = { ...ui.state.company, cbills: price };
    expect(ui.run({ kind: 'demandTribute', systemId: sys?.id as string })).toBe(true);
    expect(ui.cbills).toBe(0);
    const after = ui.realmNeighbours.find((n) => n.factionId === neighbour.factionId);
    expect(after?.systems.find((s) => s.id === sys?.id)?.tributeTo).toBe(PLAYER_ACTOR_ID);
    expect(after?.payingUs).toBe(1);
  });
});

describe('звёздная карта: условия пути к миру', () => {
  it('все условия пути выполнены ровно тогда, когда команда проходит', () => {
    const ui = makeUi(2);
    const state = ui.state;
    // Проверка на сотне систем в разных состояниях роты: пустая касса, потом
    // полная касса и доброе отношение со всеми.
    const sample: number[] = [];
    for (let i = 0; i < GALAXY.count && sample.length < 100; i += 17) sample.push(i);
    const check = (): void => {
      for (const i of sample) {
        state.systemId = GALAXY.id(i);
        for (const claim of ui.claimTerms(state.systemId)) {
          const allOk = claim.terms.every((term) => term.ok);
          expect(ui.why(claim.command) === null, `${claim.path} @ ${state.systemId}`).toBe(allOk);
        }
      }
    };
    check();
    state.company = { ...state.company, cbills: 3_000_000_000 };
    for (const f of FACTION_LIST) state.reputation = withStanding(state.reputation, f.id, 200);
    state.reputation = { ...state.reputation, fame: 100 };
    check();
  });

  it('справка «?» у полевой армии ведёт в раздел глоссария', () => {
    const section = getWikiSection('glossary.md', 'полевая армия и гарнизон');
    expect(section?.title.toLowerCase()).toContain('полевая армия и гарнизон');
    expect(section?.html).toContain('Гарнизон мира');
  });

  it('справка «?» на карточке ведёт в существующий раздел статьи', () => {
    const section = getWikiSection('domain.md', '1. Как получить мир');
    expect(section?.title).toBe('1. Как получить мир');
  });
});

describe('словарь державы: ключи, собранные из данных', () => {
  it('у каждого фокуса есть имя и подсказка', () => {
    for (const f of WORLD_FOCUSES) {
      expect(hasKey(`focus.${f}`), f).toBe(true);
      expect(hasKey(`focusHint.${f}`), f).toBe(true);
    }
  });

  it('ступени, вкладки, договоры и ходы дипломатии', () => {
    for (const k of ['overview', 'worlds', 'army', 'diplomacy']) expect(hasKey(`realm.tab.${k}`)).toBe(true);
    for (const k of ['truce', 'trade']) expect(hasKey(`realm.pact.${k}`)).toBe(true);
    for (const k of ['pact', 'pactLapsed']) expect(hasKey(`event.realm.${k}`)).toBe(true);
    for (const move of ['tribute', 'tributeLapsed', 'protectorate', 'protectorateBroken']) {
      for (const side of ['over', 'under']) expect(hasKey(`event.realm.${move}.${side}`), move).toBe(true);
    }
  });

  it('у каждого условия и пути на карте есть подпись', () => {
    const ui = makeUi();
    // Пиратский мир даёт полный набор условий: у захвата есть и вычищенность.
    let pirate = -1;
    for (let i = 0; i < GALAXY.count && pirate < 0; i++) {
      if (ownerOf(ui.state.deltas, i) === 'pirates') pirate = i;
    }
    for (const claim of ui.claimTerms(GALAXY.id(pirate))) {
      expect(hasKey(`starmap.domain.path.${claim.path}`)).toBe(true);
      expect(hasKey(`starmap.domain.pathHint.${claim.path}`)).toBe(true);
      if (claim.price === undefined) expect(hasKey(`starmap.domain.btn.${claim.path}`)).toBe(true);
      for (const term of claim.terms) expect(hasKey(`starmap.domain.term.${term.key}`), term.key).toBe(true);
    }
  });
});

describe('держава, шаг 72a: столица, ступень, карта', () => {
  it('перенос столицы: цена со списанием, один флаг, плечо пересчитано', () => {
    const ui = makeUi();
    const [a, b] = giveWorlds(ui, 2) as [number, number];
    expect(domainCapitalIndex(ui.state.deltas)).toBe(a);
    const idB = GALAXY.id(b);

    const price = ui.realmPrices?.capital ?? -1;
    ui.state.company = { ...ui.state.company, cbills: price };
    expect(ui.run({ kind: 'moveCapital', systemId: idB })).toBe(true);
    expect(ui.cbills).toBe(0);
    expect(domainCapitalIndex(ui.state.deltas)).toBe(b);
    expect(ui.realmWorlds.find((w) => w.capital)?.id).toBe(idB);
    expect(ui.why({ kind: 'moveCapital', systemId: idB })).toBe(t('reject.alreadyCapital'));
    // Сводка по-прежнему равна такту домена: плечо считает та же функция.
    expect(ui.realm.upkeep).toBe(domainTally(ui.state.worldSeed, ui.state.deltas).upkeep);
    expect(ui.logs[0]?.text).toBe(t('event.capitalMoved', { system: GALAXY.name(b), sum: cbills(price) }));

    // Назад — не раньше чем через полгода (шаг 72b); потом запись одна: прежняя снята.
    ui.state.company = { ...ui.state.company, cbills: price };
    expect(ui.why({ kind: 'moveCapital', systemId: GALAXY.id(a) })).toBe(t('reject.capitalMoveCooldown'));
    expect(ui.realmPrices?.capitalReadyDay).toBe(ui.day + WAR.domain.capitalMoveCooldownDays);
    expect(runThrough(ui, WAR.domain.capitalMoveCooldownDays)).toBe(true);
    ui.state.company = { ...ui.state.company, cbills: price };
    expect(ui.run({ kind: 'moveCapital', systemId: GALAXY.id(a) })).toBe(true);
    const flagged = Object.keys(ui.state.deltas).filter((id) => ui.state.deltas[id]?.realmCapitalSince !== undefined);
    expect(flagged).toEqual([GALAXY.id(a)]);
  });

  it('флаг на потерянном мире не действует, а сохранение его переживает', () => {
    const ui = makeUi();
    const [a, b] = giveWorlds(ui, 2) as [number, number];
    ui.state.company = { ...ui.state.company, cbills: ui.realmPrices?.capital ?? 0 };
    expect(ui.run({ kind: 'moveCapital', systemId: GALAXY.id(b) })).toBe(true);

    const back = parseSaveFile(JSON.parse(JSON.stringify(makeSaveFile(snapshot(ui.state)))));
    expect(back.deltas[GALAXY.id(b)]?.realmCapitalSince).toBe(ui.day);

    ui.state.deltas = withDelta(ui.state.deltas, GALAXY.id(b), { owner: 'davion' });
    expect(domainCapitalIndex(ui.state.deltas)).toBe(a);
  });

  it('столица не переезжает сама на мир с меньшим номером, первый перенос — сразу (шаг 76)', () => {
    const ui = makeUi();
    // Первый мир — с конца каталога, второй — с начала: до шага 76 столица
    // уехала бы на второй сама.
    const houseWorlds = [...Array(GALAXY.count).keys()].filter(
      (i) => !GALAXY.hasFlag(i, 'capital') && FACTIONS.get(ownerOf(ui.state.deltas, i))?.kind === 'house',
    );
    const late = houseWorlds.reverse().find((i) => buy(ui, i)) as number;
    expect(domainCapitalIndex(ui.state.deltas)).toBe(late);
    expect(ui.state.deltas[GALAXY.id(late)]?.realmCapital).toBe(true);
    // Основание державы — не перенос: отсчёта нет, первый перенос разрешён сразу.
    expect(ui.realmPrices?.capitalReadyDay).toBeNull();

    const early = houseWorlds.reverse().find((i) => i < late && buy(ui, i)) as number;
    expect(early).toBeLessThan(late);
    expect(domainCapitalIndex(ui.state.deltas)).toBe(late);

    ui.state.company = { ...ui.state.company, cbills: ui.realmPrices?.capital ?? 0 };
    expect(ui.run({ kind: 'moveCapital', systemId: GALAXY.id(early) })).toBe(true);
    expect(ui.realmPrices?.capitalReadyDay).toBe(ui.day + WAR.domain.capitalMoveCooldownDays);
  });

  it('потерянная столица переходит к первому миру по каталогу, отсчёт переноса не сбрасывается', () => {
    const ui = makeUi();
    const [a, b, c] = giveWorlds(ui, 3) as [number, number, number];
    ui.state.company = { ...ui.state.company, cbills: ui.realmPrices?.capital ?? 0 };
    expect(ui.run({ kind: 'moveCapital', systemId: GALAXY.id(c) })).toBe(true);
    const ready = ui.realmPrices?.capitalReadyDay;
    ui.run({ kind: 'advance', days: 10 });

    expect(ui.run({ kind: 'abandonWorld', systemId: GALAXY.id(c) })).toBe(true);
    expect(domainCapitalIndex(ui.state.deltas)).toBe(a);
    expect(ui.state.deltas[GALAXY.id(a)]?.realmCapital).toBe(true);
    expect(ui.realmPrices?.capitalReadyDay).toBe(ready);
    expect(ownerOf(ui.state.deltas, b)).toBe(PLAYER_ACTOR_ID);
  });

  it('сохранение до шага 76: столица без метки закрепляется той, что игрок видел', () => {
    const ui = makeUi();
    const [a, b] = giveWorlds(ui, 2) as [number, number];
    // Снимаем метку — так выглядит держава из сохранения шагов 72–75 без переноса.
    ui.state.deltas = withDelta(ui.state.deltas, GALAXY.id(a), { realmCapital: undefined });
    expect(domainCapitalIndex(ui.state.deltas)).toBe(a);
    ui.state.deltas = withDelta(ui.state.deltas, GALAXY.id(b), { owner: undefined });
    ui.state.deltas = withDelta(ui.state.deltas, GALAXY.id(a), { owner: undefined });
    // Держава из одного мира b; мир с меньшим номером a берётся заново.
    ui.state.deltas = withDelta(ui.state.deltas, GALAXY.id(b), { owner: PLAYER_ACTOR_ID });
    expect(buy(ui, a)).toBe(true);
    expect(domainCapitalIndex(ui.state.deltas)).toBe(b);
  });

  it('первый мир основывает державу — строкой-предупреждением, второй — уже нет', () => {
    const ui = makeUi();
    giveWorlds(ui, 1);
    const founded = ui.logs.filter((l) => l.text === t('event.realmFounded'));
    expect(founded).toHaveLength(1);
    expect(founded[0]?.kind).toBe('warn');
    giveWorlds(ui, 1);
    expect(ui.logs.filter((l) => l.text === t('event.realmFounded'))).toHaveLength(1);
  });

  it('слой державы: свои, столица и граница', () => {
    const ui = makeUi();
    expect(ui.realmMap.size).toBe(0);
    const [a, b] = giveWorlds(ui, 2) as [number, number];
    const map = ui.realmMap;
    expect(map.get(a)).toBe('capital');
    expect(map.get(b)).toBe('own');
    for (const nb of domainBorder(ui.state.deltas)) {
      for (const j of nb.systems) expect(['border', 'tributary', 'vassal']).toContain(map.get(j));
    }
  });

  it('«на карте»: выбор, одноразовая просьба и переход на карту', () => {
    const ui = makeUi();
    const [a] = giveWorlds(ui, 1) as [number];
    ui.showOnMap(GALAXY.id(a));
    expect(ui.screen).toBe('starmap');
    expect(ui.selectedSystemId).toBe(GALAXY.id(a));
    expect(ui.mapRequest).toBe(GALAXY.id(a));
  });

  it('словарь: ступени журнала и легенда слоя', () => {
    for (const k of ['realmFounded', 'realmFallen']) expect(hasKey(`event.${k}`), k).toBe(true);
    for (const k of ['capital', 'own', 'tributary', 'vassal', 'border']) {
      expect(hasKey(`starmap.legendRealm.${k}`), k).toBe(true);
    }
  });
});

/** Два соседних мира одного Дома, оба не столицы — первые по каталогу, купленные ротой. */
function adjacentPair(ui: CampaignUi): [number, number] {
  for (let i = 0; i < GALAXY.count; i++) {
    if (GALAXY.hasFlag(i, 'capital')) continue;
    const owner = ownerOf(ui.state.deltas, i);
    if (FACTIONS.get(owner)?.kind !== 'house') continue;
    for (const j of GALAXY.neighbors(i)) {
      if (GALAXY.hasFlag(j, 'capital') || ownerOf(ui.state.deltas, j) !== owner) continue;
      if (buy(ui, i) && buy(ui, j)) return [i, j];
    }
  }
  throw new Error('нет пары соседних миров одного Дома');
}

describe('держава, шаг 75: отказ от мира вместо продажи', () => {
  it('мир возвращается владельцу по канону без денег, экономика сходится с полным пересчётом', () => {
    const ui = makeUi();
    const [a] = giveWorlds(ui, 2) as [number, number];
    const id = GALAXY.id(a);
    const to = GALAXY.ownerId(a);

    const before = ui.cbills;
    expect(ui.run({ kind: 'abandonWorld', systemId: id })).toBe(true);
    expect(ui.cbills).toBe(before);
    expect(ownerOf(ui.state.deltas, a)).toBe(to);
    expect(ui.state.deltas[id]?.owner).toBeUndefined();
    expect(ui.state.deltas[id]?.abandonedUntil).toBe(ui.state.day + WAR.domain.abandonHoldDays);

    const full = makeWarState(ui.state.worldSeed, ui.state.deltas).economy[to];
    const live = ui.state.war.economy[to];
    expect(live?.income).toBe(full?.income);
    expect(live?.upkeep).toBe(full?.upkeep);
    expect(live?.capacity).toBe(full?.capacity);
    expect(live?.worlds).toBe(full?.worlds);
    expect(ui.logs[0]?.text).toBe(
      t('event.worldAbandoned', { system: GALAXY.name(a), faction: factionShortName(to, to) }),
    );
  });

  it('армия роты не наступает на брошенный мир до срока, после срока — снова может', () => {
    // Баг шага 72e: полки роты на театре против нового хозяина отбивали
    // проданный мир обратно. Участок «рота → брошенный мир» не заводится вовсе.
    const ui = makeUi();
    const [a, b] = adjacentPair(ui);
    const to = GALAXY.ownerId(a);
    // Живая вражда выше порога фронта — иначе участка не было бы и без пометки.
    ui.state.reputation = shift(ui.state.reputation, PLAYER_ACTOR_ID, to, -2);
    expect(ui.run({ kind: 'abandonWorld', systemId: GALAXY.id(a) })).toBe(true);
    expect(ownerOf(ui.state.deltas, b)).toBe(PLAYER_ACTOR_ID);

    const ours = (day: number) =>
      frontSectors(ui.state.war, ui.state.reputation, ui.state.deltas, day).filter(
        (s) => s.system === a && s.attacker === PLAYER_ACTOR_ID,
      );
    const until = ui.state.deltas[GALAXY.id(a)]!.abandonedUntil!;
    expect(ours(ui.state.day)).toHaveLength(0);
    expect(ours(until - 1)).toHaveLength(0);
    expect(ours(until)).toHaveLength(1);
    // Защищён только брошенный мир и только от роты: хозяин на мир роты наступать может.
    expect(
      frontSectors(ui.state.war, ui.state.reputation, ui.state.deltas, ui.state.day).some(
        (s) => s.system === b && s.attacker === to,
      ),
    ).toBe(true);
  });

  it('вернуть брошенный мир можно командой, и пометка при этом снимается', () => {
    const ui = makeUi();
    const [a] = giveWorlds(ui, 2) as [number, number];
    expect(ui.run({ kind: 'abandonWorld', systemId: GALAXY.id(a) })).toBe(true);
    expect(buy(ui, a)).toBe(true);
    expect(ownerOf(ui.state.deltas, a)).toBe(PLAYER_ACTOR_ID);
    expect(ui.state.deltas[GALAXY.id(a)]?.abandonedUntil).toBeUndefined();
  });

  it('последний мир с армией не отдаётся; без армии — держава кончается', () => {
    const ui = makeUi();
    const [a] = giveWorlds(ui, 1) as [number];
    const id = GALAXY.id(a);
    if (ui.realmArmy.cap > 0) {
      ui.state.company = { ...ui.state.company, cbills: ui.realmArmy.mechPrice };
      expect(ui.run({ kind: 'raiseRegiment', mechs: 1 })).toBe(true);
      expect(ui.why({ kind: 'abandonWorld', systemId: id })).toBe(t('reject.armyStillRaised'));
      expect(ui.run({ kind: 'raiseRegiment', mechs: -1 })).toBe(true);
    }
    expect(ui.run({ kind: 'abandonWorld', systemId: id })).toBe(true);
    expect(ui.hasRealm).toBe(false);
    expect(ui.logs.some((l) => l.text === t('event.realmFallen') && l.kind === 'warn')).toBe(true);
    // И сразу можно основать державу заново — тем же путём.
    expect(giveWorlds(ui, 1)).toHaveLength(1);
  });
});

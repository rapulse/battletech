import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  CAMPAIGN_RULES_VERSION,
  CampaignState,
  FACTIONS,
  FACTION_LIST,
  GALAXY,
  WAR,
  NO_REPUTATION,
  economyOf,
  economyTick,
  execute,
  externalIncome,
  fundOf,
  fundsOf,
  hashCampaignState,
  makeSaveFile,
  makeWarState,
  tributeFlows,
  meanWealthPerWorld,
  nextEconomyTickDay,
  parseSaveFile,
  prosperityBand,
  prosperityOf,
  ruinShareOf,
  developmentOf,
  developmentTick,
  developmentShareOf,
  planList,
  planOf,
  planTick,
  planWeight,
  notePlanCapture,
  withPlan,
  withEconomy,
  worldProfile,
  warBand,
  restore,
  snapshot,
  systemIncome,
  systemProfile,
  systemUpkeep,
  wealthOf,
  withDelta,
  withFund,
  withCompanyEffort,
  dayOf,
  frontSectors,
  frontTick,
  frontWeights,
  initialRelation,
  ownerOf,
  relationOf,
  sectorForces,
  frontShares,
  tensionOf,
  truceHolds,
  type FrontSector,
  type GalaxyDeltas,
  type WarState,
  NO_DELTAS,
  PLAYER_ACTOR_ID,
  armyReadiness,
  armyReference,
  armyTarget,
  realmArmyCap,
  CampaignRejectReason,
  domainTally,
  domainWorlds,
  frontierIndexAt,
  clearedOf,
  withPirateClearing,
  focusOf,
  makeCompany,
  systemCapacity,
  worldContributionAt,
  withStanding,
  standingOf,
  boundByProtectorate,
  actorWorlds,
  canSubmit,
  diplomacyTick,
  imposeTribute,
  liveEnemiesOf,
  liveEnmity,
  pactHolds,
  pactOf,
  prefersTribute,
  tributePull,
  relationBand,
  releaseIdleFunds,
  signPact,
  suzerainOf,
  tributeOf,
  vassalsOf,
  withPact,
  withVassal,
  withRelation,
  enmity,
  type CampaignCommand,
  type WorldFocus,
  capitalJumps,
  logisticsTick,
  militiaBacked,
  systemLift,
  theaterJumps,
  theaterOf,
  theaterReadiness,
  theatersOf,
  totalArmy,
  warActors,
  withTheater,
  withTheaterLoss,
  syncDomainEconomy,
  memoryOf,
  withWorldMemory,
} from '../src/core/campaign/index.js';
import { Rng } from '../src/core/rng/index.js';
import { CONTRACTS } from '../src/core/campaign/contracts/schema.js';
import {
  contractBoard,
  heatedEnmity,
  missionsAt,
  opforTypeOf,
  supplyCount,
  supplyLevel,
  supplyOutfit,
  supplyThreat,
} from '../src/core/campaign/contracts/index.js';
import { FULL_OUTFIT as FULL, type OutfitSpec } from '../src/core/campaign/mech/outfit.js';
import { GALAXY_RULES } from '../src/core/campaign/galaxy/catalog.js';

/**
 * Экономика фракций (шаг 21a).
 *
 * Проверяется не «числа сошлись», а решения, ради которых шаг делался: достаток
 * меряется НА МИР, мир вносит по качеству, внетерриториальный доход спасает
 * однопланетные фракции, фонд по направлениям НАПРАВЛЕН, а разрежённость не
 * протекает.
 */

const START = new CampaignState(1);

/** Комплектность ополчения — база, на которой видно обе стороны поправки. */
const MILITIA: OutfitSpec = CONTRACTS.opfor.types.militia.outfit;

/**
 * Прогнать проверку при другой силе связи.
 *
 * Ручка живёт в данных, разобранных один раз при загрузке модуля, поэтому тест
 * подменяет её на месте и возвращает обратно. Иначе половину проверок пришлось
 * бы переписывать при каждой перекалибровке — а перекалибровка ручки и есть то,
 * ради чего она вынесена в данные.
 */
function withLink(link: number, body: () => void): void {
  const table = CONTRACTS.opfor.supply as { link: number };
  const was = table.link;
  table.link = link;
  try {
    body();
  } finally {
    table.link = was;
  }
}

describe('экономика фракций: начальное состояние', () => {
  it('экономика есть у каждого актора реестра, и карта плотная', () => {
    // Плотность здесь осознанная (в отличие от репутации и дельт): «отличается
    // от начального» для экономики не определено — начальное выводится из карты.
    for (const f of FACTION_LIST) {
      expect(Object.keys(START.war.economy)).toContain(f.id);
    }
    expect(Object.keys(START.war.economy)).toHaveLength(FACTION_LIST.length);
  });

  it('все две тысячи миров разошлись по владельцам без потерь', () => {
    let worlds = 0;
    for (const f of FACTION_LIST) worlds += economyOf(START.war, f.id).worlds;
    expect(worlds).toBe(GALAXY.count);
  });

  it('военный фонд на старте пуст: копить ещё не с чего', () => {
    expect(START.war.funds).toEqual({});
  });

  it('казна на старте — доход за несколько тактов, а не ноль', () => {
    // С нулевой казны все двадцать фракций были бы одинаково бедны в первый
    // день, и видимая отдача шага (чем снаряжена часть) появилась бы только
    // через несколько лет игры.
    const davion = economyOf(START.war, 'davion');
    expect(davion.treasury).toBe(Math.round(davion.income * WAR.economy.treasuryStartTicks));
    expect(davion.treasury).toBeGreaterThan(0);
  });
});

describe('достаток на мир', () => {
  it('меряется НА МИР, а не абсолютной казной', () => {
    // Дэвион держит втрое больше миров, чем Ляо, и абсолютно богаче втрое.
    // Достаток при этом у них сопоставим — иначе Ляо был бы обречён выставлять
    // худшее просто за свой размер, и это не менялось бы за всю кампанию.
    const davion = economyOf(START.war, 'davion');
    const liao = economyOf(START.war, 'liao');
    expect(davion.worlds).toBeGreaterThan(liao.worlds * 2);
    expect(davion.treasury).toBeGreaterThan(liao.treasury * 2);

    const pDavion = prosperityOf(START.war, 'davion');
    const pLiao = prosperityOf(START.war, 'liao');
    expect(Math.abs(pDavion - pLiao)).toBeLessThan(0.2);
    // И ни один из них не упёрся в край полосы: равенство, полученное зажимом,
    // ничего не доказывало бы про меру — абсолютная казна дала бы ровно его.
    for (const p of [pDavion, pLiao]) {
      expect(p).toBeGreaterThan(WAR.prosperity.min);
      expect(p).toBeLessThan(WAR.prosperity.max);
    }
  });

  it('середина Сферы равна единице, и её задают Дома, а не мелкие акторы', () => {
    // Средневзвешенный, а не среднее по двадцати: иначе Волчьи Драгуны с одним
    // миром весили бы столько же, сколько Дэвион с тремя сотнями.
    const houses = FACTION_LIST.filter((f) => f.kind === 'house').map((f) => prosperityOf(START.war, f.id));
    for (const p of houses) expect(Math.abs(p - 1)).toBeLessThan(0.15);
    expect(meanWealthPerWorld(START.war)).toBeGreaterThan(0);
  });

  it('однопланетные фракции упираются в полосу, а не ломают шкалу', () => {
    // КомСтар и Драгуны владеют одним миром каждый: их внетерриториальный доход,
    // делённый на единицу, дал бы достаток в десятки раз выше любого Дома.
    for (const id of ['comstar', 'dragoons']) {
      expect(economyOf(START.war, id).worlds).toBe(1);
      expect(prosperityOf(START.war, id)).toBe(WAR.prosperity.max);
    }
  });

  it('НИ НА ОДНОМ сиде при старте фракция не читается как разорённая', () => {
    // «Разорена» обязана означать войну, а не то, что фракция мельче средней.
    // Разорение — событие 21b, и до него нижней ступени быть не должно.
    //
    // Проверяется ПО МНОГИМ СИДАМ, и это не перестраховка: первая редакция
    // проверки смотрела один сид, прошла, и слово «Разорена» всё равно вылезло
    // на экране отношений в первый день кампании. Замер на двухстах сидах
    // объяснил почему — независимые миры попадали в ступень на 69 из них.
    for (let seed = 1; seed <= 60; seed++) {
      const war = new CampaignState(seed).war;
      for (const f of FACTION_LIST) {
        const band = prosperityBand(prosperityOf(war, f.id));
        expect(band, `${f.id} на сиде ${seed}`).not.toBe('ruined');
      }
    }
  });
});

describe('мир вносит по своему качеству', () => {
  const profile = systemProfile(START.worldSeed, 'new-avalon');

  it('доход растёт с промышленностью, а не с фактом владения', () => {
    const poor = { ...profile, industryCivil: 1, industryMilitary: 1 };
    const rich = { ...profile, industryCivil: 9, industryMilitary: 9 };
    expect(systemIncome(rich, false)).toBeGreaterThan(systemIncome(poor, false) * 3);
  });

  it('гражданская промышленность весит заметно больше военной', () => {
    // Военпром в galaxy/profile.ts растёт от близости к чужой границе, а мелкое
    // государство приграничное ЦЕЛИКОМ. При равных весах Марианская Гегемония
    // (40 миров) выходила богаче на мир, чем Федеративные Солнца (396).
    const civil = { ...profile, industryCivil: 8, industryMilitary: 0 };
    const military = { ...profile, industryCivil: 0, industryMilitary: 8 };
    expect(systemIncome(civil, false)).toBeGreaterThan(systemIncome(military, false) * 2);
  });

  it('разорение бьёт по доходу и НЕ трогает содержание', () => {
    // Половина того, чем разорение страшно фракции: держать разорённый мир
    // стоит ровно столько же, сколько целый.
    expect(systemIncome(profile, false, 0.5)).toBeCloseTo(systemIncome(profile, false) * 0.5, 6);
    expect(systemIncome(profile, false, 1)).toBe(0);
    expect(systemUpkeep(profile)).toBe(systemUpkeep(profile));
    expect(systemUpkeep(profile)).toBeGreaterThan(0);
  });

  it('столица приносит больше рядового мира тех же чисел', () => {
    expect(systemIncome(profile, true)).toBeGreaterThan(systemIncome(profile, false));
  });
});

describe('внетерриториальный доход', () => {
  it('спасает однопланетные фракции от нищеты по территории', () => {
    // Без этого поля гвардия КомСтара на Терре выходила бы на восстановленном
    // хламе, а лучший наёмный полк Сферы оказался бы беднее пиратов.
    expect(externalIncome('comstar')).toBeGreaterThan(0);
    expect(externalIncome('dragoons')).toBeGreaterThan(0);
    expect(economyOf(START.war, 'comstar').income).toBeGreaterThan(externalIncome('comstar'));
  });

  it('у кого поля нет, тот живёт только со своих миров', () => {
    expect(externalIncome('davion')).toBe(0);
    expect(FACTIONS.get('davion')?.income).toBeUndefined();
  });
});

describe('военный фонд по направлениям', () => {
  it('направление НАПРАВЛЕНО: копить против — не то же, что пара', () => {
    // Вражда и отношения описывают пару целиком («Курита и Дэвион враждуют»),
    // а фонд — намерение одной стороны. Спутать их значило бы читать половину
    // накопленного мимо записанного.
    const war = withFund(START.war, 'davion', 'kurita', 500);
    expect(fundOf(war, 'davion', 'kurita')).toBe(500);
    expect(fundOf(war, 'kurita', 'davion')).toBe(0);
  });

  it('фракция не копит против самой себя', () => {
    expect(withFund(START.war, 'davion', 'davion', 900)).toBe(START.war);
  });

  it('разрежённость не протекает: обнулённое направление исчезает', () => {
    let war = withFund(START.war, 'davion', 'kurita', 500);
    war = withFund(war, 'davion', 'liao', 300);
    expect(Object.keys(war.funds['davion'] ?? {})).toHaveLength(2);

    war = withFund(war, 'davion', 'kurita', 0);
    expect(Object.keys(war.funds['davion'] ?? {})).toEqual(['liao']);

    war = withFund(war, 'davion', 'liao', 0);
    expect(war.funds['davion']).toBeUndefined();
  });

  it('достаток считает казну и фонд вместе', () => {
    // Деньги, отложенные на войну, снаряжают части не хуже денег в казне: без
    // этого слагаемого исправно копящая фракция читалась бы как беднеющая.
    const before = wealthOf(START.war, 'davion');
    const war = withFund(START.war, 'davion', 'kurita', 1_000_000);
    expect(wealthOf(war, 'davion')).toBe(before + 1_000_000);
  });
});

describe('такт экономики', () => {
  it('избыток расходится между казной и фондом без потери на округлении', () => {
    const before = economyOf(START.war, 'davion');
    const after = economyTick(START.war, NO_REPUTATION);
    let fund = 0;
    for (const row of fundsOf(after, 'davion')) fund += row.amount;
    // С шага 22c избыток платит ещё и содержание АРМИИ, а казна докупает
    // машины: равенство поэтому считается по всем трём статьям, а не по двум.
    // Оно и есть проверка, что круг «доход → фонд → армия» ничего не теряет по
    // дороге, — иначе расхождение копилось бы по нескольку C-Bills за такт и
    // всплыло бы в хэше через полсотни декад.
    const surplus = before.income - before.upkeep - before.army * WAR.economy.armyUpkeep;
    expect(surplus).toBeGreaterThan(0);
    const bought = economyOf(after, 'davion').army - before.army;
    const spentOnMechs = bought * WAR.economy.mechCost;
    expect(economyOf(after, 'davion').treasury + fund + spentOnMechs).toBe(before.treasury + surplus);
  });

  it('фонд расходится по врагам, а не по всем подряд', () => {
    const after = economyTick(START.war, NO_REPUTATION);
    const rows = fundsOf(after, 'davion');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(FACTION_LIST.length - 1);
    // Против Куриты (вражда 0.95) откладывается больше, чем против дальней
    // периферии: фонд взвешен враждой, а не роздан поровну.
    expect(rows[0]?.against).toBeDefined();
    expect(fundOf(after, 'davion', 'kurita')).toBeGreaterThan(0);
    expect(fundOf(after, 'davion', 'comstar')).toBe(0);
  });

  it('ни одного броска: при равном состоянии такт даёт равный результат', () => {
    // Тикер — весовые правила, а не ИИ и не случайность (ai.md §3).
    expect(economyTick(START.war, NO_REPUTATION)).toEqual(economyTick(START.war, NO_REPUTATION));
  });

  it('нехватка гасится фондом раньше казны, и обе упираются в ноль', () => {
    let war = withFund(START.war, 'davion', 'kurita', 1_000_000);
    const eco = economyOf(war, 'davion');
    // Содержание выкручено выше дохода: фракция живёт в долг. Армия обнулена —
    // проверка про порядок гашения долга, а не про закупку машин, и своё
    // содержание армия здесь только зашумила бы.
    war = {
      ...war,
      economy: {
        ...war.economy,
        davion: { ...eco, treasury: 100, army: 0, worlds: 0, upkeep: eco.income + 600_000 },
      },
    };
    const after = economyTick(war, NO_REPUTATION);
    expect(fundOf(after, 'davion', 'kurita')).toBe(400_000);
    expect(economyOf(after, 'davion').treasury).toBe(100);

    const broke = economyTick(economyTick(after, NO_REPUTATION), NO_REPUTATION);
    expect(economyOf(broke, 'davion').treasury).toBe(0);
    expect(fundOf(broke, 'davion', 'kurita')).toBe(0);
  });
});

describe('такт в очереди суток', () => {
  it('выровнен по границе декады, а не отсчитан от дня основания', () => {
    // Биржа читает экономику, а состав предложений внутри декады обязан быть
    // неизменным: такт посреди декады менял бы биржу при неизменном её сиде.
    const step = WAR.economy.tickDays;
    expect(nextEconomyTickDay(0)).toBe(step);
    expect(nextEconomyTickDay(1)).toBe(step);
    expect(nextEconomyTickDay(step)).toBe(step * 2);
    expect(nextEconomyTickDay(step * 3 - 1)).toBe(step * 3);
  });

  it('сам себя переставляет и двигает экономику мира', () => {
    const state = new CampaignState(7);
    const before = economyOf(state.war, 'kurita').treasury;

    const result = execute(state, { kind: 'advance', days: WAR.economy.tickDays });
    if (!result.ok) throw new Error('прокрутка отклонена');

    expect(economyOf(state.war, 'kurita').treasury).toBeGreaterThan(before);
    expect(result.events.some((e) => e.kind === 'factionEconomyTicked')).toBe(true);
    expect(state.queue.some((e) => e.task.kind === 'economyTick')).toBe(true);
  });
});

describe('экономика в снимке и хэше', () => {
  it('переживает круговой прогон через файл сохранения', () => {
    const state = new CampaignState(3);
    state.war = withFund(state.war, 'kurita', 'davion', 777_000);

    const back = restore(parseSaveFile(JSON.parse(JSON.stringify(makeSaveFile(snapshot(state))))));
    expect(back.war).toEqual(state.war);
    expect(hashCampaignState(back)).toBe(hashCampaignState(state));
  });

  it('правка фонда меняет хэш: экономика — состояние, а не украшение снимка', () => {
    const state = new CampaignState(3);
    const before = hashCampaignState(state);
    state.war = withFund(state.war, 'kurita', 'davion', 1);
    expect(hashCampaignState(state)).not.toBe(before);
  });

  it('версия правил поднята шагом 21a', () => {
    expect(CAMPAIGN_RULES_VERSION).toBeGreaterThanOrEqual(9);
  });
});

describe('ловушка суммы: приращение против пересчёта', () => {
  it('смена владельца переносит и доход, и содержание, и мир', () => {
    // Профиль не хранится, поэтому суммировать две тысячи профилей на каждом
    // такте нельзя — суммы правятся приращением. Здесь проверяется, что полный
    // пересчёт по тем же дельтам даёт ровно те же числа, то есть приращению
    // 21b будет с чем сойтись.
    const id = GALAXY.id(0);
    const wasOwner = GALAXY.ownerId(0);
    const newOwner = wasOwner === 'kurita' ? 'davion' : 'kurita';

    const deltas = withDelta(NO_DELTAS, id, { owner: newOwner });
    const before = makeWarState(START.worldSeed, NO_DELTAS);
    const after = makeWarState(START.worldSeed, deltas);

    expect(economyOf(after, newOwner).worlds).toBe(economyOf(before, newOwner).worlds + 1);
    expect(economyOf(after, wasOwner).worlds).toBe(economyOf(before, wasOwner).worlds - 1);

    const profile = systemProfile(START.worldSeed, 0);
    const income = Math.round(systemIncome(profile, GALAXY.hasFlag(0, 'capital')));
    expect(economyOf(after, newOwner).income - economyOf(before, newOwner).income).toBeCloseTo(income, -1);
  });

  it('разорение снимает доход, но мир остаётся за владельцем', () => {
    const id = GALAXY.id(0);
    const owner = GALAXY.ownerId(0);
    const deltas = withDelta(NO_DELTAS, id, { ruined: 1 });
    const before = makeWarState(START.worldSeed, NO_DELTAS);
    const after = makeWarState(START.worldSeed, deltas);

    expect(economyOf(after, owner).worlds).toBe(economyOf(before, owner).worlds);
    expect(economyOf(after, owner).income).toBeLessThan(economyOf(before, owner).income);
    expect(economyOf(after, owner).upkeep).toBe(economyOf(before, owner).upkeep);
  });
});

describe('снабжение части: экономика выходит в бой (часть C)', () => {
  const profile = systemProfile(START.worldSeed, 'new-avalon');
  const mid = CONTRACTS.opfor.supply.mid;

  it('link = 0 возвращает поведение до 21a ТОЧНО', () => {
    // Ручка множит ПОПРАВКУ, а не результат: это и делает её честной ручкой.
    // Проверяется на снабжении, далёком от центра, — на самом центре совпало бы
    // и у сломанной формулы.
    const far = 0.5;
    withLink(0, () => {
      expect(opforTypeOf('davion', 0, far)).toBe(opforTypeOf('davion', 0, mid));
      expect(supplyOutfit(MILITIA, far)).toEqual(supplyOutfit(MILITIA, mid));
      expect(supplyCount(far)).toBe(1);
      expect(supplyThreat(far)).toBe(1);
    });
  });

  it('в центре поправки равны нулю тождественно', () => {
    expect(supplyCount(mid)).toBe(1);
    expect(supplyThreat(mid)).toBe(1);
    expect(supplyOutfit(MILITIA, mid)).toEqual({
      armorShare: MILITIA.armorShare,
      missingItems: MILITIA.missingItems,
    });
  });

  it('лестница militia → line → guard есть только у тех, у кого она есть', () => {
    // Разбогатевшая пиратская вольница не заводит гвардейский полк, а клан не
    // теряет Звезду от пустой казны. Экономика двигает часть ПО лестнице, а не
    // выдаёт лестницу тому, у кого её нет.
    for (const rich of [0.5, 1.0, 1.6]) {
      expect(opforTypeOf('pirates', 5, rich)).toBe('militia');
      expect(opforTypeOf('taurian', 5, rich)).toBe('militia');
      expect(opforTypeOf('jade_falcon', 0, rich)).toBe('clan');
    }
  });

  it('богатый Дом ставит гвардию при меньшем гарнизоне, чем бедный', () => {
    const guardFrom = CONTRACTS.opfor.guardFrom;
    withLink(1, () => {
      expect(opforTypeOf('davion', guardFrom - 1, 1.6)).toBe('guard');
      expect(opforTypeOf('davion', guardFrom - 1, mid)).toBe('line');
    });
  });

  it('разорение доводит Дом до ополчения, обычная бедность — нет', () => {
    // Обещание плана: «разорённая фракция выставляет ополчение на
    // восстановленном хламе». Но ступень не должна протекать: Дом чуть беднее
    // среднего обязан остаться линией, иначе замер ловит смягчение биржи там,
    // где никакой войны не было.
    withLink(1, () => {
      expect(opforTypeOf('liao', 0, mid - 0.05)).toBe('line');
      expect(opforTypeOf('liao', 0, 0.5)).toBe('militia');
    });
  });

  it('бедные берут числом, богатые качеством', () => {
    // Сто слабых миров дают не силу, а распыление; одна плотная промышленная
    // планета — меньше машин, но гвардейских.
    withLink(1, () => {
      expect(supplyCount(0.6)).toBeGreaterThan(1);
      expect(supplyCount(1.5)).toBeLessThan(1);
      expect(supplyThreat(0.6)).toBeLessThan(1);
      expect(supplyThreat(1.5)).toBeGreaterThan(1);
    });
  });

  it('количество и качество идут навстречу друг другу', () => {
    // Произведение «сколько машин × насколько они злы» держится куда ровнее,
    // чем каждый множитель по отдельности. Ровно это и лишает выбирающего
    // контракты бесплатного выигрыша от разброса.
    withLink(1, () => {
      const spread = [0.6, 0.8, 1.0, 1.2, 1.5].map((s) => supplyCount(s) * supplyThreat(s));
      const worst = Math.max(...spread) / Math.min(...spread);
      const alone = supplyThreat(1.5) / supplyThreat(0.6);
      expect(worst).toBeLessThan(alone);
    });
  });

  it('комплектность: бедные теряют броню, полный комплект остаётся потолком', () => {
    withLink(1, () => {
      const poor = supplyOutfit(MILITIA, 0.6);
      const rich = supplyOutfit(MILITIA, 1.5);
      expect(poor.armorShare[1]).toBeLessThan(MILITIA.armorShare[1]);
      expect(rich.armorShare[1]).toBeGreaterThan(MILITIA.armorShare[1]);
      // «Лучше паспорта» не бывает: богатство даёт полный комплект, а не сверхполный.
      expect(supplyOutfit(FULL, 1.6).armorShare).toEqual([1, 1]);
      expect(supplyOutfit(FULL, 1.6).missingItems).toEqual([0, 0]);
    });
  });

  it('снабжение растёт с достатком фракции и падает от разорения', () => {
    const rich = supplyLevel(START.war, 'comstar', profile);
    const poor = supplyLevel(START.war, 'independent', profile);
    expect(rich).toBeGreaterThan(poor);
    expect(supplyLevel(START.war, 'davion', profile, 1)).toBeLessThan(
      supplyLevel(START.war, 'davion', profile, 0),
    );
  });

  it('свои заводы снаряжают свой гарнизон', () => {
    const arsenal = supplyLevel(START.war, 'davion', { ...profile, industryMilitary: 10 });
    const bare = supplyLevel(START.war, 'davion', { ...profile, industryMilitary: 0 });
    expect(arsenal).toBeGreaterThan(bare);
  });

  it('снабжение подписано вместе с контрактом и переживает снимок', () => {
    // Предложение — это обещание: состав, собранный на вылете, обязан отвечать
    // тому, что игроку показали, даже если экономика за декаду уехала.
    // Галатея, а не стартовый Аутрич: с шага 37 биржа Аутрича пуста (гарнизон
    // Драгун 4.0 из 5, класс «столица», фронта рядом нет), а этому тесту нужна
    // система, где работа есть.
    const state = new CampaignState(5, { systemId: 'galatea' });
    const offers = contractBoard(
      state.worldSeed,
      state.deltas,
      state.systemId,
      state.day,
      state.reputation,
      state.war,
    );
    expect(offers.length).toBeGreaterThan(0);
    for (const c of offers) expect(c.supply).toBeGreaterThan(0);
  });

  it('оценка сил до боя знает о снабжении', () => {
    // «Разойдись они, и сложность, читаемая до боя, перестала бы совпадать с
    // боем» (threat.ts). Замер поймал это как смягчение кампании при любой
    // калибровке центра.
    withLink(1, () => {
      expect(supplyThreat(1.5)).not.toBe(supplyThreat(0.6));
    });
  });
});

/**
 * Фронт (шаг 21b).
 *
 * Проверяются решения, а не числа: перемирие Тукайида, приращение против
 * пересчёта после ДЕСЯТКОВ тактов, разрежённость дельт при заживлении, «где
 * копят, там и воюют», и то, что тикер остаётся весовыми правилами с
 * сидированным ГПСЧ, а не случайностью.
 */
describe('фронт: такт войны (часть A)', () => {
  /** Прогнать `ticks` декад без единого боя. Тикер не зависит от того, чем занята рота. */
  function march(seed: number, ticks: number, startDay = 0): {
    war: WarState;
    deltas: GalaxyDeltas;
    moves: number;
    captures: number;
    raids: number;
    worldSeed: number;
  } {
    const state = new CampaignState(seed);
    let war = state.war;
    let deltas = state.deltas;
    let rep = state.reputation;
    const rng = new Rng(seed ^ 0x51ed270b);
    let moves = 0;
    let captures = 0;
    let raids = 0;

    for (let t = 1; t <= ticks; t++) {
      const day = startDay + t * WAR.economy.tickDays;
      war = economyTick(
        war,
        rep,
        frontWeights(frontSectors(war, rep, deltas, day)),
        tributeFlows(war, state.worldSeed, deltas, day),
      );
      const result = frontTick(war, deltas, rep, state.worldSeed, day, rng);
      war = result.war;
      deltas = result.deltas;
      rep = result.reputation;
      moves += result.moves.length;
      for (const m of result.moves) if (m.kind === 'capture') captures++;
        else raids++;
    }
    return { war, deltas, moves, captures, raids, worldSeed: state.worldSeed };
  }

  it('карта двигается: миры меняют владельца и это ложится в дельты', () => {
    const run = march(1, 28);
    expect(run.captures).toBeGreaterThan(0);
    const changed = Object.keys(run.deltas).filter((id) => run.deltas[id]?.owner !== undefined);
    expect(changed.length).toBeGreaterThan(0);
    for (const id of changed) {
      expect(ownerOf(run.deltas, id)).not.toBe(GALAXY.ownerId(GALAXY.require(id)));
    }
  });

  it('приращение не расходится с полным пересчётом за десять лет', () => {
    // Главная ловушка шага, названная в плане 21a и наступившая в 21b: список
    // участков считается один раз на такт, а владелец меняется посреди такта, и
    // без проверки «мир ещё за прежним хозяином» второе наступление той же
    // декады отнимало мир дважды. На годовом прогоне это не видно, на
    // десятилетнем расхождение было в семнадцать миллионов.
    const run = march(7, 365);
    const rebuilt = makeWarState(run.worldSeed, run.deltas);
    for (const f of FACTION_LIST) {
      const live = economyOf(run.war, f.id);
      const fresh = economyOf(rebuilt, f.id);
      expect(live.worlds).toBe(fresh.worlds);
      expect(live.income).toBe(fresh.income);
      expect(live.upkeep).toBe(fresh.upkeep);
      // Мощность (шаг 25) правится приращением в тех же четырёх местах, что
      // доход, — захват, набег, заживление, стройка, — и разойтись ей негде
      // ровно потому, что все четыре зовут одну функцию `worldContributionAt`.
      expect(live.capacity).toBe(fresh.capacity);
    }
    // Десять лет — не прихоть: столкновение двух захватов одного мира в одном
    // такте случается редко, и на годовом прогоне его не бывает вовсе. Отсюда и
    // потолок времени: этот тест дороже остальных и стоит того.
    // Срок поднят шагом 22c: десятилетний прогон теперь считает НАСТОЯЩИЕ бои
    // фронта и сотен наёмных отрядов, а не бросок против шансов. Проверка от
    // этого не изменилась — подорожал мир под ней.
  }, 120_000);

  it('такт воспроизводим: тот же сид даёт тот же фронт', () => {
    // Тикер — весовые правила и сидированный ГПСЧ, а не ИИ и не случайность
    // (ловушка 1 плана шага 21). Мир обязан реплеиться, как бой.
    const a = march(3, 12);
    const b = march(3, 12);
    expect(a.deltas).toEqual(b.deltas);
    expect(a.war).toEqual(b.war);
  });

  it('перемирие Тукайида: клан разоряет Сферу, но не занимает её миров', () => {
    // Решение 1 и 2: перемирие связывает кланы со Сферой, но не друг с другом и
    // не с молодыми воинами. Набег идёт, захвата нет.
    const day = 0;
    expect(truceHolds(day)).toBe(true);
    const sectors = frontSectors(START.war, NO_REPUTATION, NO_DELTAS, day);
    expect(sectors.length).toBeGreaterThan(0);

    for (const s of sectors) {
      const attacker = FACTIONS.get(s.attacker)?.kind;
      const defender = FACTIONS.get(s.defender)?.kind;
      // Сфера на клановую территорию не наступает вовсе.
      expect(attacker !== 'clan' && defender === 'clan').toBe(false);
      // Клан против Сферы — только набег.
      if (attacker === 'clan' && defender !== 'clan') expect(s.raid).toBe(true);
      // Клан против клана — обычный фронт, перемирие их не связывает.
      if (attacker === 'clan' && defender === 'clan') expect(s.raid).toBe(false);
    }
  });

  it('набег разоряет мир, но флаг над ним не меняется', () => {
    const run = march(11, 60);
    expect(run.raids).toBeGreaterThan(0);
    // Разорённых миров без смены владельца обязано быть хоть сколько-то:
    // иначе «набег» ничем не отличался бы от захвата.
    const raided = Object.keys(run.deltas).filter(
      (id) => (run.deltas[id]?.ruined ?? 0) > 0 && run.deltas[id]?.owner === undefined,
    );
    expect(raided.length).toBeGreaterThan(0);
  });

  it('перемирие снимается ОДНИМ числом в данных, без единой строки кода', () => {
    // Решение 1 требовало описать заранее, как спустить кланов с цепи. Год
    // перемирия — обычное поле `data/war.json`, и проверяется здесь именно то,
    // что правило читается по дате, а не зашито в код.
    const beforeTruceEnds = dayOf({ year: WAR.front.truceUntilYear - 1, month: 6, day: 1 });
    const afterTruceEnds = dayOf({ year: WAR.front.truceUntilYear, month: 6, day: 1 });
    expect(truceHolds(beforeTruceEnds)).toBe(true);
    expect(truceHolds(afterTruceEnds)).toBe(false);

    const open = frontSectors(START.war, NO_REPUTATION, NO_DELTAS, afterTruceEnds);
    expect(open.some((s) => s.raid)).toBe(false);
    expect(
      open.some(
        (s) => FACTIONS.get(s.attacker)?.kind !== 'clan' && FACTIONS.get(s.defender)?.kind === 'clan',
      ),
    ).toBe(true);
  });

  it('разорение заживает и уходит из разрежённой карты целиком', () => {
    // Дисциплина `withStanding` и `withFund`: запись, вернувшаяся к начальному,
    // из карты удаляется. Иначе разрежённость протекла бы через первую же
    // закончившуюся войну.
    const state = new CampaignState(2);
    const id = GALAXY.id(0);
    let deltas = withDelta(state.deltas, id, { ruined: WAR.front.healPerTick });
    let war = makeWarState(state.worldSeed, deltas);
    const rng = new Rng(1);
    // Такт с нулём наступлений: заживление идёт всегда, а фронт не мешается.
    const result = frontTick(war, deltas, NO_REPUTATION, state.worldSeed, 10, rng);
    deltas = result.deltas;
    war = result.war;
    expect(deltas[id]?.ruined).toBeUndefined();
    expect(deltas[id]).toBeUndefined();
  });

  it('снятое поле дельты не остаётся в записи ключом с undefined', () => {
    const id = GALAXY.id(0);
    const withBoth = withDelta(NO_DELTAS, id, { ruined: 0.4, visited: true });
    const healed = withDelta(withBoth, id, { ruined: undefined });
    expect(Object.keys(healed[id] as object)).toEqual(['visited']);
    // Круг через JSON ничего не меняет: снимок обязан быть тем же объектом.
    expect(JSON.parse(JSON.stringify(healed))).toEqual(healed);
  });

  it('копят там, где граничат: у фракции без общей границы веса нет', () => {
    const weights = frontWeights(frontSectors(START.war, NO_REPUTATION, NO_DELTAS, 0));
    // Соколы держат зону оккупации у Штайнера и граничат с другими кланами;
    // с КомСтаром на Терре у них нет ни одного соседнего мира.
    const falcon = weights['jade_falcon'] ?? {};
    expect(falcon['comstar']).toBeUndefined();
    expect(Object.keys(falcon).length).toBeGreaterThan(0);
  });

  it('фонд направления решает, кто наступает', () => {
    const state = new CampaignState(4);
    const sectors = frontSectors(state.war, state.reputation, state.deltas, 0);
    const shares = frontShares(frontWeights(sectors));
    const sector = sectors.find((s) => !s.raid) as FrontSector;
    const base = sectorForces(state.war, state.worldSeed, state.deltas, sector, shares);

    const armed = withFund(state.war, sector.attacker, sector.defender, economyOf(state.war, sector.attacker).income * 4);
    const after = sectorForces(armed, state.worldSeed, state.deltas, sector, shares);
    expect(after.odds).toBeGreaterThan(base.odds);

    // И симметрично: деньги обороняющегося работают на оборону.
    const dug = withFund(state.war, sector.defender, sector.attacker, economyOf(state.war, sector.defender).income * 4);
    expect(sectorForces(dug, state.worldSeed, state.deltas, sector, shares).odds).toBeLessThan(base.odds);
  });

  it('разорённый мир держится хуже целого', () => {
    const state = new CampaignState(4);
    const sectors = frontSectors(state.war, state.reputation, state.deltas, 0);
    const shares = frontShares(frontWeights(sectors));
    const sector = sectors.find((s) => !s.raid) as FrontSector;
    const id = GALAXY.id(sector.system);
    const wrecked = withDelta(state.deltas, id, { ruined: 1 });
    expect(sectorForces(state.war, state.worldSeed, wrecked, sector, shares).odds).toBeGreaterThanOrEqual(
      sectorForces(state.war, state.worldSeed, state.deltas, sector, shares).odds,
    );
  });

  it('такт фронта стоит в очереди и переставляет себя по границе декады', () => {
    const state = new CampaignState(1);
    expect(state.queue.some((e) => e.task.kind === 'frontTick')).toBe(true);
    // Экономика идёт ПЕРЕД фронтом того же дня: сперва копят, потом воюют.
    const economy = state.queue.find((e) => e.task.kind === 'economyTick');
    const front = state.queue.find((e) => e.task.kind === 'frontTick');
    expect(front?.day).toBe(economy?.day);
    expect((front?.seq ?? 0) > (economy?.seq ?? 0)).toBe(true);

    execute(state, { kind: 'advance', days: 45 });
    const next = state.queue.find((e) => e.task.kind === 'frontTick');
    expect((next?.day ?? 0) % WAR.front.tickDays).toBe(0);
  });

  it('фронт входит в снимок и переживает круг через сохранение', () => {
    const state = new CampaignState(9);
    execute(state, { kind: 'advance', days: 200 });
    const owners = Object.keys(state.deltas).filter((id) => state.deltas[id]?.owner !== undefined);
    expect(owners.length).toBeGreaterThan(0);

    const before = hashCampaignState(state);
    const back = restore(parseSaveFile(JSON.parse(JSON.stringify(makeSaveFile(snapshot(state))))));
    expect(hashCampaignState(back)).toBe(before);
    expect(back.deltas).toEqual(state.deltas);
    expect(back.war).toEqual(state.war);
  });
});

describe('контракты из войны (часть B)', () => {
  it('напряжённость поднимает вражду и открывает тяжёлые типы', () => {
    // Ровно здесь контракты перестают выводиться из статичной таблицы
    // (`wiki/design/campaign/contracts.md`, «Вражда»).
    const cold = heatedEnmity(0.65, 0);
    const hot = heatedEnmity(0.65, 1);
    expect(cold).toBe(0.65);
    expect(hot).toBeGreaterThan(cold);
    expect(missionsAt(cold)).not.toContain('assault');
    expect(missionsAt(hot)).toContain('assault');
  });

  it('напряжённость нулевая, пока никто ничего не отложил', () => {
    const state = new CampaignState(1);
    expect(tensionOf(state.war, state.reputation, 'davion', 'kurita', 1)).toBe(0);
    // И растёт вместе с фондами обеих сторон.
    const armed = withFund(state.war, 'kurita', 'davion', economyOf(state.war, 'kurita').income * 6);
    expect(tensionOf(armed, NO_REPUTATION, 'davion', 'kurita', 1)).toBeGreaterThan(0);
  });

  it('напряжённость есть только у пары, у которой есть вражда и близость', () => {
    const state = new CampaignState(1);
    const armed = withFund(state.war, 'kurita', 'davion', economyOf(state.war, 'kurita').income * 6);
    // Дальний сосед даёт меньше, чем ближний: фронт есть у МЕСТА.
    expect(tensionOf(armed, NO_REPUTATION, 'davion', 'kurita', WAR.front.proximityFalloff)).toBeLessThan(
      tensionOf(armed, NO_REPUTATION, 'davion', 'kurita', 1),
    );
    expect(tensionOf(armed, NO_REPUTATION, 'davion', 'kurita', 0)).toBe(0);
    // Штайнер и Дэвион — один блок, воевать им не о чем ни при каких фондах.
    expect(tensionOf(armed, NO_REPUTATION, 'davion', 'steiner', 1)).toBe(0);
  });

  it('опаснее — значит дороже: решение 7', () => {
    // Находка замера шага 20: оплата шла от вражды, опасность — от вида фракции
    // цели, и между собой они не были связаны никак. Среди ПОСИЛЬНЫХ контрактов
    // пиратский платил 149 520 против 127 794 у работы против Дома, которая в
    // полтора раза тяжелее.
    const state = new CampaignState(1);
    let militia = 0;
    let militiaN = 0;
    let guard = 0;
    let guardN = 0;

    for (let i = 0; i < GALAXY.count; i += 7) {
      for (const c of contractBoard(
        state.worldSeed,
        state.deltas,
        GALAXY.id(i),
        0,
        undefined,
        state.war,
      )) {
        // Сравниваются контракты ОДНОГО типа миссии: иначе мерился бы разброс
        // между рейдом и штурмом, а не между ополчением и гвардией.
        if (c.mission !== 'raid') continue;
        if (c.opforType === 'militia') {
          militia += c.payout;
          militiaN++;
        } else if (c.opforType === 'guard') {
          guard += c.payout;
          guardN++;
        }
      }
    }
    expect(militiaN).toBeGreaterThan(0);
    expect(guardN).toBeGreaterThan(0);
    expect(guard / guardN).toBeGreaterThan(militia / militiaN);
  });

  it('горячая граница ДОБАВЛЯЕТ работу, а не замещает пиратскую', () => {
    // Работы не против пиратов нет в двух третях систем, и виной тому не фронт,
    // а география: вглубь территории Дома другого актора в двух прыжках нет.
    // Тыл остаётся тылом — за войной надо лететь.
    const state = new CampaignState(1);
    const sector = frontSectors(state.war, state.reputation, state.deltas, 0).find((s) => !s.raid) as FrontSector;
    const id = GALAXY.id(sector.system);
    const quiet = contractBoard(state.worldSeed, state.deltas, id, 0, undefined, state.war);

    const armed = withFund(
      withFund(state.war, sector.attacker, sector.defender, economyOf(state.war, sector.attacker).income * 8),
      sector.defender,
      sector.attacker,
      economyOf(state.war, sector.defender).income * 8,
    );
    const hot = contractBoard(state.worldSeed, state.deltas, id, 0, undefined, armed);
    expect(hot.length).toBeGreaterThan(quiet.length);
    expect(hot.some((c) => c.tension > 0)).toBe(true);
  });

  it('разорение сушит биржу и гарнизон', () => {
    const state = new CampaignState(1);
    const id = GALAXY.id(frontSectors(state.war, state.reputation, state.deltas, 0)[0]?.system ?? 0);
    const whole = contractBoard(state.worldSeed, state.deltas, id, 0, undefined, state.war);
    const wrecked = contractBoard(
      state.worldSeed,
      withDelta(state.deltas, id, { ruined: 1 }),
      id,
      0,
      undefined,
      state.war,
    );
    expect(wrecked.length).toBeLessThanOrEqual(whole.length);
  });

  it('вклад роты идёт нанимателю против цели и только за победу', () => {
    const state = new CampaignState(1);
    const before = fundOf(state.war, 'davion', 'kurita');
    const after = withCompanyEffort(state.war, 'davion', 'kurita', 1_000_000);
    expect(fundOf(after, 'davion', 'kurita')).toBeGreaterThan(before);
    // Против самого себя войну не двигают.
    expect(withCompanyEffort(state.war, 'davion', 'davion', 1_000_000)).toEqual(state.war);
  });
});

describe('фронт двигает матрицу отношений фракций', () => {
  it('воевавшие пары двигаются, а не воевавшие остаются на базовой линии', () => {
    // Матрица заведена шагом 20 и ЧИТАЕТСЯ им («враг моего врага»), но её
    // единственный законный писатель — такт войны. Ровно ради этого порядок
    // шагов 20 → 21 и не менялся.
    //
    // ДО ШАГА 26 канал был один и он был вниз, и тест это и проверял: каждая
    // запись обязана лежать ниже выведенной. Теперь каналов два — подчинение и
    // общий враг двигают пару ВВЕРХ, — и утверждение сузилось до того, что оно
    // и означало: запись в карте есть ровно там, где что-то произошло.
    const state = new CampaignState(9);
    execute(state, { kind: 'advance', days: 200 });

    const pairs = Object.keys(state.reputation.relations);
    expect(pairs.length).toBeGreaterThan(0);
    let down = 0;
    let up = 0;
    for (const key of pairs) {
      const [a, b] = key.split('|') as [string, string];
      expect(relationOf(state.reputation, a, b)).not.toBe(initialRelation(a, b));
      if (relationOf(state.reputation, a, b) < initialRelation(a, b)) down++;
      else up++;
    }
    // ОБА канала работают, и это всё, что здесь утверждается. Какой из них
    // перевесит за двадцать декад — величина замеряемая, а не правило: вниз
    // двигает каждое наступление мелким шагом, вверх — редкие события
    // подчинения крупным. Соотношение меряет `pnpm worldstat` («доля пар ниже
    // −0.9»), а не тест.
    expect(down).toBeGreaterThan(0);
    expect(up).toBeGreaterThan(0);

    // Штайнер и Дэвион — один блок: наступать друг на друга им не о чем, и вниз
    // их пара не двигается никогда. Вверх — двигается, и это шаг 26: оба
    // наступали на Куриту в одну декаду, и «враг моего врага» их сблизил. До
    // шага 26 записи у этой пары не было вовсе, потому что канал был один.
    const allies = state.reputation.relations['davion|steiner'];
    if (allies !== undefined) expect(allies).toBeGreaterThan(initialRelation('davion', 'steiner'));
  });
});

describe('ступень «разорена» означает войну, а не бедность', () => {
  it('на первый день кампании её не достигает никто — и это по построению', () => {
    // 21a упирал порог в пол шкалы достатка, чтобы независимые миры не читались
    // разорёнными в первый день (69 сидов из 200 при пороге 0.7). 21b снял
    // ограничение и посмотрел на настоящий разброс: минимум на старте 0.328,
    // минимум после двенадцати лет войны 0.200, и любой порог между ними держится
    // на удаче сида. Поэтому ступень открывает РАЗОРЕНИЕ: оно на день ноль равно
    // нулю у всех и на любом сиде, потому что пишет его только фронт.
    for (let seed = 1; seed <= 40; seed++) {
      const state = new CampaignState(seed);
      for (const f of FACTION_LIST) {
        const eco = economyOf(state.war, f.id);
        const share = ruinShareOf(state.deltas, f.id, eco.worlds);
        expect(share).toBe(0);
        expect(warBand(prosperityOf(state.war, f.id), share)).not.toBe('ruined');
      }
    }
  });

  it('выжженная войной фракция читается разорённой, как бы богата ни была', () => {
    const state = new CampaignState(1);
    const rich = prosperityOf(state.war, 'comstar');
    expect(warBand(rich, 0)).toBe('strong');
    expect(warBand(rich, WAR.front.ruinedBandFrom)).toBe('ruined');
  });

  it('доля разорения считается по своим мирам, а не по всей карте', () => {
    const state = new CampaignState(1);
    const id = GALAXY.id(0);
    const owner = GALAXY.ownerId(0);
    const other = FACTION_LIST.find((f) => f.id !== owner)?.id as string;
    const deltas = withDelta(state.deltas, id, { ruined: 0.5 });

    expect(ruinShareOf(deltas, owner, 10)).toBeCloseTo(0.05, 5);
    expect(ruinShareOf(deltas, other, 10)).toBe(0);
    // Ноль миров — ноль доли, а не деление на ноль.
    expect(ruinShareOf(deltas, owner, 0)).toBe(0);
  });
});

/**
 * Развитие планет (шаг 23, часть A).
 *
 * Проверяются решения, а не числа: профиль остаётся ВЫВОДИМЫМ (в дельте лежит
 * отклонение, а не сам профиль), разрежённость не протекает, приращение сходится
 * с полным пересчётом, а фронтовой мир не строят.
 */

/**
 * Специализация миров, промышленная мощность и домен игрока
 * (шаг 25, фаза 2 Части 3).
 *
 * Проверяются решения, а не числа: фокус выводится и хранится отклонением,
 * мощность правится приращением и следует за пожарами, армия следует за
 * промышленностью, а домен роты живёт в кассе и не протекает в экономику фракций.
 */
describe('фокус миров и промышленная мощность (шаг 25)', () => {
  const FOCUSES: readonly WorldFocus[] = ['granary', 'mining', 'arsenal', 'metropolis', 'fortress'];

  it('ноль дельт даёт осмысленную карту специализаций, а не один фокус на всю Сферу', () => {
    // Смысл естественного фокуса: карта специализаций существует с первого дня
    // кампании и не стоит ни одной записи в снимке. Выродись она в один фокус —
    // и решение «переделать мир» потеряло бы смысл вместе с ней.
    const count = new Map<WorldFocus, number>();
    for (let i = 0; i < GALAXY.count; i++) {
      const f = systemProfile(1, i).naturalFocus;
      count.set(f, (count.get(f) ?? 0) + 1);
    }
    for (const f of FOCUSES) {
      const n = count.get(f) ?? 0;
      expect(n, `фокус ${f} пуст`).toBeGreaterThan(0);
      expect(n, `фокус ${f} занял больше половины карты`).toBeLessThan(GALAXY.count / 2);
    }
  });

  it('естественный фокус — чистая функция профиля: тот же сид даёт тот же фокус', () => {
    for (let i = 0; i < GALAXY.count; i += 17) {
      expect(systemProfile(4, i).naturalFocus).toBe(systemProfile(4, i).naturalFocus);
    }
  });

  it('фокус живёт в ДЕЛЬТЕ, а вернувшийся к естественному мир из неё уходит', () => {
    // Та же дисциплина разрежённости, что у зажившего разорения и нулевого
    // развития: «отклонения нет» — не отличие от выводимого.
    const id = GALAXY.id(0);
    const natural = systemProfile(1, 0).naturalFocus;
    const other: WorldFocus = natural === 'arsenal' ? 'granary' : 'arsenal';

    const changed = withDelta(NO_DELTAS, id, { focus: other });
    expect(focusOf(changed, id, natural)).toBe(other);

    const back = withDelta(changed, id, { focus: undefined });
    expect(back[id]).toBeUndefined();
    expect(focusOf(back, id, natural)).toBe(natural);
  });

  it('фокус ПЕРЕРАСПРЕДЕЛЯЕТ: у каждого есть чем он лучше и чем он хуже других', () => {
    // Фокуса, который лучше остальных во всём, быть не должно — иначе выбор
    // фокуса перестал бы быть выбором.
    const p = systemProfile(1, GALAXY.require('tharkad'));
    const cap = (f: WorldFocus): number => systemCapacity(p, f);
    const inc = (f: WorldFocus): number => systemIncome(p, false, 0, f);
    const upk = (f: WorldFocus): number => systemUpkeep(p, f);

    // Арсенал — производство; метрополия — деньги; житница — дешевизна.
    expect(cap('arsenal')).toBeGreaterThan(cap('mining'));
    expect(cap('mining')).toBeGreaterThan(cap('fortress'));
    expect(cap('fortress')).toBeGreaterThan(cap('granary'));
    expect(inc('metropolis')).toBeGreaterThan(inc('granary'));
    expect(inc('fortress')).toBeLessThan(inc('granary'));
    expect(upk('granary')).toBeLessThan(upk('fortress'));
  });

  it('мощность следует за пожарами: выжженный мир перестаёт снабжать фронт сразу', () => {
    // То звено, которого войне не хватало: до шага 25 сожжённый арсенал бил по
    // владельцу только падением дохода на несколько процентов.
    const p = systemProfile(1, GALAXY.require('hesperus-ii'));
    const whole = systemCapacity(p, 'arsenal', 0);
    const burnt = systemCapacity(p, 'arsenal', 0.5);
    expect(whole).toBeGreaterThan(0);
    expect(burnt).toBe(Math.round(whole * 0.5));
    expect(systemCapacity(p, 'arsenal', 1)).toBe(0);
  });

  it('армия следует за ПРОМЫШЛЕННОСТЬЮ, а не за числом миров', () => {
    // Главный числовой результат шага. Клановый анклав держит военную
    // промышленность заметно выше сферной, и теперь это видно в армии: у
    // Дымчатых Ягуаров машин на мир больше, чем у Дэвиона, при том что миров у
    // Дэвиона в одиннадцать раз больше.
    const war = new CampaignState(1).war;
    const perWorld = (id: string): number => {
      const e = economyOf(war, id);
      return e.army / e.worlds;
    };
    expect(perWorld('smoke_jaguar')).toBeGreaterThan(perWorld('davion'));
    expect(perWorld('jade_falcon')).toBeGreaterThan(perWorld('steiner'));

    // При этом СУММАРНАЯ армия Сферы осталась на дошаговом уровне: шаг —
    // перераспределение, а не раздача. Иначе коридоры проверяли бы не то.
    let army = 0;
    let worlds = 0;
    for (const f of FACTION_LIST) {
      army += economyOf(war, f.id).army;
      worlds += economyOf(war, f.id).worlds;
    }
    expect(army).toBeGreaterThan(worlds * WAR.economy.armyPerWorld * 0.9);
    expect(army).toBeLessThan(worlds * WAR.economy.armyPerWorld * 1.1);
  });

  it('готовность считается от ТЕРРИТОРИИ, иначе выжженная держава дралась бы как целая', () => {
    // Развилка, без которой мощность работала бы наоборот: цель от мощности
    // падает вместе с сожжёнными заводами, и отношение «армия / цель» осталось
    // бы прежним. Территория же от пожаров не зависит.
    const war = new CampaignState(1).war;
    const eco = economyOf(war, 'davion');
    expect(armyReference(eco.worlds)).toBe(eco.worlds * WAR.economy.armyPerWorld);

    const burnt = withEconomy(war, 'davion', { capacity: Math.round(eco.capacity / 2) });
    // Цель упала вдвое, а готовность — нет: армия та же, территория та же.
    expect(armyTarget(economyOf(burnt, 'davion').capacity)).toBeLessThan(armyTarget(eco.capacity));
    expect(armyReadiness(burnt, 'davion')).toBe(armyReadiness(war, 'davion'));
  });
});

describe('домен игрока (шаг 25, часть C)', () => {
  /** Команда, которая обязана пройти: отказ здесь — ошибка теста, а не правил. */
  function run(state: CampaignState, command: CampaignCommand): void {
    const result = execute(state, command);
    if (!result.ok) throw new Error(`Команда ${command.kind} отклонена: ${result.reason}`);
  }

  /** Богатая рота в системе, которую ей продадут: отношение поднято, казна велика. */
  function landlord(seed: number): { state: CampaignState; systemId: string } {
    const state = new CampaignState(seed);
    state.company = { ...makeCompany(), cbills: 5_000_000_000 };
    // Мир не столица, не под войной и у владельца, с которым рота в ладах.
    let systemId = '';
    for (let i = 0; i < GALAXY.count; i++) {
      if (GALAXY.hasFlag(i, 'capital')) continue;
      const owner = ownerOf(state.deltas, i);
      if (FACTIONS.get(owner)?.kind !== 'house') continue;
      if (frontSectors(state.war, state.reputation, state.deltas, state.day).some((s) => s.system === i)) continue;
      systemId = GALAXY.id(i);
      state.systemId = systemId;
      state.reputation = withStanding(state.reputation, owner, 100);
      break;
    }
    expect(systemId).not.toBe('');
    return { state, systemId };
  }

  it('рота покупает мир, и он уходит из экономики прежнего владельца ПРИРАЩЕНИЕМ', () => {
    const { state, systemId } = landlord(1);
    const i = GALAXY.require(systemId);
    const owner = ownerOf(state.deltas, i);
    const was = economyOf(state.war, owner);
    const contribution = worldContributionAt(state.worldSeed, state.deltas, i);

    const result = execute(state, { kind: 'buyWorld' });
    expect(result.ok).toBe(true);
    expect(ownerOf(state.deltas, i)).toBe(PLAYER_ACTOR_ID);

    const now = economyOf(state.war, owner);
    expect(now.worlds).toBe(was.worlds - 1);
    expect(now.income).toBe(was.income - contribution.income);
    expect(now.capacity).toBe(was.capacity - contribution.capacity);

    // И полный пересчёт с этим согласен: `makeWarState` мир роты не считает
    // никому, потому что владелец ему незнаком.
    const fresh = makeWarState(state.worldSeed, state.deltas);
    expect(economyOf(fresh, owner).income).toBe(now.income);
    expect(economyOf(fresh, owner).capacity).toBe(now.capacity);
  });

  it('мир не продают: столицу, воюющий мир и тому, с кем владелец не в ладах', () => {
    const { state } = landlord(2);
    const owner = ownerOf(state.deltas, GALAXY.require(state.systemId));

    const poor = new CampaignState(2);
    poor.company = { ...makeCompany(), cbills: 5_000_000_000 };
    poor.systemId = state.systemId;
    // Отношение по умолчанию ниже порога: планету не продают тем, кого не знают.
    expect(execute(poor, { kind: 'buyWorld' }).ok).toBe(false);

    const capital = new CampaignState(2);
    capital.company = { ...makeCompany(), cbills: 5_000_000_000 };
    capital.systemId = 'tharkad';
    capital.reputation = withStanding(capital.reputation, 'steiner', 100);
    expect(execute(capital, { kind: 'buyWorld' }).ok).toBe(false);

    expect(FACTIONS.has(owner)).toBe(true);
  });

  it('доход домена идёт в КАССУ роты и не протекает в экономику фракций', () => {
    const { state, systemId } = landlord(3);
    run(state, { kind: 'buyWorld' });
    const i = GALAXY.require(systemId);

    const tally = domainTally(state.worldSeed, state.deltas);
    expect(tally.worlds).toEqual([i]);
    expect(tally.income).toBeGreaterThan(0);

    const before = state.company.cbills;
    run(state, { kind: 'advanceTo', day: nextEconomyTickDay(state.day) });
    expect(state.company.cbills).not.toBe(before);

    // Ни одна фракция роту в своей экономике не числит.
    for (const f of FACTION_LIST) {
      expect(economyOf(state.war, f.id).worlds).toBeGreaterThanOrEqual(0);
    }
    // А ВОТ У САМОЙ РОТЫ ЗАПИСЬ ТЕПЕРЬ ЕСТЬ (шаг 27, часть C). До него её не
    // было вовсе, и это ломало дипломатию роты (шаг 26 чинил обходом через
    // `actorWorlds`) и сделало бы невозможными театры. Деньги при этом
    // по-прежнему в кассе: казна здесь — ПРОЕКЦИЯ кассы, обновляемая тактом, а
    // не второй кошелёк.
    const player = economyOf(state.war, PLAYER_ACTOR_ID);
    expect(player.worlds).toBe(1);
    expect(player.income).toBeGreaterThan(0);
    expect(player.treasury).toBe(state.company.cbills);
  });

  it('свой мир переделывают и развивают, чужой — нет', () => {
    const { state, systemId } = landlord(4);
    run(state, { kind: 'buyWorld' });
    const i = GALAXY.require(systemId);
    const natural = worldProfile(state.worldSeed, state.deltas, i).naturalFocus;
    const other: WorldFocus = natural === 'fortress' ? 'arsenal' : 'fortress';

    run(state, { kind: 'setWorldFocus', systemId, focus: other });
    // Переделка ИДЁТ, но мир пока работает по-старому: решение с отложенным следствием.
    expect(state.deltas[systemId]?.focusTo).toBe(other);
    expect(focusOf(state.deltas, systemId, natural)).toBe(natural);

    run(state, { kind: 'developWorld', systemId });
    expect(developmentOf(state.deltas, systemId)).toBe(1);

    // Чужой мир не трогают ни фокусом, ни стройкой.
    const alien = GALAXY.id(GALAXY.count - 1);
    expect(execute(state, { kind: 'setWorldFocus', systemId: alien, focus: other }).ok).toBe(false);
    expect(execute(state, { kind: 'developWorld', systemId: alien }).ok).toBe(false);
  });

  it('перемирие Тукайида роты не касается: с кланом она воюет на общих правах в обе стороны (шаг 72d)', () => {
    // Решение пользователя: иначе рота брала бы клановые миры, а клан в ответ
    // лишь жёг бы её. Сфера при этом остаётся под перемирием — проверяется тут
    // же, на тех же мирах: у соседей-Домов участков против клана нет.
    const state = new CampaignState(11);
    expect(truceHolds(state.day)).toBe(true);
    let mine = -1;
    let clan = '';
    for (let i = 0; i < GALAXY.count && mine < 0; i++) {
      if (FACTIONS.get(ownerOf(state.deltas, i))?.kind !== 'house' || GALAXY.hasFlag(i, 'capital')) continue;
      const j = GALAXY.neighbors(i).find((n) => FACTIONS.get(ownerOf(state.deltas, n))?.kind === 'clan');
      if (j === undefined) continue;
      mine = i;
      clan = ownerOf(state.deltas, j);
    }
    expect(mine).toBeGreaterThanOrEqual(0);
    state.deltas = withDelta(state.deltas, GALAXY.id(mine), { owner: PLAYER_ACTOR_ID });

    const sectors = frontSectors(state.war, state.reputation, state.deltas, state.day);
    const onMine = sectors.filter((s) => s.defender === PLAYER_ACTOR_ID && s.attacker === clan);
    expect(onMine.length).toBeGreaterThan(0);
    expect(onMine.every((s) => !s.raid)).toBe(true);
    expect(sectors.some((s) => s.attacker === PLAYER_ACTOR_ID && s.defender === clan)).toBe(true);
    // Сфера под перемирием по-прежнему: Дом на клан не наступает.
    expect(sectors.some((s) => FACTIONS.get(s.attacker)?.kind === 'house' && FACTIONS.get(s.defender)?.kind === 'clan')).toBe(false);
  });

  it('мир роты — участок фронта с первого мира: пираты у границы идут захватом, не набегом (шаг 72c)', () => {
    // Вражда держится данными, а не частным случаем: пираты враждуют с
    // наёмником на 0.6, клан на 0.5, Дом на 0.1 (`relations.json`). До шага 72c
    // первый мир роты был только целью набега; теперь он держава сразу.
    const state = new CampaignState(5);
    let mine = -1;
    for (let i = 0; i < GALAXY.count && mine < 0; i++) {
      if (FACTIONS.get(ownerOf(state.deltas, i))?.kind !== 'house' || GALAXY.hasFlag(i, 'capital')) continue;
      if (GALAXY.neighbors(i).some((j) => ownerOf(state.deltas, j) === 'pirates')) mine = i;
    }
    expect(mine).toBeGreaterThanOrEqual(0);
    state.deltas = withDelta(state.deltas, GALAXY.id(mine), { owner: PLAYER_ACTOR_ID });

    const sectors = frontSectors(state.war, state.reputation, state.deltas, state.day);
    const onMine = sectors.filter((s) => s.defender === PLAYER_ACTOR_ID && s.attacker === 'pirates');
    expect(onMine.length).toBeGreaterThan(0);
    expect(onMine.every((s) => !s.raid)).toBe(true);
    // И рота сама сторона наступающая — симметрично.
    expect(sectors.some((s) => s.attacker === PLAYER_ACTOR_ID && s.defender === 'pirates')).toBe(true);
  });
});

describe('развитие планет (шаг 23, часть A)', () => {
  const DEV = GALAXY_RULES.profile.development;
  const WORLD = START.worldSeed;

  it('ноль ступеней даёт РОВНО канонический профиль', () => {
    // Главная гарантия обратной совместимости шага: пока мир не тронут, он тот
    // же, каким его вывел сид, — и весь замер Части 2 остаётся в силе.
    for (let i = 0; i < 200; i++) {
      expect(systemProfile(WORLD, i, 0)).toEqual(systemProfile(WORLD, i));
    }
  });

  it('ступень поднимает промышленность и доход, а потолок держит', () => {
    // Мир заведомо не на краю шкалы: у мира с промышленностью 10 прибавлять
    // нечего, и проверять на нём потолок — значит проверять clamp, а не развитие.
    let i = -1;
    for (let k = 0; k < GALAXY.count; k++) {
      const p = systemProfile(WORLD, k);
      if (p.industryCivil >= 2 && p.industryCivil <= 6) {
        i = k;
        break;
      }
    }
    expect(i).toBeGreaterThanOrEqual(0);

    const base = systemProfile(WORLD, i);
    const up = systemProfile(WORLD, i, 1);
    expect(up.industryCivil).toBe(base.industryCivil + 1);
    expect(up.populationM).toBeGreaterThan(base.populationM);
    expect(systemIncome(up, false)).toBeGreaterThan(systemIncome(base, false));

    const down = systemProfile(WORLD, i, -1);
    expect(down.industryCivil).toBe(base.industryCivil - 1);
    expect(systemIncome(down, false)).toBeLessThan(systemIncome(base, false));

    // Потолок и дно — из данных, а не из кода: запрошенное сверх них равно им.
    expect(systemProfile(WORLD, i, 99)).toEqual(systemProfile(WORLD, i, DEV.max));
    expect(systemProfile(WORLD, i, -99)).toEqual(systemProfile(WORLD, i, DEV.min));
  });

  it('развитие живёт в ДЕЛЬТЕ, а вернувшийся к канону мир из неё уходит', () => {
    // Та же дисциплина разрежённости, что у зажившего разорения и обнулённого
    // фонда: «отклонения нет» — не отличие от канона, и записи ему не полагается.
    const id = GALAXY.id(0);
    const grown = withDelta(NO_DELTAS, id, { development: 2 });
    expect(developmentOf(grown, id)).toBe(2);
    expect(worldProfile(WORLD, grown, 0)).toEqual(systemProfile(WORLD, 0, 2));

    const back = withDelta(grown, id, { development: undefined });
    expect(back[id]).toBeUndefined();
    expect(worldProfile(WORLD, back, 0)).toEqual(systemProfile(WORLD, 0));
  });

  it('такт строит на деньги казны и не трогает фронтовые и выжженные миры', () => {
    const state = new CampaignState(11);
    // Казна раздута нарочно: при обычной казне за одну декаду вся Сфера строит
    // меньше двух ступеней, и проверять правило отбора было бы не на чем.
    let war = state.war;
    for (const f of FACTION_LIST) {
      const eco = economyOf(war, f.id);
      if (eco.worlds > 0) war = withEconomy(war, f.id, { treasury: eco.treasury * 400 });
    }

    const day = 10;
    const atFront = new Set(frontSectors(state.war, state.reputation, state.deltas, day).map((s) => s.system));
    const result = developmentTick(war, state.deltas, state.reputation, state.worldSeed, day, new Rng(7));

    expect(result.moves.length).toBeGreaterThan(0);
    for (const m of result.moves) {
      expect(m.kind).toBe('built');
      expect(atFront.has(GALAXY.require(m.systemId))).toBe(false);
      // Мир может достаться под стройку дважды за одну декаду — выбор
      // случайный, — поэтому в дельте лежит ИТОГ такта, а не ступень отдельного
      // хода: сверяется «не меньше», а не «равно».
      expect(result.deltas[m.systemId]?.development).toBeGreaterThanOrEqual(m.to);
    }
    // Стройка ОПЛАЧЕНА: казна владельца просела ровно на число ступеней.
    const built = result.moves.filter((m) => m.owner === (result.moves[0] as { owner: string }).owner).length;
    const owner = (result.moves[0] as { owner: string }).owner;
    expect(economyOf(war, owner).treasury - economyOf(result.war, owner).treasury).toBe(
      built * WAR.development.stepCost,
    );
  });

  it('приращение развития не расходится с полным пересчётом', () => {
    // Та же ловушка, что у захвата: профиль системы нигде не хранится, и такт
    // правит доход владельца ПРИРАЩЕНИЕМ. Разойдись оно с `makeWarState` — и
    // экономика фракций тихо разъедется с картой.
    const state = new CampaignState(5);
    let war = state.war;
    for (const f of FACTION_LIST) {
      const eco = economyOf(war, f.id);
      if (eco.worlds > 0) war = withEconomy(war, f.id, { treasury: eco.treasury * 200 });
    }
    let deltas = state.deltas;
    const rng = new Rng(99);
    for (let t = 1; t <= 30; t++) {
      const r = developmentTick(war, deltas, state.reputation, state.worldSeed, t * 10, rng);
      war = r.war;
      deltas = r.deltas;
    }

    const rebuilt = makeWarState(state.worldSeed, deltas);
    for (const f of FACTION_LIST) {
      expect(economyOf(war, f.id).income).toBe(economyOf(rebuilt, f.id).income);
      expect(economyOf(war, f.id).upkeep).toBe(economyOf(rebuilt, f.id).upkeep);
    }
  });

  it('такт стоит в очереди с первого дня и переставляет себя по границе декады', () => {
    const state = new CampaignState(3);
    expect(state.queue.some((e) => e.task.kind === 'developmentTick' && e.day === 10)).toBe(true);
    execute(state, { kind: 'advanceTo', day: 10 });
    const next = state.queue.find((e) => e.task.kind === 'developmentTick');
    expect(next?.day).toBe(nextEconomyTickDay(10));
  });

  it('развитие переживает круг через сохранение вместе с хэшем', () => {
    const state = new CampaignState(4);
    state.deltas = withDelta(state.deltas, GALAXY.id(0), { development: 2 });
    state.war = makeWarState(state.worldSeed, state.deltas);
    const before = hashCampaignState(state);

    const back = restore(parseSaveFile(JSON.parse(JSON.stringify(makeSaveFile(snapshot(state))))));
    expect(developmentOf(back.deltas, GALAXY.id(0))).toBe(2);
    expect(hashCampaignState(back)).toBe(before);
  });

  it('считалка по фракциям различает отстроенное и просевшее', () => {
    // Владелец берётся такой, у которого миров заведомо больше одного:
    // однопланетные акторы (КомСтар, Драгуны) второго мира не дадут.
    const owner = 'davion';
    const mine: number[] = [];
    for (let i = 0; i < GALAXY.count && mine.length < 2; i++) {
      if (GALAXY.ownerId(i) === owner) mine.push(i);
    }
    expect(mine).toHaveLength(2);

    let deltas = withDelta(NO_DELTAS, GALAXY.id(mine[0] as number), { development: 2 });
    deltas = withDelta(deltas, GALAXY.id(mine[1] as number), { development: -1 });
    expect(developmentShareOf(deltas, owner)).toEqual({ built: 1, decayed: 1 });
    // Чужие миры в счёт не идут.
    const other = FACTION_LIST.find((f) => f.id !== owner)?.id as string;
    expect(developmentShareOf(deltas, other)).toEqual({ built: 0, decayed: 0 });
  });
});

/**
 * Замысел государства (шаг 23, часть B).
 *
 * Проверяется главное решение части: ПЕРЕВЕС, а не запрет. Плюс разрежённость,
 * попадание в хэш и то, что походом считается только взятое у своей цели.
 */
describe('замысел государства (шаг 23, часть B)', () => {
  /** Замысел, поставленный руками: такт объявляет их редко и не на заказ. */
  function planted(state: CampaignState, from: string, against: string, target: string) {
    return withPlan(state.war, from, {
      against,
      target,
      fromDay: 0,
      untilDay: 500,
      taken: 0,
    });
  }

  it('перевес, а не запрет: участок в зоне удара весит больше, остальные — ровно как были', () => {
    const state = new CampaignState(1);
    const sectors = frontSectors(state.war, state.reputation, state.deltas, 10);
    const sector = sectors.find((s) => !s.raid) as FrontSector;
    const war = planted(state, sector.attacker, sector.defender, GALAXY.id(sector.system));

    // Сам участок — цель удара.
    expect(planWeight(war, sector)).toBe(WAR.plans.sectorWeight);
    // Тот же наступающий, но другой враг — перевеса нет.
    const elsewhere = sectors.find(
      (s) => s.attacker === sector.attacker && s.defender !== sector.defender,
    );
    if (elsewhere !== undefined) expect(planWeight(war, elsewhere)).toBe(1);
    // Чужой замысел чужому наступающему не помогает.
    const other = sectors.find((s) => s.attacker !== sector.attacker) as FrontSector;
    expect(planWeight(war, other)).toBe(1);
  });

  it('поход считает ТОЛЬКО взятое у своей цели', () => {
    const state = new CampaignState(1);
    const sectors = frontSectors(state.war, state.reputation, state.deltas, 10);
    const sector = sectors.find((s) => !s.raid) as FrontSector;
    let war = planted(state, sector.attacker, sector.defender, GALAXY.id(sector.system));

    war = notePlanCapture(war, sector.attacker, sector.defender);
    expect(planOf(war, sector.attacker)?.taken).toBe(1);

    // Мир, отбитый попутно у третьей стороны, к главному удару отношения не
    // имеет и приближать его конец не должен.
    const third = FACTION_LIST.find((f) => f.id !== sector.attacker && f.id !== sector.defender)?.id as string;
    war = notePlanCapture(war, sector.attacker, third);
    expect(planOf(war, sector.attacker)?.taken).toBe(1);
  });

  it('замысел кончается двумя разными путями и уходит из разрежённой карты', () => {
    const state = new CampaignState(1);
    const sectors = frontSectors(state.war, state.reputation, state.deltas, 10);
    const sector = sectors.find((s) => !s.raid) as FrontSector;

    // Цель взята — поход закрыт как достигнутый.
    let war = withPlan(state.war, sector.attacker, {
      against: sector.defender,
      target: GALAXY.id(sector.system),
      fromDay: 0,
      untilDay: 5000,
      taken: WAR.plans.goal,
    });
    let out = planTick(war, sectors, 10, new Rng(1));
    expect(out.moves.some((m) => m.factionId === sector.attacker && m.kind === 'done')).toBe(true);

    // Срок вышел — поход выдохся.
    war = withPlan(state.war, sector.attacker, {
      against: sector.defender,
      target: GALAXY.id(sector.system),
      fromDay: 0,
      untilDay: 10,
      taken: 0,
    });
    out = planTick(war, sectors, 10, new Rng(1));
    expect(out.moves.some((m) => m.factionId === sector.attacker && m.kind === 'spent')).toBe(true);

    // Закрытая запись из карты УХОДИТ, а не остаётся пустой строкой.
    const still = planList(out.war).filter((p) => p.factionId === sector.attacker);
    if (still.length > 0) expect(still[0]?.fromDay).toBe(10);
    expect(withPlan(out.war, sector.attacker, undefined).plans[sector.attacker]).toBeUndefined();
  });

  it('поход не объявляют, не накопив против цели', () => {
    // Порядок круга буквально: сперва силы накапливаются, и только потом
    // государство выбирает цель. На первый день кампании фонды пусты у всех.
    const state = new CampaignState(1);
    const sectors = frontSectors(state.war, state.reputation, state.deltas, 10);
    expect(planTick(state.war, sectors, 10, new Rng(1)).moves).toHaveLength(0);
  });

  it('замысел входит в хэш и переживает круг через сохранение', () => {
    const state = new CampaignState(6);
    const sectors = frontSectors(state.war, state.reputation, state.deltas, 10);
    const sector = sectors.find((s) => !s.raid) as FrontSector;
    state.war = planted(state, sector.attacker, sector.defender, GALAXY.id(sector.system));
    const before = hashCampaignState(state);

    const bare = new CampaignState(6);
    expect(hashCampaignState(bare)).not.toBe(before);

    const back = restore(parseSaveFile(JSON.parse(JSON.stringify(makeSaveFile(snapshot(state))))));
    expect(planOf(back.war, sector.attacker)?.target).toBe(GALAXY.id(sector.system));
    expect(hashCampaignState(back)).toBe(before);
  });

  it('копят гуще там, где объявлен поход', () => {
    // Вторая половина замысла: фракция не только бьёт туда, но и КОПИТ туда.
    const state = new CampaignState(1);
    const sectors = frontSectors(state.war, state.reputation, state.deltas, 10);
    const sector = sectors.find((s) => !s.raid) as FrontSector;
    const weights = frontWeights(sectors);

    const plain = economyTick(state.war, state.reputation, weights);
    const aimed = economyTick(
      planted(state, sector.attacker, sector.defender, GALAXY.id(sector.system)),
      state.reputation,
      weights,
    );
    expect(fundOf(aimed, sector.attacker, sector.defender)).toBeGreaterThan(
      fundOf(plain, sector.attacker, sector.defender),
    );
  });
});

/**
 * Дипломатия (шаг 26): живая вражда, три ступени подчинения и ступени доступа
 * игрока.
 */
describe('живая вражда (шаг 26, часть A)', () => {
  it('пустая матрица даёт СТАТИЧНУЮ вражду до последнего бита', () => {
    // Главное свойство безопасности шага: пока матрица пуста, мир обязан быть
    // ровно тем же, что до шага 26. Проверка идёт по ВСЕМ парам реестра, а не по
    // выборке: расхождение в одном хвосте двоичной дроби у одной пары сдвинуло
    // бы порог фронта ровно у неё — и нашлось бы это через год.
    //
    // Именно поэтому `liveEnmity` при отсутствии записи возвращает `enmity`
    // напрямую, а не считает `(1 − initialRelation) / 2`: обратный путь через
    // два округления не сокращается (0.15 → 0.15000000000000002).
    for (const a of FACTION_LIST) {
      for (const b of FACTION_LIST) {
        expect(liveEnmity(NO_REPUTATION, a.id, b.id)).toBe(enmity(a.id, b.id));
      }
    }
  });

  it('и участки фронта на пустой матрице те же, что даёт статичная таблица', () => {
    const state = new CampaignState(3);
    for (const s of frontSectors(state.war, state.reputation, state.deltas, 0)) {
      expect(s.enmity).toBe(enmity(s.attacker, s.defender));
    }
  });

  it('петля замкнулась: испорченные отношения меняют фронт, помирившиеся его снимают', () => {
    const state = new CampaignState(3);
    const sector = frontSectors(state.war, state.reputation, state.deltas, 0).find(
      (s) => !s.raid,
    ) as FrontSector;

    // Помирившаяся пара перестаёт быть участком фронта ВОВСЕ — до шага 26 это
    // было невозможно ни при какой истории кампании.
    const friends = withRelation(state.reputation, sector.attacker, sector.defender, 0.9);
    expect(
      frontSectors(state.war, friends, state.deltas, 0).some(
        (s) => s.system === sector.system && s.attacker === sector.attacker,
      ),
    ).toBe(false);

    // Провоевавшая — дерётся ожесточённее: вражда участка выросла.
    const foes = withRelation(state.reputation, sector.attacker, sector.defender, -1);
    const hot = frontSectors(state.war, foes, state.deltas, 0).find(
      (s) => s.system === sector.system && s.attacker === sector.attacker,
    ) as FrontSector;
    expect(hot.enmity).toBeGreaterThan(sector.enmity);
  });

  it('живая вражда двигает и раскладку фонда, и напряжённость биржи', () => {
    const state = new CampaignState(1);
    const friends = withRelation(state.reputation, 'davion', 'kurita', 0.9);
    expect(liveEnemiesOf(friends, 'davion', WAR.economy.fundMinEnmity).map((e) => e.id)).not.toContain(
      'kurita',
    );

    const armed = withFund(state.war, 'davion', 'kurita', 500_000_000);
    expect(tensionOf(armed, state.reputation, 'davion', 'kurita', 1)).toBeGreaterThan(0);
    expect(tensionOf(armed, friends, 'davion', 'kurita', 1)).toBe(0);
  });

  it('полоса, а не число: пороги идут снизу вверх и накрывают всю шкалу', () => {
    expect(relationBand(-1)).toBe('war');
    expect(relationBand(1)).toBe('alliance');
    // Порог фронта отвечает верху «холода»: воюют «война», «вражда» и «холод»,
    // а начиная с «нейтралитета» участка фронта не бывает вовсе.
    for (const v of [-0.9, -0.5, 0, 0.19]) {
      expect(liveEnmity(withRelation(NO_REPUTATION, 'kurita', 'davion', v), 'kurita', 'davion'))
        .toBeGreaterThanOrEqual(WAR.front.minEnmity);
      expect(['war', 'feud', 'cold']).toContain(relationBand(v));
    }
    for (const v of [0.21, 0.7, 0.95]) {
      expect(liveEnmity(withRelation(NO_REPUTATION, 'kurita', 'davion', v), 'kurita', 'davion'))
        .toBeLessThan(WAR.front.minEnmity);
      expect(['neutral', 'accord', 'alliance']).toContain(relationBand(v));
    }
  });
});

describe('военный фонд перестал расти без предела (шаг 26, долг 21a)', () => {
  it('направление, на котором не стреляли, возвращает долю в казну', () => {
    const state = new CampaignState(1);
    const war = withFund(state.war, 'davion', 'kurita', 1_000_000_000);
    const before = economyOf(war, 'davion').treasury;

    const idle = releaseIdleFunds(war, new Set());
    expect(fundOf(idle, 'davion', 'kurita')).toBeLessThan(1_000_000_000);
    // Деньги не исчезают, а перестают быть отложенными на войну.
    expect(economyOf(idle, 'davion').treasury).toBeGreaterThan(before);
    expect(
      economyOf(idle, 'davion').treasury + fundOf(idle, 'davion', 'kurita'),
    ).toBe(before + 1_000_000_000);
  });

  it('а направление, на котором воюют, роспуска не видит', () => {
    const state = new CampaignState(1);
    const war = withFund(state.war, 'davion', 'kurita', 1_000_000_000);
    const kept = releaseIdleFunds(war, new Set(['davion>kurita']));
    expect(fundOf(kept, 'davion', 'kurita')).toBe(1_000_000_000);
  });

  it('помирившееся направление распускается целиком', () => {
    const state = new CampaignState(1);
    const war = withFund(state.war, 'davion', 'kurita', 1_000_000_000);
    const friends = withRelation(state.reputation, 'davion', 'kurita', 0.9);
    const after = economyTick(war, friends);
    expect(fundOf(after, 'davion', 'kurita')).toBe(0);
  });
});

describe('дань: первая ступень подчинения (шаг 26, часть B)', () => {
  it('владельца не меняет, срок конечен и записывается в дельту', () => {
    const state = new CampaignState(1);
    const i = 0;
    const owner = ownerOf(state.deltas, i);
    const imposed = imposeTribute(state.war, state.deltas, state.reputation, 'kurita', i, 100);

    expect(ownerOf(imposed.deltas, i)).toBe(owner);
    expect(tributeOf(imposed.deltas, GALAXY.id(i), 100)).toBe('kurita');
    const until = 100 + WAR.diplomacy.tributeDecades * WAR.front.tickDays;
    expect(tributeOf(imposed.deltas, GALAXY.id(i), until)).toBeUndefined();
    // Подчинение — способ не воевать: отношение пары идёт ВВЕРХ.
    expect(relationOf(imposed.reputation, 'kurita', owner)).toBeGreaterThan(
      relationOf(state.reputation, 'kurita', owner),
    );
  });

  it('дань течёт от владельца получателю и в доход каталога не входит', () => {
    const state = new CampaignState(1);
    const i = 0;
    const owner = ownerOf(state.deltas, i);
    const deltas = imposeTribute(state.war, state.deltas, state.reputation, 'kurita', i, 0).deltas;

    const flows = tributeFlows(state.war, state.worldSeed, deltas, 0);
    expect(flows[owner]).toBeLessThan(0);
    expect(flows['kurita']).toBe(-(flows[owner] as number));

    // ГЛАВНОЕ: полный пересчёт по каталогу обязан сойтись. Дань — поток между
    // акторами, а не свойство мира, и в `income` ей делать нечего.
    const rebuilt = makeWarState(state.worldSeed, deltas);
    expect(economyOf(rebuilt, owner).income).toBe(economyOf(state.war, owner).income);
  });

  it('истёкшая дань уходит из разрежённой карты целиком', () => {
    const state = new CampaignState(1);
    const i = 0;
    const id = GALAXY.id(i);
    const deltas = imposeTribute(state.war, state.deltas, state.reputation, 'kurita', i, 0).deltas;
    expect(deltas[id]?.tribute).toBe('kurita');

    const after = diplomacyTick(
      state.war,
      deltas,
      state.reputation,
      WAR.diplomacy.tributeDecades * WAR.front.tickDays,
    );
    expect(after.deltas[id]?.tribute).toBeUndefined();
    expect(after.deltas[id]?.tributeUntil).toBeUndefined();
    expect(after.moves.some((m) => m.kind === 'tributeLapsed')).toBe(true);
  });

  it('разбитого соседа не добивают: тяга к дани растёт, когда обороняющийся мал', () => {
    const state = new CampaignState(1);
    const sector = frontSectors(state.war, state.reputation, state.deltas, 0).find(
      (s) => !s.raid,
    ) as FrontSector;

    // Тот же участок, но обороняющийся сведён до одного мира. Проверяется
    // именно ТЯГА, а не булев исход: исход зависит ещё и от того, что за мир
    // взяли, — арсенал с высокой мощностью и застарелой враждой отнимут в любом
    // случае, и это правильно. Лекарство от вырождения малых (§5в) состоит не в
    // том, что дань всегда, а в том, что чем меньше сосед, тем она вероятнее.
    const shrunk = withEconomy(state.war, sector.defender, { worlds: 1 });
    const grown = withEconomy(shrunk, sector.attacker, {
      worlds: economyOf(state.war, sector.attacker).worlds + 300,
    });
    expect(tributePull(grown, state.reputation, state.worldSeed, state.deltas, sector)).toBeGreaterThan(
      tributePull(state.war, state.reputation, state.worldSeed, state.deltas, sector),
    );

    // И на убыточном захолустье у большой державы выбор действительно
    // переваливает за порог, а не остаётся красивой арифметикой.
    const poor = frontSectors(state.war, state.reputation, state.deltas, 0).find((s) => {
      if (s.raid) return false;
      const c = worldContributionAt(state.worldSeed, state.deltas, s.system);
      return c.income <= c.upkeep && c.capacity <= 2;
    }) as FrontSector;
    const big = withEconomy(withEconomy(state.war, poor.defender, { worlds: 1 }), poor.attacker, {
      worlds: 600,
    });
    expect(prefersTribute(big, state.reputation, state.worldSeed, state.deltas, poor)).toBe(true);
  });
});

describe('протекторат: вторая ступень (шаг 26, часть B)', () => {
  /** Мир малой фракции под данью крупной — из этого протекторат и вырастает. */
  function pressured(seed = 1): {
    state: CampaignState;
    over: string;
    under: string;
  } {
    const state = new CampaignState(seed);
    const under = 'nova_cat';
    const over = 'smoke_jaguar';
    state.war = withEconomy(state.war, under, { worlds: 4 });
    let deltas = state.deltas;
    let n = 0;
    for (let i = 0; i < GALAXY.count && n < 2; i++) {
      if (ownerOf(deltas, i) !== under) continue;
      deltas = imposeTribute(state.war, deltas, state.reputation, over, i, 0).deltas;
      n++;
    }
    state.deltas = deltas;
    return { state, over, under };
  }

  it('вырастает из дани: сосед держит и число миров, и их долю', () => {
    const { state, over, under } = pressured();
    expect(canSubmit(state.war, state.reputation, state.deltas, over, under, 0)).toBe(true);

    // Та же дань у крупной державы не значит ничего: доля не набирается.
    const big = withEconomy(state.war, under, { worlds: 400 });
    expect(canSubmit(big, state.reputation, state.deltas, over, under, 0)).toBe(false);
  });

  it('сюзерен и вассал не воюют, и вассалы одного сюзерена — тоже', () => {
    const state = new CampaignState(1);
    let war = withVassal(state.war, 'nova_cat', { suzerain: 'smoke_jaguar', sinceDay: 0 });
    war = withVassal(war, 'steel_viper', { suzerain: 'smoke_jaguar', sinceDay: 0 });

    expect(boundByProtectorate(war, 'smoke_jaguar', 'nova_cat')).toBe(true);
    expect(boundByProtectorate(war, 'nova_cat', 'steel_viper')).toBe(true);
    expect(boundByProtectorate(war, 'nova_cat', 'jade_falcon')).toBe(false);
    expect(vassalsOf(war, 'smoke_jaguar')).toEqual(['nova_cat', 'steel_viper']);

    // И участка фронта между ними больше нет ни одного.
    for (const s of frontSectors(war, state.reputation, state.deltas, 0)) {
      expect(boundByProtectorate(war, s.attacker, s.defender)).toBe(false);
    }
  });

  it('вассала вассала не бывает, и потолок вассалов держит каскад', () => {
    const { state, over, under } = pressured();
    const chained = withVassal(state.war, over, { suzerain: 'jade_falcon', sinceDay: 0 });
    expect(canSubmit(chained, state.reputation, state.deltas, over, under, 0)).toBe(false);

    let full = state.war;
    for (const id of ['wolf', 'ghost_bear', 'steel_viper']) {
      full = withVassal(full, id, { suzerain: over, sinceDay: 0 });
    }
    expect(vassalsOf(full, over).length).toBeGreaterThanOrEqual(WAR.diplomacy.vassalMax);
    expect(canSubmit(full, state.reputation, state.deltas, over, under, 0)).toBe(false);
  });

  it('разрыв обязателен: истёкшая дань освобождает вассала', () => {
    const { state, over, under } = pressured();
    const war = withVassal(state.war, under, { suzerain: over, sinceDay: 0 });
    const day = WAR.diplomacy.tributeDecades * WAR.front.tickDays;
    const after = diplomacyTick(war, state.deltas, state.reputation, day);
    expect(suzerainOf(after.war, under)).toBeUndefined();
    expect(after.moves.some((m) => m.kind === 'protectorateBroken')).toBe(true);
  });
});

describe('договоры пары: третья ступень (шаг 26, часть B)', () => {
  it('перемирие снимает участок фронта на срок и истекает само', () => {
    const state = new CampaignState(1);
    const sector = frontSectors(state.war, state.reputation, state.deltas, 0).find(
      (s) => !s.raid,
    ) as FrontSector;
    const signed = signPact(state.war, state.reputation, sector.attacker, sector.defender, 'truce', 0);

    expect(pactHolds(signed.war, sector.attacker, sector.defender, 'truce', 0)).toBe(true);
    expect(
      frontSectors(signed.war, signed.reputation, state.deltas, 0).some(
        (s) => s.system === sector.system && s.attacker === sector.attacker,
      ),
    ).toBe(false);

    const over = WAR.diplomacy.pactDecades * WAR.front.tickDays;
    expect(pactHolds(signed.war, sector.attacker, sector.defender, 'truce', over)).toBe(false);
    const lapsed = diplomacyTick(signed.war, state.deltas, signed.reputation, over);
    expect(pactOf(lapsed.war, sector.attacker, sector.defender)).toBeUndefined();
  });

  it('торговый договор — прибавка ОБЕИМ сторонам, а не переток', () => {
    const state = new CampaignState(1);
    const war = withPact(state.war, 'liao', 'marik', {
      kind: 'trade',
      untilDay: 1000,
    });
    const flows = tributeFlows(war, state.worldSeed, state.deltas, 0);
    expect(flows['liao']).toBeGreaterThan(0);
    expect(flows['marik']).toBeGreaterThan(0);
  });
});

describe('дипломатия в снимке и в хэше (шаг 26)', () => {
  it('подчинение переживает круг через сохранение вместе с хэшем', () => {
    const state = new CampaignState(4);
    state.war = withVassal(state.war, 'nova_cat', { suzerain: 'smoke_jaguar', sinceDay: 10 });
    state.war = withPact(state.war, 'liao', 'marik', { kind: 'trade', untilDay: 700 });
    state.deltas = imposeTribute(state.war, state.deltas, state.reputation, 'kurita', 0, 0).deltas;
    const before = hashCampaignState(state);

    expect(hashCampaignState(new CampaignState(4))).not.toBe(before);
    const back = restore(parseSaveFile(JSON.parse(JSON.stringify(makeSaveFile(snapshot(state))))));
    expect(suzerainOf(back.war, 'nova_cat')).toBe('smoke_jaguar');
    expect(pactOf(back.war, 'liao', 'marik')?.kind).toBe('trade');
    expect(tributeOf(back.deltas, GALAXY.id(0), 0)).toBe('kurita');
    expect(hashCampaignState(back)).toBe(before);
  });

  it('версия правил поднята: старые кампании не грузятся', () => {
    expect(CAMPAIGN_RULES_VERSION).toBeGreaterThanOrEqual(15);
  });
});

describe('дипломатия державы игрока: открыта с первого мира (шаг 26, часть C; шаг 72c)', () => {
  function run(state: CampaignState, command: CampaignCommand): void {
    const result = execute(state, command);
    if (!result.ok) throw new Error(`Команда ${command.kind} отклонена: ${result.reason}`);
  }

  /** Рота, купившая мир у Дома: держава с первого мира (шаг 72c). */
  function landholder(seed: number): { state: CampaignState; systemId: string; owner: string } {
    const state = new CampaignState(seed);
    state.company = { ...makeCompany(), cbills: 20_000_000_000 };
    let systemId = '';
    let owner = '';
    for (let i = 0; i < GALAXY.count; i++) {
      if (GALAXY.hasFlag(i, 'capital')) continue;
      const who = ownerOf(state.deltas, i);
      if (FACTIONS.get(who)?.kind !== 'house') continue;
      if (frontSectors(state.war, state.reputation, state.deltas, state.day).some((s) => s.system === i)) {
        continue;
      }
      systemId = GALAXY.id(i);
      owner = who;
      state.systemId = systemId;
      state.reputation = withStanding(state.reputation, who, 100);
      break;
    }
    run(state, { kind: 'buyWorld' });
    return { state, systemId, owner };
  }

  it('без своих миров дипломатии нет вовсе', () => {
    const state = new CampaignState(1);
    state.company = { ...makeCompany(), cbills: 20_000_000_000 };
    state.reputation = withStanding(state.reputation, 'kurita', 100);
    const result = execute(state, { kind: 'proposePact', factionId: 'kurita', pact: 'truce' });
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toBe('diplomacyLocked');
  });

  it('держава заключает договор о ненападении с соседом', () => {
    const { state, owner } = landholder(1);
    // Известность и надёжность больше не условие (шаг 72c): хватает мира.
    state.reputation = { ...state.reputation, fame: 0, reliability: 0 };

    run(state, { kind: 'proposePact', factionId: owner, pact: 'truce' });
    expect(pactOf(state.war, PLAYER_ACTOR_ID, owner)?.kind).toBe('truce');
    // Второй раз тот же договор не заключают.
    expect(execute(state, { kind: 'proposePact', factionId: owner, pact: 'truce' }).ok).toBe(false);
  });

  it('соглашение стоит денег и роняет отношение с третьими сторонами', () => {
    const { state, owner } = landholder(2);
    state.reputation = { ...state.reputation, fame: 60, reliability: 70 };
    const money = state.company.cbills;
    // Враг того, с кем договариваются, — по матрице, а не списком частных случаев.
    const foe = FACTION_LIST.map((f) => f.id)
      .filter((id) => id !== owner)
      .sort((a, b) => relationOf(state.reputation, a, owner) - relationOf(state.reputation, b, owner))[0] as string;
    const before = standingOf(state.reputation, foe);

    run(state, { kind: 'proposePact', factionId: owner, pact: 'trade' });
    expect(state.company.cbills).toBeLessThan(money);
    expect(standingOf(state.reputation, owner)).toBeGreaterThan(0);
    expect(standingOf(state.reputation, foe)).toBeLessThan(before);
  });

  it('выкуп дани со своего мира: платит рота, и мир перестаёт платить', () => {
    const { state, systemId } = landholder(3);
    state.reputation = { ...state.reputation, fame: 60, reliability: 70 };
    const i = GALAXY.require(systemId);
    state.deltas = imposeTribute(state.war, state.deltas, state.reputation, 'kurita', i, state.day)
      .deltas;
    expect(tributeOf(state.deltas, systemId, state.day)).toBe('kurita');

    // Пока дань стоит, она вычитается из дохода домена той же картой потоков,
    // что и у держав.
    expect(tributeFlows(state.war, state.worldSeed, state.deltas, state.day)[PLAYER_ACTOR_ID]).toBeLessThan(0);

    run(state, { kind: 'buyOffTribute', systemId });
    expect(tributeOf(state.deltas, systemId, state.day)).toBeUndefined();
    expect(execute(state, { kind: 'buyOffTribute', systemId }).ok).toBe(false);
  });

  it('одного мира хватает, чтобы требовать дань с соседа (шаг 72c)', () => {
    const { state } = landholder(4);
    const target = GALAXY.neighbors(GALAXY.require(state.systemId)).find(
      (j) => ownerOf(state.deltas, j) !== PLAYER_ACTOR_ID && !GALAXY.hasFlag(j, 'capital'),
    ) as number;
    state.reputation = withStanding(state.reputation, ownerOf(state.deltas, target), 100);
    run(state, { kind: 'demandTribute', systemId: GALAXY.id(target) });
    expect(tributeOf(state.deltas, GALAXY.id(target), state.day)).toBe(PLAYER_ACTOR_ID);
  });

  it('держава игрока облагает данью мир соседа тем же кодом, что и фракции', () => {
    const { state } = landholder(5);
    state.reputation = { ...state.reputation, fame: 100, reliability: 100 };
    // Четыре мира — не условие ступени (с 72c её нет), а запас соседей для дани.
    for (const f of FACTION_LIST) {
      if (f.kind === 'house') state.reputation = withStanding(state.reputation, f.id, 100);
    }
    const own = GALAXY.require(state.systemId);
    let taken = 1;
    for (const j of GALAXY.neighbors(own)) {
      if (taken >= 4) break;
      if (GALAXY.hasFlag(j, 'capital')) continue;
      state.deltas = withDelta(state.deltas, GALAXY.id(j), { owner: PLAYER_ACTOR_ID });
      taken++;
    }
    expect(domainTally(state.worldSeed, state.deltas).worlds.length).toBeGreaterThanOrEqual(4);

    const target = GALAXY.neighbors(own).find(
      (j) => ownerOf(state.deltas, j) !== PLAYER_ACTOR_ID && !GALAXY.hasFlag(j, 'capital'),
    ) as number;
    const victim = ownerOf(state.deltas, target);
    state.reputation = withStanding(state.reputation, victim, 100);

    run(state, { kind: 'demandTribute', systemId: GALAXY.id(target) });
    expect(tributeOf(state.deltas, GALAXY.id(target), state.day)).toBe(PLAYER_ACTOR_ID);
    // Владельца дань не меняет — то же правило, что у фракций.
    expect(ownerOf(state.deltas, target)).toBe(victim);
    // И дань течёт в кассу роты тем же потоком.
    expect(tributeFlows(state.war, state.worldSeed, state.deltas, state.day)[PLAYER_ACTOR_ID]).toBeGreaterThan(0);
  });

  it('держава игрока принимает первого вассала', () => {
    // ЭТОТ ТЕСТ НАШЁЛ НАСТОЯЩУЮ ОШИБКУ, а не подтвердил ожидание. У державы
    // игрока нет записи в `FactionEconomy`, поэтому `economyOf(war, 'player')`
    // давал ноль миров, и порог «сюзерен обязан быть крупнее вассала» отвергал
    // роту ВСЕГДА и молча. Территория актора считается теперь `actorWorlds`.
    const state = new CampaignState(6);
    state.company = { ...makeCompany(), cbills: 20_000_000_000 };
    state.reputation = { ...state.reputation, fame: 100, reliability: 100 };
    for (const f of FACTION_LIST) {
      if (f.kind === 'house') state.reputation = withStanding(state.reputation, f.id, 100);
    }

    // Мелкий сосед: сводим его до четырёх миров и берём два из них под дань.
    const under = 'nova_cat';
    state.war = withEconomy(state.war, under, { worlds: 4 });
    let held = 0;
    for (let i = 0; i < GALAXY.count && held < 2; i++) {
      if (ownerOf(state.deltas, i) !== under) continue;
      state.deltas = imposeTribute(
        state.war,
        state.deltas,
        state.reputation,
        PLAYER_ACTOR_ID,
        i,
        state.day,
      ).deltas;
      held++;
    }
    expect(held).toBe(2);

    // Держава игрока: своих миров больше, чем у соседа, помноженного на порог.
    let mine = 0;
    for (let i = 0; i < GALAXY.count && mine < 10; i++) {
      if (GALAXY.hasFlag(i, 'capital') || ownerOf(state.deltas, i) === under) continue;
      state.deltas = withDelta(state.deltas, GALAXY.id(i), { owner: PLAYER_ACTOR_ID });
      mine++;
    }
    expect(actorWorlds(state.war, state.deltas, PLAYER_ACTOR_ID)).toBe(10);

    run(state, { kind: 'offerProtectorate', factionId: under });
    expect(suzerainOf(state.war, under)).toBe(PLAYER_ACTOR_ID);
    // Участка фронта между сюзереном и вассалом больше нет ни одного.
    for (const sec of frontSectors(state.war, state.reputation, state.deltas, state.day)) {
      expect(boundByProtectorate(state.war, sec.attacker, sec.defender)).toBe(false);
    }
    // И доля дохода вассала течёт роте.
    expect(
      tributeFlows(state.war, state.worldSeed, state.deltas, state.day)[PLAYER_ACTOR_ID],
    ).toBeGreaterThan(0);
    // Второй раз того же вассала не принимают.
    expect(execute(state, { kind: 'offerProtectorate', factionId: under }).ok).toBe(false);
  });
});

describe('логистика и два эшелона (шаг 27)', () => {
  function run(state: CampaignState, command: CampaignCommand): void {
    const result = execute(state, command);
    if (!result.ok) throw new Error(`Команда ${command.kind} отклонена: ${result.reason}`);
  }

  /** Сколько машин у актора всего — по резерву и всем его театрам, честной суммой. */
  function countByHand(war: WarState, id: string): number {
    let total = economyOf(war, id).army;
    for (const t of theatersOf(war, id)) total += t.mechs;
    return total;
  }

  it('СУММА МАШИН СХОДИТСЯ: резерв плюс театры равны армии на каждом такте', () => {
    // Главная приёмка части A. Без неё машины тихо появлялись бы и пропадали
    // при переброске, и заметить это можно было бы только через двадцать декад
    // по разъехавшемуся хэшу.
    const state = new CampaignState(11);
    for (let n = 0; n < 30; n++) {
      run(state, { kind: 'advanceTo', day: nextEconomyTickDay(state.day) });
      for (const id of warActors(state.deltas)) {
        expect(totalArmy(state.war, id)).toBe(countByHand(state.war, id));
      }
    }
  });

  it('переброска ничего не создаёт и не уничтожает', () => {
    const state = new CampaignState(12);
    const sectors = frontSectors(state.war, state.reputation, state.deltas, state.day);
    const shares = frontShares(frontWeights(sectors));
    const jumps = theaterJumps(state.deltas, sectors);

    const before = FACTION_LIST.map((f) => totalArmy(state.war, f.id));
    let war = state.war;
    for (let n = 0; n < 5; n++) war = logisticsTick(war, state.reputation, shares, jumps);
    const after = FACTION_LIST.map((f) => totalArmy(war, f.id));
    expect(after).toEqual(before);
    // И при этом полки ДЕЙСТВИТЕЛЬНО уехали: театры не пусты.
    expect(theatersOf(war, 'davion').length).toBeGreaterThan(0);
  });

  it('РАЗРЕЖЁННОСТЬ ДЕРЖИТСЯ: опустевший театр и опустевшая строка удаляются', () => {
    const state = new CampaignState(13);
    let war = withTheater(state.war, 'davion', 'kurita', 100);
    expect(theaterOf(war, 'davion', 'kurita')).toBe(100);
    war = withTheaterLoss(war, 'davion', 'kurita', 100);
    expect(war.theaters['davion']).toBeUndefined();
    // Списать больше, чем стояло на направлении, нельзя: за остальное дралось
    // ополчение, которого фронт не считает.
    war = withTheater(war, 'davion', 'kurita', 10);
    war = withTheaterLoss(war, 'davion', 'kurita', 999);
    expect(theaterOf(war, 'davion', 'kurita')).toBe(0);
  });

  it('после ста декад записей театров десятки, а не тысячи', () => {
    const state = new CampaignState(14);
    for (let n = 0; n < 100; n++) run(state, { kind: 'advanceTo', day: nextEconomyTickDay(state.day) });
    let rows = 0;
    for (const from of Object.keys(state.war.theaters)) {
      rows += Object.keys(state.war.theaters[from] as Record<string, number>).length;
    }
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThan(200);
  });

  it('ФРОНТ ЛОМАЕТСЯ ЛОКАЛЬНО: разбитый театр обваливает одно направление', () => {
    // Того, что здесь проверяется, до шага 27 не могло случиться по построению:
    // пул был один на всю Сферу, и обескровленная фракция слабела ВЕЗДЕ разом.
    const state = new CampaignState(15);
    for (let n = 0; n < 10; n++) run(state, { kind: 'advanceTo', day: nextEconomyTickDay(state.day) });

    const sectors = frontSectors(state.war, state.reputation, state.deltas, state.day);
    const shares = frontShares(frontWeights(sectors));
    const row = theatersOf(state.war, 'davion');
    expect(row.length).toBeGreaterThan(1);

    const broken = row[0] as { against: string; mechs: number };
    const intact = row[1] as { against: string; mechs: number };
    const war = withTheater(state.war, 'davion', broken.against, 0);

    expect(theaterReadiness(war, 'davion', broken.against, shares)).toBeLessThan(
      theaterReadiness(war, 'davion', intact.against, shares),
    );
    // А общедержавная готовность при этом ещё далека от нуля: держава жива.
    expect(armyReadiness(war, 'davion')).toBeGreaterThan(WAR.economy.armyMinShare);
  });

  it('ополчение — нижний слой обороны, и при целом театре формула прежняя', () => {
    // Число выбрано так, чтобы шаг менял то, что происходит при РАЗБИТОМ
    // театре, а не то, что происходит при целом: восемь коридоров §6
    // калиброваны на прежней формуле.
    expect(militiaBacked(1)).toBeCloseTo(1, 10);
    expect(militiaBacked(WAR.economy.armyMinShare)).toBeGreaterThan(WAR.economy.armyMinShare);
    expect(militiaBacked(0)).toBeCloseTo(WAR.logistics.militiaShare, 10);
  });

  it('ТАКТ НЕ ПОДОРОЖАЛ: ни findRoute, ни jumpDistance в логистике нет', () => {
    // Сторож решения §6 дорожной карты. Оба — обходы каталога (A* и обход в
    // ширину по 2000 системам), а участков фронта около пятисот за такт.
    const src = readFileSync(
      new URL('../src/core/campaign/war/logistics.ts', import.meta.url),
      'utf8',
    );
    const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code).not.toMatch(/findRoute|jumpDistance/);
    expect(code).toMatch(/GALAXY\.distance/);
  });

  it('ПОДЪЁМНАЯ СИЛА выводится из космопортов и бьётся разорением', () => {
    const state = new CampaignState(16);
    for (const f of FACTION_LIST) {
      if (economyOf(state.war, f.id).worlds === 0) continue;
      expect(economyOf(state.war, f.id).lift).toBeGreaterThan(0);
    }
    // Класс порта решает: A возит на порядок больше, чем F.
    const a = systemLift({ spaceport: 'A' } as never);
    const f = systemLift({ spaceport: 'F' } as never);
    expect(a / f).toBeGreaterThan(5);
    expect(systemLift({ spaceport: 'A' } as never, 1)).toBe(0);
  });

  it('ПЛЕЧО: содержание мира растёт с удалённостью от столицы владельца', () => {
    const near = systemUpkeep(worldProfile(1, NO_DELTAS, 0), undefined, 0);
    const far = systemUpkeep(worldProfile(1, NO_DELTAS, 0), undefined, 10);
    expect(far - near).toBe(10 * WAR.logistics.upkeepPerJump);
    // И у мира без столицы (пираты, независимые) плечо равно нулю.
    let free = -1;
    for (let i = 0; i < GALAXY.count; i++) {
      if (ownerOf(NO_DELTAS, i) !== 'pirates') continue;
      free = i;
      break;
    }
    expect(free).toBeGreaterThanOrEqual(0);
    expect(capitalJumps(NO_DELTAS, free, 'pirates')).toBe(0);
  });

  it('плечо считается по столице ТЕКУЩЕГО владельца, а не канонического', () => {
    let i = -1;
    for (let k = 0; k < GALAXY.count; k++) {
      if (ownerOf(NO_DELTAS, k) !== 'kurita') continue;
      i = k;
      break;
    }
    expect(i).toBeGreaterThanOrEqual(0);
    const own = capitalJumps(NO_DELTAS, i, 'kurita');
    const taken = capitalJumps(withDelta(NO_DELTAS, GALAXY.id(i), { owner: 'davion' }), i, 'davion');
    expect(taken).not.toBe(own);
  });

  it('РОСПУСК ТЕАТРА: помирившееся направление возвращает полки в резерв даром', () => {
    const state = new CampaignState(17);
    let war = withTheater(state.war, 'davion', 'kurita', 300);
    const before = totalArmy(war, 'davion');
    // Отношение выведено в мир: вражда упала ниже порога фонда.
    const rep = withRelation(state.reputation, 'davion', 'kurita', 1);
    war = logisticsTick(war, rep, {}, {});
    expect(theaterOf(war, 'davion', 'kurita')).toBe(0);
    expect(totalArmy(war, 'davion')).toBe(before);
    expect(economyOf(war, 'davion').army).toBeGreaterThanOrEqual(300);
  });

  it('такт экономики без логистики оставляет театры на месте', () => {
    // Так `economyTick` зовут тесты экономики, и пропуск звена не может
    // незаметно испортить состояние: переброска ничего не создаёт.
    const state = new CampaignState(18);
    const war = withTheater(state.war, 'davion', 'kurita', 250);
    const after = economyTick(war, state.reputation);
    expect(theaterOf(after, 'davion', 'kurita')).toBe(250);
  });

  it('содержание платится за ВСЮ армию, а не за резерв', () => {
    // Считай по резерву — и держава отправкой полков на фронт снимала бы с себя
    // расходы.
    const state = new CampaignState(19);
    const spread = withTheater(
      withEconomy(state.war, 'davion', { army: 0 }),
      'davion',
      'kurita',
      economyOf(state.war, 'davion').army,
    );
    const home = economyTick(state.war, state.reputation);
    const away = economyTick(spread, state.reputation);
    expect(economyOf(away, 'davion').treasury).toBeCloseTo(
      economyOf(home, 'davion').treasury,
      -6,
    );
  });
});

describe('держава игрока во фронте (шаг 27, часть C)', () => {
  function run(state: CampaignState, command: CampaignCommand): void {
    const result = execute(state, command);
    if (!result.ok) throw new Error(`Команда ${command.kind} отклонена: ${result.reason}`);
  }

  /** Рота-держава: миры, известность, надёжность и признание Домов. */
  function realm(seed: number, worlds = 6): CampaignState {
    const state = new CampaignState(seed);
    state.company = { ...makeCompany(), cbills: 40_000_000_000 };
    state.reputation = { ...state.reputation, fame: 100, reliability: 100 };
    for (const f of FACTION_LIST) {
      if (f.kind === 'house') state.reputation = withStanding(state.reputation, f.id, 100);
    }
    let taken = 0;
    for (let i = 0; i < GALAXY.count && taken < worlds; i++) {
      if (GALAXY.hasFlag(i, 'capital')) continue;
      if (FACTIONS.get(ownerOf(state.deltas, i))?.kind !== 'house') continue;
      state.deltas = withDelta(state.deltas, GALAXY.id(i), { owner: PLAYER_ACTOR_ID });
      taken++;
    }
    state.war = syncDomainEconomy(state.war, state.worldSeed, state.deltas, state.company.cbills);
    return state;
  }

  it('с Домом держава воюет, только когда отношения испорчены — тогда на общих правах', () => {
    const big = realm(21, 1);
    // Вражда с соседом заведена руками: живая матрица стартует с нейтралитета,
    // и это и есть предохранитель — чтобы стать целью, надо испортить отношения.
    const mine = domainTally(big.worldSeed, big.deltas).worlds[0] as number;
    const foe = GALAXY.neighbors(mine).find(
      (j) => ownerOf(big.deltas, j) !== PLAYER_ACTOR_ID,
    ) as number;
    const who = ownerOf(big.deltas, foe);
    const calm = frontSectors(big.war, big.reputation, big.deltas, big.day);
    expect(calm.some((s) => (s.defender === PLAYER_ACTOR_ID && s.attacker === who) || s.attacker === PLAYER_ACTOR_ID && s.defender === who)).toBe(false);
    big.reputation = withRelation(big.reputation, PLAYER_ACTOR_ID, who, -1);

    const sectors = frontSectors(big.war, big.reputation, big.deltas, big.day);
    const mineSectors = sectors.filter((s) => s.defender === PLAYER_ACTOR_ID && s.attacker === who);
    expect(mineSectors.length).toBeGreaterThan(0);
    expect(mineSectors.every((s) => !s.raid)).toBe(true);
    // И рота сама стала стороной наступающей.
    expect(sectors.some((s) => s.attacker === PLAYER_ACTOR_ID && s.defender === who)).toBe(true);
  });

  it('полки ставятся в строй за деньги и упираются в потолок державы (мощность, призыв, постройки, титул — шаг 90)', () => {
    const state = realm(22, 6);
    const capacity = economyOf(state.war, PLAYER_ACTOR_ID).capacity;
    const cap = realmArmyCap(state.deltas, capacity).total;
    // Шаг 90: сверх мощности — призыв за каждый мир державы.
    expect(cap).toBeGreaterThanOrEqual(armyTarget(capacity) + domainTally(state.worldSeed, state.deltas).worlds.length * WAR.domain.armyPerWorld);
    expect(cap).toBeGreaterThan(0);

    const before = state.company.cbills;
    run(state, { kind: 'raiseRegiment', mechs: 10 });
    expect(totalArmy(state.war, PLAYER_ACTOR_ID)).toBe(10);
    expect(state.company.cbills).toBe(before - 10 * WAR.economy.mechCost);

    // Выше потолка не растят, сколько бы денег ни было.
    run(state, { kind: 'raiseRegiment', mechs: 100_000 });
    expect(totalArmy(state.war, PLAYER_ACTOR_ID)).toBe(cap);
    expect(execute(state, { kind: 'raiseRegiment', mechs: 1 }).ok).toBe(false);

    // Роспуск возвращает половину цены и снимает полки сперва с резерва.
    const cash = state.company.cbills;
    run(state, { kind: 'raiseRegiment', mechs: -cap });
    expect(totalArmy(state.war, PLAYER_ACTOR_ID)).toBe(0);
    expect(state.company.cbills).toBeGreaterThan(cash);
  });

  it('полки роты развозит по направлениям та же логистика, что у фракций', () => {
    const state = realm(23, 6);
    const mine = domainTally(state.worldSeed, state.deltas).worlds[0] as number;
    const foe = GALAXY.neighbors(mine).find(
      (j) => ownerOf(state.deltas, j) !== PLAYER_ACTOR_ID,
    ) as number;
    const who = ownerOf(state.deltas, foe);
    state.reputation = withRelation(state.reputation, PLAYER_ACTOR_ID, who, -1);
    run(state, { kind: 'raiseRegiment', mechs: 40 });

    run(state, { kind: 'advanceTo', day: nextEconomyTickDay(state.day) });
    expect(theaterOf(state.war, PLAYER_ACTOR_ID, who)).toBeGreaterThan(0);
    expect(totalArmy(state.war, PLAYER_ACTOR_ID)).toBe(40);
  });

  it('казна державы игрока — проекция кассы, а не второй кошелёк', () => {
    const state = realm(24, 4);
    run(state, { kind: 'advanceTo', day: nextEconomyTickDay(state.day) });
    expect(economyOf(state.war, PLAYER_ACTOR_ID).treasury).toBe(state.company.cbills);
    // И военного фонда у роты не заводится: деньги роты тратит только игрок.
    expect(state.war.funds[PLAYER_ACTOR_ID]).toBeUndefined();
  });

  it('театры роты переживают круг через сохранение', () => {
    const state = realm(25, 6);
    run(state, { kind: 'raiseRegiment', mechs: 30 });
    const back = restore(snapshot(state));
    expect(totalArmy(back.war, PLAYER_ACTOR_ID)).toBe(30);
    expect(back.war.theaters).toEqual(state.war.theaters);
  });
});

describe('память мира о роте (шаг 27a, часть B)', () => {
  it('мир без записи ничем не отличается от выводимого', () => {
    // Дисциплина третьего слоя: отсутствие записи и есть «ничего не было».
    expect(memoryOf(NO_DELTAS, GALAXY.id(0))).toBeUndefined();
  });

  it('планета помнит бои, победы, нанимателя и год', () => {
    const id = GALAXY.id(0);
    let deltas = withWorldMemory(NO_DELTAS, id, 'davion', true, 3053);
    deltas = withWorldMemory(deltas, id, 'davion', false, 3054);
    deltas = withWorldMemory(deltas, id, 'kurita', true, 3055);
    const memory = memoryOf(deltas, id);
    expect(memory).toEqual({ fought: 3, won: 2, forWhom: 'kurita', year: 3055 });
    // И только у того мира, где рота была: соседи чисты.
    expect(memoryOf(deltas, GALAXY.id(1))).toBeUndefined();
    expect(Object.keys(deltas).length).toBe(1);
  });

  it('запись переживает круг через сохранение', () => {
    const state = new CampaignState(31);
    state.deltas = withWorldMemory(state.deltas, GALAXY.id(7), 'marik', true, 3053);
    const back = restore(snapshot(state));
    expect(memoryOf(back.deltas, GALAXY.id(7))?.forWhom).toBe('marik');
  });
});

/**
 * ТРИ ДВЕРИ К ПЕРВОМУ МИРУ (шаг 38).
 *
 * До шага 38 дверь была одна — покупка, и она вела в тупик, который план назвал
 * ПАРАДОКСОМ АНКЛАВА: репутацию проще всего набить там, где нет войны, то есть в
 * глубоком тылу дружественного Дома. Купив мир там, игрок оказывался в кольце
 * союзных систем, а наступления считаются строго между смежными — расширяться
 * силой было некуда вовсе.
 *
 * Теперь дверей три, и каждая под свой стиль: купить (деньги), захватить (сила),
 * принять в лен (служба). Проверяется, что каждая открывается СВОИМ ключом и не
 * открывается чужим.
 */
describe('первый мир: три двери', () => {
  function run(state: CampaignState, command: CampaignCommand): void {
    const result = execute(state, command);
    if (!result.ok) throw new Error(`Команда ${command.kind} отклонена: ${result.reason}`);
  }

  /** Команда, которая обязана быть отклонена ИМЕННО ЭТОЙ причиной. */
  function expectRejected(
    state: CampaignState,
    command: CampaignCommand,
    reason: CampaignRejectReason,
  ): void {
    const result = execute(state, command);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe(reason);
  }

  /** Первый мир указанного вида владельца. */
  function worldOf(state: CampaignState, kind: string): { i: number; id: string; owner: string } {
    for (let i = 0; i < GALAXY.count; i++) {
      if (GALAXY.hasFlag(i, 'capital')) continue;
      const owner = ownerOf(state.deltas, i);
      if (FACTIONS.get(owner)?.kind !== kind) continue;
      return { i, id: GALAXY.id(i), owner };
    }
    throw new Error(`в каталоге нет мира с владельцем вида «${kind}»`);
  }

  /** Записать в память мира победы роты — тем же швом, что и разбор контракта. */
  function withWins(state: CampaignState, id: string, employer: string, wins: number): void {
    for (let n = 0; n < wins; n++) {
      state.deltas = withWorldMemory(state.deltas, id, employer, true, 3053);
    }
  }

  it('ЗАХВАТ: пиратский мир берётся силой, но только вычищенный и заслуженный', () => {
    const state = new CampaignState(3);
    const target = worldOf(state, 'pirates');
    state.systemId = target.id;

    // Ни побед, ни зачистки — флага не поднять.
    expectRejected(state, { kind: 'conquerWorld' }, CampaignRejectReason.WorldNotConquerable);

    // Победы есть, логово не вычищено — всё ещё нет. Захват это ПРОДОЛЖЕНИЕ
    // зачистки (шаг 37a), а не отдельная механика.
    withWins(state, target.id, 'davion', WAR.domain.conquerWins);
    expectRejected(state, { kind: 'conquerWorld' }, CampaignRejectReason.WorldNotConquerable);

    // Логово вычищено — флаг поднят, и денег это не стоило; казна мира — трофеями в кассу (шаг 90, ступень 8).
    while (clearedOf(state.deltas, target.id) < WAR.domain.conquerCleared) {
      state.deltas = withPirateClearing(state.deltas, target.i);
    }
    const cbills = state.company.cbills;
    const loot = Math.round(worldContributionAt(state.worldSeed, state.deltas, target.i).income * WAR.domain.captureLootTicks);
    run(state, { kind: 'conquerWorld' });
    expect(ownerOf(state.deltas, target.i)).toBe(PLAYER_ACTOR_ID);
    expect(state.company.cbills).toBe(cbills + loot);
  });

  it('ЗАХВАТ: мир Дома силой не берётся ни при каких заслугах', () => {
    // У Дома есть армия, и рота из четырёх машин её не отменяет. Это и есть
    // граница между «наёмник влияет» и «наёмник переворачивает державу».
    const state = new CampaignState(3);
    const house = worldOf(state, 'house');
    state.systemId = house.id;
    withWins(state, house.id, house.owner, 20);
    state.deltas = withPirateClearing(state.deltas, house.i);
    expectRejected(state, { kind: 'conquerWorld' }, CampaignRejectReason.WorldNotConquerable);
  });

  it('ЛЕН: жалуют ПРИГРАНИЧНЫЙ мир, а тыловой — нет', () => {
    // Ровно то, чем лен отличается от покупки: Дом решает свою проблему чужими
    // руками и ставит наёмника щитом на неспокойной окраине, а не отдаёт кусок
    // спокойного ядра.
    const state = new CampaignState(3);
    const D = WAR.domain;

    let border = -1;
    let rear = -1;
    for (let i = 0; i < GALAXY.count && (border < 0 || rear < 0); i++) {
      if (GALAXY.hasFlag(i, 'capital')) continue;
      if (FACTIONS.get(ownerOf(state.deltas, i))?.kind !== 'house') continue;
      const fi = frontierIndexAt(state.deltas, state.reputation, state.war, i);
      if (fi >= D.grantFrontier && border < 0) border = i;
      if (fi === 0 && rear < 0) rear = i;
    }
    expect(border).toBeGreaterThanOrEqual(0);
    expect(rear).toBeGreaterThanOrEqual(0);

    const arm = (i: number): void => {
      const owner = ownerOf(state.deltas, i);
      state.systemId = GALAXY.id(i);
      state.reputation = { ...withStanding(state.reputation, owner, 100), fame: 100 };
      withWins(state, GALAXY.id(i), owner, D.grantWins);
    };

    arm(rear);
    expectRejected(state, { kind: 'claimGrant' }, CampaignRejectReason.GrantNotOffered);

    arm(border);
    const cbills = state.company.cbills;
    run(state, { kind: 'claimGrant' });
    expect(ownerOf(state.deltas, border)).toBe(PLAYER_ACTOR_ID);
    // Землю жалуют, а не продают.
    expect(state.company.cbills).toBe(cbills);
  });

  it('ЛЕН: без службы ИМЕННО ЗДЕСЬ и без известности не жалуют', () => {
    const state = new CampaignState(3);
    const D = WAR.domain;
    let border = -1;
    for (let i = 0; i < GALAXY.count && border < 0; i++) {
      if (GALAXY.hasFlag(i, 'capital')) continue;
      if (FACTIONS.get(ownerOf(state.deltas, i))?.kind !== 'house') continue;
      if (frontierIndexAt(state.deltas, state.reputation, state.war, i) >= D.grantFrontier) border = i;
    }
    expect(border).toBeGreaterThanOrEqual(0);
    const owner = ownerOf(state.deltas, border);
    state.systemId = GALAXY.id(border);

    // Отношение есть, известности нет.
    state.reputation = withStanding(state.reputation, owner, 100);
    withWins(state, state.systemId, owner, D.grantWins);
    expectRejected(state, { kind: 'claimGrant' }, CampaignRejectReason.GrantNotOffered);

    // Известность есть, но воевала рота здесь ЗА ДРУГОГО.
    state.reputation = { ...state.reputation, fame: 100 };
    state.deltas = withWorldMemory(state.deltas, state.systemId, 'pirates', true, 3053);
    expectRejected(state, { kind: 'claimGrant' }, CampaignRejectReason.GrantNotOffered);
  });

  it('все три двери ведут в одно и то же владение', () => {
    // Три способа стать владельцем — нормально; три способа СТАТЬ ИМ В СОСТОЯНИИ
    // разошлись бы через месяц, и одна из дверей однажды забыла бы снять мир с
    // экономики прежнего хозяина. Шов передачи владения обязан быть один.
    const state = new CampaignState(3);
    const target = worldOf(state, 'pirates');
    state.systemId = target.id;
    withWins(state, target.id, 'davion', WAR.domain.conquerWins);
    while (clearedOf(state.deltas, target.id) < WAR.domain.conquerCleared) {
      state.deltas = withPirateClearing(state.deltas, target.i);
    }
    const before = economyOf(state.war, target.owner);
    run(state, { kind: 'conquerWorld' });

    // Мир ушёл из экономики прежнего хозяина и попал в домен роты — тем же
    // приращением, что и при покупке.
    expect(economyOf(state.war, target.owner).worlds).toBe(before.worlds - 1);
    expect(domainWorlds(state.deltas)).toContain(target.i);
  });
});

import { describe, expect, it } from 'vitest';
import {
  EMPTY_TALLY,
  CONTRACTS,
  CampaignRejectReason,
  CampaignState,
  FACTIONS,
  GALAXY,
  judgedContracts,
  effectiveSalvageShare,
  MISSION_TYPES,
  REFERENCE_MECH_VALUE,
  availableContracts,
  buildForce,
  buildOpfor,
  canExecute,
  companyRating,
  contractBoard,
  contractBrief,
  mapSizeFor,
  contractDecadeOf,
  contractIntel,
  contractThreat,
  contractsFileSchema,
  enemiesOf,
  enmity,
  frontierField,
  frontierIndex,
  frontierIndexAt,
  clearedOf,
  regrowPirates,
  withPirateClearing,
  pirateRisk,
  PIRATE_FACTION,
  execute,
  hashCampaignState,
  lanceThreat,
  lanceTonnageThreat,
  makeCompany,
  makeRecord,
  isLegal,
  makeSaveFile,
  marketProfile,
  mechValue,
  missionsAt,
  opforCount,
  parseSaveFile,
  recordToUnit,
  relationsFileSchema,
  restore,
  salvageOffer,
  missionObjective,
  snapshot,
  treatmentDays,
  systemProfile,
  type CampaignCommand,
  type CampaignEvent,
  type Company,
  type Contract,
  type BattleOutcome,
  type MechRecord,
} from '../src/core/campaign/index.js';
import { Direction } from '../src/core/hex/index.js';
import { HitZone, type MechUnit, type Pilot } from '../src/core/model/index.js';
import { ForceFamilies, generateAssembly, makePilot } from '../src/core/rules/index.js';
import { Rng } from '../src/core/rng/index.js';
import { CONSTRUCTION, ECONOMY } from '../src/core/data/tables.js';
import { actualForce } from '../src/core/campaign/contracts/intel.js';

/**
 * Шаг 16 — контракты и наниматели: вертикальный срез замыкается headless.
 *
 * Проверяется ровно то, на чём стоит шаг: биржа выводится, а не хранится;
 * глубина вражды открывает типы миссий; противник берётся из соседства, а не
 * со всей карты; оплата выставлена ОТНОСИТЕЛЬНО `mechValue`; доля трофеев из
 * условий контракта соблюдается; срок срабатывает через очередь суток; и
 * `ResolveContract` — единственный шов, которым бой попадает в роту.
 */

const CODE = 'IS-H55-R3F2';
const WORLD = 1;

function freshRecord(id: string, seed = 1, code = CODE): MechRecord {
  return makeRecord({ id, assembly: generateAssembly({ chassisCode: code, role: 'brawler' }, new Rng(seed)) });
}

function crew(id: string, tier = 4): Pilot {
  return makePilot(new Rng(7), { id, callsign: id, tier });
}

/**
 * Рота из четырёх машин с пилотами — звено, которым можно выйти на контракт.
 *
 * Корабль — `union` (вместимость 12), а не стартовый `leopard` (4): большинство
 * контрактных тестов вылетают полным звеном и ждут трофеи на борт, и лимит
 * ангара по кораблю (шаг про DropShip) — отдельная проверка (`refit.test.ts`),
 * а не то, что должно тесно сжимать сценарии этого файла.
 */
function lanceCompany(): Partial<Company> {
  const mechs: MechRecord[] = [];
  const pilots: Pilot[] = [];
  for (let i = 1; i <= 4; i++) {
    const pilotId = `P-${i}`;
    mechs.push({ ...freshRecord(`M-${i}`, i), pilotId });
    pilots.push(crew(pilotId));
  }
  // Юнион выкуплен до потолка (шаг 75): места под трофеи сценариям не мешают.
  return { mechs, pilots, cbills: 2_000_000, dropship: 'union', hangar: ECONOMY.dropships.union.mechCapacity };
}

function stateAt(systemId: string, company: Partial<Company> = lanceCompany()): CampaignState {
  const state = new CampaignState(1, { worldSeed: WORLD, systemId });
  state.company = { ...makeCompany(), ...company };
  return state;
}

function run(state: CampaignState, command: CampaignCommand): readonly CampaignEvent[] {
  const result = execute(state, command);
  if (!result.ok) throw new Error(`Команда ${command.kind} отклонена: ${result.reason}`);
  return result.events;
}

/**
 * Первая система, у которой биржа непуста. Перебором — чтобы фикстура не
 * рассыпалась от правки каталога.
 *
 * Экономика фракций передаётся ОБЯЗАТЕЛЬНО (шаг 21b): с починки решения 7
 * оплата контракта зависит от снабжения противника и напряжённости участка,
 * поэтому биржа без `war` — это другая биржа, а не та же самая с округлением.
 * Тесты, сверяющие аванс и неустойку с тем, что списала команда, иначе сверяли
 * бы два разных предложения.
 */
const WAR_AT_START = new CampaignState(1, { worldSeed: WORLD }).war;

function systemWithOffers(from = 0): { id: string; offers: readonly Contract[] } {
  for (let i = from; i < GALAXY.count; i++) {
    const id = GALAXY.id(i);
    const offers = contractBoard(WORLD, {}, id, 0, undefined, WAR_AT_START);
    if (offers.length > 0) return { id, offers };
  }
  throw new Error('Ни одной системы с контрактами — это не тест, это сломанные данные');
}

/**
 * Итог боя, собранный вручную: разбор чистый, и настоящий бой ему не нужен —
 * тот же приём, что в `test/debrief.test.ts`.
 */
function outcomeFor(
  state: CampaignState,
  opts: {
    readonly playerWins: boolean;
    readonly companyDestroyed?: readonly string[];
    /** Сколько машин противника остаётся на ходу: с ними победа перестаёт быть разгромом. */
    readonly opforSurvivors?: number;
  },
): BattleOutcome {
  const brief = contractBrief(state);
  const destroyed = new Set(opts.companyDestroyed ?? []);
  const unitOf = (record: MechRecord, pilot: Pilot, side: 'player' | 'opfor'): MechUnit =>
    recordToUnit(record, pilot, { q: 0, r: 0 }, Direction.NE, side);

  return {
    winner: opts.playerWins ? 'player' : 'opfor',
    heldField: opts.playerWins,
    units: [
      ...brief.company.map((p) => ({
        recordId: p.record.id,
        side: 'player' as const,
        unit: { ...unitOf(p.record, p.pilot, 'player'), destroyed: destroyed.has(p.record.id) },
        ...EMPTY_TALLY,
      })),
      ...brief.enemy.map((p, i) => ({
        recordId: p.record.id,
        side: 'opfor' as const,
        unit: {
          ...unitOf(p.record, p.pilot, 'opfor'),
          destroyed: opts.playerWins && i >= (opts.opforSurvivors ?? 0),
        },
        ...EMPTY_TALLY,
      })),
    ],
  };
}

// --- данные -------------------------------------------------------------------

describe('данные контрактов', () => {
  it('схемы отсекают опечатку, а не пропускают её молча', () => {
    const good = contractsFileSchema.safeParse(CONTRACTS);
    expect(good.success).toBe(true);
    // Лишний ключ: опечатка в имени поля иначе теряется молча.
    expect(contractsFileSchema.safeParse({ ...CONTRACTS, lance: 4 }).success).toBe(false);
    // Незнакомый вид актора в матрице вражды — опечатка, а не расширение формата.
    expect(
      relationsFileSchema.safeParse({
        default: 0.1,
        kinds: [{ a: 'аристократия', b: 'house', enmity: 0.5 }],
        pairs: [],
      }).success,
    ).toBe(false);
    // Вражда вне 0..1 — не «очень сильная вражда», а ошибка.
    expect(
      relationsFileSchema.safeParse({ default: 0.1, kinds: [], pairs: [{ a: 'kurita', b: 'davion', enmity: 5 }] })
        .success,
    ).toBe(false);
  });
});

// --- вражда -------------------------------------------------------------------

describe('вражда фракций', () => {
  it('симметрична и не бывает с самим собой', () => {
    expect(enmity('kurita', 'davion')).toBe(enmity('davion', 'kurita'));
    expect(enmity('kurita', 'kurita')).toBe(0);
  });

  it('явная пара перебивает вид, вид перебивает умолчание', () => {
    // Штайнер и Дэвион — Федеративное Содружество: явная пара ниже, чем «дом против дома».
    expect(enmity('steiner', 'davion')).toBeLessThan(enmity('steiner', 'marik'));
    // Клан против Дома задан видом и заметно выше умолчания.
    expect(enmity('jade_falcon', 'steiner')).toBeGreaterThan(enmity('independent', 'comstar'));
  });

  it('чем глубже вражда, тем тяжелее типы миссий', () => {
    const shallow = missionsAt(0.1);
    const deep = missionsAt(0.95);
    expect(shallow).toContain('garrison');
    expect(shallow).not.toContain('assault');
    expect(deep).toEqual([...MISSION_TYPES]);
    // Список типов только растёт с враждой — иначе «дороже и тяжелее» не выполняется.
    for (const m of shallow) expect(deep).toContain(m);
  });

  it('врагов ищут по порогу, а не по всему реестру', () => {
    const all = enemiesOf('davion', 0);
    const hostile = enemiesOf('davion', 0.5);
    expect(hostile.length).toBeLessThan(all.length);
    expect(hostile.map((e) => e.id)).toContain('kurita');
    expect(hostile.map((e) => e.id)).not.toContain('steiner');
  });
});

// --- биржа --------------------------------------------------------------------

describe('биржа контрактов', () => {
  it('воспроизводима по (сид мира, система, декада) и различается по каждому из трёх', () => {
    const { id, offers } = systemWithOffers();
    expect(contractBoard(WORLD, {}, id, 0, undefined, WAR_AT_START)).toEqual(offers);

    const otherWorld = contractBoard(WORLD + 1, {}, id, 0, undefined, WAR_AT_START);
    const otherDecade = contractBoard(WORLD, {}, id, CONTRACTS.board.decadeDays, undefined, WAR_AT_START);
    expect(otherWorld).not.toEqual(offers);
    expect(otherDecade).not.toEqual(offers);

    const other = systemWithOffers(GALAXY.require(id) + 1);
    expect(other.offers).not.toEqual(offers);
  });

  it('декада привязана ко дню кампании, а не к числу заходов', () => {
    const { id } = systemWithOffers();
    const d = CONTRACTS.board.decadeDays;
    expect(contractBoard(WORLD, {}, id, 0)).toEqual(contractBoard(WORLD, {}, id, d - 1));
    expect(contractBoard(WORLD, {}, id, d)).not.toEqual(contractBoard(WORLD, {}, id, d - 1));
    expect(contractDecadeOf(d - 1)).toBe(0);
    expect(contractDecadeOf(d)).toBe(1);
  });

  it('противник берётся из соседства, а не со всей карты', () => {
    // Миры в глубине Сферы: клановые зоны оккупации отсюда в сотнях световых
    // лет, и работы против клана здесь быть не может.
    //
    // Проверка идёт по НЕСКОЛЬКИМ мирам, а не по одному Аутричу, как было до
    // шага 37a. Причина в самом шаге: биржа мира, где вольницы нет, а чужих
    // флагов рядом тоже нет, теперь может оказаться ПУСТОЙ — и Аутрич, столица
    // Волчьих Драгун с их гарнизоном, ровно такой мир. Пустая биржа здесь не
    // поломка, а следствие: на Аутриче некого нанимать против кого.
    const deep = ['outreach', 'galatea', 'solaris-vii', 'northwind', 'new-avalon', 'atreus'];
    const targets = new Set<string>();
    for (const id of deep) {
      for (const c of contractBoard(WORLD, {}, id, 0)) targets.add(c.target);
    }
    for (const target of targets) {
      expect(FACTIONS.get(target)?.kind, `цель ${target}`).not.toBe('clan');
    }
    expect(targets.size).toBeGreaterThan(0);
  });

  it('наниматель — владелец системы, а вражда с целью выше порога', () => {
    const { id, offers } = systemWithOffers();
    const owner = GALAXY.ownerId(GALAXY.require(id));
    for (const c of offers) {
      expect(c.employer).toBe(owner);
      expect(c.target).not.toBe(owner);
      expect(c.enmity).toBeGreaterThanOrEqual(CONTRACTS.board.minEnmity);
      expect(missionsAt(c.enmity)).toContain(c.mission);
      expect(c.biome).toBe(systemProfile(WORLD, id).biome);
    }
  });

  it('чистая функция: генерация не трогает ни состояние, ни ГПСЧ', () => {
    const state = stateAt('outreach');
    const before = hashCampaignState(state);
    contractBoard(state.worldSeed, state.deltas, state.systemId, state.day);
    availableContracts(state.worldSeed, state.deltas, state.systemId, state.day);
    expect(hashCampaignState(state)).toBe(before);
  });
});

// --- оплата -------------------------------------------------------------------

describe('оплата контракта', () => {
  it('выставлена относительно стоимости машины, а не абсолютным числом', () => {
    // Главное решение шага 16 (вход брифинга): единица измерения — эталонная
    // серийная машина роты, и оплата контракта — доля от неё.
    expect(REFERENCE_MECH_VALUE).toBeGreaterThan(500_000);

    const payouts: number[] = [];
    for (let i = 0; i < 300; i++) {
      for (const c of contractBoard(WORLD, {}, GALAXY.id(i), 0)) payouts.push(c.payout / REFERENCE_MECH_VALUE);
    }
    expect(payouts.length).toBeGreaterThan(100);
    // МЕДИАНА, а не среднее, и это правка шага 44: с абсолютными контрактами у
    // биржи появился длинный хвост — ротная и батальонная работа платит в разы
    // больше обычной и тянет среднее вверх, ничего не говоря о том, за сколько
    // работает рота изо дня в день. Коридор же проверяет именно обычную работу.
    const sorted = [...payouts].sort((a, b) => a - b);
    const middle = sorted[Math.floor(sorted.length / 2)] as number;
    // Заглушка шага 15 давала 0.067 эталонной машины за контракт — из-за неё
    // одна проданная трофейная машина стоила семи контрактов. Коридор проверяет
    // именно то, что этого больше нет: контракт стоит заметной доли машины и
    // при этом не покупает её целиком.
    expect(middle).toBeGreaterThan(0.12);
    expect(middle).toBeLessThan(0.45);
  });

  it('чем тяжелее тип миссии, тем дороже — и ЭТО ЕДИНСТВЕННАЯ ручка типа в цене', () => {
    // Сравниваются таблицы, а не выборка: разброс биржи иначе перекрыл бы
    // разницу между соседними типами.
    let prevPay = 0;
    for (const m of MISSION_TYPES) {
      const row = CONTRACTS.missions[m];
      expect(row.payFactor).toBeGreaterThan(prevPay);
      prevPay = row.payFactor;
      // Второго множителя типа в строке нет с шага 56: `strength` правила цену
      // вторым разом, хотя число машин с шага 44 от неё не зависит вовсе.
      expect(row).not.toHaveProperty('strength');
    }
  });

  it('аванс, неустойка и доля трофеев — доли оплаты, а не отдельные числа', () => {
    const { offers } = systemWithOffers();
    for (const c of offers) {
      const row = CONTRACTS.missions[c.mission];
      expect(c.advance).toBe(Math.round(c.payout * row.advanceShare));
      expect(c.penalty).toBe(Math.round(c.payout * row.penaltyShare));
      expect(c.salvageShare).toBe(row.salvageShare);
      expect(c.advance).toBeLessThan(c.payout);
    }
  });
});

// --- состав противника --------------------------------------------------------

describe('состав противника', () => {
  it('тип отряда задаёт классы исполнения по таблице снаряжения', () => {
    const state = stateAt('outreach');
    const lance = state.company.mechs;

    const seen: Record<string, Set<string>> = {};
    for (let i = 0; i < 400; i++) {
      for (const c of contractBoard(WORLD, {}, GALAXY.id(i), 0)) {
        const set = (seen[c.opforType] ??= new Set());
        for (const p of buildOpfor(c, lance, 1234 + i)) {
          const q = p.record.assembly.quality!;
          set.add(q.reactor);
          set.add(q.frame);
        }
      }
    }

    // Ополчение не выходит на армейском и мастерском — у такой части их нет.
    expect([...(seen['militia'] ?? [])].sort()).toEqual(['recovered', 'standard']);
    // Гвардия не выходит на восстановленном хламе.
    expect(seen['guard']).toBeDefined();
    expect(seen['guard']!.has('recovered')).toBe(false);
    expect(seen['guard']!.has('military')).toBe(true);
  });

  it('клановая цель выходит на клановой технике, сферная — на сферной', () => {
    const clanContract: Contract = { ...systemWithOffers().offers[0]!, target: 'jade_falcon', opforType: 'clan', opforTechBase: 'clan' };
    const lance = stateAt('outreach').company.mechs;
    const units = buildOpfor(clanContract, lance, 99);
    expect(units.length).toBeGreaterThan(0);
    for (const p of units) expect(p.record.assembly.techBase).toBe('clan');
  });

  // Шаг 71: доктрины Домов сняты — оружие противника решает семейство по биому.
  it('Дом больше не решает роли: Марик и Курита на одном биоме выходят одинаково', () => {
    const base = systemWithOffers().offers[0]!;
    const lance = stateAt('outreach').company.mechs;
    for (let s = 0; s < 20; s++) {
      const roles = (target: string): string[] =>
        buildOpfor({ ...base, target }, lance, s).map((p) => p.record.assembly.role);
      expect(roles('marik'), `сид ${s}`).toEqual(roles('kurita'));
    }
  });

  it('биом решает вооружение: у тяжёлых Сферы в пустыне РДД больше, чем в джунглях (шаг 71b)', () => {
    // Турнир `pnpm familystat`: ракетчик у тяжёлых Сферы на открытых картах
    // почти наравне с гауссом, в джунглях — далеко позади (РДД бьёт от 6 гексов).
    const lrms = (biome: string): number => {
      let n = 0;
      for (let s = 0; s < 120; s++) {
        const force = buildForce(
          // Пара машин: специалисты звена (два ракетчика на четыре) не включаются,
          // и работает только таблица биома.
          { count: 2, factionId: 'davion', biome, opforType: 'line', techBase: 'is', supply: 1, tonnageCap: 75, tonnageMin: 60, idPrefix: 'T' },
          s,
        );
        for (const p of force) n += p.record.assembly.items.filter((it) => /^is_lrm\d+$/.test(it.id)).length;
      }
      return n;
    };
    expect(lrms('desert')).toBeGreaterThan(lrms('jungle') * 1.3);
  });

  it('ракетчиков — не больше половины состава, специалисты звена выходят первыми', () => {
    // Решение пользователя 2026-09-25: из четырёх машин ракетчиков может быть два.
    for (const count of [1, 2, 4, 8]) {
      for (let s = 0; s < 200; s++) {
        const draw = new ForceFamilies(count, 'clan', 'desert');
        const rng = new Rng(s);
        const fams = Array.from({ length: count }, () => draw.next(90, rng));
        const cap = Math.max(1, Math.floor(count * CONSTRUCTION.roles.familyMaxShare.missile!));
        expect(fams.filter((f) => f === 'missile').length, `${count} машин, сид ${s}`).toBeLessThanOrEqual(cap);
      }
    }
    // Без биома — ни семейства, ни жребия: машина собирается по ролям, как до шага.
    const rng = new Rng(1);
    expect(new ForceFamilies(4, 'is', undefined).next(90, rng)).toBeUndefined();
    expect(rng.next()).toBe(new Rng(1).next());
  });

  it('СИЛЫ ПРОТИВНИКА — СВОЙСТВО ПРЕДЛОЖЕНИЯ, а не выведенного звена (шаг 44)', () => {
    // Суть плана Б: мир перестал зеркалить роту. Сколько машин выйдет и какого
    // они веса, сказано в предложении — и не меняется от того, кто и чем на
    // контракт вышел. Без этого рост отменял сам себя: привёз больше машин —
    // врагов стало больше, купил тяжёлые — враг стал тяжёлым.
    const { offers } = systemWithOffers();
    const c = offers.find((o) => o.opforUnits >= 2) ?? offers[0]!;
    expect(opforCount(c)).toBe(c.opforUnits);
    expect(c.opforUnits).toBeGreaterThanOrEqual(1);
    expect(c.opforUnits).toBeLessThanOrEqual(CONTRACTS.opfor.maxUnits);

    // Одно и то же предложение выставляет один и тот же состав против лёгкой
    // тройки и против тяжёлой четвёрки.
    const light = [freshRecord('L-1', 3, 'IS-H35-R3F1')];
    const heavy = [
      freshRecord('H-1', 1, 'IS-H75-R3F3'),
      freshRecord('H-2', 2, 'IS-H75-R3F3'),
      freshRecord('H-3', 3, 'IS-H75-R3F3'),
      freshRecord('H-4', 4, 'IS-H75-R3F3'),
    ];
    // Сверка с ФАКТОМ разведки, а не со сводкой: с шага 57 на поле выходит
    // `actualForce`, и при достоверности ниже единицы и число машин, и потолок
    // тоннажа законно расходятся с карточкой (на сиде 5 у этого контракта
    // потолок 80 т при заявленных 75). До 2026-09-22 тест сверял со сводкой и
    // проходил, пока жребий машин случайно не упирался в объявленный вес.
    const fact = actualForce(c, 5);
    expect(buildOpfor(c, light, 5).length).toBe(fact.units);
    expect(buildOpfor(c, heavy, 5).length).toBe(fact.units);

    // Вес машин противника идёт от контракта, а не от звена: против лёгкой
    // тройки выходит ровно то же, что против тяжёлой четвёрки.
    const againstLight = buildOpfor(c, light, 5).map((p) => p.record.assembly.tonnage);
    const againstHeavy = buildOpfor(c, heavy, 5).map((p) => p.record.assembly.tonnage);
    expect(againstLight).toEqual(againstHeavy);
    for (const tons of againstLight) {
      expect(tons).toBeLessThanOrEqual(fact.tonnageCap);
    }
  });

  it('на бирже есть и мелкая работа, и крупная (шаг 44)', () => {
    // Разброс — это то, ради чего затевался план Б: стартовой роте есть за что
    // браться, а расти есть куда. Меряется по всей карте, а не по одной системе:
    // масштаб — свойство мира, и в захолустье батальонной работы не бывает.
    const seen = new Set<number>();
    let biggest = 0;
    for (let i = 0; i < GALAXY.count; i += 7) {
      for (const o of judgedContracts(WORLD, {}, GALAXY.id(i), 0, undefined, undefined)) {
        seen.add(o.contract.opforUnits);
        biggest = Math.max(biggest, o.contract.opforUnits);
      }
    }
    expect(Math.min(...seen)).toBeLessThanOrEqual(2);
    expect(biggest).toBeGreaterThanOrEqual(10);
  });

  it('за больший бой платят больше (шаг 44)', () => {
    // Половина плана Б: гонорар считается от ОПИСАННЫХ сил. Проверяется на одном
    // типе работы, иначе сравнивались бы payFactor разных миссий, а не размер.
    const rows: { force: number; payout: number }[] = [];
    for (let i = 0; i < GALAXY.count; i += 5) {
      for (const o of judgedContracts(WORLD, {}, GALAXY.id(i), 0, undefined, undefined)) {
        if (o.contract.mission !== 'raid') continue;
        rows.push({ force: o.contract.opforUnits * o.contract.opforTons, payout: o.contract.payout });
      }
    }
    expect(rows.length).toBeGreaterThan(50);
    rows.sort((a, b) => a.force - b.force);
    const quarter = Math.floor(rows.length / 4);
    const small = rows.slice(0, quarter).reduce((s, r) => s + r.payout, 0) / quarter;
    const big = rows.slice(-quarter).reduce((s, r) => s + r.payout, 0) / quarter;
    expect(big).toBeGreaterThan(small * 2);
  });

  it('вылет ограничен вместимостью судна, а не копьём (шаг 44d)', () => {
    // Копьё осталось единицей измерения, но перестало быть потолком: потолок —
    // открытые ячейки ангара (шаг 75), у нового Леопарда их четыре, у Юниона —
    // восемь. Нижнего предела нет — вывести меньше можно всегда, и это решение
    // игрока, а не лазейка.
    const { id, offers } = systemWithOffers();
    const big = (dropship: 'leopard' | 'union', count: number): Partial<Company> => {
      const mechs: MechRecord[] = [];
      const pilots: Pilot[] = [];
      for (let i = 1; i <= count; i++) {
        const pilotId = `P-${i}`;
        mechs.push({ ...freshRecord(`M-${i}`, i), pilotId });
        pilots.push(crew(pilotId));
      }
      // Касса заведомо больше любой платы за высадку (шаг 67): здесь проверяется
      // вместимость судна, а не деньги.
      return { mechs, pilots, cbills: 2_000_000_000, dropship, hangar: ECONOMY.dropships[dropship].minMechs };
    };
    const six = ['M-1', 'M-2', 'M-3', 'M-4', 'M-5', 'M-6'];

    const leopard = stateAt(id, big('leopard', 6));
    run(leopard, { kind: 'takeContract', contractId: offers[0]!.id });
    const denied = execute(leopard, { kind: 'deploy', recordIds: six });
    expect(denied.ok).toBe(false);

    const union = stateAt(id, big('union', 6));
    run(union, { kind: 'takeContract', contractId: offers[0]!.id });
    expect(execute(union, { kind: 'deploy', recordIds: six }).ok).toBe(true);

    // И вывести меньше копья тоже можно: противник от этого не убавится.
    const small = stateAt(id, big('union', 6));
    run(small, { kind: 'takeContract', contractId: offers[0]!.id });
    expect(execute(small, { kind: 'deploy', recordIds: ['M-1'] }).ok).toBe(true);
  });

  it('тяжёлая работа существует до того, как рота до неё доросла (шаг 44)', () => {
    // Стартовая тройка (в среднем 27 т) до шага 44 не могла встретить ничего
    // тяжелее себя ни на одном контракте Сферы. Теперь вес противника — свойство
    // работы: на карте есть и то, что лёгкому отряду не по зубам.
    let heaviest = 0;
    let doable = 0;
    let total = 0;
    const starter = lanceThreat(stateAt('outreach').company, stateAt('outreach').company.mechs);
    for (let i = 0; i < GALAXY.count; i += 5) {
      for (const o of judgedContracts(WORLD, {}, GALAXY.id(i), 0, undefined, undefined)) {
        heaviest = Math.max(heaviest, o.contract.opforTons);
        total++;
        if (contractThreat(o.contract) <= starter) doable++;
      }
    }
    expect(heaviest).toBeGreaterThanOrEqual(60);
    // И при этом стартовая ниша цела: работа по силам лёгкой тройке — не
    // исключение, а заметная часть биржи.
    expect(doable / total).toBeGreaterThan(0.25);
  });

  it('сложность читается до боя, а точный класс — только после разведки', () => {
    // Решение 4 §7 пайплайна: тип отряда виден всегда, класс — за разведку.
    const { offers } = systemWithOffers();
    const c = offers[0]!;
    const blind = contractIntel(c, false);
    const scouted = contractIntel(c, true);
    expect(blind.opforType).toBe(c.opforType);
    expect(blind.expectedUnits).toBeGreaterThan(0);
    expect(blind.quality).toBeNull();
    expect(scouted.quality?.length).toBeGreaterThan(0);
  });

  it('оценка сил обеих сторон в одних единицах, и класс роту усиливает', () => {
    const { offers } = systemWithOffers();
    const c = offers[0]!;
    const standard = stateAt('outreach').company.mechs;
    const military = standard.map((m) => ({
      ...m,
      assembly: { ...m.assembly, quality: { reactor: 'military' as const, frame: 'military' as const } },
    }));
    expect(lanceTonnageThreat(military)).toBeGreaterThan(lanceTonnageThreat(standard));
    expect(contractThreat(c)).toBeGreaterThan(0);

    // Тоннаж и комплектность входят в оценку наравне с классом (шаг 16a): без
    // них бот считал звено из трёх лёгких недокомплектованных машин таким же
    // сильным, как звено из трёх исправных средних, и брался за работу, которой
    // не тянул — 60 кампаний из 70 теряли парк.
    const heavier = standard.map((m) => ({ ...m, id: `${m.id}-h` }));
    expect(lanceTonnageThreat(standard)).toBeGreaterThan(lanceTonnageThreat(standard.slice(0, 2)));
    const stripped = standard.map((m) => ({
      ...m,
      assembly: { ...m.assembly, armorTons: m.assembly.armorTons / 2, items: m.assembly.items.slice(0, 2) },
    }));
    expect(lanceTonnageThreat(stripped)).toBeLessThan(lanceTonnageThreat(heavier));
  });
});

// --- команды ------------------------------------------------------------------

describe('взятие контракта', () => {
  it('аванс зачисляется, срок встаёт в очередь, второй контракт отклоняется', () => {
    const { id, offers } = systemWithOffers();
    const state = stateAt(id);
    const before = state.company.cbills;
    const offer = offers[0]!;

    const events = run(state, { kind: 'takeContract', contractId: offer.id });
    expect(events[0]).toMatchObject({ kind: 'contractTaken', advance: offer.advance });
    expect(state.company.cbills).toBe(before + offer.advance);
    expect(state.contract?.contract.id).toBe(offer.id);
    expect(state.contract?.deadlineDay).toBe(offer.durationDays);
    expect(state.queue.some((e) => e.task.kind === 'contractExpired')).toBe(true);

    const second = execute(state, { kind: 'takeContract', contractId: offers[1]!.id });
    expect(second).toEqual({ ok: false, reason: CampaignRejectReason.ContractActive });
  });

  it('взятое не появляется снова в этой декаде и возвращается в следующей', () => {
    const { id, offers } = systemWithOffers();
    const state = stateAt(id);
    const offer = offers[0]!;
    run(state, { kind: 'takeContract', contractId: offer.id });

    const left = availableContracts(state.worldSeed, state.deltas, id, state.day, state.deltas[id]?.taken ?? []);
    expect(left.map((c) => c.id)).not.toContain(offer.id);

    // Следующая декада — другие предложения и другой список взятого.
    const nextDay = CONTRACTS.board.decadeDays;
    const fresh = availableContracts(state.worldSeed, state.deltas, id, nextDay, []);
    expect(fresh.length).toBeGreaterThan(0);
  });

  it('в пути биржа недоступна: работу берут там, где сидит наниматель', () => {
    const { id, offers } = systemWithOffers();
    const state = stateAt(id);
    const neighbour = GALAXY.neighbors(GALAXY.require(id))[0];
    if (neighbour === undefined) return;
    run(state, { kind: 'travel', systemId: GALAXY.id(neighbour) });
    expect(execute(state, { kind: 'takeContract', contractId: offers[0]!.id })).toEqual({
      ok: false,
      reason: CampaignRejectReason.NotAtMarket,
    });
  });

  it('отклонённая команда не оставляет следа', () => {
    const { id } = systemWithOffers();
    const state = stateAt(id);
    const before = hashCampaignState(state);
    expect(execute(state, { kind: 'takeContract', contractId: 'нет-такого' }).ok).toBe(false);
    expect(execute(state, { kind: 'abandonContract' }).ok).toBe(false);
    expect(execute(state, { kind: 'deploy', recordIds: ['M-1'] }).ok).toBe(false);
    expect(hashCampaignState(state)).toBe(before);
  });
});

describe('срок и разрыв', () => {
  it('провал по сроку срабатывает через очередь суток', () => {
    const { id, offers } = systemWithOffers();
    const state = stateAt(id);
    const offer = offers[0]!;
    run(state, { kind: 'takeContract', contractId: offer.id });
    const cash = state.company.cbills;

    // За день до срока контракт ещё жив.
    run(state, { kind: 'advanceTo', day: offer.durationDays - 1 });
    expect(state.contract).not.toBeNull();

    const events = run(state, { kind: 'advanceTo', day: offer.durationDays });
    expect(events.some((e) => e.kind === 'contractFailed' && e.penalty === offer.penalty)).toBe(true);
    expect(state.contract).toBeNull();
    // Содержание за месяц тоже могло списаться, поэтому проверяется именно
    // разница на неустойку, а не абсолютный баланс.
    expect(state.company.cbills).toBeLessThanOrEqual(cash - offer.penalty);
  });

  it('разрыв возвращает аванс и берёт неустойку, даже если платить нечем', () => {
    const { id, offers } = systemWithOffers();
    const offer = offers[0]!;
    const state = stateAt(id, { ...lanceCompany(), cbills: 0 });
    run(state, { kind: 'takeContract', contractId: offer.id });
    expect(state.company.cbills).toBe(offer.advance);

    const events = run(state, { kind: 'abandonContract' });
    expect(events[0]).toMatchObject({ kind: 'contractAbandoned', charged: offer.advance + offer.penalty });
    expect(state.company.cbills).toBe(-offer.penalty);
    // Неустойка не спрашивает, есть ли чем платить: уход в минус — разорение,
    // а не отказ команды.
    expect(state.company.bankrupt).toBe(true);
    expect(state.contract).toBeNull();
    expect(state.queue.some((e) => e.task.kind === 'contractExpired')).toBe(false);
  });
});

describe('вылет', () => {
  it('проверяет звено: пустое, слишком большое, без пилота, разбитое', () => {
    const { id, offers } = systemWithOffers();
    const state = stateAt(id);
    run(state, { kind: 'takeContract', contractId: offers[0]!.id });

    expect(execute(state, { kind: 'deploy', recordIds: [] }).ok).toBe(false);
    expect(
      execute(state, { kind: 'deploy', recordIds: ['M-1', 'M-2', 'M-3', 'M-4', 'M-1'] }),
    ).toEqual({ ok: false, reason: CampaignRejectReason.BadLance });

    // Машина без пилота на контракт не идёт.
    run(state, { kind: 'assignPilot', recordId: 'M-1', pilotId: null });
    expect(execute(state, { kind: 'deploy', recordIds: ['M-1'] })).toEqual({
      ok: false,
      reason: CampaignRejectReason.MechNotDeployable,
    });

    // Разрушенный торс — обломки, а не машина.
    state.company = {
      ...state.company,
      mechs: state.company.mechs.map((m) =>
        m.id === 'M-2'
          ? {
              ...m,
              condition: {
                ...m.condition,
                zones: m.condition.zones.map((z, i) => (i === HitZone.Torso ? { ...z, destroyed: true } : z)),
              },
            }
          : m,
      ),
    };
    expect(execute(state, { kind: 'deploy', recordIds: ['M-2'] })).toEqual({
      ok: false,
      reason: CampaignRejectReason.MechNotDeployable,
    });
  });

  it('сид вылета ложится в состояние: брифинг собирается дважды одинаково', () => {
    const { id, offers } = systemWithOffers();
    const state = stateAt(id);
    run(state, { kind: 'takeContract', contractId: offers[0]!.id });
    run(state, { kind: 'deploy', recordIds: ['M-1', 'M-2'] });

    const first = contractBrief(state);
    const second = contractBrief(state);
    expect(second.enemy.map((p) => p.record.id)).toEqual(first.enemy.map((p) => p.record.id));
    expect(second.battleSeed).toBe(first.battleSeed);
    expect(first.map?.biome).toBe(state.contract!.contract.biome);

    // Второй вылет по тому же контракту переиграть состав не даёт.
    expect(execute(state, { kind: 'deploy', recordIds: ['M-3'] })).toEqual({
      ok: false,
      reason: CampaignRejectReason.AlreadyDeployed,
    });
  });

  /**
   * РАЗМЕР ПОЛЯ БОЯ ОТ ЧИСЛА МАШИН (решение пользователя 2026-09-08). До правки
   * мост передавал в бой только биом, и поле всегда собиралось умолчанием
   * 15×15: противник первым же ходом пересекал три четверти карты, и вместо
   * расстановки выходила свалка в углу.
   */
  it('поле боя собирается по числу машин на нём, а не умолчанием', () => {
    const { id, offers } = systemWithOffers();
    const state = stateAt(id);
    run(state, { kind: 'takeContract', contractId: offers[0]!.id });
    run(state, { kind: 'deploy', recordIds: ['M-1', 'M-2'] });

    const brief = contractBrief(state);
    const units = brief.company.length + brief.enemy.length;
    const size = mapSizeFor(units);
    expect(brief.map?.width, `машин на поле: ${units}`).toBe(size);
    expect(brief.map?.height).toBe(size);
    // Поле обязано быть просторнее дуэльного умолчания: ради этого правка и делалась.
    expect(size).toBeGreaterThan(15);
  });
});

describe('разбор контракта — шов шага 16', () => {
  function taken(): { state: CampaignState; offer: Contract } {
    const { id, offers } = systemWithOffers();
    const state = stateAt(id);
    // Нужен контракт с ненулевой долей трофеев и хотя бы двумя машинами
    // противника — иначе проверять соблюдение доли не на чем.
    const offer = offers.find((c) => opforCount(c) >= 2) ?? offers[0]!;
    run(state, { kind: 'takeContract', contractId: offer.id });
    run(state, { kind: 'deploy', recordIds: ['M-1', 'M-2', 'M-3', 'M-4'] });
    return { state, offer };
  }

  it('победа платит остаток оплаты, а не оплату заново', () => {
    const { state, offer } = taken();
    const cash = state.company.cbills;
    // Один противник уходит с поля на ходу: это ПРОСТО выполненный контракт, а
    // не разгром сверх задачи, — иначе к оплате добавится премия за превышение
    // (`contracts.json → beyond.payFactor`), и проверка перестанет измерять то,
    // ради чего написана.
    const events = run(state, {
      kind: 'resolveContract',
      outcome: outcomeFor(state, { playerWins: true, opforSurvivors: 1 }),
    });
    const resolved = events.find((e) => e.kind === 'contractResolved');
    expect(resolved).toMatchObject({ result: 'won', settlement: offer.payout - offer.advance });
    // В кассу приходит расчёт по контракту плюс выкуп доли трофеев, если её не
    // хватило на целую машину: это отдельная строка расчёта, а не часть оплаты.
    const compensation = events.find((e) => e.kind === 'salvageCompensated');
    const extra = compensation?.kind === 'salvageCompensated' ? compensation.amount : 0;
    expect(state.company.cbills).toBe(cash + offer.payout - offer.advance + extra);
    expect(state.contract).toBeNull();
    expect(state.queue.some((e) => e.task.kind === 'contractExpired')).toBe(false);
  });

  it('порядок парка, расставленный игроком, вылет не сбрасывает', () => {
    const { id, offers } = systemWithOffers();
    const state = stateAt(id);
    run(state, { kind: 'reorderMechs', order: ['M-4', 'M-2', 'M-1', 'M-3'] });
    run(state, { kind: 'takeContract', contractId: offers[0]!.id });
    run(state, { kind: 'deploy', recordIds: ['M-2', 'M-3'] });
    run(state, { kind: 'resolveContract', outcome: outcomeFor(state, { playerWins: true }), salvage: [] });
    expect(state.company.mechs.map((m) => m.id)).toEqual(['M-4', 'M-2', 'M-1', 'M-3']);
  });

  it('доля трофеев из условий контракта соблюдается', () => {
    const { state, offer } = taken();
    const enemies = contractBrief(state).enemy.length;
    const events = run(state, { kind: 'resolveContract', outcome: outcomeFor(state, { playerWins: true }) });
    const resolved = events.find((e) => e.kind === 'contractResolved')!;
    if (resolved.kind !== 'contractResolved') throw new Error('нет события разбора');

    expect(resolved.salvageAvailable).toBeLessThanOrEqual(enemies);
    // Поле очищено целиком, значит доля идёт С ПРЕМИЕЙ ЗА РАЗГРОМ: подписанная
    // плюс `beyond.salvageBonus`. Проверка считает ту же долю, что и разбор, —
    // подписанная без премии сходилась здесь до шага 56 только по случайности
    // округления и перестала сходиться, как только доли подняли.
    const share = effectiveSalvageShare(offer.salvageShare, 'beyond');
    expect(resolved.salvagePoints).toBe(Math.round(resolved.salvageAvailable * share));
    expect(resolved.trophyRecordIds).toHaveLength(resolved.salvagePoints);
    // На складе роты оказывается ровно столько трофеев, сколько положено долей,
    // а не всё, что уцелело на поле, — до шага 16 это правило не соблюдал никто.
    const trophies = state.company.mechs.filter((m) => m.id.startsWith('trophy-'));
    expect(trophies).toHaveLength(resolved.salvagePoints);
    expect(resolved.salvagePoints).toBeLessThan(resolved.salvageAvailable + 1);
    // Имя трофея — просто название модели, без пометки «Трофей: » (решение
    // пользователя 2026-09-18): это та же подпись, что у купленной машины
    // того же шасси, а не отдельный текст для складского происхождения.
    expect(trophies.every((m) => !m.name.includes('Трофей'))).toBe(true);
  });

  it('поражение теряет выбывшие машины и берёт неустойку', () => {
    const { state, offer } = taken();
    const cash = state.company.cbills;
    const outcome = outcomeFor(state, { playerWins: false, companyDestroyed: ['M-1'] });
    const events = run(state, { kind: 'resolveContract', outcome });
    const resolved = events.find((e) => e.kind === 'contractResolved')!;
    if (resolved.kind !== 'contractResolved') throw new Error('нет события разбора');

    expect(resolved.result).toBe('lost');
    expect(resolved.lostRecordIds).toEqual(['M-1']);
    expect(state.company.mechs.some((m) => m.id === 'M-1')).toBe(false);
    expect(state.company.cbills).toBe(cash - offer.penalty);
  });

  it('отступление — не поражение: поле отдано, но неустойки нет', () => {
    const { state } = taken();
    const cash = state.company.cbills;
    // Тот же итог боя, что и у победы, но рота объявляет отход.
    const outcome = outcomeFor(state, { playerWins: true, companyDestroyed: ['M-1'] });
    const events = run(state, { kind: 'resolveContract', outcome, withdrew: true });
    const resolved = events.find((e) => e.kind === 'contractResolved')!;
    if (resolved.kind !== 'contractResolved') throw new Error('нет события разбора');

    expect(resolved.result).toBe('withdrawn');
    expect(resolved.settlement).toBe(0);
    expect(state.company.cbills).toBe(cash);
    // Поле осталось за противником — выбывшая машина потеряна вместе с ним
    // (решение 3 §7 пайплайна), и трофеев с чужого поля не берут.
    expect(resolved.lostRecordIds).toEqual(['M-1']);
    expect(resolved.trophyRecordIds).toHaveLength(0);
  });

  it('раненый пилот идёт в лазарет очередью суток, потерянный — из роты', () => {
    const { state } = taken();
    const outcome = outcomeFor(state, { playerWins: true });
    // Один пилот ранен сверх порога, другой потерян — оба состояния приходят
    // из боя, и до шага 16 их некому было применить.
    const patched: BattleOutcome = {
      ...outcome,
      units: outcome.units.map((u) => {
        if (u.recordId === 'M-1') return { ...u, unit: { ...u.unit, pilot: { ...u.unit.pilot, injuries: 9 } } };
        if (u.recordId === 'M-2') {
          return { ...u, unit: { ...u.unit, pilot: { ...u.unit.pilot, status: 'lost' as const } } };
        }
        return u;
      }),
    };

    const events = run(state, { kind: 'resolveContract', outcome: patched });
    const admitted = events.find((e) => e.kind === 'pilotAdmitted');
    expect(admitted).toMatchObject({ pilotId: 'P-1' });
    expect(state.company.pilots.find((p) => p.id === 'P-1')?.status).toBe('out');
    expect(state.queue.some((e) => e.task.kind === 'medbayDone' && e.task.pilotId === 'P-1')).toBe(true);

    expect(events.some((e) => e.kind === 'pilotLost' && e.pilotId === 'P-2')).toBe(true);
    expect(state.company.pilots.some((p) => p.id === 'P-2')).toBe(false);
    expect(state.company.mechs.find((m) => m.id === 'M-2')?.pilotId).toBeNull();

    // Лазарет отпускает сам, задачей очереди — а не «считается вылеченным за простой».
    // Срок берётся у ядра, а не числом: он живёт в `economy.json` и меняется.
    run(state, { kind: 'advance', days: Math.ceil(treatmentDays(9)) + 1 });
    expect(state.company.pilots.find((p) => p.id === 'P-1')?.status).toBe('active');
  });

  /**
   * ВТОРОЙ ГОНОРАР ЗА РАЗГРОМ (решение пользователя 2026-09-08). Исход
   * «выполнено с превышением» существовал с шага 19b, но платил только
   * репутацией: рота выбивала противника целиком там, где хватало продержаться
   * шесть ходов, и получала столько же, сколько за уход по сроку.
   */
  it('разгром сверх задачи платит больше и делится трофеями охотнее', () => {
    const { state, offer: contract } = taken();
    const cleared = outcomeFor(state, { playerWins: true });
    const partial = outcomeFor(state, { playerWins: true, opforSurvivors: 1 });

    // Задача штурма И ЕСТЬ разгром — на нём премии не бывает, поэтому проверка
    // идёт только на миссиях, где превышение вообще возможно.
    if (missionObjective(contract.mission).kind === 'destroy') return;

    const beyond = salvageOffer(state, cleared);
    const plain = salvageOffer(state, partial);
    expect(beyond.share).toBeGreaterThan(plain.share);
    expect(beyond.share).toBeCloseTo(
      Math.min(1, contract.salvageShare + CONTRACTS.beyond.salvageBonus),
      5,
    );

    const before = state.company.cbills;
    run(state, { kind: 'resolveContract', outcome: cleared, salvage: [] });
    const paid = state.company.cbills - before;
    // Заплачено больше, чем стоит контракт по подписанной ставке.
    expect(paid).toBeGreaterThan(contract.payout - contract.advance);
  });

  /**
   * КОМПЕНСАЦИЯ ЗА ДРОБНУЮ ДОЛЮ (решение пользователя 2026-09-08). Один остов
   * и доля меньше половины давали ноль очков и ноль денег: рота выигрывала
   * бой, удерживала поле и уходила с него ни с чем.
   */
  it('доля, не дотянувшая до целой машины, выкупается деньгами', () => {
    const { state } = taken();
    const outcome = outcomeFor(state, { playerWins: true });
    // Оставляем на поле РОВНО один остов: столько трофеев, сколько нужно, чтобы
    // доля контракта не набрала целой машины.
    const offer = salvageOffer(state, outcome);
    if (offer.points > 0 || offer.trophies.length === 0) return;

    expect(offer.compensation).toBeGreaterThan(0);
    const before = state.company.cbills;
    const events = run(state, { kind: 'resolveContract', outcome, salvage: [] });
    expect(events.some((e) => e.kind === 'salvageCompensated')).toBe(true);
    // В кассу пришло и по контракту, и за долю трофеев.
    expect(state.company.cbills - before).toBeGreaterThan(offer.compensation);
  });

  it('разбор без вылета отклоняется', () => {
    const { id, offers } = systemWithOffers();
    const state = stateAt(id);
    run(state, { kind: 'takeContract', contractId: offers[0]!.id });
    const outcome: BattleOutcome = { winner: 'player', heldField: true, units: [] };
    expect(execute(state, { kind: 'resolveContract', outcome })).toEqual({
      ok: false,
      reason: CampaignRejectReason.NotDeployed,
    });
  });
});

describe('сохранение', () => {
  it('взятый контракт и вылет переживают круговой прогон с совпадением хэша', () => {
    const { id, offers } = systemWithOffers();
    const state = stateAt(id);
    run(state, { kind: 'takeContract', contractId: offers[0]!.id });
    run(state, { kind: 'deploy', recordIds: ['M-1', 'M-2'] });

    const file = makeSaveFile(snapshot(state));
    const reloaded = restore(parseSaveFile(JSON.parse(JSON.stringify(file))));
    expect(hashCampaignState(reloaded)).toBe(hashCampaignState(state));
    expect(reloaded.contract?.sortie?.battleSeed).toBe(state.contract?.sortie?.battleSeed);
    // Из загруженного состояния собирается ТОТ ЖЕ бой — иначе сохранение
    // посреди контракта отдавало бы другого противника.
    expect(contractBrief(reloaded).enemy.map((p) => p.record.id)).toEqual(
      contractBrief(state).enemy.map((p) => p.record.id),
    );
  });

  it('контракт добавляет к снимку немного, а биржу не хранит вовсе', () => {
    const { id, offers } = systemWithOffers();
    const state = stateAt(id);
    const size = (): number => new TextEncoder().encode(JSON.stringify(makeSaveFile(snapshot(state)))).length;
    const before = size();
    run(state, { kind: 'takeContract', contractId: offers[0]!.id });
    const after = size();
    expect(after - before).toBeLessThan(900);
    expect(JSON.stringify(makeSaveFile(snapshot(state)))).not.toContain(offers[1]!.id);
  });
});

describe('география биржи', () => {
  it('где богаче рынок, там и больше работы', () => {
    const counts = new Map<string, number[]>();
    for (let i = 0; i < 600; i++) {
      const id = GALAXY.id(i);
      const cls = marketProfile(WORLD, id).marketClass;
      const list = counts.get(cls) ?? [];
      list.push(contractBoard(WORLD, {}, id, 0).length);
      counts.set(cls, list);
    }
    const avg = (cls: string): number => {
      const list = counts.get(cls) ?? [];
      return list.length === 0 ? 0 : list.reduce((a, b) => a + b, 0) / list.length;
    };
    if (counts.has('capital') && counts.has('backwater')) {
      expect(avg('capital')).toBeGreaterThan(avg('backwater'));
    }
    expect(avg('developed')).toBeGreaterThan(0);
  });
});

// --- ручной выбор трофеев, рейтинг и проверка команд (шаг 16a) ----------------

describe('ручной выбор трофеев', () => {
  function deployed(): { state: CampaignState; offer: Contract } {
    const { id, offers } = systemWithOffers();
    const state = stateAt(id);
    const offer = offers.find((c) => opforCount(c) >= 2) ?? offers[0]!;
    run(state, { kind: 'takeContract', contractId: offer.id });
    run(state, { kind: 'deploy', recordIds: ['M-1', 'M-2', 'M-3', 'M-4'] });
    return { state, offer };
  }

  it('предпросмотр показывает список до команды и ничего не сдвигает', () => {
    const { state } = deployed();
    const outcome = outcomeFor(state, { playerWins: true });
    const before = hashCampaignState(state);

    const offer = salvageOffer(state, outcome);
    expect(offer.result).toBe('won');
    expect(offer.trophies.length).toBeGreaterThan(0);
    expect(offer.points).toBeGreaterThan(0);
    // Спрашивать можно сколько угодно раз: ни состояния, ни ГПСЧ.
    expect(salvageOffer(state, outcome)).toEqual(offer);
    expect(hashCampaignState(state)).toBe(before);
    // И список отсортирован от дорогого к дешёвому — «взять по умолчанию»
    // это просто первые `points` строк.
    const prices = offer.trophies.map((m) => mechValue(m));
    expect([...prices].sort((a, b) => b - a)).toEqual(prices);
  });

  it('отход БЕЗ огневого контакта возвращает аванс (шаг 35)', () => {
    // questions.md п. 1: отход был единственным исходом, который не платит и не
    // штрафует. Это читалось как справедливость, пока не выяснилось, что
    // отработать необязательно: подписать контракт, забрать аванс, высадиться и
    // отвести звено на первом ходу давало чистый доход без единого выстрела.
    const { state } = deployed();
    const advance = state.contract!.advancePaid;
    expect(advance).toBeGreaterThan(0);
    const before = state.company.cbills;

    // Огня никто не открывал: `engaged` считается по счётчику выстрелов боя.
    const outcome = { ...outcomeFor(state, { playerWins: false }), engaged: false };
    run(state, { kind: 'resolveContract', outcome, withdrew: true, salvage: [] });
    expect(state.company.cbills).toBe(before - advance);
  });

  it('отход ПОСЛЕ боя аванс не возвращает: отряд дрался и ушёл', () => {
    const { state } = deployed();
    const before = state.company.cbills;
    const outcome = { ...outcomeFor(state, { playerWins: false }), engaged: true };
    run(state, { kind: 'resolveContract', outcome, withdrew: true, salvage: [] });
    // Ни доплаты, ни неустойки, ни возврата: решение отступить денег не стоит.
    expect(state.company.cbills).toBe(before);
  });

  it('боевой вылет занимает сутки кампании (шаг 35)', () => {
    // questions.md п. 2: бой не двигал время, и игрок за один игровой день брал,
    // отыгрывал и закрывал ВСЕ контракты декады на планете.
    const { state } = deployed();
    const day = state.day;
    run(state, { kind: 'resolveContract', outcome: outcomeFor(state, { playerWins: true }), salvage: [] });
    expect(state.day).toBeGreaterThan(day);
  });

  it('невостребованные очки утиля выкупаются деньгами, а не сгорают (шаг 34)', () => {
    // questions.md п. 11: игрок торговался за долю утиля при подписании,
    // победил, удержал поле — и оставлял машину на поле даром, если ангар полон
    // или трофей не нужен. Очки просто пропадали.
    const { state } = deployed();
    const outcome = outcomeFor(state, { playerWins: true });
    const offer = salvageOffer(state, outcome);
    if (offer.points < 1 || offer.trophies.length < 1) return;

    const before = state.company.cbills;
    // Явный пустой выбор: ни одной машины не берём.
    const events = run(state, { kind: 'resolveContract', outcome, salvage: [] });
    const paid = events.find((e) => e.kind === 'salvageBoughtOut');
    expect(paid).toBeDefined();
    if (paid?.kind !== 'salvageBoughtOut') return;
    expect(paid.machines).toBe(Math.min(offer.points, offer.trophies.length));
    expect(paid.amount).toBeGreaterThan(0);
    // Выкуп заметно дешевле самой машины: вывезти корпус выгоднее, чем продать
    // право на него.
    expect(paid.amount).toBeLessThan(mechValue(offer.trophies[0]!) * paid.machines);
    expect(state.company.cbills).toBeGreaterThan(before);
  });

  it('трофей разбирается НА ПОЛЕ и при полном ангаре: железо идёт на склад (шаг 34)', () => {
    const { state } = deployed();
    const outcome = outcomeFor(state, { playerWins: true });
    const offer = salvageOffer(state, outcome);
    if (offer.points < 1 || offer.trophies.length < 1) return;

    const trophy = offer.trophies[0]!;
    const shelfBefore = state.company.warehouse.length;
    const roster = state.company.mechs.length;
    const events = run(state, {
      kind: 'resolveContract',
      outcome,
      salvage: [],
      salvageScrap: [trophy.id],
    });

    const scrap = events.find((e) => e.kind === 'trophyScrapped');
    expect(scrap).toBeDefined();
    if (scrap?.kind !== 'trophyScrapped') return;
    expect(scrap.parts).toBeGreaterThan(0);
    // Склад пополнился, ростер — нет: корпус остался на поле.
    expect(state.company.warehouse.length).toBeGreaterThan(shelfBefore);
    expect(state.company.mechs.some((m) => m.id === trophy.id)).toBe(false);
    expect(state.company.mechs.length).toBeLessThanOrEqual(roster);
  });

  it('одну машину нельзя и забрать, и разобрать', () => {
    const { state } = deployed();
    const outcome = outcomeFor(state, { playerWins: true });
    const offer = salvageOffer(state, outcome);
    if (offer.points < 1 || offer.trophies.length < 1) return;
    const trophy = offer.trophies[0]!;
    expect(
      execute(state, {
        kind: 'resolveContract',
        outcome,
        salvage: [trophy.id],
        salvageScrap: [trophy.id],
      }),
    ).toEqual({ ok: false, reason: CampaignRejectReason.BadSalvage });
  });

  it('игрок берёт то, что выбрал, а не то, что дороже', () => {
    const { state } = deployed();
    const outcome = outcomeFor(state, { playerWins: true });
    const offer = salvageOffer(state, outcome);
    if (offer.trophies.length < 2 || offer.points < 1) return;

    // Самый дешёвый вместо самого дорогого — движок сам такого не выберет.
    const cheapest = offer.trophies[offer.trophies.length - 1]!;
    run(state, { kind: 'resolveContract', outcome, salvage: [cheapest.id] });
    expect(state.company.mechs.some((m) => m.id === cheapest.id)).toBe(true);
    expect(state.company.mechs.some((m) => m.id === offer.trophies[0]!.id)).toBe(false);
  });

  it('выбор, которого не могло быть, отклоняется целиком', () => {
    const { state } = deployed();
    const outcome = outcomeFor(state, { playerWins: true });
    const offer = salvageOffer(state, outcome);
    const before = hashCampaignState(state);

    // Позиции нет на поле.
    expect(execute(state, { kind: 'resolveContract', outcome, salvage: ['нет-такого'] })).toEqual({
      ok: false,
      reason: CampaignRejectReason.BadSalvage,
    });
    // Одна и та же позиция дважды.
    if (offer.trophies.length > 0) {
      const id = offer.trophies[0]!.id;
      expect(
        execute(state, { kind: 'resolveContract', outcome, salvage: [id, id] }).ok,
      ).toBe(false);
    }
    // Больше, чем позволяют очки.
    const tooMany = offer.trophies.slice(0, offer.points + 1).map((m) => m.id);
    if (tooMany.length > offer.points) {
      expect(execute(state, { kind: 'resolveContract', outcome, salvage: tooMany }).ok).toBe(false);
    }
    // Отклонённая команда не оставила следа.
    expect(hashCampaignState(state)).toBe(before);
  });

  it('пустой выбор — законный: рота может не брать ничего', () => {
    const { state } = deployed();
    const outcome = outcomeFor(state, { playerWins: true });
    run(state, { kind: 'resolveContract', outcome, salvage: [] });
    expect(state.company.mechs.some((m) => m.id.startsWith('trophy-'))).toBe(false);
  });

  it('трофеи не раздувают парк сверх вместимости десантного корабля', () => {
    const { state } = deployed();
    // Прижимаем ангар к новому Leopard (4 открытые ячейки): все четыре машины
    // звена уже в строю и возвращаются с вылета целыми — мест под трофеи нет.
    state.company = { ...state.company, dropship: 'leopard', hangar: ECONOMY.dropships.leopard.minMechs };
    const outcome = outcomeFor(state, { playerWins: true });
    const offer = salvageOffer(state, outcome);
    if (offer.trophies.length === 0 || offer.points === 0) return;

    // Явный выбор трофея отклоняется тем же отказом, что и покупка на рынке.
    expect(execute(state, { kind: 'resolveContract', outcome, salvage: [offer.trophies[0]!.id] })).toEqual({
      ok: false,
      reason: CampaignRejectReason.HangarFull,
    });

    // Выбор по умолчанию («движок берёт самое дорогое») не ломает лимит —
    // он просто не берёт того, для чего нет места.
    const events = run(state, { kind: 'resolveContract', outcome });
    const resolved = events.find((e) => e.kind === 'contractResolved')!;
    if (resolved.kind !== 'contractResolved') throw new Error('нет события разбора');
    expect(resolved.trophyRecordIds).toHaveLength(0);
    expect(state.company.mechs.length).toBeLessThanOrEqual(4);
  });
});

describe('рейтинг силы роты', () => {
  it('растёт от класса, тоннажа и выучки — и не считает машину без пилота', () => {
    const base = stateAt('outreach');
    const rated = companyRating(base.company);
    expect(rated.total).toBeGreaterThan(0);
    expect(rated.byMech).toHaveLength(base.company.mechs.length);

    const better = {
      ...base.company,
      mechs: base.company.mechs.map((m) => ({
        ...m,
        assembly: { ...m.assembly, quality: { reactor: 'master' as const, frame: 'master' as const } },
      })),
    };
    expect(companyRating(better).total).toBeGreaterThan(rated.total);

    // Машина без пилота в силу роты не входит, но из списка не пропадает.
    const grounded = {
      ...base.company,
      mechs: base.company.mechs.map((m, i) => (i === 0 ? { ...m, pilotId: null } : m)),
    };
    const g = companyRating(grounded);
    expect(g.total).toBeLessThan(rated.total);
    expect(g.byMech[0]).toMatchObject({ idle: true, rating: 0 });
    expect(g.byMech).toHaveLength(base.company.mechs.length);
  });

  it('пустая рота — ноль, а не ошибка', () => {
    expect(companyRating(makeCompany()).total).toBe(0);
  });
});

describe('проверка команды без исполнения', () => {
  it('отвечает тем же, чем ответил бы execute, и состояния не трогает', () => {
    const { id, offers } = systemWithOffers();
    const state = stateAt(id);
    const before = hashCampaignState(state);

    expect(canExecute(state, { kind: 'takeContract', contractId: 'нет-такого' })).toBe(
      CampaignRejectReason.ContractNotAvailable,
    );
    expect(canExecute(state, { kind: 'abandonContract' })).toBe(CampaignRejectReason.NoContract);
    expect(isLegal(state, { kind: 'takeContract', contractId: offers[0]!.id })).toBe(true);
    // Проверка «можно» не сдвинула ни состояние, ни ГПСЧ — иначе экран,
    // опрашивающий кнопки при каждой перерисовке, переигрывал бы кампанию.
    expect(hashCampaignState(state)).toBe(before);

    // И то же самое после настоящего исполнения: ответ совпадает с фактом.
    run(state, { kind: 'takeContract', contractId: offers[0]!.id });
    expect(canExecute(state, { kind: 'takeContract', contractId: offers[1]!.id })).toBe(
      CampaignRejectReason.ContractActive,
    );
  });

  it('видит нехватку денег так же, как её видит команда', () => {
    const poor = stateAt(systemWithOffers().id, { ...lanceCompany(), cbills: 0 });
    const survey = { kind: 'survey' } as const;
    expect(canExecute(poor, survey)).toBe(CampaignRejectReason.InsufficientFunds);
    expect(execute(poor, survey)).toEqual({ ok: false, reason: CampaignRejectReason.InsufficientFunds });
  });
});

/**
 * ФРОНТ И ТЫЛ (шаг 37).
 *
 * Проверяется не «стало ли пиратов меньше» — это число, и оно живёт в замере
 * (`pnpm worldstat`, раздел «фронт и тыл»). Проверяется свойство, ради которого
 * шаг делался: **состав биржи зависит от МЕСТА**. До шага 37 пираты стояли в
 * пуле противников безусловно, и все три проверки ниже провалились бы.
 */
describe('фронт и тыл: пираты собраны в тыл', () => {
  /** Разложить карту по полосам фронтового индекса на день ноль. */
  function bands(): { front: number[]; rear: number[] } {
    const front: number[] = [];
    const rear: number[] = [];
    for (let i = 0; i < GALAXY.count; i += 5) {
      const fi = frontierIndexAt({}, undefined, undefined, i);
      if (fi > 0.7) front.push(i);
      else if (fi === 0) rear.push(i);
    }
    return { front, rear };
  }

  const { front, rear } = bands();

  it('карта вообще делится: есть и фронтовые системы, и глубокий тыл', () => {
    // Без этого остальные две проверки прошли бы на пустых выборках.
    expect(front.length).toBeGreaterThan(10);
    expect(rear.length).toBeGreaterThan(10);
  });

  it('на фронте пиратской работы нет вовсе', () => {
    // Лорное основание: пираты не выходят против гарнизонных частей и полков —
    // там их находят регулярные части. Ноль здесь жёсткий, а не «мало»: вес
    // пиратов на фронтовом индексе 1.0 обращается в ноль точно.
    //
    // Исключение одно и намеренное — НАГРАДА ЗА ЛОГОВО (шаг 72f): на мире самой
    // вольницы сосед платит за её зачистку, и фронт этому не мешает, а
    // помогает — у границы логово мешает больше всего. Она не «пиратская
    // работа биржи», а отдельный список, и здесь не считается.
    let pirate = 0;
    let total = 0;
    for (const i of front) {
      for (const c of contractBoard(WORLD, {}, GALAXY.id(i), 0)) {
        if (c.id.startsWith('B')) continue;
        total += 1;
        if (c.target === PIRATE_FACTION) pirate += 1;
      }
    }
    expect(total).toBeGreaterThan(0);
    expect(pirate).toBe(0);
  });

  it('в тылу пиратская работа есть, и её много', () => {
    let pirate = 0;
    let total = 0;
    for (const i of rear) {
      for (const c of contractBoard(WORLD, {}, GALAXY.id(i), 0)) {
        total += 1;
        if (c.target === PIRATE_FACTION) pirate += 1;
      }
    }
    expect(total).toBeGreaterThan(0);
    // Это и есть стартовая ниша: в глубоком тылу работа против вольницы —
    // основная, и посильна она копью Green/Regular, потому что снабжение
    // пиратов жёстко `militia` (`contracts/supply.ts`).
    expect(pirate / total).toBeGreaterThan(0.5);
  });

  it('пиратский риск падает с приближением к фронту, а не скачком', () => {
    // Степень спада больше единицы (`frontierPower`), поэтому у самой границы
    // вольницы нет вовсе, а в двух прыжках она уже заметна. Ровный градиент
    // оставил бы приграничье наполовину пиратским — ровно то, чего шаг избегает.
    const facts = {
      marketClass: 'developed' as const,
      garrison: 1,
      ruined: 0,
      owner: 'davion',
      blackMarket: false,
      cleared: 0,
    };
    const deep = pirateRisk(0, facts);
    const border = pirateRisk(0.45, facts);
    const line = pirateRisk(1, facts);
    expect(deep).toBeGreaterThan(border);
    expect(border).toBeGreaterThan(line);
    expect(line).toBe(0);
    // Спад круче линейного: на половине пути к фронту риска остаётся меньше
    // половины.
    expect(border).toBeLessThan(deep * 0.5);
  });

  it('гарнизон гасит вольницу: крепость не грабят', () => {
    const base = {
      marketClass: 'developed' as const,
      ruined: 0,
      owner: 'davion',
      blackMarket: false,
      cleared: 0,
    };
    expect(pirateRisk(0, { ...base, garrison: 0 })).toBeGreaterThan(
      pirateRisk(0, { ...base, garrison: 2 }),
    );
    expect(pirateRisk(0, { ...base, garrison: 5 })).toBe(0);
  });

  it('фронтовой индекс не поднимается самими пиратами', () => {
    // Если бы вольница считалась враждебным соседом, каждая система на карте
    // оказалась бы фронтовой — и тыла не осталось бы ни одного.
    expect(
      frontierIndex([{ id: PIRATE_FACTION, proximity: 1, tension: 0 }]),
    ).toBe(0);
  });
});

/**
 * ЗАЧИСТКА И НАБЕГИ (шаг 37a).
 *
 * Проверяется, что след работы роты остаётся в МИРЕ, а не в её собственной
 * памяти, — на этом стоит и весь замысел («чтобы его действия не пропадали»), и
 * то, что биржа при этом осталась чистой функцией.
 */
describe('зачистка от вольницы: след остаётся в мире', () => {
  /** Тыловая система: там, где вольница есть и её можно вычищать. */
  function rearSystem(): number {
    for (let i = 0; i < GALAXY.count; i += 1) {
      if (frontierIndexAt({}, undefined, undefined, i) !== 0) continue;
      const board = contractBoard(WORLD, {}, GALAXY.id(i), 0);
      if (board.some((c) => c.target === PIRATE_FACTION)) return i;
    }
    throw new Error('в каталоге не нашлось ни одной тыловой системы с пиратской работой');
  }

  it('ШКАЛА, а не флажок: первый же выигранный подряд двигает мир, а не третий', () => {
    // Требование замысла дословно: «чем больше успешных контрактов — тем чище
    // мир». Порог отвечал бы игроку только на N-м контракте, и до того он
    // работал бы вслепую.
    const i = rearSystem();
    const id = GALAXY.id(i);
    const once = withPirateClearing({}, i);
    const twice = withPirateClearing(once, i);
    expect(clearedOf({}, id)).toBe(0);
    expect(clearedOf(once, id)).toBeGreaterThan(0);
    expect(clearedOf(twice, id)).toBeGreaterThan(clearedOf(once, id));
  });

  it('вычищенность снимает пиратскую работу с биржи — КОЛИЧЕСТВОМ, а не заменой', () => {
    // Мерить надо ЧИСЛО пиратских предложений, а не их долю, и это не придирка.
    // В глубоком тылу вольница — единственный противник в двух прыжках, и
    // заменить её на бирже некем: доля там останется единицей, сколько мир ни
    // вычищай. Убавляется именно работа — ровно то, что и требовалось: мир,
    // который рота вычистила, кормить её перестаёт, и это и есть «стимул лететь
    // дальше» из замысла.
    //
    // До нуля при этом не доходит никогда: `survivalFloor` оставляет четверть.
    // Гарнизонная служба и конвои есть и там, где вольницу уже выбили.
    const count = (deltas: Record<string, unknown>): number => {
      let n = 0;
      for (let i = 0; i < GALAXY.count; i += 1) {
        if (frontierIndexAt(deltas as never, undefined, undefined, i) !== 0) continue;
        for (const c of contractBoard(WORLD, deltas as never, GALAXY.id(i), 0)) {
          if (c.target === PIRATE_FACTION) n += 1;
        }
      }
      return n;
    };
    // Вычистить целый угол карты: тот же мир четырежды, а с ним и его соседей.
    const i = rearSystem();
    let deltas: ReturnType<typeof withPirateClearing> = withPirateClearing({}, i);
    for (let n = 0; n < 3; n++) deltas = withPirateClearing(deltas, i);
    const before = count({});
    const after = count(deltas as never);
    expect(before).toBeGreaterThan(0);
    expect(after).toBeLessThan(before);
  });

  it('волновой эффект: сектор чище, а не одна точка на карте', () => {
    const i = rearSystem();
    const deltas = withPirateClearing({}, i);
    const neighbours = GALAXY.neighbors(i);
    expect(neighbours.length).toBeGreaterThan(0);
    for (const j of neighbours) {
      const near = clearedOf(deltas, GALAXY.id(j));
      expect(near).toBeGreaterThan(0);
      // Соседу достаётся доля, а не столько же: вычищали не его.
      expect(near).toBeLessThan(clearedOf(deltas, GALAXY.id(i)));
    }
  });

  it('вычищенное ЗАРАСТАЕТ и запись уходит из разрежённой карты целиком', () => {
    // Без заращивания за длинную кампанию карта вычистилась бы насухо и работа
    // кончилась бы совсем. А запись «вычищенности нет» в дельте означала бы
    // течь разрежённости через первый же вычищенный сектор.
    const i = rearSystem();
    const id = GALAXY.id(i);
    let deltas: ReturnType<typeof withPirateClearing> = withPirateClearing({}, i);
    let ticks = 0;
    while (clearedOf(deltas, id) > 0 && ticks < 1000) {
      deltas = regrowPirates(deltas);
      ticks++;
    }
    expect(ticks).toBeLessThan(1000);
    expect(deltas[id]).toBeUndefined();
  });

  it('оптовый фронтовой индекс совпадает с поштучным', () => {
    // Две формулы одной величины разошлись бы молча — ровно так, как разошлись
    // копии таблиц в офлайн-генераторе шасси до части 3a. Оптовый считается
    // одним обходом из множества фронтовых систем, поштучный — обходом вокруг
    // каждой; сверяются они здесь.
    const atFront = new Set<number>();
    for (let i = 0; i < GALAXY.count; i++) {
      if (frontierIndexAt({}, undefined, undefined, i) > 0.7) atFront.add(i);
    }
    const field = frontierField(atFront);
    let checked = 0;
    for (let i = 0; i < GALAXY.count; i += 3) {
      expect(field[i]).toBeCloseTo(frontierIndexAt({}, undefined, undefined, i), 5);
      checked++;
    }
    expect(checked).toBeGreaterThan(100);
  });
});

describe('награда за логово (шаг 72f): работа против вольницы на её собственном мире', () => {
  /** Пиратские миры каталога, у которых в пределах досягаемости биржи есть непиратский сосед. */
  function pirateWorlds(): string[] {
    const out: string[] = [];
    for (let i = 0; i < GALAXY.count; i++) if (GALAXY.ownerId(i) === PIRATE_FACTION) out.push(GALAXY.id(i));
    return out;
  }

  it('на мире вольницы есть работа против неё, и нанимает сосед, а не сама вольница', () => {
    let seen = 0;
    for (const id of pirateWorlds()) {
      for (const day of [0, 10, 20]) {
        const bounty = contractBoard(WORLD, {}, id, day, undefined, WAR_AT_START).filter((c) => c.id.startsWith('B'));
        for (const c of bounty) {
          seen++;
          expect(c.target).toBe(PIRATE_FACTION);
          expect(c.employer).not.toBe(PIRATE_FACTION);
          expect(c.stakes).toBe('none');
          expect(c.payout).toBeGreaterThan(0);
        }
      }
    }
    expect(seen, 'на пиратских мирах не нашлось ни одной награды').toBeGreaterThan(0);
  });

  it('на мирах других владельцев награды нет, а вычищенное досуха логово её не даёт', () => {
    for (let i = 0; i < 300; i++) {
      if (GALAXY.ownerId(i) === PIRATE_FACTION) continue;
      const offers = contractBoard(WORLD, {}, GALAXY.id(i), 0, undefined, WAR_AT_START);
      expect(offers.some((c) => c.id.startsWith('B'))).toBe(false);
    }
    for (const id of pirateWorlds()) {
      const clean = { [id]: { cleared: 1 } };
      const offers = contractBoard(WORLD, clean, id, 0, undefined, WAR_AT_START);
      expect(offers.some((c) => c.id.startsWith('B'))).toBe(false);
    }
  });

  it('обычная биржа пиратского мира не сдвинута: награда дописана своим ГПСЧ в конец', () => {
    for (const id of pirateWorlds().slice(0, 20)) {
      const all = contractBoard(WORLD, {}, id, 0, undefined, WAR_AT_START);
      const firstBounty = all.findIndex((c) => c.id.startsWith('B'));
      if (firstBounty < 0) continue;
      expect(all.slice(firstBounty).every((c) => c.id.startsWith('B'))).toBe(true);
    }
  });

  it('выигранная награда вычищает логово и засчитывается победой здесь — путь к захвату открыт', () => {
    let target: { id: string; offer: Contract; state: CampaignState } | null = null;
    for (const id of pirateWorlds()) {
      const state = stateAt(id);
      state.reputation = { ...state.reputation, fame: 100 };
      const offer = availableContracts(WORLD, state.deltas, id, state.day, [], state.reputation, state.war).find((c) =>
        c.id.startsWith('B'),
      );
      if (offer !== undefined) {
        target = { id, offer, state };
        break;
      }
    }
    expect(target).not.toBeNull();
    const { id, offer, state } = target as { id: string; offer: Contract; state: CampaignState };
    run(state, { kind: 'takeContract', contractId: offer.id });
    // Плата за высадку (шаг 67) — не предмет этого теста: касса с запасом.
    state.company = { ...state.company, cbills: 2_000_000_000 };
    run(state, { kind: 'deploy', recordIds: ['M-1', 'M-2', 'M-3', 'M-4'] });
    run(state, { kind: 'resolveContract', outcome: outcomeFor(state, { playerWins: true }), salvage: [] });
    expect(clearedOf(state.deltas, id)).toBeCloseTo(CONTRACTS.pirates.clearPerWin, 5);
    expect(state.deltas[id]?.foughtWon).toBe(1);
  });
});

describe('работа новичку (2026-10-04)', () => {
  /** Ручка на время теста: зонд замера правит `CONTRACTS` так же, на лету. */
  function withNovice(value: number, body: () => void): void {
    const board = CONTRACTS.board as { noviceOffers: number };
    const saved = board.noviceOffers;
    board.noviceOffers = value;
    try {
      body();
    } finally {
      board.noviceOffers = saved;
    }
  }

  it('малоизвестному — пиратская работа сверх обычной, обычная побитово прежняя; к порогу известности прибавка исчезает', () => {
    const s = new CampaignState(1);
    const fresh = { ...s.reputation, fame: 0 };
    const known = { ...s.reputation, fame: CONTRACTS.board.noviceFame };
    let grown = 0;
    for (let i = 0; i < GALAXY.count && grown < 20; i += 7) {
      const id = GALAXY.id(i);
      let off: readonly Contract[] = [];
      let offKnown: readonly Contract[] = [];
      withNovice(0, () => {
        off = contractBoard(s.worldSeed, s.deltas, id, s.day, fresh, s.war);
        offKnown = contractBoard(s.worldSeed, s.deltas, id, s.day, known, s.war);
      });
      withNovice(1, () => {
        const on = contractBoard(s.worldSeed, s.deltas, id, s.day, fresh, s.war);
        expect(on.slice(0, off.length)).toEqual(off);
        for (const c of on.slice(off.length)) expect(c.target).toBe(PIRATE_FACTION);
        if (on.length > off.length) grown++;
        expect(contractBoard(s.worldSeed, s.deltas, id, s.day, known, s.war)).toEqual(offKnown);
      });
    }
    expect(grown).toBeGreaterThan(0);
  });
});

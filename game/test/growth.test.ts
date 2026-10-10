import { describe, expect, it } from 'vitest';
import {
  CampaignState,
  GALAXY,
  availableContracts,
  contractBrief,
  intelBand,
  contractThreat,
  debrief,
  judgedContracts,
  execute,
  fastResolve,
  isShipyard,
  lanceThreat,
  makeCompany,
  makeRecord,
  mechCapacityOf,
  ownerOf,
  worldProfile,
  type CampaignCommand,
  type CampaignEvent,
  type CampaignState as State,
  type Contract,
  type MechRecord,
} from '../src/core/campaign/index.js';
import type { Pilot } from '../src/core/model/index.js';
import { generateAssembly, makePilot } from '../src/core/rules/index.js';
import { ECONOMY } from '../src/core/data/index.js';
import { Rng } from '../src/core/rng/index.js';

/**
 * ЛЕСТНИЦА РОСТА (шаг 44, план Б) — сквозной прогон вместо ручной проверки.
 *
 * Замер `pnpm camp` меряет экономику средней кампании и на вопрос «есть ли
 * рост» не отвечает: бот-менеджер сам корабль не покупает и ротой не летает. А
 * вопрос ровно этот — ради него шаг и делался: **рота, выросшая в парке и в
 * корабле, обязана получить работу, которой у неё раньше не было, и деньги,
 * которых раньше не платили.**
 *
 * Прогон идёт командами, как играл бы игрок: биржа → подряд → вылет → бой →
 * разбор. Бой считается быстрым расчётом (`fastResolve`) — тем же, которым
 * считает «Рассчитать бой» в игре: тактическая партия двенадцати на двенадцать
 * идёт девять секунд, и место ей в замере, а не в тестах.
 */

const WORLD = 1;

function mech(id: string, code: string, seed: number, pilotId: string): MechRecord {
  return {
    ...makeRecord({ id, assembly: generateAssembly({ chassisCode: code, role: 'brawler' }, new Rng(seed)) }),
    pilotId,
  };
}

/** Рота из машин одного класса: столько-то корпусов такого-то кода, все с пилотами. */
function company(count: number, code: string, cbills: number, dropship: 'leopard' | 'union' | 'overlord') {
  const mechs: MechRecord[] = [];
  const pilots: Pilot[] = [];
  for (let i = 1; i <= count; i++) {
    const pilotId = `P-${i}`;
    mechs.push(mech(`M-${i}`, code, i, pilotId));
    pilots.push(makePilot(new Rng(20 + i), { id: pilotId, callsign: `П-${i}`, tier: 4 }));
  }
  // Ячейки ангара выкуплены под парк (шаг 75), но не выше потолка корабля.
  const ship = ECONOMY.dropships[dropship];
  const hangar = Math.min(ship.mechCapacity, Math.max(ship.minMechs, count));
  return { ...makeCompany(), mechs, pilots, cbills, dropship, bays: Math.max(4, count), hangar };
}

function run(state: State, command: CampaignCommand): readonly CampaignEvent[] {
  const result = execute(state, command);
  if (!result.ok) throw new Error(`Команда ${command.kind} отклонена: ${result.reason}`);
  return result.events;
}

/** Первая система, где у этой роты есть посильная работа. Ищется так же, как ищет её бот. */
function workFor(state: State, from = 0): { systemId: string; offer: Contract } | null {
  const ours = lanceThreat(state.company, state.company.mechs);
  for (let i = from; i < GALAXY.count; i++) {
    const id = GALAXY.id(i);
    const offers = availableContracts(state.worldSeed, state.deltas, id, state.day, [], state.reputation, state.war);
    for (const offer of offers) {
      if (contractThreat(offer) <= ours) return { systemId: id, offer };
    }
  }
  return null;
}

/** Сколько списано за высадку сверх нормы нанимателя (шаг 67). */
function landingPaid(events: readonly CampaignEvent[]): number {
  return events.reduce((sum, e) => sum + (e.kind === 'landingPaid' ? e.amount : 0), 0);
}

/**
 * Один подряд от подписи до расчёта, ровно теми же командами, что и в игре.
 *
 * Возвращает заработок ПО КОНТРАКТУ — без платы за высадку (шаг 67): лестница
 * роста проверяет, что крупная работа платит больше мелкой, а весь парк на вылет
 * здесь выводится ради этого, а не ради цены вылета. Плату проверяет свой тест.
 */
function workContract(state: State, offer: Contract, lance: readonly string[]): number {
  const before = state.company.cbills;
  run(state, { kind: 'takeContract', contractId: offer.id });
  const landing = landingPaid(run(state, { kind: 'deploy', recordIds: [...lance] }));
  const brief = contractBrief(state);
  const outcome = fastResolve(brief);
  debrief({ brief, outcome, rng: state.rng });
  run(state, { kind: 'resolveContract', outcome });
  return state.company.cbills - before + landing;
}

describe('лестница роста: от тройки лёгких до роты (шаг 44)', () => {
  it('стартовой роте есть за что браться, а ротная работа ей не по зубам', () => {
    const state = new CampaignState(1, { worldSeed: WORLD });
    state.company = company(3, 'IS-H35-R3F1', 500_000, 'leopard');

    // 1. Работа по силам находится — стартовая ниша цела.
    const found = workFor(state);
    expect(found).not.toBeNull();
    const ours = lanceThreat(state.company, state.company.mechs);
    expect(contractThreat((found as { offer: Contract }).offer)).toBeLessThanOrEqual(ours);

    // 2. И при этом на карте есть работа, которой тройке не поднять. До шага 44
    //    её не существовало в принципе: противник считался от звена, и любой
    //    контракт был впору тому, кто на него смотрит.
    let beyond = 0;
    for (let i = 0; i < GALAXY.count; i += 5) {
      for (const c of availableContracts(WORLD, {}, GALAXY.id(i), 0, [], state.reputation, state.war)) {
        if (contractThreat(c) > ours * 3) beyond++;
      }
    }
    expect(beyond).toBeGreaterThan(20);
  });

  it('рота с Юнионом берёт работу, которой тройка не видела, и получает за неё больше', () => {
    // --- ступень 1: тройка лёгких на Леопарде -------------------------------
    const small = new CampaignState(1, { worldSeed: WORLD });
    small.company = company(3, 'IS-H35-R3F1', 500_000, 'leopard');
    expect(mechCapacityOf(small.company)).toBe(4);

    const smallWork = workFor(small);
    expect(smallWork).not.toBeNull();
    const { systemId: smallSystem, offer: smallOffer } = smallWork as { systemId: string; offer: Contract };
    small.systemId = smallSystem;
    const smallPay = workContract(small, smallOffer, ['M-1', 'M-2', 'M-3']);
    expect(smallPay).toBeGreaterThan(0);

    // --- ступень 2: двенадцать средних, корабль куплен командой -------------
    const big = new CampaignState(1, { worldSeed: WORLD });
    big.company = company(12, 'IS-H55-R3F2', 4_000_000, 'leopard');

    // Корабль меняется настоящей командой, а не подстановкой поля: для этого
    // нужна верфь, и её приходится искать — ровно как игроку.
    let yard: string | null = null;
    for (let i = 0; i < GALAXY.count && yard === null; i++) {
      if (isShipyard(worldProfile(WORLD, {}, i))) yard = GALAXY.id(i);
    }
    expect(yard).not.toBeNull();
    big.systemId = yard as string;
    run(big, { kind: 'upgradeDropship' });
    expect(big.company.dropship).toBe('union');
    // Юнион открывает свой минимум (шаг 75); ячейки до двенадцати рота
    // докупает лестницей — сам выкуп проверяет `hangar.test.ts`, здесь он
    // подставлен полем: тест про работу, которую видит выросшая рота.
    expect(mechCapacityOf(big.company)).toBe(ECONOMY.dropships.union.minMechs);
    big.company = { ...big.company, hangar: 12 };

    // --- рота видит то, чего не видела тройка -------------------------------
    const bigWork = workFor(big);
    expect(bigWork).not.toBeNull();
    const smallThreat = lanceThreat(small.company, small.company.mechs);

    // Ищем работу, посильную роте и НЕ посильную тройке: это и есть рост.
    let grown: { systemId: string; offer: Contract } | null = null;
    const bigThreat = lanceThreat(big.company, big.company.mechs);
    for (let i = 0; i < GALAXY.count && grown === null; i++) {
      const id = GALAXY.id(i);
      for (const c of availableContracts(WORLD, {}, id, 0, [], big.reputation, big.war)) {
        if (contractThreat(c) <= bigThreat && contractThreat(c) > smallThreat && c.opforUnits >= 6) {
          grown = { systemId: id, offer: c };
          break;
        }
      }
    }
    expect(grown).not.toBeNull();
    const { systemId: bigSystem, offer: bigOffer } = grown as { systemId: string; offer: Contract };
    big.systemId = bigSystem;

    // --- вылет ротой, поле по числу машин, расчёт ---------------------------
    run(big, { kind: 'takeContract', contractId: bigOffer.id });
    const lance = big.company.mechs.map((m) => m.id);
    // Касса с запасом под плату за высадку (шаг 67). В заработок плата не входит:
    // касса ниже снимается уже после вылета.
    big.company = { ...big.company, cbills: big.company.cbills + 1_000_000_000 };
    run(big, { kind: 'deploy', recordIds: lance });

    const brief = contractBrief(big);
    expect(brief.company.length).toBe(12);
    // Число машин противника — свойство ПРЕДЛОЖЕНИЯ, а не размера вылета (шаг 44).
    // Но на поле выходит объявленное с поправкой на ошибку разведки (шаг 57, и
    // с 2026-09-21 поправка вероятностная — сдвинуться может и точная сводка),
    // поэтому сверяется полоса, которую показали игроку, а не само обещание.
    const band = intelBand(bigOffer).units;
    expect(brief.enemy.length).toBeGreaterThanOrEqual(band[0]);
    expect(brief.enemy.length).toBeLessThanOrEqual(band[1]);
    // Поле растёт вместе с числом машин на нём (`contracts.json → map.steps`).
    expect(brief.map?.width ?? 0).toBeGreaterThanOrEqual(40);

    const before = big.company.cbills;
    const outcome = fastResolve(brief);
    debrief({ brief, outcome, rng: big.rng });
    run(big, { kind: 'resolveContract', outcome });
    const bigPay = big.company.cbills - before;

    // Крупная работа платит больше мелкой — это половина шага 44b. Сравниваются
    // РАЗНЫЕ работы с разных миров, поэтому мерка здесь «больше», а не «вдвое»:
    // кратность держится не типом контракта, а размером сил, и её проверяет
    // `contracts.test.ts` на одинаковых прочих условиях. До шага 56 тот же
    // порог в две цены проходил по другой причине — мелкая работа была
    // гарнизонной, а у гарнизона цену резали двойным множителем типа.
    expect(bigOffer.payout).toBeGreaterThan(smallOffer.payout);
    expect(bigPay).toBeGreaterThan(smallPay);
    // Сила работы и её цена идут в одну сторону: больше машино-тонн — дороже.
    expect(bigOffer.opforUnits).toBeGreaterThan(smallOffer.opforUnits);
  });
});

describe('судьба сектора: исход двигает флаг планеты (шаг 44e)', () => {
  /**
   * Мир, в котором война успела разгореться.
   *
   * В первый день кампании напряжённость нулевая по всей карте, и ставки сектора
   * не бывает нигде — это не оговорка теста, а само правило: судьбу секторов
   * решают там, где стороны уже стянули силы. Мир гоняется очередью задач —
   * тем же тикером войны, что и в игре.
   *
   * СРОК НЕ ЗАШИТ, А ИЩЕТСЯ. Ставки сектора на карте то появляются, то гаснут
   * (замер 2026-09-13: на трёх сидах за 1200 дней обычно 5–20 систем со
   * ставкой, но бывают дни без ставки обороны). Зашитый срок ломался при любой
   * правке мира — канонические биомы столиц, четвёртый весовой класс у
   * соперников, — хотя игре такой провал ничем не грозит. Поэтому мир идёт
   * шагами по полсотни дней до первого дня, где на карте есть ОБА типа ставки.
   */
  function sectorOfferIn(state: State, mission: 'defense' | 'assault'): { systemId: string; offer: Contract } | null {
    for (let i = 0; i < GALAXY.count; i++) {
      const id = GALAXY.id(i);
      for (const o of judgedContracts(state.worldSeed, state.deltas, id, state.day, state.reputation, state.war)) {
        if (o.contract.stakes === 'sector' && o.contract.mission === mission) {
          return { systemId: id, offer: o.contract };
        }
      }
    }
    return null;
  }

  const world = ((): State => {
    const state = new CampaignState(1, { worldSeed: WORLD });
    execute(state, { kind: 'advance', days: 300 });
    for (let day = 300; day <= 1200; day += 50) {
      if (sectorOfferIn(state, 'defense') !== null && sectorOfferIn(state, 'assault') !== null) break;
      execute(state, { kind: 'advance', days: 50 });
    }
    return state;
  })();

  /** Контракт со ставкой сектора нужного типа — ищется по карте, как всё в этом файле. */
  function sectorOffer(mission: 'defense' | 'assault'): { systemId: string; offer: Contract } | null {
    return sectorOfferIn(world, mission);
  }

  /** Состояние с уже взятым и выведенным контрактом: дальше остаётся только исход. */
  function deployed(systemId: string, offer: Contract): State {
    const state = new CampaignState(1, { worldSeed: WORLD, systemId });
    state.deltas = world.deltas;
    state.war = world.war;
    state.day = world.day;
    // Денег — с запасом на плату за высадку сверх нормы (шаг 67): контракт
    // ищется по миру, и у найденного может оказаться своё звено нанимателя, при
    // котором двенадцать машин роты — перебор. Плата тогда доходит до большей
    // части выплаты (шаг 71: 6.3 млн при выплате 7.9 млн), а тест не про
    // экономику вылета, а про судьбу сектора.
    state.company = company(12, 'IS-H55-R3F2', 20_000_000, 'union');
    state.contract = {
      contract: offer,
      takenDay: 0,
      deadlineDay: offer.durationDays,
      advancePaid: offer.advance,
      sortie: null,
    };
    run(state, { kind: 'deploy', recordIds: state.company.mechs.map((m) => m.id) });
    return state;
  }

  it('ставка сектора бывает только у крупной работы на горячем участке', () => {
    const found = sectorOffer('defense') ?? sectorOffer('assault');
    expect(found).not.toBeNull();
    const { offer } = found as { offer: Contract };
    // Правило — про МАСШТАБ (`opfor.sector.minScale`), а не про число машин:
    // скудное снабжение урезает ротный состав (10 × 0.9 = 9), и ставка при этом
    // законна. Проверка «машин ≥ 10» ловила снабжение, а не правило.
    expect(['company', 'battalion']).toContain(offer.scale);
    expect(offer.tension).toBeGreaterThanOrEqual(0.25);
    expect(['assault', 'defense']).toContain(offer.mission);
  });

  it('проигранная оборона сектора отдаёт мир противнику', () => {
    const found = sectorOffer('defense');
    expect(found).not.toBeNull();
    const { systemId, offer } = found as { systemId: string; offer: Contract };
    const state = deployed(systemId, offer);
    expect(ownerOf(state.deltas, GALAXY.require(systemId))).toBe(offer.employer);

    const brief = contractBrief(state);
    const events = run(state, {
      kind: 'resolveContract',
      outcome: { ...fastResolve(brief), winner: 'opfor', heldField: false },
    });

    // Проверяется ход фронта, вызванный ПРОИГРАННЫМ КОНТРАКТОМ, а не итоговый
    // владелец через день. Две ловушки, обе живые:
    //
    // 1. `resolveContract` двигает не только ставку контракта — вместе с ним
    //    идёт такт войны, и в том же дне противник может отбить планету назад.
    //    Именно это и случилось, когда мир после правки тепла разошёлся: два
    //    захвата одной планеты подряд, второй в обратную сторону.
    // 2. Владельца надо спрашивать у `ownerOf`, а не читать сырую дельту: мир,
    //    вернувшийся к своему каноническому хозяину, запись о владельце теряет
    //    целиком (`front.ts::capture`) — дельта хранит только отличия от канона.
    const here = events.filter((e) => e.kind === 'frontMoved' && e.systemId === systemId);
    const byContract = here[0];
    expect(byContract).toBeDefined();
    expect(byContract?.kind === 'frontMoved' && byContract.attacker).toBe(offer.target);
    expect(byContract?.kind === 'frontMoved' && byContract.defender).toBe(offer.employer);

    const last = here[here.length - 1];
    const finalOwner = last?.kind === 'frontMoved' && last.kindOfMove === 'capture' ? last.attacker : offer.target;
    expect(ownerOf(state.deltas, GALAXY.require(systemId))).toBe(finalOwner);
    // Числа события — настоящие, из боя: событие идёт в сводку войны, и
    // выдуманные размеры сторон разошлись бы с разбором того же боя.
    if (byContract?.kind === 'frontMoved') {
      expect(byContract.defenderSize).toBe(12);
      // Размер стороны берётся из ОТЫГРАННОГО боя, а не из обещания биржи:
      // разведка ошибается, и событие обязано нести то, что вышло на поле.
      expect(byContract.attackerSize).toBe(brief.enemy.length);
    }
  });

  it('выигранный штурм сектора отдаёт нанимателю соседний мир противника', () => {
    const found = sectorOffer('assault');
    expect(found).not.toBeNull();
    const { systemId, offer } = found as { systemId: string; offer: Contract };
    const state = deployed(systemId, offer);

    const neighbour = GALAXY.neighbors(GALAXY.require(systemId)).find(
      (n) => ownerOf(state.deltas, n) === offer.target,
    );
    const brief = contractBrief(state);
    const events = run(state, {
      kind: 'resolveContract',
      outcome: { ...fastResolve(brief), winner: 'player', heldField: true },
    });

    if (neighbour === undefined) {
      // Соседа под флагом противника может не оказаться — тогда двигать нечего,
      // и это законный исход, а не молчаливая поломка.
      expect(events.find((e) => e.kind === 'frontMoved')).toBeUndefined();
      return;
    }

    // Те же две ловушки, что и в обороне выше: такт войны в тот же день может
    // отбить мир обратно, поэтому ход контракта ищется по ИМЕННО ЭТОМУ соседу
    // (первое событие по нему), а владелец сверяется с последним ходом.
    const neighbourId = GALAXY.id(neighbour);
    const there = events.filter((e) => e.kind === 'frontMoved' && e.systemId === neighbourId);
    const byContract = there[0];
    expect(byContract).toBeDefined();
    expect(byContract?.kind === 'frontMoved' && byContract.attacker).toBe(offer.employer);
    expect(byContract?.kind === 'frontMoved' && byContract.defender).toBe(offer.target);
    expect(byContract?.kind === 'frontMoved' && byContract.kindOfMove).toBe('capture');

    const last = there[there.length - 1];
    const finalOwner = last?.kind === 'frontMoved' && last.kindOfMove === 'capture' ? last.attacker : offer.employer;
    expect(ownerOf(state.deltas, neighbour)).toBe(finalOwner);
  });

  it('обычная работа флаг не двигает', () => {
    const state = new CampaignState(1, { worldSeed: WORLD });
    state.company = company(3, 'IS-H35-R3F1', 500_000, 'leopard');
    const found = workFor(state);
    expect(found).not.toBeNull();
    const { systemId, offer } = found as { systemId: string; offer: Contract };
    expect(offer.stakes).toBe('none');
    state.systemId = systemId;

    run(state, { kind: 'takeContract', contractId: offer.id });
    run(state, { kind: 'deploy', recordIds: ['M-1', 'M-2', 'M-3'] });
    const brief = contractBrief(state);
    const events = run(state, { kind: 'resolveContract', outcome: fastResolve(brief) });
    expect(events.find((e) => e.kind === 'frontMoved')).toBeUndefined();
  });
});

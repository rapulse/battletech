import { describe, expect, it } from 'vitest';
import {
  CampaignRejectReason,
  CampaignState,
  GALAXY,
  MARKET,
  availableStock,
  decadeOf,
  execute,
  hashCampaignState,
  installedItems,
  itemCost,
  makeCompany,
  makeRecord,
  makeSaveFile,
  marketFileSchema,
  marketProfile,
  marketStock,
  mechValue,
  nodeValue,
  parseSaveFile,
  nodeCost,
  orderPrice,
  recordNodeSpec,
  withQuality,
  type WarehousePart,
  type WearNode,
  recordQuality,
  restore,
  scrapPlan,
  scrapSalvage,
  sellPrice,
  sellsClass,
  snapshot,
  type CampaignCommand,
  type CampaignEvent,
  type Company,
  type MechRecord,
  type MarketClass,
} from '../src/core/campaign/index.js';
import { zoneFromId, type QualityClass, type ZoneId } from '../src/core/model/index.js';
import { generateAssembly, makePlatform } from '../src/core/rules/index.js';
import { Rng } from '../src/core/rng/index.js';
import { CHASSIS_CATALOG } from '../src/core/data/index.js';

/**
 * Шаг 15 — рынок и снабжение: доступность по классу системы.
 *
 * Проверяется ровно то, на чём стоит гибрид доступности (решение 6 §2
 * `часть2-pipeline.md`): ассортимент выводится, а не хранится; класс системы
 * решает, что тут вообще продаётся; купленное не возвращается; заказ приходит
 * в назначенный день; разбор отдаёт уцелевшее и только его; и обе петли
 * арбитража — покупка/продажа и целое/по частям — закрыты.
 */

const CODE = 'IS-H55-R3F2';
const WORLD = 1;

function freshRecord(id: string, seed = 1, code = CODE): MechRecord {
  const assembly = generateAssembly({ chassisCode: code, role: 'brawler' }, new Rng(seed));
  return makeRecord({ id, assembly });
}

/**
 * Заказ одной позиции под узел конкретной машины — короткая запись частого
 * случая. Спецификация с шага 45 задаётся явно; здесь она просто повторяет
 * паспорт машины, чтобы старые проверки мерили ровно то, что мерили раньше.
 */
function orderFor(record: MechRecord, node: WearNode, targetClass: QualityClass): CampaignCommand {
  const spec = recordNodeSpec(record, node);
  return {
    kind: 'orderPart',
    items: [{ node, tonnage: spec.tonnage, tier: spec.tier, targetClass }],
  };
}

/** Складская запись каркаса: тоннаж и тир задаются явно — их и проверяем. */
function frameLot(id: string, tonnage: number, tier: number, quality: QualityClass): WarehousePart {
  return { sort: 'node', id, node: 'frame', quality, wear: 0, sourceTonnage: tonnage, tier };
}

function stateAt(systemId: string, company: Partial<Company> = {}): CampaignState {
  const state = new CampaignState(1, { worldSeed: WORLD, systemId });
  state.company = { ...makeCompany(), ...company };
  return state;
}

function run(state: CampaignState, command: CampaignCommand): readonly CampaignEvent[] {
  const result = execute(state, command);
  if (!result.ok) throw new Error(`Команда ${command.kind} отклонена: ${result.reason}`);
  return result.events;
}

/** Первая система указанного класса рынка. Перебором, чтобы фикстура не рассыпалась от правки каталога. */
function systemOfClass(cls: MarketClass): string {
  for (let i = 0; i < GALAXY.count; i++) {
    const id = GALAXY.id(i);
    if (marketProfile(WORLD, id).marketClass === cls) return id;
  }
  throw new Error(`На карте нет ни одной системы класса ${cls}`);
}

/** Зона разрушена вдребезги: всё, что в ней стояло, разбору уже не достанется. */
function withDestroyedZone(record: MechRecord, zone: ZoneId): MechRecord {
  const idx = zoneFromId(zone);
  const zones = record.condition.zones.map((z, i) =>
    i === idx ? { armor: 0, structure: 0, destroyed: true } : z,
  );
  return { ...record, condition: { ...record.condition, zones } };
}

describe('данные рынка', () => {
  it('market.json проходит схему, и спред продажи заметно ниже единицы', () => {
    expect(marketFileSchema.safeParse(MARKET).success).toBe(true);
    expect(MARKET.sell.spread).toBeLessThan(0.8);
    expect(MARKET.decadeDays).toBeGreaterThan(0);
  });

  it('схема отсекает опечатку, а не пропускает её молча', () => {
    const broken = { ...MARKET, sell: { ...MARKET.sell, spred: MARKET.sell.spread } };
    expect(marketFileSchema.safeParse(broken).success).toBe(false);
    const missingClass = { ...MARKET, classes: { ...MARKET.classes, periphery: undefined } };
    expect(marketFileSchema.safeParse(missingClass).success).toBe(false);
  });
});

describe('класс системы задаёт лавку', () => {
  it('все шесть классов встречаются на карте', () => {
    const seen = new Set<MarketClass>();
    for (let i = 0; i < GALAXY.count; i++) seen.add(marketProfile(WORLD, GALAXY.id(i)).marketClass);
    expect(seen.size).toBe(6);
  });

  it('в столице продаётся мастерский класс, на периферии — нет, и это дороже', () => {
    const capital = marketProfile(WORLD, systemOfClass('capital'));
    const periphery = marketProfile(WORLD, systemOfClass('periphery'));

    expect(sellsClass(capital, 'master')).toBe(true);
    expect(sellsClass(periphery, 'master')).toBe(false);
    expect(sellsClass(periphery, 'military')).toBe(false);
    // Восстановленный есть везде: нижняя ступень лестницы доступна всегда.
    expect(sellsClass(periphery, 'recovered')).toBe(true);
    expect(periphery.priceFactor).toBeGreaterThan(capital.priceFactor);
  });

  it('там, где класс не продают, его не купить ни за какие деньги — только заказать', () => {
    const state = stateAt(systemOfClass('periphery'), {
      mechs: [freshRecord('M-1')],
      cbills: 50_000_000,
    });
    expect(
      execute(state, { kind: 'upgradeClass', recordId: 'M-1', node: 'reactor', targetClass: 'master' }),
    ).toEqual({ ok: false, reason: CampaignRejectReason.ClassNotSold });
    // И заказать с периферии тоже нельзя: оттуда не возят вовсе.
    expect(
      execute(state, orderFor(state.company.mechs.find((x) => x.id === 'M-1')!, 'reactor', 'master')),
    ).toEqual({ ok: false, reason: CampaignRejectReason.NoDelivery });
  });

  it('в столице тот же класс покупается — ради этого перелёт и нужен', () => {
    const state = stateAt(systemOfClass('capital'), {
      mechs: [freshRecord('M-1')],
      cbills: 50_000_000,
    });
    expect(
      execute(state, { kind: 'upgradeClass', recordId: 'M-1', node: 'reactor', targetClass: 'master' }).ok,
    ).toBe(true);
  });
});

describe('ассортимент выводится, а не хранится', () => {
  const capital = systemOfClass('capital');

  it('воспроизводим по (сид мира, система, декада)', () => {
    expect(marketStock(WORLD, capital, 0)).toEqual(marketStock(WORLD, capital, 0));
    expect(marketStock(WORLD, capital, 0)).not.toEqual(marketStock(WORLD + 1, capital, 0));
    expect(marketStock(WORLD, capital, 0)).not.toEqual(marketStock(WORLD, systemOfClass('developed'), 0));
  });

  it('на прилавке только установки, а число позиций лавки прежнее (реакторы и каркасы заказывают из ангара)', () => {
    for (const cls of ['capital', 'developed', 'backwater'] as const) {
      const id = systemOfClass(cls);
      const random = marketStock(WORLD, id, 0).filter((l) => l.supply !== true);
      expect(random).toHaveLength(marketProfile(WORLD, id).lots);
      for (const lot of random) expect(lot).toHaveProperty('itemId');
    }
  });

  it('декада считается от дня кампании: внутри декады не меняется, на границе — меняется', () => {
    const last = MARKET.decadeDays - 1;
    expect(marketStock(WORLD, capital, 0)).toEqual(marketStock(WORLD, capital, last));
    expect(marketStock(WORLD, capital, 0)).not.toEqual(marketStock(WORLD, capital, MARKET.decadeDays));
    expect(decadeOf(MARKET.decadeDays)).toBe(1);
  });

  it('купленное не появляется снова в этой декаде и возвращается в следующей', () => {
    const state = stateAt(capital, { cbills: 50_000_000 });
    const lot = marketStock(WORLD, capital, 0)[0]!;

    run(state, { kind: 'buyPart', lotId: lot.id });
    expect(state.company.warehouse).toHaveLength(1);
    expect(availableStock(WORLD, capital, 0, state.deltas[capital]?.bought ?? []).map((l) => l.id)).not.toContain(
      lot.id,
    );
    expect(execute(state, { kind: 'buyPart', lotId: lot.id })).toEqual({
      ok: false,
      reason: CampaignRejectReason.LotNotAvailable,
    });

    // Следующая декада — новый ассортимент, и старый список покупок его не вычёркивает.
    // Считаются только СЛУЧАЙНЫЕ лоты: снабжение (охладители и боезапас, шаг 32)
    // не занимает позиций декады и не кончается вовсе.
    run(state, { kind: 'advance', days: MARKET.decadeDays });
    const next = availableStock(WORLD, capital, state.day, state.deltas[capital]?.bought ?? []);
    expect(next.filter((l) => l.supply !== true)).toHaveLength(
      marketProfile(WORLD, capital).lots,
    );
  });

  it('снабжение есть всегда и не кончается: охладители и боезапас (шаг 32)', () => {
    // До шага 32 охладители конкурировали с ЭПП и зондом за 6-8 случайных
    // позиций в декаду и не появлялись почти никогда, а боезапас был исключён
    // из торговли вовсе. Оба — базовый расходник, а не находка.
    const state = stateAt(capital, { cbills: 50_000_000 });
    const supply = availableStock(WORLD, capital, 0).filter((l) => l.supply === true);
    expect(supply.some((l) => l.itemId === 'is_shs')).toBe(true);
    expect(supply.some((l) => l.itemId === 'is_dhs')).toBe(true);
    expect(supply.some((l) => l.itemId.startsWith('ammo_'))).toBe(true);

    // Куплена дважды подряд — и оба раза успешно: снабжение не вычёркивается.
    const lot = supply[0]!;
    run(state, { kind: 'buyPart', lotId: lot.id });
    run(state, { kind: 'buyPart', lotId: lot.id });
    expect(state.company.warehouse).toHaveLength(2);
  });

  it('покупка не кладёт ассортимент в сохранение — только факт покупки', () => {
    const state = stateAt(capital, { cbills: 50_000_000 });
    const before = JSON.stringify(makeSaveFile(snapshot(state))).length;
    run(state, { kind: 'buyPart', lotId: marketStock(WORLD, capital, 0)[0]!.id });
    const after = JSON.stringify(makeSaveFile(snapshot(state))).length;
    // Десятки байт на дельту и складскую запись, а не килобайты на прилавок.
    expect(after - before).toBeLessThan(400);
  });
});

describe('цены', () => {
  const capital = systemOfClass('capital');

  it('продать заметно дешевле, чем купить, — иначе возка товара между системами стала бы доходом', () => {
    const profile = marketProfile(WORLD, capital);
    const state = stateAt(capital, { cbills: 50_000_000 });
    const lot = marketStock(WORLD, capital, 0).find((l) => l.supply !== true)!;

    run(state, { kind: 'buyPart', lotId: lot.id });
    const partId = state.company.warehouse[0]!.id;
    const cbillsAfterBuy = state.company.cbills;
    run(state, { kind: 'sellPart', partId });

    const gained = state.company.cbills - cbillsAfterBuy;
    expect(gained).toBeLessThan(lot.price);
    expect(gained).toBeLessThanOrEqual(Math.round(lot.price * MARKET.sell.demand.high));
    expect(profile.sellFactor).toBeGreaterThan(0);
  });

  it('износ снижает цену узла, а разрушенная зона — цену машины', () => {
    const record = freshRecord('M-1');
    const spec = recordNodeSpec(record, 'reactor');
    expect(nodeValue(spec, 'standard', 0)).toBeGreaterThan(nodeValue(spec, 'standard', 60));

    const hurt = withDestroyedZone(record, 'leftArm');
    expect(mechValue(hurt)).toBeLessThan(mechValue(record));
  });

  it('класс исполнения виден в цене узла: мастерский дороже серийного', () => {
    const spec = recordNodeSpec(freshRecord('M-1'), 'reactor');
    expect(nodeValue(spec, 'master', 0)).toBeGreaterThan(nodeValue(spec, 'standard', 0));
    expect(nodeValue(spec, 'standard', 0)).toBeGreaterThan(nodeValue(spec, 'recovered', 0));
  });
});

describe('заказ с доставкой', () => {
  const capital = systemOfClass('capital');

  it('приходит ровно в назначенный день, ни днём раньше', () => {
    const profile = marketProfile(WORLD, capital);
    const state = stateAt(capital, { mechs: [freshRecord('M-1')], cbills: 50_000_000 });

    const events = run(state, orderFor(state.company.mechs[0]!, 'reactor', 'master'));
    const ordered = events.find((e) => e.kind === 'partOrdered')!;
    expect(ordered.arrivalDay).toBe(profile.orderDays);

    run(state, { kind: 'advanceTo', day: profile.orderDays - 1 });
    expect(state.company.warehouse).toHaveLength(0);

    run(state, { kind: 'advanceTo', day: profile.orderDays });
    expect(state.company.warehouse).toHaveLength(1);
    expect(state.company.warehouse[0]!.id).toBe(ordered.partId);
  });

  it('заказ дороже покупки на месте — за скорость доставки платят', () => {
    const state = stateAt(capital, { mechs: [freshRecord('M-1')], cbills: 50_000_000 });
    const before = state.company.cbills;
    run(state, orderFor(state.company.mechs.find((x) => x.id === 'M-1')!, 'reactor', 'military'));
    const ordered = before - state.company.cbills;

    const local = stateAt(capital, { mechs: [freshRecord('M-1')], cbills: 50_000_000 });
    const localBefore = local.company.cbills;
    run(local, { kind: 'upgradeClass', recordId: 'M-1', node: 'reactor', targetClass: 'military' });
    expect(ordered).toBeGreaterThan(localBefore - local.company.cbills);
  });

  it('доехавший узел встаёт на машину и поднимает её класс', () => {
    const profile = marketProfile(WORLD, capital);
    const state = stateAt(capital, { mechs: [freshRecord('M-1')], cbills: 50_000_000 });

    run(state, orderFor(state.company.mechs.find((x) => x.id === 'M-1')!, 'reactor', 'master'));
    run(state, { kind: 'advanceTo', day: profile.orderDays });
    const partId = state.company.warehouse[0]!.id;

    run(state, { kind: 'installPart', recordId: 'M-1', partId });
    // Пока работа идёт, узел числится в цеху: ни продать, ни поставить второй раз.
    expect(execute(state, { kind: 'sellPart', partId })).toEqual({
      ok: false,
      reason: CampaignRejectReason.PartReserved,
    });
    expect(execute(state, { kind: 'installPart', recordId: 'M-1', partId })).toEqual({
      ok: false,
      reason: CampaignRejectReason.PartReserved,
    });

    run(state, { kind: 'advance', days: 30 });
    expect(recordQuality(state.company.mechs[0]!).reactor).toBe('master');

    // Снятый узел ложится на склад — то же правило, что у мехлаба (шаг 45).
    // Купленная деталь ушла в машину, а стоявший там серийный реактор остался
    // отряду: его можно продать или поставить на вторую такую же машину.
    expect(state.company.warehouse).toHaveLength(1);
    const stowed = state.company.warehouse[0]!;
    expect(stowed.sort).toBe('node');
    expect(stowed).toMatchObject({ node: 'reactor', quality: 'standard' });
    expect(execute(state, { kind: 'sellPart', partId: stowed.id }).ok).toBe(true);
  });

  it('отменённая установка возвращает узел на полку', () => {
    const state = stateAt(capital, { mechs: [freshRecord('M-1')], cbills: 50_000_000 });
    run(state, orderFor(state.company.mechs.find((x) => x.id === 'M-1')!, 'frame', 'military'));
    run(state, { kind: 'advanceTo', day: marketProfile(WORLD, capital).orderDays });
    const partId = state.company.warehouse[0]!.id;

    const scheduled = run(state, { kind: 'installPart', recordId: 'M-1', partId }).find(
      (e) => e.kind === 'jobScheduled',
    )!;
    run(state, { kind: 'cancelJob', jobId: scheduled.jobId });

    expect(state.company.warehouse.map((w) => w.id)).toEqual([partId]);
    expect(execute(state, { kind: 'sellPart', partId }).ok).toBe(true);
  });

  it('заказывается связка любого тира, которого на роте нет вовсе (шаг 45)', () => {
    const profile = marketProfile(WORLD, capital);
    // Машина R3F2 на 55 тонн. Заказываем связку R1 + F1 — ни того, ни другого
    // тира на роте нет, и до шага 45 их нельзя было ни заказать, ни улучшить:
    // тир брался у машины, и оставалась только полка.
    const state = stateAt(capital, { mechs: [freshRecord('M-1')], cbills: 50_000_000 });
    const before = state.company.cbills;

    const events = run(state, {
      kind: 'orderPart',
      items: [
        { node: 'reactor', tonnage: 55, tier: 1, targetClass: 'military' },
        { node: 'frame', tonnage: 55, tier: 1, targetClass: 'military' },
      ],
    });

    // Один счёт, один номер заказа, один день прибытия.
    const ordered = events.filter((e) => e.kind === 'partOrdered');
    expect(ordered).toHaveLength(2);
    expect(new Set(ordered.map((e) => e.orderId)).size).toBe(1);
    expect(new Set(ordered.map((e) => e.arrivalDay))).toEqual(new Set([profile.orderDays]));

    const paid = before - state.company.cbills;
    expect(paid).toBe(
      orderPrice(nodeCost({ node: 'reactor', tonnage: 55, tier: 1 }, 'military'), profile) +
        orderPrice(nodeCost({ node: 'frame', tonnage: 55, tier: 1 }, 'military'), profile),
    );

    run(state, { kind: 'advanceTo', day: profile.orderDays });
    expect(state.company.warehouse).toHaveLength(2);
    expect(state.company.warehouse.map((w) => (w.sort === 'node' ? w.tier : -1)).sort()).toEqual([1, 1]);
  });

  it('узла, которого не бывает, заказать нельзя — и деньги остаются', () => {
    const state = stateAt(capital, { mechs: [freshRecord('M-1')], cbills: 50_000_000 });
    const before = state.company.cbills;

    // Тир вне таблицы своего узла: у каркаса ступеней три, шестой не бывает.
    expect(
      execute(state, {
        kind: 'orderPart',
        items: [{ node: 'frame', tonnage: 55, tier: 6, targetClass: 'military' }],
      }),
    ).toEqual({ ok: false, reason: CampaignRejectReason.PartMismatch });

    // Тоннаж, под который нет ни одного шасси: узел некуда поставить.
    expect(
      execute(state, {
        kind: 'orderPart',
        items: [{ node: 'reactor', tonnage: 57, tier: 1, targetClass: 'military' }],
      }),
    ).toEqual({ ok: false, reason: CampaignRejectReason.PartMismatch });

    expect(state.company.cbills).toBe(before);
    expect(state.company.warehouse).toHaveLength(0);
  });

  it('связка не оплачивается наполовину: денег не хватило — не заказано ничего', () => {
    const profile = marketProfile(WORLD, capital);
    const one = orderPrice(nodeCost({ node: 'reactor', tonnage: 55, tier: 1 }, 'military'), profile);
    const state = stateAt(capital, { mechs: [freshRecord('M-1')], cbills: one + 1000 });

    expect(
      execute(state, {
        kind: 'orderPart',
        items: [
          { node: 'reactor', tonnage: 55, tier: 1, targetClass: 'military' },
          { node: 'frame', tonnage: 55, tier: 1, targetClass: 'military' },
        ],
      }),
    ).toEqual({ ok: false, reason: CampaignRejectReason.InsufficientFunds });
    expect(state.company.cbills).toBe(one + 1000);
    expect(state.queue.some((e) => e.task.kind === 'deliveryArrived')).toBe(false);
  });

  it('каркас другого тира меняет каркас, а не реактор (шаг 45)', () => {
    // Дефект, который это закрывает: проверка при постановке работы звала
    // реакторную подмену для ЛЮБОГО узла, а применение тира не трогало каркас
    // вовсе. Игрок платил за F2 наценку тира и получал F1.
    //
    // Ставим F1 на машину, собранную под F2: у F1 штрафа ячеек нет, значит по
    // ЯЧЕЙКАМ навеска заведомо помещается и проверка сборки не мешает мерить тир.
    //
    // А вот по ВЕСУ F1 беднее: тяжёлый каркас съедает навеску (шаг 47 научил
    // генератор тратить её до конца, и машина под F2 перестала помещаться в F1
    // на разницу масс каркаса). Броня — та статья, которой платят за такой
    // перенос, поэтому она и уменьшается ровно на разницу платформ: проверка
    // мерит смену ТИРА, а не запас веса у конкретного жребия.
    const record = freshRecord('M-1', 1, 'IS-H60-R2F2');
    const payloadDrop =
      makePlatform('is', 60, 2, 2).payloadMass - makePlatform('is', 60, 2, 1).payloadMass;
    const state = stateAt(capital, {
      mechs: [
        {
          ...record,
          assembly: {
            ...record.assembly,
            armorTons: record.assembly.armorTons - Math.ceil(payloadDrop * 4) / 4,
          },
        },
      ],
      cbills: 50_000_000,
    });
    const spec = recordNodeSpec(state.company.mechs[0]!, 'frame');
    expect(spec.tier).toBe(2);

    state.company = {
      ...state.company,
      warehouse: [frameLot('p-frame-1', spec.tonnage, 1, 'military')],
    };

    run(state, { kind: 'installPart', recordId: 'M-1', partId: 'p-frame-1' });
    run(state, { kind: 'advance', days: 30 });

    const after = state.company.mechs[0]!;
    expect(after.assembly.chassisCode).toBe('IS-H60-R2F1');
    expect(recordNodeSpec(after, 'frame').tier).toBe(1);
    // Реактор не тронут: подменяется ровно один тир.
    expect(recordNodeSpec(after, 'reactor').tier).toBe(2);
    // Имя следует за кодом (решение пользователя 2026-09-18): у каталога
    // разные тиры каркаса — разные канонические имена (Quickdraw ↔ Rifleman),
    // и смена каркаса обязана сменить подпись, а не оставить старую модель.
    expect(record.name).toBe(CHASSIS_CATALOG.get('IS-H60-R2F2')?.canonName);
    expect(after.name).toBe(CHASSIS_CATALOG.get('IS-H60-R2F1')?.canonName);
    expect(after.name).not.toBe(record.name);
    expect(recordQuality(after).frame).toBe('military');

    // Снятый F2 лёг на склад со своим тиром.
    expect(state.company.warehouse).toHaveLength(1);
    expect(state.company.warehouse[0]).toMatchObject({ node: 'frame', tier: 2, quality: 'standard' });
  });

  it('каркас, под который не влезает навеска, не встаёт', () => {
    // Обратная сторона того же правила: тир каркаса меняет число ячеек
    // (0 / −5 / −13 у 60 тонн), и загруженная машина в тесный каркас не
    // помещается. Отказ обязан прийти ДО списания денег.
    const state = stateAt(capital, {
      mechs: [freshRecord('M-1', 1, 'IS-H60-R2F1')],
      cbills: 50_000_000,
    });
    const spec = recordNodeSpec(state.company.mechs[0]!, 'frame');
    state.company = {
      ...state.company,
      warehouse: [frameLot('p-frame-3', spec.tonnage, 3, 'military')],
    };

    const before = state.company.cbills;
    expect(execute(state, { kind: 'installPart', recordId: 'M-1', partId: 'p-frame-3' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.BadRefit,
    });
    expect(state.company.cbills).toBe(before);
  });

  it('узел не с той машины не встаёт: тоннаж и тир обязаны совпасть', () => {
    const state = stateAt(capital, {
      mechs: [freshRecord('M-1'), freshRecord('M-2', 2, 'IS-H35-R3F1')],
      cbills: 50_000_000,
    });
    run(state, orderFor(state.company.mechs.find((x) => x.id === 'M-1')!, 'reactor', 'military'));
    run(state, { kind: 'advanceTo', day: marketProfile(WORLD, capital).orderDays });
    const partId = state.company.warehouse[0]!.id;

    expect(execute(state, { kind: 'installPart', recordId: 'M-2', partId })).toEqual({
      ok: false,
      reason: CampaignRejectReason.PartMismatch,
    });
  });
});

describe('разбор', () => {
  const capital = systemOfClass('capital');

  it('отдаёт ровно уцелевшее и не отдаёт выбитое', () => {
    const base = freshRecord('M-1');
    const armLoss = installedItems(base).filter((it) => it.zone === zoneFromId('leftArm')).length;
    expect(armLoss).toBeGreaterThan(0);

    const hurt: MechRecord = {
      ...withDestroyedZone(base, 'leftArm'),
      condition: {
        ...withDestroyedZone(base, 'leftArm').condition,
        // Первое орудие выбито критом, хотя его зона цела.
        destroyedMounts: base.condition.destroyedMounts.map((_, i) => i === 0),
      },
    };

    const whole = scrapSalvage(base);
    const damaged = scrapSalvage(hurt);
    expect(damaged.items.length).toBeLessThan(whole.items.length);
    expect(damaged.items.length).toBe(installedItems(hurt).filter((it) => it.intact).length);

    // Оба узла отдаются всегда (шаг 45).
    expect(damaged.nodes.map((n) => n.spec.node).sort()).toEqual(['frame', 'reactor']);
  });

  it('реактор переживает разрушенный торс: тир цел, класс на дне', () => {
    const base = freshRecord('M-1');
    const armoured: MechRecord = withQuality(withQuality(base, 'reactor', 'military'), 'frame', 'military');
    const gutted = withDestroyedZone(armoured, 'torso');

    const nodes = scrapSalvage(gutted).nodes;
    expect(nodes.map((n) => n.spec.node).sort()).toEqual(['frame', 'reactor']);

    // Тир — это железо, оно переживает машину; класс — качество сборки, его
    // разбивает попадание. Каркас так не роняется: за него наказывает своя
    // лестница (полевая замена конечности).
    const reactor = nodes.find((n) => n.spec.node === 'reactor')!;
    const frame = nodes.find((n) => n.spec.node === 'frame')!;
    expect(reactor.spec.tier).toBe(recordNodeSpec(armoured, 'reactor').tier);
    expect(reactor.quality).toBe('recovered');
    expect(reactor.wear).toBe(MARKET.scrap.wreckedNodeWear);
    expect(frame.quality).toBe('military');
  });

  it('сумма узлов разобранной машины меньше цены той же машины целиком', () => {
    const record = freshRecord('M-1');
    const nodes = scrapSalvage(record).nodes.reduce(
      (sum, n) => sum + nodeValue(n.spec, n.quality, n.wear),
      0,
    );
    expect(nodes).toBeLessThan(mechValue(record));
  });

  it('станка «разобрал и продал по частям» нет: целой машина стоит дороже разбора', () => {
    const record = freshRecord('M-1');
    const profile = marketProfile(WORLD, capital);
    const salvage = scrapSalvage(record);

    const partsIncome =
      salvage.nodes.reduce(
        (sum, n) => sum + sellPrice(nodeValue(n.spec, n.quality, n.wear), profile, WORLD, 0, n.spec.node),
        0,
      ) +
      salvage.items.reduce((sum, it) => sum + sellPrice(itemCost(it.itemId), profile, WORLD, 0, it.kind), 0);

    const whole = sellPrice(mechValue(record), profile, WORLD, 0, 'mech');
    expect(partsIncome - scrapPlan(record).cost).toBeLessThan(whole);
  });

  it('разбор занимает стапель, как любая другая работа', () => {
    const state = stateAt(capital, {
      mechs: [freshRecord('M-1'), freshRecord('M-2', 2)],
      cbills: 50_000_000,
      bays: 1,
    });
    run(state, { kind: 'scrapMech', recordId: 'M-1' });
    expect(execute(state, { kind: 'scrapMech', recordId: 'M-2' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.NoBay,
    });
  });

  it('разобранная машина кладёт на склад и узлы, и целые установки', () => {
    const record = freshRecord('M-1');
    const state = stateAt(capital, { mechs: [record], cbills: 50_000_000 });
    run(state, { kind: 'scrapMech', recordId: 'M-1' });
    run(state, { kind: 'advance', days: 30 });

    const nodes = state.company.warehouse.filter((w) => w.sort === 'node');
    const items = state.company.warehouse.filter((w) => w.sort === 'item');
    expect(nodes).toHaveLength(2);
    expect(items.length).toBe(installedItems(record).filter((it) => it.intact).length);
    // Брони и боезапаса на складе нет вовсе: расходник ремонта, не запчасть
    // (ловушка 5). Ни одной записи с боекомплектом, хотя в машине он был.
    expect(record.condition.ammo.some((a) => a !== null)).toBe(true);
    expect(items.map((w) => w.itemId).some((id) => id.startsWith('ammo_'))).toBe(false);
    expect(new Set(state.company.warehouse.map((w) => w.id)).size).toBe(state.company.warehouse.length);
  });
});

describe('перестановка парка (перетаскивание в списке)', () => {
  const capital = systemOfClass('capital');

  it('переставляет записи местами, ничего в них не меняя', () => {
    const state = stateAt(capital, {
      mechs: [freshRecord('M-1'), freshRecord('M-2', 2), freshRecord('M-3', 3)],
    });
    const before = state.company.mechs;
    run(state, { kind: 'reorderMechs', order: ['M-3', 'M-1', 'M-2'] });
    expect(state.company.mechs.map((m) => m.id)).toEqual(['M-3', 'M-1', 'M-2']);
    // Сами записи — те же объекты, просто в другом порядке массива.
    for (const m of state.company.mechs) {
      expect(m).toBe(before.find((b) => b.id === m.id));
    }
  });

  it('порядок переживает сохранение и загрузку', () => {
    // Хеш состояния сортирует машины по id и порядка не видит, поэтому общий тест
    // «снимок = состояние» потерю порядка не заметит — проверяем его отдельно.
    const state = stateAt(capital, {
      mechs: [freshRecord('M-1'), freshRecord('M-2', 2), freshRecord('M-3', 3)],
    });
    run(state, { kind: 'reorderMechs', order: ['M-3', 'M-1', 'M-2'] });
    const back = restore(parseSaveFile(JSON.parse(JSON.stringify(makeSaveFile(snapshot(state))))));
    expect(back.company.mechs.map((m) => m.id)).toEqual(['M-3', 'M-1', 'M-2']);
  });

  it('отказывает, если список не совпадает с парком — числом или составом', () => {
    const state = stateAt(capital, { mechs: [freshRecord('M-1'), freshRecord('M-2', 2)] });
    expect(execute(state, { kind: 'reorderMechs', order: ['M-1'] })).toEqual({
      ok: false,
      reason: CampaignRejectReason.InvalidOrder,
    });
    expect(execute(state, { kind: 'reorderMechs', order: ['M-1', 'M-9'] })).toEqual({
      ok: false,
      reason: CampaignRejectReason.InvalidOrder,
    });
  });
});

describe('продажа машины целиком', () => {
  const capital = systemOfClass('capital');

  it('на ходу продаётся, без торса или ноги или с повреждённой структурой — нет', () => {
    const state = stateAt(capital, { mechs: [freshRecord('M-1')], cbills: 0 });
    const events = run(state, { kind: 'sellMech', recordId: 'M-1' });
    const sold = events.find((e) => e.kind === 'mechSold')!;
    expect(sold.price).toBeGreaterThan(0);
    expect(state.company.mechs).toHaveLength(0);
    expect(state.company.cbills).toBe(sold.price);

    // Без торса — отказ
    const wreckTorso = stateAt(capital, { mechs: [withDestroyedZone(freshRecord('M-2'), 'torso')] });
    expect(execute(wreckTorso, { kind: 'sellMech', recordId: 'M-2' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.MechNotRunning,
    });

    // С оторванной ногой — отказ
    const wreckLeg = stateAt(capital, { mechs: [withDestroyedZone(freshRecord('M-3'), 'leftLeg')] });
    expect(execute(wreckLeg, { kind: 'sellMech', recordId: 'M-3' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.MechNotRunning,
    });

    // С оторванной рукой — отказ
    const wreckArm = stateAt(capital, { mechs: [withDestroyedZone(freshRecord('M-4'), 'rightArm')] });
    expect(execute(wreckArm, { kind: 'sellMech', recordId: 'M-4' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.MechNotRunning,
    });

    // С повреждённой структурой (не оторвана, но не доведена до максимума) — отказ
    const damagedStructureRecord: MechRecord = {
      ...freshRecord('M-5'),
      condition: {
        ...freshRecord('M-5').condition,
        zones: freshRecord('M-5').condition.zones.map((z, i) =>
          i === zoneFromId('leftLeg') ? { ...z, structure: Math.max(1, z.structure - 1) } : z,
        ),
      },
    };
    const wreckStructure = stateAt(capital, { mechs: [damagedStructureRecord] });
    expect(execute(wreckStructure, { kind: 'sellMech', recordId: 'M-5' })).toEqual({
      ok: false,
      reason: CampaignRejectReason.MechNotRunning,
    });

    // С повреждённой бронёй (броня на нуле, но вся структура и конечности целы) — продаётся!
    const strippedArmorRecord: MechRecord = {
      ...freshRecord('M-6'),
      condition: {
        ...freshRecord('M-6').condition,
        zones: freshRecord('M-6').condition.zones.map((z) => ({ ...z, armor: 0 })),
      },
    };
    const strippedState = stateAt(capital, { mechs: [strippedArmorRecord], cbills: 0 });
    const strippedEvents = run(strippedState, { kind: 'sellMech', recordId: 'M-6' });
    expect(strippedEvents.some((e) => e.kind === 'mechSold')).toBe(true);
    expect(strippedState.company.mechs).toHaveLength(0);
  });
});

describe('рынок по месту', () => {
  it('в пути лавки нет, а ремонт при этом идёт', () => {
    const from = systemOfClass('capital');
    const state = stateAt(from, { mechs: [freshRecord('M-1')], cbills: 50_000_000 });
    const neighbor = GALAXY.id(GALAXY.neighbors(GALAXY.require(from))[0] as number);

    run(state, { kind: 'travel', systemId: neighbor });
    for (const command of [
      { kind: 'buyPart', lotId: 'L0-0' },
      { kind: 'sellMech', recordId: 'M-1' },
      orderFor(state.company.mechs.find((x) => x.id === 'M-1')!, 'reactor', 'military'),
      { kind: 'upgradeClass', recordId: 'M-1', node: 'reactor', targetClass: 'military' },
    ] satisfies CampaignCommand[]) {
      expect(execute(state, command)).toEqual({ ok: false, reason: CampaignRejectReason.NotAtMarket });
    }

    // А разбор — работа своего цеха, он идёт и в прыжке (решение 11 §7 пайплайна).
    expect(execute(state, { kind: 'scrapMech', recordId: 'M-1' }).ok).toBe(true);
  });
});

describe('сохранение рынка', () => {
  it('склад двух сортов и незавершённый заказ переживают круговой прогон', () => {
    const capital = systemOfClass('capital');
    const state = stateAt(capital, { mechs: [freshRecord('M-1')], cbills: 50_000_000 });
    run(state, orderFor(state.company.mechs.find((x) => x.id === 'M-1')!, 'frame', 'military'));
    run(state, { kind: 'buyPart', lotId: marketStock(WORLD, capital, 0)[0]!.id });

    const back = restore(parseSaveFile(JSON.parse(JSON.stringify(makeSaveFile(snapshot(state))))));
    expect(hashCampaignState(back)).toBe(hashCampaignState(state));
    expect(back.company).toEqual(state.company);
    expect(back.deltas).toEqual(state.deltas);
  });
});

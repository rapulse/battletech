import { ECONOMY, NAMES } from '../../data/index.js';
import type { Pilot } from '../../model/Pilot.js';
import type { QualityClass } from '../../model/QualityClass.js';
import { recordChassisDef, type MechRecord, type WearNode } from '../mech/MechRecord.js';

/**
 * Рота (шаг 13): машины, пилоты, склад узлов, деньги, стапели.
 *
 * Часть `CampaignState`, поэтому меняется только командами (`commands/execute.ts`),
 * как и всё остальное состояние кампании — тем же правилом, что и `day`/`queue`.
 */

/**
 * Складская запись ДВУХ СОРТОВ, и типы не выдумываются (брифинг шага 15, п. 8).
 *
 * Класс исполнения и износ есть только у реактора и каркаса (`WEAR_NODES`) —
 * ровно у тех узлов, для которых `wiki/design/mechs/classification.md` §5 даёт
 * таблицы. У орудий, теплоотводов, ускорителей и оборудования класса нет
 * (решение 8 §7 пайплайна): они либо целые, либо выбитые, и на складе лежат
 * просто как установка своего вида.
 *
 * Брони и боезапаса на складе нет вовсе: они расходник работы ремонта, а не
 * запчасть (ловушка 5 шага 15).
 */

/**
 * Снятый, купленный или трофейный узел на складе.
 *
 * Запись с классом и износом, а не абстрактная «запчасть» (брифинг шага 13, п. 4):
 * узел, снятый со списанной машины, — это конкретный реактор конкретного качества
 * и с конкретным износом, а не число в инвентаре.
 */
export interface WarehousePart {
  readonly sort: 'node';
  readonly id: string;
  readonly node: WearNode;
  readonly quality: QualityClass;
  readonly wear: number;
  /** Тоннаж шасси-донора — с него была цена узла и на него он годится. */
  readonly sourceTonnage: number;
  /**
   * Тир узла: он входит в цену отдельным множителем (`mech/repair.ts::nodeCost`)
   * и вместе с тоннажем решает, на какую машину узел вообще встанет. Заведён
   * шагом 15: до рынка узел всегда приходил со своей же машины, и спрашивать
   * тир было не у кого.
   */
  readonly tier: number;
}

/**
 * Целая установка на складе: орудие, теплоотвод, прыжковый ускоритель,
 * пачка боезапаса, оборудование.
 *
 * Боезапас добавлен шагом 32. До него он был исключён из торговли вовсе
 * (`market/stock.ts` отфильтровывал категорию `ammo`), и расширенный
 * боекомплект — два-три бункера под прожорливое орудие — собрать было не из
 * чего.
 */
/**
 * Вид складской установки. Совпадает с разметкой сборки (`MechAssembly.items[].kind`).
 *
 * Список объявлен ЗДЕСЬ, а не рядом с ценами, намеренно: на него смотрят и
 * схема сохранения, и рынок, и мехлаб. Пока он был литералом в трёх местах,
 * добавленный на шаге 32 `ammo` доехал не везде — сохранение падало на схеме.
 */
export const WAREHOUSE_ITEM_KINDS = ['weapon', 'equipment', 'heatsink', 'jump_jet', 'ammo'] as const;
export type WarehouseItemKind = (typeof WAREHOUSE_ITEM_KINDS)[number];

export interface WarehouseItem {
  readonly sort: 'item';
  readonly id: string;
  /** Id из `weapons.json` или `equipment.json`. */
  readonly itemId: string;
  readonly kind: WarehouseItemKind;
}

export type WarehouseEntry = WarehousePart | WarehouseItem;

export function isWarehousePart(entry: WarehouseEntry): entry is WarehousePart {
  return entry.sort === 'node';
}

/**
 * Число гербов в наборе (`game/public/ui/company.jpg`, сетка 4×4).
 *
 * Лежит в ядре, а не в компоненте показа, ровно по одной причине: герб входит
 * в состояние, а значит и в схему сохранения, и проверять его границы обязано
 * то же место, что и всё остальное состояние. Сам НАБОР картинок — дело показа,
 * ядру он не виден и видеть его не должен.
 */
export const COMPANY_EMBLEM_COUNT = 16;

import type { DropshipDef, DropshipId } from '../../data/schema.js';

export interface Company {
  readonly cbills: number;
  readonly mechs: readonly MechRecord[];
  readonly pilots: readonly Pilot[];
  readonly warehouse: readonly WarehouseEntry[];
  /** Пропускная способность цеха: сколько работ может идти одновременно (решение §7.5 — старт на четырёх). */
  readonly bays: number;
  readonly bankrupt: boolean;
  /** День, когда баланс впервые ушёл в минус. `null`, пока рота платёжеспособна. */
  readonly bankruptDay: number | null;
  /**
   * Герб отряда — номер в наборе, 0..`COMPANY_EMBLEM_COUNT`−1 (шаг 17).
   *
   * Механики не касается совсем, как имя машины или позывной пилота, но лежит
   * в состоянии, а не рядом с ним: экран создания отряда даёт его ВЫБРАТЬ, и
   * выбор игрока обязан пережить экспорт сохранения в файл. Хранить его в
   * браузере отдельно от снимка значило бы, что перенесённая на другую машину
   * кампания приезжает с чужим гербом.
   */
  readonly emblem: number;
  /** Позывной командира отряда. Тоже описание: в правилах не участвует. */
  readonly commander: string;
  /** Класс десантного корабля роты (Leopard, Union, Overlord). */
  readonly dropship: DropshipId;
  /**
   * Открытые ячейки ангара корабля (шаг 75): сколько машин рота держит и
   * сколько выводит за раз. Корабль открывает `minMechs` сразу, остальные до
   * `mechCapacity` выкупаются лестницей цеха — как стапели.
   */
  readonly hangar: number;
  /**
   * Экстренный заём Гильдии наёмников (MRBC) — вторая страховка шага 35.
   *
   * `undefined` — долга нет. Гильдия даёт роте, потерявшей парк, на минимальную
   * машину, и берёт за это дорого: возвращать надо заметно больше взятого, и
   * взнос списывается с каждой ведомостью наравне с содержанием. Заём, который
   * рота не тянет, доводит её до разорения — и это правильно: страховка от
   * тупика не должна быть бесплатными деньгами.
   *
   * Поле необязательное: сохранения до шага 35 читаются как рота без долга.
   */
  readonly loan?: { readonly debt: number; readonly installment: number };
  /**
   * Долг по кредитам песочницы (шаг 74), в C-Bills. Не путать с `loan`: тот —
   * заём Гильдии со взносами и процентом, этот — беспроцентный, без сроков, и
   * бывает только в режиме `sandbox`. `undefined` — долга нет.
   */
  readonly sandboxDebt?: number;
}

export interface CompanyInit {
  readonly cbills?: number;
  readonly mechs?: readonly MechRecord[];
  readonly pilots?: readonly Pilot[];
  readonly warehouse?: readonly WarehouseEntry[];
  readonly bays?: number;
  readonly emblem?: number;
  readonly commander?: string;
  readonly dropship?: DropshipId;
  readonly hangar?: number;
}

export function makeCompany(init: CompanyInit = {}): Company {
  return {
    cbills: init.cbills ?? ECONOMY.company.startingCbills,
    mechs: init.mechs ?? [],
    pilots: init.pilots ?? [],
    warehouse: init.warehouse ?? [],
    bays: init.bays ?? ECONOMY.company.bays,
    bankrupt: false,
    bankruptDay: null,
    emblem: clampEmblem(init.emblem ?? 0),
    // Позывной командира, пока отряд не основан экраном, — из `names.json → defaults`.
    commander: init.commander?.trim() || NAMES.defaults.commander,
    dropship: init.dropship ?? 'leopard',
    hangar: init.hangar ?? ECONOMY.dropships[init.dropship ?? 'leopard'].minMechs,
  };
}

export function dropshipDefOf(company: Company): DropshipDef {
  return ECONOMY.dropships[company.dropship] ?? ECONOMY.dropships.leopard;
}

/**
 * Сколько машин рота держит и выводит за раз — ОТКРЫТЫЕ ячейки ангара (шаг 75),
 * а не потолок корабля. Потолок — `dropshipDefOf(company).mechCapacity`.
 */
export function mechCapacityOf(company: Company): number {
  return company.hangar;
}

/** Номер герба в границах набора. Из состояния наружу не выходит ничего вне 0..15. */
export function clampEmblem(index: number): number {
  const n = Math.trunc(index);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n % COMPANY_EMBLEM_COUNT;
}

export function findMech(company: Company, recordId: string): MechRecord {
  const record = company.mechs.find((m) => m.id === recordId);
  if (record === undefined) throw new RangeError(`В роте нет машины ${recordId}`);
  return record;
}

export function findPilot(company: Company, pilotId: string): Pilot {
  const pilot = company.pilots.find((p) => p.id === pilotId);
  if (pilot === undefined) throw new RangeError(`В роте нет пилота ${pilotId}`);
  return pilot;
}

export function withMech(company: Company, record: MechRecord): Company {
  return { ...company, mechs: company.mechs.map((m) => (m.id === record.id ? record : m)) };
}

export function withPilot(company: Company, pilot: Pilot): Company {
  return { ...company, pilots: company.pilots.map((p) => (p.id === pilot.id ? pilot : p)) };
}

/** Тоннаж парка: единственное, от чего зависит содержание машин (`payroll.ts`). */
export function fleetTonnage(company: Company): number {
  return company.mechs.reduce((sum, m) => sum + recordChassisDef(m).tons, 0);
}

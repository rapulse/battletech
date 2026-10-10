import { EQUIPMENT, REPAIR, type ChassisDef } from '../../data/index.js';
import { ZONE_COUNT, zoneFromId, type ZoneId } from '../../model/HitZone.js';
import {
  armorPointsPerTon,
  getChassisCatalogEntry,
  validateAssembly,
  type AssemblyIssueKind,
  type MechAssembly,
  type MountedItem,
  type ValidationReport,
} from '../../rules/construction.js';
import { itemCost } from '../market/pricing.js';
import { MARKET } from '../market/schema.js';
import {
  brokenSlots,
  isPristine,
  maxZones,
  recordChassisDef,
  recordQuality,
  type MechRecord,
} from '../mech/MechRecord.js';
import type { Company, WarehouseEntry, WarehouseItem } from './types.js';

/**
 * Переоснащение — мехлаб (шаг 19a).
 *
 * **Редактор поверх `validateAssembly`, а не вторые правила конструирования.**
 * Уравнение массы, потолок брони, слоты по зонам, обязательный боекомплект у
 * каждого орудия — всё это уже написано и покрыто тестами шагом 3 (`rules/
 * construction.ts`). Мехлаб не добавляет ни одного правила сборки: он считает
 * РАЗНИЦУ между тем, что на машине стоит, и тем, что игрок хочет собрать, и
 * называет цену этой разницы. Годность самой сборки решает валидатор, и его
 * ответ передаётся наружу как есть (`report`).
 *
 * **Железо берётся со склада и на склад же возвращается** (решение
 * пользователя 2026-09-03). Поставить можно только то, что рота купила на
 * рынке, сняла с трофея или переставила с другой своей машины; снятое ложится
 * на полку, а не пропадает. Ровно это делает мехлаб ВТОРЫМ стоком денег после
 * класса исполнения — тем самым, которого не хватало замеру шага 16 (`supply_
 * share` в половину дохода: боту некуда было деть кассу). Свободный редактор,
 * ставящий любое орудие из каталога, обесценил бы и рынок, и склад разом.
 *
 * **Броня и боезапас — расходник, а не складская запись.** То же правило, что у
 * разбора (ловушка 5 шага 15): доливаются по ценам `data/repair.json`, снятая
 * броня не возвращается ничем. Иначе в игре заводится «продать три очка брони».
 *
 * **Переоснащают только машину в паспортном состоянии** (`isRefittable`).
 * Правило, а не ограничение реализации: иначе переоснащение стало бы дешёвым
 * обходом ремонта — выбитые ячейки и просевшая броня «чинились» бы заменой
 * навески по цене работы цеха. Сначала ремонт, потом мехлаб.
 */

/**
 * Замечания плана переоснащения сверх валидатора сборки (шаг 52).
 *
 * `platformChanged` — сменились шасси, техбаза, тоннаж или класс исполнения: это
 * уже не переоснащение, а другая машина. `missingStock` — на складе нет
 * установки (`item`, `count`). `unchanged` — сборка та же. Словами их называет
 * экран, как и замечания `validateAssembly`.
 */
export const REFIT_ISSUE_KINDS = ['platformChanged', 'missingStock', 'unchanged'] as const;

export type RefitIssueKind = (typeof REFIT_ISSUE_KINDS)[number];

export interface RefitIssue {
  readonly kind: AssemblyIssueKind | RefitIssueKind;
  readonly params: Readonly<Record<string, string | number>>;
}

export interface RefitItemMove {
  readonly id: string;
  readonly kind: MountedItem['kind'];
  readonly zone: ZoneId;
}

/** Недостача склада: сколько таких установок плану не хватает. */
export interface RefitShortfall {
  readonly id: string;
  readonly count: number;
}

export interface RefitPlan {
  /** Годен ли план к постановке в цех: сборка проходит валидатор и железо на складе есть. */
  readonly valid: boolean;
  /** Что мешает — данными. Первым идёт то, что сказал `validateAssembly`. */
  readonly issues: readonly RefitIssue[];
  /** Отчёт валидатора о ЦЕЛЕВОЙ сборке: масса, слоты, тепло, броня. Его показывает экран. */
  readonly report: ValidationReport;
  readonly removed: readonly RefitItemMove[];
  readonly installed: readonly RefitItemMove[];
  /** Складские записи, которые план забирает: по одной на каждую поставленную установку. */
  readonly partIds: readonly string[];
  /** Установки, которые план кладёт на склад (снятое целое железо). */
  readonly returns: readonly RefitItemMove[];
  /**
   * Чего не хватает на складе, по видам и штукам.
   *
   * То же самое, что сказано словами в `issues`, но числами: экран обязан уметь
   * не только показать «на складе нет», но и предложить это докупить, а
   * разбирать русскую фразу обратно на артикул и количество — заведомо худший
   * способ узнать то, что здесь уже посчитано.
   */
  readonly missing: readonly RefitShortfall[];
  /**
   * Что мешает переоснастить ПОБИТУЮ машину — по позициям (`stripBlockers`).
   *
   * То же, что сказано словами в `issues`, но данными: экран гасит кнопку «Снять»
   * у конкретной строки и объясняет почему, не разбирая русскую фразу обратно.
   * У исправной машины список пуст.
   */
  readonly blockers: readonly RefitBlocker[];
  /** Долитая броня в очках. Снятая в цену не входит и не возвращается. */
  readonly armorAdded: number;
  /** Доснаряжённых бункеров боезапаса: новые пачки плюс недостача в старых, долями. */
  readonly ammoAdded: number;
  readonly cost: number;
  readonly days: number;
}

function round(n: number): number {
  return Math.round(n);
}

/** Ключ позиции навески: одна и та же установка в другой зоне — это перестановка, а не то же самое. */
function slotKey(item: MountedItem): string {
  return `${item.id}|${item.zone}`;
}

/**
 * Читаемое имя установки.
 *
 * Список замечаний плана уходит игроку на экран как есть, и `is_ml` в нём —
 * складской артикул, а не ответ на вопрос «чего не хватает». Словарь берётся
 * боевой (`core/log/dictionary.ts`): он старше интерфейсного, общий с журналом боя, и
 * второго словаря для оружия в проекте нет.
 */
function tally<T>(items: readonly T[], key: (t: T) => string): Map<string, number> {
  const out = new Map<string, number>();
  for (const it of items) out.set(key(it), (out.get(key(it)) ?? 0) + 1);
  return out;
}

/**
 * Годна ли машина к переоснащению.
 *
 * Паспортное состояние ЖЕЛЕЗА: зоны целы и доведены до спецификации, ячейки не
 * выбиты, установки не выбиты. См. докстринг модуля — это правило против обхода
 * ремонта, а не техническое удобство.
 *
 * **Расстрелянный боезапас годности НЕ отменяет**, и это правка по первому же
 * сквозному прогону шага 19a: бункеры пустеют в каждом бою, и требовать их
 * полными значило бы «после любого боя сперва оплати ремонт зоны, даже если в
 * машину не попали». Вместо запрета боезапас доснаряжается самим переоснащением
 * и считается в наряде по той же цене, что в ремонте (`REPAIR.cost.ammoBin`), —
 * то есть бесплатной дозаправки из этого не выходит.
 */
export function isRefittable(record: MechRecord): boolean {
  if (!isPristine(record)) return false;
  if (record.condition.destroyedSlots.some((_, zone) => brokenSlots(record, zone).length > 0)) return false;
  return !record.condition.destroyedMounts.some((dead) => dead);
}

/**
 * Годен ли ЧИСТЫЙ ДЕМОНТАЖ — снятие уцелевшего железа с побитой машины
 * (шаг 33, questions.md п. 15).
 *
 * Правило «переоснащают только паспортную машину» защищало от настоящего
 * эксплойта: переоснащением нельзя обходить наряд на ремонт, иначе выбитые
 * ячейки и просевшая броня «чинились» бы заменой навески по цене работы цеха.
 * Но обходить ремонт можно было только МОНТАЖОМ, а под запрет попало и снятие —
 * и получалась нелепость: боеспособный мех стоит без оружия, а рядом на стапеле
 * обездвиженная машина с целыми дорогими стволами, и переставить их нельзя,
 * пока не оплачена полная полевая замена ноги.
 *
 * Поэтому запрет сузился до того, ради чего вводился:
 *   - **монтаж** в любую зону побитой машины по-прежнему запрещён;
 *   - **снятие из ЦЕЛЫХ зон** побитой машины разрешено;
 *   - снимать из разрушенной зоны нечего: то, что там стояло, уже выбито.
 *
 * Броня и боезапас при чистом демонтаже не трогаются: цех ничего не доливает,
 * значит и не берёт за это денег.
 */
export function isStripOnly(record: MechRecord, target: MechAssembly): boolean {
  return stripBlockers(record, target).length === 0;
}

/** Почему из этой зоны побитой машины нельзя снять установку. `null` — можно. */
export type StripBlock = 'zoneDestroyed' | 'slotsDestroyed';

/**
 * Что мешает чистому демонтажу — по позициям.
 *
 * Правило то же, что описано у `isStripOnly`, и живёт ровно здесь: `isStripOnly`
 * — это «список пуст». Список нужен потому, что одного «нельзя» игроку мало
 * (плейтест 2026-09-15): мехлаб давал нажать «Снять» у ствола в разрушенной руке,
 * а в ответ говорил «сначала ремонт» машине с разрушенным торсом, которую
 * отремонтировать нельзя вовсе.
 *   - `install` — позиции, которой на машине не было: монтаж, в том числе перенос
 *     в другую зону;
 *   - `armor` — доливка брони: это работа ремонта;
 *   - `zoneDestroyed` / `slotsDestroyed` — снимаемая позиция стоит в разрушенной
 *     зоне или в зоне с выбитыми ячейками (почему это важно — у `isStripOnly`).
 */
/** Все виды причины — для теста полноты словаря: экран переводит каждую по ключу. */
export const REFIT_BLOCKER_KINDS = ['install', 'armor', 'zoneDestroyed', 'slotsDestroyed'] as const;

export type RefitBlocker =
  | { readonly kind: 'install'; readonly id: string; readonly zone: ZoneId }
  | { readonly kind: 'armor' }
  | { readonly kind: StripBlock; readonly id: string; readonly zone: ZoneId };

export function stripBlockAt(record: MechRecord, zone: ZoneId): StripBlock | null {
  const idx = zoneFromId(zone);
  if (record.condition.zones[idx]?.destroyed === true) return 'zoneDestroyed';
  if (brokenSlots(record, idx).length > 0) return 'slotsDestroyed';
  return null;
}

export function stripBlockers(record: MechRecord, target: MechAssembly): RefitBlocker[] {
  const out: RefitBlocker[] = [];
  if (target.armorTons > record.assembly.armorTons) out.push({ kind: 'armor' });

  const onMech = tally(record.assembly.items, slotKey);
  for (const item of target.items) {
    const key = slotKey(item);
    const left = onMech.get(key) ?? 0;
    if (left <= 0) {
      out.push({ kind: 'install', id: item.id, zone: item.zone });
      continue;
    }
    onMech.set(key, left - 1);
  }

  const inTarget = tally(target.items, slotKey);
  for (const item of record.assembly.items) {
    const key = slotKey(item);
    const kept = inTarget.get(key) ?? 0;
    if (kept > 0) {
      inTarget.set(key, kept - 1);
      continue;
    }
    const block = stripBlockAt(record, item.zone);
    if (block !== null) out.push({ kind: block, id: item.id, zone: item.zone });
  }
  return out;
}

/**
 * Сколько бункеров боезапаса машине не хватает до паспорта, долями.
 *
 * Зеркало `mech/repair.ts::missingAmmoBins`: то же правило и та же цена — цех
 * не различает, доснаряжает он бункер по наряду ремонта или по наряду
 * переоснащения.
 */
function missingAmmoBins(record: MechRecord): number {
  const def = recordChassisDef(record);
  let bins = 0;
  def.mounts.forEach((mount, m) => {
    if (mount.ammo === null || mount.ammo <= 0) return;
    const left = record.condition.ammo[m] ?? mount.ammo;
    bins += Math.max(0, mount.ammo - left) / mount.ammo;
  });
  return bins;
}

/**
 * Совпадает ли платформа. Класс исполнения меняется покупкой узла
 * (`UpgradeClass`/`InstallPart`), шасси — покупкой другой машины: и то и другое
 * уже есть, и дублировать их мехлабом значило бы завести третью цену на то же
 * действие.
 */
function samePlatform(record: MechRecord, target: MechAssembly): boolean {
  const a = record.assembly;
  const q = recordQuality(record);
  const t = target.quality ?? q;
  return (
    a.chassisCode === target.chassisCode &&
    a.techBase === target.techBase &&
    a.tonnage === target.tonnage &&
    q.reactor === t.reactor &&
    q.frame === t.frame
  );
}

/**
 * Сколько установок каждого вида лежит на складе.
 *
 * Считается по `itemId`: две одинаковые средние лазерные пушки взаимозаменяемы,
 * и требовать от игрока выбрать, какая именно из них встанет, было бы выбором
 * без разницы. Узлы (реактор, каркас) сюда не попадают вовсе — их ставит
 * `InstallPart`, у них свой класс и свой износ.
 */
function warehouseItems(warehouse: readonly WarehouseEntry[]): Map<string, WarehouseItem[]> {
  const out = new Map<string, WarehouseItem[]>();
  for (const entry of warehouse) {
    if (entry.sort !== 'item') continue;
    const list = out.get(entry.itemId);
    if (list === undefined) out.set(entry.itemId, [entry]);
    else list.push(entry);
  }
  return out;
}

/**
 * Работа цеха за переоснащение (пересмотрено шагом 33).
 *
 * Три правила, и каждое отвечает на свою претензию из `questions.md` п. 12:
 *
 *   1. **Снятие — плоский символический сбор.** Техники роты получают
 *      жалованье по ведомости; брать с игрока ещё и долю каталожной цены
 *      орудия за то, чтобы снять его и положить в трюм, — двойная оплата
 *      одного и того же труда.
 *   2. **Перестановка внутри машины — ОДНА наладка.** Орудие, сменившее руку и
 *      не уходившее на склад, тарифицировалось дважды: как снятие и как
 *      установка. Это перекомпоновка проводки, а не покупка с нуля.
 *   3. **Работа масштабируется тоннажем платформы.** Монтаж лазера на
 *      двадцатитонного разведчика и на стотонного штурмовика не может стоить
 *      одинаково.
 *
 * Сток денег из мехлаба при этом не исчезает, а переезжает с РАБОТЫ на ЖЕЛЕЗО
 * (решение пользователя 2026-09-07): платят за то, что покупают, а не за то,
 * что уже оплачено ведомостью.
 */
function labourCost(
  tonnage: number,
  removed: readonly RefitItemMove[],
  installed: readonly RefitItemMove[],
): number {
  const r = MARKET.refit;
  const scale = r.tonnageFactor.base + tonnage * r.tonnageFactor.perTon;

  const mount = (id: string): number =>
    Math.max(r.minimumLabour, itemCost(id) * r.labourShare) * scale;

  let sum = 0;

  // Всё поставленное идёт по тарифу монтажа — и новое со склада, и то, что
  // просто переехало в другую зону.
  for (const it of installed) if (it.kind !== 'ammo') sum += mount(it.id);

  // Снятое — только то, что ДЕЙСТВИТЕЛЬНО ушло на склад. Деталь, встречающаяся
  // и в снятых, и в поставленных, никуда не уходила: она сменила зону, и это
  // одна наладка, уже посчитанная выше. Гасится по видам, а не по позициям:
  // какая именно из двух одинаковых пушек переехала — разницы нет.
  const stillRemoved = tally(removed, (it) => it.id);
  for (const it of installed) {
    const left = stillRemoved.get(it.id) ?? 0;
    if (left > 0) stillRemoved.set(it.id, left - 1);
  }
  for (const [id, n] of stillRemoved) {
    if (EQUIPMENT.get(id)?.category === 'ammo') continue;
    sum += n * r.removalFee * scale;
  }

  return sum;
}

/**
 * План переоснащения: что снимается, что ставится, во сколько это обойдётся.
 *
 * Чистая функция: ни состояния, ни бросков. Её зовёт и команда (`RefitMech`), и
 * экран мехлаба — до всякой команды, чтобы показать цену и причину отказа.
 *
 * `reserved` — складские записи, уже занятые незавершёнными работами цеха.
 * Без этого списка две поставленные подряд работы разобрали бы один и тот же
 * ствол дважды.
 */
export function refitPlan(
  company: Company,
  record: MechRecord,
  target: MechAssembly,
  reserved: ReadonlySet<string> = new Set(),
): RefitPlan {
  const report = validateAssembly(target);
  const issues: RefitIssue[] = [...report.issues];

  if (!samePlatform(record, target)) {
    issues.push({ kind: 'platformChanged', params: {} });
  }
  // Чистый демонтаж разрешён и на побитой машине (шаг 33): снять навеску с
  // подбитого меха в поле — обычная работа технического экипажа, а не обход
  // ремонта.
  // Причины демонтажа — ДАННЫМИ, а не фразами: ядро отдаёт ключи, в слова их
  // превращает экран (`t('mechlab.blocker.*')`), иначе перевод игры означал бы
  // правку правил. В `valid` они входят отдельно от `issues`.
  const blockers = isRefittable(record) ? [] : stripBlockers(record, target);

  // --- что снимается и что ставится ------------------------------------------
  // Разница считается по ПОЗИЦИИ (установка плюс зона), а не по виду: одно и то
  // же орудие, переехавшее из левой руки в правую, — это работа цеха, и платить
  // за неё надо, хотя на складе от неё ничего не меняется.
  const unmatched = tally(target.items, slotKey);
  const removed: RefitItemMove[] = [];
  for (const item of record.assembly.items) {
    const key = slotKey(item);
    const left = unmatched.get(key) ?? 0;
    if (left > 0) unmatched.set(key, left - 1);
    else removed.push({ id: item.id, kind: item.kind, zone: item.zone });
  }

  const installed: RefitItemMove[] = [];
  for (const item of target.items) {
    const key = slotKey(item);
    const left = unmatched.get(key) ?? 0;
    if (left > 0) {
      installed.push({ id: item.id, kind: item.kind, zone: item.zone });
      unmatched.set(key, left - 1);
    }
  }

  const beforeById = tally(record.assembly.items, (it) => it.id);
  const afterById = tally(target.items, (it) => it.id);

  // --- чем это обеспечивается со склада ---------------------------------------
  // Перестановка внутри машины склада не касается: считается ЧИСТАЯ разница по
  // виду установки, а не позиции.
  //
  // Боезапас с шага 32 идёт в счёт наравне с остальным, и это прямое следствие
  // того, что лишние пачки наконец начали работать: пока вторая пачка не давала
  // ни одного выстрела, её можно было ставить бесплатно — она ничего не значила.
  // Теперь она удваивает боекомплект орудия, и бесплатной быть не может.
  // Заправка уже стоящих бункеров осталась расходником (`ammoAdded` ниже) — это
  // разные вещи: купить ящик и насыпать в него снарядов.
  const stock = warehouseItems(company.warehouse);
  const partIds: string[] = [];
  const returns: RefitItemMove[] = [];
  const missing: RefitShortfall[] = [];

  const ids = new Set([...beforeById.keys(), ...afterById.keys()]);
  for (const id of [...ids].sort()) {
    const net = (afterById.get(id) ?? 0) - (beforeById.get(id) ?? 0);
    if (net === 0) continue;
    // Образец берётся с той стороны, откуда позиция действительно приходит:
    // ставим — из чертежа, снимаем — с машины. Иначе снятая установка уехала бы
    // на склад с зоной, которой у неё не было.
    const sample =
      net > 0
        ? target.items.find((it) => it.id === id)
        : record.assembly.items.find((it) => it.id === id);
    if (sample === undefined) continue;

    if (net > 0) {
      const free = (stock.get(id) ?? []).filter((entry) => !reserved.has(entry.id));
      if (free.length < net) {
        missing.push({ id, count: net - free.length });
        issues.push({ kind: 'missingStock', params: { item: id, count: net - free.length } });
      }
      for (const entry of free.slice(0, net)) partIds.push(entry.id);
    } else {
      for (let n = 0; n < -net; n++) {
        returns.push({ id, kind: sample.kind, zone: sample.zone });
      }
    }
  }

  // --- расходники --------------------------------------------------------------
  const perTon = armorPointsPerTon(getChassisCatalogEntry(target.chassisCode).techBase);
  const armorAdded = Math.max(0, round(target.armorTons * perTon) - round(record.assembly.armorTons * perTon));
  // Боезапас: и новые пачки, и недостача в старых бункерах. Из цеха машина
  // выходит снаряжённой полностью, и оплачено это ровно по ценам ремонта.
  const ammoAdded =
    Math.round((installed.filter((it) => it.kind === 'ammo').length + missingAmmoBins(record)) * 100) / 100;

  const labour = labourCost(record.assembly.tonnage, removed, installed);

  const cost = round(
    labour + armorAdded * REPAIR.cost.armorPoint + ammoAdded * REPAIR.cost.ammoBin,
  );
  const days =
    Math.round(
      Math.max(
        MARKET.refit.minimumDays,
        (removed.length + installed.length) * MARKET.refit.daysPerItem +
          armorAdded / REPAIR.days.armorPointsPerDay,
      ) * 2,
    ) / 2;

  const armorChanged = target.armorTons !== record.assembly.armorTons;
  const touched = removed.length + installed.length > 0 || armorChanged;
  if (!touched) issues.push({ kind: 'unchanged', params: {} });

  return {
    valid: issues.length === 0 && blockers.length === 0,
    issues,
    blockers,
    report,
    removed,
    installed,
    partIds,
    returns,
    missing,
    armorAdded,
    ammoAdded,
    cost,
    days,
  };
}

/**
 * Перенести отметки «установка выбита» со старой машины на новый список
 * установок (шаг 33).
 *
 * Соответствие ищется по паре «орудие + зона» в порядке следования: две
 * одинаковые пушки в одной руке неразличимы, и какая из них была выбита — не
 * вопрос, на который есть ответ. Не нашлось соответствия — установка новая,
 * значит целая.
 */
function carryOverMounts(record: MechRecord, def: ChassisDef): boolean[] {
  const oldDef = recordChassisDef(record);
  const dead = new Map<string, number[]>();
  oldDef.mounts.forEach((m, i) => {
    const key = `${m.weapon}|${m.zone}`;
    const list = dead.get(key);
    const flag = record.condition.destroyedMounts[i] === true;
    if (list === undefined) dead.set(key, [flag ? 1 : 0]);
    else list.push(flag ? 1 : 0);
  });

  return def.mounts.map((m) => {
    const list = dead.get(`${m.weapon}|${m.zone}`);
    const flag = list?.shift();
    return flag === 1;
  });
}

/**
 * Машина после переоснащения.
 *
 * Состояние собирается ЗАНОВО по новой спецификации: зоны по паспорту, ячейки
 * целы, бункеры полны. Это не подарок игроку, а следствие правила «переоснащают
 * только паспортную машину»: она вошла в цех целой, а всё, что цех долил
 * (броню и боезапас), уже посчитано и оплачено планом.
 *
 * Класс, износ, пилот, имя и счётчик боёв переживают работу нетронутыми: цех
 * менял навеску, а не судьбу машины.
 */
export function applyRefit(record: MechRecord, target: MechAssembly): MechRecord {
  const next: MechRecord = { ...record, assembly: target };
  const def = recordChassisDef(next);

  // ЧИСТЫЙ ДЕМОНТАЖ состояние не лечит (шаг 33).
  //
  // Пересборка состояния по паспорту оправдана ровно тем, что переоснащают
  // паспортную машину: она вошла в цех целой, а долитое цехом уже посчитано
  // планом. Когда шаг 33 разрешил снимать железо с побитой машины, это правило
  // превратилось бы в дыру шире исходной: снял малый лазер — и вся броня разом
  // заварена бесплатно. Поэтому у демонтажа зоны и выбитые ячейки остаются
  // такими, какими были: цех снял навеску, а не починил машину.
  const strip = isStripOnly(record, target);
  const zones = strip ? record.condition.zones : maxZones(def);
  // Переносятся только настоящие поломки. Демонтаж трогает лишь зоны без них
  // (`stripBlockAt`), и в этих зонах раскладка может сдвинуться: старая метка
  // пустой ячейки, перенесённая как есть, переехала бы на соседнюю деталь.
  const destroyedSlots = strip
    ? record.condition.destroyedSlots.map((_, z) => [...brokenSlots(record, z)])
    : Array.from({ length: ZONE_COUNT }, (): number[] => []);

  return {
    ...next,
    condition: {
      ...(record.condition.patchedZones === undefined
        ? {}
        : { patchedZones: record.condition.patchedZones }),
      zones,
      destroyedSlots,
      // Бункеры снаряжаются полностью: это посчитано в `ammoAdded` и оплачено
      // по ценам ремонта, как и в обычном переоснащении.
      ammo: def.mounts.map((m) => m.ammo),
      // Выбитые установки при демонтаже НЕ воскресают. Массив пересобирается
      // по новому списку установок (после снятия он короче), но состояние
      // каждой уцелевшей переносится со старой машины: иначе снятие одного
      // малого лазера чинило бы все выбитые критами стволы разом.
      destroyedMounts: strip
        ? carryOverMounts(record, def)
        : def.mounts.map(() => false),
    },
  };
}

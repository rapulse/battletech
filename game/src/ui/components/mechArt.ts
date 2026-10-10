import { FACTIONS } from '../../core/campaign/galaxy/index.js';
import { CHASSIS_CATALOG, DEFAULT_PAINT, PAINTS } from '../../core/data/index.js';
import { weightClassOf, WEIGHT_CLASS_IDS, type WeightClassId } from '../../core/rules/construction.js';
import MECH_ART from './mechArt.json';

/**
 * Выбор портрета машины: рисунок по шасси, раскраска по фракции (шаги 48, 50).
 *
 * Вынесено из `MechSilhouette.svelte` отдельным модулем, чтобы проверяться
 * тестом: обещание «один код шасси — одна и та же картинка везде и всегда»
 * стоит того, чтобы стоять за ним тестом, а не глазами.
 *
 * Слой показа зависит от ядра, не наоборот: здесь читаются каталог шасси,
 * реестр раскрасок и фракции, и ничего из этого файла ядро не видит.
 *
 * Манифест `mechArt.json` пишет `tools/pack_mech_art.py`: какие рисунки в каком
 * классе и какие раскраски у каждого реально лежат на диске. Показ не гадает
 * о файлах — только читает манифест.
 */

/**
 * Разряды арта — весовые классы ядра, а не своя разбивка: с шага 49 класс в
 * проекте один на всё — на правила, подпись и выбор картинки.
 */
export const BAND_ORDER = WEIGHT_CLASS_IDS;
export type Band = WeightClassId;

export interface MechArtPick {
  /** Группа рисунков: техбаза и локомоция, `is_h`, `clan_n`. */
  readonly group: string;
  /** Постоянный id рисунка — каталог его файлов. */
  readonly base: string;
  /** Разряд, из которого картинка взята. Может отличаться от разряда машины. */
  readonly band: Band;
  /** Разряд машины по тоннажу — до всякого сведения к соседу. */
  readonly wanted: Band;
}

interface BaseEntry {
  readonly paints: readonly string[];
  readonly fallback: string;
}

const GROUPS = MECH_ART.groups as Record<string, Record<string, readonly string[] | undefined> | undefined>;
const BASES = MECH_ART.bases as Record<string, BaseEntry | undefined>;

/**
 * Разряд арта по тоннажу — весовой класс машины (`weightClassOf`).
 *
 * У паковщика своя копия границ в `mechArt.json`, потому что офлайн-скрипт на
 * Python не умеет импортировать TypeScript. Совпадение копий пришпилено тестом:
 * разойдись они, и картинка поехала бы относительно подписи.
 */
export function bandOfTonnage(tonnage: number): Band {
  return weightClassOf(tonnage);
}

/**
 * Хэш строки — FNV-1a.
 *
 * Нужна не стойкость, а устойчивость: один и тот же код шасси обязан давать
 * одну и ту же картинку в мехлабе, на рынке, в ангаре и после перезагрузки
 * страницы. Поэтому здесь хэш, а не жребий: `Math.random` в `game/src`
 * запрещён линтером, а запись выбора в сохранение не нужна вовсе.
 */
function hash(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Рисунок для кода шасси, или `null`, если его нет.
 *
 * `null` — нормальное состояние, а не поломка: арт добирается не одним заходом,
 * и группа может быть ещё пустой. Показ обязан в этом случае оставить рамку, а
 * не поехать вёрсткой.
 */
export function pickMechArt(chassisCode: string): MechArtPick | null {
  const entry = CHASSIS_CATALOG.get(chassisCode);
  if (entry === undefined) return null;

  const group = `${entry.techBase}_${entry.locomotion.toLowerCase()}`;
  const byBand = GROUPS[group];
  if (byBand === undefined) return null;
  const wanted = bandOfTonnage(entry.tonnage);

  // Пустой разряд сводится к БЛИЖАЙШЕМУ ПО ВЕСУ, у которого картинки есть:
  // сосед по шкале ближе к правде, чем пустая рамка. При равном расстоянии
  // берётся более лёгкий — порядок перебора это и задаёт.
  const at = BAND_ORDER.indexOf(wanted);
  const band = BAND_ORDER.map((b, i) => ({ b, d: Math.abs(i - at) }))
    .sort((x, y) => x.d - y.d)
    .find(({ b }) => (byBand[b]?.length ?? 0) > 0)?.b;
  if (band === undefined) return null;

  const pool = byBand[band]!;
  // ХЭШ СЕЕТСЯ ИМЕНЕМ КОРЗИНЫ. Так пополнение одной корзины пересдаёт картинки
  // только внутри неё: иначе добавление одного рисунка меняло бы портрет у
  // всего парка, а игрок узнаёт свои машины именно по портретам.
  //
  // Строка затравки — прежнее имя атласа шага 48 (`mechs_is_h`), а порядок
  // пула — прежний порядок ячеек: переезд на отдельные файлы не пересдал ни
  // одного портрета.
  const base = pool[hash(`mechs_${group}:${band}:${chassisCode}`) % pool.length]!;
  return { group, base, band, wanted };
}

/**
 * Раскраска фракции: своя (`byFaction`) → по виду фракции (`byKind`) → `default`.
 *
 * `undefined` — своя рота. Новый клан или дом со своей раскраской добавляется
 * строкой в `data/paints.json`, здесь ничего не меняется.
 */
export function paintOfFaction(factionId: string | undefined): string {
  if (factionId === undefined) return PAINTS.player;
  const own = PAINTS.byFaction[factionId];
  if (own !== undefined) return own;
  const kind = FACTIONS.get(factionId)?.kind;
  return (kind === undefined ? undefined : PAINTS.byKind[kind]) ?? DEFAULT_PAINT;
}

/** Раскраска машины: перекраска на стапеле, иначе цвета того, от кого она пришла. */
export function paintOfRecord(record: { readonly originFaction?: string; readonly paint?: string }): string {
  return record.paint ?? paintOfFaction(record.originFaction);
}

/** Раскраски, которые у рисунка реально есть. */
export function paintsOf(base: string): readonly string[] {
  return BASES[base]?.paints ?? [];
}

/**
 * Раскраска, файл которой лежит на диске: заказанная, если есть, иначе откат.
 *
 * Откат считает паковщик (обычно `default`), а не показ: у клановых рисунков нет
 * раскраски наёмников, и машина роты в клановом корпусе показывается в клановом
 * варианте по умолчанию, а не пустой рамкой.
 */
export function resolvePaint(base: string, paint: string): string | null {
  const entry = BASES[base];
  if (entry === undefined) return null;
  return entry.paints.includes(paint) ? paint : entry.fallback;
}

function artUrl(pick: MechArtPick, paint: string, size: 's' | 'l'): string {
  const file = resolvePaint(pick.base, paint) ?? DEFAULT_PAINT;
  const dir = MECH_ART.dir.replace(/^\//, '');
  return `${import.meta.env.BASE_URL}${dir}/${pick.base}/${file}-${size}.webp`;
}

/** Квадрат под списки — ангар, мехлаб, рынок, карточка боя. */
export function mechArtThumbUrl(pick: MechArtPick, paint: string): string {
  return artUrl(pick, paint, 's');
}

/**
 * Крупный показ по щелчку, без обрезки.
 *
 * Отдельный файл: браузер заберёт ровно тот, на который щёлкнули, а не все
 * крупные картинки класса.
 */
export function mechArtFullUrl(pick: MechArtPick, paint: string): string {
  return artUrl(pick, paint, 'l');
}

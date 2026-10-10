import { NAMES, PILOTS } from '../data/tables.js';
import type { Rng } from '../rng/index.js';

/**
 * Имя, пол и лицо пилота (найм 2026-09-10).
 *
 * ИМЯ СОБИРАЕТСЯ, А НЕ ЛЕЖИТ В ПАРЕ К ПОРТРЕТУ. Портретов шестнадцать на Сферу
 * и по четыре на клан, а пулов имён — сотни комбинаций: у наёмника Сферы личное
 * имя тянется отдельно от фамилии, и один и тот же человек на портрете каждый
 * раз зовётся иначе. Требование пользователя 2026-09-10, и оно же — единственный
 * способ не встретить в третьей роте того же «Пилота-2».
 *
 * У КЛАНОВЦА ФАМИЛИИ НЕТ, и это не упрощение, а правило мира: её место занимает
 * родовое имя, право на которое выигрывают в Испытании, и его носитель не пойдёт
 * в наёмники Сферы. Клановца зовут одним именем, а откуда он — говорит клан.
 *
 * ПОЛ ИДЁТ ОТ ЛИЦА, А НЕ НАОБОРОТ. Сначала выбирается принадлежность, потом из
 * её лиц (`pilots.json → faces`) тянется одно, и уже под его пол подбирается
 * имя. Обратный порядок сломался бы на Клане Волка: женских лиц у него не
 * нарисовано, и бросок «женщина» оставил бы пилота либо без портрета, либо с
 * чужим гербом за спиной.
 */

export type Gender = 'male' | 'female';

/** Кланы, чьи воины приходят в найм: ровно те, чьи лица нарисованы. */
export const CLAN_IDS: readonly string[] = ['wolf', 'jade_falcon', 'ghost_bear', 'smoke_jaguar'];

/** Великие Дома, чьи наёмники приходят в найм. Ключи те же, что в реестре фракций. */
export const HOUSE_IDS: readonly string[] = ['davion', 'steiner', 'marik', 'liao', 'kurita'];

export function isClan(affiliation: string): boolean {
  return CLAN_IDS.includes(affiliation);
}

export interface Persona {
  /** Полное имя: «Марк Хансен», «Эйдан Прайд». */
  readonly name: string;
  /** Короткое обращение — фамилия или кровное имя. Им зовёт боевой журнал. */
  readonly callsign: string;
  readonly gender: Gender;
  /** Номер лица в атласе своей принадлежности. Рисует его показ, ядро только хранит. */
  readonly face: number;
  readonly affiliation: string;
}

interface FaceSet {
  readonly male: readonly number[];
  readonly female: readonly number[];
}

function facesOf(affiliation: string): FaceSet {
  const key = isClan(affiliation) ? affiliation : 'sphere';
  const set = (PILOTS.faces as Record<string, FaceSet | undefined>)[key];
  if (set === undefined) throw new RangeError(`Нет лиц для принадлежности «${affiliation}»`);
  return set;
}

/**
 * Лицо и пол одним броском.
 *
 * Бросок ОДИН, по общему списку лиц, а не два («сначала пол, потом лицо»): у
 * Сферы четыре женских лица из шестнадцати, и раздельные броски дали бы половину
 * женщин в роте на четверти нарисованных лиц — то есть одни и те же четыре
 * портрета в каждом втором ряду списка.
 */
function pickFace(rng: Rng, affiliation: string): { face: number; gender: Gender } {
  const set = facesOf(affiliation);
  const all: { face: number; gender: Gender }[] = [
    ...set.male.map((face) => ({ face, gender: 'male' as const })),
    ...set.female.map((face) => ({ face, gender: 'female' as const })),
  ];
  const picked = all[rng.int(0, all.length - 1)];
  if (picked === undefined) throw new RangeError(`Пустой список лиц у «${affiliation}»`);
  return picked;
}

/**
 * Полный набор «кто это»: принадлежность на входе, имя с лицом на выходе.
 *
 * Порядок бросков зафиксирован (лицо → имя → фамилия) — то же правило, что у
 * основания роты: новый бросок дописывается в конец, иначе один и тот же сид
 * даёт другого человека при неизменных данных.
 */
export function makePersona(rng: Rng, affiliation: string): Persona {
  const { face, gender } = pickFace(rng, affiliation);

  // КЛАНОВЕЦ ЗОВЁТСЯ ОДНИМ ИМЕНЕМ (правка лора 2026-09-10). Фамилий у кланов
  // нет вовсе: их место занимает РОДОВОЕ ИМЯ, право на которое выигрывают в
  // Испытании, и носителей его — считанные проценты касты воинов. Такой воин не
  // окажется наёмником во Внутренней Сфере ни при каких обстоятельствах:
  // родовое имя привязывает его к клану крепче любого контракта. В найм
  // приходят те, у кого его нет. Кто он и откуда, договаривает принадлежность:
  // «Хорс · Клан Волка».
  if (isClan(affiliation)) {
    const given = NAMES.clan.given[gender];
    const first = given[rng.int(0, given.length - 1)] ?? NAMES.defaults.clanGiven;
    return { name: first, callsign: first, gender, face, affiliation };
  }

  const pool = NAMES.sphere[affiliation as keyof typeof NAMES.sphere];
  if (pool === undefined) throw new RangeError(`Нет пула имён для дома «${affiliation}»`);
  const given = pool[gender];
  const first = given[rng.int(0, given.length - 1)] ?? NAMES.defaults.sphereGiven;
  const family = pool.family[rng.int(0, pool.family.length - 1)] ?? '';
  return { name: `${first} ${family}`.trim(), callsign: family || first, gender, face, affiliation };
}

/**
 * Имя по шаблону из `names.json → defaults`: `fillName('Пилот-{n}', { n })`.
 *
 * Не `t()` интерфейса: это имя собственное, оно записывается в сохранение и не
 * переводится (шаг 52). Подстановка без значения остаётся в тексте как есть.
 */
export function fillName(template: string, params: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const value = params[key];
    return value === undefined ? whole : String(value);
  });
}

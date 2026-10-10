import { CONTRACTS } from '../contracts/schema.js';
import { REFERENCE_TONS } from '../contracts/threat.js';
import { RIVALS, type RegistryUnit } from './schema.js';

/**
 * Верх реестра MRBC (шаг 22): великие полки Внутренней Сферы.
 *
 * **Их в игре нет, и это решение, а не пропуск.** Волчьи Драгуны — пять полков,
 * пятьсот сорок машин и собственный десантный флот; такой отряд не помещается в
 * структуру `Company`, не конкурирует с ротой из четырёх машин за гарнизонный
 * контракт и не разоряется от одного проигранного боя. Симулировать его как
 * восьмого соперника значило бы соврать про масштаб дважды: и про него, и про
 * игрока.
 *
 * Поэтому они здесь ровно тем, чем являются в Сфере, — **потолком карьеры**,
 * который видно с первого дня. Игрок сравнивает себя с ними по той же линейке,
 * что и с соседями по сектору, и разрыв в таблице настоящий.
 *
 * **Сила считается, а не выдумывается.** Ни одного числа рейтинга в данных: в
 * `data/rivals.json` лежит канонический СОСТАВ (сколько машин, какого класса
 * исполнения, какого тоннажа, с какой выучкой), а рейтинг выводится той же
 * формулой, что и `companyRating` для роты игрока, — `threatByQuality × вес ×
 * выучка`, просуммированная по парку. Разница только в том, что парк задан
 * средним по отряду, а не перечислен машина за машиной: перечислять пятьсот
 * сорок машин ради одной строки таблицы незачем.
 *
 * Из этого прямо следует, что таблица НЕ ВРЁТ: подними цену качества в
 * `contracts.json` — и сила Драгун поедет вместе с силой вашей роты, потому что
 * считает их одна и та же таблица.
 */

/** Уровень навыка, вокруг которого держится обычный пилот. Зеркало `threat.ts`. */
const BASELINE_SKILL = 4;

export interface RegistryRow {
  readonly id: string;
  readonly name: string;
  readonly emblem: number;
  readonly cert: string;
  readonly base: string;
  /** Состав словами: «5 полков и собственный десантный флот». */
  readonly force: string;
  readonly mechs: number;
  /**
   * Отряд владеет своим миром, а не базируется на нём.
   *
   * Не украшение таблицы: у полка есть планета, у роты нет, и это половина
   * ответа на вопрос, до чего тут вообще тянуться.
   */
  readonly holdsWorld: boolean;
  /** Сила в тех же условных серийных средних машинах, что и рейтинг роты. */
  readonly rating: number;
}

/**
 * Сила отряда, парк которого задан средним, а не перечислен.
 *
 * То же произведение, что в `threat.ts::mechThreat` и `companyRating`:
 * класс исполнения × вес × выучка. Комплектность принята полной — у полка,
 * стоящего в реестре MRBC сертификатом A, брони хватает.
 */
type GreatForce = NonNullable<RegistryUnit['great']>;

export function forceRating(
  mechs: number,
  quality: GreatForce['quality'],
  tons: number,
  skill: number,
): number {
  const q = CONTRACTS.opfor.threatByQuality[quality];
  return Math.round(mechs * q * (tons / REFERENCE_TONS) * (skill / BASELINE_SKILL) * 10) / 10;
}

/** Великие полки реестра, от сильного к слабому. Порядок не зависит от порядка в файле. */
export const MRBC_REGISTRY: readonly RegistryRow[] = RIVALS.registry
  .filter((u): u is RegistryUnit & { great: GreatForce } => u.great !== undefined)
  .map((u) => ({
    id: u.id,
    name: u.name,
    emblem: u.emblem,
    cert: u.cert,
    base: u.base,
    force: u.great.force,
    mechs: u.great.mechs,
    holdsWorld: u.great.holdsWorld === true,
    rating: forceRating(u.great.mechs, u.great.quality, u.great.tons, u.great.skill),
  }))
  .sort((a, b) => b.rating - a.rating);

/** Отряды ротного масштаба: из них берутся имя, герб и ступень соперников сектора. */
export const SECTOR_UNITS: readonly RegistryUnit[] = RIVALS.registry.filter((u) => u.great === undefined);

export function registryUnit(id: string): RegistryUnit | undefined {
  return RIVALS.registry.find((u) => u.id === id);
}

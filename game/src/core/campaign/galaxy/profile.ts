import { BIOME_LIST } from '../../data/tables.js';
import { Rng } from '../../rng/index.js';
import { GALAXY, GALAXY_RULES, FACTIONS } from './catalog.js';
import { developmentOf, ownerOf, type GalaxyDeltas } from './delta.js';
import { isPlayerActor } from '../war/actors.js';
import { WAR } from '../war/schema.js';
import { ATMOSPHERES, type Atmosphere, type MarketClass, type WorldFocus } from './schema.js';

/**
 * Профиль системы — СЛОЙ ВЫВОДА (решение 4 §2 `часть2-pipeline.md`).
 *
 * Чистая функция от `(worldSeed, systemId)`. Результат **не хранится и не
 * кэшируется в состоянии** — ни в сохранении, ни в `CampaignState`.
 *
 * **Довод здесь стоял неверный, и он исправлен шагом 27a.** Написано было так:
 * «как только профиль окажется в сохранении, оно вырастет с числом посещённых
 * систем, и вся выводимость мира отменится сама собой». В шаге 14 это было
 * правдой — соперников тогда не существовало. Замер снимка на 1095-й день
 * говорит другое:
 *
 * | Раздел снимка | Байт | Доля |
 * |---|---|---|
 * | соперники (`rivals`) | 325 359 | **92.8 %** |
 * | дельты систем | 15 464 | 4.4 % |
 * | война | 8 379 | 2.4 % |
 * | **всего** | **350 626** | |
 *
 * Снимок весит 191 КБ уже в ПЕРВЫЙ день, при нуле дельт, и растёт немонотонно:
 * на 3650-й день дельт вдвое больше, чем на 1095-й, а файл на 10 КБ меньше.
 * Хранение полных профилей всех 2000 миров стоило бы 503 КБ — в полтора раза
 * больше, но зато НАВСЕГДА, без роста.
 *
 * **Правило остаётся, потому что оно даёт другое.**
 *
 * 1. **Чистота функции — это ТЕСТ.** `makeWarState` пересчитывает мир с нуля и
 *    сверяется с приращением; храни мы профиль — сверять было бы не с чем. Этот
 *    тест — главная приёмка шагов 21b, 23, 25 и 27.
 * 2. **Две тысячи миров, которых никто не писал руками.**
 * 3. **Воспроизводимость:** один сид — один мир, всегда.
 *
 * **И цена названа явно, потому что платит её каждый шаг.** Это ЗАМОРОЖЕННЫЙ
 * ПОРЯДОК БРОСКОВ: любое новое выводимое поле обязано дописываться в конец
 * навсегда, и арифметику профиля больше нельзя переставлять. Шаг 24 ушёл целиком
 * на то, чтобы перенести её вниз, не сдвинув ни одного обращения к `rng`.
 * Килобайты — не цена; вот это — цена.
 *
 * **Что выводимость НЕ запрещает.** Она говорит «по умолчанию ВЫВОДИ», а не «не
 * ХРАНИ». Слой дельт ничем не ограничен: у роты 5–40 миров, и хранить на них
 * что угодно стоит килобайты при снимке в 350 КБ. Отсюда память мира о роте
 * (`delta.ts::fought`, шаг 27a) — она полностью совместима с правилом, и не
 * было её ровно потому, что вопрос задавали неверно: «нельзя ли этого не
 * хранить» вместо «что этот мир должен помнить».
 *
 * Тот же принцип, что у деревьев на боевой карте: одна и та же система на
 * одном и том же сиде мира всегда одинакова, и хранить её незачем.
 *
 * **Развитие (шаг 23) этого не отменяет, и ровно поэтому оно устроено так, как
 * устроено.** Хранится не профиль, а ОТКЛОНЕНИЕ от него — одно целое число
 * ступеней в дельте системы (`delta.ts::development`), тем же приёмом, каким
 * уже живут владелец и разорение. Профиль остаётся выводимым, дельта остаётся
 * разрежённой: запись заводится, только когда мир от канона отличается. Ноль
 * ступеней даёт побайтово тот же профиль, что и до шага 23.
 */

export type { Atmosphere, MarketClass, WorldFocus };

/** Что видно без разведки: полоса, а не число. */
export type GarrisonBand = 'weak' | 'moderate' | 'strong';

export interface SystemProfile {
  /** Население, млн. */
  readonly populationM: number;
  /** Гражданская промышленность, 0–10. */
  readonly industryCivil: number;
  /** Военная промышленность, 0–10. */
  readonly industryMilitary: number;
  /**
   * Богатство недр, 0..1 (шаг 24): чистая функция биома.
   *
   * Заведено здесь, а не в фазе 2, по двум причинам: оно работает уже сейчас
   * (двигает военную промышленность) и оно же — вход в промышленную мощность
   * фазы 2. Поле ВЫВОДИМОЕ, в снимок не попадает, как и весь профиль.
   */
  readonly richness: number;
  /** Техуровень, 1–5. */
  readonly techLevel: number;
  /** Класс рынка — то, ради чего профиль вообще нужен шагу 15. */
  readonly marketClass: MarketClass;
  /** Сила гарнизона, 0–5. */
  readonly garrison: number;
  /** Один из шести БОЕВЫХ биомов: планеты, для которой не строится карта, быть не может. */
  readonly biome: string;
  readonly temperatureC: number;
  readonly gravityG: number;
  readonly atmosphere: Atmosphere;
  /** Класс космопорта A–F. */
  readonly spaceport: string;
  /**
   * ЕСТЕСТВЕННЫЙ фокус мира (шаг 25, часть A): чем планета занята, если её
   * никто не переделывал.
   *
   * Здесь, в выводимом профиле, а не в дельте, и это то же решение, что у всего
   * остального в этом файле: две тысячи записей «фокус такой-то» в снимке
   * отменили бы выводимость мира так же надёжно, как хранение профиля целиком.
   * В дельту пишется ОТКЛОНЕНИЕ — фокус, на который мир кто-то переделал
   * (`delta.ts::focusOf`).
   *
   * Порогов достаточно, броска нет: фокус обязан быть одинаков у одного и того
   * же мира на одном и том же сиде без всякой памяти.
   */
  readonly naturalFocus: WorldFocus;
}

const P = GALAXY_RULES.profile;

/**
 * Экономика биома (шаг 24): обитаемость, потолок населения, богатство недр.
 *
 * До шага 24 биом бросался только ради боевой карты — рельефа, температуры,
 * гравитации и атмосферы, — и в экономике не участвовал вовсе. Отсюда и брался
 * лунный мир с населением умеренного, и вулканический с самой высокой
 * гражданской промышленностью на карте: биом проектировался шагом 9a под бой, а
 * экономический слой писался шагом 14 отдельно и о биоме не спрашивал.
 *
 * Теперь спрашивает — и разделение появляется то самое, которого в игре не было:
 * миры, ГДЕ ЖИВУТ (temperate, jungle), и миры, ГДЕ ДОБЫВАЮТ (volcanic, lunar).
 */
interface BiomeEconomy {
  /** Сдвиг десятичного логарифма населения. */
  readonly habitability: number;
  /** Потолок населения, млн; `null` — потолка нет, работает общий `maxLog`. */
  readonly populationCapM: number | null;
  /** Богатство недр, 0..1. */
  readonly richness: number;
}

/**
 * Приведение — то же, что у `temperatureC` рядом: схема требует запись на каждый
 * биом из `biomes.json` (иначе загрузка встанет), но выводит из динамических
 * ключей тип с `undefined`, а биом здесь — строка. Проверку делает `biomeRecord`,
 * а не TypeScript.
 */
const BIOME_ECONOMY = P.biomeEconomy as unknown as Record<string, BiomeEconomy>;
const ECO = P.biomeEconomy as unknown as {
  readonly richnessBonus: number;
  readonly capitalCapLog: number;
  readonly factoryCapLog: number;
};

/**
 * Сид системы: имя мира, замешанное с сидом кампании.
 *
 * Замешивается ИМЕННО id, а не индекс в каталоге: индекс сдвинется при первом
 * же пополнении каталога, и весь мир на старом сохранении станет другим. id
 * системы — то, что переживает перегенерацию.
 */
function systemSeed(worldSeed: number, id: string): number {
  let h = (worldSeed >>> 0) ^ 0x9e3779b9;
  for (let i = 0; i < id.length; i++) {
    h = Math.imul(h ^ id.charCodeAt(i), 0x85ebca6b);
    h ^= h >>> 13;
  }
  h = Math.imul(h ^ (h >>> 16), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Взвешенный выбор по таблице `{ ключ: вес }`. Порядок ключей берётся из данных, а не из объекта. */
function weightedPick(rng: Rng, keys: readonly string[], weights: Readonly<Record<string, number>>): string {
  let total = 0;
  for (const k of keys) total += weights[k] ?? 0;
  let roll = rng.next() * total;
  for (const k of keys) {
    roll -= weights[k] ?? 0;
    if (roll <= 0) return k;
  }
  return keys[keys.length - 1] as string;
}

const BIOME_IDS: readonly string[] = BIOME_LIST.map((b) => b.id);

/** Класс космопорта из гражданской промышленности: пороговая лестница A..F; `up` — ступеней выше, не выше A. */
function spaceportOf(industryCivil: number, up = 0): string {
  const ports = P.spaceportByCivil;
  let k = 0;
  while (k < ports.length && industryCivil < (ports[k] as number)) k++;
  return String.fromCharCode(65 + Math.max(0, k - up));
}

/**
 * Прибавка постройки роты к профилю мира (космопорт, 2026-10-04): ступени развития сверх общего потолка и
 * классы порта сверх выведенного. Не бросок и не хранится — выводится из постройки, как и всё в профиле.
 */
export interface ProfileBoost {
  readonly developMax: number;
  readonly portSteps: number;
}

export const NO_PROFILE_BOOST: ProfileBoost = Object.freeze({ developMax: 0, portSteps: 0 });

/**
 * Прибавка космопорта роты мира `i`. Только пока мир у роты: у чужого владельца постройки спят
 * (`war/buildings.ts::activeBuildings`), и профиль обязан быть тем же, что даст полный пересчёт экономики.
 * Ручки читаются при вызове, а не при загрузке модуля, — их правит зонд замера.
 */
export function spaceportBoostOf(deltas: GalaxyDeltas, i: number): ProfileBoost {
  const B = WAR.buildings;
  if (B.spaceportDevelopMax === 0 && B.spaceportPortSteps === 0) return NO_PROFILE_BOOST;
  if (deltas[GALAXY.id(i)]?.buildings?.includes('spaceport') !== true) return NO_PROFILE_BOOST;
  if (!isPlayerActor(ownerOf(deltas, i))) return NO_PROFILE_BOOST;
  return { developMax: B.spaceportDevelopMax, portSteps: B.spaceportPortSteps };
}

/** Потолок развития мира: общий плюс прибавка космопорта роты. */
export function developmentMaxAt(deltas: GalaxyDeltas, system: string | number): number {
  const i = typeof system === 'number' ? system : GALAXY.require(system);
  return P.development.max + spaceportBoostOf(deltas, i).developMax;
}

/**
 * Естественный фокус мира (шаг 25, часть A): чем планета занята, если её никто
 * не переделывал.
 *
 * Пороги проверяются сверху вниз, и порядок здесь не косметика: столица важнее
 * пограничности, пограничность важнее заводов. Мир, не подошедший ни под один
 * порог, — житница; это не «плохой мир», а мир, которого никто не трогал.
 *
 * **Ни одного броска.** Иначе фокус пришлось бы хранить у всех двух тысяч
 * миров, и выводимость мира отменилась бы — та же ловушка, что у профиля.
 */
function naturalFocusOf(
  isCapital: boolean,
  populationM: number,
  garrison: number,
  border: number,
  industryMilitary: number,
  spaceport: string,
  richness: number,
): WorldFocus {
  const fc = P.focus;
  if (isCapital || populationM >= fc.metropolisPopulationM) return 'metropolis';
  if (garrison >= fc.fortressGarrison && border >= fc.fortressBorder) return 'fortress';
  // Арсеналу мало заводов: построенное надо вывезти, а мир класса F вывозит
  // продукцию шаттлами (тот же довод, что у `income.spaceportByClass`).
  if (industryMilitary >= fc.arsenalMilitary && (spaceport === 'A' || spaceport === 'B')) return 'arsenal';
  if (richness >= fc.miningRichness && populationM < fc.miningPopulationM) return 'mining';
  return 'granary';
}

/**
 * Профиль системы. `system` — id или индекс в каталоге.
 *
 * Порядок бросков зафиксирован: любой новый бросок дописывается В КОНЕЦ, иначе
 * весь мир на старых сохранениях станет другим при неизменных данных.
 */
export function systemProfile(
  worldSeed: number,
  system: string | number,
  development = 0,
  boost: ProfileBoost = NO_PROFILE_BOOST,
): SystemProfile {
  const i = typeof system === 'number' ? system : GALAXY.require(system);
  const rng = new Rng(systemSeed(worldSeed, GALAXY.id(i)));
  const dev = clamp(Math.round(development), P.development.min, P.development.max + boost.developMax);

  const isCapital = GALAXY.hasFlag(i, 'capital');
  const isIndustrial = GALAXY.hasFlag(i, 'industrial');
  const hasFactory = GALAXY.hasFlag(i, 'mechFactory');

  // Близость к столице своего владельца и к чужой границе — два числа, из
  // которых растёт весь остальной профиль. Первое кормит население и
  // промышленность, второе — военную промышленность и гарнизон.
  const capitalDist = GALAXY.distanceToCapital(i);
  const capitalPull = Number.isFinite(capitalDist) ? clamp(1 - capitalDist / P.capitalPullLy, 0, 1) : 0;
  const border = clamp(1 - (GALAXY.borderDistance[i] as number) / P.borderRangeLy, 0, 1);

  // --- БРОСКИ ------------------------------------------------------------------
  //
  // Шаг 24 упёрся в то, что биом бросается ПЯТЫМ — уже после населения, обеих
  // промышленностей и гарнизона, — а влиять обязан на них. Переставить броски
  // нельзя: весь мир на старых сохранениях станет другим при неизменных данных.
  // Поэтому переставлены не броски, а АРИФМЕТИКА. Здесь каждый бросок разброса
  // только запоминается, а весь вывод считается ниже, когда биом уже известен.
  //
  // Последовательность обращений к ГПСЧ от этого не меняется ни на шаг, и ровно
  // это стережёт эталон `test/fixtures/biome-rolls.json`: биом, температура,
  // гравитация и атмосфера у всех 2000 миров обязаны совпасть с тем, что было до
  // шага 24. Ниже этой черты к `rng` не обращается никто.

  const pop = P.population;
  let logPop = pop.minLog + Math.pow(rng.next(), pop.skew) * (pop.maxLog - pop.minLog);
  logPop += capitalPull * pop.capitalPullBonus;
  if (isCapital) logPop += pop.capitalFlagBonus;
  if (isIndustrial || hasFactory) logPop += pop.industrialFlagBonus;

  const ind = P.industry;
  const civilRoll = rng.int(-ind.civilSpread, ind.civilSpread);
  const militaryRoll = rng.int(-ind.militarySpread, ind.militarySpread);
  const garrisonRoll = rng.int(-P.garrison.spread, P.garrison.spread);

  const rawBiome = weightedPick(rng, BIOME_IDS, P.biomeWeights as Record<string, number>);
  const canonical = (P.canonicalBiomes as Record<string, string> | undefined)?.[GALAXY.id(i)];
  const biome = canonical ?? (isCapital && (rawBiome === 'lunar' || rawBiome === 'volcanic') ? 'temperate' : rawBiome);

  const temp = P.temperatureC as unknown as Record<string, [number, number]> & {
    starShiftC: Record<string, number>;
  };
  const range = temp[biome] as [number, number];
  const shift = temp.starShiftC[GALAXY.starOf(i)] as number;
  const temperatureC = clamp(Math.round(range[0] + rng.next() * (range[1] - range[0]) + shift), -60, 60);

  // Треугольное распределение: две трети миров держатся около одного g, а
  // крайности редки — иначе «низкая гравитация» перестанет быть особенностью.
  const g = P.gravityG;
  const gravityG =
    Math.round((g.peak + (rng.next() + rng.next() - 1) * Math.max(g.peak - g.min, g.max - g.peak)) * 100) / 100;

  let atmosphere = weightedPick(
    rng,
    ATMOSPHERES,
    (P.atmosphereByBiome as Record<string, Record<string, number>>)[biome] as Record<string, number>,
  ) as Atmosphere;
  if (isCapital && (atmosphere === 'vacuum' || atmosphere === 'toxic')) {
    atmosphere = 'standard';
  }

  // --- ВЫВОД (шаг 24: биом участвует; к ГПСЧ ниже не обращается никто) ---------

  const eco = BIOME_ECONOMY[biome] as BiomeEconomy;

  // Обитаемость двигает логарифм, потолок режет его сверху. Два числа, а не
  // одно, потому что они лечат разное: сдвиг делает типичный суровый мир мельче,
  // потолок убирает патологию «лавовый мир на два миллиарда жителей».
  //
  // Исключение для канона поднимает ПОТОЛОК, а не само население. Во Внутренней
  // Сфере хватает столиц и заводов на безжизненных камнях, и без исключения
  // канонический завод на вулканической планете срезало бы до пятнадцати
  // миллионов просто по броску биома. Поднимать при этом надо именно потолок:
  // флагу канона уже начислены `capitalFlagBonus` и `industrialFlagBonus`
  // выше, и мир с флагом и без того крупный — его губит только срез. Пол же
  // тянул бы вверх и те миры, которых шаг 24 не касается (умеренных с флагом,
  // где потолка нет вовсе), и биом перестал бы быть единственной причиной
  // изменений — замерено: медиана умеренного мира уезжала с ×2.0 до ×3.1.
  const capLog =
    eco.populationCapM === null ? pop.maxLog : Math.log10(eco.populationCapM);
  const cap = isCapital
    ? Math.max(capLog, ECO.capitalCapLog)
    : isIndustrial || hasFactory
      ? Math.max(capLog, ECO.factoryCapLog)
      : capLog;
  logPop = clamp(Math.min(logPop + eco.habitability, cap), pop.minLog, pop.maxLog);

  // Развитие множит население, а не двигает логарифм: `popShare` ниже обязан
  // остаться КАНОНИЧЕСКИМ, иначе одна ступень развития сдвигала бы гражданскую
  // промышленность дважды — сама по себе и через долю населения.
  const populationM =
    Math.round(Math.pow(10, logPop) * (1 + P.development.populationPerStep * dev) * 100) / 100;

  const popShare = (logPop - pop.minLog) / (pop.maxLog - pop.minLog);
  // Ступень развития — это ровно единица гражданской промышленности. Всё
  // остальное (военная, техуровень, гарнизон, космопорт, класс рынка) выводится
  // из неё теми же формулами, что и до шага 23: второго набора правил нет,
  // поэтому расходиться нечему, а порядок бросков ГПСЧ не сдвигается ни на шаг.
  const industryCivil = clamp(Math.round(popShare * 10 + civilRoll) + dev, 0, 10);

  // Военная промышленность БЕЗ сырьевой прибавки. Из неё — и только из неё —
  // считаются техуровень и гарнизон: рудник не крепость (решение пользователя
  // 2026-09-05). Пусти сырьё по всей цепочке — и шахтёрский мир получит заодно
  // сильный гарнизон и высокую технологию, содержание Сферы вырастет на 10 %, а
  // война потеряет повод рейдить: богатый рудой и слабо защищённый мир — это
  // заманчивая цель, и разделение здесь ровно для того, чтобы он таким остался.
  const militaryBase = clamp(
    Math.round(
      industryCivil * (1 - ind.militaryBorderWeight + ind.militaryBorderWeight * 2 * border) +
        militaryRoll +
        (hasFactory ? ind.mechFactoryBonus : 0),
    ),
    0,
    10,
  );
  const industryMilitary = clamp(militaryBase + Math.round(ECO.richnessBonus * eco.richness), 0, 10);

  // Клановая техбаза — часть профиля, а не отдельная механика: занятый кланом
  // мир держит технологию выше сферной, и это ровно то, что шаг 15 спрашивает
  // у системы, решая, бывает ли здесь клановое железо вообще.
  const ownerKind = FACTIONS.get(GALAXY.ownerId(i))?.kind;
  const techLevel = clamp(
    1 +
      Math.round(militaryBase / P.tech.perMilitary) +
      (hasFactory ? P.tech.mechFactoryBonus : 0) +
      (ownerKind === 'clan' ? P.tech.clanBonus : 0),
    1,
    5,
  );

  const garrison = clamp(
    Math.round(
      militaryBase * P.garrison.perMilitary +
        border * P.garrison.borderWeight +
        (isCapital ? P.garrison.capitalBonus : 0) +
        garrisonRoll,
    ),
    0,
    5,
  );


  const spaceport = spaceportOf(industryCivil, boost.portSteps);
  // Фокус — последним: он читает уже готовый профиль целиком.
  const naturalFocus = naturalFocusOf(
    isCapital,
    populationM,
    garrison,
    border,
    industryMilitary,
    spaceport,
    eco.richness,
  );

  return {
    populationM,
    industryCivil,
    industryMilitary,
    richness: eco.richness,
    techLevel,
    marketClass: marketClassOf(i, populationM, industryCivil, industryMilitary, isCapital),
    garrison,
    biome,
    temperatureC,
    gravityG: clamp(gravityG, g.min, g.max),
    atmosphere,
    spaceport,
    naturalFocus,
  };
}

/**
 * Профиль мира С УЧЁТОМ ТОГО, ЧЕМ ОН ОТЛИЧАЕТСЯ ОТ КАНОНА (шаг 23).
 *
 * Ровно `systemProfile`, которому подставлено развитие из разрежённой карты
 * дельт. Отдельная функция, а не третий аргумент у каждого зовущего: развитие
 * читают одиннадцать мест — доход, содержание, гарнизон, биржа, рынок, бой
 * фронта, — и одиннадцать раз написать `deltas[id]?.development ?? 0` значило бы
 * одиннадцать шансов забыть.
 *
 * Тем, у кого дельт под рукой нет (основание кампании, замер каталога),
 * по-прежнему открыт `systemProfile`: там мир канонический по определению.
 */
export function worldProfile(
  worldSeed: number,
  deltas: GalaxyDeltas,
  system: string | number,
): SystemProfile {
  const i = typeof system === 'number' ? system : GALAXY.require(system);
  return systemProfile(worldSeed, i, developmentOf(deltas, GALAXY.id(i)), spaceportBoostOf(deltas, i));
}

/**
 * Меняет ли следующая ступень развития в мире хоть что-то, кроме числа жителей.
 *
 * Ступень — это единица гражданской промышленности, а она упирается в 10: у
 * развитого мира ступень растит только население, которое правила не читают
 * (его показывает карточка системы). Проба державы 2026-09-27: Исэдера на 10/10
 * взяла 300 млн за ступень, не изменив ни дохода, ни мощности. Иногда ступень у
 * такого мира всё же сдвигает естественный фокус или класс рынка — поэтому
 * сравнивается весь профиль, а не одна промышленность.
 */
export function developmentStepMatters(worldSeed: number, deltas: GalaxyDeltas, system: string | number): boolean {
  const i = typeof system === 'number' ? system : GALAXY.require(system);
  const dev = developmentOf(deltas, GALAXY.id(i));
  const boost = spaceportBoostOf(deltas, i);
  const { populationM: _now, ...now } = systemProfile(worldSeed, i, dev, boost);
  const { populationM: _next, ...next } = systemProfile(worldSeed, i, dev + 1, boost);
  return (Object.keys(now) as (keyof typeof now)[]).some((k) => now[k] !== next[k]);
}

/**
 * Класс рынка (planets.md §4) — шесть ступеней, проверяются сверху вниз.
 *
 * Для владельца вне Домов и КомСтара класс всегда `periphery`, кроме столицы
 * периферийного государства: Таурус — не захолустье, но и не Таркад.
 */
function marketClassOf(
  i: number,
  populationM: number,
  civil: number,
  military: number,
  isCapital: boolean,
): MarketClass {
  // Занятые кланами миры и Аутрич Волчьих Драгун — это Внутренняя Сфера, а не
  // фронтир: заводы, население и рынок там никуда не делись от смены флага.
  // «Периферия» в таблице §4 — про глушь, а не про то, чей флаг над столицей.
  const kind = FACTIONS.get(GALAXY.ownerId(i))?.kind;
  const inSphere = kind === 'house' || kind === 'comstar' || kind === 'clan' || kind === 'mercenary';
  const m = P.market;

  if (!inSphere) return isCapital ? 'developed' : 'periphery';
  if (isCapital) return 'capital';
  if (GALAXY.hasFlag(i, 'mechFactory') || military >= m.industrialMilitary) return 'industrial';
  if (populationM >= m.developedPopulation) return 'developed';
  if (civil >= m.agrarianCivil && military <= m.agrarianMilitaryMax) return 'agrarian';
  if (populationM < m.backwaterPopulation) return 'backwater';
  return 'agrarian';
}

export function garrisonBand(garrison: number): GarrisonBand {
  if (garrison >= P.garrison.strongFrom) return 'strong';
  return garrison >= P.garrison.moderateFrom ? 'moderate' : 'weak';
}

/**
 * Что игрок знает о системе (решение пользователя 2026-09-01).
 *
 * Без разведки видно то, что известно всем: канон (имя, координаты, владелец,
 * звезда, флаги) плюс огрублённые оценки — класс рынка, биом и полоса
 * гарнизона. Разведка (`Survey`) добавляет точные числа: население, обе
 * промышленности, техуровень, размер гарнизона, климат, космопорт.
 *
 * Смысл разграничения: лететь можно осмысленно и без разведки, но идти на
 * контракт вслепую — нет. Ровно это же различение читает шаг 16 (точный класс
 * машин противника — за разведку, решение 4 §7).
 */
export interface SystemKnowledge {
  readonly id: string;
  readonly name: string;
  readonly owner: string;
  readonly surveyed: boolean;
  readonly marketClass: MarketClass;
  readonly biome: string;
  readonly garrisonBand: GarrisonBand;
  /** Точные числа — только после разведки. */
  readonly profile: SystemProfile | null;
}

export function systemKnowledge(
  worldSeed: number,
  system: string | number,
  surveyed: boolean,
  owner?: string,
  development = 0,
): SystemKnowledge {
  const i = typeof system === 'number' ? system : GALAXY.require(system);
  const profile = systemProfile(worldSeed, i, development);
  return {
    id: GALAXY.id(i),
    name: GALAXY.name(i),
    owner: owner ?? GALAXY.ownerId(i),
    surveyed,
    marketClass: profile.marketClass,
    biome: profile.biome,
    garrisonBand: garrisonBand(profile.garrison),
    profile: surveyed ? profile : null,
  };
}

/** Есть ли в системе верфь/космопорт для обслуживания и модернизации десантных судов. */
export function isShipyard(profile: SystemProfile): boolean {
  if (
    profile.marketClass === 'backwater' ||
    profile.marketClass === 'periphery' ||
    profile.marketClass === 'agrarian'
  ) {
    return false;
  }
  return (
    profile.spaceport === 'A' ||
    profile.marketClass === 'capital' ||
    (profile.marketClass === 'industrial' && (profile.spaceport === 'B' || profile.spaceport === 'C'))
  );
}

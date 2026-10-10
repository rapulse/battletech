import { CHASSIS_CATALOG_LIST, ECONOMY, NAMES } from '../../data/index.js';
import type { Pilot } from '../../model/Pilot.js';
import { Rng } from '../../rng/index.js';
import { generateAssembly, makePilot } from '../../rules/index.js';
import { makeRecord, type MechRecord } from '../mech/MechRecord.js';
import { rollRecruit } from './recruit.js';
import { stripOutfit, type OutfitSpec } from '../mech/outfit.js';
import type { CompanyInit } from './types.js';

/**
 * Основание роты (шаг 16a).
 *
 * До этого шага стартового состава не существовало в ядре вовсе: `CampaignState`
 * создавал роту ПУСТОЙ, а четыре машины с пилотами собирали замер и CLI — двумя
 * почти одинаковыми копиями, обе присваивавшие результат в состояние напрямую,
 * мимо команд. Третьей копией стал бы экран «создание отряда» (шаг 17), и вот
 * она уже писалась бы в Svelte-компоненте, то есть ровно там, где архитектура
 * это запрещает.
 *
 * Теперь копия одна и она здесь. Функция чистая: сид на входе, рота на выходе,
 * никакого состояния.
 *
 * **Рота начинается с трёх подержанных машин, а не с четырёх новых** (решение
 * пользователя 2026-09-02). Два лёгких корпуса и один средний, оба тира не выше
 * третьего, броня и навеска неполные (`mech/outfit.ts`). Это первое, что игра
 * сообщает о себе: наёмник начинает с того, что смог собрать, а парадное звено
 * — цель, а не стартовая позиция. Числа — `data/economy.json` → `founding`.
 */

export interface FoundingOptions {
  /** Сколько машин выводить. По умолчанию — как задано в `economy.json`. */
  readonly weightClasses?: readonly ('light' | 'medium' | 'heavy' | 'assault')[];
  /** Позывные пилотов. Короче списка машин — остальные получают номера. */
  readonly callsigns?: readonly string[];
  /** Полный комплект вместо подержанного: для эталонов и тестов. */
  readonly outfit?: OutfitSpec;
  /**
   * Потолки тира корпуса и выучки пилотов (шаг 22).
   *
   * Заведены ради соперников, и заведены именно ЗДЕСЬ, а не вторым основателем
   * рядом: отряд-соперник обязан собираться тем же кодом, что и рота игрока, —
   * иначе у проекта появится второй набор правил основания, и разойдутся они
   * молча (ловушка 1 плана шага 22). Отличие соперника от роты игрока — это
   * ЧИСЛА в `data/rivals.json`, а не другой порядок бросков.
   *
   * Не задано — берётся `economy.json` → `founding`, то есть ровно то, чем
   * основание было до шага 22.
   */
  readonly maxReactorTier?: number;
  readonly maxFrameTier?: number;
  readonly pilotTierMin?: number;
  readonly pilotTierMax?: number;
  /** Префикс id машин и пилотов. По умолчанию `M` — рота игрока. */
  readonly idPrefix?: string;
  /**
   * Позывной командира (настройка роты). Задан — командиром становится первый
   * пилот-мужчина звена (нет мужчин — первый пилот). Пустая строка — позывной
   * по умолчанию `names.json → defaults.commander`, как у `makeCompany`.
   * Не задан — пилоты остаются как выпали (соперники, эталоны, тесты).
   */
  readonly commander?: string;
}

export interface FoundedCompany {
  readonly mechs: readonly MechRecord[];
  readonly pilots: readonly Pilot[];
}

/**
 * Стартовая рота по сиду.
 *
 * Порядок бросков зафиксирован: любой новый бросок дописывается В КОНЕЦ цикла,
 * иначе один и тот же сид даст другую роту при неизменных данных — то же
 * правило, что у профиля системы и ассортимента лавки.
 */
export function foundCompany(seed: number, opts: FoundingOptions = {}): FoundedCompany {
  const f = ECONOMY.founding;
  const rng = new Rng(seed);
  const classes = opts.weightClasses ?? f.weightClasses;
  const outfit: OutfitSpec = opts.outfit ?? {
    armorShare: f.armorShare,
    missingItems: f.missingItems,
  };
  const maxReactorTier = opts.maxReactorTier ?? f.maxReactorTier;
  const maxFrameTier = opts.maxFrameTier ?? f.maxFrameTier;
  const pilotTierMin = opts.pilotTierMin ?? f.pilotTierMin;
  const pilotTierMax = opts.pilotTierMax ?? f.pilotTierMax;
  /** Заданный потолок выучки означает «собери по числам», иначе — «тяни, как найм». */
  const recruitRoll = opts.pilotTierMin === undefined && opts.pilotTierMax === undefined;
  const prefix = opts.idPrefix ?? 'M';

  const mechs: MechRecord[] = [];
  const pilots: Pilot[] = [];

  classes.forEach((weightClass, i) => {
    const pool = CHASSIS_CATALOG_LIST.filter(
      (c) =>
        c.techBase === 'is' &&
        c.weightClass === weightClass &&
        c.reactorTier <= maxReactorTier &&
        c.frameTier <= maxFrameTier,
    );
    if (pool.length === 0) {
      throw new RangeError(`В каталоге нет сферных шасси класса «${weightClass}» в пределах стартовых тиров`);
    }

    const entry = rng.pick(pool);
    // Роль чередуется, а не бросается: две одинаковые лёгкие машины в звене из
    // трёх — это не разнообразие, а половина отряда, умеющая одно и то же.
    const role = i % 2 === 0 ? 'brawler' : 'skirmisher';
    const full = generateAssembly({ chassisCode: entry.code, role }, rng);

    const id = `${prefix}-${i + 1}`;
    const pilotId = `${id}-пилот`; // i18n-ignore: id записан в сохранения, игрок его не видит
    mechs.push(makeRecord({ id, name: full.name, assembly: stripOutfit(full, outfit, rng), pilotId }));
    // СТАРТОВАЯ ТРОЙКА ТЯНЕТСЯ ТОЙ ЖЕ ТАБЛИЦЕЙ, ЧТО И НАЙМ (правка 2026-09-10,
    // решение пользователя): рота начинает с тех, кто пришёл, а не с трёх
    // одинаковых середняков. Значит и клановый воин может выпасть с первого
    // дня — редко, но может, и это событие кампании, о котором игрок расскажет.
    //
    // Соперники сюда не попадают: у них выучка задана числами
    // (`rivals.json` → `pilotTierMin/Max`), и заданный потолок означает старый
    // путь. Так у обоих один код основания и разные таблицы, а не два
    // основателя рядом (ловушка 1 плана шага 22).
    //
    // Имя не задаётся: его собирает генератор из пулов дома или клана.
    // «Пилот-1» в списке роты был заглушкой с шага 16a. Позывной остаётся
    // опцией — им пользуются эталоны и тесты, которым нужен ровный ростер.
    const named = opts.callsigns?.[i];
    const drawn = recruitRoll
      ? rollRecruit(rng, pilotId)
      : makePilot(rng, { id: pilotId, tier: rng.int(pilotTierMin, pilotTierMax) });
    pilots.push(named === undefined ? drawn : { ...drawn, callsign: named });
  });

  if (opts.commander !== undefined) {
    const idx = Math.max(0, pilots.findIndex((p) => p.gender === 'male'));
    const pilot = pilots[idx];
    if (pilot !== undefined) pilots[idx] = { ...pilot, ...commanderPilotName(opts.commander) };
  }

  return { mechs, pilots };
}

/**
 * Имя и позывной пилота-командира: «<звание> <позывной>».
 *
 * Звание — `names.json → defaults.commander`, а не словарь интерфейса: имя
 * пишется в сохранение и при смене языка не переводится, как все имена пилотов.
 * Позывной, уже начатый со звания («Командир Вулкан»), и позывной, равный
 * званию, второй раз его не получают — иначе вышло бы «Командир Командир».
 */
function commanderPilotName(raw: string): { name: string; callsign: string } {
  const rank = NAMES.defaults.commander;
  const typed = raw.trim() || rank;
  if (typed.toLowerCase() === rank.toLowerCase()) return { name: typed, callsign: typed };
  const prefix = `${rank.toLowerCase()} `;
  if (typed.toLowerCase().startsWith(prefix)) {
    return { name: typed, callsign: typed.slice(prefix.length).trim() };
  }
  return { name: `${rank} ${typed}`, callsign: typed };
}

/**
 * То же самое в виде `CompanyInit` — чтобы кампанию можно было основать одним
 * вызовом конструктора, не присваивая ничего в состояние после него.
 *
 * `execute` остаётся точкой изменения УЖЕ СУЩЕСТВУЮЩЕГО состояния, а не его
 * инициализации (то же правило, по которому первая зарплата ставится в
 * конструкторе `CampaignState`, а не командой).
 */
export function foundingInit(seed: number, opts: FoundingOptions = {}): CompanyInit {
  const founded = foundCompany(seed, opts);
  return { mechs: founded.mechs, pilots: founded.pilots };
}

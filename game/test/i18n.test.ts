import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { allKeys, cbills, days, formatDate, hasKey, setLanguages, t, tn } from '../src/ui/i18n/index.js';
import uiEn from '../src/ui/i18n/en.json';
import uiRu from '../src/ui/i18n/ru.json';
import coreEn from '../src/core/log/en.json';
import { tr } from '../src/core/log/index.js';
import { FACTION_LIST } from '../src/core/campaign/galaxy/index.js';
import { RIVALS } from '../src/core/campaign/rivals/schema.js';
import { dropshipName, factionFullName, factionShortName, mercBase, mercName } from '../src/ui/i18n/names.js';
import { QUALITY_CLASS_IDS } from '../src/core/model/QualityClass.js';
import { ZONE_IDS } from '../src/core/model/HitZone.js';
import { MISSION_TYPES, OPFOR_TYPES } from '../src/core/campaign/contracts/schema.js';
import { ATMOSPHERES, MARKET_CLASSES } from '../src/core/campaign/galaxy/schema.js';
import { ITEM_FAMILIES, WAREHOUSE_ITEM_KINDS } from '../src/core/campaign/market/pricing.js';
import { WEAR_NODES } from '../src/core/campaign/mech/MechRecord.js';
import { CampaignRejectReason } from '../src/core/campaign/commands/types.js';
import { EVENTS } from '../src/core/campaign/war/eventSchema.js';
import { BUILDING_KINDS, GOVERNOR_PRIORITIES, WAR } from '../src/core/campaign/war/schema.js';
import type { HireEnd } from '../src/core/campaign/rivals/hire.js';
import type { DemandOutcome } from '../src/core/campaign/war/demands.js';
import { FRONT_STANCES } from '../src/core/campaign/realm/sectors.js';
import { HOME_WORK_KINDS } from '../src/ui/campaign/homeWork.js';
import {
  WAR_CLASH_OUTCOMES,
  WAR_END_KINDS,
  WAR_LINE_KINDS,
  WAR_PACT_KINDS,
  WAR_POLICY_KEYS,
} from '../src/ui/state/logStorage.js';
import { BIOME_LIST, ECONOMY, EQUIPMENT, PILOTS, WEAPON_LIST } from '../src/core/data/tables.js';
import { ASSEMBLY_ISSUE_KINDS, ASSEMBLY_ROLES } from '../src/core/rules/construction.js';
import { REFIT_BLOCKER_KINDS, REFIT_ISSUE_KINDS } from '../src/core/campaign/company/refit.js';
import { dateOf } from '../src/core/campaign/clock.js';
import coreRu from '../src/core/log/ru.json';
import { RejectReason } from '../src/core/commands/types.js';
import { TERRAIN_IDS } from '../src/core/map/index.js';

/**
 * Полнота словаря интерфейса (ловушка 3 шага 17).
 *
 * Проверяется ровно то, чего глазами не поймать: ключи, которые строятся ИЗ
 * ДАННЫХ. `t(`zone.${id}`)`, `t(`quality.${cls}`)`, `t(`reject.${reason}`)` —
 * все они собираются в рантайме, поэтому новая зона брони, новый класс
 * исполнения или новая причина отказа доедут до экрана молча и покажутся
 * игроку сырым ключом. Здесь эти наборы сверяются с ядром, а не с самим
 * словарём.
 *
 * Статические ключи (`t('hangar.fleet')`) ловятся вторым тестом — обходом
 * разметки. Он грубый (регулярное выражение по исходникам), но ловит опечатку
 * в ключе, а это и есть весь класс ошибок, который здесь возможен.
 */

const UI = resolve(__dirname, '..', 'src', 'ui');

function collect(dir: string, out: string[]): void {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) collect(path, out);
    else if (entry.endsWith('.svelte') || entry.endsWith('.ts')) out.push(path);
  }
}

describe('словарь интерфейса', () => {
  it('покрывает все зоны брони ядра', () => {
    for (const id of ZONE_IDS) {
      expect(hasKey(`zone.${id}`), `нет zone.${id}`).toBe(true);
      expect(hasKey(`zone.${id}Short`), `нет zone.${id}Short`).toBe(true);
    }
  });

  it('покрывает все причины демонтажа побитой машины (2026-09-15)', () => {
    // Ядро отдаёт причины данными (`RefitBlocker`), мехлаб переводит их по ключу.
    for (const kind of REFIT_BLOCKER_KINDS) {
      expect(hasKey(`mechlab.blocker.${kind}`), `нет mechlab.blocker.${kind}`).toBe(true);
    }
    expect(hasKey('mechlab.blocker.wreckAdvice')).toBe(true);
    expect(hasKey('mechlab.blocker.damagedAdvice')).toBe(true);
  });

  it('покрывает все замечания валидатора сборки и плана переоснащения (шаг 52)', () => {
    for (const kind of [...ASSEMBLY_ISSUE_KINDS, ...REFIT_ISSUE_KINDS]) {
      expect(hasKey(`mechlab.issue.${kind}`), `нет mechlab.issue.${kind}`).toBe(true);
    }
  });

  it('покрывает все классы исполнения', () => {
    for (const cls of QUALITY_CLASS_IDS) {
      expect(hasKey(`quality.${cls}`), `нет quality.${cls}`).toBe(true);
    }
  });

  it('покрывает все типы миссий и отрядов', () => {
    for (const mission of MISSION_TYPES) {
      expect(hasKey(`mission.${mission}`), `нет mission.${mission}`).toBe(true);
    }
    for (const type of OPFOR_TYPES) {
      expect(hasKey(`opfor.${type}`), `нет opfor.${type}`).toBe(true);
    }
  });

  it('покрывает классы рынка и виды атмосферы (шаг 17b)', () => {
    // Оба набора приезжают из схемы галактики и печатаются на экране системы.
    for (const cls of MARKET_CLASSES) {
      expect(hasKey(`market.class.${cls}`), `нет market.class.${cls}`).toBe(true);
    }
    for (const air of ATMOSPHERES) {
      expect(hasKey(`starmap.air.${air}`), `нет starmap.air.${air}`).toBe(true);
    }
  });

  it('покрывает виды складских записей и полосы гарнизона (шаг 17b)', () => {
    for (const kind of WAREHOUSE_ITEM_KINDS) {
      expect(hasKey(`market.kind.${kind}`), `нет market.kind.${kind}`).toBe(true);
    }
    // Рода — второе деление того же ассортимента: по ним фильтруют и витрина, и склад мехлаба.
    expect(hasKey('market.family.all'), 'нет market.family.all').toBe(true);
    for (const fam of ITEM_FAMILIES) {
      expect(hasKey(`market.family.${fam}`), `нет market.family.${fam}`).toBe(true);
    }
    // Узлы попадают в тот же список видов: их продают тем же прилавком.
    for (const node of WEAR_NODES) {
      expect(hasKey(`market.kind.${node}`), `нет market.kind.${node}`).toBe(true);
      expect(hasKey(`hangar.${node}`), `нет hangar.${node}`).toBe(true);
    }
    for (const band of ['weak', 'moderate', 'strong']) {
      expect(hasKey(`starmap.band.${band}`), `нет starmap.band.${band}`).toBe(true);
    }
  });

  it('покрывает все единицы оборудования описаниями для подсказок', () => {
    for (const item of EQUIPMENT.values()) {
      if (item.category === 'ammo') continue;
      expect(hasKey(`hangar.mountEquipmentDesc.${item.id}`), `нет hangar.mountEquipmentDesc.${item.id}`).toBe(true);
    }
  });

  it('покрывает все состояния пилота и происхождения (шаг 17b)', () => {
    for (const status of ['active', 'out', 'ejected', 'lost']) {
      expect(hasKey(`barracks.status.${status}`), `нет barracks.status.${status}`).toBe(true);
    }
    // Происхождения приходят из `data/pilots.json` и растут вместе с данными.
    for (const origin of PILOTS.origins) {
      expect(hasKey(`origin.${origin.id}`), `нет origin.${origin.id}`).toBe(true);
    }
    // Пояснение «за что отвечает» в казармах — на каждый навык данных.
    for (const skill of PILOTS.skills) {
      expect(hasKey(`barracks.role.${skill.id}`), `нет barracks.role.${skill.id}`).toBe(true);
    }
  });

  it('покрывает все роли сборки полным и коротким названием', () => {
    // Короткое — для кнопок черновика в мехлабе, чтобы шесть ролей шли одной строкой.
    for (const role of ASSEMBLY_ROLES) {
      expect(hasKey(`role.${role}`), `нет role.${role}`).toBe(true);
      expect(hasKey(`roleShort.${role}`), `нет roleShort.${role}`).toBe(true);
    }
  });

  it('покрывает все биомы данных', () => {
    for (const biome of BIOME_LIST) {
      expect(hasKey(`biome.${biome.id}`), `нет biome.${biome.id}`).toBe(true);
    }
  });

  it('покрывает ВСЕ причины отказа команд кампании', () => {
    // Самый ценный пункт списка: причин больше сорока, они растут каждым шагом,
    // и непереведённая причина показывается игроку прямо в кнопке.
    for (const reason of Object.values(CampaignRejectReason)) {
      expect(hasKey(`reject.${reason}`), `нет reject.${reason}`).toBe(true);
    }
  });

  it('покрывает строки сводки войны: ярлык и текст каждого вида, исходы боя державы, фильтр (шаг 78)', () => {
    for (const kind of WAR_LINE_KINDS) {
      expect(hasKey(`war.kind.${kind}`), `нет war.kind.${kind}`).toBe(true);
      // Полковой подряд, бой державы, конец войны и договор пишутся своими ключами (`WarLogList.svelte`).
      // Событие мира (шаг 84) — заголовком `worldEvent.<id>.title`, проверка полноты ниже; политика (шаг 88) —
      // `war.policy.<кто>.<что>`, тоже ниже.
      if (kind !== 'commission' && kind !== 'clash' && kind !== 'warEnded' && kind !== 'pact' && kind !== 'event' && kind !== 'policy') {
        expect(hasKey(`war.${kind}`), `нет war.${kind}`).toBe(true);
      }
    }
    for (const pact of WAR_PACT_KINDS) expect(hasKey(`war.pact.${pact}`), `нет war.pact.${pact}`).toBe(true);
    for (const outcome of WAR_CLASH_OUTCOMES) {
      expect(hasKey(`war.clash.${outcome}`), `нет war.clash.${outcome}`).toBe(true);
    }
    for (const how of WAR_END_KINDS) expect(hasKey(`war.ended.${how}`), `нет war.ended.${how}`).toBe(true);
    for (const id of ['all', 'realm']) expect(hasKey(`war.filter.${id}`), `нет war.filter.${id}`).toBe(true);
    for (const k of WAR_POLICY_KEYS) expect(hasKey(`war.policy.${k}`), `нет war.policy.${k}`).toBe(true);
  });

  it('покрывает виды работы державы на бирже: заголовок и подсказку (шаги 85, 89, 90)', () => {
    for (const k of HOME_WORK_KINDS) {
      expect(hasKey(`contracts.${k}`), k).toBe(true);
      expect(hasKey(`contracts.${k}Hint`), k).toBe(true);
    }
  });

  it('покрывает приоритеты губернатора и стойки фронта (шаг 88)', () => {
    // Ключи собираются из списков ядра — сканер их не видит.
    for (const p of GOVERNOR_PRIORITIES) expect(hasKey(`realm.sector.priority.${p}`), `нет realm.sector.priority.${p}`).toBe(true);
    for (const st of FRONT_STANCES) expect(hasKey(`realm.stance.${st}`), `нет realm.stance.${st}`).toBe(true);
  });

  it('покрывает титулы державы, конец найма полка и ответы на требование (шаг 89)', () => {
    // Ключи собираются из данных и видов события — сканер их не видит.
    for (const title of WAR.realm.titles) expect(hasKey(`realm.title.name.${title.id}`), `нет realm.title.name.${title.id}`).toBe(true);
    const ends: readonly HireEnd[] = ['term', 'peace', 'lost'];
    for (const how of ends) expect(hasKey(`event.greatRegimentHireEnded.${how}`), `нет event.greatRegimentHireEnded.${how}`).toBe(true);
    const outcomes: readonly DemandOutcome[] = ['accepted', 'refused', 'lapsed'];
    for (const o of outcomes) expect(hasKey(`event.demandAnswered.${o}`), `нет event.demandAnswered.${o}`).toBe(true);
  });

  it('покрывает события мира: заголовок и текст карточки каждого события из данных (шаг 84)', () => {
    // Ключ собирается из id в `data/events.json` — сканер его не видит, новая веха без строки
    // в словаре показала бы игроку ключ вместо заголовка.
    for (const e of EVENTS.events) {
      expect(hasKey(`worldEvent.${e.id}.title`), `нет worldEvent.${e.id}.title`).toBe(true);
      expect(hasKey(`worldEvent.${e.id}.body`), `нет worldEvent.${e.id}.body`).toBe(true);
    }
  });

  it('покрывает постройки мира: название и эффект каждого вида (шаг 87)', () => {
    // Ключ собирается из вида постройки — сканер его не видит.
    for (const kind of BUILDING_KINDS) {
      expect(hasKey(`realm.world.building.${kind}`), `нет realm.world.building.${kind}`).toBe(true);
      expect(hasKey(`realm.world.buildingEffect.${kind}`), `нет realm.world.buildingEffect.${kind}`).toBe(true);
    }
  });

  it('покрывает отказы боевых команд, фазы, режимы хода и рельеф (шаг 52)', () => {
    for (const reason of Object.values(RejectReason)) {
      expect(hasKey(`battle.reject.${reason}`), `нет battle.reject.${reason}`).toBe(true);
    }
    for (const phase of ['initiative', 'movement', 'attack', 'heat']) {
      expect(hasKey(`battle.phase.${phase}`), `нет battle.phase.${phase}`).toBe(true);
    }
    for (const mode of ['walk', 'run', 'jump']) {
      expect(hasKey(`battle.mode.${mode}`), `нет battle.mode.${mode}`).toBe(true);
    }
    for (const id of TERRAIN_IDS) {
      expect(hasKey(`battle.terrain.${id}`), `нет battle.terrain.${id}`).toBe(true);
    }
  });

  it('в разметке нет ключей, которых нет в словаре', () => {
    const files: string[] = [];
    collect(UI, files);

    const missing: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      // Только литеральные ключи: шаблонные (`t(\`zone.${id}\`)`) проверены выше
      // по наборам ядра, и вытащить их отсюда всё равно нечем.
      for (const m of text.matchAll(/\bt\('([\w.]+)'/g)) {
        const key = m[1] as string;
        if (!hasKey(key)) missing.push(`${file}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('в журнале боя и отчёте нет ключей, которых нет в словаре ядра (шаг 52)', () => {
    // Ключи фраз в `core/log` — литералы, в том числе у причин и видов критов
    // (switch, а не шаблон): так их находит этот обход, и опечатка не доедет
    // до игрока сырым ключом.
    const dir = resolve(__dirname, '..', 'src', 'core', 'log');
    const missing: string[] = [];
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts'))) {
      const text = readFileSync(join(dir, file), 'utf8');
      for (const m of text.matchAll(/'((?:log|report)\.[\w.]+)'/g)) {
        const key = m[1] as string;
        if (!Object.hasOwn(coreRu, key)) missing.push(`${file}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
    for (const [key, value] of Object.entries(coreRu)) {
      expect(value.length, `пустое значение у ${key}`).toBeGreaterThan(0);
    }
  });

  it('отсутствующий ключ возвращается сам собой, а не пустотой', () => {
    // Дыра на экране читается ошибкой вёрстки, а ключ — ошибкой словаря.
    expect(t('нет.такого.ключа')).toBe('нет.такого.ключа');
  });

  it('подставляет значения и оставляет незаполненные плейсхолдеры видимыми', () => {
    expect(t('header.day', { day: 42 })).toBe('день 42');
    expect(t('header.day')).toContain('{day}');
  });

  it('в словаре нет пустых строк', () => {
    for (const key of allKeys()) {
      expect(t(key).length, `пустое значение у ${key}`).toBeGreaterThan(0);
    }
  });
});

/**
 * Названия фракций, отрядов реестра и кораблей (шаг 64б). Данные называют их по-русски, а на экране они
 * переводятся по id из словаря: новая запись в данных без строки в словаре показалась бы русской
 * посреди английского интерфейса, и заметить это глазами можно только на нужном экране.
 */
describe('названия из данных переводятся по id', () => {
  afterEach(() => setLanguages('ru', 'ru'));

  it('у каждой фракции есть полное и короткое название, и русские совпадают с данными', () => {
    for (const f of FACTION_LIST) {
      expect(hasKey(`faction.name.${f.id}`), `нет faction.name.${f.id}`).toBe(true);
      expect(hasKey(`faction.short.${f.id}`), `нет faction.short.${f.id}`).toBe(true);
      expect(factionFullName(f.id)).toBe(f.name);
      expect(factionShortName(f.id)).toBe(f.short);
    }
  });

  it('у каждого отряда реестра MRBC есть название и база, русские совпадают с данными', () => {
    for (const u of RIVALS.registry) {
      expect(hasKey(`merc.name.${u.id}`), `нет merc.name.${u.id}`).toBe(true);
      expect(hasKey(`merc.base.${u.id}`), `нет merc.base.${u.id}`).toBe(true);
      expect(mercName(u.id, '?')).toBe(u.name);
      expect(mercBase(u.id, '?')).toBe(u.base);
    }
  });

  it('у каждого класса десантного корабля есть название, русские совпадают с данными', () => {
    for (const [id, def] of Object.entries(ECONOMY.dropships)) {
      expect(hasKey(`dropship.${id}`), `нет dropship.${id}`).toBe(true);
      expect(dropshipName(id)).toBe(def.name);
    }
  });

  it('на английском те же названия по-английски, а не русские', () => {
    setLanguages('en', 'en');
    for (const f of FACTION_LIST) expect(factionFullName(f.id), f.id).not.toMatch(/[А-Яа-я]/);
    for (const u of RIVALS.registry) {
      expect(mercName(u.id, '?'), u.id).not.toMatch(/[А-Яа-я]/);
      expect(mercBase(u.id, '?'), u.id).not.toMatch(/[А-Яа-я]/);
    }
    expect(factionFullName('wolf')).toBe('Clan Wolf');
    expect(mercName('wolfs_dragoons', '?')).toBe("Wolf's Dragoons");
    expect(dropshipName('leopard')).toBe('Leopard');
  });

  it('вольный отряд и неизвестный id показываются как записано, а не ключом', () => {
    setLanguages('en', 'en');
    expect(mercName('', 'Вольный отряд №7')).toBe('Вольный отряд №7');
    expect(mercName('no_such_unit', 'Имя')).toBe('Имя');
    expect(factionFullName('no_such_faction', 'Имя')).toBe('Имя');
    expect(dropshipName('no_such_ship', 'Имя')).toBe('Имя');
  });
});

describe('язык как настройка (шаг 52)', () => {
  afterEach(() => setLanguages('ru', 'ru'));

  it('английские термины покрывают всё оружие и оборудование данных', () => {
    // Язык терминов переведён полностью, а не заготовкой: игрок выбирает его
    // отдельно, и дыра в нём показалась бы сырым ключом посреди русского экрана.
    for (const w of WEAPON_LIST) expect(Object.hasOwn(coreEn, w.key), `нет ${w.key}`).toBe(true);
    for (const e of EQUIPMENT.values()) expect(Object.hasOwn(coreEn, e.key), `нет ${e.key}`).toBe(true);
  });

  it('язык терминов переключается отдельно от языка интерфейса', () => {
    setLanguages('ru', 'en');
    expect(tr('weapon.is_ml')).toBe('Medium Laser');
    expect(tr('zone.head')).toBe('кокпит');
    expect(t('header.day', { day: 3 })).toBe('день 3');

    setLanguages('en', 'ru');
    expect(tr('weapon.is_ml')).toBe('средний лазер');
    // Английский интерфейс переведён (шаг 64): вместо ключа — английский текст.
    expect(t('hangar.title')).toBe('Hangar');
    expect(tr('zone.head')).toBe('cockpit');
    expect(t('settings.title')).toBe('Settings');
    expect(cbills(1_450_000)).toBe('1,450,000');
  });

  it('английские словари не заводят ключей, которых нет в русских', () => {
    const ruKeys = new Set(allKeys(uiRu));
    expect(allKeys(uiEn).filter((k) => !ruKeys.has(k))).toEqual([]);
    expect(Object.keys(coreEn).filter((k) => !Object.hasOwn(coreRu, k))).toEqual([]);
  });
});

describe('форматирование', () => {
  it('разбивает суммы неразрывными пробелами', () => {
    expect(cbills(1_450_000)).toBe('1 450 000');
    expect(cbills(750)).toBe('750');
    // Минус — типографский, а не дефис: сумма не должна читаться переносом.
    expect(cbills(-25_000)).toBe('−25 000');
  });

  it('склоняет дни по-русски', () => {
    expect(days(1)).toBe('1 день');
    expect(days(2)).toBe('2 дня');
    expect(days(5)).toBe('5 дней');
    expect(days(11)).toBe('11 дней');
    expect(days(21)).toBe('21 день');
    expect(days(0)).toBe('0 дней');
    expect(tn('count.worlds', 3)).toBe('3 мира');
  });

  it('у каждого набора форм есть запасная форма other', () => {
    // `tn` падает на `other`, когда у языка нет нужной категории; без неё на экране был бы ключ.
    const sets = new Set(allKeys().filter((k) => k.startsWith('count.')).map((k) => k.slice(0, k.lastIndexOf('.'))));
    for (const set of sets) expect(hasKey(`${set}.other`), `нет ${set}.other`).toBe(true);
  });

  it('пишет дату Внутренней Сферы словами, считая её ядром', () => {
    // День берётся у `clock.ts`, а не считается здесь: второй календарь однажды
    // разойдётся с первым.
    expect(formatDate(dateOf(0))).toBe('1 января 3053');
  });
});

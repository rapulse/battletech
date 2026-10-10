import * as fs from 'node:fs';
import * as path from 'node:path';
import { CONSTRUCTION } from '../game/src/core/data/tables.js';
import {
  makePlatform,
  frameTiersFor,
  LOCOMOTIONS,
  REACTOR_TIER_COUNT,
  type TechBase,
} from '../game/src/core/rules/construction.js';

/**
 * Офлайн-генератор каталога шасси (CLAUDE.md: tools/ — только офлайн-тулинг).
 *
 * Уравнение массы НЕ дублируется здесь: тиры, доли и слоты берутся из
 * `game/data/construction.json` через ту же функцию `makePlatform`, что работает
 * в бою. Раньше тул держал свои копии таблиц, и они успели разойтись с данными —
 * ровно та ошибка, ради которой источник истины сделан единственным.
 *
 * Запуск: cd game && npx vite-node ../tools/generate_chassis_catalog.ts
 */

// Коды пересчитаны под трёхступенчатую шкалу каркаса (шаг 7): прежние F1 и F2
// сошлись в F1, F3 стал F2, F4 и F5 сошлись в F3. Пересчёт по массе каркаса, а
// не по номеру: тир — это доля тоннажа, а не порядковый номер строки.
//
// ЛОКОМОЦИЯ РАЗВЕДЕНА 2026-09-10. До этого все 33 имени стояли на кодах `H`,
// потому что негуманоидных платформ не существовало вовсе. Теперь 13 имён,
// которые в каноне ходят на обратном суставе, переехали на коды `N`; источник
// разметки — `_tmp/mechs_reference.md`, где локомоция подписана у каждого меха.
//
// Четыре сферных негуманоида стояли на F1, а у `N` его нет (только F2 и F3),
// поэтому они сдвинуты на F2: Locust, Catapult, Marauder и King Crab стали
// легче каркасом (8 % массы вместо 12 %) и теснее на пять ячеек. Это
// осознанная плата за силуэт, и precedent тот же, что абзацем выше: канон уже
// переразмечали целиком, когда каркасов стало три. Клановским восьми сдвиг не
// понадобился — они и так все на F3.
const BASE_CHASSIS_NAMES: Record<string, string> = {
  // === Внутренняя Сфера: Гуманоиды (51) ===
  'IS-H20-F1': 'Wasp',
  'IS-H20-F2': 'Stinger',
  'IS-H20-F3': 'Thorn',
  'IS-H25-F1': 'Commando',
  'IS-H25-F2': 'Javelin',
  'IS-H25-F3': 'Mongoose',
  'IS-H30-F1': 'UrbanMech',
  'IS-H30-F2': 'Valkyrie',
  'IS-H30-F3': 'Spider',
  'IS-H35-F1': 'Firestarter',
  'IS-H35-F2': 'Panther',
  'IS-H35-F3': 'Wolfhound',
  'IS-H40-F1': 'Clint',
  'IS-H40-F2': 'Whitworth',
  'IS-H40-F3': 'Assassin',
  'IS-H45-F1': 'Phoenix Hawk',
  'IS-H45-F2': 'Vindicator',
  'IS-H45-F3': 'Hatchetman',
  'IS-H50-F1': 'Hunchback',
  'IS-H50-F2': 'Centurion',
  'IS-H50-F3': 'Trebuchet',
  'IS-H55-F1': 'Shadow Hawk',
  'IS-H55-F2': 'Wolverine',
  'IS-H55-F3': 'Griffin',
  'IS-H60-F1': 'Rifleman',
  'IS-H60-F2': 'Quickdraw',
  'IS-H60-F3': 'Ostroc',
  'IS-H65-F1': 'Thunderbolt',
  'IS-H65-F2': 'JagerMech',
  'IS-H65-F3': 'Crusader',
  'IS-H70-F1': 'Warhammer',
  'IS-H70-F2': 'Archer',
  'IS-H70-F3': 'Grasshopper',
  'IS-H75-F1': 'Flashman',
  'IS-H75-F2': 'Orion',
  'IS-H75-F3': 'Black Knight',
  'IS-H80-F1': 'Awesome',
  'IS-H80-F2': 'Victor',
  'IS-H80-F3': 'Zeus',
  'IS-H85-F1': 'BattleMaster',
  'IS-H85-F2': 'Crockett',
  'IS-H85-F3': 'Shogun',
  'IS-H90-F1': 'Highlander',
  'IS-H90-F2': 'Cyclops',
  'IS-H90-F3': 'Mauler',
  'IS-H95-F1': 'Banshee',
  'IS-H95-F2': 'Sagittaire',
  'IS-H95-F3': 'Albatross',
  'IS-H100-F1': 'Atlas',
  'IS-H100-F2': 'Devastator',
  'IS-H100-F3': 'Pillager',

  // === Внутренняя Сфера: Негуманоиды (34) ===
  'IS-N20-F2': 'Locust',
  'IS-N20-F3': 'Flea',
  'IS-N25-F2': 'Raptor',
  'IS-N25-F3': 'Tarantula',
  'IS-N30-F2': 'Hussar',
  'IS-N30-F3': 'Osiris',
  'IS-N35-F2': 'Jenner',
  'IS-N35-F3': 'Raven',
  'IS-N40-F2': 'Cicada',
  'IS-N40-F3': 'Chimera',
  'IS-N45-F2': 'Hollander II',
  'IS-N45-F3': 'Scarab',
  'IS-N50-F2': 'Uziel',
  'IS-N50-F3': 'Legionnaire',
  'IS-N55-F2': 'Bushwacker',
  'IS-N55-F3': 'Scorpion',
  'IS-N60-F2': 'Champion',
  'IS-N60-F3': 'Yeoman',
  'IS-N65-F2': 'Catapult',
  'IS-N65-F3': 'Bombardier',
  'IS-N70-F2': 'Avatar',
  'IS-N70-F3': 'Barghest',
  'IS-N75-F2': 'Marauder',
  'IS-N75-F3': 'Rakshasa',
  'IS-N80-F2': 'Goliath',
  'IS-N80-F3': 'O-Bakemono',
  'IS-N85-F2': 'Stalker',
  'IS-N85-F3': 'Longbow',
  'IS-N90-F2': 'Gorgon',
  'IS-N90-F3': 'Mastodon',
  'IS-N95-F2': 'Sirocco',
  'IS-N95-F3': 'Tarrasque',
  'IS-N100-F2': 'King Crab',
  'IS-N100-F3': 'Annihilator',

  // === Кланы: Гуманоиды (51) ===
  'CL-H20-F1': 'Piranha',
  'CL-H20-F2': 'Baboon (Howler)',
  'CL-H20-F3': 'Fire Moth (Dasher)',
  'CL-H25-F1': 'Commando IIC',
  'CL-H25-F2': 'Mongoose IIC',
  'CL-H25-F3': 'Icestorm',
  'CL-H30-F1': 'UrbanMech IIC',
  'CL-H30-F2': 'Incubus (Vixen)',
  'CL-H30-F3': 'Spider IIC',
  'CL-H35-F1': 'Horned Owl (Peregrine)',
  'CL-H35-F2': 'Ocelot',
  'CL-H35-F3': 'Wolfhound IIC (Grinner)',
  'CL-H40-F1': 'Clint IIC',
  'CL-H40-F2': 'Phantom',
  'CL-H40-F3': 'Viper (Dragonfly)',
  'CL-H45-F1': 'Wyvern IIC',
  'CL-H45-F2': 'Shadow Hawk IIC',
  'CL-H45-F3': 'Ice Ferret (Fenris)',
  'CL-H50-F1': 'Hunchback IIC',
  'CL-H50-F2': 'Huntsman (Nobori-nin)',
  'CL-H50-F3': 'Ursus',
  'CL-H55-F1': 'Vapor Eagle (Goshawk)',
  'CL-H55-F2': 'Stooping Hawk',
  'CL-H55-F3': 'Septicemia (Pariah)',
  'CL-H60-F1': 'Glass Spider (Galahad)',
  'CL-H60-F2': 'Crossbow',
  'CL-H60-F3': 'Thresher',
  'CL-H65-F1': 'Rifleman IIC',
  'CL-H65-F2': 'Ha Otoko',
  'CL-H65-F3': 'Hellbringer (Loki)',
  'CL-H70-F1': 'Guillotine IIC',
  'CL-H70-F2': 'Nova Cat',
  'CL-H70-F3': 'Summoner (Thor)',
  'CL-H75-F1': 'Black Python (Viper)',
  'CL-H75-F2': 'Orion IIC',
  'CL-H75-F3': 'Night Gyr',
  'CL-H80-F1': 'Warhammer IIC',
  'CL-H80-F2': 'Victor IIC',
  'CL-H80-F3': 'Iron Wolf',
  'CL-H85-F1': 'Phoenix Hawk IIC',
  'CL-H85-F2': 'Omen',
  'CL-H85-F3': 'Blood Kite',
  'CL-H90-F1': 'Highlander IIC',
  'CL-H90-F2': 'Supernova',
  'CL-H90-F3': 'Kingfisher',
  'CL-H95-F1': 'Cygnus',
  'CL-H95-F2': 'Ice Bear',
  'CL-H95-F3': 'Executioner (Gladiator)',
  'CL-H100-F1': 'Kodiak',
  'CL-H100-F2': 'Bane (Kraken)',
  'CL-H100-F3': 'Stone Rhino (Behemoth)',

  // === Кланы: Негуманоиды (34) ===
  'CL-N20-F2': 'Fire Mite',
  'CL-N20-F3': 'Snow Weasel',
  'CL-N25-F2': 'Locust IIC',
  'CL-N25-F3': 'Mist Lynx (Koshi)',
  'CL-N30-F2': 'Hellion',
  'CL-N30-F3': 'Kit Fox (Uller)',
  'CL-N35-F2': 'Cougar',
  'CL-N35-F3': 'Adder (Puma)',
  'CL-N40-F2': 'Coyotl',
  'CL-N40-F3': 'Pouncer',
  'CL-N45-F2': 'Shadow Cat',
  'CL-N45-F3': 'Grendel (Mongrel)',
  'CL-N50-F2': 'Lupus',
  'CL-N50-F3': 'Nova (Black Hawk)',
  'CL-N55-F2': 'Black Lanner',
  'CL-N55-F3': 'Stormcrow (Ryoken)',
  'CL-N60-F2': 'Shadow Cat II',
  'CL-N60-F3': 'Mad Dog (Vulture)',
  'CL-N65-F2': 'Ebon Jaguar (Cauldron-Born)',
  'CL-N65-F3': 'Linebacker',
  'CL-N70-F2': 'Flamberge',
  'CL-N70-F3': 'Sun Spider',
  'CL-N75-F2': 'Woodsman',
  'CL-N75-F3': 'Timber Wolf (Mad Cat)',
  'CL-N80-F2': 'Naga',
  'CL-N80-F3': 'Gargoyle (Man O\' War)',
  'CL-N85-F2': 'Marauder IIC',
  'CL-N85-F3': 'Warhawk (Masakari)',
  'CL-N90-F2': 'Blood Asp',
  'CL-N90-F3': 'Savage Coyote',
  'CL-N95-F2': 'Turkina',
  'CL-N95-F3': 'Shadow Wolf',
  'CL-N100-F2': 'Tomahawk',
  'CL-N100-F3': 'Dire Wolf (Daishi)',
};

const REACTOR_LETTERS: Record<number, string> = {
  1: 'A',
  2: 'B',
  3: 'C',
  4: 'D',
  5: 'E',
};

const TECH_BASES: TechBase[] = ['is', 'clan'];
// Число тиров берётся из таблиц, а не пишется здесь: иначе сокращение шкалы
// в данных молча оставляет генератор перебирать несуществующие ступени. Каркас
// перебирается ПО ЛОКОМОЦИИ (`frames.byLocomotion`), а не всей шкалой: у
// негуманоида F1 не существует.
const REACTOR_TIERS = Array.from({ length: REACTOR_TIER_COUNT }, (_, i) => i + 1);

/** Роль читается по тиру реактора: он один определяет подвижность платформы. */
function roleOf(reactorTier: number): string {
  switch (reactorTier) {
    case 1:
      return 'Siege / Defense';
    case 2:
      return 'Brawler / Line';
    case 3:
      return 'Trooper / Generalist';
    case 4:
      return 'Skirmisher / Cavalry';
    default:
      return 'Interceptor / Scout';
  }
}

interface ChassisRow {
  code: string;
  canonName: string;
  techBase: TechBase;
  locomotion: 'H' | 'N';
  weightClass: 'light' | 'medium' | 'heavy' | 'assault';
  tonnage: number;
  reactorTier: number;
  frameTier: number;
  role: string;
  walkMP: number;
  runMP: number;
  baseHeatDiss: number;
  reactorMass: number;
  frameMass: number;
  systemsMass: number;
  maxArmorPts: number;
  defArmorMass: number;
  payloadMass: number;
  frameSlotPenalty: number;
  freeSlotsTotal: number;
  freeSlotsTorso: number;
  freeSlotsArm: number;
}

const rows: ChassisRow[] = [];

for (const techBase of TECH_BASES) {
  for (const locomotion of LOCOMOTIONS) {
    for (const tonnage of CONSTRUCTION.tonnages) {
      for (const r of REACTOR_TIERS) {
        for (const f of frameTiersFor(locomotion)) {
          const p = makePlatform(techBase, tonnage, r, f, undefined, locomotion);
          const prefix = techBase === 'clan' ? 'CL' : 'IS';
          const baseKey = `${prefix}-${locomotion}${tonnage}-F${f}`;
          const baseName = BASE_CHASSIS_NAMES[baseKey];
          if (baseName === undefined) {
            throw new Error(`Отсутствует базовое имя для шасси: ${baseKey}`);
          }
          const letter = REACTOR_LETTERS[r] ?? 'A';
          const canonName = `${baseName} ${letter}`;

          rows.push({
            code: p.code,
            canonName,
            techBase,
            locomotion,
            weightClass: p.weightClass,
            tonnage,
            reactorTier: r,
            frameTier: f,
            role: roleOf(r),
            walkMP: p.walkMP,
            runMP: p.runMP,
            baseHeatDiss: p.baseHeatDiss,
            reactorMass: p.reactorMass,
            frameMass: p.frameMass,
            systemsMass: p.systemsMass,
            maxArmorPts: p.maxArmorPts,
            defArmorMass: p.defArmorMass,
            payloadMass: p.payloadMass,
            frameSlotPenalty: p.frameSlotPenalty,
            freeSlotsTotal: p.freeSlotsTotal,
            freeSlotsTorso: p.freeSlots.torso,
            freeSlotsArm: p.freeSlots.leftArm,
          });
        }
      }
    }
  }
}

// Ни одно имя не должно потеряться, и все 850 имён обязаны быть уникальными.
if (rows.length !== 850) {
  throw new Error(`Ожидалось 850 записей каталога, получено: ${rows.length}`);
}
const uniqueNames = new Set(rows.map((r) => r.canonName));
if (uniqueNames.size !== 850) {
  throw new Error(`Обнаружены дубликаты имён! Уникальных: ${uniqueNames.size} из 850`);
}

const COLUMNS: readonly (keyof ChassisRow)[] = [
  'code', 'canonName', 'techBase', 'locomotion', 'weightClass', 'tonnage',
  'reactorTier', 'frameTier', 'role', 'walkMP', 'runMP', 'baseHeatDiss',
  'reactorMass', 'frameMass', 'systemsMass', 'maxArmorPts', 'defArmorMass',
  'payloadMass', 'frameSlotPenalty', 'freeSlotsTotal', 'freeSlotsTorso', 'freeSlotsArm',
];

const quoted = new Set<keyof ChassisRow>(['canonName', 'role']);

const csvContent = [
  COLUMNS.join(','),
  ...rows.map((r) => COLUMNS.map((c) => (quoted.has(c) ? `"${r[c]}"` : r[c])).join(',')),
].join('\n');

const jsonContent = JSON.stringify(
  {
    $comment:
      `Каталог из ${rows.length} шасси Сферы и Кланов. Сгенерирован из data/construction.json ` +
      'офлайн-тулом tools/generate_chassis_catalog.ts — руками не править, править таблицы тиров.',
    chassis: rows,
  },
  null,
  2,
);

const projectRoot = path.resolve(import.meta.dirname, '..');
fs.writeFileSync(path.join(projectRoot, 'game/data/chassis_catalog.csv'), csvContent);
fs.writeFileSync(path.join(projectRoot, 'game/data/chassis_catalog.json'), jsonContent);

console.log(`Каталог собран: ${rows.length} шасси, из них с каноническим именем ${rows.filter((r) => r.canonName !== '').length}.`);

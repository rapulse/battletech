/**
 * Зоны попадания. Игровая модель — wiki/design/combat/rules.md.
 *
 * Шесть зон, торс единый. Разделение торса на центральный и боковые заложено как
 * расширение: зона хранится записью со своим набором полей, а таблица бросков живёт
 * в данных (`game/data/combat.json`), а не в коде.
 */
export enum HitZone {
  Head = 0,
  Torso = 1,
  LeftArm = 2,
  RightArm = 3,
  LeftLeg = 4,
  RightLeg = 5,
}

export const ZONE_COUNT = 6;

export const ZONE_IDS = ['head', 'torso', 'leftArm', 'rightArm', 'leftLeg', 'rightLeg'] as const;

export type ZoneId = (typeof ZONE_IDS)[number];

export const ZONE_KEYS: Readonly<Record<HitZone, string>> = {
  [HitZone.Head]: 'zone.head',
  [HitZone.Torso]: 'zone.torso',
  [HitZone.LeftArm]: 'zone.leftArm',
  [HitZone.RightArm]: 'zone.rightArm',
  [HitZone.LeftLeg]: 'zone.leftLeg',
  [HitZone.RightLeg]: 'zone.rightLeg',
};

export function zoneFromId(id: ZoneId): HitZone {
  const i = ZONE_IDS.indexOf(id);
  if (i < 0) throw new RangeError(`Неизвестная зона: ${id}`);
  return i as HitZone;
}

export function zoneId(z: HitZone): ZoneId {
  const id = ZONE_IDS[z];
  if (id === undefined) throw new RangeError(`Неизвестная зона: ${z}`);
  return id;
}

/** Руки несут оружие: разрушение руки снимает установленное в ней вооружение. */
export function isArm(z: HitZone): boolean {
  return z === HitZone.LeftArm || z === HitZone.RightArm;
}

/** Разрушение ноги резко роняет подвижность и валит робота. */
export function isLeg(z: HitZone): boolean {
  return z === HitZone.LeftLeg || z === HitZone.RightLeg;
}

/** Зоны, разрушение которых выводит робота из строя. */
export function isVital(z: HitZone): boolean {
  return z === HitZone.Head || z === HitZone.Torso;
}

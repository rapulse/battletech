import type { UnitId } from './MechUnit.js';

/**
 * Что одна сторона знает о чужой машине (wiki/design/combat/terrain.md).
 *
 * Тип живёт в модели, а правило, которое его считает, — в
 * `core/rules/detection.ts`. Разделение не формальность: уровень контакта это
 * часть состояния боя (он сохраняется, хэшируется и показывается), а способ его
 * получить — правило, которое ещё будет меняться.
 */
export enum ContactLevel {
  /** Ничего: цели для этой стороны не существует. */
  None = 0,
  /** «На гексе кто-то есть». Ни класса, ни вооружения. */
  Blip = 1,
  /** Виден силуэт: известен весовой класс. */
  Silhouette = 2,
  /** Опознан: шасси и вооружение. */
  Identified = 3,
}

export const CONTACT_KEYS: Readonly<Record<ContactLevel, string>> = {
  [ContactLevel.None]: 'contact.none',
  [ContactLevel.Blip]: 'contact.blip',
  [ContactLevel.Silhouette]: 'contact.silhouette',
  [ContactLevel.Identified]: 'contact.identified',
};

/** Таблица контактов одной стороны: цель → что о ней известно. */
export type ContactMap = ReadonlyMap<UnitId, ContactLevel>;

export function contactOf(contacts: ContactMap | undefined, id: UnitId): ContactLevel {
  return contacts?.get(id) ?? ContactLevel.None;
}

import type { Storage } from './Storage.js';

/**
 * Хранилище в памяти: тесты и headless-прогон кампании.
 *
 * Не заглушка «чтобы собиралось», а рабочая реализация: круговой прогон
 * «сохранить → загрузить → тот же хэш» обязан проверяться без браузера, иначе
 * сохранение ломается ровно там, где его никто не смотрит.
 */
export class MemoryStorage implements Storage {
  private readonly slots = new Map<string, Uint8Array>();

  save(slot: string, data: Uint8Array): Promise<void> {
    this.slots.set(slot, new Uint8Array(data));
    return Promise.resolve();
  }

  load(slot: string): Promise<Uint8Array | null> {
    const data = this.slots.get(slot);
    return Promise.resolve(data === undefined ? null : new Uint8Array(data));
  }

  /** Отсортированный список: порядок обхода Map не должен просачиваться наружу. */
  list(): Promise<string[]> {
    return Promise.resolve([...this.slots.keys()].sort());
  }

  remove(slot: string): Promise<void> {
    this.slots.delete(slot);
    return Promise.resolve();
  }
}

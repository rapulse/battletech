import type { Storage } from './Storage.js';

/**
 * Хранилище браузера. Второй реализацией на M8 встанет `TauriFsStorage` —
 * интерфейс для того и заведён.
 *
 * IndexedDB, а не `localStorage`: последний хранит строки, ограничен парой
 * мегабайт и синхронно блокирует поток. Сохранение кампании — двоичные данные
 * неизвестного заранее размера.
 */
const DB_NAME = 'battletech';
const STORE = 'saves';
const DB_VERSION = 1;

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, rejectPromise) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => rejectPromise(req.error ?? new Error('Ошибка IndexedDB'));
  });
}

export class IndexedDbStorage implements Storage {
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, rejectPromise) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => rejectPromise(req.error ?? new Error('Не открылась база сохранений'));
    });
    return this.db;
  }

  private async tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => Promise<T>): Promise<T> {
    const db = await this.open();
    return run(db.transaction(STORE, mode).objectStore(STORE));
  }

  async save(slot: string, data: Uint8Array): Promise<void> {
    await this.tx('readwrite', (store) => request(store.put(data, slot)));
  }

  async load(slot: string): Promise<Uint8Array | null> {
    const raw = await this.tx('readonly', (store) => request<unknown>(store.get(slot)));
    return raw instanceof Uint8Array ? raw : null;
  }

  async list(): Promise<string[]> {
    const keys = await this.tx('readonly', (store) => request(store.getAllKeys()));
    return keys.filter((k): k is string => typeof k === 'string').sort();
  }

  async remove(slot: string): Promise<void> {
    await this.tx('readwrite', (store) => request(store.delete(slot)));
  }
}

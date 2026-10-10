/**
 * Доступ к файлам изолирован одним интерфейсом (game_core.md §9).
 *
 * Ровно это позволяет игре одновременно быть и страницей в браузере, и
 * приложением: `IndexedDbStorage` — браузер, `TauriFsStorage` — десктоп (M8+,
 * ещё не написан), `MemoryStorage` — тесты и headless-прогон.
 *
 * `core/` про этот интерфейс не знает вовсе — линтер это и проверяет
 * (`src/core/**` запрещено импортировать `**\/platform\/**`). Сериализацию
 * кампании делает ядро (`core/campaign/save.ts`), запись байтов — этот слой.
 */
export interface Storage {
  save(slot: string, data: Uint8Array): Promise<void>;
  load(slot: string): Promise<Uint8Array | null>;
  list(): Promise<string[]>;
  remove(slot: string): Promise<void>;
}

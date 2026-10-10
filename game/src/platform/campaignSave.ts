import { restore, snapshot, type CampaignState } from '../core/campaign/index.js';
import { makeSaveFile, parseSaveFile } from '../core/campaign/index.js';
import type { Storage } from './Storage.js';

/**
 * Запись и чтение кампании через хранилище.
 *
 * Разделение обязанностей ровно такое: ядро превращает состояние в снимок и
 * проверяет его схемой, этот слой превращает снимок в байты и кладёт их куда
 * умеет. Ядро про хранилище не знает — иначе оно перестало бы собираться для
 * чистого Node, и headless-прогон кампании умер бы вместе с этим.
 */
export async function saveCampaign(
  storage: Storage,
  slot: string,
  state: CampaignState,
): Promise<void> {
  const file = makeSaveFile(snapshot(state));
  await storage.save(slot, new TextEncoder().encode(JSON.stringify(file)));
}

/**
 * Загрузка. `null` — слота нет; исключение — файл испорчен или записан другой
 * версией правил (`IncompatibleSaveError`). Разница существенная: первое —
 * обычное дело, второе игрок обязан увидеть.
 */
export async function loadCampaign(storage: Storage, slot: string): Promise<CampaignState | null> {
  const bytes = await storage.load(slot);
  if (bytes === null) return null;
  const json: unknown = JSON.parse(new TextDecoder().decode(bytes));
  return restore(parseSaveFile(json));
}

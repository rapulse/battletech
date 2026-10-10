/**
 * Отдать файл пользователю (шаг 29).
 *
 * Живёт в `platform/`, а не в компоненте, по той же причине, что и хранилище:
 * это единственное место, где проект разговаривает с браузером напрямую. Ядро
 * СОБИРАЕТ содержимое (`core/log/battleReport.ts`), слой показа решает, когда
 * его отдать, а как именно оно превращается в файл — знает только этот модуль.
 */
export function downloadText(text: string, filename: string, mime: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Имя файла с отметкой времени и сидами.
 *
 * Сиды в ИМЕНИ, а не только внутри файла: отладочных выгрузок за сеанс
 * набирается десяток, и различать их по времени сохранения — значит открывать
 * каждую. По имени видно, какой бой это был. Приставку («бой») даёт словарь
 * интерфейса (шаг 52): имя файла игрок видит, и оно идёт его языком.
 */
export function battleLogName(prefix: string, mapSeed: number, battleSeed: number, ext: string): string {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  return `${prefix}-${mapSeed}-${battleSeed}-${stamp}.${ext}`;
}

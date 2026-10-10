import { describe, expect, it } from 'vitest';
import { MemoryStorage } from '../src/platform/MemoryStorage.js';
import {
  loadCachedLogs,
  LOG_LIMIT,
  LOGS_SLOT,
  saveCachedLogs,
  WAR_LOG_LIMIT,
  type CachedUiLogs,
  type LogLine,
  type RepLine,
  type WarLine,
} from '../src/ui/state/logStorage.js';
import { CampaignUi } from '../src/ui/state/campaign.svelte.js';
import { makeSaveFile, snapshot } from '../src/core/campaign/index.js';

describe('кэш последних событий интерфейса (logStorage)', () => {
  const sampleLog: LogLine = {
    day: 10,
    kind: 'info',
    text: 'Тестовая запись журнала',
  };

  const sampleWar: WarLine = {
    day: 10,
    kind: 'raid',
    systemId: 'solariss',
    attacker: 'kurita',
    defender: 'davion',
    ruined: 0.15,
  };

  const sampleRep: RepLine = {
    day: 10,
    factionId: 'kurita',
    delta: 5,
    after: 15,
    reason: 'employer',
    source: 'won',
  };

  it('сохраняет и восстанавливает события при точном совпадении сида, дня и имени роты', async () => {
    const storage = new MemoryStorage();
    const payload: CachedUiLogs = {
      seed: 42,
      day: 10,
      companyName: 'Iron Hounds',
      logs: [sampleLog],
      warLog: [sampleWar],
      repLog: [sampleRep],
    };

    await saveCachedLogs(storage, payload);
    const restored = await loadCachedLogs(storage, 42, 10, 'Iron Hounds');

    expect(restored).not.toBeNull();
    expect(restored?.logs).toEqual([sampleLog]);
    expect(restored?.warLog).toEqual([sampleWar]);
    expect(restored?.repLog).toEqual([sampleRep]);
  });

  it('возвращает null, если кэша нет в хранилище (чистый запуск)', async () => {
    const storage = new MemoryStorage();
    const restored = await loadCachedLogs(storage, 42, 10, 'Iron Hounds');
    expect(restored).toBeNull();
  });

  it('отклоняет кэш, если сид не совпадает (другая кампания)', async () => {
    const storage = new MemoryStorage();
    await saveCachedLogs(storage, {
      seed: 42,
      day: 10,
      companyName: 'Iron Hounds',
      logs: [sampleLog],
      warLog: [sampleWar],
      repLog: [sampleRep],
    });

    const restored = await loadCachedLogs(storage, 999, 10, 'Iron Hounds');
    expect(restored).toBeNull();
  });

  it('отклоняет кэш, если день не совпадает (откат сохранения или забегание вперёд)', async () => {
    const storage = new MemoryStorage();
    await saveCachedLogs(storage, {
      seed: 42,
      day: 50,
      companyName: 'Iron Hounds',
      logs: [sampleLog],
      warLog: [sampleWar],
      repLog: [sampleRep],
    });

    // Игрок загрузил сохранение 10-го дня, а в кэше события 50-го дня
    const restored = await loadCachedLogs(storage, 42, 10, 'Iron Hounds');
    expect(restored).toBeNull();
  });

  it('отклоняет кэш, если имя роты не совпадает', async () => {
    const storage = new MemoryStorage();
    await saveCachedLogs(storage, {
      seed: 42,
      day: 10,
      companyName: 'Iron Hounds',
      logs: [sampleLog],
      warLog: [sampleWar],
      repLog: [sampleRep],
    });

    const restored = await loadCachedLogs(storage, 42, 10, 'Blood Wolves');
    expect(restored).toBeNull();
  });

  it('отклоняет кэш при повреждённом JSON или неверной структуре', async () => {
    const storage = new MemoryStorage();
    await storage.save(LOGS_SLOT, new TextEncoder().encode('not-valid-json'));
    expect(await loadCachedLogs(storage, 42, 10, 'Iron Hounds')).toBeNull();

    await storage.save(LOGS_SLOT, new TextEncoder().encode(JSON.stringify({ seed: 'bad' })));
    expect(await loadCachedLogs(storage, 42, 10, 'Iron Hounds')).toBeNull();
  });

  it('обрезает записи при сохранении до установленных лимитов', async () => {
    const storage = new MemoryStorage();
    const manyLogs: LogLine[] = Array.from({ length: LOG_LIMIT + 50 }, (_, i) => ({
      day: i,
      kind: 'info',
      text: `Log ${i}`,
    }));
    const manyWar: WarLine[] = Array.from({ length: WAR_LOG_LIMIT + 50 }, (_, i) => ({
      day: i,
      kind: 'raid',
      systemId: 'solaris',
      attacker: 'kurita',
      defender: 'davion',
      ruined: 0,
    }));

    await saveCachedLogs(storage, {
      seed: 42,
      day: 10,
      companyName: 'Iron Hounds',
      logs: manyLogs,
      warLog: manyWar,
      repLog: [],
    });

    const restored = await loadCachedLogs(storage, 42, 10, 'Iron Hounds');
    expect(restored?.logs.length).toBe(LOG_LIMIT);
    expect(restored?.warLog.length).toBe(WAR_LOG_LIMIT);
  });
});

describe('сквозная работа кэша в CampaignUi', () => {
  it('продолжение кампании восстанавливает события журнала и войны', async () => {
    const storage = new MemoryStorage();
    const ui1 = new CampaignUi(storage);

    ui1.newCampaign({ seed: 101, name: 'Hounds', commander: 'Wolf', emblem: 0 });
    ui1.logs = [{ day: 0, kind: 'info', text: 'Первый запуск' }];
    ui1.warLog = [
      {
        day: 0,
        kind: 'effort',
        systemId: 'solaris',
        attacker: 'kurita',
        defender: 'davion',
        ruined: 0,
      },
    ];
    await ui1.save();

    // Симуляция перезапуска браузера: новый экземпляр UI над тем же хранилищем
    const ui2 = new CampaignUi(storage);
    expect(ui2.logs).toEqual([]);
    expect(ui2.warLog).toEqual([]);

    const ok = await ui2.continueCampaign();
    expect(ok).toBe(true);
    expect(ui2.logs.length).toBe(1);
    expect(ui2.logs[0]?.text).toBe('Первый запуск');
    expect(ui2.warLog.length).toBe(1);
    expect(ui2.warLog[0]?.kind).toBe('effort');
  });

  it('старт новой кампании поверх старой начинает с чистого листа и очищает кэш', async () => {
    const storage = new MemoryStorage();
    const ui = new CampaignUi(storage);

    ui.newCampaign({ seed: 101, name: 'Hounds', commander: 'Wolf', emblem: 0 });
    ui.logs = [{ day: 0, kind: 'info', text: 'Старая кампания' }];
    await ui.save();

    // Запускаем новую кампанию с другим сидом
    ui.newCampaign({ seed: 202, name: 'Bears', commander: 'Bear', emblem: 1 });
    expect(ui.logs).toEqual([]);
    expect(ui.warLog).toEqual([]);

    // Перезапуск
    const uiFresh = new CampaignUi(storage);
    const ok = await uiFresh.continueCampaign();
    expect(ok).toBe(true);
    // Должна загрузиться новая кампания с пустыми логами
    expect(uiFresh.logs).toEqual([]);
    expect(uiFresh.warLog).toEqual([]);
  });

  it('импорт файла сохранения начинает с чистого листа и не смешивает чужие события', async () => {
    const storage = new MemoryStorage();
    const ui = new CampaignUi(storage);

    ui.newCampaign({ seed: 101, name: 'Hounds', commander: 'Wolf', emblem: 0 });
    ui.logs = [{ day: 0, kind: 'info', text: 'События первой кампании' }];
    await ui.save();

    // Подготавливаем файл сохранения другой кампании
    const otherUi = new CampaignUi(new MemoryStorage());
    otherUi.newCampaign({ seed: 303, name: 'Dragons', commander: 'Ryu', emblem: 2 });
    const snap = snapshot(otherUi.state);
    const saveFile = makeSaveFile(snap);
    const file = new File([JSON.stringify(saveFile)], 'save.json', { type: 'application/json' });

    const imported = await ui.importFile(file);
    expect(imported).toBe(true);
    expect(ui.logs).toEqual([]);
    expect(ui.warLog).toEqual([]);

    // Перезапуск браузера после импорта
    const uiAfterReload = new CampaignUi(storage);
    await uiAfterReload.continueCampaign();
    expect(uiAfterReload.logs).toEqual([]);
    expect(uiAfterReload.warLog).toEqual([]);
    expect(uiAfterReload.state.seed).toBe(303);
  });
});

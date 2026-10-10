import { describe, expect, it } from 'vitest';
import {
  FACTIONS,
  GALAXY,
  PLAYER_ACTOR_ID,
  WAR,
  clearedOf,
  frontierIndexAt,
  ownerOf,
  tributeOf,
  withPirateClearing,
  withStanding,
  withWorldMemory,
} from '../src/core/campaign/index.js';
import { MemoryStorage } from '../src/platform/MemoryStorage.js';
import { CampaignUi } from '../src/ui/state/campaign.svelte.js';
import { t } from '../src/ui/i18n/index.js';

function makeTestUi(seed = 3): CampaignUi {
  const ui = new CampaignUi(new MemoryStorage());
  ui.newCampaign({ seed, name: 'Hounds', commander: 'Wolf', emblem: 0 });
  return ui;
}

describe('интерфейс владения миром: три пути', () => {
  it('ПРИНЯТЬ ЛЕН: кнопка становится активной только при выполнении всех условий', () => {
    const ui = makeTestUi(3);
    const D = WAR.domain;
    const state = ui.state;

    // Ищем приграничный мир Великого Дома (frontierIndex >= 0.7)
    let borderSystem = -1;
    for (let i = 0; i < GALAXY.count && borderSystem < 0; i++) {
      if (GALAXY.hasFlag(i, 'capital')) continue;
      const owner = ownerOf(state.deltas, i);
      if (FACTIONS.get(owner)?.kind !== 'house') continue;
      if (frontierIndexAt(state.deltas, state.reputation, state.war, i) >= D.grantFrontier) {
        borderSystem = i;
      }
    }
    expect(borderSystem).toBeGreaterThanOrEqual(0);

    const systemId = GALAXY.id(borderSystem);
    const owner = ownerOf(state.deltas, borderSystem);
    state.systemId = systemId;

    // 1. По умолчанию условий нет — кнопка отключена
    const why1 = ui.why({ kind: 'claimGrant' });
    expect(why1).not.toBeNull();
    expect(why1).toBe(t('reject.grantStandingTooLow'));

    // 2. Добавляем репутацию 100, но нет славы и побед
    state.reputation = withStanding(state.reputation, owner, 100);
    const why2 = ui.why({ kind: 'claimGrant' });
    expect(why2).not.toBeNull();
    expect(why2).toBe(t('reject.grantNotOffered'));

    // 3. Добавляем славу 100, но нет 3 побед именно на этом мире
    state.reputation = { ...state.reputation, fame: 100 };
    const why3 = ui.why({ kind: 'claimGrant' });
    expect(why3).not.toBeNull();
    expect(why3).toBe(t('reject.grantNotOffered'));

    // 4. Добавляем 3 победы роты за этого нанимателя на этом мире
    for (let n = 0; n < D.grantWins; n++) {
      state.deltas = withWorldMemory(state.deltas, systemId, owner, true, 3053);
    }

    // Все условия выполнены: кнопка активна!
    const whyReady = ui.why({ kind: 'claimGrant' });
    expect(whyReady).toBeNull();

    // Итог на карточке — до решения (проект державы, шаг 1).
    const outlook = ui.claimOutlook(systemId);

    // Нажимаем «Принять лен»
    const success = ui.run({ kind: 'claimGrant' });
    expect(success).toBe(true);

    // Лен платит дань жалующему Дому на стандартный срок, и итог на карточке — тот, что стал в сводке.
    expect(tributeOf(ui.state.deltas, systemId, ui.state.day)).toBe(owner);
    expect(ui.state.deltas[systemId]?.tributeUntil).toBe(
      ui.state.day + WAR.diplomacy.tributeDecades * WAR.front.tickDays,
    );
    const row = ui.realmWorlds[0];
    expect((row?.income ?? 0) - (row?.upkeep ?? 0)).toBe(outlook.net);
    expect(ui.realm.net).toBe(outlook.grantNet);

    // Мир перешёл в домен роты
    expect(ownerOf(ui.state.deltas, borderSystem)).toBe(PLAYER_ACTOR_ID);
    expect(ui.knowledgeOf(systemId).owner).toBe(PLAYER_ACTOR_ID);

    // Повторный вызов отклонён как уже принадлежащий
    expect(ui.why({ kind: 'claimGrant' })).toBe(t('reject.alreadyOwned'));
  });

  it('ЗАХВАТ: кнопка активна для пиратского мира только при 3 победах и зачистке 60%', () => {
    const ui = makeTestUi(3);
    const D = WAR.domain;
    const state = ui.state;

    // Ищем пиратский мир
    let pirateSystem = -1;
    for (let i = 0; i < GALAXY.count && pirateSystem < 0; i++) {
      if (ownerOf(state.deltas, i) === 'pirates') pirateSystem = i;
    }
    expect(pirateSystem).toBeGreaterThanOrEqual(0);

    const systemId = GALAXY.id(pirateSystem);
    state.systemId = systemId;

    // До зачистки и побед — отклонено
    expect(ui.why({ kind: 'conquerWorld' })).toBe(t('reject.worldNotConquerable'));

    // Добавляем победы
    for (let n = 0; n < D.conquerWins; n++) {
      state.deltas = withWorldMemory(state.deltas, systemId, 'pirates', true, 3053);
    }
    expect(ui.why({ kind: 'conquerWorld' })).toBe(t('reject.worldNotConquerable'));

    // Зачищаем логово >= 60%
    while (clearedOf(state.deltas, systemId) < D.conquerCleared) {
      state.deltas = withPirateClearing(state.deltas, pirateSystem);
    }

    // Кнопка захвата активна!
    expect(ui.why({ kind: 'conquerWorld' })).toBeNull();

    // Захватываем мир
    const success = ui.run({ kind: 'conquerWorld' });
    expect(success).toBe(true);
    expect(ownerOf(ui.state.deltas, pirateSystem)).toBe(PLAYER_ACTOR_ID);
  });

  it('КУПИТЬ ПЛАНЕТУ: отображает цену и активируется при достаточной кассе и репутации', () => {
    const ui = makeTestUi(2);
    const state = ui.state;
    state.company = { ...state.company, cbills: 10_000_000 };

    // Ищем мир в тылу
    let target = -1;
    for (let i = 0; i < GALAXY.count && target < 0; i++) {
      if (GALAXY.hasFlag(i, 'capital')) continue;
      const owner = ownerOf(state.deltas, i);
      if (FACTIONS.get(owner)?.kind !== 'house') continue;
      if (frontierIndexAt(state.deltas, state.reputation, state.war, i) === 0) target = i;
    }
    expect(target).toBeGreaterThanOrEqual(0);

    const systemId = GALAXY.id(target);
    const owner = ownerOf(state.deltas, target);
    state.systemId = systemId;

    const price = ui.worldPriceAt(systemId);
    expect(price).toBeGreaterThanOrEqual(WAR.domain.priceMin);

    // Репутация мала
    expect(ui.why({ kind: 'buyWorld' })).toBe(t('reject.standingTooLow'));

    // Репутация достаточна, но денег нет
    state.reputation = withStanding(state.reputation, owner, 50);
    expect(ui.why({ kind: 'buyWorld' })).toBe(t('reject.insufficientFunds'));

    // Добавляем деньги
    state.company = { ...state.company, cbills: price + 10_000_000 };

    // Кнопка покупки активна!
    expect(ui.why({ kind: 'buyWorld' })).toBeNull();

    const ok = ui.run({ kind: 'buyWorld' });
    expect(ok).toBe(true);
    expect(ownerOf(ui.state.deltas, target)).toBe(PLAYER_ACTOR_ID);
  });
});

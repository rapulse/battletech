<script lang="ts">
  import { battle } from '../state/battle.svelte.js';
  import { campaign } from '../state/campaign.svelte.js';
  import { t } from '../i18n/index.js';
  import BattleWorkspace from '../BattleWorkspace.svelte';
  import BarracksScreen from './BarracksScreen.svelte';
  import CompanyScreen from './CompanyScreen.svelte';
  import ContractsScreen from './ContractsScreen.svelte';
  import MarketScreen from './MarketScreen.svelte';
  import StarMapScreen from './StarMapScreen.svelte';
  import DebriefScreen from './DebriefScreen.svelte';
  import HangarScreen from './HangarScreen.svelte';
  import MechlabScreen from './MechlabScreen.svelte';
  import HeaderTerminal from './HeaderTerminal.svelte';
  import RatingScreen from './RatingScreen.svelte';
  import RelationsScreen from './RelationsScreen.svelte';
  import WarScreen from './WarScreen.svelte';
  import RealmScreen from './RealmScreen.svelte';
  import RealmHq from '../realm/RealmHq.svelte';
  import RealmWorldsTab from '../realm/RealmWorldsTab.svelte';
  import RealmForcesTab from '../realm/RealmForcesTab.svelte';
  import RealmDiplomacyTab from '../realm/RealmDiplomacyTab.svelte';
  import EventCard from './EventCard.svelte';
  import DemandCard from './DemandCard.svelte';

  /**
   * Оболочка кампании: шапка и один из экранов под ней.
   *
   * Роутера как библиотеки здесь нет и не будет — адресной строки у игры тоже
   * нет: экран это состояние интерфейса, а не место в интернете. Переключатель
   * на `{#if}` честно показывает весь список экранов на одной странице.
   *
   * Бой — один из экранов, а не отдельное приложение (п. 1 шага 17). Выход из
   * него один: итог уходит в `battleFinished`, а закрывает контракт разбор.
   */

  const active = $derived(campaign.activeContract);

  function finish(withdrew: boolean): void {
    campaign.battleFinished(battle.outcome(), withdrew);
    battle.leaveContract();
  }
</script>

<div class="shell">
  <!--
    Шапка кампании на боевом экране НЕ рисуется, и это не про место на экране.
    В ней стоят кнопки «прокрутить сутки», а прокрутка суток посреди боя —
    это срок контракта, истёкший, пока звено стоит на поле. Бой идёт вне
    календаря: он либо кончится, либо будет отведён, и только потом время
    пойдёт дальше.
  -->
  {#if campaign.screen !== 'battle'}
    <HeaderTerminal />
  {/if}

  <div class="viewport">
    {#if campaign.screen === 'hangar'}
      <HangarScreen />
    {:else if campaign.screen === 'mechlab'}
      <MechlabScreen />
    {:else if campaign.screen === 'barracks'}
      <BarracksScreen />
    {:else if campaign.screen === 'market'}
      <MarketScreen />
    {:else if campaign.screen === 'starmap'}
      <StarMapScreen />
    {:else if campaign.screen === 'contracts'}
      <ContractsScreen />
    {:else if campaign.screen === 'relations'}
      <RelationsScreen />
    {:else if campaign.screen === 'war'}
      <WarScreen />
    {:else if campaign.screen === 'realm'}
      {#if campaign.realmTab === 'legacy'}
        <RealmScreen />
      {:else if campaign.realmTab === 'worlds'}
        <RealmWorldsTab />
      {:else if campaign.realmTab === 'forces'}
        <RealmForcesTab />
      {:else if campaign.realmTab === 'diplomacy'}
        <RealmDiplomacyTab />
      {:else}
        <RealmHq />
      {/if}
    {:else if campaign.screen === 'rating'}
      <RatingScreen />
    {:else if campaign.screen === 'debrief'}
      <DebriefScreen />
    {:else if campaign.screen === 'battle'}
      <BattleWorkspace
        onFinish={finish}
        title={campaign.companyName}
        subtitle={active === null
          ? t('battle.title')
          : t('battle.contract', {
              mission: t(`mission.${active.mission}`),
              system: campaign.system.name,
            })}
      />
    {:else if campaign.screen === 'company'}
      <CompanyScreen />
    {/if}
  </div>
  <!-- Карточка события мира (шаг 84) — поверх любого экрана, кроме боя: в бою время не идёт. -->
  {#if campaign.screen !== 'battle'}
    <EventCard />
    <DemandCard />
  {/if}
</div>

<style>
  .shell {
    display: flex;
    flex-direction: column;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: var(--color-bg);
  }
  .viewport {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
  }
</style>

<script lang="ts">
  // Настройки — первым импортом: язык обязан быть выбран до того, как любой
  // модуль или экран спросит словарь.
  import { settings } from './state/settings.svelte.js';
  import { battle } from './state/battle.svelte.js';
  import { campaign } from './state/campaign.svelte.js';
  import BattleWorkspace from './BattleWorkspace.svelte';
  import CampaignShell from './campaign/CampaignShell.svelte';
  import CompanySetupScreen from './campaign/CompanySetupScreen.svelte';
  import MainMenu from './campaign/MainMenu.svelte';
  import SettingsScreen from './campaign/SettingsScreen.svelte';

  /**
   * Корень приложения: меню, кампания, свободный бой и настройки.
   *
   * До шага 17 приложением был один боевой экран. Теперь их три — меню,
   * кампания и свободный бой, — и боевой экран стал одним из режимов кампании
   * (п. 1 шага 17). Песочница осталась отдельно намеренно: она нужна для
   * отладки карты и замеров, и прятать её внутрь кампании значило бы требовать
   * основать отряд, чтобы посмотреть на генератор рельефа. Настройки (шаг 52)
   * открываются из меню и из шапки кампании и возвращают туда, откуда пришли.
   *
   * Смена языка пересобирает экраны целиком (`{#key}` по версии настроек):
   * строки словаря не реактивны, и пересборка — самый простой способ показать
   * все подписи на новом языке. Состояние кампании и боя живёт в модулях и не
   * теряется.
   *
   * Строки развёртки — общий тумблер на всё приложение: это свойство экрана, а
   * не отдельного окна.
   */

  // Хранилище опрашивается один раз при запуске: есть ли что продолжать.
  void campaign.probe();

  function leaveSandbox(): void {
    battle.leaveContract();
    campaign.toMenu();
  }
</script>

<div class="root" class:crt={campaign.crt}>
  {#key settings.version}
    {#if campaign.mode === 'menu'}
      <MainMenu />
    {:else if campaign.mode === 'settings'}
      <SettingsScreen />
    {:else if campaign.mode === 'sandbox'}
      <BattleWorkspace onExit={leaveSandbox} />
    {:else if campaign.screen === 'setup'}
      <CompanySetupScreen />
    {:else}
      <CampaignShell />
    {/if}
  {/key}
</div>

<style>
  .root {
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: var(--color-bg);
  }
</style>

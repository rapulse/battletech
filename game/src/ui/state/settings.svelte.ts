import { loadPreferences, savePreferences } from '../../platform/preferences.js';
import { setLanguages } from '../i18n/index.js';
import { DEFAULT_LANGUAGE, isLanguageId, type LanguageId } from '../i18n/languages.js';

/**
 * Настройки игрока (шаг 52): язык интерфейса и язык названий оружия и систем.
 *
 * Выбор читается из браузера при первом импорте модуля — до того, как
 * смонтируется первый экран, — и сразу применяется к словарям. Смена языка
 * поднимает `version`: корень приложения пересобирает экраны по нему
 * (`App.svelte`), а состояние кампании и боя живёт в своих модулях и при
 * пересборке не теряется.
 */
class SettingsUi {
  interfaceLanguage = $state<LanguageId>(DEFAULT_LANGUAGE);
  termsLanguage = $state<LanguageId>(DEFAULT_LANGUAGE);
  version = $state(0);

  constructor() {
    const saved = loadPreferences();
    if (isLanguageId(saved.interfaceLanguage)) this.interfaceLanguage = saved.interfaceLanguage;
    if (isLanguageId(saved.termsLanguage)) this.termsLanguage = saved.termsLanguage;
    setLanguages(this.interfaceLanguage, this.termsLanguage);
  }

  setInterfaceLanguage(id: LanguageId): void {
    this.interfaceLanguage = id;
    this.apply();
  }

  setTermsLanguage(id: LanguageId): void {
    this.termsLanguage = id;
    this.apply();
  }

  /** Быстрый выбор из главного меню: интерфейс и названия оружия разом; по отдельности — в настройках. */
  setLanguage(id: LanguageId): void {
    this.interfaceLanguage = id;
    this.termsLanguage = id;
    this.apply();
  }

  private apply(): void {
    setLanguages(this.interfaceLanguage, this.termsLanguage);
    savePreferences({ interfaceLanguage: this.interfaceLanguage, termsLanguage: this.termsLanguage });
    this.version++;
  }
}

export const settings = new SettingsUi();

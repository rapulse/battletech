import { mount } from 'svelte';
import './ui/styles/terminal.css';
import App from './ui/App.svelte';

/**
 * Точка входа. Три слоя проекта собираются здесь и только здесь:
 * ядро (правила) → render (канвас) → ui (Svelte поверх).
 *
 * Направление зависимостей одностороннее: ядро не знает ни о канвасе, ни о
 * Svelte, и в `core/` нет ни одного импорта отсюда.
 */
const target = document.getElementById('app');
if (target === null) throw new Error('Разметка не найдена: нет #app');

export default mount(App, { target });

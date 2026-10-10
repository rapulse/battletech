import { mount } from 'svelte';
import './ui/styles/terminal.css';
import WikiApp from './ui/wiki/WikiApp.svelte';

/**
 * Точка входа автономной интерактивной базы знаний (Wiki).
 * Запускается на отдельной странице wiki.html.
 */
const target = document.getElementById('app');
if (target === null) throw new Error('Разметка не найдена: нет #app');

export default mount(WikiApp, { target });

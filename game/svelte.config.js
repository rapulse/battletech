import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/**
 * Разметка на Svelte 5 (руны). Препроцессор нужен ровно за одним: `lang="ts"`
 * в блоках `<script>` — интерфейс обязан проверяться теми же типами, что и
 * ядро, иначе слой показа тихо разойдётся с моделью боя.
 */
export default {
  preprocess: vitePreprocess(),
};

/**
 * Экономика фракций на карте 3053 года (шаг 21a).
 *
 * Инструмент калибровки, а не тест: показывает, как достаток раскладывается по
 * двадцати акторам на старте и куда он уезжает за кампанию и за десять лет.
 * Именно им выставлены веса дохода и границы полос в `data/war.json` — числа в
 * комментариях того файла взяты отсюда, а не с потолка.
 *
 *   pnpm econstat [сид]
 */
import { CampaignState } from '../src/core/campaign/state.js';
import { economyList, economyTick, meanWealthPerWorld, prosperityBand, fundsOf } from '../src/core/campaign/war/index.js';
import { FACTIONS } from '../src/core/campaign/galaxy/catalog.js';

const state = new CampaignState(Number(process.argv[2] ?? 1));
const m = (v: number): string => (v / 1e6).toFixed(1).padStart(9);

function table(label: string): void {
  console.log(`\n=== ${label} (день ${state.day}) ===`);
  console.log('фракция          вид        миры   доход,млн  содерж,млн   казна,млн   фонд,млн  достаток  полоса');
  for (const row of economyList(state.war)) {
    let fund = 0;
    for (const f of fundsOf(state.war, row.id)) fund += f.amount;
    console.log(
      row.id.padEnd(16),
      (FACTIONS.get(row.id)?.kind ?? '').padEnd(10),
      String(row.economy.worlds).padStart(5),
      m(row.economy.income),
      m(row.economy.upkeep),
      m(row.economy.treasury),
      m(fund),
      row.prosperity.toFixed(3).padStart(8),
      prosperityBand(row.prosperity).padStart(7),
    );
  }
  console.log('средний достаток на мир, млн:', (meanWealthPerWorld(state.war) / 1e6).toFixed(2));
}

// Репутационное состояние стало обязательным входом такта экономики шагом 26
// (демобилизация зависит от отношений). Инструмент отстал от сигнатуры и с тех
// пор не собирался вовсе — типы в `scripts/` до шага 32 не проверялись.
table('старт');
for (let t = 0; t < 28; t++) state.war = economyTick(state.war, state.reputation);
table('через 28 декад (кампания в 20 контрактов)');
for (let t = 0; t < 365; t++) state.war = economyTick(state.war, state.reputation);
table('через 10 лет');

import { parseSeedRange } from '../src/sim/campaign/batch.js';
import { BUILDING_KINDS } from '../src/core/campaign/war/schema.js';
import { millions as M, playRealmSeed, type RealmBotArgs as Args, type RealmSeedResult as SeedResult } from '../src/sim/campaign/realmBot.js';


/**
 * Бот державы — `pnpm realm` (проект державы, шаг 0).
 *
 * `pnpm camp` державы не видит: его бот живёт контрактами и миров не берёт. Здесь рота
 * получает первый мир леном и дальше живёт державой по простой политике, декада за декадой,
 * теми же командами ядра, что и экран (`execute`). Мир крутится тем же кодом, что в игре.
 *
 * **Старт.** Мир прокручен до `--start-day`; рота получает то, что бот контрактов сида 5
 * заработал за 4.6 года (`--cash`, известность 100, отношение 100 с Домом). Три победы на мире
 * под лен выставлены прямо — их бот и набирает контрактами. Мир под лен — самый доходный
 * пограничный мир Великого Дома, у которого есть сосед-Дом другого флага: иначе держава в тылу и
 * воевать ей не с кем. Контрактов в фазе державы рота не берёт — это мера державы, а не роты.
 *
 * **Политика** (`--policy`):
 *   peace — только армия под потолок и мир;
 *   war   — плюс через год объявить войну соседу (не жалующему Дому) с целью «ближайший к столице
 *           пограничный мир» (шаг 81), мир — когда фракция сама его предлагает (на цели роты); на
 *           пределе усталости мир заключается сам. До шага 81 бот брал и мир даром после года войны.
 *           Приказ армии (шаг 3) — каждую декаду против каждого врага, на участок с лучшим
 *           соотношением сил, если приказ проходит.
 *
 * **Что мерится.** Бои армии роты и её потери — по событиям (шаг 78): `frontClash` рождается у
 * каждого боя фронта с ротой при любом исходе, `realmFrontTally` — итог армии за такт. До шага 78
 * проигранный бой события не рождал, и бои считались ожиданием по весам такта. Бои — такта и
 * приказов вместе; потери — убыль армии в такте фронта и в приказе, а не сумма потерь боёв: машин,
 * которых нет на театре, списать не с чего.
 *
 * Бои здесь — быстрые бои такта мира (`fastResolve`), под лимит 1400 тактических боёв не идут
 * (CLAUDE.md). Ориентир по времени — три минуты: 4 сида × 5 лет укладываются примерно в две.
 *
 *   pnpm realm --seeds 1..4 --years 5 --policy war --war-share 0.5
 *   pnpm realm --seeds 1..4 --years 5 --policy war --no-army     армия 0 — замер шага 80
 *   pnpm realm --seeds 1..4 --years 5 --policy war --lead        рота ведётся к фронту — замер шага 86
 *   pnpm realm --seeds 1..4 --years 5 --policy war --garrison    рота оставляет гарнизоны — замер шага 86b
 *   pnpm realm --seeds 1..4 --years 5 --policy war --build       держава строит — замер шага 87
 *   pnpm realm --seeds 1..4 --years 5 --policy war --build --govern  секторы — губернаторам, войны — стойкам (шаг 88)
 *   pnpm realm --seeds 1..4 --years 5 --policy war --hire            наём великого полка на каждой войне (шаг 89)
 *   pnpm realm --seeds 1..4 --years 5 --policy war --pirates         рота берёт работу «пираты у дома» (шаг 89)
 *   pnpm realm --seeds 1..4 --years 5 --policy war --warwork         работа державы на мире врага и захват (шаг 90)
 *   pnpm realm --seeds 1..4 --years 10 --policy war --junction       лен на стыке трёх держав — партия шага 91
 */

function parseArgs(argv: readonly string[]): Args {
  const get = (k: string, d: string): string => {
    const i = argv.indexOf(`--${k}`);
    return i < 0 ? d : (argv[i + 1] ?? d);
  };
  const policy = get('policy', 'war');
  if (policy !== 'peace' && policy !== 'war') throw new Error(`--policy peace|war, получено ${policy}`);
  return {
    seeds: parseSeedRange(get('seeds', '1..4')),
    years: Number(get('years', '5')),
    startDay: Number(get('start-day', '720')),
    cash: Number(get('cash', '10800000')),
    policy,
    warShare: Number(get('war-share', '0')),
    noArmy: argv.includes('--no-army'),
    joinCoalition: argv.includes('--join-coalition'),
    noRevolt: argv.includes('--no-revolt'),
    lead: argv.includes('--lead'),
    garrison: argv.includes('--garrison'),
    build: argv.includes('--build'),
    govern: argv.includes('--govern'),
    hire: argv.includes('--hire'),
    pirates: argv.includes('--pirates'),
    warWork: argv.includes('--warwork'),
    junction: argv.includes('--junction'),
    verbose: argv.includes('--verbose'),
  };
}


function main(): void {
  const a = parseArgs(process.argv.slice(2));
  const t0 = Date.now();
  const rows: SeedResult[] = [];
  for (const seed of a.seeds) rows.push(playRealmSeed(seed, a));

  console.log(`\nдержава: ${a.policy}${a.noArmy ? ', без армии' : ''}, бюджет войны ${a.warShare}, ${a.years} лет с дня ${a.startDay}, касса на старте ${M(a.cash)} млн`);
  console.log(
    'сид  лен                  Дом       миров(макс) взято отнято дань  боёв-атк боёв-обр потеряно  войн/ИИ/мир дек.войны  армия/потолок  итог/дек  касса  отн.Дома',
  );
  for (const r of rows) {
    console.log(
      [
        String(r.seed).padEnd(4),
        r.grant.slice(0, 20).padEnd(20),
        r.grantor.padEnd(9),
        `${r.worldsEnd}(${r.worldsMax})`.padEnd(11),
        String(r.captured).padEnd(5),
        String(r.lost).padEnd(6),
        String(r.tributesOnUs).padEnd(5),
        String(r.battlesAttack).padEnd(8),
        String(r.battlesDefence).padEnd(8),
        String(r.mechsLost).padEnd(8),
        `${r.wars}/${r.aiWars}/${r.peaces}`.padEnd(11),
        String(r.warDecades).padEnd(9),
        `${r.armyEnd}/${r.armyCapEnd}`.padEnd(14),
        M(r.netPerDecade).padEnd(9),
        M(r.cashEnd).padEnd(6),
        r.grantorStanding.toFixed(0) + (r.realmLost ? '  ДЕРЖАВА ПАЛА' : ''),
      ].join(' '),
    );
  }
  const mean = (f: (r: SeedResult) => number): string => (rows.reduce((s, r) => s + f(r), 0) / rows.length).toFixed(2);
  console.log(
    `среднее: миров ${mean((r) => r.worldsEnd)}, взято ${mean((r) => r.captured)}, отнято ${mean((r) => r.lost)}, дань на роту ${mean((r) => r.tributesOnUs)}, ` +
      `боёв армии роты наступ. ${mean((r) => r.battlesAttack)} / обор. ${mean((r) => r.battlesDefence)}, потеряно машин ${mean((r) => r.mechsLost)} за ${a.years} лет, ` +
      `итог ${mean((r) => r.netPerDecade / 1e6)} млн/дек, касса ${mean((r) => r.cashEnd / 1e6)} млн, отношение Дома ${mean((r) => r.grantorStanding)}`,
  );
  const sum = (f: (r: SeedResult) => number): number => rows.reduce((acc, r) => acc + f(r), 0);
  const peaces = sum((r) => r.peaces);
  const ended = sum((r) => r.warsEnded);
  const open = sum((r) => r.warsOpen);
  console.log(
    `миры: ${peaces} за все сиды — даром ${sum((r) => r.peacesFree)}, за отступные ${sum((r) => r.peacesPaid)}, ` +
      `уступкой ${sum((r) => r.peacesCeded)}, принудительных ${sum((r) => r.peacesForced)}` +
      (peaces > 0 ? ` (даром ${((100 * sum((r) => r.peacesFree)) / peaces).toFixed(0)} %)` : '') +
      `; войн кончилось ${ended}` +
      (ended > 0 ? `, средняя длина ${(sum((r) => r.warDays) / ended).toFixed(0)} сут.` : '') +
      `; идёт к концу ${open}` +
      (open > 0 ? `, в среднем ${(sum((r) => r.warOpenDays) / open).toFixed(0)} сут.` : ''),
  );
  const orders = rows.reduce((s, r) => s + r.orders, 0);
  if (orders > 0) {
    const wins = rows.reduce((s, r) => s + r.orderWins, 0);
    const odds = rows.reduce((s, r) => s + r.orderOdds, 0);
    console.log(
      `приказы армии: ${orders} за все сиды, взято ${wins} (${((100 * wins) / orders).toFixed(0)} %), ` +
        `среднее соотношение сил до боя ${((100 * odds) / orders).toFixed(0)} %; по сидам ${rows.map((r) => `${r.orderWins}/${r.orders}`).join(' ')}`,
    );
  }
  const clashes = sum((r) => r.companyClashes);
  console.log(
    `рота в приказах${a.lead ? ' (ведётся к фронту)' : ''}: ${clashes} за все сиды` +
      (clashes > 0
        ? `, в среднем ${(sum((r) => r.companyMechs) / clashes).toFixed(1)} машин против отряда ${(sum((r) => r.companyDetachment) / clashes).toFixed(1)}, ` +
          `выбито ${(sum((r) => r.companyKnocked) / clashes).toFixed(2)}, потеряно машин роты всего ${sum((r) => r.companyLost)}`
        : '') +
      `; по сидам ${rows.map((r) => `${r.companyClashes}`).join(' ')}`,
  );
  console.log(
    `лояльность${a.noRevolt ? ' (восстаний бот не подавляет)' : ''}: восстаний ${mean((r) => r.revolts)}, боёв восстания ${mean((r) => r.revoltFights)}, ` +
      `подавлено ${mean((r) => r.suppressed)}, отпало миров ${mean((r) => r.seceded)}, средняя лояльность к концу ${mean((r) => r.loyaltyEnd)}; ` +
      `по сидам ${rows.map((r) => `${r.revolts}/${r.suppressed}/${r.seceded}`).join(' ')}`,
  );
  const gDecades = sum((r) => r.garrisonWorldDecades);
  const gAttacks = sum((r) => r.garrisonAttacks);
  const gFights = gAttacks - sum((r) => r.garrisonWithdrew);
  console.log(
    `гарнизон${a.garrison ? '' : ' (бот не оставляет)'}: мир-декад ${gDecades}, нападений фронта ${gAttacks}` +
      (gDecades > 0 ? ` (${(gAttacks / gDecades).toFixed(3)} на мир-декаду)` : '') +
      `, из них отходов ${sum((r) => r.garrisonWithdrew)}` +
      (gFights > 0
        ? `; в бою отряд ${(sum((r) => r.garrisonDetachment) / gFights).toFixed(1)}, выбито ${(sum((r) => r.garrisonKnocked) / gFights).toFixed(2)}, потеряно машин ${sum((r) => r.garrisonClashLost)}`
        : '') +
      `; боёв восстания ${sum((r) => r.garrisonRevoltFights)}, побед ${sum((r) => r.garrisonRevoltWon)}, потеряно машин ${sum((r) => r.garrisonRevoltLost)}` +
      `; ушёл с потерянного мира ${sum((r) => r.garrisonEvacuated)}, потеряно с миром машин ${sum((r) => r.garrisonLostMechs)}`,
  );
  const kinds = BUILDING_KINDS.map((k) => `${k} ${sum((r) => r.built[k] ?? 0)}`).join(', ');
  console.log(
    `постройки${a.build ? '' : ' (бот не строит)'}: готово за все сиды — ${kinds}; потрачено на стройку ${M(sum((r) => r.buildSpent) / rows.length)} млн, ` +
      `содержание ${M(sum((r) => r.buildUpkeep) / rows.length)} млн на сид; при потере мира снесено ${sum((r) => r.buildingsDemolished)}, уцелело ${sum((r) => r.buildingsKept)}`,
  );
  // Политики (шаг 88) — строка только с флагом: без него вывод побитово как у `main`.
  if (a.govern) {
    const acts = ['governor.build', 'governor.develop', 'governor.focus', 'stance.offensive', 'stance.peace']
      .map((k) => `${k} ${sum((r) => r.policyActs[k] ?? 0)}`)
      .join(', ');
    console.log(
      `политики: секторов к концу ${(sum((r) => r.sectorsEnd) / rows.length).toFixed(2)} на сид; команд за все сиды — ${acts}; ` +
        `на развитие и фокус ${M(sum((r) => r.investSpent) / rows.length)} млн на сид`,
    );
  }
  // Титулы (шаг 89) — по числу миров к концу: строка всегда.
  const titles = new Map<string, number>();
  for (const r of rows) titles.set(r.titleEnd ?? '—', (titles.get(r.titleEnd ?? '—') ?? 0) + 1);
  console.log(`титулы к концу: ${[...titles].map(([k, n]) => `${k} ${n}`).join(', ')}`);

  console.log(
    `пираты у дома: прорывов на миры державы за все сиды ${sum((r) => r.homeRaids)}; боёв роты ${sum((r) => r.raidFights)}, отбито ${sum((r) => r.raidsRepelled)}` +
      `${a.pirates ? '' : ' (бот работу не берёт)'}; боёв гарнизона ${sum((r) => r.garrisonRaidFights)}, побед ${sum((r) => r.garrisonRaidWon)}`,
  );
  // Требования соседей (шаг 89) — правка мира: строка всегда.
  console.log(
    `требования: пришло за все сиды ${sum((r) => r.demands)}, принято ${sum((r) => r.demandsAccepted)}, отказано ${sum((r) => r.demandsRefused)}; ` +
      `войн ИИ от соседей после отказа ${sum((r) => r.warsAfterRefusal)}`,
  );
  // Экономика армии (шаг 90, ступень 8): доля содержания армии в доходе миров — рамка 30–50 % под потолком.
  console.log(
    `армия в доходе: содержание ${M(sum((r) => r.armyUpkeepSum) / rows.length)} млн на сид, доход миров ${M(sum((r) => r.incomeSum) / rows.length)} млн, ` +
      `доля ${Math.round((sum((r) => r.armyUpkeepSum) / Math.max(1, sum((r) => r.incomeSum))) * 100)} %; по сидам ${rows.map((r) => Math.round((r.armyUpkeepSum / Math.max(1, r.incomeSum)) * 100)).join(' / ')} %`,
  );
  {
    const years = Math.max(...rows.map((r) => r.byYear.length));
    const line = (k: number): string => {
      const ys = rows.map((r) => r.byYear[k]).filter((x) => x !== undefined);
      const inc = ys.reduce((s, x) => s + x.income, 0);
      const pct = (v: number): number => Math.round((v / Math.max(1, inc)) * 100);
      const worlds = ys.reduce((s, x) => s + x.worlds / Math.max(1, x.ticks), 0) / Math.max(1, ys.length);
      return `год ${k + 1}: миров ${worlds.toFixed(1)}, армия ${pct(ys.reduce((s, x) => s + x.army, 0))} % (без скидок ${pct(ys.reduce((s, x) => s + x.full, 0))} %)`;
    };
    console.log(`армия в доходе по годам:\n  ${[...Array(years).keys()].map(line).join('\n  ')}`);
  }
  if (a.warWork) {
    console.log(
      `работа державы на мире врага: боёв за все сиды ${sum((r) => r.warWorkFights)}, побед ${sum((r) => r.warWorkWon)}, ` +
        `миров взято по праву флага ${sum((r) => r.warWorkConquered)}`,
    );
  }
  if (a.hire) {
    const fights = sum((r) => r.hiredCommissions);
    console.log(
      `наём полков: нанято за все сиды ${sum((r) => r.hires)}, потрачено ${M(sum((r) => r.hireSpent) / rows.length)} млн на сид; ` +
        `подрядов нанятых полков ${fights}, побед ${sum((r) => r.hiredWins)}${fights > 0 ? ` (${Math.round((sum((r) => r.hiredWins) / fights) * 100)} %)` : ''}`,
    );
  }
  // Сопротивление растущей державе (шаг 91): войны ИИ, отнятые миры, восстания и войны без выигрыша — по сидам.
  console.log(
    `сопротивление: войн ИИ ${sum((r) => r.aiWars)} (коалицией ${sum((r) => r.coalitionWars)}), отнято миров ${sum((r) => r.lost)}, ` +
      `восстаний ${sum((r) => r.revolts)}, войн без выигрыша державы ${sum((r) => r.warsNoWin)}, мир-декад подстрекательства ${sum((r) => r.inciteDecades)}, ` +
      `торговых договоров в ответ ${sum((r) => r.pactsSigned)}; ` +
      `по сидам войн ИИ / отнято / восстаний / без выигрыша: ${rows.map((r) => `${r.aiWars}/${r.lost}/${r.revolts}/${r.warsNoWin}`).join('  ')}`,
  );
  console.log(`время: ${Math.round((Date.now() - t0) / 1000)} с`);
}

main();

import { GALAXY } from '../../core/campaign/index.js';
import { t, tn } from '../i18n/index.js';
import type { WarLine } from '../state/campaign.svelte.js';
import { factionName } from './relations.js';

/**
 * Текст строки сводки войны (шаг 21b; вынесено из `WarLogList.svelte` после шага 93): одна функция на ленту и на
 * поворот державы с картинкой (`realm/RealmMoment.svelte`) — второй копии формулировок нет.
 */
function systemName(id: string): string {
  const i = GALAXY.index(id);
  return i < 0 ? id : GALAXY.name(i);
}

/** Строки, где обе стороны — наёмные отряды, а не фракции. */
const RIVAL_UNIT_KINDS = ['rivalGone', 'rivalBack'];

export function warLineText(line: WarLine): string {
  const args = {
    // У строки «смена отряда» обе стороны — отряды, а не фракции, и прогонять
    // их через реестр фракций значило бы показать id вместо имени.
    attacker: RIVAL_UNIT_KINDS.includes(line.kind) ? line.attacker : factionName(line.attacker),
    defender: RIVAL_UNIT_KINDS.includes(line.kind) ? line.defender : factionName(line.defender),
    system: systemName(line.systemId),
    who: line.who ?? '',
    size: String(line.size ?? 0),
    lost: String(line.lost ?? 0),
  };
  if (line.kind === 'commission') {
    return t(line.detail === 'won' ? 'war.commissionWon' : 'war.commissionLost', args);
  }
  if (line.kind === 'clash') {
    const c = line.clash;
    const main = t(`war.clash.${c?.outcome ?? 'repelled'}`, {
      ...args,
      attackerSize: c?.attackerSize ?? 0,
      defenderSize: c?.defenderSize ?? 0,
    });
    // Звено роты в приказе (шаг 86) — той же строкой: бой фронта один, столкновений в нём два.
    const company = c?.company === undefined ? '' : ` ${t('war.clashCompany', c.company)}`;
    // Гарнизон роты в бою за свой мир (шаг 86b) — тем же приёмом, второй фразой строки боя.
    const garrison =
      c?.garrison === undefined
        ? ''
        : ` ${t(c.garrison.withdrew ? 'war.clashGarrisonWithdrew' : 'war.clashGarrison', {
            mechs: c.garrison.mechs,
            detachment: c.garrison.detachment,
            knocked: c.garrison.knocked,
            lost: c.garrison.lost,
          })}`;
    return `${main}${company}${garrison}`;
  }
  if (line.kind === 'warEnded') {
    return t(`war.ended.${line.ended ?? 'free'}`, args);
  }
  if (line.kind === 'revolt') return t(line.detail === 'won' ? 'war.revoltWon' : 'war.revolt', args);
  if (line.kind === 'pact') return t(`war.pact.${line.pact ?? 'truce'}`, args);
  if (line.kind === 'event') return t(`worldEvent.${line.eventId ?? ''}.title`);
  if (line.kind === 'coalition') return t('war.coalition', { ...args, against: factionName(line.against ?? '') });
  if (line.kind === 'policy') {
    // Команда политики державы (шаг 88): губернатор — позывной и центр сектора, стойка — враг.
    const p = line.policy;
    return t(`war.policy.${p?.by ?? 'governor'}.${p?.act ?? 'build'}`, {
      ...args,
      center: systemName(p?.center ?? ''),
      building: p?.building === undefined ? '' : t(`realm.world.building.${p.building}`),
      focus: p?.focus === undefined ? '' : t(`focus.${p.focus}`),
    });
  }
  if (line.kind === 'realmLoss') {
    return t('war.realmLoss', {
      lost: tn('count.mechsAcc', line.lost ?? 0),
      battles: tn('count.battlesIn', line.size ?? 0),
      army: line.army ?? 0,
    });
  }
  return t(`war.${line.kind}`, args);
}

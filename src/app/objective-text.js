// Single source of truth for turning a quest objective into player-facing
// prose. Duplicated logic here (once in the HUD tracker, once in the
// quest-offer modal) has already drifted apart twice — once each type.
import { CONTENT } from '../sim/content.js';

export function describeObjective(o) {
  if (o.type === 'kill') {
    // Prefer the enemy kind's display name (e.g. "Ironhusk") over the raw
    // content id — falls back to the id itself for a target with no
    // matching enemyKind (shouldn't happen in shipped content; validate.js
    // catches that), so this never throws on a typo.
    const name = CONTENT.enemyKinds[o.target]?.name || o.target;
    return `Defeat ${o.n || 1} ${name}${(o.n || 1) > 1 ? 's' : ''}`;
  }
  if (o.type === 'collect') return `Find the ${o.item.replace(/-/g, ' ')}`;
  if (o.type === 'reach') return `Reach the ${o.zone.replace(/-/g, ' ')}`;
  if (o.type === 'attune') return `Attune the ${o.facet} well`;
  throw new Error(`describeObjective: unknown objective type ${o.type}`);
}

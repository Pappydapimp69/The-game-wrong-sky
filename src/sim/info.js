// Skill-gated information: what the player can PERCEIVE is a progression
// reward. The same world renders differently per build — a Seeker reads a
// husk's exact strength; a Brawler sees "???". Pure read helpers; the
// renderer consumes these, the sim never depends on them.

import { CONTENT } from './content.js';

// Can this player read the enemy's exact HP/power?
export function canSense(player, enemyKind) {
  const kind = CONTENT.enemyKinds[enemyKind];
  if (!kind) return false;
  return player.skills.perception.lvl >= kind.senseReq;
}

// What the player sees above an enemy's head.
export function enemyReadout(player, enemy) {
  const kind = CONTENT.enemyKinds[enemy.kind];
  if (!enemy.alive) return '';
  if (canSense(player, enemy.kind)) return `${kind.name} ${enemy.hp}/${enemy.maxHp} · pw ${enemy.power}`;
  return '???';
}

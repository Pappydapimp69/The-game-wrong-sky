// Pixel-sprite DATA: original characters (no copied names/art), authored as
// small character grids for src/app/pixelart.js. Deliberately distinct from
// any existing IP — a violet-haired aura-fighter in teal/amber, not orange/blue.

const PLAYER_PALETTE = {
  H: '#3c2a5e', h: '#6b4fa0', // hair (dark / highlight violet)
  S: '#e8b98a', // skin
  O: '#1f5f5f', o: '#163f3f', // outfit teal (main / shadow)
  A: '#d98a2b', // sash accent
  B: '#241a1a', // boots
  E: '#14100c', // eyes
};

const HAIR = [
  '..H..hh..H..',
  '.HHHhhhhHHH.',
  'HHHhhhhhhHHH',
];
const FACE = [
  '.HSSSSSSSSH.',
  '.SSSESSESS..',
  '.SSSSSSSSS..',
  '..SSSSSSSS..',
];
const BACK_HEAD = [
  '.HHHHHHHHHH.',
  '.HHHHHHHHHH.',
  '.HHHHHHHHHH.',
  '..HHHHHHHH..',
];
const SHOULDERS = ['.OOOOOOOOOO.'];

// Torso rows: sash band + arms. `armL`/`armR` swap between 'S' (visible) and
// 'O' (tucked, reads as facing away from camera on that side).
const torso = (armL, armR) => [
  `${armL}OOOAAOOOOO${armR}`,
  `${armL}OOOOOOOOOO${armR}`,
  '.OOOOOOOOO..',
];
const LEGS_A = ['..BBB..BBB..', '..BBB..BBB..']; // idle stance
const LEGS_B = ['.BBB...BBB..', '..BBB..BBB..']; // mid-stride (walk frame 2)

function sprite(key, rows) { return { key, rows, palette: PLAYER_PALETTE }; }

export const PLAYER_SPRITES = {
  'down-0': sprite('p-down-0', [...HAIR, ...FACE, ...SHOULDERS, ...torso('S', 'S'), ...LEGS_A]),
  'down-1': sprite('p-down-1', [...HAIR, ...FACE, ...SHOULDERS, ...torso('S', 'S'), ...LEGS_B]),
  'up-0': sprite('p-up-0', [...HAIR, ...BACK_HEAD, ...SHOULDERS, ...torso('O', 'O'), ...LEGS_A]),
  'up-1': sprite('p-up-1', [...HAIR, ...BACK_HEAD, ...SHOULDERS, ...torso('O', 'O'), ...LEGS_B]),
  // Side (drawn facing left; the renderer mirrors it via ctx.scale for right).
  'side-0': sprite('p-side-0', [...HAIR, ...FACE, ...SHOULDERS, ...torso('O', 'S'), ...LEGS_A]),
  'side-1': sprite('p-side-1', [...HAIR, ...FACE, ...SHOULDERS, ...torso('O', 'S'), ...LEGS_B]),
  // Charge pose: both arms tucked in (the aura ring the renderer already
  // draws separately carries the rest of the "charging" read).
  'charge': sprite('p-charge', [...HAIR, ...FACE, ...SHOULDERS, ...torso('O', 'O'), ...LEGS_A]),
};

// A small blue aura-blast orb (presentation-only projectile — see game.js).
export const BLAST_SPRITE = {
  key: 'blast-orb',
  rows: [
    '..BBBB..',
    '.BbCCbB.',
    'BbCCCCbB',
    'BCCCCCCB',
    'BCCCCCCB',
    'BbCCCCbB',
    '.BbCCbB.',
    '..BBBB..',
  ],
  palette: { C: '#dff3ff', B: '#3fa9f5', b: '#1f6fae' },
};

// One distinct silhouette per enemy kind — recognizable shapes, not recolored
// squares. 10x10, single-character-per-cell grids (see pixelart.js), simple
// and legible at small scale.
const ENEMY_PALETTE = {
  w: '#c9d6e8', v: '#8fa3c2', // wisp: pale drifting mote
  g: '#3a3550', d: '#221f30', // gloom: squat dark blob (light-eater)
  c: '#8fe8e0', m: '#4bb0a8', s: '#256b66', // shard: angular crystal
  e: '#6a4a7a', f: '#40304e', // echo: tall thin wraith
  r: '#7a2f3a', n: '#4a1a22', a: '#c98a3f', // rival: dark mirror of the player + amber eyes
};
function esprite(key, rows) { return { key, rows, palette: ENEMY_PALETTE }; }

export const ENEMY_SPRITES = {
  wisp: esprite('e-wisp', [
    '..vwwwwv..',
    '.vwwwwwwv.',
    'vwww..wwwv',
    'vwwwwwwwwv',
    'vwwwwwwwwv',
    '.vwwwwwwv.',
    '..vwwwwv..',
    '...vwwv...',
    '....vv....',
    '..........',
  ]),
  gloom: esprite('e-gloom', [
    '.dggggggd.',
    'dggggggggd',
    'dgg....ggd',
    'dggggggggd',
    'dggggggggd',
    'dggggggggd',
    'dggggggggd',
    '.dggggggd.',
    '..dgggd...',
    '...dggd...',
  ]),
  shard: esprite('e-shard', [
    '....cc....',
    '...cccc...',
    '..cmmmmc..',
    '.cmmssmmc.',
    'cmmssssmmc',
    'cmmssssmmc',
    '.cmmssmmc.',
    '..cmmmmc..',
    '...cccc...',
    '....cc....',
  ]),
  echo: esprite('e-echo', [
    '...eeee...',
    '..e....e..',
    '..e.ff.e..',
    '.effffffe.',
    '.eeeeeeee.',
    '.effffffe.',
    '..e....e..',
    '..e.ff.e..',
    '...e..e...',
    '....ee....',
  ]),
  rival: esprite('e-rival', [
    '..rrrrrr..',
    '.rrrrrrrr.',
    'rr.a..a.rr',
    'rrrrrrrrrr',
    'nrrrrrrrrn',
    'nnrrrrrrnn',
    '.nnrrrrnn.',
    '.nnrrrrnn.',
    '..nn..nn..',
    '..nn..nn..',
  ]),
};

// Ground/wall tile variants for the `world` sprite facet.
const TILE_PALETTE = {
  g: '#232c1f', h: '#2a3524', f: '#1d2519', // ashen ground: base, variant, fleck
  w: '#4a5578', x: '#394260', // ridge wall stone: base, alt
};
export const TILE_SPRITES = {
  groundA: { key: 't-groundA', rows: ['gggg', 'ghgg', 'gggf', 'gggg'], palette: TILE_PALETTE },
  groundB: { key: 't-groundB', rows: ['hggg', 'ggfg', 'gggh', 'gggg'], palette: TILE_PALETTE },
  wall: { key: 't-wall', rows: ['wwww', 'wxwx', 'wwww', 'xwxw'], palette: TILE_PALETTE },
};

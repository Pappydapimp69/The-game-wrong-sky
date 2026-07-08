// CONTENT — pure data, no functions. This is the authoring surface: adding a
// quest, enemy, NPC, item, well, or archetype is an edit HERE and nowhere else.
// Objective TYPES (kill / collect / reach / attune) are the code/content seam —
// a new type is a reducer case; a new instance is data. Every id is validated
// by the smoke ladder (schema -> referential integrity -> completability ->
// headless playthrough), so a typo fails the build, not the player.
//
// WRONG SKY (saga game 2). The Prologue ended "the sky is the wrong color."
// This world is DRAINED — flat Phase-1 blocks, no sprites, no shadows, no
// sound — and the signature system is restoring it, one graphic LAYER at a
// time, by attuning wells. Wells are ALWAYS present and interactable; ATTUNE
// only has a real effect on the well matching the currently active quest's
// facet — any other well gives a vague, in-fiction non-effect hint (never an
// error), which is the discovery hook. The chain:
//   1. hear-the-world   -> resonance well -> audio
//   2-4. a branching 3-way/2-way/1-way choice (a philosophical prompt from
//        Sable), each pick attunes ONE of {player, world, enemies} sprites
//   5. the finale quest -> the light well -> occlusion/shadows + Y-sort depth
//      AND a ~7s hue-cycle "kaleidoscope" reveal of full color for whatever
//      sprite layers are already on (presentation only)
// The completion ORDER of picks 2-4 is recorded (state.flags.revealOrder) so
// quest 4's and quest 5's text are sensitive to the full permutation chosen.

export const CONTENT = {
  version: 3,

  archetypes: {
    brawler: {
      name: 'Brawler',
      blurb: 'Fists first. Questions later.',
      hp: 26, aura: 9,
      skills: { melee: 2, aura: 1, perception: 1 },
    },
    channeler: {
      name: 'Channeler',
      blurb: 'The aura answers those who listen.',
      hp: 20, aura: 15,
      skills: { melee: 1, aura: 2, perception: 1 },
    },
    seeker: {
      name: 'Seeker',
      blurb: 'Sees what others miss.',
      hp: 22, aura: 11,
      skills: { melee: 1, aura: 1, perception: 2 },
    },
  },
  defaultArchetype: 'brawler',

  items: {
    tonic: { name: 'Tonic', price: 3, heal: 5 },
    emberdraught: { name: 'Emberdraught', price: 6, heal: 11 },
    'lens-shard': { name: 'Lens Shard', keyItem: 1 },
  },

  enemyKinds: {
    wisp: { name: 'Palewisp', hp: 8, power: 2, senseReq: 2 },
    gloom: { name: 'Gloomhide', hp: 10, power: 2, senseReq: 2, immune: 'aura' },
    shard: { name: 'Shardling', hp: 10, power: 3, senseReq: 2, immune: 'melee' },
    echo: { name: 'Hollow Echo', hp: 14, power: 3, senseReq: 3 },
    rival: { name: 'The Second', hp: 40, power: 4, senseReq: 3 },
  },

  regions: {
    'palewash-reach': {
      name: 'Palewash Reach',
      w: 40, h: 24,
      spawn: { x: 3, y: 12 },
      // Opacity 0-100 per blocked tile: how strongly it occludes light/sight.
      // A wall at 100 fully blocks line-of-sight and casts a total shadow;
      // future partial occluders (foliage, glass) would use a lower value.
      // Collision itself is binary (any entry blocks MOVE) — opacity only
      // governs the visibility/lighting system, not movement.
      blocked: {
        '16,9': 100, '16,10': 100, '16,11': 100,
        '16,13': 100, '16,14': 100, '16,15': 100,
      },
      npcs: {
        sable: {
          x: 5, y: 12, name: 'Sable', offers: 'hear-the-world',
          dialog: [
            'You came out of the vale under a sky the wrong colour. So did I, once.',
            'The Reach isn’t just colourless — it hasn’t learned to BE anything yet. No sound, no shape, no shadow.',
            'The wells still hold what this place forgot. Attune the right one and it remembers.',
          ],
        },
        keeper: {
          x: 5, y: 15, name: 'Wanderer’s Cache', shop: ['emberdraught'],
          dialog: ['Draughts for the road. The Reach eats the unprepared.'],
        },
      },
      enemies: {
        wisp1: { kind: 'wisp', x: 10, y: 5 },
        echo1: { kind: 'echo', x: 30, y: 20 },
        gloom1: { kind: 'gloom', x: 14, y: 12 },
        shard1: { kind: 'shard', x: 22, y: 10 },
      },
      destructibles: {
        crate1: { x: 6, y: 9, coins: 3 },
      },
      pickups: {
        lens1: { x: 26, y: 18, item: 'lens-shard' },
      },
      // Wells: the signature interactable. ALWAYS present (never quest-gated
      // by existence — see reduce.js ATTUNE). `grants` is the facet an
      // attune restores when it matches the active quest; `hint` is the
      // always-visible flavor text shown when it does NOT (a vague, in-
      // fiction clue, never a flat "nothing here").
      wells: {
        resonance: {
          x: 7, y: 12, grants: 'audio',
          hint: 'A stream gently trickles into the water. You almost hear it.',
        },
        playerwell: {
          x: 12, y: 8, grants: 'player',
          hint: 'The water is flat as glass — a perfect, waiting reflection.',
        },
        worldwell: {
          x: 20, y: 16, grants: 'world',
          hint: 'Ripples trace shapes on the surface — a field, a fence, a roof — then smooth away.',
        },
        enemywell: {
          x: 22, y: 5, grants: 'enemies',
          hint: 'Shadows move under the surface that don’t belong to anything standing here.',
        },
        lightwell: {
          x: 28, y: 6, grants: 'light',
          hint: 'The water holds no reflection at all — as if it’s still waiting for something to show it light.',
        },
      },
      zones: {
        'rift-edge': { x: 35, y: 12, r: 1 },
        'rift-gate': { x: 39, y: 12, r: 1 },
      },
      boss: { id: 'rival1', kind: 'rival', x: 37, y: 12 },
    },
  },
  startRegion: 'palewash-reach',

  arc: {
    intro: [
      'PALEWASH REACH.',
      'The land east of the vale, under the wrong sky.',
      'Nothing here has finished becoming itself — no sound, no true shape, no shadow.',
      'And somewhere ahead, something that came through wearing your shape anyway.',
    ],
    guide: {
      talk: 'A survivor stands nearby. Speak with Sable.',
      hear: 'A well hums nearby, unheard. Find the one that answers to sound.',
      choose1: 'Sable has a question. Hear her out, then answer.',
      choose2: 'The story isn’t finished. Talk to Sable again.',
      choose3: 'One thread remains. Talk to Sable once more.',
      attune: 'Find the well that answers your last choice, and attune it.',
      finale: 'The story closes. Talk to Sable about what’s left.',
      light: 'The last well waits, dark. Attune it.',
      rift: 'The sky is whole. Walk to the rift’s edge and face what waits.',
      boss: 'It wears your shape. Stand, and settle which of you goes on.',
      choice: 'It kneels, beaten. Decide what you take from it.',
      gate: 'The rift stands open. Step through.',
    },
    bossAppeared: [
      'It rises at the rift’s edge — your stance, your aura, your face gone wrong.',
      '"You made it here too," it says, in your voice. "Only one of us leaves whole."',
    ],
    bossTaunted: [
      'Half-broken, it laughs. "The Firstborn all died alone. Did no one tell you?"',
      'Its aura flares darker — it stops holding back.',
    ],
    finale: [
      'The Second lies still. The wrong sky, mended behind you, holds its new colour.',
      'You did what none of the Firstborn lived to explain — and there was no one to see it.',
      'Beyond the rift, a city burns under a banner you have never seen.',
      'Someone down there has been waiting a very long time for you to arrive.',
    ],
    exportHint: 'Keep this code — Part III will ask for it.',
  },

  // Branching narrative for the 3-way/2-way/1-way sprite choice, keyed by the
  // ordered list of facets picked so far (joined with ','). A player who
  // picks player->world->enemies reads different lines than one who picks
  // enemies->world->player at the SAME step, because the key is the exact
  // order, not the set.
  branch: {
    // Sable's opening scenario — same for everyone, this is the FIRST choice.
    prompt: [
      'Sable: "Before I ask you to fight, I’ll ask you something harder.',
      'If you could only be sure of one thing in a world still forgetting itself —',
      'the one who acts, the one who’s acted upon, or the ones who’d witness either — which would you save first?"',
    ],
    // Human-facing labels/blurbs for the three quest options at the first
    // choice (all three are offered together).
    options: {
      player: { label: 'Self', blurb: 'The one who acts.' },
      world: { label: 'World', blurb: 'The one acted upon.' },
      enemies: { label: 'Others', blurb: 'The ones who’d witness either.' },
    },
    // Sable's reaction after the FIRST pick (keyed by that one facet) —
    // shown when she next offers the remaining two.
    afterFirst: {
      player: ['"Yourself, then." A pause. "Most do. Let’s see if the Reach agrees."'],
      world: ['"The world, before yourself." She studies you. "That’s rarer than you’d think."'],
      enemies: ['"Others, before you’ve even met them." Something in her posture eases, just slightly.'],
    },
    // Sable's reaction after the SECOND pick (keyed by "first,second") —
    // shown when she offers the last, forced option.
    afterSecond: {
      'player,world': ['"Yourself, then the world. Nothing left to choose — only one voice hasn’t spoken yet."'],
      'player,enemies': ['"Yourself, then others. The world comes last, whether you meant that or not."'],
      'world,player': ['"The world, then yourself. You circled back. Most don’t."'],
      'world,enemies': ['"The world, then others — and yourself dead last. That’s a shape, Sable says. Not a flaw."'],
      'enemies,player': ['"Others, then yourself. You went outward before you went in."'],
      'enemies,world': ['"Others, then the world. You’re still the one thing you haven’t chosen."'],
    },
    // The finale quest's closing text, keyed by the FULL ordered permutation
    // (three facets, joined). Shown when Sable offers the light-well quest.
    finale: {
      'player,world,enemies': ['"Self, world, others — in that order." Sable nods slowly. "You build outward. So will this place."'],
      'player,enemies,world': ['"Self, others, world." She tilts her head. "You go from the center out — and never quite arrive."'],
      'world,player,enemies': ['"World, self, others." Sable: "You needed to know the ground before you’d trust your own feet."'],
      'world,enemies,player': ['"World, others, self — you came last, on purpose." A thin smile. "The Reach will remember that."'],
      'enemies,player,world': ['"Others, self, world." She considers you. "You went out, then in, then out again. Restless."'],
      'enemies,world,player': ['"Others, world, self — yourself, dead last, every time." Sable: "That will cost you eventually. Not today."'],
    },
  },

  quests: {
    'hear-the-world': {
      name: 'Hear the World',
      giver: 'sable',
      objectives: [{ type: 'attune', facet: 'audio' }],
      reward: { coins: 4 },
    },
    'reveal-player': {
      name: 'Self',
      giver: 'sable',
      requires: ['hear-the-world'],
      objectives: [{ type: 'attune', facet: 'player' }],
      reward: { coins: 5 },
    },
    'reveal-world': {
      name: 'World',
      giver: 'sable',
      requires: ['hear-the-world'],
      objectives: [{ type: 'attune', facet: 'world' }],
      reward: { coins: 5 },
    },
    'reveal-enemies': {
      name: 'Others',
      giver: 'sable',
      requires: ['hear-the-world'],
      objectives: [{ type: 'attune', facet: 'enemies' }],
      reward: { coins: 5 },
    },
    'mend-the-sky-finale': {
      name: 'Mend the Sky',
      giver: 'sable',
      requires: ['reveal-player', 'reveal-world', 'reveal-enemies'],
      // Kept from the original design: a real quest, new enemies/pickup, and
      // the reach objective that gates the rival's spawn (see arcObserve).
      objectives: [
        { type: 'kill', target: 'gloom', n: 1 },
        { type: 'kill', target: 'shard', n: 1 },
        { type: 'collect', item: 'lens-shard' },
        { type: 'attune', facet: 'light' },
        { type: 'reach', zone: 'rift-edge' },
      ],
      reward: { coins: 14 },
      // Enemies/pickup stay existence-gated (E9: don't exist before accept,
      // so completion is agnostic of prior actions) — unlike wells, which are
      // now always present and gated on EFFECT, not existence.
      unlocks: { enemies: ['gloom1', 'shard1'], pickups: ['lens1'] },
    },
  },
};

// CONTENT — pure data, no functions. This is the authoring surface: adding a
// quest, enemy, NPC, item, well, or archetype is an edit HERE and nowhere else.
// Objective TYPES (kill / collect / reach / attune) are the code/content seam —
// a new type is a reducer case; a new instance is data. Every id is validated
// by the smoke ladder (schema -> referential integrity -> completability ->
// headless playthrough), so a typo fails the build, not the player.
//
// WRONG SKY (saga game 2). The Prologue ended "the sky is the wrong color."
// This world is DRAINED — colorless, lightless, flat — and the signature
// system is restoring it: attune the wells to bring back color, then light,
// then depth (three authoritative visual facets), plus a standalone resonance
// well that switches on sound. All of it is gameplay progression the renderer
// reads; none of it is a settings menu.

export const CONTENT = {
  version: 2,

  archetypes: {
    // Identity is front-loaded by template; growth is use-based afterward.
    // Same three paths as the Prologue so a saga.v1 carryover code maps cleanly.
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
    // senseReq: perception level needed to read exact HP/power (the scouter as
    // an earned skill, not a gadget).
    // immune: an attack KIND ('melee' | 'aura') this enemy takes 0 damage from
    // — a generic, reusable resistance field. Absent = no immunity.
    // Things born of the wrong sky: the Hollow. Two of them mirror the
    // Prologue's iron/ward husks — one shrugs off aura, one shrugs off fists —
    // so the "bring both methods" lesson carries into the new bestiary.
    wisp: { name: 'Palewisp', hp: 8, power: 2, senseReq: 2 },
    gloom: { name: 'Gloomhide', hp: 10, power: 2, senseReq: 2, immune: 'aura' }, // light-eater: only fists land
    shard: { name: 'Shardling', hp: 10, power: 3, senseReq: 2, immune: 'melee' }, // crystalline: only aura shatters it
    echo: { name: 'Hollow Echo', hp: 14, power: 3, senseReq: 3 },
    // The rival — "the Second." Another survivor of the Firstborn change, with
    // no teacher either. The finale of game 2 and the seed of game 3's rival AI.
    rival: { name: 'The Second', hp: 40, power: 4, senseReq: 3 },
  },

  regions: {
    'palewash-reach': {
      name: 'Palewash Reach',
      w: 40, h: 24,
      spawn: { x: 3, y: 12 },
      // A blocked ridge with a gap at y=12 — proves collision without ever
      // sitting in the demo's east–west travel lane (the gap is the lane).
      blocked: ['16,9', '16,10', '16,11', '16,13', '16,14', '16,15'],
      npcs: {
        sable: {
          x: 5, y: 12, name: 'Sable', offers: 'mend-the-sky',
          dialog: [
            'You came out of the vale under a sky the wrong colour. So did I, once.',
            'The Reach is drained — colour, light, depth, sound, all of it pulled thin.',
            'The wells still hold what the sky lost. Attune them and the world remembers.',
            'Something else came through ahead of you. It waits at the rift. It looks... like you.',
          ],
        },
        keeper: {
          x: 5, y: 15, name: 'Wanderer’s Cache', shop: ['emberdraught'],
          dialog: ['Draughts for the road. The Reach eats the unprepared.'],
        },
      },
      enemies: {
        // Free-roam (not quest-gated) — always here for exploration/combat and
        // as stable targets for mechanic-only tests.
        wisp1: { kind: 'wisp', x: 10, y: 5 },
        echo1: { kind: 'echo', x: 30, y: 20 },
        // Quest-gated: don't exist until "Mend the Sky" is accepted (E9).
        gloom1: { kind: 'gloom', x: 14, y: 12 },
        shard1: { kind: 'shard', x: 22, y: 10 },
      },
      destructibles: {
        crate1: { x: 6, y: 9, coins: 3 },
      },
      pickups: {
        // Quest-gated key item.
        lens1: { x: 26, y: 18, item: 'lens-shard' },
      },
      // Wells: the signature interactable. `grants` is the facet restored on
      // attune — 'color'|'light'|'depth' set an authoritative visual facet;
      // 'audio' flips the sound flag. The three visual wells are quest-gated
      // (Sable reveals them); the resonance well is always present so sound can
      // be switched on any time, independent of the quest.
      wells: {
        resonance: { x: 7, y: 12, grants: 'audio' },
        colorwell: { x: 12, y: 8, grants: 'color' },
        lightwell: { x: 20, y: 16, grants: 'light' },
        depthwell: { x: 28, y: 6, grants: 'depth' },
      },
      zones: {
        'rift-edge': { x: 35, y: 12, r: 1 },
        'rift-gate': { x: 39, y: 12, r: 1 },
      },
      // The rival does NOT exist at world start — it spawns once the sky is
      // mended and the player reaches the rift's edge.
      boss: { id: 'rival1', kind: 'rival', x: 37, y: 12 },
    },
  },
  startRegion: 'palewash-reach',

  // The chapter's TEXT lives here (presentation reads it); the MECHANICS live
  // in the sim (reduce.js) because the exit gate and facet flags are
  // authoritative. Guide lines are shown one at a time.
  arc: {
    intro: [
      'PALEWASH REACH.',
      'The land east of the vale, under the wrong sky.',
      'Everything here is thin — the colour, the light, the very depth of things.',
      'And somewhere ahead, something that came through wearing your shape.',
    ],
    guide: {
      talk: 'A survivor stands nearby. Speak with Sable.',
      quest: 'Consider Sable’s offer — mend the sky, or wander. Your call.',
      resonance: 'A resonance well hums faintly. Attune it — let the world sound again.',
      color: 'A colour well waits to the north. Attune it and the grey lifts.',
      light: 'Fists only for the Gloomhide; aura only for the Shardling. Then attune the light well.',
      depth: 'The depth well lies east past the ridge. Attune it — let the world stand up.',
      collect: 'A lens shard glints to the south. Take it.',
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

  quests: {
    'mend-the-sky': {
      name: 'Mend the Sky',
      giver: 'sable',
      // Comprehensive on purpose — every objective type appears once, and each
      // target is quest-gated (unlocks below) so completion can never depend on
      // anything the player did before accepting (Prologue lesson E9).
      objectives: [
        { type: 'attune', facet: 'color' },
        { type: 'kill', target: 'gloom', n: 1 },   // light-eater: melee only
        { type: 'kill', target: 'shard', n: 1 },   // crystalline: aura only
        { type: 'attune', facet: 'light' },
        { type: 'collect', item: 'lens-shard' },
        { type: 'attune', facet: 'depth' },
        { type: 'reach', zone: 'rift-edge' },
      ],
      reward: { coins: 14 },
      unlocks: {
        enemies: ['gloom1', 'shard1'],
        pickups: ['lens1'],
        wells: ['colorwell', 'lightwell', 'depthwell'],
      },
    },
  },
};

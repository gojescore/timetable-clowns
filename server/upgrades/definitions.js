// server/upgrades/definitions.js
// Data-only list. Tweak names + costs + effect tuning here.
//
// Slot model:
// - Permanents: stored in permSlots (max 3 types). Stacking allowed via count.
//   Paying acquireCost each time you select/buy (server/index.js enforces money).
// - Consumables: stored in consSlots (max 3). Hotkeys: 8/9/0. No duplicates.
//   Paying useCost each time you use (server/index.js enforces money).
//
// IMPORTANT (matches apply.js):
// - Permanent effects are defined via `effect` and applied by computePlayerMods().
// - apply.js supports these permanent effect types:
//     - speed_mult        (multiplier per stack)
//     - fov_add           (+degrees per stack)
//     - vision_len_add    (+pixels per stack)
//
// Locked mods contract is enforced in apply.js:
//   computePlayerMods() -> { speedMult, visionLenAdd, fovAddDeg }

const UPGRADES = [
  // ---------- Permanent (stacking, costs on acquisition) ----------
  {
    id: "xl_shoes",
    name: "XL Shoes",
    kind: "permanent",
    acquireCost: 150,
    desc: "Move faster.",
    effect: {
      type: "speed_mult",
      // Each stack multiplies speed by this factor.
      // Example: count=1 => 1.12, count=2 => 1.12^2 = 1.254, etc.
      perStackMult: 1.12,
      maxStacks: 6, // soft cap to prevent silliness
    },
  },

  // NOTE: id is "big_eyes" but name is shown as "Glasses" in UI.
  {
    id: "big_eyes",
    name: "Glasses",
    kind: "permanent",
    acquireCost: 150,
    desc: "Wider view cone.",
    effect: {
      type: "fov_add",
      addDegPerStack: 10,
      maxStacks: 6,
    },
  },

  {
    id: "giraffoscope",
    name: "Giraffoscope",
    kind: "permanent",
    acquireCost: 150,
    desc: "See further.",
    effect: {
      type: "vision_len_add",
      addPxPerStack: 80,
      maxStacks: 10,
    },
  },

  // ---------- Consumable (action slots 8/9/0) ----------
  {
    id: "cake_surprise",
    name: "Cake Surprise",
    kind: "consumable",
    useCost: 100,
    desc: "Place a mine on roads.",
    effect: {
      type: "spawn_mine",
      radius: 26,
      triggerRadius: 100, // 2× trigger
      blastRadius: 180, // 2× blast
      damage: 1,
      ttlSec: 25,
      armDelaySec: 0.6,
    },
  },

  {
    id: "rubber_chicken",
    name: "Rubber Chicken",
    kind: "consumable",
    useCost: 100,
    desc: "Fast dash forward (brief invuln).",
    effect: {
      type: "dash",
      dashSpeedMult: 2.2, // multiply PLAYER_SPEED during dash window
      durationSec: 0.7,
      invulnDuring: true,
      internalCooldownSec: 0.8,
    },
  },

  {
    id: "banana_shot",
    name: "Banana Shot",
    kind: "consumable",
    useCost: 100,
    desc: "Shoot a ricochet banana.",
    effect: {
      type: "banana_shot",
      speed: 860,
      ttlSec: 1.6,
      bounces: 3,
      hitRadiusPlayer: 12,
    },
  },

{
  id: "big_nose",
  name: "Big Nose",
  kind: "permanent",
  acquireCost: 250,
  desc: "Blocks ONE lethal cake shot, then falls off. (Bullets only)",
},

  {
  id: "jack_in_the_box",
  name: "Jack in the Box",
  kind: "consumable",
  useCost: 150,
  desc: "Place a JackBox that reveals fog in an area for the rest of the match.",
  effect: {
    type: "jack_box_reveal",
    revealRadius: 260,   // tweak
    ttlSec: 999999,      // “throughout the game” (we can also treat as infinite)
    maxActivePerPlayer: 1, // prevents spam; optional but recommended
  },
},

{
  id: "balloon",
  name: "Balloon",
  kind: "consumable",
  useCost: 150,
  desc: "Float through walls briefly. If you end inside a wall, you die.",
  effect: {
    type: "balloon_phase",
    preStunSec: 0.5,
    phaseSec: 2.0,
    postStunSec: 0.5,
  },
},


];

function getUpgradeById(id) {
  const key = String(id || "");
  return UPGRADES.find((u) => String(u.id) === key) || null;
}

module.exports = { UPGRADES, getUpgradeById };

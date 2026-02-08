// server/upgrades/definitions.js
// Data-only list. Tweak names + costs + effect tuning here.
//
// Slot model:
// - Permanents: 3 reserved slots (stacking allowed via count), pay acquireCost each time.
// - Consumables: 3 action slots (8/9/0), no duplicates, pay useCost each time you use.
//
// IMPORTANT (matches apply.js):
// - XL Shoes uses effect.type="speed_mult" (generic).
// - Big Eyes + Giraffoscope are computed by explicit mapping inside apply.js
//   (to keep the mods contract locked and avoid double-counting).
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
  {
    id: "big_eyes",
    name: "Glasses",
    kind: "permanent",
    acquireCost: 150,
    desc: "Wider view cone.",
    // NOTE: no effect here on purpose.
    // apply.js adds fovAddDeg per stack for big_eyes.
  },
  {
    id: "giraffoscope",
    name: "Giraffoscope",
    kind: "permanent",
    acquireCost: 150,
    desc: "See further.",
    // NOTE: no effect here on purpose.
    // apply.js adds visionLenAdd (pixels) per stack for giraffoscope.
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
  type: "spawn_mine",
  radius: 26,
  triggerRadius: 64, // 2× trigger
  blastRadius: 180,  // 2× blast
  damage: 1,
  ttlSec: 25,
  armDelaySec: 0.6,
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
    kind: "consumable",
    useCost: 0,
    desc: "+1 shield (blocks one death).",
    effect: {
      type: "shield_add",
      amount: 1,
      maxShield: 3,
    },
  },
];

function getUpgradeById(id) {
  const key = String(id || "");
  return UPGRADES.find((u) => u.id === key) || null;
}

module.exports = { UPGRADES, getUpgradeById };

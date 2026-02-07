// server/upgrades/definitions.js
// Data-only list. Tweak names + costs + effect tuning here.
//
// Slot model:
// - Permanents: 3 reserved slots (stacking allowed via count), pay acquireCost each time.
// - Consumables: 3 action slots (8/9/0), no duplicates, pay useCost each time you use.
//
// Effects model (new):
// - Permanents contribute to computed player "mods" (speed/fov/vision etc).
// - Consumables define effectType + params, executed by upgrades module when used.

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
    effect: {
      type: "fov_add",
      // Add radians to the view cone half-angle (or whatever you use client-side).
      // Tune based on your current fog cone implementation.
      addRadiansPerStack: 0.18,
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
      type: "vision_mult",
      // Multiply vision distance / fog reveal radius.
      perStackMult: 1.15,
      maxStacks: 6,
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
      // Mine behavior is server-owned; client just renders it from snapshot later.
      // You can start by making mines explode on contact or proximity.
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
      type: "dash",
      dashSpeedMult: 2.2,  // multiply PLAYER_SPEED during dash window
      durationSec: 0.35,
      invulnDuring: true,
      // Optional: small cooldown inside the effect system (separate from FIRE_COOLDOWN)
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
      // You can implement as a special bullet that bounces N times on walls/machines.
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
      // Optional: cap shields to prevent hoarding
      maxShield: 3,
    },
  },
];

function getUpgradeById(id) {
  const key = String(id || "");
  return UPGRADES.find((u) => u.id === key) || null;
}

module.exports = { UPGRADES, getUpgradeById };

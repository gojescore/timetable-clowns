// server/upgrades/definitions.js
// Data-only list. Tweak names + costs here.
//
// RULES:
// - Non-permanent upgrades (kind:"consumable") live in max 3 slots.
//   They do NOT have uses; each activation costs money (useCost).
//   You cannot hold duplicates of the same consumable id.
// - Permanent upgrades (kind:"permanent") CAN stack (duplicates allowed),
//   but they cost money upon acquisition (acquireCost).

const UPGRADES = [
  // ---------- Permanent (stacking, costs on acquisition) ----------
  {
    id: "xl_shoes",
    name: "XL Shoes",
    kind: "permanent",
    acquireCost: 150,
    desc: "Move faster. (effect later)",
  },
  {
    id: "big_eyes",
    name: "Big Eyes",
    kind: "permanent",
    acquireCost: 150,
    desc: "Wider view cone. (effect later)",
  },
  {
    id: "giraffoscope",
    name: "Giraffoscope",
    kind: "permanent",
    acquireCost: 150,
    desc: "See further. (effect later)",
  },

  // ---------- Non-permanent / slot-based ----------
  // NOTE: held in max 3 slots. Using costs money (useCost).
  {
    id: "cake_surprise",
    name: "Cake Surprise",
    kind: "consumable",
    useCost: 100,
    desc: "Place a mine on roads. (effect later)",
  },
  {
    id: "rubber_chicken",
    name: "Rubber Chicken",
    kind: "consumable",
    useCost: 100,
    desc: "Fast melee dash. (effect later)",
  },
  {
    id: "banana_shot",
    name: "Banana Shot",
    kind: "consumable",
    useCost: 100,
    desc: "Ricochet bananas. (effect later)",
  },
  {
    id: "big_nose",
    name: "Big Nose",
    kind: "consumable",
    useCost: 0,
    desc: "+1 life shield. (effect later)",
  },
];

function getUpgradeById(id) {
  const key = String(id || "");
  return UPGRADES.find((u) => u.id === key) || null;
}

module.exports = { UPGRADES, getUpgradeById };

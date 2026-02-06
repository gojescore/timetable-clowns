// server/upgrades/definitions.js
// Data-only list. Tweak names + costs here.
//
// Slot model:
// - Permanents: 3 reserved slots (stacking allowed via count), pay acquireCost each time.
// - Consumables: 3 action slots (8/9/0), no duplicates, pay useCost each time you use.

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

  // ---------- Consumable (action slots 8/9/0) ----------
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

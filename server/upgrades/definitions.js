// server/upgrades/definitions.js
// Data-only list. Tweak names, costs, maxUses here.

const UPGRADES = [
  // ---------- Permanent (no uses) ----------
  {
    id: "xl_shoes",
    name: "XL Shoes",
    kind: "permanent",
    desc: "Move faster. (effect later)",
  },
  {
    id: "big_eyes",
    name: "Big Eyes",
    kind: "permanent",
    desc: "Wider view cone. (effect later)",
  },
  {
    id: "giraffoscope",
    name: "Giraffoscope",
    kind: "permanent",
    desc: "See further. (effect later)",
  },

  // ---------- Non-permanent / consumable ----------
  // NOTE: non-permanent upgrades are held in max 3 slots (keys later).
  {
    id: "cake_surprise",
    name: "Cake Surprise",
    kind: "consumable",
    maxUses: 3,
    useCost: 100,
    desc: "Place a mine on roads. (effect later)",
  },
  {
    id: "rubber_chicken",
    name: "Rubber Chicken",
    kind: "consumable",
    maxUses: 3,
    useCost: 100,
    desc: "Fast melee dash. (effect later)",
  },
  {
    id: "banana_shot",
    name: "Banana Shot",
    kind: "consumable",
    maxUses: 3,
    useCost: 100,
    desc: "Ricochet bananas. (effect later)",
  },
  {
    id: "big_nose",
    name: "Big Nose",
    kind: "consumable",
    maxUses: 1, // disappears after first hit (later)
    useCost: 0, // acquiring is free; using is automatic on hit later
    desc: "+1 life shield. (effect later)",
  },
];

function getUpgradeById(id) {
  const key = String(id || "");
  return UPGRADES.find((u) => u.id === key) || null;
}

module.exports = { UPGRADES, getUpgradeById };

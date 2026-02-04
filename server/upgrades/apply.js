// server/upgrades/apply.js
// Minimal rules for storing upgrades + offering from a fixed pool.
// Effects come later.

// Optional constants import (keeps your structure, but prevents crash if file isn't there)
let C = { MAX_NONPERM_SLOTS: 3 };
try {
  C = require("../shared/constants");
} catch (_) {
  // fallback stays at 3
}

// IMPORTANT: Avoid destructuring at module load time (helps with circular deps / export shape changes).
function defs() {
  return require("./definitions");
}

function getAllUpgradesSafe() {
  const d = defs();

  // Support multiple shapes:
  // - module.exports = { UPGRADES: [...] }
  // - module.exports = { default: { UPGRADES:[...] } }
  // - module.exports = { getAllUpgrades(){...} }
  if (Array.isArray(d.UPGRADES)) return d.UPGRADES;
  if (d.default && Array.isArray(d.default.UPGRADES)) return d.default.UPGRADES;

  if (typeof d.getAllUpgrades === "function") {
    const arr = d.getAllUpgrades();
    if (Array.isArray(arr)) return arr;
  }

  return [];
}

function getUpgradeByIdSafe(id) {
  const d = defs();
  if (typeof d.getUpgradeById === "function") return d.getUpgradeById(id);
  if (d.default && typeof d.default.getUpgradeById === "function") return d.default.getUpgradeById(id);
  return null;
}

function ensureUpgradeState(player) {
  if (!player.upgrades) {
    player.upgrades = {
      permanent: [], // array of ids
      slots: [],     // array of { id, usesLeft }
    };
  }
  if (!Array.isArray(player.upgrades.permanent)) player.upgrades.permanent = [];
  if (!Array.isArray(player.upgrades.slots)) player.upgrades.slots = [];
}

// ✅ Pick a fixed set of N upgrades ONCE per match (returns UPGRADE OBJECTS, not ids)
function pickRandomUpgradePool(count = 9) {
  const all = getAllUpgradesSafe();
  const want = Math.max(1, Math.min(Math.floor(Number(count) || 9), all.length));

  // Fisher–Yates shuffle copy, then take first N
  const arr = all.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr.slice(0, want);
}

// ✅ Build offer options from:
// - pool of upgrade objects (recommended)
// - list of ids (legacy)
// - null/empty => fallback to ALL upgrades
// GUARANTEE: if pool/ids resolve to empty, fallback to ALL upgrades
function buildOfferOptions(poolOrIds = null) {
  const all = getAllUpgradesSafe();
  let list = [];

  // A) pool of objects
  if (Array.isArray(poolOrIds) && poolOrIds.length && typeof poolOrIds[0] === "object") {
    list = poolOrIds.filter((u) => u && u.id);
  }

  // B) list of ids
  if (Array.isArray(poolOrIds) && poolOrIds.length && typeof poolOrIds[0] !== "object") {
    const wanted = poolOrIds.map(String);
    const byId = new Map(all.map((u) => [u.id, u]));
    for (const id of wanted) {
      const u = byId.get(id);
      if (u) list.push(u);
    }
  }

  // fallback
  if (!Array.isArray(list) || list.length === 0) list = all;

  return list.map((u) => ({
    id: u.id,
    name: u.name,
    kind: u.kind,
    desc: u.desc || "",
    maxUses: u.maxUses ?? null,
    useCost: u.useCost ?? null,
  }));
}

function getUpgradeInfo(id) {
  const u = getUpgradeByIdSafe(id);
  if (!u) return null;
  return { id: u.id, name: u.name, kind: u.kind, desc: u.desc || "" };
}

function canTakeUpgrade(player, upgrade) {
  ensureUpgradeState(player);

  if (upgrade.kind === "permanent") {
    // no duplicates
    if (player.upgrades.permanent.includes(upgrade.id)) {
      return { ok: false, reason: "already_have" };
    }
    return { ok: true };
  }

  // consumable / non-permanent:
  // add to empty slot first (no refresh)
  const maxSlots = Number.isFinite(C.MAX_NONPERM_SLOTS) ? C.MAX_NONPERM_SLOTS : 3;
  if (player.upgrades.slots.length >= maxSlots) {
    return { ok: false, reason: "slots_full" };
  }

  return { ok: true, mode: "add_new" };
}

function applyUpgradeSelection(player, upgradeId) {
  ensureUpgradeState(player);

  const up = getUpgradeByIdSafe(upgradeId);
  if (!up) return { ok: false, reason: "invalid_upgrade" };

  const check = canTakeUpgrade(player, up);
  if (!check.ok) return { ok: false, reason: check.reason };

  if (up.kind === "permanent") {
    player.upgrades.permanent.push(up.id);
    return { ok: true, applied: { kind: "permanent", id: up.id } };
  }

  const maxUses = Number.isFinite(up.maxUses) ? up.maxUses : 1;
  player.upgrades.slots.push({ id: up.id, usesLeft: maxUses });

  return {
    ok: true,
    applied: { kind: "consumable_add", id: up.id, usesLeft: maxUses },
  };
}

module.exports = {
  ensureUpgradeState,
  pickRandomUpgradePool,
  buildOfferOptions,
  applyUpgradeSelection,
  getUpgradeInfo,
};

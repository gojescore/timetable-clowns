// server/upgrades/apply.js
// Minimal rules for storing upgrades + offering from a fixed pool.
// Effects come later.

let C = { MAX_NONPERM_SLOTS: 3 };
try {
  C = require("../shared/constants");
} catch (_) {
  // fallback stays at 3
}

// IMPORTANT: avoid destructuring at module load time (helps with circular deps).
function defs() {
  return require("./definitions");
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

function getUpgradeByIdSafe(id) {
  const d = defs();
  return typeof d.getUpgradeById === "function" ? d.getUpgradeById(id) : null;
}

function getAllUpgradesSafe() {
  const d = defs();
  return Array.isArray(d.UPGRADES) ? d.UPGRADES : [];
}

// ✅ NEW: pick a fixed set of N upgrades ONCE per match (no duplicates)
function pickRandomUpgradePool(n) {
  const all = getAllUpgradesSafe();
  const size = Math.max(0, Math.min(all.length, Math.floor(Number(n) || 0)));

  // Fisher–Yates shuffle copy
  const arr = all.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, size);
}

// ✅ Build offer options from a provided pool (the fixed 9)
function buildOfferOptions(pool) {
  const list = Array.isArray(pool) && pool.length ? pool : getAllUpgradesSafe();

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

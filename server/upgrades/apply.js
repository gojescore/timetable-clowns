// server/upgrades/apply.js
// Rules for storing upgrades + offering from a fixed pool.
// Effects come later.
//
// IMPORTANT RULES:
// - Consumables: max 3 slots, NO duplicates by id.
// - Permanents: stacking allowed (duplicates allowed).
// - Money checks for permanent acquisition are handled by server/index.js,
//   because it owns player.money and event responses.

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
      permanent: [], // array of ids (stacking allowed)
      slots: [], // array of { id } (NO duplicates)
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

// Pick a fixed set of N upgrades ONCE per match (no duplicates)
function pickRandomUpgradePool(n = 9) {
  const all = getAllUpgradesSafe();
  const want = Math.max(0, Math.min(all.length, Math.floor(Number(n) || 0)));

  // Fisher–Yates shuffle copy
  const arr = all.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, want);
}

// Build offer options from a provided pool. If pool missing, fallback to all.
function buildOfferOptions(pool) {
  const list = Array.isArray(pool) && pool.length ? pool : getAllUpgradesSafe();

  return list.map((u) => ({
    id: u.id,
    name: u.name,
    kind: u.kind,
    desc: u.desc || "",
    useCost: Number.isFinite(u.useCost) ? u.useCost : 0,
    acquireCost: Number.isFinite(u.acquireCost) ? u.acquireCost : 0,
  }));
}

function getUpgradeInfo(id) {
  const u = getUpgradeByIdSafe(id);
  if (!u) return null;
  return {
    id: u.id,
    name: u.name,
    kind: u.kind,
    desc: u.desc || "",
    useCost: Number.isFinite(u.useCost) ? u.useCost : 0,
    acquireCost: Number.isFinite(u.acquireCost) ? u.acquireCost : 0,
  };
}

function hasConsumable(player, upgradeId) {
  ensureUpgradeState(player);
  const key = String(upgradeId || "");
  return player.upgrades.slots.some((s) => String(s?.id || "") === key);
}

function canTakeUpgrade(player, upgrade) {
  ensureUpgradeState(player);

  if (upgrade.kind === "permanent") {
    // stacking allowed, money check handled elsewhere
    return { ok: true };
  }

  // consumable: no duplicates
  if (hasConsumable(player, upgrade.id)) {
    return { ok: false, reason: "already_have" };
  }

  const maxSlots = Number.isFinite(C.MAX_NONPERM_SLOTS) ? C.MAX_NONPERM_SLOTS : 3;
  if (player.upgrades.slots.length >= maxSlots) {
    return { ok: false, reason: "slots_full" };
  }
  return { ok: true, mode: "add_new" };
}

// Apply selection when there IS room (or permanent).
// NOTE: permanent stacking allowed; consumable duplicates denied.
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

  player.upgrades.slots.push({ id: up.id });
  return { ok: true, applied: { kind: "consumable_add", id: up.id } };
}

// Replace an existing slot item with the new upgrade (server-enforced).
// Still enforces "no duplicate consumables" across slots.
function applyUpgradeReplace(player, upgradeId, dropId) {
  ensureUpgradeState(player);

  const up = getUpgradeByIdSafe(upgradeId);
  if (!up) return { ok: false, reason: "invalid_upgrade" };
  if (up.kind === "permanent") return { ok: false, reason: "not_consumable" };

  const dropKey = String(dropId || "");
  const idx = player.upgrades.slots.findIndex((s) => String(s?.id || "") === dropKey);
  if (idx === -1) return { ok: false, reason: "drop_not_found" };

  // If trying to "replace" with the same id, treat as already_have (no-op / duplicate)
  if (String(up.id) === dropKey) return { ok: false, reason: "already_have" };

  // Enforce no duplicate consumables in OTHER slots
  const alreadyElsewhere = player.upgrades.slots.some(
    (s, i) => i !== idx && String(s?.id || "") === String(up.id)
  );
  if (alreadyElsewhere) return { ok: false, reason: "already_have" };

  player.upgrades.slots[idx] = { id: up.id };
  return {
    ok: true,
    applied: { kind: "consumable_replace", id: up.id, dropped: dropKey },
  };
}

module.exports = {
  ensureUpgradeState,
  pickRandomUpgradePool,
  buildOfferOptions,
  applyUpgradeSelection,
  applyUpgradeReplace,
  getUpgradeInfo,
};

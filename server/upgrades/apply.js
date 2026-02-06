// server/upgrades/apply.js
// Slot rules for upgrades (effects later).
//
// IMPORTANT MODEL:
// - player.upgrades.permSlots: max 3 entries, each { id, count }.
//   Stacking = increment count for existing id.
// - player.upgrades.consSlots: max 3 entries, each { id }.
//   No duplicates by id.
//
// Money checks:
// - Permanent acquisition cost is enforced in server/index.js (it owns player.money).
// - Consumable use cost is enforced in server/index.js (useUpgradeSlot).

let C = { MAX_PERM_SLOTS: 3, MAX_CONS_SLOTS: 3 };
try {
  const shared = require("../shared/constants");
  if (Number.isFinite(shared.MAX_PERM_SLOTS)) C.MAX_PERM_SLOTS = shared.MAX_PERM_SLOTS;
  if (Number.isFinite(shared.MAX_CONS_SLOTS)) C.MAX_CONS_SLOTS = shared.MAX_CONS_SLOTS;
  // Backward compat if you kept only MAX_NONPERM_SLOTS:
  if (Number.isFinite(shared.MAX_NONPERM_SLOTS)) C.MAX_CONS_SLOTS = shared.MAX_NONPERM_SLOTS;
} catch (_) {
  // defaults stay
}

function defs() {
  return require("./definitions");
}

function ensureUpgradeState(player) {
  if (!player.upgrades) {
    player.upgrades = {
      permSlots: [], // [{id, count}]
      consSlots: [], // [{id}]
    };
  }
  if (!Array.isArray(player.upgrades.permSlots)) player.upgrades.permSlots = [];
  if (!Array.isArray(player.upgrades.consSlots)) player.upgrades.consSlots = [];
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

  const arr = all.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, want);
}

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
  return player.upgrades.consSlots.some((s) => String(s?.id || "") === key);
}

function findPermanentSlot(player, upgradeId) {
  ensureUpgradeState(player);
  const key = String(upgradeId || "");
  return player.upgrades.permSlots.findIndex((s) => String(s?.id || "") === key);
}

function canTakeUpgrade(player, upgrade) {
  ensureUpgradeState(player);

  if (upgrade.kind === "permanent") {
    // stacking always allowed if already present
    const idx = findPermanentSlot(player, upgrade.id);
    if (idx >= 0) return { ok: true, mode: "perm_stack" };

    // otherwise must have a free permanent slot
    const maxPerm = Number.isFinite(C.MAX_PERM_SLOTS) ? C.MAX_PERM_SLOTS : 3;
    if (player.upgrades.permSlots.length >= maxPerm) {
      return { ok: false, reason: "perm_slots_full" };
    }
    return { ok: true, mode: "perm_new" };
  }

  // consumable: no duplicates
  if (hasConsumable(player, upgrade.id)) {
    return { ok: false, reason: "already_have" };
  }

  const maxCons = Number.isFinite(C.MAX_CONS_SLOTS) ? C.MAX_CONS_SLOTS : 3;
  if (player.upgrades.consSlots.length >= maxCons) {
    return { ok: false, reason: "slots_full" };
  }

  return { ok: true, mode: "cons_add" };
}

// Apply selection (storage only).
// Permanent stacking increments count.
// Consumable adds into consSlots (no duplicates).
function applyUpgradeSelection(player, upgradeId) {
  ensureUpgradeState(player);

  const up = getUpgradeByIdSafe(upgradeId);
  if (!up) return { ok: false, reason: "invalid_upgrade" };

  const check = canTakeUpgrade(player, up);
  if (!check.ok) return { ok: false, reason: check.reason };

  if (up.kind === "permanent") {
    const idx = findPermanentSlot(player, up.id);
    if (idx >= 0) {
      const cur = player.upgrades.permSlots[idx];
      cur.count = Number.isFinite(cur.count) ? cur.count + 1 : 2;
      return { ok: true, applied: { kind: "permanent_stack", id: up.id, count: cur.count } };
    }
    player.upgrades.permSlots.push({ id: up.id, count: 1 });
    return { ok: true, applied: { kind: "permanent_new", id: up.id, count: 1 } };
  }

  player.upgrades.consSlots.push({ id: up.id });
  return { ok: true, applied: { kind: "consumable_add", id: up.id } };
}

// Replace a consumable slot item with a new consumable.
// dropId is the EXISTING consumable id to drop.
function applyConsumableReplace(player, upgradeId, dropId) {
  ensureUpgradeState(player);

  const up = getUpgradeByIdSafe(upgradeId);
  if (!up) return { ok: false, reason: "invalid_upgrade" };
  if (up.kind !== "consumable") return { ok: false, reason: "not_consumable" };

  const dropKey = String(dropId || "");
  const idx = player.upgrades.consSlots.findIndex((s) => String(s?.id || "") === dropKey);
  if (idx === -1) return { ok: false, reason: "drop_not_found" };

  if (String(up.id) === dropKey) return { ok: false, reason: "already_have" };

  // enforce no duplicates in other slots
  const alreadyElsewhere = player.upgrades.consSlots.some(
    (s, i) => i !== idx && String(s?.id || "") === String(up.id)
  );
  if (alreadyElsewhere) return { ok: false, reason: "already_have" };

  player.upgrades.consSlots[idx] = { id: up.id };
  return { ok: true, applied: { kind: "consumable_replace", id: up.id, dropped: dropKey } };
}

module.exports = {
  ensureUpgradeState,
  pickRandomUpgradePool,
  buildOfferOptions,
  applyUpgradeSelection,
  applyConsumableReplace,
  getUpgradeInfo,

  // optional helpers if you ever want them elsewhere
  canTakeUpgrade,
  hasConsumable,
  findPermanentSlot,
};

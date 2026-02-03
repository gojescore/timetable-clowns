// server/upgrades/apply.js
// Minimal rules for storing upgrades. Effects come later.

const { UPGRADES, getUpgradeById } = require("./definitions");

// Optional constants import (keeps your structure, but prevents crash if file isn't there)
let C = { MAX_NONPERM_SLOTS: 3 };
try {
  C = require("../shared/constants");
} catch (_) {
  // fallback stays at 3
}

function ensureUpgradeState(player) {
  if (!player.upgrades) {
    player.upgrades = {
      permanent: [], // array of ids
      slots: [], // array of { id, usesLeft }
    };
  }
  if (!Array.isArray(player.upgrades.permanent)) player.upgrades.permanent = [];
  if (!Array.isArray(player.upgrades.slots)) player.upgrades.slots = [];
}

// ----------------------------
// NEW: helper to pick a fixed pool for the whole game
// ----------------------------
function pickRandomUpgradePool(count = 9) {
  const ids = UPGRADES.map((u) => u.id).filter(Boolean);

  // clamp count safely
  const want = Math.max(1, Math.min(Math.floor(Number(count) || 9), ids.length));

  // Fisher-Yates shuffle copy, then take first N
  const arr = ids.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }

  return arr.slice(0, want);
}

// ----------------------------
// Build offer options
// If ids are provided: build from that fixed set (game pool)
// Else: fallback to ALL upgrades (old behavior)
// ----------------------------
function buildOfferOptions(ids = null) {
  let list = UPGRADES;

  if (Array.isArray(ids) && ids.length) {
    // keep only valid ids that exist in definitions
    const wanted = ids.map(String);
    const set = new Set(wanted);

    // preserve the pool order (important so the 3x3 stays consistent)
    const byId = new Map(UPGRADES.map((u) => [u.id, u]));
    const ordered = [];
    for (const id of wanted) {
      const u = byId.get(id);
      if (u) ordered.push(u);
    }

    // if pool had invalids, we still return the valid ones only
    list = ordered.length ? ordered : UPGRADES.filter((u) => set.has(u.id));
  }

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
  const u = getUpgradeById(id);
  if (!u) return null;
  return { id: u.id, name: u.name, kind: u.kind, desc: u.desc || "" };
}

function canTakeUpgrade(player, upgrade) {
  ensureUpgradeState(player);

  if (upgrade.kind === "permanent") {
    // For now: no duplicates
    if (player.upgrades.permanent.includes(upgrade.id)) {
      return { ok: false, reason: "already_have" };
    }
    return { ok: true };
  }

  // consumable / non-permanent:
  // ✅ NEW RULE: taking an upgrade should go into an empty slot first.
  // This means we DO NOT "refresh existing" anymore.
  const maxSlots = Number.isFinite(C.MAX_NONPERM_SLOTS) ? C.MAX_NONPERM_SLOTS : 3;
  if (player.upgrades.slots.length >= maxSlots) {
    return { ok: false, reason: "slots_full" };
  }

  return { ok: true, mode: "add_new" };
}

function applyUpgradeSelection(player, upgradeId) {
  ensureUpgradeState(player);

  const up = getUpgradeById(upgradeId);
  if (!up) return { ok: false, reason: "invalid_upgrade" };

  const check = canTakeUpgrade(player, up);
  if (!check.ok) return { ok: false, reason: check.reason };

  if (up.kind === "permanent") {
    player.upgrades.permanent.push(up.id);
    return { ok: true, applied: { kind: "permanent", id: up.id } };
  }

  // consumable: always add to a new slot (until slots full)
  const maxUses = Number.isFinite(up.maxUses) ? up.maxUses : 1;

  player.upgrades.slots.push({ id: up.id, usesLeft: maxUses });
  return {
    ok: true,
    applied: { kind: "consumable_add", id: up.id, usesLeft: maxUses },
  };
}

module.exports = {
  ensureUpgradeState,
  pickRandomUpgradePool, // ✅ NEW EXPORT
  buildOfferOptions,     // ✅ now supports (ids) or (null => all)
  applyUpgradeSelection,
  getUpgradeInfo,
};

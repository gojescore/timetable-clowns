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

/**
 * ✅ NEW (server/index.js expects this)
 * Pick a pool of N upgrade IDs (unique) that stays fixed for the match.
 */
function pickRandomUpgradePool(n = 9) {
  const list = Array.isArray(UPGRADES) ? UPGRADES : [];
  const ids = list.map((u) => u && u.id).filter(Boolean);

  // unique
  const uniq = Array.from(new Set(ids));

  // shuffle (Fisher–Yates)
  for (let i = uniq.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = uniq[i];
    uniq[i] = uniq[j];
    uniq[j] = t;
  }

  const k = Math.max(0, Math.min(Number(n) || 0, uniq.length));
  return uniq.slice(0, k);
}

/**
 * ✅ UPDATED (server/index.js calls buildOfferOptions(pool))
 * - If called with no args -> offer ALL upgrades (backwards compatible)
 * - If called with an array of IDs -> offer ONLY those (in that order)
 */
function buildOfferOptions(poolIds = null) {
  // If poolIds is provided, map ids -> upgrades, skipping unknown ids.
  if (Array.isArray(poolIds)) {
    const out = [];
    for (const id of poolIds) {
      const u = getUpgradeById(id);
      if (!u) continue;
      out.push({
        id: u.id,
        name: u.name,
        kind: u.kind,
        desc: u.desc || "",
        maxUses: u.maxUses ?? null,
        useCost: u.useCost ?? null,
      });
    }
    return out;
  }

  // Default: ALL upgrades (old behavior)
  return (Array.isArray(UPGRADES) ? UPGRADES : []).map((u) => ({
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
    // no duplicates
    if (player.upgrades.permanent.includes(upgrade.id)) {
      return { ok: false, reason: "already_have" };
    }
    return { ok: true };
  }

  // consumable / non-permanent:
  // taking an upgrade should go into an empty slot first.
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

  const maxUses = Number.isFinite(up.maxUses) ? up.maxUses : 1;

  player.upgrades.slots.push({ id: up.id, usesLeft: maxUses });
  return {
    ok: true,
    applied: { kind: "consumable_add", id: up.id, usesLeft: maxUses },
  };
}

module.exports = {
  ensureUpgradeState,
  pickRandomUpgradePool,   // ✅ required by server/index.js
  buildOfferOptions,       // ✅ accepts optional poolIds array
  applyUpgradeSelection,
  getUpgradeInfo,
};

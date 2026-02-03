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

// -------------------------
// Pool picking (match-wide)
// -------------------------
function shuffleCopy(arr) {
  const a = Array.isArray(arr) ? arr.slice() : [];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

// Returns array of unique upgrade IDs (size <= requested)
function pickRandomUpgradePool(size) {
  const n = Math.max(0, Math.floor(Number(size) || 0));
  const ids = UPGRADES.map((u) => u.id);
  const shuffled = shuffleCopy(ids);
  return shuffled.slice(0, Math.min(n, shuffled.length));
}

// -------------------------
// Offer builder (pool-aware)
// -------------------------
function buildOfferOptions(poolIds) {
  let ids = null;

  if (Array.isArray(poolIds) && poolIds.length) {
    const seen = new Set();
    ids = [];
    for (const x of poolIds) {
      const id = String(x || "");
      if (!id) continue;
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
    if (!ids.length) ids = null;
  }

  const list = ids ? ids.map(getUpgradeById).filter(Boolean) : UPGRADES;

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
    if (player.upgrades.permanent.includes(upgrade.id)) {
      return { ok: false, reason: "already_have" };
    }
    return { ok: true };
  }

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
  buildOfferOptions,
  applyUpgradeSelection,
  getUpgradeInfo,
  pickRandomUpgradePool,
};

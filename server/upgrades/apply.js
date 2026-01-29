// server/upgrades/apply.js
// Minimal rules for storing upgrades. Effects come later.

const { UPGRADES, getUpgradeById } = require("./definitions");
const C = require("../shared/constants");

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

// For now: offer ALL upgrades every time (as per your rule).
function buildOfferOptions() {
  return UPGRADES.map((u) => ({
    id: u.id,
    name: u.name,
    kind: u.kind,
    desc: u.desc || "",
    maxUses: u.maxUses ?? null,
    useCost: u.useCost ?? null,
  }));
}

function canTakeUpgrade(player, upgrade) {
  ensureUpgradeState(player);

  if (upgrade.kind === "permanent") {
    // Allow duplicates? For now: no duplicates
    if (player.upgrades.permanent.includes(upgrade.id)) return { ok: false, reason: "already_have" };
    return { ok: true };
  }

  // consumable / non-permanent
  const existing = player.upgrades.slots.find((s) => s.id === upgrade.id);
  if (existing) {
    // Allow "refresh" uses by taking same upgrade again? For now: refresh to maxUses
    return { ok: true, mode: "refresh_existing" };
  }

  if (player.upgrades.slots.length >= C.MAX_NONPERM_SLOTS) {
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

  // consumable
  const maxUses = Number.isFinite(up.maxUses) ? up.maxUses : 1;

  const existing = player.upgrades.slots.find((s) => s.id === up.id);
  if (existing) {
    existing.usesLeft = maxUses; // refresh
    return { ok: true, applied: { kind: "consumable_refresh", id: up.id, usesLeft: existing.usesLeft } };
  }

  player.upgrades.slots.push({ id: up.id, usesLeft: maxUses });
  return { ok: true, applied: { kind: "consumable_add", id: up.id, usesLeft: maxUses } };
}

module.exports = {
  ensureUpgradeState,
  buildOfferOptions,
  applyUpgradeSelection,
};

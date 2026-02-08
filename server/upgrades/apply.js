// server/upgrades/apply.js
// Slot rules + EFFECT HELPERS.
//
// IMPORTANT MODEL (unchanged):
// - player.upgrades.permSlots: max 3 entries, each { id, count }.
//   Stacking = increment count for existing id.
// - player.upgrades.consSlots: max 3 entries, each { id }.
//   No duplicates by id.
//
// Money checks (unchanged):
// - Permanent acquisition cost is enforced in server/index.js (it owns player.money).
// - Consumable use cost is enforced in server/index.js (useUpgradeSlot).
//
// Effects phase:
// - computePlayerMods(player): deterministic modifiers from permanents + temp effects.
// - ensureEffectState(player): stores temp states like dash/shield.
// - applyConsumableUse(player, upgradeId, ctx): returns "actions" for server to apply.
//
// 🔒 LOCKED CONTRACT (PROTOCOL):
// computePlayerMods() MUST return ONLY:
//   { speedMult, visionLenAdd, fovAddDeg }
// Units:
//   - speedMult: multiplier
//   - visionLenAdd: pixels (additive)
//   - fovAddDeg: degrees (additive)

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

// Temporary effect state (server-owned)
function ensureEffectState(player) {
  if (!player.effects) {
    player.effects = {
      // dash: { untilMs, speedMult, cooldownUntilMs, invulnDuring }
      dash: null,
      // shield points: blocks a death (server decides how)
      shield: 0,
    };
  }
  if (typeof player.effects.shield !== "number") player.effects.shield = 0;
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

// Safe permanent stack count by id
function getPermCount(player, upgradeId) {
  ensureUpgradeState(player);
  const key = String(upgradeId || "");
  const row = player.upgrades.permSlots.find((s) => String(s?.id || "") === key);
  const c = Number.isFinite(row?.count) ? row.count : 0;
  return Math.max(0, Math.floor(c));
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

/* ------------------------------------------------------------------
 * EFFECTS PHASE HELPERS
 * ------------------------------------------------------------------ */

// ✅ Giraffoscope: +80px fog cone length per stack
const VISION_LEN_PER_STACK = 80;

// ✅ Big Eyes: widen fog cone angle by +10 degrees per stack
const BIG_EYES_FOV_ADD_DEG_PER_STACK = 10;

const RAD2DEG = 180 / Math.PI;
const DEG2RAD = Math.PI / 180; // ✅ added (compat field below)

// Compute deterministic modifiers from permanents + temp effects.
// 🔒 Protocol wants ONLY: { speedMult, visionLenAdd, fovAddDeg }
function computePlayerMods(player, nowMs) {
  ensureUpgradeState(player);
  ensureEffectState(player);

  const now = Number.isFinite(nowMs) ? nowMs : Date.now();

  let speedMult = 1.0;
  let fovAddDeg = 0.0;
  let visionLenAdd = 0;

  // 1) Optional schema support from definitions.js (permanent effects)
  for (const slot of player.upgrades.permSlots) {
    const id = String(slot?.id || "");
    const countRaw = Number.isFinite(slot?.count) ? slot.count : 1;
    const count = Math.max(1, Math.floor(countRaw));

    const up = getUpgradeByIdSafe(id);
    const eff = up?.effect;
    if (!eff || up?.kind !== "permanent") continue;

    if (eff.type === "speed_mult") {
      const maxStacks = Number.isFinite(eff.maxStacks) ? eff.maxStacks : 999;
      const c = Math.min(count, maxStacks);
      const per = Number.isFinite(eff.perStackMult) ? eff.perStackMult : 1.0;
      speedMult *= Math.pow(per, c);
    }

    // Support either degrees or radians in definitions, but ALWAYS output degrees
    if (eff.type === "fov_add") {
      const maxStacks = Number.isFinite(eff.maxStacks) ? eff.maxStacks : 999;
      const c = Math.min(count, maxStacks);

      const addDegPerStack = Number.isFinite(eff.addDegPerStack) ? eff.addDegPerStack : null;
      const addRadPerStack = Number.isFinite(eff.addRadiansPerStack) ? eff.addRadiansPerStack : null;

      if (addDegPerStack !== null) {
        fovAddDeg += addDegPerStack * c;
      } else if (addRadPerStack !== null) {
        fovAddDeg += addRadPerStack * RAD2DEG * c;
      }
    }
  }

  // 2) Explicit mapping: giraffoscope -> vision length add (pixels)
  const giraffeStacks = getPermCount(player, "giraffoscope");
  if (giraffeStacks > 0) {
    visionLenAdd += giraffeStacks * VISION_LEN_PER_STACK;
  }

  // 3) Explicit mapping: big_eyes -> fov add (degrees)
  const bigEyesStacks = getPermCount(player, "big_eyes");
  if (bigEyesStacks > 0) {
    fovAddDeg += bigEyesStacks * BIG_EYES_FOV_ADD_DEG_PER_STACK;
  }

  // 4) Temporary dash effect (speed only)
  const dash = player.effects.dash;
  if (dash && Number.isFinite(dash.untilMs) && now < dash.untilMs) {
    if (Number.isFinite(dash.speedMult)) speedMult *= dash.speedMult;
  }

  // clamps
  speedMult = Math.max(0.65, Math.min(speedMult, 3.5));
  fovAddDeg = Math.max(0.0, Math.min(fovAddDeg, 70));
  visionLenAdd = Math.max(0, Math.min(visionLenAdd, 2400));

  // ✅ compat: some clients still read radians
  const fovAdd = fovAddDeg * DEG2RAD;

  // keep protocol fields, plus compat field
  return { speedMult, visionLenAdd, fovAddDeg, fovAdd };
}

// Apply a consumable effect.
// This does NOT charge money (server/index.js does that).
// Returns { ok, actions, changed } so server/index.js can apply actions to world/state.
function applyConsumableUse(player, upgradeId, ctx) {
  ensureUpgradeState(player);
  ensureEffectState(player);

  const up = getUpgradeByIdSafe(upgradeId);
  if (!up) return { ok: false, reason: "invalid_upgrade" };
  if (up.kind !== "consumable") return { ok: false, reason: "not_consumable" };

  const eff = up.effect || {};
  const now = ctx && Number.isFinite(ctx.nowMs) ? ctx.nowMs : Date.now();

  const actions = [];

  switch (eff.type) {
    case "shield_add": {
      const add = Number.isFinite(eff.amount) ? eff.amount : 1;
      const cap = Number.isFinite(eff.maxShield) ? eff.maxShield : 99;
      const before = player.effects.shield | 0;
      player.effects.shield = Math.min(cap, before + add);
      return { ok: true, actions, changed: { shield: player.effects.shield } };
    }

    case "dash": {
      const durSec = Number.isFinite(eff.durationSec) ? eff.durationSec : 0.3;
      const speedMult = Number.isFinite(eff.dashSpeedMult) ? eff.dashSpeedMult : 2.0;
      const invulnDuring = !!eff.invulnDuring;

      // internal cooldown (optional)
      const cdSec = Number.isFinite(eff.internalCooldownSec) ? eff.internalCooldownSec : 0;
      const dashState = player.effects.dash;
      if (dashState && Number.isFinite(dashState.cooldownUntilMs) && now < dashState.cooldownUntilMs) {
        return { ok: false, reason: "dash_cooldown" };
      }

      const untilMs = now + Math.floor(durSec * 1000);
      const cooldownUntilMs = now + Math.floor((durSec + cdSec) * 1000);

      player.effects.dash = { untilMs, speedMult, cooldownUntilMs, invulnDuring };

      if (invulnDuring) {
        actions.push({ type: "set_invuln_until", untilMs });
      }

      return { ok: true, actions, changed: { dashUntil: untilMs } };
    }

    case "spawn_mine": {
      // ✅ defaults requested:
      // - triggerRadius: 32px (enemy-only trigger)
      // - blastRadius: 90px (kills everyone inside, incl allies)
      actions.push({
        type: "spawn_mine_at_player",
        upgradeId: up.id,
        params: {
          radius: Number.isFinite(eff.radius) ? eff.radius : 26, // visual radius (client can draw)
          triggerRadius: 90,
          blastRadius: 100,
          damage: Number.isFinite(eff.damage) ? eff.damage : 1,
          ttlSec: Number.isFinite(eff.ttlSec) ? eff.ttlSec : 25,
          armDelaySec: Number.isFinite(eff.armDelaySec) ? eff.armDelaySec : 0.6,
        },
      });
      return { ok: true, actions };
    }

    case "banana_shot": {
      actions.push({
        type: "spawn_banana_shot",
        upgradeId: up.id,
        params: {
          speed: Number.isFinite(eff.speed) ? eff.speed : 820,
          ttlSec: Number.isFinite(eff.ttlSec) ? eff.ttlSec : 1.4,
          bounces: Number.isFinite(eff.bounces) ? eff.bounces : 3,
          hitRadiusPlayer: Number.isFinite(eff.hitRadiusPlayer) ? eff.hitRadiusPlayer : 12,
        },
      });
      return { ok: true, actions };
    }

    default:
      return { ok: false, reason: "no_effect_defined" };
  }
}

// Optional helper: consume/remove a consumable from a slot by id (if you want "one use then removed").
// If you want consumables to remain after use, DON'T call this.
function removeConsumableById(player, upgradeId) {
  ensureUpgradeState(player);
  const key = String(upgradeId || "");
  const idx = player.upgrades.consSlots.findIndex((s) => String(s?.id || "") === key);
  if (idx >= 0) player.upgrades.consSlots.splice(idx, 1);
}

module.exports = {
  ensureUpgradeState,
  ensureEffectState,

  pickRandomUpgradePool,
  buildOfferOptions,

  applyUpgradeSelection,
  applyConsumableReplace,

  getUpgradeInfo,

  // effects helpers
  computePlayerMods,
  applyConsumableUse,
  removeConsumableById,

  // optional helpers if you ever want them elsewhere
  canTakeUpgrade,
  hasConsumable,
  findPermanentSlot,
};

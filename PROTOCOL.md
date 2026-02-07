# Timetable Clowns — Protocol (Single Source of Truth)

This file is the canonical reference for rules, architecture, and networking for the Timetable Clowns project.
When starting a NEW chat thread, paste:
1) this file (PROTOCOL.md)
2) STATE_OF_THE_GAME.md
3) the file currently being edited

---

## 🔒 Core rule (read first)

**Client may display upgrades, but must never compute gameplay modifiers from them;  
modifiers come only from `player.mods` sent by the server.**

---

## 1) Game concept
A silly top-down multiplayer game for practicing times tables.

- 2–12 players in one match
- Host creates a game and gets a join code
- Guests join using the code
- Host selects:
  - game mode: FFA or Teams
  - timetable base (1–10)
  - teams count (Teams only)
  - friendly fire (Teams only)
  - input mode (kb / kbm / controller later)
  - map choice (map01 or random)
  - session type: Standard or Timed
  - timed minutes (Timed only)
  - win mode: Standard or Money
    - Timed sessions decide winner via winMode
    - Standard sessions still end on Machine 10
- Players move around a top-down map with rooms + corridors
- Rooms contain machines 1–10 (one per room)
- Machines must be completed in numeric order per player (1 → 2 → … → 10)

---

## 2) Core gameplay rules (must be enforced)

### 2.1 Machines + progression
- Interaction key: **E**
- Interaction allowed if player is within **INTERACT_RADIUS**
- Each player has their own machine progression:
  - `nextMachineNum` starts at **1**
  - You may only interact with `nextMachineNum`
  - Correct answer increments `nextMachineNum` (caps at 10)
- Machines are *not global*
- Server denies interaction if:
  - machine already cleared (`already_cleared`)
  - wrong order (`wrong_order`)

### 2.2 Math prompts
- Prompt shown when a player interacts with the correct machine
- Formula: `base × machineNum = ?`
- Server generates + validates
- Client blocks gameplay while prompt is open

### 2.3 Money + pickups
- Start money: **$100**
- Pickup type: `"money"`
- Amount default: **100**
- Server authoritative for collect

### 2.4 Upgrades (storage vs effects)

**Permanent**
- Purchased (`acquireCost`)
- Stackable
- Max **3 permanent types**
- Sent to client for UI only

**Consumable**
- 3 slots (keys 8 / 9 / 0)
- Paid on use (`useCost`)
- Replace flow if full

**IMPORTANT**
- Upgrades do **not** apply effects directly
- They are converted to modifiers server-side

---

## 2.5 Mods (server-sent computed effects) — 🔒 LOCKED CONTRACT

### Rule
The **server is the only authority** that converts upgrades, status, or effects into gameplay modifiers.

The **client must treat `player.mods` as truth** and must **never derive fog, speed, or other gameplay values from `player.upgrades`**.

### Snapshot contract
Every player in `STATE_SNAPSHOT.players[]` includes:

```js
mods: {
  speedMult: number,     // default 1.0
  visionLenAdd: number,  // default 0 (pixels)
  fovAddDeg: number      // default 0 (degrees)
}

Defaults

If no effects apply:

speedMult = 1.0

visionLenAdd = 0

fovAddDeg = 0

Client behavior

speedMult: UI / visualization only

Movement remains server-authoritative

Client must not scale input

Fog-of-war:

visionLen = BASE_VISION_LEN + mods.visionLenAdd

coneDeg = CONE_ANGLE_BASE_DEG + mods.fovAddDeg

Robustness

If mods missing: fall back to defaults

Do not recompute from upgrades

Notes

No doc compression yet

Mods are sent as normal JSON

2.6 Combat + death + respawn

Server authoritative for bullets, damage, death

Shooting blocked during prompts/offers

On death:

PLAYER_DIED

RESPAWN_OPTIONS (private)

Respawn:

Corners always

Cleared machines optional

Invulnerability window via invulnUntil

3) Session types + game end
Standard

Ends when Machine 10 is solved

Timed

Server computes endAt

Ends when time expires

Win modes

standard: correct → kills → money → deaths

money: money → correct → kills → deaths

4) End screen UX

Large winner banner

Leaderboard

Only action: Back to lobby (reload)

5) Networking

(unchanged; snapshot includes mods per player)

6) Authority

Server owns:

movement, combat, economy, machines

upgrades → mods computation

death, respawn, timer, winner

Client renders + sends input only.

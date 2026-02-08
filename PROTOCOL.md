# Timetable Clowns — Protocol (Single Source of Truth)

This file is the canonical reference for rules, architecture, and networking for the Timetable Clowns project.

When starting a NEW chat thread, paste:
1) this file (PROTOCOL.md)
2) STATE_OF_THE_GAME.md
3) the file currently being edited

🔒 **Hard rule**
Client may display upgrades, but must never compute gameplay modifiers from them.
All gameplay modifiers come only from `player.mods`, computed by the server.

---

## 1) Game concept

A silly top-down multiplayer game for practicing times tables.

- 2–12 players per match
- Host creates a game and receives a join code
- Guests join via code
- Host selects:
  - game mode: FFA or Teams
  - timetable base (1–10)
  - team count (Teams only)
  - friendly fire (Teams only)
  - input mode (kb / kbm / controller later)
  - map choice (map01 or random)
  - session type: Standard or Timed
  - timed minutes (Timed only)
  - win mode: Standard or Money

Timed sessions decide winner via `winMode`.
Standard sessions still end on Machine 10.

Players move around a top-down map with rooms and corridors.
Rooms contain machines numbered 1–10.
Machines must be completed in numeric order **per player**.

---

## 2) Core gameplay rules (must be enforced)

### 2.1 Machines & progression

- Interaction key: **E**
- Player must be within `INTERACT_RADIUS`
- Each player has their own progression:
  - `nextMachineNum` starts at 1
  - Only `nextMachineNum` may be interacted with
  - Correct answer increments `nextMachineNum` (max 10)

Server denies interaction if:
- already cleared → `reason:"already_cleared"`
- wrong order → `reason:"wrong_order"`

---

### 2.2 Math prompts

- Prompt appears on valid interaction
- Formula: `base × machineNum = ?`
- Server authoritative:
  - generates prompt
  - validates answer

Server emits:

ANSWER_RESULT { ok, correct? }

Client behavior:
- Prompt blocks gameplay input
- Enter submits
- Escape closes

---

### 2.3 Money & pickups

- Start money: **$100**
- Money pickups:
  - `type:"money"`
  - default amount: 100
- Economy handled server-side

---

## 2.4 Upgrades

Upgrades come in two kinds.

### A) Permanent upgrades

- Paid immediately on selection
- Stored as permanent
- Can stack (`count`)
- Max **3 different permanent types**
- Cost field: `acquireCost`

### B) Consumable upgrades

- Stored in **3 slots** (hotkeys **8 / 9 / 0**)
- Not paid on pickup
- Paid on use
- Cost field: `useCost`
- No duplicates
- Max 3 at a time

If slots are full:


Client behavior:
- Prompt blocks gameplay input
- Enter submits
- Escape closes

---

### 2.3 Money & pickups

- Start money: **$100**
- Money pickups:
  - `type:"money"`
  - default amount: 100
- Economy handled server-side

---

## 2.4 Upgrades

Upgrades come in two kinds.

### A) Permanent upgrades

- Paid immediately on selection
- Stored as permanent
- Can stack (`count`)
- Max **3 different permanent types**
- Cost field: `acquireCost`

### B) Consumable upgrades

- Stored in **3 slots** (hotkeys **8 / 9 / 0**)
- Not paid on pickup
- Paid on use
- Cost field: `useCost`
- No duplicates
- Max 3 at a time

If slots are full:
Client must send:

chooseUpgradeReplace { offerId, upgradeId, dropId }

Using consumables:
- Server validates:
  - slot not empty
  - player alive
  - no prompt open
  - no upgrade offer open
  - enough money
- Server subtracts money and emits:

UPGRADE_USED { ok:true, paid, used, money }

---

## 2.5 Mods (server-computed) — 🔒 LOCKED CONTRACT

### Rule

The server is the **only authority** that converts upgrades and effects into gameplay modifiers.

The client must **never** derive gameplay values from `player.upgrades`.

### Snapshot contract

Each player in `STATE_SNAPSHOT.players[]` includes:

```js
mods: {
  speedMult: number,
  visionLenAdd: number,
  fovAddDeg: number
}
Defaults:

speedMult = 1.0

visionLenAdd = 0

fovAddDeg = 0

Client usage

Movement: server authoritative, client does not scale speed

Fog of war:

visionLen = BASE_VISION_LEN + mods.visionLenAdd
coneDeg   = CONE_ANGLE_BASE_DEG + mods.fovAddDeg


If mods missing → fall back to defaults.

2.6 Combat, death & respawn

Shooting: cakes

Server authoritative for:

bullets

collisions

damage

death

Shooting blocked if:

prompt open

upgrade offer open

On death:

alive = false

Server emits:

PLAYER_DIED

RESPAWN_OPTIONS (private)

Respawn options:

corners (always)

cleared machines (player-specific)

On respawn:

alive = true

invulnUntil set

3) Session types & game end
3.1 Standard

Ends when Machine 10 is solved

GAME_ENDED { reason:"machine10" }

3.2 Timed

Server sets:

endAt = startedAt + sessionMinutes * 60 * 1000


Included in GAME_STARTED and STATE_SNAPSHOT

Ends when time expires:

GAME_ENDED { reason:"time" }

3.3 Win modes
Standard

correct ↓

kills ↓

money ↓

deaths ↑

Money

money ↓

correct ↓

kills ↓

deaths ↑

FFA → top player wins
Teams → aggregated team totals

4) End screen UX

Large modal

Big winner banner

Winning team emphasized

Leaderboard shown

Only option: Back to lobby (reload)

5) Networking
Client → Server

hello
createGame
joinGame
assignTeam
startGame
input
tryInteract
submitAnswer
chooseUpgrade
declineUpgrade
chooseUpgradeReplace
useUpgradeSlot
chooseRespawn

Server → Client

WELCOME
GAME_CREATED
JOIN_SUCCESS
JOIN_FAILED
LOBBY_UPDATE
GAME_STARTED
STATE_SNAPSHOT
MATH_PROMPT
ANSWER_RESULT
INTERACT_DENIED
UPGRADE_OFFER
UPGRADE_RESULT
UPGRADE_DECLINED
UPGRADE_USED
PLAYER_DIED
RESPAWN_OPTIONS
RESPAWN_RESULT
GAME_ENDED

6) Authoritative server model (non-negotiable)

Server owns:

movement

collisions

shooting

economy

machines

upgrades

mods computation

death / respawn

timers

winners

Client owns:

rendering

input

UI only

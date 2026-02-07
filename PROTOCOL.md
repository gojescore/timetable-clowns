# Timetable Clowns — Protocol (Single Source of Truth)

This file is the canonical reference for rules, architecture, and networking for the Timetable Clowns project.
When starting a NEW chat thread, paste:
1) this file (PROTOCOL.md)
2) STATE_OF_THE_GAME.md
3) the file currently being edited

---

## 🔒 One-liner that prevents future confusion
**Client may display upgrades, but must never compute gameplay modifiers from them; modifiers come only from `player.mods`.**

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
- Machines are *not global*; one player clearing machine 3 does not clear it for others
- Server denies interaction if:
  - machine already cleared by that player (`reason:"already_cleared"`)
  - wrong order (`reason:"wrong_order"`)

### 2.2 Math prompts
- Prompt shown when a player interacts with the correct machine
- Prompt formula:
  - `base × machineNum = ?`
- Server is authoritative:
  - Server generates the prompt
  - Server validates the answer
- On submit:
  - Server emits `ANSWER_RESULT { ok, correct? }`
- Client behavior:
  - Prompt overlay blocks gameplay input
  - Enter submits, Escape closes

### 2.3 Money + pickups
- Each player starts with **$100**
- Money pickups exist in the world:
  - pickup type: `"money"`
  - amount default: **100** (economy module)
- Players collect money by overlapping the pickup radius (server-side)

### 2.4 Upgrades (buy vs use)
Upgrades come in two kinds:

**A) Permanent**
- Purchased (money removed on selection)
- Stored as “permanent”
- Can stack: same permanent can have `count: 2`, `count: 3`, etc.
- Limited to **3 permanent types** at a time (max)
- Cost field:
  - `acquireCost`

**B) Consumable**
- Stored in **3 slots** (hotkeys 8/9/0)
- Not paid when picked; paid when used
- Cost field:
  - `useCost`
- Cannot hold more than 3 consumables:
  - If full and player picks a new consumable, server returns:
    - `UPGRADE_RESULT { ok:false, reason:"slots_full", requested, slots }`
  - Client must offer replace flow and send:
    - `chooseUpgradeReplace { offerId, upgradeId, dropId }`

**Using consumables**
- Hotkeys:
  - Slot 0: key `8`
  - Slot 1: key `9`
  - Slot 2: key `0`
- Server validates:
  - slot not empty
  - player alive
  - no server-side blockers:
    - no prompt open (`pendingPrompt`)
    - no upgrade offer open (`pendingUpgradeOffer`)
  - player has enough money for `useCost`
- Server subtracts money and emits:
  - `UPGRADE_USED { ok:true, paid, used, money }`

---

## 2.5 Mods (server-sent computed effects) — 🔒 LOCKED CONTRACT

We are migrating to server-sent mods so the client never recomputes upgrade effects.

### Rule
The server is the only authority that converts upgrades (and any other status/effects) into gameplay modifiers.

The client must treat `player.mods` as truth and must not derive fog/speed/etc. from `player.upgrades`.

### Snapshot contract
Every player in `STATE_SNAPSHOT.players[]` includes a `mods` object:

```js
mods: {
  speedMult: number,     // default 1.0
  visionLenAdd: number,  // default 0 (pixels added to base vision)
  fovAddDeg: number      // default 0 (degrees added to base cone angle)
}

Defaults

If no upgrades/effects apply:

speedMult = 1.0

visionLenAdd = 0

fovAddDeg = 0

Client behavior

Client uses:

speedMult only for UI/visualization (movement remains server-authoritative; client must not scale input)

visionLenAdd + fovAddDeg for fog-of-war cone only:

visionLen = BASE_VISION_LEN + me.mods.visionLenAdd

coneDeg = CONE_ANGLE_BASE_DEG + me.mods.fovAddDeg

Client must be robust:

If mods missing, fall back to defaults (do not attempt to recompute from upgrades)

No doc compression yet; mods are sent as normal JSON in snapshots.

2.6 Combat + death + respawn

Players can shoot projectiles (cakes) while holding Space (or input state fire)

Server authoritative for:

projectile spawn + movement

collisions

damage/death

Shooting restrictions:

blocked while prompt is open

blocked while upgrade offer is open

consumes 1 cake per shot

On death:

player alive=false

server emits PLAYER_DIED { playerId } to the room

server emits RESPAWN_OPTIONS to the dead player (private)

Respawn options

Corners (always)

Cleared machines (optional spawn points based on player’s clearedMachines set)

On respawn:

player becomes alive again

invulnUntil = ms timestamp in the future

client shows invulnerability HUD and blink

Killed-by info

RESPAWN_OPTIONS { killedBy: <killerName>, options:[...] }

3) Session types + game end conditions
3.1 Session type: Standard

Game ends when Machine 10 is correctly answered by some player

Server emits:

GAME_ENDED { reason:"machine10", ... }

3.2 Session type: Timed

Host chooses:

sessionMode: "timed"

sessionMinutes: N

Server computes:

endAt = startedAt + (sessionMinutes * 60 * 1000)

Server includes:

endAt in GAME_STARTED

endAt in STATE_SNAPSHOT

Game ends when time is up:

server emits GAME_ENDED { reason:"time", ... }

3.3 Win mode (winner calculation policy)

winMode: "standard"

Sort by: correct desc, then kills desc, then money desc, then deaths asc

winMode: "money"

Sort by: money desc, then correct desc, then kills desc, then deaths asc

FFA: winner is top row of sorted leaderboard.
Teams: server aggregates team totals and returns winnerTeamId and a representative winnerId/winnerName.

4) End screen UX requirements

When the game ends:

Client shows a large end modal with:

big winner banner (TEAM winner emphasized in Teams)

leaderboard list

Only option: Back to lobby

Implementation: reload page

5) Networking (Socket.IO events)
5.1 Client → Server

hello { name }

createGame { mode, teamCount, friendlyFire, tableBase, mapChoice, inputMode, sessionMode, sessionMinutes, winMode }

joinGame { gameCode }

assignTeam { playerId, teamId }

startGame

input { up, down, left, right, fire }

tryInteract

submitAnswer { promptId, answer }

Upgrades:

chooseUpgrade { offerId, upgradeId }

declineUpgrade { offerId }

chooseUpgradeReplace { offerId, upgradeId, dropId }

useUpgradeSlot { slotIndex }

Respawn:

chooseRespawn { spawnId }

5.2 Server → Client

Lobby:

WELCOME { playerId }

GAME_CREATED { gameCode }

JOIN_SUCCESS { gameCode, players, settings }

JOIN_FAILED { reason }

LOBBY_UPDATE { players, settings }

Game start + snapshots:

GAME_STARTED { map, settings, endAt? }

STATE_SNAPSHOT { time, world, phase, endAt?, pickups, bullets, players }

Players in snapshot
Each players[] row includes (minimum):

id, name, teamId, x, y, dirX, dirY, alive, invulnUntil, nextMachineNum, money, cakes, stats, upgrades, mods

Machines:

MATH_PROMPT { promptId, base, machineNum }

ANSWER_RESULT { ok, correct? }

INTERACT_DENIED { reason, nextMachineNum, tried }

Upgrades:

UPGRADE_OFFER { offerId, options }

UPGRADE_RESULT { ok, reason?, money?, need?, requested?, slots?, upgrades? }

UPGRADE_DECLINED { ok, reason? }

UPGRADE_USED { ok, reason?, money?, need?, paid?, used? }

Death/respawn:

PLAYER_DIED { playerId }

RESPAWN_OPTIONS { killedBy?, options:[{id,label,kind}] }

RESPAWN_RESULT { ok, reason? }

Game end:

GAME_ENDED { reason, endedAt, winnerId, winnerName, winnerTeamId, leaderboard, winMode }

6) Authoritative server model (non-negotiable)

Server owns:

movement, collisions

shooting + projectile sim

pickups + economy

machines + math validation

money balances

upgrades state + validation

mods computation

death + respawn + invulnerability

session timer + end-of-game decision

leaderboard computation + winner selection

Client is rendering + input only.

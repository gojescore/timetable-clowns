# Timetable Clowns — Protocol (Single Source of Truth)

This file is the canonical reference for rules, architecture, and networking for the Timetable Clowns project.
When starting a NEW chat thread, paste:
1) this file (PROTOCOL.md)
2) STATE_OF_THE_GAME.md
3) the file currently being edited

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
  - Correct answer increments `nextMachineNum`
- Machines are *not global*; one player clearing machine 3 does not clear it for others

### 2.2 Math prompts
- Prompt shown when a player interacts with the correct machine
- Prompt formula:
  - `base × machineNum = ?`
- Server is authoritative:
  - Server generates the prompt
  - Server validates the answer
- On submit:
  - Server emits `ANSWER_RESULT { ok, correct }`
- Client behavior:
  - Prompt overlay blocks gameplay input
  - Enter submits, Escape closes

### 2.3 Money + pickups
- Each player starts with **$100**
- Money pickups exist in the world:
  - pickup type: `"money"`
  - amount default: **100**
- Players collect money by overlapping the pickup radius (server-side)

### 2.4 Upgrades (buy vs use)
Upgrades come in two kinds:

**A) Permanent**
- Purchased once and then stored as “permanent”
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
  - If full and player picks a new consumable, client must offer replace flow
  - Replace flow chooses a `dropId` to discard

**Using consumables**
- Hotkeys:
  - Slot 0: key `8`
  - Slot 1: key `9`
  - Slot 2: key `0`
- Server validates:
  - slot not empty
  - player alive
  - no blocking overlays on server (offer open / prompt open)
  - player has enough money for `useCost`
- Server subtracts money and applies effect

### 2.5 Combat + death + respawn
- Players can shoot projectiles (cakes) while holding Space (or input state `fire`)
- Server authoritative for:
  - projectile spawn + movement
  - collisions
  - damage/death
- On death:
  - player `alive=false`
  - server emits `PLAYER_DIED` (at minimum)
  - server emits `RESPAWN_OPTIONS` to the dead player

**Respawn options**
- Corners (always)
- Cleared machines (optional rule if implemented)
- On respawn:
  - player becomes alive again
  - player gets a brief invulnerability window:
    - `invulnUntil` ms timestamp
  - client shows invulnerability HUD and blink

**Killed-by info (NEW)**
- When a player dies, the respawn screen MUST tell them who killed them (name)
- Implemented by including:
  - `killedBy: <killerName>` in `RESPAWN_OPTIONS`

---

## 3) Session types + game end conditions (NEW)

### 3.1 Session type: Standard
- Game ends when the current mode’s win condition is met:
  - **Machine 10** is correctly answered (current game mode rule)
- When game ends:
  - server emits `GAME_ENDED` with reason `"machine10"`

### 3.2 Session type: Timed (NEW)
- Host chooses:
  - `sessionMode: "timed"`
  - `sessionMinutes: N`
- Server computes:
  - `endAt = now + (sessionMinutes * 60 * 1000)`
- Server includes:
  - `endAt` in `GAME_STARTED` payload
  - `endAt` (or repeated via snapshot) so clients can show timer HUD
- Game ends when time is up:
  - server emits `GAME_ENDED` with reason `"time"`

### 3.3 End screen UX requirements (NEW)
When the game ends:
- Client shows a larger end modal with:
  - big winner banner
  - leaderboard list
- **Only option** on end screen: **Back to lobby**
  - Implementation: reload page (safe and simple)

---

## 4) Leaderboard (NEW)

### 4.1 What the leaderboard shows
At minimum per player:
- name
- correct answers count
- kills
- deaths
- money

### 4.2 Winner definition
- For now, winner can be:
  - best score according to server rule (e.g. highest correct answers; tie-break by kills; then money)
  - OR winning team if Teams mode (server chooses the rule)
- Server must specify:
  - `winnerId` and `winnerName`
  - `winnerTeamId` if Teams

### 4.3 Leaderboard payload
Server emits `GAME_ENDED` with:
- `reason`: `"machine10"` or `"time"` (string)
- `endedAt`: ms timestamp
- `winnerId`: string
- `winnerName`: string
- `winnerTeamId`: number|null
- `leaderboard`: array of rows sorted best-first:
  - `{ id, name, correct, kills, deaths, money, teamId? }`

Client highlights the winner row and renders the winner banner prominently.

---

## 5) Networking (Socket.IO events)

### 5.1 Client → Server
- `hello { name }`
- `createGame { mode, teamCount, friendlyFire, tableBase, mapChoice, inputMode, sessionMode, sessionMinutes }`
- `joinGame { gameCode }`
- `assignTeam { playerId, teamId }` (host only)
- `startGame` (host only)
- `input { up, down, left, right, fire }`
- `tryInteract`
- `submitAnswer { promptId, answer }`
- `chooseUpgrade { offerId, upgradeId }`
- `declineUpgrade { offerId }`
- `chooseUpgradeReplace { offerId, upgradeId, dropId }`
- `useUpgradeSlot { slotIndex }`
- `chooseRespawn { spawnId }`

### 5.2 Server → Client
Lobby:
- `WELCOME { playerId }`
- `GAME_CREATED { gameCode }`
- `JOIN_SUCCESS { gameCode, players, settings }`
- `JOIN_FAILED { reason }`
- `LOBBY_UPDATE { players, settings }`

Game start + snapshots:
- `GAME_STARTED { map, settings, endAt? }`
- `STATE_SNAPSHOT { time, world, players, pickups, bullets, endAt? }`

Machines:
- `MATH_PROMPT { promptId, base, machineNum }`
- `ANSWER_RESULT { ok, correct }`
- `INTERACT_DENIED { reason, nextMachineNum? }`

Upgrades:
- `UPGRADE_OFFER { offerId, options }`
- `UPGRADE_RESULT { ok, reason?, money?, need?, requested?, slots? }`
- `UPGRADE_DECLINED { ok }`
- `UPGRADE_USED { ok, reason?, money?, need?, paid?, used? }`

Death/respawn:
- `PLAYER_DIED { playerId }`
- `RESPAWN_OPTIONS { options, killedBy? }`  ✅ includes killer name when available
- `RESPAWN_RESULT { ok, reason? }`

Game end:
- `GAME_ENDED { reason, endedAt, winnerId, winnerName, winnerTeamId, leaderboard }` ✅ NEW

---

## 6) Client UI constraints
- Client must block movement/shooting while overlays are open:
  - math prompt
  - upgrade offer
  - replace/drop picker
  - respawn picker
  - end screen
- End screen:
  - only action: “Back to lobby” (reload)
- Timer HUD:
  - visible only if `endAt` is provided
- Respawn overlay:
  - shows “Killed by: <name>” when provided

---

## 7) Authoritative server model (non-negotiable)
- Server owns:
  - player movement
  - collisions
  - shooting and projectile simulation
  - pickups
  - machine rules + math validation
  - money balances
  - upgrades
  - death + respawn + invulnerability
  - session timer + end-of-game decision
  - leaderboard computation + winner selection
- Client is rendering + input only:
  - sends inputState
  - renders snapshots
  - shows overlays based on server events

---

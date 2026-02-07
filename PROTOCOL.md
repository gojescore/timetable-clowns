# Timetable Clowns — Protocol (Single Source of Truth)

This file is the canonical reference for rules, architecture, and networking for the Timetable Clowns project.
When starting a NEW chat thread, paste:
1) this file (PROTOCOL.md)
2) STATE_OF_THE_GAME.md
3) the file currently being edited# Timetable Clowns — Protocol (Single Source of Truth)

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

## 2.5 Server-sent player modifiers (MODS) — canonical model
**Gameplay modifiers are computed server-side and sent to the client in snapshots.  
Client must NOT derive gameplay effects from upgrade stacks.**

### 2.5.1 Mods object
Server includes per-player:

`players[].mods` in `STATE_SNAPSHOT`.

Shape (numbers; absent means default 0/1):
- `speedMult` (default 1)
- `visionLenAdd` (default 0) — extra vision length in pixels
- `fovAddDeg` (default 0) — extra cone angle in degrees
- (optional future) `visionLenMult`, `damageMult`, etc.

### 2.5.2 Client rendering rules
- Fog-of-war cone:
  - `visionLen = BASE_VISION_LEN + me.mods.visionLenAdd`
  - `coneDeg = CONE_ANGLE_BASE_DEG + me.mods.fovAddDeg`
- Client must not inspect `me.upgrades.permanent` to compute fog.
- Upgrades are still sent for UI display (names/costs/stacks), but effects are applied by mods.

---

## 2.6 Combat + death + respawn
- Players can shoot projectiles (cakes) while holding Space (or input state `fire`)
- Server authoritative for:
  - projectile spawn + movement
  - collisions
  - damage/death
- Shooting restrictions:
  - blocked while prompt is open
  - blocked while upgrade offer is open
  - consumes 1 cake per shot
- On death:
  - player `alive=false`
  - server emits `PLAYER_DIED { playerId }` to the room
  - server emits `RESPAWN_OPTIONS` to the dead player (private)

**Respawn options**
- Corners (always)
- Cleared machines (optional spawn points based on player’s `clearedMachines` set)
- On respawn:
  - player becomes alive again
  - `invulnUntil` = ms timestamp in the future
  - client shows invulnerability HUD and blink

**Killed-by info**
- `RESPAWN_OPTIONS { killedBy: <killerName>, options:[...] }`

---

## 3) Session types + game end conditions

### 3.1 Session type: Standard
- Game ends when **Machine 10** is correctly answered by some player
- Server emits:
  - `GAME_ENDED { reason:"machine10", ... }`

### 3.2 Session type: Timed
- Host chooses:
  - `sessionMode: "timed"`
  - `sessionMinutes: N`
- Server computes:
  - `endAt = startedAt + (sessionMinutes * 60 * 1000)`
- Server includes:
  - `endAt` in `GAME_STARTED`
  - `endAt` in `STATE_SNAPSHOT`
- Game ends when time is up:
  - server emits `GAME_ENDED { reason:"time", ... }`

### 3.3 Win mode (winner calculation policy)
- `winMode: "standard"`
  - Sort by: `correct desc`, then `kills desc`, then `money desc`, then `deaths asc`
- `winMode: "money"`
  - Sort by: `money desc`, then `correct desc`, then `kills desc`, then `deaths asc`

**FFA**: winner is top row of sorted leaderboard.  
**Teams**: server aggregates team totals and returns `winnerTeamId` and a representative `winnerId/winnerName`.

---

## 4) End screen UX requirements
When the game ends:
- Client shows a large end modal with:
  - big winner banner (TEAM winner emphasized in Teams)
  - leaderboard list
- **Only option**: **Back to lobby**
  - Implementation: reload page

---

## 5) Networking (Socket.IO events)

### 5.1 Client → Server
- `hello { name }`
- `createGame { mode, teamCount, friendlyFire, tableBase, mapChoice, inputMode, sessionMode, sessionMinutes, winMode }`
- `joinGame { gameCode }`
- `assignTeam { playerId, teamId }`
- `startGame`
- `input { up, down, left, right, fire }`
- `tryInteract`
- `submitAnswer { promptId, answer }`

Upgrades:
- `chooseUpgrade { offerId, upgradeId }`
- `declineUpgrade { offerId }`
- `chooseUpgradeReplace { offerId, upgradeId, dropId }`
- `useUpgradeSlot { slotIndex }`

Respawn:
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
- `STATE_SNAPSHOT { time, world, phase, endAt?, pickups, bullets, players }`

**Players in snapshot**
Each `players[]` row includes (minimum):
- `id, name, teamId, x, y, dirX, dirY, alive, invulnUntil, nextMachineNum, money, cakes, stats, upgrades, mods`

Machines:
- `MATH_PROMPT { promptId, base, machineNum }`
- `ANSWER_RESULT { ok, correct? }`
- `INTERACT_DENIED { reason, nextMachineNum, tried }`

Upgrades:
- `UPGRADE_OFFER { offerId, options }`
- `UPGRADE_RESULT { ok, reason?, money?, need?, requested?, slots?, upgrades? }`
- `UPGRADE_DECLINED { ok, reason? }`
- `UPGRADE_USED { ok, reason?, money?, need?, paid?, used? }`

Death/respawn:
- `PLAYER_DIED { playerId }`
- `RESPAWN_OPTIONS { killedBy?, options:[{id,label,kind}] }`
- `RESPAWN_RESULT { ok, reason? }`

Game end:
- `GAME_ENDED { reason, endedAt, winnerId, winnerName, winnerTeamId, leaderboard, winMode }`

---

## 6) Authoritative server model (non-negotiable)
Server owns:
- movement, collisions
- shooting + projectile sim
- pickups + economy
- machines + math validation
- money balances
- upgrades state + validation
- **mods computation**
- death + respawn + invulnerability
- session timer + end-of-game decision
- leaderboard computation + winner selection

Client is rendering + input only.


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
    (Timed sessions only decide winner via winMode; Standard sessions still end on Machine 10)
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
  - If full and player picks a new consumable, server returns  
    `UPGRADE_RESULT { ok:false, reason:"slots_full", requested, slots }`
  - Client must offer replace flow and send  
    `chooseUpgradeReplace { offerId, upgradeId, dropId }`

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
- (Consumable “effects” are defined by upgrades module; networking contract stays the same.)

### 2.4.1 Permanent fog upgrades (Glasses + Giraffoscope)
Two permanent upgrades affect fog-of-war rendering:

**Glasses (`big_eyes`)**
- Widens the fog cone angle.
- Stacking increases cone width linearly.

**Giraffoscope**
- Increases the fog cone length.
- Stacking increases cone length linearly.

**Important rule (authoritative source):**
- Fog parameters are derived from server state and must be consistent with permanent stacks.
- Client may calculate the final fog values from the player’s permanent stack counts in snapshot:
  - `big_eyes` stack count → cone angle
  - `giraffoscope` stack count → vision length

(Exact constants are client-tuned; server remains authoritative for the permanent stack counts.)

### 2.5 Combat + death + respawn
- Players can shoot projectiles (cakes) while holding Space (or input state `fire`)
- Server authoritative for:
  - projectile spawn + movement
  - collisions
  - damage/death
- Shooting restrictions:
  - blocked while prompt is open
  - blocked while upgrade offer is open
  - consumes 1 cake per shot
- On death:
  - player `alive=false`
  - server emits `PLAYER_DIED { playerId }` to the room
  - server emits `RESPAWN_OPTIONS` to the dead player (private)

**Respawn options**
- Corners (always)
- Cleared machines (implemented as optional spawn points based on player’s `clearedMachines` set)
- On respawn:
  - player becomes alive again
  - player gets a brief invulnerability window:
    - `invulnUntil` = ms timestamp in the future
  - client shows invulnerability HUD and blink

**Killed-by info**
- When a player dies, respawn screen must show who killed them
- Implemented via:
  - `RESPAWN_OPTIONS { killedBy: <killerName>, options:[...] }`

---

## 3) Session types + game end conditions

### 3.1 Session type: Standard
- Game ends when **Machine 10** is correctly answered by some player
- Server emits:
  - `GAME_ENDED { reason:"machine10", ... }`
- Winner is the player who solved machine 10:
  - `winnerId = that player`
  - `winnerName = that player name`
  - In Teams mode, `winnerTeamId` is that player’s team

### 3.2 Session type: Timed
- Host chooses:
  - `sessionMode: "timed"`
  - `sessionMinutes: N`
- Server computes at game start:
  - `endAt = startedAt + (sessionMinutes * 60 * 1000)`
- Server includes:
  - `endAt` in `GAME_STARTED`
  - `endAt` in `STATE_SNAPSHOT` (so client timer stays correct)
- Game ends when time is up:
  - server emits `GAME_ENDED { reason:"time", ... }`

### 3.3 Win mode (winner calculation policy)
Win mode affects leaderboard sorting and timed-session winner selection.

- `winMode: "standard"` (default)
  - Sort by: `correct desc`, then `kills desc`, then `money desc`, then `deaths asc`
- `winMode: "money"`
  - Sort by: `money desc`, then `correct desc`, then `kills desc`, then `deaths asc`

**FFA**
- Winner is top row of the sorted leaderboard.

**Teams**
- Server aggregates per-team totals (sum of money/correct/kills/deaths) and sorts teams using the same winMode ordering.
- Server returns:
  - `winnerTeamId` (the winning team)
  - representative `winnerId/winnerName` (top player on that team for UI convenience)

---

## 4) End screen UX requirements

When the game ends:
- Client shows a large end modal with:
  - big winner banner (TEAM winner emphasized in Teams)
  - leaderboard list
- **Only option** on end screen: **Back to lobby**
  - Implementation: reload page (safe/simple)

---

## 5) Leaderboard

### 5.1 What the leaderboard shows
Per player row:
- `name`
- `correct`
- `kills`
- `deaths`
- `money`
- `teamId` (Teams mode and also present in FFA as a unique id)

### 5.2 Leaderboard payload
Server emits `GAME_ENDED` with:
- `reason`: `"machine10"` or `"time"`
- `endedAt`: ms timestamp
- `winnerId`: string|null
- `winnerName`: string|null
- `winnerTeamId`: number|null
- `leaderboard`: array of rows sorted best-first:
  - `{ id, name, teamId, correct, kills, deaths, money }`
- `winMode`: `"standard"` or `"money"`

Client highlighting rules:
- Teams: highlight every row with `teamId === winnerTeamId`
- FFA: highlight winner row (by `winnerId`; fallback to first row)

---

## 6) Networking (Socket.IO events)

### 6.1 Client → Server
- `hello { name }`
- `createGame { mode, teamCount, friendlyFire, tableBase, mapChoice, inputMode, sessionMode, sessionMinutes, winMode }`
- `joinGame { gameCode }`
- `assignTeam { playerId, teamId }` (host only; Teams mode only)
- `startGame` (host only)
- `input { up, down, left, right, fire }`
- `tryInteract`
- `submitAnswer { promptId, answer }`

Upgrades:
- `chooseUpgrade { offerId, upgradeId }`
- `declineUpgrade { offerId }`
- `chooseUpgradeReplace { offerId, upgradeId, dropId }`
- `useUpgradeSlot { slotIndex }`

Respawn:
- `chooseRespawn { spawnId }`

### 6.2 Server → Client
Lobby:
- `WELCOME { playerId }`
- `GAME_CREATED { gameCode }`
- `JOIN_SUCCESS { gameCode, players, settings }`
- `JOIN_FAILED { reason }`
- `LOBBY_UPDATE { players, settings }`

Game start + snapshots:
- `GAME_STARTED { map, settings, endAt? }`
- `STATE_SNAPSHOT { time, world, phase, endAt?, pickups, bullets, players }`

Machines:
- `MATH_PROMPT { promptId, base, machineNum }`
- `ANSWER_RESULT { ok, correct? }`
- `INTERACT_DENIED { reason, nextMachineNum, tried }`

Upgrades:
- `UPGRADE_OFFER { offerId, options }`
- `UPGRADE_RESULT { ok, reason?, money?, need?, requested?, slots?, upgrades? }`
- `UPGRADE_DECLINED { ok, reason? }`
- `UPGRADE_USED { ok, reason?, money?, need?, paid?, used? }`

Death/respawn:
- `PLAYER_DIED { playerId }`
- `RESPAWN_OPTIONS { killedBy?, options:[{id,label,kind}] }`
- `RESPAWN_RESULT { ok, reason? }`

Game end:
- `GAME_ENDED { reason, endedAt, winnerId, winnerName, winnerTeamId, leaderboard, winMode }`

---

## 7) Client UI constraints
- Client must block movement/shooting while overlays are open:
  - math prompt
  - upgrade offer
  - replace/drop picker
  - respawn picker
  - end screen
- Timer HUD:
  - visible only if `endAt` is provided
- Respawn overlay:
  - shows “Killed by: <name>” when provided
- End screen:
  - only action: “Back to lobby” (reload)

---

## 8) Authoritative server model (non-negotiable)
Server owns:
- player movement
- collisions
- shooting and projectile simulation
- pickups + economy
- machine rules + math validation
- money balances
- upgrades state + validation
- death + respawn + invulnerability
- session timer + end-of-game decision
- leaderboard computation + winner selection

Client is rendering + input only:
- sends inputState
- renders snapshots
- shows overlays based on server events

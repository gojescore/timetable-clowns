# Timetable Clowns — PROTOCOL (Single Source of Truth)

This file is the canonical reference for rules, architecture, and networking for the Timetable Clowns project.
When starting a new ChatGPT thread, paste this file + STATE_OF_THE_GAME.md + the file you are editing.

---

## 0) Goals (non-negotiable)
- Multiplayer top-down practice game for times tables.
- Server is authoritative: movement, collisions, machines, money, upgrades, death/respawn, bullets, pickups.
- Client sends input and renders snapshots; server decides truth.

---

## 1) Game concept
A silly top-down multiplayer game for practicing times tables.

- 2–12 players in one match
- Host creates a game and gets a join code
- Guests join using the code
- Host selects:
  - mode: `ffa` or `teams`
  - teams (teams mode only): `teamCount`
  - timetable base (1–10)
  - input mode (kb / kbm / kbm_gamepad)
  - map choice (map01 or random)
- Players move around a map with rooms and corridors
- Rooms contain machines 1–10 (one per room)
- Machines must be completed in numeric order (1 → 2 → … → 10), per player

---

## 2) Core gameplay rules (server enforced)

### 2.1 Movement + collisions
- Server tick runs at fixed rate (e.g. 20 Hz) and uses dt.
- Movement uses normalized direction vector so diagonals are not faster.
- Collision is AABB against walls and solid machines.
- World clamp uses player half-size.

### 2.2 Machines + progression
- Interaction key: **E**
- A player can interact only if:
  - player is alive
  - within `INTERACT_RADIUS` (default 60) of machine center
  - machine not already cleared for that player
  - machine.num equals player.nextMachineNum
- On interact success:
  - server creates a promptId and stores pendingPrompt on player
  - server emits `MATH_PROMPT { promptId, base, machineNum }`
- On answer submit:
  - server validates promptId matches pendingPrompt.id
  - if correct:
    - mark machine cleared (per player)
    - increment nextMachineNum up to 10
    - award money and/or spawn pickups (economy)
    - create upgrade offer and emit `UPGRADE_OFFER`
  - if wrong:
    - emit `ANSWER_RESULT { ok:false, correct }`
    - optional penalty (economy)

### 2.3 Combat + bullets
- Shooting is controlled by `input.fire` (Space held on client).
- Server applies dt-based cooldown per player.
- Server spawns bullets with velocity from player.dirX/dirY.
- Bullets:
  - move each tick
  - expire with TTL
  - collide with walls and machines (removed on hit)
  - collide with players (damage/kill rules below)
- Friendly fire:
  - Default: **OFF** (same-team bullets do not kill teammates) when mode is `teams`.
  - In `ffa`, everyone is an enemy.
  - Future modes may override this.

### 2.4 Death + respawn
- Players have `alive: boolean`.
- When a player is killed:
  - set alive=false
  - clear movement/fire input server-side
  - clear pending prompt/offer if desired
  - emit `PLAYER_DIED { playerId }` to room (optional)
  - emit `RESPAWN_OPTIONS { options[] }` to the dead player’s socket only
- Dead players:
  - do not move, interact, shoot, or use upgrades
  - are not rendered by client (body + name hidden)
- On respawn selection:
  - client sends `chooseRespawn { spawnId }`
  - server validates spawnId is allowed and sets new position
  - set alive=true
  - apply invulnerability window (e.g. RESPAWN_INVULN)
  - emit `RESPAWN_RESULT { ok:true, spawnId }`

### 2.5 Money + pickups
- Each player starts with money (default 100).
- Pickups exist in world and are included in snapshots:
  - `pickups: [{ id, type:"money", x, y, amount? }, ...]`
- When collected server-side:
  - remove pickup from game.pickups
  - add to player.money

### 2.6 Upgrades
Two categories:
- **Consumables** (3 slots): used via hotkeys **8 / 9 / 0**.
- **Permanents** (list): always active.

Offer flow:
- Server emits `UPGRADE_OFFER { offerId, options[] }` to the player.
- Client picks using `chooseUpgrade { offerId, upgradeId }`.
- If consumable slots full:
  - server responds `UPGRADE_RESULT { ok:false, reason:"slots_full", requested, slots }`
  - client responds `chooseUpgradeReplace { offerId, upgradeId, dropId }`
- On success:
  - server responds `UPGRADE_RESULT { ok:true, applied, chosen, upgrades }`

Using consumables:
- Client sends `useUpgradeSlot { slotIndex: 0..2 }`.
- Server validates:
  - player alive
  - no prompt/offer open (server-side safety)
  - slot exists and has usesLeft
- Server decrements usesLeft; removes slot if 0.
- Server emits `UPGRADE_USED { ok:true, used, removed?, upgrades }` or `{ ok:false, reason }`.

---

## 3) Client controls (current)
- Move: WASD / Arrow keys
- Interact: E
- Shoot: hold Space
- Use consumable upgrades: 8 / 9 / 0
- Debug fog: V (mask), B (edge ring)

Client input payload:
`{ up:boolean, down:boolean, left:boolean, right:boolean, fire:boolean }`

---

## 4) Data model (canonical)

### 4.1 Map
- `world: { w, h }`
- `walls: [{ x, y, w, h }, ...]`
- `machines: [{ id, num, x, y }, ...]` (x,y are centers)
- Optional: spawn metadata for UI (server still sends respawn options explicitly)

### 4.2 Player (snapshot shape)
Minimum fields used by client:
- `id, name, teamId`
- `x, y`
- `dirX, dirY`
- `nextMachineNum`
- `alive`
- `money`
- `upgrades: { slots, permanent }`

### 4.3 Snapshot (STATE_SNAPSHOT)
Client expects:
- `world` (optional but recommended)
- `players[]` (required)
- `bullets[]` (optional)
- `pickups[]` (optional)

Recommended bullet shape:
- `{ id?, ownerId, x, y }`

Recommended pickup shape:
- `{ id, type:"money", x, y, amount? }`

---

## 5) Networking events (canonical)

### 5.1 Connection / identity
Server → Client
- `WELCOME { playerId }`

Client → Server
- `hello { name }`

### 5.2 Lobby flow
Client → Server
- `createGame { mode, teamCount, tableBase, mapChoice, inputMode }`
- `joinGame { gameCode }`
- `assignTeam { playerId, teamId }` (host only, teams mode)
- `startGame {}`

Server → Client
- `GAME_CREATED { gameCode }`
- `JOIN_SUCCESS { gameCode, players, teams?, settings }`
- `JOIN_FAILED { reason }`
- `LOBBY_UPDATE { players, settings }`
- `GAME_STARTED { map, settings }`

### 5.3 In-game
Client → Server
- `input InputState`
- `tryInteract {}`
- `submitAnswer { promptId, answer }`
- `chooseUpgrade { offerId, upgradeId }`
- `chooseUpgradeReplace { offerId, upgradeId, dropId }`
- `useUpgradeSlot { slotIndex }`
- `chooseRespawn { spawnId }`

Server → Client
- `STATE_SNAPSHOT Snapshot`
- `MATH_PROMPT { promptId, base, machineNum }`
- `ANSWER_RESULT { ok, correct? }`
- `INTERACT_DENIED { reason, nextMachineNum?, tried? }`
- `UPGRADE_OFFER { offerId, options[] }`
- `UPGRADE_RESULT { ok, reason?, upgrades?, requested?, slots?, chosen?, applied? }`
- `UPGRADE_USED { ok, reason?, used?, removed?, upgrades? }`
- `RESPAWN_OPTIONS { options[] }`
- `RESPAWN_RESULT { ok, reason?, spawnId? }`
- Optional: `PLAYER_DIED { playerId }`

---

## 6) Constants (defaults)
- INTERACT_RADIUS = 60
- Player size: 28×28 (PLAYER_HALF = 14)
- Machine draw size: 20×20 (MACHINE_HALF = 10) for visuals
- Tick rate: 20 Hz (server)
- Fog-of-war is client-only (cone length/angle are client tuning)

---

## 7) “Do not break” checklist
- `STATE_SNAPSHOT` must always include `players[]`.
- Each player must include `id,x,y,dirX,dirY,alive,money,upgrades`.
- `GAME_STARTED.map.walls` must be rectangles `{x,y,w,h}` (client fog uses them).
- Machine prompt uses promptId roundtrip.
- Upgrade offer uses offerId roundtrip.
- Respawn uses spawnId from server-provided options.

---

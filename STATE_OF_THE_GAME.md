# Timetable Clowns — State of the Game (Restart Kit)

When starting a NEW chat thread, paste:
1) this file (STATE_OF_THE_GAME.md)
2) PROTOCOL.md
3) the file currently being edited

Last updated: 2026-02-07

---

## Current folder structure (actual)

timetable-clowns/
- PROTOCOL.md
- STATE_OF_THE_GAME.md
- server/
  - index.js
  - package.json
  - economy.js
  - upgrades/
    - definitions.js
    - apply.js
  - shared/
    - constants.js
  - maps/
    - index.js
    - map01.js
- client/
  - index.html

---

## What works right now (implemented)

### Lobby / multiplayer
- Host / guest flow works
- Join via game code works
- Host assigns teams (Teams mode) via lobby dropdowns
- Start game validation:
  - >= 2 players
  - Teams mode: all players must have a `teamId`

### Host settings (implemented)
Host sends these settings on `createGame`:
- `mode`: `"ffa"` or `"teams"`
- `teamCount`: 1–4 (Teams only)
- `friendlyFire`: boolean (Teams only)
- `tableBase`: 1–10
- `mapChoice`: `"map01"` or `"random"`
- `inputMode`: `"kb" | "kbm" | "kbm_gamepad"` (client UI exists; gameplay is keyboard-driven currently)
- `sessionMode`: `"standard"` or `"timed"`
- `sessionMinutes`: 1–60 (Timed only; default 5)
- `winMode`: `"standard"` or `"money"`

### Map (map01)
- `map01` = “Training Hall (10 rooms)”
- World size: `{ w: 2400, h: 1600 }`
- 10 rooms, each with >= 2 openings
- Exactly 1 machine per room, machine numbers 1–10
- Walls are generated and sent to client
- Machines are sent to client and are treated as solid for collisions

### Movement + collisions
- Server is authoritative for movement
- Player speed: `PLAYER_SPEED = 220 px/s`
- Player collision size: `PLAYER_HALF = 14` (AABB 28×28)
- Collision resolution is “slide”:
  - attempt X move, apply if not colliding
  - attempt Y move, apply if not colliding
- Collisions include:
  - map walls (AABB)
  - machines (AABB centered at machine with `MACHINE_HALF = 10`)

### Shooting / bullets (cakes)
- Shooting is server authoritative
- Bullet speed: `BULLET_SPEED = 780 px/s`
- Bullet TTL: `BULLET_TTL = 2.0`
- Fire cooldown: `FIRE_COOLDOWN = 0.5`
- Bullet removal happens on:
  - TTL expiry
  - world bounds exit
  - collision with walls (swept segment vs expanded AABB)
  - collision with machines (swept segment vs expanded AABB)
  - collision with players (swept segment vs circle)
- Bullet collision tuning:
  - `BULLET_HIT_R_WALL = 4`
  - `BULLET_HIT_R_MACHINE = 6`
  - `CAKE_HIT_R_PLAYER = 12` (extra padding beyond `PLAYER_HALF`)
- Sub-stepping is used to avoid tunneling:
  - travel distance split into steps (max step length ~10px)
- Spawn safety:
  - server pushes the spawn point forward if it starts inside an expanded collision rect
  - if still blocked, shot is canceled without consuming ammo

### Ammo (cakes)
- Players have cakes (ammo)
- `MAX_CAKES = 7`
- Shooting consumes 1 cake
- Cakes are refilled to MAX when a correct machine answer is given

### Machines + math prompts
- Interaction radius: `INTERACT_RADIUS = 60`
- Key: E (client sends `tryInteract`)
- Must do machines in order per-player:
  - `nextMachineNum` starts at 1
  - correct increments up to 10
  - cannot interact out-of-order
- Server emits:
  - `MATH_PROMPT { promptId, base, machineNum }`
  - `ANSWER_RESULT { ok, correct? }`
  - `INTERACT_DENIED { reason, nextMachineNum, tried }`

### Economy
- Each player starts with `$100`
- Money pickups exist (`type: "money"`)
- Server handles pickup collection (economy module)
- On correct answer:
  - server awards money via economy module (spawns / pickup logic)
- On wrong answer:
  - server penalizes via economy module

### Upgrades
- Upgrades exist with:
  - Permanents (buy cost, stacking count)
  - Consumables (3 slots, use cost, use via 8/9/0)
- Upgrade pool:
  - server picks a random pool (size 9) at match start
- Offer system:
  - after correct answer, server emits `UPGRADE_OFFER` with options
  - player can choose an upgrade or decline (`declineUpgrade`)
- Backpack full flow:
  - if consumable slots are full and a new consumable is chosen:
    - server returns `UPGRADE_RESULT { ok:false, reason:"slots_full", requested, slots }`
    - client shows replace UI and can send `chooseUpgradeReplace`

#### Permanent fog upgrades (implemented)
Two permanent upgrades affect fog-of-war rendering:

**Glasses (`big_eyes`)**
- Widens fog cone angle
- Stacks linearly (client uses stack count from snapshot)

**Giraffoscope**
- Increases fog cone length
- Stacks linearly (client uses stack count from snapshot)

Client fog currently computes:
- `coneAngleDeg = BASE + stacks(big_eyes) * perStack`
- `visionLen = BASE + stacks(giraffoscope) * perStack`
(with caps to avoid extreme values)

### Death + respawn
- Players can be killed by bullets
- On death:
  - server emits `PLAYER_DIED { playerId }` to room
  - server emits `RESPAWN_OPTIONS` to dead player
- Respawn options:
  - corners always
  - cleared machines as optional spawn points (implemented via a per-player `clearedMachines` Set)
- Invulnerability after respawn:
  - `RESPAWN_INVULN = 0.6s`
  - server sets `invulnUntil` (ms timestamp)
  - client shows invuln HUD pill + blink effect
- Killed-by info:
  - `RESPAWN_OPTIONS` includes `{ killedBy: <name>, options:[...] }`
  - client shows “Killed by: X” in respawn modal

### Timed sessions (implemented)
- Host can choose:
  - Session: Standard / Timed
  - Minutes (Timed only)
- Server sets `endAt` at game start (Timed only)
- Server ends match automatically when `now >= endAt`
- Client shows timer pill while running
- `endAt` is provided in:
  - `GAME_STARTED`
  - `STATE_SNAPSHOT`

### Game end + leaderboard (implemented)
- Game ends when:
  1) Machine 10 is correctly answered (reason: `"machine10"`)
  2) Time runs out in timed session (reason: `"time"`)
- Server emits:
  - `GAME_ENDED { reason, endedAt, winnerId, winnerName, winnerTeamId, leaderboard, winMode }`
- Winner selection:
  - FFA: top leaderboard row
  - Teams: server aggregates team totals, chooses `winnerTeamId`, and provides a representative `winnerId/winnerName`
- Client end screen:
  - large end modal
  - winner banner is big; Teams winner shows “TEAM X 🏆”
  - leaderboard highlights:
    - Teams: all rows from winning team
    - FFA: winner row
  - only action: “Back to lobby” (reload)

### Client rendering + UI (client/index.html)
- Canvas rendering with camera centered on “me”
- Fog-of-war cone implemented (debug toggles V and B)
- HUD shows:
  - money
  - life
  - cakes
  - invulnerability countdown
  - timer pill in timed sessions (MM:SS)
- Overlays implemented:
  - math prompt
  - upgrade picker
  - backpack full replace picker
  - respawn picker
  - game ended / leaderboard overlay
- Input handling:
  - movement WASD/arrow
  - shooting hold space
  - E interact
  - 8/9/0 use consumables
  - client blocks gameplay input while overlays are open

---

## What is NOT implemented yet (next work)

### Consumable effects / usesLeft semantics (depends on upgrades module decisions)
- `useUpgradeSlot` charges money and emits `UPGRADE_USED`
- If you want gameplay effects (speed, vision beyond fog, etc.), implement server-side effects in upgrades module and reflect any “usesLeft” decrement/removal rules consistently in snapshots.

### Optional: richer end-of-game flows
- Host ends match early
- Match canceled on host disconnect
- Return-to-lobby without full reload (currently reload is the design)

### Optional: additional stats
- accuracy
- damage dealt
- machines-cleared count vs correct count (currently correct increments on correct answers)

---

## Current constants (server/index.js)

Movement:
- `TICK_HZ = 20`
- `PLAYER_SPEED = 220`
- `PLAYER_HALF = 14`

Interaction:
- `INTERACT_RADIUS = 60`
- `MACHINE_HALF = 10`

Bullets:
- `BULLET_SPEED = 780`
- `BULLET_TTL = 2.0`
- `BULLET_HIT_R_WALL = 4`
- `BULLET_HIT_R_MACHINE = 6`
- `CAKE_HIT_R_PLAYER = 12`
- `FIRE_COOLDOWN = 0.5`

Respawn:
- `RESPAWN_INVULN = 0.6`
- `CORNER_PAD = 80`

Ammo:
- `MAX_CAKES = 7`

Timed sessions:
- `SESSION_STANDARD = "standard"`
- `SESSION_TIMED = "timed"`
- `MIN_SESSION_MIN = 1`
- `MAX_SESSION_MIN = 60`

Win modes:
- `WIN_MODE_STANDARD = "standard"`
- `WIN_MODE_MONEY = "money"`

---

## Wire protocol snapshot (current reality)

Server → Client events in use:
- `WELCOME { playerId }`
- `GAME_CREATED { gameCode }`
- `JOIN_SUCCESS { gameCode, players, settings }`
- `JOIN_FAILED { reason }`
- `LOBBY_UPDATE { players, settings }`
- `GAME_STARTED { map, settings, endAt? }`
- `STATE_SNAPSHOT { time, world, phase, endAt?, pickups, bullets, players }`
- `MATH_PROMPT { promptId, base, machineNum }`
- `ANSWER_RESULT { ok, correct? }`
- `INTERACT_DENIED { reason, nextMachineNum, tried }`
- `UPGRADE_OFFER { offerId, options }`
- `UPGRADE_RESULT { ok, reason?, ... }`
- `UPGRADE_DECLINED { ok, reason? }`
- `UPGRADE_USED { ok, reason?, ... }`
- `PLAYER_DIED { playerId }`
- `RESPAWN_OPTIONS { killedBy?, options }`
- `RESPAWN_RESULT { ok, reason? }`
- `GAME_ENDED { reason, endedAt, winnerId, winnerName, winnerTeamId, leaderboard, winMode }`

Client → Server events in use:
- `hello { name }`
- `createGame { mode, teamCount, friendlyFire, tableBase, mapChoice, inputMode, sessionMode, sessionMinutes, winMode }`
- `joinGame { gameCode }`
- `assignTeam { playerId, teamId }`
- `startGame`
- `input { up, down, left, right, fire }`
- `tryInteract`
- `submitAnswer { promptId, answer }`
- `chooseUpgrade { offerId, upgradeId }`
- `declineUpgrade { offerId }`
- `chooseUpgradeReplace { offerId, upgradeId, dropId }`
- `useUpgradeSlot { slotIndex }`
- `chooseRespawn { spawnId }`

---

## Known issues / pitfalls (practical)

- Bullet “vanish immediately” typically means spawn started inside an expanded collision rect:
  - server has a push-forward safety loop; if you ever change radii, re-check this behavior
- Input handling can get buggy if key listeners are duplicated/nested:
  - keep listeners flat and always gate with “UI blocking” checks
- Performance:
  - keep per-frame work in canvas; avoid per-frame DOM writes beyond HUD text changes

# Timetable Clowns — State of the Game (Restart Kit)

When starting a NEW chat thread, paste:
1) this file (STATE_OF_THE_GAME.md)
2) PROTOCOL.md
3) the file currently being edited

Last updated: 2026-02-06

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
  - Teams mode: all players must have teamId

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
  - machines (treated as AABB centered at machine with `MACHINE_HALF = 10`)

### Shooting / bullets (cakes)
- Shooting is server authoritative
- Bullet speed: `BULLET_SPEED = 780 px/s`
- Bullet TTL: `BULLET_TTL = 2.0` (user-confirmed range feels right)
- Bullet removal happens on:
  - TTL expiry
  - world bounds exit
  - collision with walls (swept segment vs expanded AABB)
  - collision with machines (swept segment vs expanded AABB)
  - collision with players (swept segment vs circle)
- Bullet collision tuning:
  - `BULLET_HIT_R_WALL = 4`
  - `BULLET_HIT_R_MACHINE = 6`
  - `CAKE_HIT_R_PLAYER = 12` (player hit radius padding)
- Sub-stepping is used to avoid tunneling on fast bullets:
  - travel distance split into steps (max step length ~10px)

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
- Server handles pickup collection
- On correct answer:
  - server awards money via economy module (spawns / pickup logic)
- On wrong answer:
  - server can penalize via economy module

### Upgrades
- Upgrades exist with:
  - Permanents (buy cost, stacking count, max 3 types)
  - Consumables (3 slots, use cost, use via 8/9/0)
- Offer system:
  - After correct answer, server emits `UPGRADE_OFFER` with options
  - Player can choose an upgrade or decline
- Backpack full flow:
  - If consumable slots are full and a new consumable is chosen:
    - server returns `UPGRADE_RESULT { ok:false, reason:"slots_full", requested, slots }`
    - client shows replace UI and can send `chooseUpgradeReplace`
- Client renders two upgrade sections:
  - Consumables slots (8/9/0)
  - Permanents with stacking count

### Death + respawn
- Players can be killed by bullets
- On death:
  - server marks player dead and emits `PLAYER_DIED { playerId }` to room
  - server emits `RESPAWN_OPTIONS` to dead player
- Respawn options:
  - corners always
  - cleared machines as optional spawn points (implemented as a Set per player)
- Invulnerability after respawn:
  - `RESPAWN_INVULN = 0.6s`
  - server sets `invulnUntil` timestamp
  - client shows invuln HUD pill + blink effect
- ✅ Killed-by info:
  - server tracks killer name on death
  - `RESPAWN_OPTIONS` includes `{ killedBy: <name>, options:[...] }`
  - client shows “Killed by: X” in respawn modal

### Client rendering + UI (client/index.html)
- Canvas rendering with camera centered on “me”
- Fog-of-war cone implemented (debug toggles V and B)
- HUD shows:
  - money
  - life
  - cakes
  - invulnerability countdown
  - ✅ timer pill in timed sessions (MM:SS)
- Overlays implemented:
  - math prompt
  - upgrade picker
  - backpack full replace picker
  - respawn picker
  - ✅ game ended / leaderboard overlay (large winner banner)
- Input handling:
  - movement WASD/arrow
  - shooting hold space
  - E interact
  - 8/9/0 use consumables
  - client blocks gameplay input while overlays are open
- Known safety constraint:
  - Avoid nested duplicate `window.addEventListener("keydown", ...)` patterns (previous bug class)

### ✅ Timed session setting (implemented)
- Host chooses in lobby:
  - session type: Standard / Timed
  - minutes (Timed only)
- Server sets `endAt` when match starts (Timed only)
- Client shows timer pill while running
- Server ends match automatically when `now >= endAt`

### ✅ Game end + leaderboard (implemented)
- Game ends when:
  1) **Machine 10** is correctly answered (reason: `"machine10"`)
  2) **Time runs out** in timed session (reason: `"time"`)
- When ended:
  - client shows large end modal
  - winner is visually highlighted
  - only action: “Back to lobby” (reload)
- Server event:
  - `GAME_ENDED { reason, endedAt, winnerId, winnerName, winnerTeamId, leaderboard }`
- Server tracks stats:
  - correct answers count
  - kills, deaths
  - money
  - (teamId exists on player)
- Leaderboard currently sorts by:
  - correct desc, then kills desc, then money desc, then deaths asc

---

## What is NOT implemented yet (next work)

### Winner computation for Teams mode (recommended next)
Current end-game payload includes winner fields, but:
- If you want **“winning team”** (aggregate team score) rather than “winning player”,
  server needs to compute:
  - team totals (sum correct/kills/money or chosen rules)
  - choose winning teamId
  - send winnerTeamId consistently for Teams sessions
  - optionally: show team totals on leaderboard or separate team leaderboard

### Optional: richer end reasons / UX
- If you want “match canceled” / host ended / disconnect end
- If you want “play again” without full reload (currently you reload)

### Optional: leaderboard fields
- If you want accuracy %, streaks, damage dealt, etc.
- If you want machines-cleared count separate from correct count

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

---

## Wire protocol snapshot (current reality)

Server → Client events in use:
- `WELCOME { playerId }`
- `GAME_CREATED { gameCode }`
- `JOIN_SUCCESS { gameCode, players, settings }`
- `JOIN_FAILED { reason }`
- `LOBBY_UPDATE { players, settings }`
- `GAME_STARTED { map, settings, endAt }`
- `STATE_SNAPSHOT { time, world, phase, endAt, pickups, bullets, players }`
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
- `GAME_ENDED { reason, endedAt, winnerId, winnerName, winnerTeamId, leaderboard }`

Client → Server events in use:
- `hello { name }`
- `createGame { mode, teamCount, friendlyFire, tableBase, mapChoice, inputMode, sessionMode, sessionMinutes }`
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

## Known issues / pitfalls
- If bullets appear to “vanish immediately”, common cause is spawning inside an expanded collision rect:
  - solved by spawn push-forward safety check (already in server file)
- If bullets pass through walls, common cause is discrete movement without sweep:
  - current server uses swept segment vs expanded AABB (should be reliable)
- Input handling bugs can occur if multiple nested key listeners are used:
  - keep input listeners flat and guard with “UI blocking” checks
- School PCs / performance:
  - keep collision math simple and avoid expensive per-frame DOM

---

## Next concrete tasks (recommended order)

1) Teams-mode winner calculation:
   - compute team totals
   - fill `winnerTeamId` consistently
   - update client winner banner to emphasize the team

2) Improve end-game payload completeness:
   - always include winner fields even on time end (already done)
   - optionally include `endedBy` / `winnerReason` etc.

3) Expand leaderboard:
   - include `teamId` in rows if you want to show it
   - add columns you care about

4) Optional: non-reload return-to-lobby flow
   - reset state on client + server without `location.reload()`

---

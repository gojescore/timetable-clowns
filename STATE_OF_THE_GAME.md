# Timetable Clowns — State of the Game (Restart Kit)

When starting a NEW chat thread, paste:
1) this file (STATE_OF_THE_GAME.md)
2) PROTOCOL.md
3) the file currently being edited

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
- Host / guest flow
- Join via game code
- Host assigns teams (teams mode)
- Game start validation:
  - ≥ 2 players
  - all players have a team in teams mode

---

## Map
- `map01` with:
  - 10 rooms
  - each room has ≥ 2 openings
- `maps/index.js`:
  - builds perimeter walls with gaps
  - flattens machines to `map.machines`
  - attaches runtime helpers (`isRoad`)

---

## Movement + collisions
- Server-authoritative tick loop (20 Hz)
- Axis-normalized movement (no faster diagonals)
- Collision against:
  - walls
  - machines
- World clamping uses player half-size
- Client renders:
  - world
  - walls
  - players
  - machines

---

## Machine interaction (ordered)
- Press **E** near a machine
- Must interact in numeric order (1 → 10)
- Server enforces:
  - alive
  - within `INTERACT_RADIUS`
  - machine not already cleared by that player
  - machine number equals `nextMachineNum`
- Wrong order:
  - server emits `INTERACT_DENIED`
  - client shows speech bubble feedback

---

## Times-table prompt
- Server emits `MATH_PROMPT`
- Client shows modal input
- Answer validated server-side
- Correct:
  - machine marked cleared (per player)
  - `nextMachineNum` increments
  - money awarded (via economy)
  - upgrade offer created
- Wrong:
  - server emits `ANSWER_RESULT { ok:false }`
  - economy penalty applied

---

## Fog-of-war + Line-of-Sight (implemented) ✅
- Fog-of-war is always active during gameplay
- Player vision is a **cone-shaped LOS**
- The cone:
  - is fully transparent (100% clear)
  - is the only way to see the map
- Visibility is blocked by walls (raycast-based LOS)
- Fog completely hides:
  - floors
  - walls
  - machines
  - pickups
- Walls become visible only when inside the cone
- Soft edge at cone boundary (blurred falloff, no leaks)
- Camera is pixel-aligned to prevent fog seams
- Debug tools (client-only):
  - `V` toggles raw visibility mask
  - `B` toggles soft-edge visualization

---

## Economy (fully implemented) ✅

### Server
- Start money: **100**
- Wrong answer: **−100** (floored at 0)
- Correct answer:
  - spawns money pickups
- Pickups:
  - spawn only on roads
  - never inside rooms or walls
  - collected by proximity
  - removed on collect

### Client
- HUD shows **current money**
- Pickups rendered as green `$` rectangles

---

## Upgrade system (implemented: storage + costs, effects later) ✅

### Server
- Upgrade definitions exist (`server/upgrades/definitions.js`)
- After a **correct machine answer**:
  - server emits `UPGRADE_OFFER { offerId, options[] }`
- A **fixed random pool** of upgrades is chosen once per match (default: 9).
- Upgrade storage model:
  - **Permanents**:
    - Stored in `player.upgrades.permSlots`
    - Max **3 unique types**
    - Each slot is `{ id, count }`
    - **Stacking allowed** (picking the same permanent increments `count`)
    - Each acquisition costs money (`acquireCost`)
  - **Consumables**:
    - Stored in `player.upgrades.consSlots`
    - Max **3**
    - Each slot is `{ id }`
    - **No duplicates allowed**
    - Cost is paid **per use** (`useCost`)
- Money enforcement:
  - Permanent cost checked on acquisition
  - Consumable cost checked on use
  - Insufficient funds → server rejects with `not_enough_money`
- Replace flow (consumables only):
  - If consumable slots are full:
    - server responds  
      `UPGRADE_RESULT { ok:false, reason:"slots_full", requested, slots }`
  - Client chooses which consumable to drop
  - Server applies replacement

### Client
- Upgrade picker overlay (grid)
- Hover shows description
- Sidebar upgrade bar with two sections:
  - **Consumables** (hotkeys **8 / 9 / 0**)
  - **Permanents** (passive, stacking shown as `x2`, `x3`, …)
- Drop / replace overlay when consumable slots are full
- Client renders upgrades **only from `STATE_SNAPSHOT`**
  - (event payloads may contain server-internal shapes)

---

## Combat + respawn (partially implemented)

### Combat
- Shooting exists server-side with:
  - bullets
  - TTL
  - wall + machine collision
- Player hit detection exists
- Death state:
  - `alive = false`
  - dead players cannot move, shoot, interact, or use upgrades
- Client:
  - hides dead players completely (body + label)

### Friendly fire (intended rule)
- **Teams mode**: friendly fire **OFF by default**
- **FFA mode**: everyone is an enemy
- Friendly fire is configurable in lobby settings
- Server enforcement may still be under active iteration

---

## Respawn
- On death:
  - server emits `RESPAWN_OPTIONS` to dead player only
- Client:
  - shows respawn picker overlay
  - sends `chooseRespawn { spawnId }`
- Server:
  - validates spawnId
  - repositions player
  - sets `alive=true`
  - applies invulnerability window
  - emits `RESPAWN_RESULT`

---

## UI / layout (implemented)
- Arena is a canvas that fills available space without distortion
- HUD is overlaid (does not consume layout height)
- Right sidebar contains:
  - Leave / back button
  - Upgrade slots (consumables + permanents)
- Top chrome is hidden during gameplay to maximize space

---

## Known constraints / gotchas
- `structuredClone()` removes functions
- Map helpers must be re-attached at runtime
- Client uses:
  - map data from `GAME_STARTED`
  - players / bullets / pickups from `STATE_SNAPSHOT`

---

## Current visual placeholders
- Players: rectangles (hidden when dead)
- Machines: yellow squares
- Pickups: green `$`
- Upgrades: text-only UI

(Images / sprites planned later, after gameplay locks.)

---

## Next ONE task (choose exactly one)
- Enforce **no friendly fire** on server (teams mode)
- Combat polish (hit feedback, cooldown tuning)
- Respawn polish (spawn safety + invuln feedback)
- Sprite / image system

⚠️ Rule: **only one system per iteration**

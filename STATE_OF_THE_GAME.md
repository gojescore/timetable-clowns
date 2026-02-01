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
- Host assigns teams
- Game start validation:
  - >= 2 players
  - all players have teamId

### Map
- `map01` with:
  - 10 rooms
  - each room has ≥ 2 openings
- `maps/index.js`:
  - builds perimeter walls with gaps
  - flattens machines to `map.machines`
  - attaches runtime helpers (`isRoad`)

### Movement + collisions
- Server-authoritative tick loop
- Axis-normalized movement
- Collision with:
  - walls
  - machines
- Client renders:
  - world
  - walls
  - players
  - machines

### Machine interaction (ordered)
- Press **E** near machine
- Must interact in numeric order
- Wrong order:
  - server emits `INTERACT_DENIED`
  - client shows speech bubble

### Times-table prompt
- Server sends `MATH_PROMPT`
- Client shows modal
- Answer validated server-side

### Fog-of-war + Line-of-Sight (implemented) ✅
- Fog-of-war is always active during gameplay
- Player vision is a **cone-shaped LOS**
- The cone is:
  - fully transparent (100% clear)
  - the only way to see the map
- Visibility is blocked by walls (raycast-based LOS)
- Fog completely hides:
  - floors
  - walls
  - machines
  - pickups
- Walls become visible only when inside the cone
- Soft edge at cone boundary (blurred falloff, no leaks)
- Camera is pixel-aligned to prevent fog seams
- Debug tools exist but are optional:
  - `V` toggles raw visibility mask
  - `B` toggles soft-edge visualization

---

## Economy (fully implemented) ✅

### Server
- Start money: **100**
- Wrong answer: **-100** (floored at 0)
- Correct answer:
  - spawns money pickups
- Pickups:
  - spawn only on roads
  - never inside rooms or walls
  - collected by proximity
  - removed on collect or TTL expiry

### Client
- HUD shows **your money**
- Pickups rendered as green `$` rectangles (2× size)

---

## Upgrade system (implemented scaffold) ✅

### Server
- Upgrade definitions exist
- After correct answer:
  - server sends `UPGRADE_OFFER`
- Rules:
  - unlimited permanent upgrades
  - max **3** consumable upgrades
  - full slots trigger replace flow
- Replace flow:
  - server sends list of carried upgrades
  - client chooses which to drop
  - server applies replacement

### Client
- Upgrade grid overlay
- Hover shows description
- Bottom upgrade bar
- Drop-selection overlay when full

---

## Combat + respawn (in progress / partially implemented)
- Shooting exists server-side with bullets + TTL + wall/machine collision.
- Player hit detection exists.
- Death state exists (`alive=false`) and dead players should not move/shoot/interact.
- Client now hides dead players completely (body + label not drawn).
- Respawn flow exists:
  - server emits `RESPAWN_OPTIONS` to the dead player
  - client shows respawn picker overlay
  - client sends `chooseRespawn { spawnId }`
  - server validates and emits `RESPAWN_RESULT`

### Friendly fire (current intended rule)
- Teams mode: **no friendly fire** (same team should not damage)
- FFA mode: everyone is enemy (except self)
- (This is a rule in PROTOCOL; server enforcement may be next step if not fully done.)

---

## UI / layout (implemented)
- Arena is a canvas that fills the available area without distorting objects.
- HUD is overlaid on top of the arena (z-axis), not taking vertical layout space.
- Right sidebar contains:
  - Leave / back button
  - Upgrade slots column (8/9/0)
- This frees more vertical space for gameplay.

---

## Known constraints / gotchas
- `structuredClone()` removes functions.
- All map helpers must be re-attached at runtime.
- Client uses:
  - map data from `GAME_STARTED`
  - pickups + players + bullets from `STATE_SNAPSHOT`

---

## Current visual placeholders
- Players = rectangles (hidden if dead)
- Machines = yellow squares
- Pickups = green `$`
- Upgrade icons = text only

(Images / sprites are planned **later**, after gameplay locks.)

---

## Next ONE task (to choose)
- Enforce **no friendly fire** on server in teams mode
- Combat polish (hit feedback, cooldown tuning)
- Respawn polish (spawn safety + invuln feedback)
- Sprite / image system (players, machines, pickups)

⚠️ Rule: **only one system per iteration**

# Timetable Clowns — State of the Game (Restart Kit)

When starting a NEW chat thread, paste:
1) this file (STATE_OF_THE_GAME.md)  
2) PROTOCOL.md  
3) the file currently being edited  

This file describes **what is actually implemented and working right now**, not future plans.

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
  - at least 2 players
  - all players have a team in teams mode
- Friendly fire setting is selectable in lobby and passed to server

---

## Map
- `map01` implemented:
  - 10 rooms
  - each room has ≥ 2 openings
- `maps/index.js`:
  - builds perimeter walls with gaps
  - flattens machines to `map.machines`
  - attaches runtime helpers (e.g. `isRoad`)
- Map data is sent once via `GAME_STARTED`
- World size defaults to `{ w:2400, h:1600 }`

---

## Movement + collisions
- Server-authoritative tick loop (20 Hz)
- dt-based movement
- Direction vectors normalized (no faster diagonals)
- Collision against:
  - walls
  - machines (solid)
- World clamping uses player half-size (28×28 player)

Client:
- Renders players, walls, machines
- Camera follows local player and is pixel-aligned

---

## Machine interaction (ordered progression)
- Press **E** near machine
- Must interact in numeric order per player
- Server validates:
  - alive
  - distance ≤ INTERACT_RADIUS
  - not already cleared
  - correct `nextMachineNum`
- Wrong order:
  - server emits `INTERACT_DENIED`
  - client shows speech bubble feedback

---

## Times-table prompt
- Server emits `MATH_PROMPT`
- Client shows modal
- Answer validated server-side
- On correct:
  - machine marked cleared for that player
  - `nextMachineNum` increments
  - cakes (ammo) refilled
  - money awarded via economy
  - upgrade offer sent
- On wrong:
  - server emits `ANSWER_RESULT { ok:false }`
  - money penalty applied (floored at 0)

---

## Fog-of-war + line-of-sight (fully implemented) ✅
- Fog-of-war is always active during gameplay
- Player vision is a **cone-shaped LOS**
- Only visible area is rendered:
  - floors, walls, machines, pickups outside cone are hidden
- Visibility blocked by walls (raycast-based)
- Soft edge at cone boundary (blurred falloff)
- Camera and fog buffers are pixel-aligned (no seams)

Debug tools (client-only):
- `V` toggles raw visibility mask
- `B` toggles soft-edge visualization

---

## Economy (fully implemented) ✅

### Server
- Start money: **100**
- Wrong answer penalty: **-100** (floored at 0)
- Correct answer:
  - spawns money pickups
- Pickups:
  - spawn only on roads
  - never inside rooms or walls
  - collected by proximity
  - removed on collect or TTL expiry

### Client
- HUD shows current money
- Pickups rendered as green `$` blocks

---

## Upgrade system (implemented scaffold) ✅

### Server
- Upgrade definitions exist
- Fixed random upgrade pool (9) chosen at game start
- After correct answer:
  - server emits `UPGRADE_OFFER`
- Rules:
  - permanent upgrades: unlimited stacking, max 3 types
  - consumables: max 3 slots
- Full slots trigger replace flow
- Money enforcement:
  - permanent: pay acquire cost on pick
  - consumable: pay use cost on use

### Client
- Upgrade picker grid overlay
- Hover tooltips (via title)
- Bottom upgrade bar:
  - consumables (8 / 9 / 0)
  - permanents (stack count)
- Replace flow UI when backpack is full
- Decline upgrade supported (Escape / Close)

---

## Combat + bullets (mostly implemented) ⚠️
- Shooting exists server-side
- dt-based cooldown
- Bullets:
  - TTL-based lifetime
  - collide with walls and machines
  - swept collision against players
- Friendly fire:
  - Teams mode + friendlyFire OFF → teammates cannot be killed
  - Teams mode + friendlyFire ON → teammates can be killed
  - FFA → everyone except self is a valid target

Client:
- Bullets rendered as 🍰 emoji projectiles

---

## Death + respawn (implemented) ✅
- Player has `alive` state
- On death:
  - movement, shooting, interaction disabled
  - pending prompt and upgrade offer cleared
  - server emits `PLAYER_DIED`
  - server emits `RESPAWN_OPTIONS` to dead player only
- Client:
  - hides dead players completely
  - shows respawn picker overlay

Respawn:
- Client sends `chooseRespawn { spawnId }`
- Server validates spawnId
- Player repositioned safely
- Player revived with:
  - `alive = true`
  - `invulnUntil = Date.now() + RESPAWN_INVULN`
  - cakes refilled
- Client closes respawn overlay on success

---

## Invulnerability (implemented) ✅
- Invulnerability window after respawn
- Server ignores bullet hits while:
  - `Date.now() < invulnUntil`
- Client currently:
  - does not show explicit visual indicator
  - behavior is correct server-side

---

## Snapshot (STATE_SNAPSHOT) — actual shape used

Server sends on every tick:

```js
{
  time,
  world,
  players: [{
    id,
    name,
    teamId,
    x, y,
    dirX, dirY,
    nextMachineNum,
    alive,
    money,
    cakes,
    invulnUntil,
    upgrades: {
      permanent: [{ id, count, info }],
      slots: [{ id, info, usesLeft? }]
    }
  }],
  bullets: [{ id, ownerId, ownerTeamId?, x, y }],
  pickups: [{ id, type:"money", x, y, amount? }]
}

UI / layout (implemented)

Canvas fills available space without distortion

HUD overlays on top of arena (no layout shift)

Right sidebar:

Leave button

Consumable slots

Permanent upgrades

Top lobby UI hidden during gameplay for maximum viewport

Known constraints / gotchas

structuredClone() removes functions

Map helpers must be reattached at runtime

Client only uses:

map data from GAME_STARTED

dynamic entities from STATE_SNAPSHOT

Current visual placeholders

Players: rectangles

Machines: yellow squares

Bullets: 🍰 emoji

Pickups: green $

Upgrade icons: text only

(Sprites and animations are explicitly deferred.)

Next ONE task (choose exactly one)

Respawn polish (visual invulnerability feedback)

Combat polish (hit feedback, cooldown tuning)

Sprite / image system

Pickup feedback / juice

⚠️ Rule: one system per iteration only

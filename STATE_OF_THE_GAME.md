# Timetable Clowns — State of the Game (Restart Kit)

When starting a NEW chat thread, paste ALL THREE:
1) STATE_OF_THE_GAME.md
2) PROTOCOL.md
3) the file currently being edited

Last updated: 2026-02-10

---------------------------------------------------------------------

🔒 NON-NEGOTIABLE RULE

Client may display upgrades,
but must never compute gameplay modifiers from them.

All gameplay modifiers come only from `player.mods`
computed by the server and sent in `STATE_SNAPSHOT`.

---------------------------------------------------------------------

## Current folder structure (actual)

timetable-clowns/
├─ PROTOCOL.md
├─ STATE_OF_THE_GAME.md
├─ server/
│  ├─ index.js
│  ├─ package.json
│  ├─ economy.js
│  ├─ upgrades/
│  │  ├─ definitions.js
│  │  └─ apply.js
│  ├─ shared/
│  │  └─ constants.js
│  └─ maps/
│     ├─ index.js
│     └─ map01.js
└─ client/
   └─ index.html

---------------------------------------------------------------------

## What is implemented and working

### Lobby / multiplayer
- Host / guest flow
- Join via game code
- Teams mode:
  - host can assign teams
  - start validation requires teams assigned
- Start validation:
  - minimum 2 players
  - teams assigned when mode is `"teams"`
- Host settings supported:
  - mode: `"ffa"` / `"teams"`
  - teamCount: `1–4` (Teams only)
  - friendlyFire: `true/false` (Teams only)
  - tableBase: `1–10`
  - mapChoice: `"map01"` / `"random"`
  - inputMode: `"kb"` / `"kbm"` / `"kbm_gamepad"` (keyboard authoritative)
  - sessionMode: `"standard"` / `"timed"`
  - sessionMinutes: `1–60` (Timed only)
  - winMode: `"standard"` / `"money"`

---------------------------------------------------------------------

### Map: map01
- Name: Training Hall
- World size: `{ w: 2400, h: 1600 }`
- 10 rooms
- Each room has ≥ 2 openings
- 1 machine per room (1–10)
- Walls generated server-side
- Machines are solid (collidable)
- Map sent to client on `GAME_STARTED` as `{ id, name, world, walls, machines }`

---------------------------------------------------------------------

### Movement & collisions
- Server authoritative
- Tick rate: `20 Hz`
- `PLAYER_SPEED = 220 px/s`
- Player body: `28×28` (PLAYER_HALF = 14)
- Slide collision resolution: attempt X then Y
- Collides with:
  - walls
  - machines

Client:
- sends input state (`up/down/left/right/fire`) to server
- renders from `STATE_SNAPSHOT`

---------------------------------------------------------------------

### Machine progression (1 → 10)
- Each player has `nextMachineNum` starting at `1`
- Machines must be completed strictly in order
- Interact key: `E` (client sends `tryInteract`)

Server denies invalid interaction:
- `INTERACT_DENIED { reason:"wrong_order", nextMachineNum, tried }`
- `INTERACT_DENIED { reason:"already_cleared", nextMachineNum, tried }`

Math prompt:
- server emits `MATH_PROMPT { promptId, base, machineNum }`
- client shows overlay (blocks gameplay input)
- client submits `submitAnswer { promptId, answer }`
- server emits `ANSWER_RESULT { ok, correct? }`

---------------------------------------------------------------------

### Shooting (cakes)
- Server authoritative
- `BULLET_SPEED = 780 px/s`
- `BULLET_TTL = 2.0s`
- `FIRE_COOLDOWN = 0.5s`

Removed on:
- TTL expiry
- world exit
- wall hit
- machine hit
- player hit

Client:
- renders bullets from `STATE_SNAPSHOT.bullets[]`
- supports bullet kinds (visuals):
  - default: cake (`🍰`)
  - banana shot: banana render when `bullet.kind === "banana"`
  - cake surprise visuals use `kind === "cake_surprise"` (if present)

---------------------------------------------------------------------

### Ammo
- `MAX_CAKES = 7`
- Shooting consumes 1 cake
- Refills on correct machine answer (server rule)

---------------------------------------------------------------------

### Economy (money)
- Starting money: `$100`
- Money pickups:
  - `type: "money"`
  - default amount: `100`
- Fully server-side:
  - spawn
  - collection
  - rewards
- Client renders money pickups from `STATE_SNAPSHOT.pickups[]`

---------------------------------------------------------------------

## Upgrades (IMPLEMENTED and working)

### Server-side upgrade model
- Upgrades are offered only by the server (after correct answers)
- Client UI displays offers and sends selections
- Client never applies gameplay modifiers from upgrades
- Gameplay modifiers come only from `player.mods` in snapshots

### Permanent upgrades (stacking unless stated)
- XL Shoes (stacking) → affects `mods.speedMult`
- Big Eyes (stacking) → affects `mods.fovAddDeg`
- Giraffoscope (stacking) → affects `mods.visionLenAdd`
- Big Nose (special permanent: disposable, non-stacking, max 1 at a time) → combat rule, NOT `mods`

### Consumable upgrades (3 hotkey slots)
Slots:
- slot 0: key `8`
- slot 1: key `9`
- slot 2: key `0`

Rules:
- no duplicate consumable ids
- paid on use (`useCost`)
- if slots are full, server returns `UPGRADE_RESULT { ok:false, reason:"slots_full", requested, slots }`
- client must run replace flow and send `chooseUpgradeReplace { offerId, upgradeId, dropId }`

Consumables implemented:
- Cake Surprise (mine/trap style)
- Rubber Chicken (dash)
- Banana Shot (bouncing projectile)
- Glasses (implemented; behavior server-side)

---------------------------------------------------------------------

### Big Nose (current behavior)
- Stored as a permanent upgrade type
- Max 1 Big Nose at a time
- Blocks ONE lethal cake projectile hit
- Consumed immediately after trigger
- Removed from player upgrades after trigger
- Must be rebought via future upgrade offers
- Not part of `player.mods` (special server combat rule)

---------------------------------------------------------------------

### Mods (server-computed) — LOCKED
Each player includes:

mods: {
  speedMult,     // default 1.0
  visionLenAdd,  // default 0 (pixels)
  fovAddDeg      // default 0 (degrees)
}

Client fog-of-war uses ONLY these values (plus its base constants).
Client must never compute mods from `player.upgrades`.

---------------------------------------------------------------------

### Death, invulnerability, and respawn
- Server authoritative
- Death sets `alive = false`
- Server emits:
  - `PLAYER_DIED { playerId }`
  - `RESPAWN_OPTIONS { killedBy?, options:[{id,label,kind}] }` (private to dead player)

Respawn:
- options include:
  - corners
  - cleared machines (when available)
- mandatory selection (no cancel)
- server applies brief invulnerability:
  - `invulnUntil` timestamp on player
- client shows HUD indicator and blink (UI only)

Client sends:
- `chooseRespawn { spawnId }`

Server replies:
- `RESPAWN_RESULT { ok, reason? }`

---------------------------------------------------------------------

### Timed sessions
- `endAt` tracked server-side
- included in:
  - `GAME_STARTED` (when timed)
  - `STATE_SNAPSHOT` (during running phase)
- client shows HUD timer (counts down to `endAt`)
- ends on timeout with `GAME_ENDED { reason:"time" }`

---------------------------------------------------------------------

### Game end
Reasons:
- `machine10`
- `time`

Server emits:
GAME_ENDED {
  reason,
  endedAt,
  winnerId,
  winnerName,
  winnerTeamId,
  leaderboard,
  winMode
}

Client:
- shows large end modal
- big winner banner (Teams mode shows “TEAM N”)
- highlights winner rows
- only action: “Back to lobby” (reload)

---------------------------------------------------------------------

## Authoritative snapshot shape (CURRENT)

`STATE_SNAPSHOT` includes:

{
  time,
  world,
  phase,
  endAt?,          // present for timed sessions
  pickups,         // money pickups
  mines?,          // if server sends mines/traps list
  bullets,
  players: [{
    id,
    name,
    teamId,
    x, y,
    dirX, dirY,
    money,
    cakes,
    alive,
    invulnUntil,
    nextMachineNum,
    upgrades: {
      permanent,    // [{id,count,info}]
      slots         // [{id,info}] length up to 3
    },
    mods: {
      speedMult,
      visionLenAdd,
      fovAddDeg
    },
    stats: {
      kills,
      deaths,
      correct
    }
  }]
}

Notes:
- `players[].mods` is the ONLY source of gameplay modifiers for the client.
- Mines/traps/bombs may appear under `mines` (or other server field name); client renderer can be defensive.

---------------------------------------------------------------------

This file represents **what is real right now**.
If code and docs disagree, **code wins until this file is updated**.

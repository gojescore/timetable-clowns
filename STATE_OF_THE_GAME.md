# Timetable Clowns — State of the Game (Restart Kit)

When starting a NEW chat thread, paste ALL THREE:

1) this file (STATE_OF_THE_GAME.md)
2) PROTOCOL.md
3) the file currently being edited

Last updated: 2026-02-07

🔒 Non-negotiable rule

Client may display upgrades, but must never compute gameplay modifiers from them.
All gameplay modifiers come only from player.mods sent by the server.

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

## What works right now (implemented)

### Lobby / multiplayer

- Host / guest flow works
- Join via game code works
- Host assigns teams in Teams mode
- Start game validation:
  - minimum 2 players
  - Teams mode: all players must have a teamId

### Host settings (implemented)

Sent on createGame:

- mode: "ffa" | "teams"
- teamCount: 1–4 (Teams only)
- friendlyFire: boolean (Teams only)
- tableBase: 1–10
- mapChoice: "map01" | "random"
- inputMode: "kb" | "kbm" | "kbm_gamepad"
- sessionMode: "standard" | "timed"
- sessionMinutes: 1–60 (Timed only, default 5)
- winMode: "standard" | "money"

---------------------------------------------------------------------

## Map (map01)

- Name: Training Hall (10 rooms)
- World size: { w: 2400, h: 1600 }
- 10 rooms
- Each room has at least 2 openings
- Exactly 1 machine per room
- Machine numbers: 1–10
- Walls are generated server-side and sent to client
- Machines are solid and participate in collisions

---------------------------------------------------------------------

## Movement and collisions

- Server authoritative movement
- Base speed: PLAYER_SPEED = 220 px/s
- Player collision size:
  - PLAYER_HALF = 14
  - AABB = 28×28
- Collision resolution:
  - slide on X, then Y
- Collides with:
  - walls (AABB)
  - machines (AABB, MACHINE_HALF = 10)

---------------------------------------------------------------------

## Shooting / bullets (cakes)

- Server authoritative
- BULLET_SPEED = 780 px/s
- BULLET_TTL = 2.0 seconds
- FIRE_COOLDOWN = 0.5 seconds

Bullet removed on:
- TTL expiry
- leaving world bounds
- wall hit (swept segment vs expanded AABB)
- machine hit (swept segment vs expanded AABB)
- player hit (swept segment vs circle)

Tuning constants:
- BULLET_HIT_R_WALL = 4
- BULLET_HIT_R_MACHINE = 6
- CAKE_HIT_R_PLAYER = 12

Sub-stepping is used to avoid tunneling.

---------------------------------------------------------------------

## Ammo (cakes)

- MAX_CAKES = 7
- Shooting consumes 1 cake
- Cakes refill to MAX_CAKES after a correct machine answer

---------------------------------------------------------------------

## Machines and math prompts

- INTERACT_RADIUS = 60
- Per-player machine progression:
  - nextMachineNum starts at 1
  - increments to max 10
- Server emits:
  - MATH_PROMPT
  - ANSWER_RESULT
  - INTERACT_DENIED

---------------------------------------------------------------------

## Economy

- Starting money: $100
- Money pickups:
  - type: "money"
- Economy module:
  - spawns pickups
  - handles collection
  - handles penalties and rewards

---------------------------------------------------------------------

## Upgrades (implemented)

### Permanent upgrades

- Purchased immediately
- acquireCost is paid on selection
- Stored permanently
- Stackable
- Max 3 permanent upgrade types

Implemented:
- XL Shoes
- Glasses
- Giraffoscope

### Consumable upgrades

- Stored in 3 slots
- Hotkeys: 8 / 9 / 0
- Paid on use (useCost)
- No duplicates
- Max 3 at a time

Implemented:
- Cake Surprise (mine)
- Rubber Chicken (dash + melee)

Upgrade flow:
- Server selects a random pool (size 9) at match start
- After correct answer, server emits UPGRADE_OFFER
- Client may decline or choose
- If slots full:
  - server returns reason:"slots_full"
  - client runs replace flow

---------------------------------------------------------------------

## Respawn and invulnerability

- On death:
  - server emits PLAYER_DIED
  - dead player receives RESPAWN_OPTIONS (private)
- Respawn options:
  - corners (always)
  - cleared machines (player-specific)
- On respawn:
  - alive = true
  - invulnUntil set
- RESPAWN_INVULN = 0.6 seconds
- Client shows invulnerability indicator and blink
- RESPAWN_OPTIONS includes killedBy name

---------------------------------------------------------------------

## Timed sessions

- Server sets endAt for timed matches
- endAt included in:
  - GAME_STARTED
  - STATE_SNAPSHOT
- Server ends match when now >= endAt
- Client shows timer pill

---------------------------------------------------------------------

## Game end and leaderboard

Reasons:
- "machine10"
- "time"

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

- Teams winner computed via aggregated team stats
- Client end screen:
  - big winner banner
  - winning team highlighted
  - leaderboard shown
  - only action: reload (Back to lobby)

---------------------------------------------------------------------

## Server-sent MODS migration status — 🔒 LOCKED

### Goal (architecture)

- Server computes gameplay modifiers ("mods")
- Client uses only player.mods
- Client must NOT derive gameplay effects from upgrade stacks

### Current reality

- Server already tracks upgrade stacks
- Client still uses upgrade stacks for fog-of-war (legacy)
- This is temporary and expected

### Required next step

Server must attach mods to STATE_SNAPSHOT.players[]:

mods:
- speedMult (default 1.0)
- visionLenAdd (default 0)
- fovAddDeg (default 0)

### After migration

Client fog-of-war uses:
- visionLen = BASE_VISION_LEN + mods.visionLenAdd
- coneDeg   = CONE_ANGLE_BASE_DEG + mods.fovAddDeg

Client must stop reading upgrade stacks entirely for fog math.

---------------------------------------------------------------------

## Snapshot shape (authoritative target)

players: [{
  id,
  name,
  teamId,
  x,
  y,
  dirX,
  dirY,
  money,
  cakes,
  alive,
  invulnUntil,
  nextMachineNum,
  upgrades: {
    permanent: [...],
    slots: [...]
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

---------------------------------------------------------------------

## Current constants (server/index.js)

Movement:
- TICK_HZ = 20
- PLAYER_SPEED = 220
- PLAYER_HALF = 14

Interaction:
- INTERACT_RADIUS = 60
- MACHINE_HALF = 10

Bullets:
- BULLET_SPEED = 780
- BULLET_TTL = 2.0
- BULLET_HIT_R_WALL = 4
- BULLET_HIT_R_MACHINE = 6
- CAKE_HIT_R_PLAYER = 12
- FIRE_COOLDOWN = 0.5

Respawn:
- RESPAWN_INVULN = 0.6
- CORNER_PAD = 80

Ammo:
- MAX_CAKES = 7

Timed sessions:
- MIN_SESSION_MIN = 1
- MAX_SESSION_MIN = 60

Win modes:
- WIN_MODE_STANDARD = "standard"
- WIN_MODE_MONEY = "money"

---------------------------------------------------------------------

## Wire protocol (current reality)

Server → Client:
- WELCOME
- GAME_CREATED
- JOIN_SUCCESS
- JOIN_FAILED
- LOBBY_UPDATE
- GAME_STARTED
- STATE_SNAPSHOT
- MATH_PROMPT
- ANSWER_RESULT
- INTERACT_DENIED
- UPGRADE_OFFER
- UPGRADE_RESULT
- UPGRADE_DECLINED
- UPGRADE_USED
- PLAYER_DIED
- RESPAWN_OPTIONS
- RESPAWN_RESULT
- GAME_ENDED

Client → Server:
- hello
- createGame
- joinGame
- assignTeam
- startGame
- input
- tryInteract
- submitAnswer
- chooseUpgrade
- declineUpgrade
- chooseUpgradeReplace
- useUpgradeSlot
- chooseRespawn

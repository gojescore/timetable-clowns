# Timetable Clowns — State of the Game (Restart Kit)

When starting a NEW chat thread, paste ALL THREE:
1) STATE_OF_THE_GAME.md
2) PROTOCOL.md
3) the file currently being edited

Last updated: 2026-02-07

---------------------------------------------------------------------

🔒 NON-NEGOTIABLE RULE

Client may display upgrades,
but must never compute gameplay modifiers from them.

All gameplay modifiers come only from `player.mods`
sent by the server.

---------------------------------------------------------------------

## Current folder structure

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

### Lobby
- Host / guest flow
- Join via game code
- Team assignment (Teams mode)
- Start validation (min 2 players, teams assigned)

---------------------------------------------------------------------

### Map: map01

- Name: Training Hall
- World size: `{ w: 2400, h: 1600 }`
- 10 rooms
- Each room has ≥ 2 openings
- 1 machine per room (1–10)
- Walls generated server-side
- Machines are solid

---------------------------------------------------------------------

### Movement & collisions

- Server authoritative
- `PLAYER_SPEED = 220 px/s`
- Player AABB: `28×28`
- Slide resolution: X then Y
- Collides with:
  - walls
  - machines

---------------------------------------------------------------------

### Shooting (cakes)

- Server authoritative
- `BULLET_SPEED = 780`
- `BULLET_TTL = 2.0s`
- `FIRE_COOLDOWN = 0.5s`

Removed on:
- TTL expiry
- world exit
- wall hit
- machine hit
- player hit

---------------------------------------------------------------------

### Ammo

- `MAX_CAKES = 7`
- Shooting consumes 1
- Refilled on correct answer

---------------------------------------------------------------------

### Upgrades

Permanent:
- XL Shoes
- Big Eyes
- Giraffoscope

Consumables:
- Cake Surprise (mine)
- Rubber Chicken (dash)
- Banana Shot
- Big Nose (shield)

---------------------------------------------------------------------

### Mods (server-computed)

Server sends per player:

```
mods: {
  speedMult,
  visionLenAdd,
  fovAddDeg
}
```

Client fog-of-war uses ONLY these values.

---------------------------------------------------------------------

### Fog-of-war (client)

- Cone-based visibility
- Occluded by walls
- Uses:
  - `BASE_VISION_LEN`
  - `CONE_ANGLE_BASE_DEG`
  - server-sent mods

Client does ZERO upgrade math.

---------------------------------------------------------------------

### Death & respawn

- Death sets `alive = false`
- Server emits:
  - PLAYER_DIED
  - RESPAWN_OPTIONS (private)

Respawn:
- corners
- cleared machines
- mandatory selection
- invulnerability applied

---------------------------------------------------------------------

### Timed sessions

- `endAt` tracked server-side
- Included in snapshots
- HUD timer shown
- Ends on timeout

---------------------------------------------------------------------

### Game end

Reasons:
- `machine10`
- `time`

Server emits:
```
GAME_ENDED {
  reason,
  endedAt,
  winnerId,
  winnerName,
  winnerTeamId,
  leaderboard,
  winMode
}
```

Client:
- shows large end modal
- highlights winner
- only action: reload

---------------------------------------------------------------------

### Snapshot shape (authoritative)

```
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
    permanent,
    slots
  },
  mods,
  stats: {
    kills,
    deaths,
    correct
  }
}]
```

---------------------------------------------------------------------

This file represents **what is real right now**.
If code and docs disagree, **code wins until this file is updated**.

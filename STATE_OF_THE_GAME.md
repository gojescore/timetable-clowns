---

## **STATE_OF_THE_GAME.md**

```md
# Timetable Clowns — State of the Game (Restart Kit)

When starting a NEW chat thread, paste:
1) this file (STATE_OF_THE_GAME.md)
2) PROTOCOL.md
3) the file currently being edited

Last updated: 2026-02-07

🔒 **Hard rule**
Client may display upgrades, but must never compute gameplay modifiers from them.
Modifiers come only from `player.mods`.

---

## Folder structure (actual)

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

## What works right now

### Lobby / multiplayer
- Host / guest flow works
- Join via code works
- Teams assignment works
- Start validation:
  - ≥ 2 players
  - Teams mode: all players have teamId

---

### Host settings (implemented)

- mode: ffa | teams
- teamCount: 1–4 (Teams)
- friendlyFire: boolean
- tableBase: 1–10
- mapChoice: map01 | random
- inputMode: kb | kbm | kbm_gamepad
- sessionMode: standard | timed
- sessionMinutes: 1–60
- winMode: standard | money

---

### Map

**map01 — Training Hall**
- World: `{ w: 2400, h: 1600 }`
- 10 rooms, ≥ 2 openings each
- 1 machine per room (1–10)
- Walls + machines are solid

---

### Movement & collisions

- Server authoritative
- PLAYER_SPEED = 220 px/s
- PLAYER_HALF = 14 (28×28 AABB)
- Slide resolution: X then Y
- Collides with walls and machines

---

### Shooting (cakes)

- BULLET_SPEED = 780
- BULLET_TTL = 2.0
- FIRE_COOLDOWN = 0.5
- MAX_CAKES = 7
- Sub-stepped collision
- Bullet removed on:
  - TTL expiry
  - world bounds
  - wall/machine hit
  - player hit

---

### Machines & prompts

- INTERACT_RADIUS = 60
- Per-player progression
- Server emits:
  - MATH_PROMPT
  - ANSWER_RESULT
  - INTERACT_DENIED

---

### Economy

- Start money: 100
- Money pickups handled server-side

---

### Upgrades (implemented & finished)

**Permanents**
- XL Shoes → speedMult
- Glasses → fovAddDeg
- Giraffoscope → visionLenAdd

**Consumables**
- Rubber Chicken → dash + melee kill
- Cake Surprise → mine (enemy trigger, AoE damage)

All effects are reflected **only** through `player.mods` or server actions.

---

### Respawn & invulnerability

- PLAYER_DIED event
- RESPAWN_OPTIONS (private)
- Options:
  - corners
  - cleared machines
- RESPAWN_INVULN = 0.6s

---

### Timed sessions

- Server tracks `endAt`
- Ends automatically
- Timer shown client-side

---

### Game end

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
- Big winner banner
- Highlighted winner
- Only action: Back to lobby

---

## Snapshot shape (authoritative)

```js
players: [{
  id, name, teamId,
  x, y, dirX, dirY,
  money, cakes,
  alive, invulnUntil,
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
  stats: { kills, deaths, correct }
}]

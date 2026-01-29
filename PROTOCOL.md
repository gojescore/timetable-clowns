# Timetable Clowns — Protocol (Single Source of Truth)

This file is the canonical reference for rules, architecture, and networking for the Timetable Clowns project.
When starting a new ChatGPT thread, paste this file + STATE_OF_THE_GAME.md + the file you are editing.

---

## 1) Game concept
A silly top-down multiplayer game for practicing times tables.

- 2–12 players in one match
- Host creates a game and gets a join code
- Guests join using the code
- Host selects:
  - timetable base (1–10)
  - number of teams (1–6)
  - input mode (kb / kbm / controller later)
  - map choice (map01 or random)
- Players move around a map with rooms and corridors (roads/spaces)
- Rooms contain machines 1–10 (one per room)
- Machines must be completed in numeric order (1 → 2 → … → 10)

---

## 2) Current rules (must be enforced)
### Machines + progression
- Machine interaction key: E (near machine)
- Each player has their own progression:
  - `nextMachineNum` starts at 1
  - Can only interact with machine `nextMachineNum`
  - On correct answer:
    - machine is marked cleared for that player
    - `nextMachineNum` increments up to 10
  - On wrong order:
    - interaction denied + "No access" bubble message to player

### Timetable prompt
- Host chooses `tableBase` (1–10)
- If base is 4 and player interacts with machine 6:
  - prompt is `4 × 6`
  - correct answer is 24

---

## 3) Economy rules (current)
### Money
- Start money per player: **100**
- Wrong answer penalty: **-100**
- Money cannot go below **0** (floor at 0)

### Money pickups (roads/spaces only)
- After a correct answer:
  - spawn money pickup(s) **on roads/spaces**
  - pickups must NOT spawn inside rooms or inside walls
- Pickups are collected automatically when a player is close enough
- Pickups have a TTL (despawn after time)

### Upgrade cost (later)
- Using a non-permanent upgrade costs money (default planned: 100)
- Permanent upgrades cost TBD
- A player can hold at most 3 non-permanent upgrades (includes "nose") (later)

---

## 4) Respawn rules (later)
- Players start with 1 life
- When killed:
  - respawn at last correctly answered machine
  - if none: respawn at starting zone

---

## 5) Fog of war (later)
- Players see a cone in front of them
- Cone width and distance are upgradeable
- Fade from visible to black at edges

---

## 6) Repo structure (target)
This is the intended structure; we implement gradually.

timetable-clowns/
- server/
  - index.js                     # express + socket.io + game loop
  - economy.js                   # money spawns + pickups
  - shared/
    - constants.js               # balance: costs, limits, amounts
  - maps/
    - index.js                   # map registry + buildDerived()
    - map01.js                   # map data (rooms, walls, roadAreas)
- client/
  - index.html                   # UI + canvas rendering + prompt overlay + HUD

---

## 7) IMPORTANT implementation constraints
- **One thing at a time**.
- **No refactors unless explicitly requested.**
- Keep changes minimal and beginner-safe.
- Always specify **exact file path** when telling what to edit.
- Prefer data-driven balance via `server/shared/constants.js`.

---

## 8) Networking protocol (Socket.IO events)

### Client → Server
- `hello` { name }
- `createGame` { tableBase, teamCount, inputMode, mapChoice }
- `joinGame` { gameCode }
- `assignTeam` { playerId, teamId }  (host only)
- `startGame`                         (host only)
- `input` { up, down, left, right }
- `tryInteract`
- `submitAnswer` { promptId, answer }

### Server → Client
- `WELCOME` { playerId }
- `GAME_CREATED` { gameCode }
- `JOIN_SUCCESS` { gameCode, players, teams }
- `JOIN_FAILED` { reason }
- `LOBBY_UPDATE` { players }
- `TEAM_ASSIGNED` { playerId, teamId }
- `GAME_STARTED` { map }
- `STATE_SNAPSHOT` { time, world, pickups, players }
- `MATH_PROMPT` { promptId, base, machineNum }
- `ANSWER_RESULT` { ok, correct? }
- `INTERACT_DENIED` { reason:"wrong_order", nextMachineNum, tried }
- `GAME_ENDED` { reason }

---

## 9) Definition of “roads/spaces”
“Roads/spaces” are the corridors outside rooms.
We model them using `roadAreas: [{x,y,w,h}, ...]` on the map data.

IMPORTANT:
- `maps/index.js` uses `structuredClone`, so **functions in map files do not survive**
- Therefore runtime helpers like `map.isRoad(x,y)` must be attached in `buildDerived()`.


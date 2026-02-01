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

## 2) Core gameplay rules (must be enforced)
### Machines + progression
- Machine interaction key: **E** (near machine)
- Each player has their own progression:
  - `nextMachineNum` starts at **1**
  - Player may only interact with machine `nextMachineNum`
  - On correct answer:
    - machine is marked cleared for that player
    - `nextMachineNum` increments up to **10**
  - On wrong order:
    - interaction denied
    - client shows a speech bubble message

### Timetable prompt
- Host chooses `tableBase` (1–10)
- Example:
  - base = 4
  - machine = 6
  - prompt: `4 × 6`
  - correct answer = `24`

---

## 3) Economy rules (current, implemented)
### Money
- Start money per player: **100**
- Wrong answer penalty: **-100**
- Money floor: **0** (cannot go negative)

### Money pickups
- After a correct answer:
  - server spawns money pickup(s)
- Pickups:
  - must spawn **only on roads/spaces**
  - must NOT spawn inside:
    - rooms
    - walls
- Pickups:
  - are collected automatically when player is close enough
  - increase player money by a fixed amount
  - despawn after TTL if not collected
- Pickups are removed:
  - when collected
  - or when TTL expires
  - NOT over time otherwise

---

## 4) Upgrade system (partially implemented)
### Upgrade categories
- **Permanent upgrades**
  - unlimited
  - stackable
- **Consumable / non-permanent upgrades**
  - stored in slots
  - limited capacity

### Slot rules
- Max consumable slots: **3**
- If player tries to take a new consumable while full:
  - player is warned
  - player must choose one existing consumable to drop
  - only then can the new upgrade be taken

### Upgrade offers
- After each correct answer:
  - server offers **all upgrades**
- Client displays upgrades in a grid
- Hovering an upgrade shows its description
- Picking an upgrade:
  - permanent → added immediately
  - consumable:
    - added if space
    - otherwise triggers drop-selection flow

---

## 5) Respawn rules (later)
- Players start with 1 life
- When killed:
  - respawn at last correctly answered machine
  - if none: respawn at starting zone

---

## 6) Fog of war (implemented: client-rendered)
### What it is
- Fog-of-war is **always active** during gameplay.
- The player’s visible area is a **cone-shaped line-of-sight** (LOS) in the facing direction.
- The cone is the player’s **only view**:
  - inside cone = **fully clear** (no fog)
  - outside cone = **fully obscured**
- LOS is blocked by walls (raycast against wall segments).

### Rendering rules
- Fog is **client-rendered only**.
- Server does **not** send visibility data.
- Visibility is derived from:
  - player position
  - player facing direction (`dirX`, `dirY`)
  - map wall geometry (`map.walls`)
- Implementation notes:
  - Build wall line segments from rectangles.
  - Cast rays within the cone; each ray stops at the nearest wall hit or max range.
  - Use an offscreen alpha mask for the cone, then punch it out of a full-screen dark overlay.
  - Camera is pixel-aligned to avoid seams.

### Debug tools (optional, never required)
- `V` toggles raw visibility mask view (for diagnosing LOS)
- `B` toggles edge-ring visualization (for diagnosing blur / boundary)

---

## 7) Repo structure (target / mostly achieved)

timetable-clowns/
- PROTOCOL.md
- STATE_OF_THE_GAME.md
- server/
  - index.js                     # express + socket.io + game loop
  - economy.js                   # money spawns + pickups
  - upgrades/
    - definitions.js             # upgrade data
    - apply.js                   # rules for taking/dropping upgrades
  - shared/
    - constants.js               # balance numbers
  - maps/
    - index.js                   # map registry + buildDerived()
    - map01.js                   # map data (rooms, walls, roadAreas)
- client/
  - index.html                   # UI + canvas rendering + HUD + overlays (+ fog-of-war rendering)

---

## 8) IMPORTANT implementation constraints
- **One thing at a time**
- **No refactors unless explicitly requested**
- Keep changes minimal and beginner-safe
- Always specify **exact file paths**
- Prefer balance via `server/shared/constants.js`

---

## 9) Networking protocol (Socket.IO)

### Client → Server
- `hello` { name }
- `createGame` { tableBase, teamCount, inputMode, mapChoice }
- `joinGame` { gameCode }
- `assignTeam` { playerId, teamId }
- `startGame`
- `input` { up, down, left, right }
- `tryInteract`
- `submitAnswer` { promptId, answer }
- `chooseUpgrade` { offerId, upgradeId }
- `chooseUpgradeReplace` { offerId, upgradeId, dropId }

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
- `INTERACT_DENIED` { reason, nextMachineNum, tried }
- `UPGRADE_OFFER` { offerId, options }
- `UPGRADE_RESULT` { ok, chosen?, upgrades?, dropped? }
- `GAME_ENDED` { reason }

---

## 10) Definition of “roads/spaces”
- Roads/spaces = corridors outside rooms
- Defined via `roadAreas: [{x,y,w,h}]` in map data

IMPORTANT:
- `structuredClone()` removes functions
- Runtime helpers (e.g. `map.isRoad(x,y)`) **must be attached in `buildDerived()`**

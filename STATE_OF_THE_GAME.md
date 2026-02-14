# Timetable Clowns — State of the Game (Restart Kit)

When starting a NEW ChatGPT thread, paste ALL THREE:
1) STATE_OF_THE_GAME.md
2) PROTOCOL.md
3) the file currently being edited

Last updated: 2026-02-14

---------------------------------------------------------------------

🔒 NON-NEGOTIABLE RULE (LOCKED)

Client may display upgrades,
but must never compute gameplay modifiers from them.

All gameplay modifiers come only from `player.mods`
sent by the server in STATE_SNAPSHOT.

---------------------------------------------------------------------

## Current folder structure (actual)

timetable-clowns/
├─ PROTOCOL.md
├─ STATE_OF_THE_GAME.md
├─ server/
│  ├─ index.js
│  ├─ package.json
│  ├─ economy.js
│  ├─ shared/
│  │  └─ constants.js
│  ├─ upgrades/
│  │  ├─ definitions.js
│  │  └─ apply.js
│  └─ maps/
│     ├─ index.js
│     └─ map01.js
└─ client/
   └─ index.html

---------------------------------------------------------------------

## What works right now (implemented)

### A) Lobby / multiplayer
- Host / guest flow works
- Host gets join code; guests join by code
- Lobby shows players list
- Teams mode:
  - host can assign teams
  - start validation requires all players have teamId
- Settings exist in the UI:
  - mode: ffa/teams
  - teamCount (teams only)
  - friendlyFire (teams only)
  - tableBase
  - mapChoice
  - inputMode (kbm / kb / kbm_gamepad)
  - sessionMode (standard / timed)
  - sessionMinutes
  - winMode (standard / money)

### B) Game start + snapshot loop
- Server starts match and sends:
  - GAME_STARTED { map, settings, endAt? }
- Server broadcasts:
  - STATE_SNAPSHOT periodically (server tick)
- Client renders:
  - map (walls + machines)
  - players (top-down clowns)
  - bullets (including banana styling if kind="banana")
  - money pickups
  - mines (if present)
  - jack boxes reveal objects (if present)
- Client camera follows local player
- Death splat flash: client shows a short (≈500ms) splat at death location; splats are rendered above fog (client-only).

### C) Input + overlays
- Movement: WASD / Arrow keys
- Interact: E sends tryInteract
- Shoot: Space (and LMB in kbm mode)
- Consumables:
  - use slots with 8 / 9 / 0
  - in kbm mode: wheel or 1/2/3 selects active slot; RMB uses active slot
- Overlay blocking is implemented:
  - math prompt blocks gameplay
  - upgrade picker blocks gameplay
  - drop/replace picker blocks gameplay
  - respawn picker blocks gameplay
  - end screen blocks gameplay and only allows “Back to lobby” (reload)

### D) Machines + math prompts
- Machines 1..10 exist on map
- Players have nextMachineNum
- Interacting sends prompt if valid
- Server validates answer and sends ANSWER_RESULT
- Wrong order / already cleared gives INTERACT_DENIED with reason and nextMachineNum

### E) Timed sessions + winMode
- Timed sessions show timer HUD on client
- Server supplies endAt (GAME_STARTED and/or STATE_SNAPSHOT)
- End of game:
  - Standard ends on machine10
  - Timed ends on time
- GAME_ENDED overlay:
  - bigger winner banner
  - highlights winner row / winner team
  - only button: Back to lobby (reload)

### F) Upgrades
- Server sends UPGRADE_OFFER after rewards (e.g. correct answers)
- Client shows upgrade picker overlay
- Client sends chooseUpgrade or declineUpgrade
- Consumables:
  - stored in 3 slots
  - paid on use (useCost)
  - if slots full, server returns UPGRADE_RESULT slots_full
  - client shows replace flow and sends chooseUpgradeReplace
- Permanents:
  - stored as stackable entries (id + count)
  - bought on selection (acquireCost)
  - max 3 permanent types
- Upgrade bar renders both:
  - Consumables (8/9/0)
  - Permanents (stacking xN)

### G) Server-sent MODS (IMPORTANT)
- Server is the only authority converting upgrades/effects into gameplay modifiers
- Client uses only `player.mods` to render fog parameters:
  - speedMult (future use / informational)
  - visionLenAdd (affects fog vision distance)
  - fovAddDeg (affects fog cone width)
- Client clamps fog params for safety (visual only)

### H) Fog-of-war + facing direction
- Client has fog-of-war cone
- Facing direction is unified:
  - `lastFacingAng` is used for BOTH fog cone and local sprite facing
  - In kbm mode: facing from mouse aim when mouseAim.has
  - In kb mode: facing from last movement direction (remembered vector)
- Debug keys:
  - V toggles raw visibility mask view
  - B toggles edge ring debug view

### I) Death + respawn
- Server emits PLAYER_DIED for victims
- Server sends RESPAWN_OPTIONS to victim
- Client shows respawn overlay; chooses spawn via chooseRespawn
- Server responds RESPAWN_RESULT

---------------------------------------------------------------------

## Known “rules we keep stable”

- Client never computes gameplay modifiers from upgrades (mods only from server)
- Server is authoritative for all simulation (movement, bullets, collisions, pickups, upgrades)
- End screen must only offer “Back to lobby” (reload)
- Overlay states block gameplay input

---------------------------------------------------------------------

## Data shapes used by the client (current expectations)

### STATE_SNAPSHOT (client-consumed fields)
- world: { w, h }
- endAt?: number (ms timestamp; timed sessions)
- players: Array of:
  - id, name?, teamId?
  - x, y
  - dirX, dirY
  - alive: boolean
  - invulnUntil?: number
  - money: number
  - cakes: number
  - nextMachineNum: number
  - upgrades:
    - permanent: Array<{ id, count, info? }>
    - slots: Array<{ id, info? }>
  - mods:
    - speedMult
    - visionLenAdd
    - fovAddDeg
  - effects/status fields may exist (balloonUntil etc.) but server remains authoritative
- bullets: Array<{ id, ownerId, x, y, kind? }>
- pickups: Array<{ type:"money", x, y, amount? }>
- mines?: Array<{ x, y, ... }>
- jackBoxes?: Array<{ x, y, radius/revealRadius, ownerId/teamId?, expiresAt/until? }>

### GAME_ENDED payload
- reason: "time" | "machine10" | "unknown"
- endedAt: ms timestamp
- winMode: "standard" | "money"
- winnerName: string
- winnerId?: string
- winnerTeamId?: number
- leaderboard: Array<{ id, name, teamId?, correct, kills, deaths, money }>

---------------------------------------------------------------------

## Next expected work (short list)

- Ensure server standardizes the “upgrade declined” ACK event name (client currently tolerates aliases)
- Continue tightening protocol + state docs anytime payload shapes change
- Keep `player.mods` complete and always present in snapshots (with defaults)

---------------------------------------------------------------------

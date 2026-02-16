# Timetable Clowns — State of the Game (Restart Kit)

When starting a NEW ChatGPT thread, paste ALL THREE:
1) STATE_OF_THE_GAME.md
2) PROTOCOL.md
3) the file currently being edited

Last updated: 2026-02-16

---------------------------------------------------------------------

🔒 NON-NEGOTIABLE RULE (LOCKED)

Client may display upgrades,
but must NEVER compute gameplay modifiers from them.

All gameplay modifiers come ONLY from `player.mods`
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
  - Host can assign teams
  - Start validation requires all players have teamId
- Host settings are editable only by host
- Guests see host settings in a read-only summary
- Player name is remembered per tab (sessionStorage)

Settings available in UI:
- mode: ffa / teams
- teamCount (teams only)
- friendlyFire (teams only)
- tableBase
- mapChoice
- inputMode (kbm / kb / kbm_gamepad)
- sessionMode (standard / timed)
- sessionMinutes
- winMode (standard / money)

---------------------------------------------------------------------

### B) Game start + snapshot loop

- Server starts match and sends:
  - GAME_STARTED { map, settings, endAt? }

- Server broadcasts:
  - STATE_SNAPSHOT periodically (server tick ~20Hz)

Client renders:
- map (walls + machines)
- players (top-down clowns)
- bullets (including banana styling if kind="banana")
- money pickups
- mines (if present)
- jack boxes reveal objects (if present)
- camera follows local player

---------------------------------------------------------------------

### C) Death splat (client-only visual)

- Client detects death transitions using STATE_SNAPSHOT.players[].alive
  - "was alive" → "now dead" triggers a splat at last known position
- Splat lifetime ≈ 500ms
- Rendered ABOVE fog
- Purely cosmetic
- No gameplay logic depends on splats

---------------------------------------------------------------------

### D) Input + overlays

Movement:
- WASD / Arrow keys

Interact:
- E → tryInteract

Shoot:
- Space
- LMB in kbm mode

Consumables:
- 8 / 9 / 0 to use slots
- In kbm mode:
  - 1/2/3 or wheel selects slot
  - RMB uses active slot

Overlay blocking:
- Math prompt blocks gameplay
- Upgrade picker blocks gameplay
- Drop/replace picker blocks gameplay
- Respawn picker blocks gameplay
- End screen blocks gameplay
- End screen only allows “Back to lobby” (reload)

---------------------------------------------------------------------

### E) Machines + math prompts

- Machines 1..10 exist on map
- Players track nextMachineNum
- Interacting sends prompt if valid
- Server validates answer and sends ANSWER_RESULT
- Wrong order or already cleared → INTERACT_DENIED

Progression:
- Standard session:
  - Ends when any player clears machine 10
- Timed session:
  - Ends when server time >= endAt

---------------------------------------------------------------------

### F) Timed sessions + winMode

- Timed sessions show timer HUD on client
- Server supplies endAt (GAME_STARTED and/or STATE_SNAPSHOT)
- GAME_ENDED overlay:
  - Larger winner banner
  - Highlights winner row or winner team
  - Only button: Back to lobby (reload)

---------------------------------------------------------------------

### G) Upgrades

Server sends UPGRADE_OFFER after rewards.

Client:
- Shows upgrade picker overlay
- Sends chooseUpgrade or declineUpgrade

Consumables:
- Stored in 3 slots
- Paid on use (useCost)
- If slots full:
  - Server returns UPGRADE_RESULT { reason:"slots_full" }
  - Client shows replace flow and sends chooseUpgradeReplace

Permanents:
- Stored as stackable entries (id + count)
- Paid on selection (acquireCost)
- Max 3 permanent types

Upgrade bar renders:
- Consumables (8/9/0)
- Permanents (stacking xN)

---------------------------------------------------------------------

### H) Server-sent MODS (LOCKED CONTRACT)

Server computes gameplay modifiers.

STATE_SNAPSHOT.players[].mods includes:

mods:
- speedMult
- visionLenAdd
- fovAddDeg

Client uses ONLY these values for fog:
- Vision length = base + visionLenAdd
- Cone angle = base + fovAddDeg
- Client clamps for visual safety only

Client NEVER derives fog or speed from upgrades.

---------------------------------------------------------------------

### I) Fog-of-war + facing direction

- Client has fog-of-war cone
- Facing direction unified:
  - lastFacingAng controls:
    - fog cone
    - local sprite facing

kbm:
- facing from mouse aim (if mouseAim.has)

kb:
- facing from last movement direction (remembered vector)

Debug:
- V toggles raw visibility mask
- B toggles edge ring

Machines are rendered above fog.
Walls can render outline above fog.

---------------------------------------------------------------------

### J) Death + respawn

- Server emits PLAYER_DIED
- Server sends RESPAWN_OPTIONS
- Client shows respawn overlay
- Client sends chooseRespawn
- Server sends RESPAWN_RESULT

Respawn invulnerability:
- Client shows invuln ring only after death→respawn transition
- Controlled by alive state + invulnUntil

---------------------------------------------------------------------

## Known rules we keep stable

- Server authoritative for:
  - movement
  - bullets
  - collisions
  - pickups
  - upgrades
  - economy
  - deaths
  - win conditions

- Client:
  - renders only
  - never computes gameplay effects from upgrades

- End screen:
  - only action = reload

- Overlay states:
  - block gameplay input

---------------------------------------------------------------------

## Data shapes used by client (current expectations)

### STATE_SNAPSHOT

- world: { w, h }
- endAt?: number
- players:
  - id
  - name?
  - teamId?
  - x, y
  - dirX, dirY
  - alive
  - invulnUntil?
  - money
  - cakes
  - nextMachineNum
  - upgrades:
      - permanent: Array<{ id, count, info? }>
      - slots: Array<{ id, info? }>
  - mods:
      - speedMult
      - visionLenAdd
      - fovAddDeg
  - additional effect fields may exist (server authoritative)

- bullets: Array<{ id, ownerId, x, y, kind? }>
- pickups: Array<{ type:"money", x, y, amount? }>
- mines?: Array<...>
- jackBoxes?: Array<...>

---------------------------------------------------------------------

### GAME_ENDED

- reason: "time" | "machine10" | "unknown"
- endedAt
- winMode
- winnerName
- winnerId?
- winnerTeamId?
- leaderboard:
  - id
  - name
  - teamId?
  - correct
  - kills
  - deaths
  - money

---------------------------------------------------------------------

## Next expected work

- Standardize UPGRADE_DECLINED ACK event naming
- Keep player.mods always present (with defaults)
- Continue tightening protocol whenever payload shapes change

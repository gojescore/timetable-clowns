# Timetable Clowns — State of the Game (Restart Kit)

When starting a NEW ChatGPT thread, paste ALL THREE:
1) STATE_OF_THE_GAME.md
2) PROTOCOL.md
3) the file currently being edited

Last updated: 2026-02-16

---------------------------------------------------------------------

🔒 NON-NEGOTIABLE RULE (LOCKED)

Client may display upgrades, UI, and visuals,
but must NEVER compute gameplay modifiers from upgrades.

All gameplay modifiers come ONLY from `player.mods`
computed by the server and sent in STATE_SNAPSHOT.

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

### Lobby / multiplayer
- Host / guest flow
- Join via 5-character game code
- Lobby player list
- Teams mode:
  - Host can assign teams
  - Start validation requires all players have teamId
- Host settings visible only for host; guests see a settings summary

### Game sessions
- Standard session:
  - Game ends when any player clears machine 10
- Timed session:
  - Server sets endAt
  - Client shows a timer pill when endAt exists
  - Game ends when time is up, winner depends on winMode

### Map + machines
- map01 (“Training Hall”) provided by server in GAME_STARTED
- Machines numbered 1..10 and must be solved in order per player
- Interact:
  - Client sends tryInteract (E)
  - Server sends MATH_PROMPT or INTERACT_DENIED
- Prompt flow works end-to-end:
  - submitAnswer → ANSWER_RESULT

### Input + overlays
- Client blocks gameplay input while overlays are open:
  - Math prompt
  - Upgrade offer
  - Drop/replace
  - Respawn
  - End screen
- Input modes supported on client:
  - kbm (mouse aim)
  - kb (aim via last movement direction)

### Server-sent mods (LOCKED CONTRACT)
- STATE_SNAPSHOT.players[].mods is present and is the only source for:
  - fog cone angle (base + fovAddDeg)
  - vision length (base + visionLenAdd)
  - (movement remains server-authoritative)

### Fog / visibility
- Fog-of-war cone rendering works
- Machines are rendered on top of fog (machines visible through fog)
- Walls outline render on top for readability
- Jack-in-the-box reveal objects (if included in snapshot) are respected for visibility (client-side visual only)

### Combat visuals
- Bullets are rendered from snapshot
- Special bullet kinds supported visually (e.g. “banana” if kind is provided)
- Mines are rendered when snapshot includes mines
- Pickups (money) are rendered from snapshot

### Death / respawn UX
- PLAYER_DIED updates HUD
- RESPAWN_OPTIONS overlay shows choices
- RESPAWN_RESULT closes overlay on success
- Invulnerability HUD shown only after death→respawn transition (client-tracked)

### End screen
- End modal is larger and highlights the winner clearly
- Only action is “Back to lobby” (reload)

### Client-only quality-of-life
- Player name is remembered per tab via sessionStorage:
  - typing updates sessionStorage
  - leaving lobby/game and end “Back” persist name and reload

---------------------------------------------------------------------

## Key gameplay constants (client display assumptions)

- INTERACT_RADIUS = 60
- MAX_CAKES = 7
- Fog base values (client-side rendering only):
  - BASE_VISION_LEN = 420
  - CONE_ANGLE_BASE_DEG = 92
  - clamp limits are client-side visual safety only

---------------------------------------------------------------------

## Snapshot shapes (high level)

STATE_SNAPSHOT (typical):
- world: { w, h }
- endAt?: number
- players: Array<{
    id, name?, teamId?,
    x, y,
    dirX?, dirY?,
    alive,
    invulnUntil,
    money,
    cakes,
    mods: { speedMult, visionLenAdd, fovAddDeg },
    upgrades: {
      permanent: Array<{ id, count, info? }>,
      slots: Array<{ id, info? }>
    }
  }>
- bullets?: Array<{ id, ownerId, x, y, kind? }>
- pickups?: Array<{ id?, type:"money", x, y, amount? }>
- mines?: Array<...>
- jackBoxes?: Array<...>

---------------------------------------------------------------------

## Notes for next thread

When debugging:
- Always assume server is authoritative.
- If something “feels wrong” visually, check whether the client is accidentally deriving gameplay from upgrades instead of `mods`.
- If an overlay is open and input feels broken, verify isUiBlockingInput() conditions.

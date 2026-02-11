# Timetable Clowns — STATE_OF_THE_GAME.md (Restart Kit)

When starting a NEW chat thread, paste ALL THREE:
1) this file (STATE_OF_THE_GAME.md)
2) PROTOCOL.md
3) the file currently being edited

Last updated: 2026-02-11

---------------------------------------------------------------------

🔒 One-liner that prevents future confusion

Client may display upgrades, but must never compute gameplay modifiers from them; modifiers come only from player.mods (server-computed) inside STATE_SNAPSHOT.

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
- Host creates game → join code
- Guests join by code
- Lobby shows players and settings
- Teams mode: host can assign teamId (0..teamCount-1)
- Start game validation:
  - >= 2 players
  - Teams mode: all players have teamId

### Map
- `map01` “Training Hall (10 rooms)”
- World size: 2400 × 1600
- 10 rooms each with a machine (1..10)
- `maps/index.js` builds derived data:
  - walls generated from room perimeters + openings
  - machines flattened into `map.machines`

### Movement + collision (server-authoritative)
- Server tick: 20 Hz
- Players move with speed = PLAYER_SPEED × me.mods.speedMult
- Collisions:
  - walls (AABBs)
  - machines (solid AABBs)
- Balloon “phase” can bypass collision (server-controlled)

### Machine progression
- Interact radius: 60
- Must clear machines in order (per-player)
- `tryInteract` → server emits `MATH_PROMPT`
- `submitAnswer`:
  - correct: advances, refills cakes, awards money, upgrade offer
  - wrong: penalty

### Shooting / bullets
- Cakes:
  - speed 780
  - ttl 2.0s
  - collision: walls/machines destroy bullet
  - player hit uses sweep segment-circle and respects invuln + friendlyFire
- Banana shot (consumable projectile):
  - bounces off walls with limited bounces
  - dies on machines
  - uses sweep vs expanded AABBs for robust collision

### Mines
- Cake Surprise mine:
  - placed by consumable action
  - does NOT expire (persists until triggered or game end)
  - triggers when enemy steps within trigger radius
  - blast kills within blast radius

### Jack in the Box
- Spawns a world object that reveals fog in radius
- TTL is long by default (can be capped)
- Per-player max active enforced (default 1)

### Dash (Rubber Chicken)
- Dash is stored server-side in player.effects.dash
- During dash:
  - movement direction is forced to dash direction
  - dash hit checks sweep from previous to current pos
  - respects friendlyFire and invulnerability
  - shield can block a dash hit (if implemented in effects)

### Big Nose (bullet-only save)
- If player has permanent BIG_NOSE and takes a lethal bullet:
  - consume one stack
  - grant brief invulnerability
  - push victim away from shooter safely

### Respawn system
- On death:
  - dead player receives `RESPAWN_OPTIONS`
  - options include:
    - 4 corners always
    - any machines that player has cleared
- `chooseRespawn` spawns at a valid position with invulnerability

### Timed sessions + win modes
- sessionMode:
  - standard: end when a player clears machine #10
  - timed: end when now >= endAt
- winMode (for leaderboard sorting):
  - standard: correct > kills > money > fewer deaths
  - money: money > correct > kills > fewer deaths

### End screen + back to lobby
- Server emits `GAME_ENDED` and snapshot
- Only intended next action is “Back to lobby”
- Host uses `backToLobby`:
  - server resets match runtime state
  - emits `RETURNED_TO_LOBBY` and `LOBBY_UPDATE`

---------------------------------------------------------------------

## “Server sends mods” migration status (CURRENT)

LOCKED and implemented in `server/index.js` snapshot:

- Server computes `mods` using upgrades.computePlayerMods(player, nowMs)
- Snapshot includes `players[].mods`
- Client must read mods and must not compute speed/fog from upgrades

mods fields:
- speedMult (default 1.0)
- visionLenAdd (default 0)
- fovAddDeg (default 0)

---------------------------------------------------------------------

## Known fragile areas / common regressions

1) Client accidentally recomputes fog/speed from upgrades instead of mods.
2) Client event handlers duplicated (nested keydown / multiple socket.on) causing stuck UI or double-actions.
3) Upgrade decline mismatch (server expects `declineUpgrade { offerId }` and client not clearing overlay on `UPGRADE_DECLINED` / `UPGRADE_RESULT`).
4) “Hard refresh” (Shift+Ctrl+R) triggers favicon.ico request; harmless 404 unless you want to add favicon.

---------------------------------------------------------------------

## How to continue in a new thread (workflow)

When you open a new chat:
1) Paste PROTOCOL.md (full)
2) Paste STATE_OF_THE_GAME.md (full)
3) Paste the single file you want to work on next (e.g., client/index.html)

Then say what is broken and what you expect to happen.

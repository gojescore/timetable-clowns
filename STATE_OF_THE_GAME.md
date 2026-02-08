
---------------------------------------------------------------------

## Current constants (server/index.js)
Movement:
- `TICK_HZ = 20`
- `PLAYER_SPEED = 220`
- `PLAYER_HALF = 14`

Interaction:
- `INTERACT_RADIUS = 60`
- `MACHINE_HALF = 10`

Bullets:
- `BULLET_SPEED = 780`
- `BULLET_TTL = 2.0`
- `BULLET_HIT_R_WALL = 4`
- `BULLET_HIT_R_MACHINE = 6`
- `CAKE_HIT_R_PLAYER = 12`
- `FIRE_COOLDOWN = 0.5`

Respawn:
- `RESPAWN_INVULN = 0.6`
- `CORNER_PAD = 80`

Ammo:
- `MAX_CAKES = 7`

Timed sessions:
- `MIN_SESSION_MIN = 1`
- `MAX_SESSION_MIN = 60`

Win modes:
- `WIN_MODE_STANDARD = "standard"`
- `WIN_MODE_MONEY = "money"`

---------------------------------------------------------------------

## Wire protocol (current reality)

Server → Client:
- `WELCOME`
- `GAME_CREATED`
- `JOIN_SUCCESS`
- `JOIN_FAILED`
- `LOBBY_UPDATE`
- `GAME_STARTED`
- `STATE_SNAPSHOT`
- `MATH_PROMPT`
- `ANSWER_RESULT`
- `INTERACT_DENIED`
- `UPGRADE_OFFER`
- `UPGRADE_RESULT`
- `UPGRADE_DECLINED`
- `UPGRADE_USED`
- `PLAYER_DIED`
- `RESPAWN_OPTIONS`
- `RESPAWN_RESULT`
- `GAME_ENDED`

Client → Server:
- `hello`
- `createGame`
- `joinGame`
- `assignTeam`
- `startGame`
- `input`
- `tryInteract`
- `submitAnswer`
- `chooseUpgrade`
- `declineUpgrade`
- `chooseUpgradeReplace`
- `useUpgradeSlot`
- `chooseRespawn`

---------------------------------------------------------------------

This file represents **what is real right now**.
If code and docs disagree, **code wins until this file is updated**.

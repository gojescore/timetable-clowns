Timetable Clowns — State of the Game (Restart Kit)

When starting a NEW chat thread, paste:

this file (STATE_OF_THE_GAME.md)

PROTOCOL.md

the file currently being edited

Last updated: 2026-02-07

🔒 One-liner that prevents future confusion

Client may display upgrades, but must never compute gameplay modifiers from them; modifiers come only from player.mods.

Current folder structure (actual)

timetable-clowns/

PROTOCOL.md

STATE_OF_THE_GAME.md

server/

index.js

package.json

economy.js

upgrades/

definitions.js

apply.js

shared/

constants.js

maps/

index.js

map01.js

client/

index.html

What works right now (implemented)
Lobby / multiplayer

Host / guest flow works

Join via game code works

Host assigns teams (Teams mode) via lobby dropdowns

Start game validation:

= 2 players

Teams mode: all players must have a teamId

Host settings (implemented)

Host sends these settings on createGame:

mode: "ffa" or "teams"

teamCount: 1–4 (Teams only)

friendlyFire: boolean (Teams only)

tableBase: 1–10

mapChoice: "map01" or "random"

inputMode: "kb" | "kbm" | "kbm_gamepad" (UI exists; gameplay is keyboard-driven currently)

sessionMode: "standard" or "timed"

sessionMinutes: 1–60 (Timed only; default 5)

winMode: "standard" or "money"

Map (map01)

map01 = “Training Hall (10 rooms)”

World size: { w: 2400, h: 1600 }

10 rooms, each with >= 2 openings

Exactly 1 machine per room, machine numbers 1–10

Walls are generated and sent to client

Machines are sent to client and are treated as solid for collisions

Movement + collisions

Server authoritative movement

Speed: PLAYER_SPEED = 220 px/s

Collision size: PLAYER_HALF = 14 (AABB 28×28)

Slide resolution: X then Y

Collides with:

walls (AABB)

machines (AABB with MACHINE_HALF = 10)

Shooting / bullets (cakes)

Server authoritative

BULLET_SPEED = 780 px/s

BULLET_TTL = 2.0

FIRE_COOLDOWN = 0.5

Bullet removed on:

TTL expiry

world bounds exit

wall/machine hits (swept segment vs expanded AABB)

player hits (swept segment vs circle)

Tuning:

BULLET_HIT_R_WALL = 4

BULLET_HIT_R_MACHINE = 6

CAKE_HIT_R_PLAYER = 12

Sub-stepping to avoid tunneling

Ammo (cakes)

MAX_CAKES = 7

Shooting consumes 1 cake

Cakes refill to MAX on correct machine answer

Machines + math prompts

INTERACT_RADIUS = 60

Per-player progression: nextMachineNum 1 → 10

Server emits:

MATH_PROMPT

ANSWER_RESULT

INTERACT_DENIED

Economy

Start money: $100

Money pickups: type:"money"

Economy module handles spawn/collect

Upgrades (implemented)

Permanents: stacking, buy cost (acquireCost)

Consumables: 3 slots, hotkeys 8/9/0, use cost (useCost)

Upgrade pool: server selects a random pool (size 9) at match start

Offer: after correct answer, server emits UPGRADE_OFFER

Decline: client can send declineUpgrade

Backpack full: server returns reason:"slots_full", client runs replace flow

Respawn + invulnerability

Death emits PLAYER_DIED

Dead player receives RESPAWN_OPTIONS

Respawn options:

corners always

cleared machines (per-player Set)

RESPAWN_INVULN = 0.6s

Server sets invulnUntil (ms timestamp)

Client shows invuln HUD pill + blink

RESPAWN_OPTIONS includes killedBy name (client shows it)

Timed sessions (implemented)

Server sets endAt on timed matches

Server ends match when now >= endAt

Client shows timer pill

endAt included in:

GAME_STARTED

STATE_SNAPSHOT

Game end + leaderboard (implemented)

Reasons:

"machine10"

"time"

Server emits GAME_ENDED { reason, endedAt, winnerId, winnerName, winnerTeamId, leaderboard, winMode }

Teams winner computed via team aggregation

Client end screen:

big winner banner

highlights winning team rows (teams) or winner row (ffa)

only action: reload (“Back to lobby”)

Server-sent MODS migration status (CURRENT) — 🔒 LOCKED
Goal (architecture)

Server computes gameplay modifiers (“mods”) from upgrades

Client uses only me.mods for rendering decisions (fog cone, etc.)

Client must NOT derive effects from upgrade stacks

CURRENT (reality)

Server already has upgrades and their stacking counts

Client currently computes fog-of-war cone using permanent stacks (big_eyes, giraffoscope) directly from player.upgrades

This is legacy behavior and expected until mods are attached to snapshots

NEXT REQUIRED STEP

Server must attach computed mods to each player in STATE_SNAPSHOT:

speedMult (default 1.0)

visionLenAdd (default 0)

fovAddDeg (default 0)

AFTER THAT

Client fog-of-war must read only me.mods:

visionLen = BASE_VISION_LEN + mods.visionLenAdd

coneDeg = CONE_ANGLE_BASE_DEG + mods.fovAddDeg

Client stops reading upgrade stacks for fog math.

Snapshot shape (authoritative target)

players: [{
id, name, teamId,
x, y, dirX, dirY,
money, cakes,
alive, invulnUntil,
nextMachineNum,
upgrades: { permanent:[...], slots:[...] },
mods: { speedMult, visionLenAdd, fovAddDeg },
stats: { kills, deaths, correct }
}]

Mods shape (wire contract to implement)

players[].mods:

speedMult (default 1)

visionLenAdd (default 0, pixels)

fovAddDeg (default 0, degrees)

Current constants (server/index.js)

Movement:

TICK_HZ = 20

PLAYER_SPEED = 220

PLAYER_HALF = 14

Interaction:

INTERACT_RADIUS = 60

MACHINE_HALF = 10

Bullets:

BULLET_SPEED = 780

BULLET_TTL = 2.0

BULLET_HIT_R_WALL = 4

BULLET_HIT_R_MACHINE = 6

CAKE_HIT_R_PLAYER = 12

FIRE_COOLDOWN = 0.5

Respawn:

RESPAWN_INVULN = 0.6

CORNER_PAD = 80

Ammo:

MAX_CAKES = 7

Timed sessions:

MIN_SESSION_MIN = 1

MAX_SESSION_MIN = 60

Win modes:

WIN_MODE_STANDARD = "standard"

WIN_MODE_MONEY = "money"

Wire protocol snapshot (current reality)

Server → Client events:

WELCOME

GAME_CREATED

JOIN_SUCCESS

JOIN_FAILED

LOBBY_UPDATE

GAME_STARTED

STATE_SNAPSHOT

MATH_PROMPT

ANSWER_RESULT

INTERACT_DENIED

UPGRADE_OFFER

UPGRADE_RESULT

UPGRADE_DECLINED

UPGRADE_USED

PLAYER_DIED

RESPAWN_OPTIONS

RESPAWN_RESULT

GAME_ENDED

Client → Server events:

hello

createGame

joinGame

assignTeam

startGame

input

tryInteract

submitAnswer

chooseUpgrade

declineUpgrade

chooseUpgradeReplace

useUpgradeSlot

chooseRespawn

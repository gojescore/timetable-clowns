Timetable Clowns — Protocol (Single Source of Truth)

This file is the canonical reference for rules, architecture, and networking for the Timetable Clowns project.

When starting a NEW chat thread, paste:

this file (PROTOCOL.md)

STATE_OF_THE_GAME.md

the file currently being edited

🔒 One-liner that prevents future confusion

Client may display upgrades, but must never compute gameplay modifiers from them; modifiers come only from player.mods.

1) Game concept

A silly top-down multiplayer game for practicing times tables.

2–12 players in one match

Host creates a game and gets a join code

Guests join using the code

Host selects:

game mode: FFA or Teams

timetable base (1–10)

teams count (Teams only)

friendly fire (Teams only)

input mode (kb / kbm / controller later)

map choice (map01 or random)

session type: Standard or Timed

timed minutes (Timed only)

win mode: Standard or Money

Timed sessions decide winner via winMode
Standard sessions still end on Machine 10

Players move around a top-down map with rooms + corridors.
Rooms contain machines 1–10 (one per room).
Machines must be completed in numeric order per player.

2) Core gameplay rules (must be enforced)
2.1 Machines + progression

Interaction key: E

Interaction allowed if player is within INTERACT_RADIUS

Each player has their own machine progression:

nextMachineNum starts at 1


You may only interact with nextMachineNum

Correct answer increments nextMachineNum (caps at 10)

Machines are not global

Server denies interaction if:

machine already cleared by that player → reason:"already_cleared"

wrong order → reason:"wrong_order"

2.2 Math prompts

Prompt shown when a player interacts with the correct machine

Prompt formula:

base × machineNum = ?


Server authoritative

Server generates prompt

Server validates answer

On submit:

Server emits ANSWER_RESULT { ok, correct? }

Client behavior:

Prompt overlay blocks gameplay input

Enter submits

Escape closes

2.3 Money + pickups

Each player starts with $100

Money pickups exist in the world:

type: "money"

default amount: 100

Server collects pickups via overlap (economy module)

2.4 Upgrades (buy vs use)

Upgrades come in two kinds.

A) Permanent

Purchased immediately (money removed on selection)

Stored as permanent

Can stack (count: 2, count: 3, …)

Max 3 permanent types at a time

Cost field: acquireCost

B) Consumable

Stored in 3 slots (hotkeys 8 / 9 / 0)

Not paid when picked

Paid when used

Cost field: useCost

No duplicates

Max 3 at a time

If slots full, server returns:

UPGRADE_RESULT { ok:false, reason:"slots_full", requested, slots }


Client must run replace flow and send:

chooseUpgradeReplace { offerId, upgradeId, dropId }

Using consumables

Hotkeys:

Slot 0 → key 8

Slot 1 → key 9

Slot 2 → key 0

Server validates:

slot not empty

player alive

no blockers:

no pendingPrompt

no pendingUpgradeOffer

player has enough money

Server subtracts money and emits:

UPGRADE_USED { ok:true, paid, used, money }

2.5 Mods (server-sent computed effects) — 🔒 LOCKED CONTRACT

We use server-sent mods so the client never recomputes upgrade effects.

Rule

The server is the only authority that converts upgrades, effects, and statuses into gameplay modifiers.

The client must treat player.mods as truth and must never derive gameplay values from player.upgrades.

Snapshot contract

Every player in STATE_SNAPSHOT.players[] includes:

mods: {
  speedMult: number,
  visionLenAdd: number,
  fovAddDeg: number
}

Meaning

speedMult → multiplier (default 1.0)

visionLenAdd → pixels added to base vision

fovAddDeg → degrees added to base cone angle

Defaults

If no upgrades/effects apply:

speedMult = 1.0
visionLenAdd = 0
fovAddDeg = 0

Client behavior

Movement

Server authoritative

Client must NOT scale movement

Fog-of-war

visionLen = BASE_VISION_LEN + me.mods.visionLenAdd
coneDeg   = CONE_ANGLE_BASE_DEG + me.mods.fovAddDeg

Robustness rules

If mods missing → fall back to defaults

Never recompute from upgrades

Mods are plain JSON inside snapshots

2.6 Combat + death + respawn

Players shoot cakes while holding fire

Server authoritative for:

projectiles

collisions

damage / death

Shooting blocked if:

prompt open

upgrade offer open

Consumes:

1 cake per shot

On death

alive = false

Server emits:

PLAYER_DIED { playerId }

RESPAWN_OPTIONS (private)

Respawn options

Corners (always)

Cleared machines (player-specific)

On respawn:

alive = true

invulnUntil set

Client shows blink + HUD

Killed-by info:

RESPAWN_OPTIONS { killedBy, options }

3) Session types + game end
3.1 Standard

Ends when Machine 10 is solved

GAME_ENDED { reason:"machine10" }

3.2 Timed

Server sets:

endAt = startedAt + sessionMinutes * 60 * 1000


Included in:

GAME_STARTED

STATE_SNAPSHOT

Ends when time expires:

GAME_ENDED { reason:"time" }

3.3 Win modes

Standard

correct ↓

kills ↓

money ↓

deaths ↑

Money

money ↓

correct ↓

kills ↓

deaths ↑

FFA → top row wins
Teams → aggregated team totals

4) End screen UX

Large end modal

Big winner banner

Winning team emphasized

Leaderboard shown

Only option: Back to lobby (reload)

5) Networking (Socket.IO)
5.1 Client → Server
hello { name }
createGame { ... }
joinGame { gameCode }
assignTeam { playerId, teamId }
startGame
input { up, down, left, right, fire }
tryInteract
submitAnswer { promptId, answer }
chooseUpgrade
declineUpgrade
chooseUpgradeReplace
useUpgradeSlot
chooseRespawn

5.2 Server → Client

Lobby:

WELCOME
GAME_CREATED
JOIN_SUCCESS
JOIN_FAILED
LOBBY_UPDATE


Game:

GAME_STARTED
STATE_SNAPSHOT


Upgrades:

UPGRADE_OFFER
UPGRADE_RESULT
UPGRADE_DECLINED
UPGRADE_USED


Death / respawn:

PLAYER_DIED
RESPAWN_OPTIONS
RESPAWN_RESULT


End:

GAME_ENDED

6) Authoritative server model (non-negotiable)

Server owns

movement

collisions

shooting

economy

machines

upgrades

mods computation

death / respawn

timers

winners

Client

rendering

input

UI only

Timetable Clowns — Protocol (Single Source of Truth)

This file is the canonical reference for rules, architecture, and networking for the Timetable Clowns project.

When starting a NEW chat thread, paste all three:

this file (PROTOCOL.md)

STATE_OF_THE_GAME.md

the file currently being edited

🔒 Non-negotiable rule

The client may display upgrades, but must never compute gameplay modifiers from them.
All gameplay modifiers come only from player.mods sent by the server.

1) Game concept

A silly top-down multiplayer game for practicing times tables.

2–12 players per match

Host creates a game and receives a join code

Guests join using the code

Host selects game settings before start

Host-selectable settings

Game mode: ffa or teams

Timetable base: 1–10

Team count: 1–4 (Teams only)

Friendly fire: on/off (Teams only)

Input mode: kb, kbm, kbm_gamepad (keyboard currently authoritative)

Map choice: map01 or random

Session type: standard or timed

Session minutes: 1–60 (Timed only)

Win mode: standard or money

Timed sessions decide the winner via winMode.
Standard sessions still end when Machine 10 is solved.

2) Core gameplay rules (server authoritative)
2.1 Machines and progression

Interaction key: E

Interaction allowed if player is within INTERACT_RADIUS

Each player has independent machine progression

nextMachineNum starts at 1

Player may only interact with nextMachineNum

Correct answer increments nextMachineNum (caps at 10)

Machines are not global

Server denies interaction if:

Machine already cleared by that player
→ reason: "already_cleared"

Wrong order
→ reason: "wrong_order"

2.2 Math prompts

Prompt appears when interacting with the correct machine

Formula:

base × machineNum = ?


Server responsibilities:

Generate prompt

Validate answer

Emit result

Server emits:

ANSWER_RESULT { ok, correct? }

Client behavior:

Prompt blocks gameplay input

Enter submits

Escape closes

2.3 Money and pickups

Each player starts with $100

Money pickups exist in the world

Pickup properties:

type: "money"

default amount: 100

Server handles pickup spawning and collection (economy module)

2.4 Upgrades

Upgrades come in two kinds.

A) Permanent upgrades

Purchased immediately

Money removed on selection

Stored permanently

Stackable (count: 2, count: 3, …)

Max 3 different permanent types

Cost field: acquireCost

Examples:

XL Shoes

Glasses

Giraffoscope

B) Consumable upgrades

Stored in 3 slots

Hotkeys:

Slot 0 → key 8

Slot 1 → key 9

Slot 2 → key 0

Not paid when picked

Paid when used

Cost field: useCost

No duplicates

Max 3 at a time

If slots are full, server returns:

UPGRADE_RESULT { ok:false, reason:"slots_full", requested, slots }


Client must run replace flow and send:

chooseUpgradeReplace { offerId, upgradeId, dropId }

Using consumables

Server validates:

Slot not empty

Player is alive

No blockers:

no pending math prompt

no pending upgrade offer

Player has enough money

Server subtracts money and emits:

UPGRADE_USED { ok:true, paid, used, money }

2.5 Mods (server-computed gameplay modifiers) — 🔒 LOCKED CONTRACT
Purpose

Server computes all gameplay modifiers

Client never derives modifiers from upgrades

Rule

The server is the only authority that converts upgrades, effects, and statuses into gameplay modifiers.

Snapshot contract

Every player inside STATE_SNAPSHOT.players[] includes:

mods: {
  speedMult: number,
  visionLenAdd: number,
  fovAddDeg: number
}

Meaning

speedMult
Multiplier applied to base speed (default 1.0)

visionLenAdd
Pixels added to base vision length (default 0)

fovAddDeg
Degrees added to base fog cone angle (default 0)

Client rules

Movement

Server authoritative

Client must NOT scale speed

Fog of war

visionLen = BASE_VISION_LEN + me.mods.visionLenAdd

coneDeg = CONE_ANGLE_BASE_DEG + me.mods.fovAddDeg

Robustness:

If mods missing → use defaults

Never recompute from upgrades

Mods are plain JSON in snapshots

2.6 Combat, death, and respawn

Players shoot cakes while holding fire

Server authoritative for:

projectiles

collisions

damage

death

Shooting blocked if:

math prompt open

upgrade offer open

Shooting:

consumes 1 cake per shot

Death

On death:

alive = false

Server emits:

PLAYER_DIED { playerId }

RESPAWN_OPTIONS (private)

Respawn options

Available respawn locations:

Corners (always)

Cleared machines (player-specific)

On respawn:

alive = true

invulnUntil set

Client behavior:

Blink / invulnerability indicator

HUD reflects invulnerability

RESPAWN_OPTIONS includes:

killedBy name

3) Session types and game end
3.1 Standard session

Ends when Machine 10 is solved

Server emits:

GAME_ENDED { reason:"machine10" }

3.2 Timed session

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

FFA → top player wins

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

winner calculation

Client owns

rendering

input

UI only

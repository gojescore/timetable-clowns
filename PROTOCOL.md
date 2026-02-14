# Timetable Clowns — PROTOCOL.md (Single Source of Truth)

This file is the canonical reference for rules, architecture, and networking contracts for Timetable Clowns.

When starting a NEW chat thread, paste ALL THREE:
1) PROTOCOL.md
2) STATE_OF_THE_GAME.md
3) the file currently being edited

---------------------------------------------------------------------

🔒 NON-NEGOTIABLE RULE (LOCKED)

The client may display upgrades, UI, and visuals, but MUST NEVER compute gameplay modifiers from upgrades or effects.

All gameplay modifiers come ONLY from `player.mods` computed by the server and sent in `STATE_SNAPSHOT`.

If the client needs fog/speed/etc. it uses:
- me.mods.speedMult
- me.mods.visionLenAdd
- me.mods.fovAddDeg

---------------------------------------------------------------------

## 1) Game concept

Timetable Clowns is a silly top-down multiplayer game for practicing multiplication tables.

- 2–12 players per match
- Host creates a match and gets a join code
- Guests join using the code
- Players roam a 2D map with rooms + corridors
- Each room contains one machine labeled 1–10
- Each player must clear machines in numeric order: 1 → 2 → … → 10
- Interaction at a machine prompts: base × machineNum = ?
- Server validates answers

---------------------------------------------------------------------

## 2) Host-selectable settings

Sent on `createGame`:

- `tableBase`: 1–10
- `mode`: `"ffa"` | `"teams"`
- `teamCount`: 1–4 (Teams only)
- `friendlyFire`: boolean (Teams only)
- `inputMode`: `"kb"` | `"kbm"` | `"kbm_gamepad"` (currently keyboard is authoritative)
- `mapChoice`: `"map01"` | `"random"` (random may pick from known maps)
- `sessionMode`: `"standard"` | `"timed"`
- `sessionMinutes`: 1–60 (Timed only)
- `winMode`: `"standard"` | `"money"`
  - standard: sorts by correct, kills, money, deaths
  - money: sorts by money, correct, kills, deaths

Constraints:
- Start game requires >= 2 players
- In Teams mode every player must have teamId assigned before start

---------------------------------------------------------------------

## 3) Architecture and authority

Server is authoritative for:
- movement + collision
- bullets/projectiles
- mines/jack boxes/pickups
- machine interaction validation and progression
- money + costs
- upgrades inventory + slot rules
- all gameplay modifiers (mods)

Client is responsible for:
- rendering
- input collection
- showing UI (lobby, prompt, upgrades, respawn options, end screen)
- purely visual presentation of players (sprites, tinting, cosmetics)

---------------------------------------------------------------------

## 4) Entities and core rules

### 4.1 Players
Server tracks for each player:
- position x,y and facing dirX,dirY
- alive/dead and invulnerability timer
- nextMachineNum progression (1..10)
- cleared machine set
- money
- cakes ammo (MAX_CAKES)
- upgrades inventory (permanent slots, consumable slots)
- effects (dash, balloon, shield, etc.) server-side
- computed `mods` (speed/fog/etc.)

### 4.2 Machines
- Each machine has a unique id and a number `num` in 1..10.
- Player can interact only if:
  - within `INTERACT_RADIUS`
  - machine not already cleared by that player
  - machine.num === player.nextMachineNum
- On correct answer:
  - server increments correct stat
  - marks machine cleared
  - advances nextMachineNum up to 10
  - refills cakes
  - awards economy reward and may spawn pickups
  - server offers upgrades (UPGRADE_OFFER)
- Clearing machine #10 ends the game immediately (standard end condition)

### 4.3 Combat / bullets
- Players can shoot cakes (hold Space on client)
- Bullets are server simulated
- Bullet collisions:
  - walls: destroy (banana bounces)
  - machines: destroy (banana destroys too)
  - players: kill (respect invulnerability, friendly fire rules)
- Respawn: dead player must choose a respawn option from server

### 4.4 Respawn system
- When a player dies server emits `RESPAWN_OPTIONS` to that player:
  - corners always
  - any machines that player has cleared
- Player selects with `chooseRespawn`
- Server validates selection and spawns player with brief invulnerability

### 4.5 Economy
- Players start with $100
- Correct answers can award money/pickups
- Wrong answers can penalize
- Purchases:
  - permanent upgrades charge on acquire
  - consumables charge on use

### 4.6 Upgrades system
Two kinds:
- permanent
  - stored in limited permSlots (stacking counts per id)
  - cost charged on acquire
- consumable
  - stored in limited consSlots (max 3)
  - cost charged on use
  - if slots full, server returns `UPGRADE_RESULT { ok:false, reason:'slots_full' }` and client must show replace flow (`chooseUpgradeReplace`)

Implemented / expected upgrades (current build):
- permanents: XL Shoes, Glasses, Giraffoscope, Big Nose (one-time bullet save)
- consumables: Rubber Chicken (dash attack), Cake Surprise (mine), Banana Shot (bouncy projectile), Jack in the Box (fog reveal object), Balloon (phase through walls with pre/post stun)

---------------------------------------------------------------------

## 5) 🔒 Mods (server-sent computed effects) — LOCKED CONTRACT

Server computes `mods` and includes it in every snapshot, per player:

`STATE_SNAPSHOT.players[i].mods`:
```js
mods: {
  speedMult: number,     // default 1.0
  visionLenAdd: number,  // default 0 (pixels)
  fovAddDeg: number      // default 0 (degrees)
}
6) Networking contracts (Socket.IO)
6.1 Lobby / session

Client → Server:

hello { name }

createGame { tableBase, mode, teamCount, friendlyFire, inputMode, mapChoice, sessionMode, sessionMinutes, winMode }

joinGame { gameCode }

assignTeam { playerId, teamId } (host only; Teams only)

startGame (host only)

backToLobby (host only; ended only)

Server → Client:

WELCOME { playerId }

GAME_CREATED { gameCode }

JOIN_SUCCESS { gameCode, players, settings }

JOIN_FAILED { reason }

LOBBY_UPDATE { players, settings }

GAME_STARTED { map, settings, endAt? }

GAME_ENDED { reason, endedAt, winnerId, winnerName, winnerTeamId, leaderboard, winMode }

RETURNED_TO_LOBBY { ok:true }

6.2 State replication

Server → Client (authoritative, frequent):

STATE_SNAPSHOT { time, world, phase, endAt?, pickups, mines?, jackBoxes?, bullets, players }

Players in snapshot include:

identity: id, name, teamId

position: x, y, dirX, dirY

progression: nextMachineNum

economy: money

inventory (for UI): upgrades.permanent, upgrades.slots

mods (for gameplay render): mods

combat: cakes, alive, invulnUntil

stats: kills, deaths, correct

optional effects summary: balloon stage/until (client UI only)

6.3 Input + interaction

Client → Server:

input { up, down, left, right, fire, aimX, aimY }

tryInteract

submitAnswer { promptId, answer }

Server → Client:

MATH_PROMPT { promptId, base, machineNum }

ANSWER_RESULT { ok, correct? }

INTERACT_DENIED { reason, nextMachineNum, tried }

6.4 Upgrades flow

Server → Client:

UPGRADE_OFFER { offerId, options }

UPGRADE_RESULT { ok, ... }

UPGRADE_USED { ok, ... }

UPGRADE_DECLINED { ok, offerId? }

Client → Server:

chooseUpgrade { offerId, upgradeId }

declineUpgrade { offerId }

chooseUpgradeReplace { offerId, upgradeId, dropId }

useUpgradeSlot { slotIndex }

Slot-full contract:

Server replies: UPGRADE_RESULT { ok:false, reason:'slots_full', requested, slots, money }

Client must show a replace UI and call chooseUpgradeReplace

6.5 Death / respawn

Server → Client:

PLAYER_DIED { playerId } (to room)

RESPAWN_OPTIONS { killedBy, options:[{id,label,kind}] } (to dead player only)

RESPAWN_RESULT { ok, reason? }

Client → Server:

chooseRespawn { spawnId }

7) End of game rule (UI requirement)

When the game ends:

The ONLY next action is “Back to lobby”.

Host triggers backToLobby, server resets match state and emits:

RETURNED_TO_LOBBY { ok:true }
followed by:

LOBBY_UPDATE

8) Player visuals (client-only contract)

Player cosmetics are client-only rendering.

Team color may be represented via tinting a sprite asset.

Facing direction for top-down visuals SHOULD match the fog cone facing direction.

None of this affects gameplay; server remains authoritative.

Asset:

client/assets/wig_master_64.png

MUST have a transparent background (alpha).

MUST be designed to tint cleanly (see STATE_OF_THE_GAME.md for details).

9) Debugging rules

If something “looks wrong”:

Believe the server snapshot, not the UI.

Verify the client uses player.mods for fog/speed and does not recompute.

Check for duplicated client listeners causing duplicate input / stale UI state.

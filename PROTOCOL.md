# Timetable Clowns — Protocol (Single Source of Truth)

This file is the canonical reference for rules, architecture, and networking contracts for the Timetable Clowns project.

When starting a NEW ChatGPT thread, paste ALL THREE:
1) PROTOCOL.md
2) STATE_OF_THE_GAME.md
3) the file currently being edited

Last updated: 2026-02-14

---------------------------------------------------------------------

🔒 NON-NEGOTIABLE RULE (LOCKED)

The client may display upgrades, UI, and visuals,
but must NEVER compute gameplay modifiers from them.

All gameplay modifiers come ONLY from `player.mods`
computed by the server and sent in STATE_SNAPSHOT.

(Examples: fog cone width, vision length, movement speed multipliers.)

---------------------------------------------------------------------

## 1) High-level architecture

Server-authoritative simulation:
- Server owns truth for: movement, collisions, bullets, upgrades, money, machines, deaths, respawns, timers, win conditions
- Client owns: input capture, rendering, UI/overlays

Networking:
- Express + Socket.IO
- Server runs a tick loop (e.g. 20 Hz)
- Client sends input events; server broadcasts snapshots

---------------------------------------------------------------------

## 2) Game concept

A silly top-down multiplayer game for practicing multiplication tables.

- 2–12 players per match
- Host creates a game and receives a join code
- Guests join with the join code
- Each player progresses independently through machines 1 → 10
- Answering machine prompts correctly advances your next machine number
- Combat exists (shooting), plus money + upgrades

---------------------------------------------------------------------

## 3) Host-selectable settings (createGame)

Sent from client → server in `createGame`:

- mode: "ffa" | "teams"
- teamCount: number (only when mode="teams")
- friendlyFire: boolean (only when mode="teams")
- tableBase: number 1..10
- mapChoice: "map01" | "random" (server may resolve "random")
- inputMode: "kbm" | "kb" | "kbm_gamepad"
- sessionMode: "standard" | "timed"
- sessionMinutes: integer 1..60 (only when sessionMode="timed")
- winMode: "standard" | "money"
  - standard: leaderboard priority is correct → kills → money → deaths(asc)
  - money: leaderboard priority is money → correct → kills → deaths(asc)

Rules:
- Standard sessions end immediately when any player clears machine 10.
- Timed sessions end when server time >= endAt.

---------------------------------------------------------------------

## 4) Lobby rules + validation

Lobby flow:
- Players exist in lobby with id, name, teamId (teamId required in Teams mode)
- Host can assign teams (teams only)
- Start validation:
  - must be >= 2 players
  - if mode="teams": every player must have a teamId

Friendly fire:
- Only applies in Teams mode
- If friendlyFire=false, server must not allow damage to teammates

---------------------------------------------------------------------

## 5) Map contract

Server sends map in GAME_STARTED payload.

Map fields (minimum):
- world: { w:number, h:number }
- walls: Array<{ x:number, y:number, w:number, h:number }>
- machines: Array<{ num:number, x:number, y:number }>

Notes:
- map01 ("Training Hall") has 10 rooms and machines 1..10
- Machines must be completed in numeric order per player (nextMachineNum)

---------------------------------------------------------------------

## 6) Machines + math prompts

Interact:
- Client sends: `tryInteract` (usually bound to E key)
- Server checks player distance to nearest machine, and progression rules

Server responses:
- `MATH_PROMPT { promptId, base, machineNum }` (to that player only)
- `INTERACT_DENIED { reason, nextMachineNum? }`

Prompt submit:
- Client sends: `submitAnswer { promptId, answer:number }`
- Server validates and responds:
  - `ANSWER_RESULT { promptId, ok:boolean, correct:number }`

Progression:
- Each player has `nextMachineNum` (starts at 1)
- Correct answer increments nextMachineNum
- If nextMachineNum becomes 10 and player completes it:
  - in standard sessions: server ends game (reason="machine10")
  - in timed sessions: game does NOT end unless time ends (but player can still progress/reward; exact rewards are server-defined)

---------------------------------------------------------------------

## 7) Money, pickups, economy

Server authoritative:
- Money is earned from game actions (pickups, rewards, etc.)
- Pickups exist in snapshots, client renders them
- Server resolves pickup collection

Snapshot pickups (current minimal):
- pickups: Array<{ id?, type:"money", x:number, y:number, amount?:number }>

Client never mutates money directly; it displays snapshot values.

---------------------------------------------------------------------

## 8) Combat + bullets + mines (overview)

Server authoritative:
- Shooting: server spawns bullets; simulates bullet movement + collisions
- Mines (e.g., Cake Surprise): server places mine objects and resolves triggers + explosions
- Optional special projectiles (e.g. banana) are encoded via `bullets[].kind`

Snapshot bullets:
- bullets: Array<{ id:string, ownerId:string, x:number, y:number, kind?:string }>

Snapshot mines (if present):
- mines: Array<{ id?, ownerId?, x:number, y:number, armedAt?, ... }>

No client-side physics authority.

---------------------------------------------------------------------

## 9) Upgrades system (permanent + consumable)

Two categories:

A) Permanent upgrades
- Purchased when chosen (cost = acquireCost)
- Stored in `player.upgrades.permanent` as stackable types:
  - { id, count, info? }
- Limited: max 3 distinct permanent types at a time (server-enforced)
- Stacking increases `count`

B) Consumable upgrades
- Stored in `player.upgrades.slots` (3 slots only, keys 8 / 9 / 0)
- Paid when USED (cost = useCost)
- If choosing a consumable with full slots, server returns slots_full and client must replace/drop one via chooseUpgradeReplace

IMPORTANT:
- Client may show upgrade name/desc/costs, but must not compute gameplay effects from upgrades.
- Gameplay effects are always server-computed into `player.mods`.

---------------------------------------------------------------------

## 10) MODS contract (server-sent computed effects)

Every player in STATE_SNAPSHOT.players[] includes:

mods: {
  speedMult: number,     // default 1.0
  visionLenAdd: number,  // default 0 (pixels added to base)
  fovAddDeg: number      // default 0 (degrees added to base cone)
}

Client rules:
- Fog cone angle uses: base + fovAddDeg (clamped client-side to prevent extremes)
- Vision length uses: base + visionLenAdd (clamped)
- Movement speed visuals should not assume anything; movement is server-authoritative anyway
- Client MUST NOT derive mods from upgrades

---------------------------------------------------------------------

## 11) Socket event contracts

### Client → Server

- hello { name }
- createGame { settings... }
- joinGame { gameCode }
- assignTeam { playerId, teamId }   (host only; teams mode only)
- startGame                         (host only)
- input { up,down,left,right,fire, dirX?,dirY?, aimX?,aimY? }
- tryInteract
- submitAnswer { promptId, answer }
- chooseUpgrade { offerId, upgradeId }
- declineUpgrade { offerId? }
- chooseUpgradeReplace { offerId, upgradeId, dropId }
- useUpgradeSlot { slotIndex }      (0..2)
- chooseRespawn { spawnId }
- Splats (death decals) are client-only visuals.
Client detects death transitions from STATE_SNAPSHOT.players[].alive and spawns a short-lived splat at the player’s last (x,y).
Splats render above fog (visible even outside the cone).
This is purely cosmetic and does not affect gameplay.

### Server → Client

Lobby:
- WELCOME { playerId }
- GAME_CREATED { gameCode }
- JOIN_SUCCESS { gameCode, players, settings }
- JOIN_FAILED { reason }
- LOBBY_UPDATE { players, settings }

Game start + state:
- GAME_STARTED { map, settings, endAt? }
- STATE_SNAPSHOT { time?, world, phase?, endAt?, players[], bullets[], pickups[], mines?, jackBoxes? }

Machines:
- MATH_PROMPT { promptId, base, machineNum }
- ANSWER_RESULT { promptId, ok, correct }
- INTERACT_DENIED { reason, nextMachineNum? }

Upgrades:
- UPGRADE_OFFER { offerId, options[] }
- UPGRADE_RESULT { ok, reason?, need?, requested?, slots?, money? }
- UPGRADE_USED { ok, reason?, used?, paid?, need?, money? }
- UPGRADE_DECLINED (optional ACK; server may send one of several names)
  - Client should tolerate aliases, but server should standardize on one.

Death/respawn:
- PLAYER_DIED { playerId, killedBy? }
- RESPAWN_OPTIONS { options[], killedBy? }
- RESPAWN_RESULT { ok, reason? }

End:
- GAME_ENDED {
    reason: "time" | "machine10" | "unknown",
    endedAt,
    winMode,
    winnerId?,
    winnerName,
    winnerTeamId?,
    leaderboard: Array<{ id,name,teamId?,correct,kills,deaths,money }>
  }

---------------------------------------------------------------------

## 12) UI/overlay blocking rules (client-side)

Client should block gameplay input while any of these are open:
- Math prompt overlay
- Upgrade offer overlay
- Drop/replace overlay
- Respawn overlay
- End/leaderboard overlay

End overlay:
- Only action should be “Back to lobby” (page reload).
- No “Continue”.

---------------------------------------------------------------------

## 13) Input mode notes

Input modes:
- kbm: aim direction comes from mouse; fire via mouse or Space; slot select via 1/2/3 or wheel; use via RMB or 8/9/0
- kb: aim direction comes from last movement direction; uses remembered facing vector
- kbm_gamepad: treated like kbm for now unless implemented later

Server still accepts input payload the same way; client chooses which fields to include.

---------------------------------------------------------------------

## 14) Versioning rule

If you change any event name, payload shape, or meaning:
- Update this PROTOCOL.md first (or at the same time)
- Keep STATE_OF_THE_GAME.md aligned with what currently works

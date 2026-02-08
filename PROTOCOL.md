# Timetable Clowns — Protocol (Single Source of Truth)

This file is the canonical reference for **rules, architecture, and networking contracts**
for the Timetable Clowns project.

When starting a NEW chat thread, paste ALL THREE:
1) PROTOCOL.md
2) STATE_OF_THE_GAME.md
3) the file currently being edited

---------------------------------------------------------------------

🔒 NON-NEGOTIABLE RULE

The client may display upgrades, UI, and visuals,
but must NEVER compute gameplay modifiers from them.

All gameplay modifiers come ONLY from `player.mods`
computed by the server and sent in STATE_SNAPSHOT.

---------------------------------------------------------------------

## 1) Game concept

Timetable Clowns is a silly top-down multiplayer game
for practicing multiplication tables.

- 2–12 players per match
- Host creates a game and receives a join code
- Guests join using the code
- Each player progresses independently through machines 1 → 10

---------------------------------------------------------------------

## 2) Host-selectable settings

Sent on `createGame`:

- mode: `"ffa"` | `"teams"`
- teamCount: `1–4` (Teams only)
- friendlyFire: `boolean` (Teams only)
- tableBase: `1–10`
- mapChoice: `"map01"` | `"random"`
- inputMode: `"kb"` | `"kbm"` | `"kbm_gamepad"`
- sessionMode: `"standard"` | `"timed"`
- sessionMinutes: `1–60` (Timed only)
- winMode: `"standard"` | `"money"`

Rules:
- Timed sessions end on time
- Standard sessions end when Machine 10 is cleared
- Timed sessions still use `winMode` to decide winner

---------------------------------------------------------------------

## 3) Core gameplay rules (server authoritative)

### 3.1 Machines & progression

- Interaction key: `E`
- Interaction allowed only within `INTERACT_RADIUS`
- Each player has their own progression:
  - `nextMachineNum` starts at `1`
  - must be solved in order
  - caps at `10`

Server denies interaction with:
- `reason: "already_cleared"`
- `reason: "wrong_order"`

---------------------------------------------------------------------

### 3.2 Math prompts

- Prompt appears when interacting with the correct machine
- Formula:  
  `tableBase × machineNum = ?`

Server responsibilities:
- generate prompt
- validate answer
- emit result

Server emits:
- `MATH_PROMPT`
- `ANSWER_RESULT { ok, correct? }`

Client behavior:
- prompt blocks gameplay input
- Enter submits
- Escape closes prompt

---------------------------------------------------------------------

### 3.3 Economy

- Starting money: `$100`
- Money pickups:
  - `type: "money"`
  - default amount: `100`
- Economy is fully server-side:
  - spawn
  - collection
  - rewards / penalties

---------------------------------------------------------------------

## 4) Upgrades

Upgrades are **data + effects**, but gameplay impact is always server-computed.

### 4.1 Permanent upgrades

- Purchased immediately
- Money paid on selection (`acquireCost`)
- Stored permanently
- Stackable
- Max **3 different permanent types**

Examples:
- XL Shoes
- Big Eyes
- Giraffoscope

---------------------------------------------------------------------

### 4.2 Consumable upgrades

- Stored in **3 slots**
- Hotkeys:
  - Slot 0 → `8`
  - Slot 1 → `9`
  - Slot 2 → `0`
- No duplicates
- Paid **when used** (`useCost`)
- Max 3 at a time

If slots are full:
```
UPGRADE_RESULT { ok:false, reason:"slots_full", requested, slots }
```

Client must run replace flow and respond with:
```
chooseUpgradeReplace { offerId, upgradeId, dropId }
```

---------------------------------------------------------------------

### 4.3 Using consumables

Server validates:
- slot not empty
- player alive
- no blockers:
  - no math prompt
  - no upgrade offer
- sufficient money

Server emits:
```
UPGRADE_USED { ok:true, paid, used, money }
```

---------------------------------------------------------------------

## 5) Mods (gameplay modifiers) — 🔒 LOCKED CONTRACT

### Purpose

The server is the ONLY authority that converts:
- upgrades
- effects
- statuses

into gameplay modifiers.

The client must NEVER derive gameplay effects from upgrades.

---------------------------------------------------------------------

### Snapshot contract

Every player in `STATE_SNAPSHOT.players[]` includes:

```
mods: {
  speedMult: number,
  visionLenAdd: number,
  fovAddDeg: number
}
```

Defaults:
- `speedMult = 1.0`
- `visionLenAdd = 0`
- `fovAddDeg = 0`

---------------------------------------------------------------------

### Meaning

- `speedMult`  
  Multiplier applied to base movement speed

- `visionLenAdd`  
  Pixels added to base fog-of-war vision length

- `fovAddDeg`  
  Degrees added to base fog cone angle

---------------------------------------------------------------------

### Client rules

Movement:
- Server authoritative
- Client must NOT scale speed

Fog-of-war:
```
visionLen = BASE_VISION_LEN + mods.visionLenAdd
coneDeg   = CONE_ANGLE_BASE_DEG + mods.fovAddDeg
```

Robustness:
- Missing mods → defaults
- Never recompute from upgrades

---------------------------------------------------------------------

## 6) Combat, death, and respawn

### Shooting

- Players shoot cakes while holding fire
- Server authoritative for:
  - projectiles
  - collisions
  - damage
  - death

Shooting blocked if:
- math prompt open
- upgrade offer open

---------------------------------------------------------------------

### Death

On death:
- `alive = false`
- Server emits:
  - `PLAYER_DIED`
  - `RESPAWN_OPTIONS` (to dead player only)

---------------------------------------------------------------------

### Respawn

Available respawn locations:
- corners (always)
- cleared machines (player-specific)

Rules:
- Respawn UI is **mandatory**
- No close / cancel option
- Player must choose a spawn

On respawn:
- `alive = true`
- `invulnUntil` set

Client behavior:
- blink effect
- invulnerability HUD indicator

---------------------------------------------------------------------

## 7) Sessions and game end

### Standard session
- Ends when Machine 10 is solved
```
GAME_ENDED { reason:"machine10" }
```

### Timed session
- Server sets `endAt`
- Included in:
  - `GAME_STARTED`
  - `STATE_SNAPSHOT`
- Ends when time expires
```
GAME_ENDED { reason:"time" }
```

---------------------------------------------------------------------

## 8) Win modes

### Standard
Priority:
1) correct
2) kills
3) money
4) deaths (ascending)

### Money
Priority:
1) money
2) correct
3) kills
4) deaths

FFA → top player  
Teams → aggregated team totals

---------------------------------------------------------------------

## 9) End screen UX

- Large end modal
- Big winner banner
- Winning team emphasized
- Leaderboard shown
- **Only option:** Back to lobby (reload)

---------------------------------------------------------------------

## 10) Networking (Socket.IO)

### Client → Server

- hello
- createGame
- joinGame
- assignTeam
- startGame
- input
- tryInteract
- submitAnswer
- chooseUpgrade
- declineUpgrade
- chooseUpgradeReplace
- useUpgradeSlot
- chooseRespawn

---------------------------------------------------------------------

### Server → Client

- WELCOME
- GAME_CREATED
- JOIN_SUCCESS
- JOIN_FAILED
- LOBBY_UPDATE
- GAME_STARTED
- STATE_SNAPSHOT
- MATH_PROMPT
- ANSWER_RESULT
- INTERACT_DENIED
- UPGRADE_OFFER
- UPGRADE_RESULT
- UPGRADE_DECLINED
- UPGRADE_USED
- PLAYER_DIED
- RESPAWN_OPTIONS
- RESPAWN_RESULT
- GAME_ENDED

---------------------------------------------------------------------

## 11) Authoritative server model — 🔒 FINAL

Server owns:
- movement
- collisions
- shooting
- economy
- machines
- upgrades
- mods computation
- death / respawn
- timers
- winner calculation

Client owns:
- rendering
- input
- UI only

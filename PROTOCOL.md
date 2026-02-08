# Timetable Clowns — Protocol (Single Source of Truth)

This file is the canonical reference for rules, architecture, and networking contracts
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
- Stackable unless explicitly stated otherwise
- Max **3 different permanent types**

Examples:
- XL Shoes
- Big Eyes
- Giraffoscope

---

### 4.1.1 Big Nose (disposable permanent)

Big Nose is a **special permanent upgrade**.

- Kind: `permanent`
- Stackable: ❌ no
- Limit: **max 1 Big Nose at a time**
- Acquire rule:
  - only available via `UPGRADE_OFFER`
  - only after a correct machine answer
- Cost: `acquireCost` paid on selection

Effect:
- Grants **one shield charge**
- When a **lethal cake projectile hit** would kill the player:
  - the hit is blocked
  - the player survives
  - knockback may be applied (server rule)
- Big Nose is **consumed immediately** after blocking

Restrictions:
- Only triggers on **cake projectile hits**
- Does NOT trigger on:
  - mines
  - melee
  - environmental effects

Rebuy:
- Player must answer another machine correctly
- Big Nose may then appear again in future offers

⚠️ Big Nose is **NOT** part of `player.mods`
It is a **server-side combat rule**, not a stat modifier.

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
UPGRADE_RESULT { ok:false, reason:"slots_full", requested, slots }


Client must run replace flow and respond with:
chooseUpgradeReplace { offerId, upgradeId, dropId }


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
UPGRADE_USED { ok:true, paid, used, money }


---------------------------------------------------------------------

## 5) Mods (gameplay modifiers) — 🔒 LOCKED CONTRACT

The server is the ONLY authority that converts upgrades into gameplay modifiers.

Snapshot contract:
mods: {
speedMult,
visionLenAdd,
fovAddDeg
}


Client must NEVER derive mods from upgrades.

---------------------------------------------------------------------

## 6) Combat, death, and respawn

- Shooting, collisions, damage, death are server authoritative

On death:
- `alive = false`
- Server emits:
  - `PLAYER_DIED`
  - `RESPAWN_OPTIONS`

Respawn:
- Mandatory selection
- No cancel / close
- Corners + cleared machines

---------------------------------------------------------------------

## 7) Sessions and game end

Standard:
GAME_ENDED { reason:"machine10" }


Timed:
GAME_ENDED { reason:"time" }


---------------------------------------------------------------------

## 8) End screen UX

- Large end modal
- Big winner banner
- Leaderboard shown
- **Only option:** Back to lobby (reload)

---------------------------------------------------------------------

## 9) Authoritative server model — 🔒 FINAL

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

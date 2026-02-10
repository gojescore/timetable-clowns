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
computed by the server and sent in `STATE_SNAPSHOT`.

---------------------------------------------------------------------

## 1) Game concept

Timetable Clowns is a silly top-down multiplayer game
for practicing multiplication tables.

- 2–12 players per match
- Host creates a game and receives a join code
- Guests join using the code
- Players progress independently through machines 1 → 10
- Top-down movement + shooting + upgrades + economy (all server-authoritative)

---------------------------------------------------------------------

## 2) Host-selectable settings

Sent on `createGame`:

- mode: `"ffa"` | `"teams"`
- teamCount: `1–4` (Teams only)
- friendlyFire: `boolean` (Teams only)
- tableBase: `1–10`
- mapChoice: `"map01"` | `"random"`
- inputMode: `"kb"` | `"kbm"` | `"kbm_gamepad"` (keyboard authoritative; others may be UI-only for now)
- sessionMode: `"standard"` | `"timed"`
- sessionMinutes: `1–60` (Timed only)
- winMode: `"standard"` | `"money"`

Rules:
- Standard sessions end when a player clears Machine 10
- Timed sessions end when the timer expires
- Timed sessions still use `winMode` to decide winner

---------------------------------------------------------------------

## 3) Core gameplay rules (server authoritative)

### 3.1 Machines & progression

- Interaction key: `E`
- Interaction allowed only within `INTERACT_RADIUS`
- Each player has independent progression:
  - `nextMachineNum` starts at `1`
  - must be solved in order
  - caps at `10`

Server denies interaction with:
- `INTERACT_DENIED { reason:"already_cleared", nextMachineNum, tried }`
- `INTERACT_DENIED { reason:"wrong_order", nextMachineNum, tried }`

Client behavior:
- Sends `tryInteract`
- Shows a short UX hint when denied (no gameplay changes client-side)

---------------------------------------------------------------------

### 3.2 Math prompts

- Prompt appears when interacting with the correct machine
- Formula:
  `tableBase × machineNum = ?`

Server responsibilities:
- generate prompt + promptId
- validate answer
- emit result

Server emits:
- `MATH_PROMPT { promptId, base, machineNum }`
- `ANSWER_RESULT { ok, correct? }`

Client behavior:
- prompt blocks gameplay input while open
- Enter submits
- Escape closes (client-side close is allowed; server remains authoritative)

---------------------------------------------------------------------

### 3.3 Economy

- Starting money: `$100`
- Money pickups:
  - `type: "money"`
  - default amount: `100`
- Economy is fully server-side:
  - spawning
  - collision/collection
  - rewards/penalties
  - authoritative money balance in snapshots

Client behavior:
- Displays money from snapshot
- Renders money pickups using `STATE_SNAPSHOT.pickups[]`

---------------------------------------------------------------------

## 4) Upgrades (implemented and working)

Upgrades are **data + effects**, but gameplay impact is always server-computed.

Two categories:
- **Permanent upgrades** (paid on acquisition, stacking rules apply)
- **Consumable upgrades** (paid on use, stored in 3 hotkey slots)

Upgrade UI/UX rules:
- Offers are server-issued via `UPGRADE_OFFER`
- Client displays choices and sends selections
- If a consumable backpack is full, client must run replace flow (see 4.2.3)
- Client may render upgrade icons/names/desc, but NEVER applies gameplay modifiers

### 4.1 Permanent upgrades

- Purchased immediately
- Money paid on selection (`acquireCost`)
- Stored permanently
- Stackable unless explicitly stated otherwise
- Max **3 different permanent types** at a time (types, not total count)

Examples (permanent, mods-driven):
- XL Shoes (speed modifier via `mods`)
- Big Eyes (FOV modifier via `mods`)
- Giraffoscope (vision length modifier via `mods`)

#### 4.1.1 Big Nose (special permanent — server combat rule)

Big Nose is a **special permanent upgrade** (not a stat modifier).

- Kind: `permanent`
- Stackable: ❌ no (max 1 Big Nose at a time)
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
  - mines / placed explosives
  - other future environmental effects

⚠️ Big Nose is **NOT** part of `player.mods`
It is a **server-side combat rule**, not a stat modifier.

---------------------------------------------------------------------

### 4.2 Consumable upgrades

- Stored in **3 slots**
- Hotkeys:
  - Slot 0 → `8`
  - Slot 1 → `9`
  - Slot 2 → `0`
- No duplicates by id
- Paid **when used** (`useCost`)
- Max 3 at a time

Implemented consumables so far (examples):
- Rubber Chicken
- Cake Surprise (mine/trap style)
- Glasses
- Banana Shot (banana bullets with wall bounces; server authoritative)

#### 4.2.1 Offer selection

Server emits:
- `UPGRADE_OFFER { offerId, options }`

Client sends:
- `chooseUpgrade { offerId, upgradeId }`
- or decline:
  - `declineUpgrade { offerId }` (client should send this when closing offer UI)

Server responds:
- `UPGRADE_RESULT { ok:true, money?, slots?, upgrades? }`
- or
- `UPGRADE_RESULT { ok:false, reason, need?, requested?, slots? }`

#### 4.2.2 Using consumables

Client sends:
- `useUpgradeSlot { slotIndex }`

Server validates:
- slot not empty
- player alive
- no blockers:
  - no math prompt open
  - no upgrade offer open
- sufficient money

Server emits:
- `UPGRADE_USED { ok:true, paid, used, money }`
- or failure:
  - `UPGRADE_USED { ok:false, reason, need?, money? }`

Common failure reasons:
- `empty_slot`
- `dead`
- `prompt_open`
- `offer_open`
- `not_enough_money`

#### 4.2.3 Backpack full → replace flow (LOCKED)

If consumable slots are full and the player selects a new consumable:
Server returns:
- `UPGRADE_RESULT { ok:false, reason:"slots_full", requested, slots }`

Client must:
1) show replace UI (“Replace? Y/N”)
2) if replace chosen, select one existing slot to drop
3) send:
- `chooseUpgradeReplace { offerId, upgradeId, dropId }`

Server then returns a normal `UPGRADE_RESULT` for success/failure.

---------------------------------------------------------------------

## 4.3 🔒 HOW TO ADD A NEW UPGRADE (LOCKED CHECKLIST)

Any new upgrade MUST follow this recipe.
If a step is skipped, the upgrade is considered invalid.

### A) Classify the upgrade
- ☐ Permanent (stat modifier via `mods`)
- ☐ Permanent special (combat rule, NOT mods)
- ☐ Consumable (slot-based, paid on use)

### B) Define it in `server/upgrades/definitions.js`
- ☐ unique `id`
- ☐ correct `kind`
- ☐ clear `desc`
- ☐ `acquireCost` (permanent) OR `useCost` (consumable)
- ☐ stacking / non-stacking rule explicitly stated
- ☐ any unique constraints documented (max 1, triggers, etc.)

### C) Implement server-side behavior
- ☐ If it affects movement / vision / FOV → modify `player.mods` ONLY
- ☐ If it affects combat / death / immunity → implement directly in server logic
- ☐ Client must never apply gameplay logic

### D) Networking & UI contract
- ☐ appears in `UPGRADE_OFFER`
- ☐ correct handling of:
  - insufficient money
  - duplicate prevention
  - full slots → replace flow
- ☐ upgrade info included in `STATE_SNAPSHOT` (for UI display)

### E) Documentation update (MANDATORY)
- ☐ add upgrade name to **STATE_OF_THE_GAME.md → Upgrades (IMPLEMENTED)**
- ☐ document any special rules (non-stacking, disposable, triggers)

### F) Manual verification
- ☐ can appear in offers
- ☐ purchase/use charges money correctly
- ☐ effect triggers exactly as designed
- ☐ no client-side modifier math introduced

---------------------------------------------------------------------

## 5) Mods (gameplay modifiers) — 🔒 LOCKED CONTRACT

The server is the ONLY authority that converts upgrades (and any other effects)
into gameplay modifiers.

Snapshot contract (per player):
`mods: { speedMult, visionLenAdd, fovAddDeg }`

- `speedMult`: number (default `1.0`)
- `visionLenAdd`: number (pixels added to base, default `0`)
- `fovAddDeg`: number (degrees added to base cone, default `0`)

Client rules:
- Client must NEVER derive mods from upgrades
- Client must ONLY read `player.mods` from `STATE_SNAPSHOT.players[]`

---------------------------------------------------------------------

## 6) Combat, death, invulnerability, and respawn

- Shooting, collisions, damage, death are server authoritative
- Respawn includes a brief invulnerability window:
  - `invulnUntil` is a server timestamp on the player
  - client may show a HUD indicator and blink effect (UI-only)

On death:
- `alive = false`
- Server emits:
  - `PLAYER_DIED { playerId }`
  - `RESPAWN_OPTIONS { killedBy?, options:[{id,label,kind}] }`

Respawn:
- Mandatory selection
- No cancel/close (player must choose)
- Options include:
  - corners (always)
  - cleared machines (when applicable)

Client sends:
- `chooseRespawn { spawnId }`

Server replies:
- `RESPAWN_RESULT { ok, reason? }`

---------------------------------------------------------------------

## 7) Sessions, timers, and game end

Game start:
- Server emits `GAME_STARTED { map, settings, endAt? }`
- Timed sessions include `endAt` (ms timestamp)

Snapshots:
- `STATE_SNAPSHOT { time, world, phase, endAt?, pickups, mines?, bullets, players[] }`

End conditions:

Standard:
- `GAME_ENDED { reason:"machine10", endedAt, winnerId, winnerName, winnerTeamId?, leaderboard, winMode }`

Timed:
- `GAME_ENDED { reason:"time", endedAt, winnerId, winnerName, winnerTeamId?, leaderboard, winMode }`

Winner calculation:
- winMode `"standard"`: primarily correct answers, then kills, then money, then deaths (server-defined)
- winMode `"money"`: primarily money, then correct answers, then kills, then deaths (server-defined)
- Teams mode decides winner at team-level (server-defined aggregation)

---------------------------------------------------------------------

## 8) End screen UX (client)

- Large end modal
- Big winner banner (team winner emphasized in Teams mode)
- Leaderboard shown
- **Only option:** Back to lobby (reload)

---------------------------------------------------------------------

## 9) Authoritative server model — 🔒 FINAL

Server owns:
- movement
- collisions
- shooting/projectiles
- damage/death
- respawn + invulnerability timestamps
- economy + pickups
- machines + prompts
- upgrades state + validation
- mods computation
- timers + end conditions
- winner/leaderboard calculation

Client owns:
- rendering (canvas + UI)
- input capture + sending input
- UI overlays (prompt, upgrades, respawn, end screen)
- displaying server state (including `player.mods`, `invulnUntil`, `endAt`)

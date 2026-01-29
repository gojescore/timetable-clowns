# Timetable Clowns — State of the Game (Restart Kit)

When starting a NEW chat thread, paste:
1) this file (STATE_OF_THE_GAME.md)
2) PROTOCOL.md
3) the one file we are editing right now

---

## Current folder structure (actual)
timetable-clowns/
- PROTOCOL.md                    (created now)
- STATE_OF_THE_GAME.md           (created now)
- server/
  - index.js
  - package.json
  - economy.js                   (added)
  - shared/
    - constants.js               (added)
  - maps/
    - index.js
    - map01.js
- client/
  - index.html

---

## What works right now (implemented)
### Lobby / multiplayer
- Host / guest
- Game code join
- Host assigns teams
- Start game works (requires >= 2 players and all have teamId)

### Map
- map01: 10 rooms, each room has >= 2 openings
- server/maps/index.js creates derived walls from room openings (perimeter walls with gaps)
- machines are flattened to `map.machines`

### Movement + collisions
- Server-authoritative movement with tick loop
- Collides with walls and machines (AABB)
- Client renders world + players + walls + machines

### Machine interaction (ordered)
- Press E near machine to open prompt
- Must do machine numbers in order (nextMachineNum)
- Wrong order emits INTERACT_DENIED (client shows speech bubble)

### Times-table prompt
- Server sends MATH_PROMPT { base, machineNum }
- Client shows overlay and submits answer

### Economy (money + pickups) ✅
Server:
- Each player starts with money=100
- Wrong answer: -100 money (floor 0)
- Correct answer: spawns money pickup(s) on roads/spaces only
- Server collects pickups when player close enough
- Snapshot includes `pickups` and each player’s `money`

Client:
- HUD shows YOUR money
- Pickups are rendered as small green rectangles with `$` inside

---

## Key files and what they do
### server/index.js
- game creation/join
- tick loop movement
- machine prompt flow
- hooks into economy:
  - on correct -> economy.awardCorrectAnswer()
  - on wrong -> economy.penalizeWrongAnswer()
  - each tick -> economy.tryCollectPickups()
- includes pickups + money in STATE_SNAPSHOT

### server/economy.js
- spawn pickups on roads (using derived map.isRoad)
- pickup TTL cleanup
- pickup collection

### server/shared/constants.js
- tweakable numbers:
  - start money
  - penalty amount
  - pickup amount
  - pickup radius
  - pickup TTL
  - spawn tries

### server/maps/map01.js
- map data: rooms, walls, spawns
- roadAreas (rectangles representing corridors)

### server/maps/index.js
- builds derived map using structuredClone + room walls
- IMPORTANT: adds `derived.isRoad(x,y)` at runtime (functions in map files don’t survive clone)

### client/index.html
- start/lobby/running screens
- canvas renderer
- prompt overlay UI
- HUD (money)
- draws pickups (green rectangle with `$`)

---

## Known constraints / gotchas
- structuredClone() removes functions from map objects.
  - Therefore map helpers must be attached in buildDerived().

- Client currently renders machines from GAME_STARTED payload (mapData).
  - Pickups come from STATE_SNAPSHOT (lastSnapshot.pickups).

---

## Next ONE task (selected)
Money system is implemented. Next task should be ONE of:
- Upgrade system scaffold (definitions + server state + UI selection stub)
- HUD expansion (life + upgrade bar placeholders)
- Combat/shooting scaffold (server bullets + client render)
- Fog-of-war cone rendering (client-only first)

(Choose ONE per iteration.)

---

## How to quickly verify everything
1) Run server
2) Open two browser tabs
3) Host game in tab1, guest joins in tab2
4) Assign teams, start game
5) Move to machine 1, press E, answer correctly
6) Green `$` pickup should appear on road and be collectible
7) Money should increase in HUD when collected
8) Wrong answer should reduce money by 100 (floored at 0)

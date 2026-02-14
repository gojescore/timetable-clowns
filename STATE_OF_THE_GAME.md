## ✅ STATE_OF_THE_GAME.md (updated — full file)

```md
# Timetable Clowns — STATE_OF_THE_GAME.md (Restart Kit)

When starting a NEW chat thread, paste ALL THREE:
1) this file (STATE_OF_THE_GAME.md)
2) PROTOCOL.md
3) the file currently being edited

Last updated: 2026-02-14

---------------------------------------------------------------------

🔒 One-liner that prevents future confusion

Client may display upgrades, but must never compute gameplay modifiers from them; modifiers come only from player.mods (server-computed) inside STATE_SNAPSHOT.

---------------------------------------------------------------------

## Current folder structure (actual)

timetable-clowns/
├─ PROTOCOL.md
├─ STATE_OF_THE_GAME.md
├─ server/
│  ├─ index.js
│  ├─ package.json
│  ├─ economy.js
│  ├─ upgrades/
│  │  ├─ definitions.js
│  │  └─ apply.js
│  ├─ shared/
│  │  └─ constants.js
│  └─ maps/
│     ├─ index.js
│     └─ map01.js
└─ client/
   ├─ index.html
   └─ assets/
      └─ wig_master_64.png

---------------------------------------------------------------------

## What works right now (implemented)

### Lobby / multiplayer
- Host creates game → join code
- Guests join by code
- Lobby shows players and settings
- Teams mode: host can assign teamId (0..teamCount-1)
- Start game validation:
  - >= 2 players
  - Teams mode: all players have teamId

### Map
- `map01` “Training Hall (10 rooms)”
- World size: 2400 × 1600
- 10 rooms each with a machine (1..10)
- `maps/index.js` builds derived data:
  - walls generated from room perimeters + openings
  - machines flattened into `map.machines`

### Movement + collision (server-authoritative)
- Server tick: 20 Hz
- Players move with speed = PLAYER_SPEED × me.mods.speedMult
- Collisions:
  - walls (AABBs)
  - machines (solid AABBs)
- Balloon “phase” can bypass collision (server-controlled)

### Machine progression
- Interact radius: 60
- Must clear machines in order (per-player)
- `tryInteract` → server emits `MATH_PROMPT`
- `submitAnswer`:
  - correct: advances, refills cakes, awards money, upgrade offer
  - wrong: penalty

### Shooting / bullets
- Cakes:
  - speed 780
  - ttl 2.0s
  - collision: walls/machines destroy bullet
  - player hit uses sweep segment-circle and respects invuln + friendlyFire
- Banana shot (consumable projectile):
  - bounces off walls with limited bounces
  - dies on machines
  - uses sweep vs expanded AABBs for robust collision

### Mines
- Cake Surprise mine:
  - placed by consumable action
  - does NOT expire (persists until triggered or game end)
  - triggers when enemy steps within trigger radius
  - blast kills within blast radius

### Jack in the Box
- Spawns a world object that reveals fog in radius
- TTL is long by default (can be capped)
- Per-player max active enforced (default 1)

### Dash (Rubber Chicken)
- Dash is stored server-side in player.effects.dash
- During dash:
  - movement direction is forced to dash direction
  - dash hit checks sweep from previous to current pos
  - respects friendlyFire and invulnerability

### Big Nose (bullet-only save)
- If player has permanent BIG_NOSE and takes a lethal bullet:
  - consume one stack
  - grant brief invulnerability
  - push victim away from shooter safely

### Respawn system
- On death:
  - dead player receives `RESPAWN_OPTIONS`
  - options include:
    - 4 corners always
    - any machines that player has cleared
- `chooseRespawn` spawns at a valid position with invulnerability

### Timed sessions + win modes
- sessionMode:
  - standard: end when a player clears machine #10
  - timed: end when now >= endAt
- winMode (for leaderboard sorting):
  - standard: correct > kills > money > fewer deaths
  - money: money > correct > kills > fewer deaths

### End screen + back to lobby
- Server emits `GAME_ENDED` and snapshot
- Only intended next action is “Back to lobby”
- Host uses `backToLobby`:
  - server resets match runtime state
  - emits `RETURNED_TO_LOBBY` and `LOBBY_UPDATE`

---------------------------------------------------------------------

## “Server sends mods” migration status (CURRENT)

LOCKED and implemented in `server/index.js` snapshot:

- Server computes `mods` using upgrades.computePlayerMods(player, nowMs)
- Snapshot includes `players[].mods`
- Client must read mods and must not compute speed/fog from upgrades

mods fields:
- speedMult (default 1.0)
- visionLenAdd (default 0)
- fovAddDeg (default 0)

---------------------------------------------------------------------

## Player rendering (client-only, CURRENT WORK)

Goal:
- Top-down clown visuals where facing direction matches the fog cone direction.
- Hair is a pixel sprite tinted by team color.
- Feet are simple vector shapes behind the head, also rotating with facing direction.

Asset:
- `client/assets/wig_master_64.png`

Asset requirements (to make tinting reliable):
1) MUST have transparent background (alpha = 0).
2) Hair region should be “tintable” without tinting outlines/background.
   Recommended: hair fill uses a bright base hue (e.g. red/pink) and shading is done by luminance,
   while outlines are near-black and should remain mostly unchanged.
3) The client tints the hair by mapping the hair pixels to the team color while preserving luminance.

Facing:
- For the local player:
  - facing angle comes from fog cone direction (mouse aim OR server dirX/dirY fallback)
- For other players:
  - facing angle comes from their server `dirX/dirY`

---------------------------------------------------------------------

## Known fragile areas / common regressions

1) Client accidentally recomputes fog/speed from upgrades instead of mods.
2) Client event handlers duplicated (nested keydown / multiple socket.on) causing stuck UI or double-actions.
3) Upgrade decline mismatch (server expects `declineUpgrade { offerId }` and client not clearing overlay on `UPGRADE_DECLINED` / `UPGRADE_RESULT`).
4) Hard refresh triggers favicon.ico request; harmless 404 unless you add favicon.
5) Player hair sprite issues:
   - wig_master_64.png background not transparent
   - tint mask too broad/narrow (tints wrong pixels or nothing)

---------------------------------------------------------------------

## How to continue in a new thread (workflow)

When you open a new chat:
1) Paste PROTOCOL.md (full)
2) Paste STATE_OF_THE_GAME.md (full)
3) Paste the single file you want to work on next (e.g., client/index.html)

Then say what is broken and what you expect to happen.
Now: fixing wig_master_64.png tint + transparency (without waiting)
Right now your tint code assumes the wig has:

alpha transparency, and

hair pixels in a red/pink-ish range (isWigPixel(...))

If the background is not transparent, you have two immediate options:

Option A — Fix it in code (chroma-key the background)
If your sprite background is a solid color, treat it as “transparent” during the tinting pass.

Add this inside getTintedWigForTeam() right before isWigPixel(...):

// --- CHROMA KEY (make background transparent) ---
// Choose a key color that matches the wig image background.
// Example: if background is pure black, use (0,0,0). If it’s a flat blue, use that.
const BG = { r: 14, g: 22, b: 48 }; // <-- adjust to your actual background
const BG_TOL = 22;                  // tolerance 0..255

function isBg(r,g,b,a){
  if (a < 10) return true;
  return Math.abs(r - BG.r) <= BG_TOL &&
         Math.abs(g - BG.g) <= BG_TOL &&
         Math.abs(b - BG.b) <= BG_TOL;
}
Then in your pixel loop:

if (isBg(r, gg, b, a)) {
  data[i+3] = 0; // transparent
  continue;
}
This will immediately fix “background not transparent” even before you redraw the sprite.

Option B — Make a better master sprite (recommended)
Make wig_master_64.png with:

transparent background

hair fill in a single “mask color” (bright pink/red)

dark outline kept very dark (near black)

Then your current luminance-preserving tint works nicely.

Prompt you can use to generate the new sprite
If you want me to generate it (pixel-art style), tell me:

“Nova, generate wig_master_64.png”
and I’ll output a clean top-down wig sprite with transparent background and a tint-friendly mask.

One more small improvement to your tint mask (prevents tinting outlines)
Your isWigPixel() currently tints “red-ish” pixels, but it might still tint unwanted pixels.

Replace it with this (more robust):

function isWigPixel(r,g,b,a){
  if (a < 10) return false;

  // Keep outlines un-tinted (very dark pixels)
  const lum = (0.2126*r + 0.7152*g + 0.0722*b);
  if (lum < 35) return false;

  // Accept saturated warm pixels (pink/red wig mask)
  const maxc = Math.max(r,g,b);
  const minc = Math.min(r,g,b);
  const sat = maxc - minc;

  const warm = (r > g + 20) && (r > b + 10);
  return warm && sat > 35;
}

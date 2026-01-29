module.exports = {
  id: "map01",
  name: "Training Hall",
  world: { w: 2400, h: 1600 },

  // Walls are rectangles (x,y,w,h). Later we’ll add rooms/doors.
  walls: [
    // Outer border is handled by clamping; these are interior walls:
    { x: 500, y: 300, w: 1400, h: 40 },
    { x: 500, y: 300, w: 40,   h: 700 },
    { x: 500, y: 960, w: 1400, h: 40 },
    { x: 1860,y: 300, w: 40,   h: 700 },

    // A center block
    { x: 1120, y: 640, w: 160, h: 160 },
  ],

  // For later: machine spots / spawn spots (placeholder)
  spawns: [
    { x: 260, y: 260 },
    { x: 2140, y: 1340 },
    { x: 260, y: 1340 },
    { x: 2140, y: 260 },
  ],
};

rooms: [
  {
    id: "roomA",
    rect: { x: 400, y: 260, w: 520, h: 420 },

    // openings are door gaps on the room edges
    // side: "N"|"S"|"E"|"W", and "at" is offset along that edge
    // size is doorway width (for N/S) or height (for E/W)
    openings: [
      { side: "N", at: 220, size: 120 }, // doorway on top edge
      { side: "E", at: 160, size: 120 }, // doorway on right edge
    ],

    machines: [
      { id: "m1", num: 6, x: 600, y: 420 },
      { id: "m2", num: 9, x: 780, y: 520 },
    ],
  },

  {
    id: "roomB",
    rect: { x: 1400, y: 820, w: 520, h: 420 },
    openings: [
      { side: "W", at: 160, size: 120 },
      { side: "S", at: 220, size: 120 },
    ],
    machines: [
      { id: "m3", num: 3, x: 1580, y: 1020 },
    ],
  },
],

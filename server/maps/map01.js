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


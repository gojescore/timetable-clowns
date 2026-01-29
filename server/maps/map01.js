module.exports = {
  id: "map01",
  name: "Training Hall",
  world: { w: 2400, h: 1600 },

  // Spawn points (used on game start)
  spawns: [
    { x: 260, y: 260 },
    { x: 2140, y: 260 },
    { x: 260, y: 1340 },
    { x: 2140, y: 1340 },
  ],

  // Rooms — EACH has exactly ONE machine and AT LEAST TWO openings
  rooms: [
    {
      id: "roomA",
      rect: { x: 400, y: 260, w: 520, h: 420 },

      openings: [
        { side: "N", at: 260, size: 120 },
        { side: "E", at: 210, size: 120 },
      ],

      machines: [
        { id: "m1", num: 6, x: 660, y: 470 },
      ],
    },

    {
      id: "roomB",
      rect: { x: 1400, y: 820, w: 520, h: 420 },

      openings: [
        { side: "W", at: 210, size: 120 },
        { side: "S", at: 260, size: 120 },
      ],

      machines: [
        { id: "m2", num: 3, x: 1660, y: 1030 },
      ],
    },
  ],

  // Extra standalone walls (roads / obstacles)
  walls: [
    { x: 1120, y: 640, w: 160, h: 160 },
  ],
};

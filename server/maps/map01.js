module.exports = {
  id: "map01",
  name: "Training Hall (10 rooms)",
  world: { w: 2400, h: 1600 },

  spawns: [
    { x: 140, y: 140 },
    { x: 2260, y: 140 },
    { x: 140, y: 1460 },
    { x: 2260, y: 1460 },
  ],

  // 10 rooms, each:
  // - exactly 1 machine
  // - at least 2 openings
  rooms: [
    // Row 1 (y ~ 140)
    {
      id: "r1",
      rect: { x: 140, y: 140, w: 420, h: 260 },
      openings: [
        { side: "E", at: 130, size: 120 },
        { side: "S", at: 210, size: 120 },
      ],
      machines: [{ id: "m1", num: 1, x: 350, y: 270 }],
    },
    {
      id: "r2",
      rect: { x: 620, y: 140, w: 420, h: 260 },
      openings: [
        { side: "W", at: 130, size: 120 },
        { side: "S", at: 210, size: 120 },
      ],
      machines: [{ id: "m2", num: 2, x: 830, y: 270 }],
    },
    {
      id: "r3",
      rect: { x: 1100, y: 140, w: 420, h: 260 },
      openings: [
        { side: "E", at: 130, size: 120 },
        { side: "S", at: 210, size: 120 },
      ],
      machines: [{ id: "m3", num: 3, x: 1310, y: 270 }],
    },
    {
      id: "r4",
      rect: { x: 1580, y: 140, w: 420, h: 260 },
      openings: [
        { side: "W", at: 130, size: 120 },
        { side: "S", at: 210, size: 120 },
      ],
      machines: [{ id: "m4", num: 4, x: 1790, y: 270 }],
    },

    // Row 2 (y ~ 500)
    {
      id: "r5",
      rect: { x: 140, y: 500, w: 420, h: 260 },
      openings: [
        { side: "E", at: 130, size: 120 },
        { side: "N", at: 210, size: 120 },
      ],
      machines: [{ id: "m5", num: 5, x: 350, y: 630 }],
    },
    {
      id: "r6",
      rect: { x: 620, y: 500, w: 420, h: 260 },
      openings: [
        { side: "W", at: 130, size: 120 },
        { side: "N", at: 210, size: 120 },
      ],
      machines: [{ id: "m6", num: 6, x: 830, y: 630 }],
    },
    {
      id: "r7",
      rect: { x: 1100, y: 500, w: 420, h: 260 },
      openings: [
        { side: "E", at: 130, size: 120 },
        { side: "N", at: 210, size: 120 },
      ],
      machines: [{ id: "m7", num: 7, x: 1310, y: 630 }],
    },
    {
      id: "r8",
      rect: { x: 1580, y: 500, w: 420, h: 260 },
      openings: [
        { side: "W", at: 130, size: 120 },
        { side: "N", at: 210, size: 120 },
      ],
      machines: [{ id: "m8", num: 8, x: 1790, y: 630 }],
    },

    // Row 3 (2 rooms centered)
    {
      id: "r9",
      rect: { x: 500, y: 980, w: 560, h: 360 },
      openings: [
        { side: "E", at: 180, size: 140 },
        { side: "S", at: 280, size: 140 },
      ],
      machines: [{ id: "m9", num: 9, x: 780, y: 1160 }],
    },
    {
      id: "r10",
      rect: { x: 1340, y: 980, w: 560, h: 360 },
      openings: [
        { side: "W", at: 180, size: 140 },
        { side: "S", at: 280, size: 140 },
      ],
      machines: [{ id: "m10", num: 10, x: 1620, y: 1160 }],
    },
  ],

  // Extra obstacle on roads (optional)
  walls: [
    { x: 1120, y: 820, w: 160, h: 160 },
  ],
};

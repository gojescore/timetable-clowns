module.exports = {
  id: "map01",
  name: "Training Hall",
  world: { w: 2400, h: 1600 },

  // Spawn points (used on game start)
  spawns: [
    { x: 260, y: 260 },
    { x: 2140, y: 1340 },
    { x: 260, y: 1340 },
    { x: 2140, y: 260 },
  ],

  // Rooms with >= 2 openings EACH (rule enforced in maps/index.js)
  rooms: [
    {
      id: "roomA",
      rect: { x: 400, y: 260, w: 520, h: 420 },
      openings: [
        { side: "N", at: 260, size: 120 },
        { side: "E", at: 210, size: 120 },
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
        { side: "W", at: 210, size: 120 },
        { side: "S", at: 260, size: 120 },
      ],
      machines: [
        { id: "m3", num: 3, x: 1580, y: 1020 },
      ],
    },
  ],

  // Optional extra walls (outside rooms). Can be empty.
  walls: [
    // A simple center obstacle on the roads/spaces
    { x: 1120, y: 640, w: 160, h: 160 },
  ],
};

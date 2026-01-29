const map01 = require("./map01");

const MAPS = {
  [map01.id]: map01,
};

function listMaps() {
  return Object.values(MAPS).map(m => ({ id: m.id, name: m.name }));
}

function pickMap(mapChoice) {
  const maps = Object.values(MAPS);
  if (!maps.length) throw new Error("No maps registered");

  if (!mapChoice || mapChoice === "random") {
    return maps[Math.floor(Math.random() * maps.length)];
  }
  return MAPS[mapChoice] || maps[0];
}

module.exports = { MAPS, listMaps, pickMap };


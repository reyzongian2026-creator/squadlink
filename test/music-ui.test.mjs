import assert from "node:assert/strict";
import test from "node:test";
import {radioStations, stationById} from "../public/radio-stations.js";
import {stationsForGenre, roomPosition} from "../public/music.js";

test("cada género ofrece únicamente sus emisoras y todos muestra el catálogo completo", () => {
  assert.ok(radioStations.length > 0);
  assert.deepEqual(stationsForGenre(""), radioStations);
  const genres = [...new Set(radioStations.map(station => station.genre))];
  for (const genre of genres) {
    const group = stationsForGenre(genre);
    assert.ok(group.length > 0);
    assert.ok(group.every(station => station.genre === genre));
  }
  assert.deepEqual(stationsForGenre("__desconocido__"), []);
});

test("las emisoras tienen identificadores únicos y URLs HTTPS del catálogo", () => {
  const ids = new Set();
  for (const station of radioStations) {
    assert.ok(station.id && station.name && station.genre);
    assert.ok(!ids.has(station.id));
    ids.add(station.id);
    assert.equal(new URL(station.url).protocol, "https:");
  }
});

test("el archivo empieza en el punto que corresponde a la sala al llegar tarde", () => {
  assert.equal(roomPosition(100000, 850, 114150), 15);
  assert.equal(roomPosition(100000, -1500, 110000), 8.5);
  assert.equal(roomPosition(1000, 0, 900), 0);
  assert.equal(roomPosition(null, 0), 0);
});

test('Electrónica ofrece tech house y EDM, y las colas existentes aún pueden reproducir Groove Salad', () => {
  assert.deepEqual(stationsForGenre('Electrónica').map(station => station.id), ['tech-house','sunshine-edm']);
  assert.equal(stationsForGenre('').some(station => station.id === 'groove-salad'), false);
  assert.equal(stationById('groove-salad')?.name, 'SomaFM · Groove Salad');
  assert.equal(stationById('desconocida'), undefined);
});

import assert from "node:assert/strict";
import test from "node:test";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import {youtubeId, roomPosition} from "../public/music.js";

const id = "Abc_123-Xyz";
test("reconoce enlaces de video y rechaza dominios ajenos e identificadores inválidos", () => {
  for (const input of ["https://youtu.be/" + id, "https://www.youtube.com/watch?v=" + id + "&list=123",
    "https://music.youtube.com/watch?v=" + id, "https://m.youtube.com/shorts/" + id]) assert.equal(youtubeId(input), id);
  for (const input of ["", id, "https://youtu.be/short", "https://youtube.com.ejemplo.org/watch?v=" + id,
    "https://ejemplo.org@youtu.be/" + id, "javascript:alert(1)", "https://youtube.com/playlist?list=" + id])
    assert.equal(youtubeId(input), null);
});

test("el oyente que llega tarde sigue el reloj del servidor", () => {
  assert.equal(roomPosition(100000, 850, 114150), 15);
  assert.equal(roomPosition(100000, -1500, 110000), 8.5);
  assert.equal(roomPosition(1000, 0, 900), 0);
  assert.equal(roomPosition(null, 0), 0);
});

test("el puente YouTube acepta solo al padre previsto, sincroniza y pausa al ocultarse", async () => {
  const parentOrigin = "squad://app", channel = "squadlink:music";
  const out = [], scripts = [], status = {}, handlers = {};
  let events, cursor = 0, playCount = 0, pauses = 0, volume;
  const parent = {postMessage(message, origin) { assert.equal(origin, parentOrigin); out.push(message); }};
  class Player {
    constructor(_id, options) { events = options.events; }
    getIframe() { return {}; }
    getDuration() { return 85; }
    getCurrentTime() { return cursor; }
    getPlayerState() { return 1; }
    setVolume(value) { volume = value; }
    seekTo(time) { cursor = time; }
    playVideo() { playCount++; }
    pauseVideo() { pauses++; }
  }
  const win = {};
  const sandbox = {window: win, parent, performance: {now: () => 1000}, URLSearchParams,
    location: {origin: "https://lobby.example", search: "?video=" + id},
    addEventListener(type, cb) { handlers[type] = cb; },
    YT: {Player, PlayerState: {PLAYING: 1, ENDED: 0}},
    document: {getElementById: () => status, createElement: () => ({}), head: {append: script => scripts.push(script)}}};
  vm.runInNewContext(await readFile(new URL("../public/music-youtube.js", import.meta.url), "utf8"), sandbox);
  const msg = (action, data, origin = parentOrigin, source = parent) => handlers.message({source, origin, data: {channel, action, ...data}});
  msg("connect", {}, "https://other.example"); msg("connect", {}, parentOrigin, {});
  assert.equal(scripts.length, 0);
  msg("connect"); assert.equal(scripts.length, 1);
  win.onYouTubeIframeAPIReady(); events.onReady();
  assert.ok(out.find(value => value.action === "duration" && value.seconds === 85));
  msg("play", {position: 21, volume: 42}, "https://other.example");
  assert.equal(playCount, 0);
  msg("play", {position: 21, volume: 42});
  assert.deepEqual([playCount, cursor, volume], [1, 21, 42]);
  events.onStateChange({data: 1});
  msg("sync", {position: 42}); assert.equal(cursor, 42);
  msg("pause"); events.onStateChange({data: 0});
  assert.equal(pauses, 1); assert.ok(!out.some(m => m.action === "ended"));
  msg("play", {position: 83}); events.onStateChange({data: 1}); events.onStateChange({data: 0});
  assert.equal(out.filter(m => m.action === "ended").length, 1);
});

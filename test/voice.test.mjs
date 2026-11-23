// Browser-independent checks for signaling order, media teardown and permission races.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceRoom } from '../public/voice.js';

function createRoom() {
  return new VoiceRoom({ selfId: 'B', sendSignal: async () => {} });
}

function fakeTrack() {
  return { kind: 'audio', readyState: 'live', stop() { this.readyState = 'ended'; } };
}

function fakeStream(track) {
  return { active: true, getTracks: () => [track], getAudioTracks: () => [track] };
}

test('candidate before offer and candidate from next ICE generation survive reorder', async t => {
  class FakePeer {
    constructor() {
      this.added = [];
      this.transceiver = { receiver: { track: fakeTrack() }, sender: { replaceTrack: async () => {} } };
    }
    async setRemoteDescription(value) { this.remoteDescription = value; }
    getTransceivers() { return [this.transceiver]; }
    async createAnswer() { return { type: 'answer', sdp: 'v=0\r\n' }; }
    async setLocalDescription(value) { this.localDescription = { toJSON: () => value }; }
    async addIceCandidate(value) { this.added.push(value); }
    close() { this.closed = true; }
  }
  globalThis.RTCPeerConnection = FakePeer;
  globalThis.document = { createElement: () => ({ pause() {} }) };
  t.after(() => { delete globalThis.RTCPeerConnection; delete globalThis.document; });
  const room = createRoom();
  room.syncMembers(['A', 'B']);
  const pc = room.peers.get('A').pc;
  const announce = usernameFragment => room.receive('A', { candidate: { usernameFragment } });
  const offer = ufrag => room.receive('A', { description: { type: 'offer', sdp: 'v=0\r\na=ice-ufrag:' + ufrag + '\r\n' } });
  await announce('first');
  assert.equal(pc.added.length, 0);
  await offer('first');
  await announce('second');
  assert.equal(pc.added.length, 1);
  await offer('second');
  assert.deepEqual(pc.added.map(c => c.usernameFragment), ['first', 'second']);
  await room.receive('someone-else', { candidate: { usernameFragment: 'second' } });
  assert.equal(room.peers.size, 1);
  room.syncMembers(['B']);
  assert.equal(pc.closed, true);
  assert.equal(room.peers.size, 0);
});

test('closing a room releases microphone permission granted after exit', async t => {
  let grant;
  const mediaDevices = { getUserMedia: () => new Promise(resolve => { grant = resolve; }) };
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: mediaDevices });
  t.after(() => delete navigator.mediaDevices);
  const track = fakeTrack();
  const room = createRoom();
  const activation = room.setMicrophone(true);
  room.close();
  grant(fakeStream(track));
  assert.equal(await activation, false);
  assert.equal(track.readyState, 'ended');
  assert.equal(room.stream, null);
});

test('muting releases the hardware track and permits listening', async t => {
  const track = fakeTrack();
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => fakeStream(track) } });
  t.after(() => delete navigator.mediaDevices);
  const room = createRoom();
  assert.equal(await room.setMicrophone(true), true);
  assert.equal(await room.setMicrophone(false), false);
  assert.equal(track.readyState, 'ended');
  assert.equal(room.closed, false);
  room.close();
});

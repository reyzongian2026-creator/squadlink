import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceRoom } from '../public/voice.js';

class TestPeer {
  connectionState = 'new';
  signalingState = 'stable';
  rollbacks = 0;
  addTransceiver() { return { sender: { replaceTrack: async () => {} } }; }
  async createOffer({ iceRestart }) { return { type: 'offer', sdp: 'v=0', iceRestart }; }
  async setLocalDescription(description) {
    if (description.type === 'rollback') {
      this.rollbacks++;
      this.signalingState = 'stable';
    } else {
      this.localDescription = { toJSON: () => description };
      this.signalingState = 'have-local-offer';
    }
  }
  async setRemoteDescription(description) { this.remoteDescription = description; this.signalingState = 'stable'; }
  changeState(state) { this.connectionState = state; this.onconnectionstatechange?.(); }
  close() { this.changeState('closed'); }
}

function setup(t, selfId = 'A') {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  globalThis.RTCPeerConnection = TestPeer;
  globalThis.document = { createElement: () => ({ pause() {} }) };
  const sent = [];
  let online = false;
  const room = new VoiceRoom({ selfId, sendSignal: async (to, data) => {
    sent.push({ to, data, online });
    if (!online) throw Error('offline');
  } });
  room.syncMembers(['A', 'B']);
  const peer = [...room.peers.values()][0];
  t.after(() => { room.close(); delete globalThis.RTCPeerConnection; delete globalThis.document; });
  async function advance(ms) { t.mock.timers.tick(ms); await peer.incoming; }
  return { room, peer, sent, advance, setOnline: value => { online = value; } };
}

test('the offerer can reconnect after a prolonged outage without rejoining the room', async t => {
  const { room, peer, sent, advance, setOnline } = setup(t);
  setOnline(true);
  await peer.incoming;
  await room.receive('B', { description: { type: 'answer', sdp: 'v=0' } });
  peer.pc.changeState('connected');
  setOnline(false);
  peer.pc.changeState('failed');
  await advance(4000);
  await advance(8000);
  await advance(12000);
  assert.equal(sent.length, 4);
  // Keep the room disconnected well past the original three retries.
  for (let second = 0; second < 180; second++) await advance(1000);
  setOnline(true);
  const before = sent.length;
  for (let second = 0; second < 30 && sent.length === before; second++) await advance(1000);
  assert.equal(sent.length, before + 1);
  assert.equal(sent.at(-1).online, true);
  assert.equal(sent.at(-1).data.description.iceRestart, true);
  assert.equal(peer.pc.rollbacks, sent.length - 2);

  await room.receive('B', { description: { type: 'answer', sdp: 'v=0' } });
  peer.pc.changeState('connected');
  const afterRecovery = sent.length;
  await advance(120000);
  assert.equal(sent.length, afterRecovery);
  peer.pc.changeState('disconnected');
  await advance(3999);
  assert.equal(sent.length, afterRecovery);
  await advance(1);
  assert.equal(sent.length, afterRecovery + 1);
});

test('long-lived retries stay spaced out and stop when the participant leaves', async t => {
  const { room, peer, sent, advance } = setup(t);
  await peer.incoming;
  for (let second = 0; second < 180; second++) await advance(1000);
  const count = sent.length;
  for (let second = 0; second < 90; second++) await advance(1000);
  assert.equal(sent.length - count, 3);
  room.syncMembers(['A']);
  const afterDeparture = sent.length;
  await advance(120000);
  assert.equal(sent.length, afterDeparture);
  assert.equal(peer.pc.connectionState, 'closed');
});

test('the answering participant never starts a competing recovery offer', async t => {
  const { peer, sent, advance } = setup(t, 'B');
  peer.pc.changeState('failed');
  await advance(120000);
  assert.equal(sent.length, 0);
});

test('una renegociación conserva la reproducción y descarta solicitudes antiguas', async t => {
  const {room, peer} = setup(t, 'B');
  globalThis.MediaStream = class {
    constructor(tracks) { this.tracks = tracks; }
    getAudioTracks() { return this.tracks; }
  };
  t.after(() => { delete globalThis.MediaStream; });
  const plays = [];
  peer.audio.play = async () => { plays.push(peer.audio.srcObject); };
  const first = {kind:'audio'}, replacement = {kind:'audio'};
  peer.pc.ontrack({track:first});
  const originalStream = peer.audio.srcObject;
  await Promise.resolve();
  peer.pc.ontrack({track:first});
  assert.equal(peer.audio.srcObject, originalStream);
  await Promise.resolve();
  assert.deepEqual(plays, [originalStream]);
  peer.pc.ontrack({track:{kind:'audio'}});
  peer.pc.ontrack({track:replacement});
  const latestStream = peer.audio.srcObject;
  await Promise.resolve();
  assert.deepEqual(plays, [originalStream, latestStream]);
  assert.equal(latestStream.getAudioTracks()[0], replacement);
  peer.pc.ontrack({track:{kind:'audio'}});
  room.close();
  await Promise.resolve();
  assert.equal(plays.length, 2);
});

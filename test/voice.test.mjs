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

function installMedia(t, getUserMedia) {
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia } });
  t.after(() => delete navigator.mediaDevices);
}

test('changing input and suppression during a call replaces the sender track and persists preferences', async t => {
  const storage = new Map();
  globalThis.window = { localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } };
  t.after(() => delete globalThis.window);
  const requested = [];
  installMedia(t, async ({ audio }) => {
    requested.push(audio);
    return fakeStream(fakeTrack());
  });
  const room = createRoom();
  const sent = [];
  room.peers.set('A', { incoming: Promise.resolve(), transceiver: { sender: { replaceTrack: async track => sent.push(track) } } });
  await room.setMicrophone(true);
  const first = room.stream.getAudioTracks()[0];
  await room.configureAudio({ inputId: 'usb-microphone' });
  const second = room.stream.getAudioTracks()[0];
  assert.equal(first.readyState, 'ended');
  assert.deepEqual(requested[1].deviceId, { exact: 'usb-microphone' });
  assert.equal(second, sent[1]);
  await room.configureAudio({ noiseSuppression: false });
  assert.equal(second.readyState, 'ended');
  assert.equal(requested.at(-1).noiseSuppression, false);
  const nextRoom = createRoom();
  assert.deepEqual(nextRoom.settings, { inputId: 'usb-microphone', outputId: '', noiseSuppression: false });
});

test('failed input selection keeps existing microphone and saved setting', async t => {
  const working = fakeStream(fakeTrack());
  installMedia(t, async ({ audio }) => {
    if (audio.deviceId) throw Object.assign(new Error(), { name: 'OverconstrainedError' });
    return working;
  });
  const room = createRoom();
  await room.setMicrophone(true);
  await assert.rejects(room.configureAudio({ inputId: 'disconnected' }), /No se encontró/);
  assert.equal(room.stream, working);
  assert.equal(working.getAudioTracks()[0].readyState, 'live');
  assert.equal(room.settings.inputId, '');
  room.close();
});

test('muted input selection stores preference without opening the microphone', async t => {
  installMedia(t, () => assert.fail('unexpected capture'));
  const room = createRoom();
  await room.configureAudio({ inputId: 'usb' });
  await room.configureAudio({ noiseSuppression: false });
  assert.equal(room.settings.inputId, 'usb');
  assert.equal(room.stream, null);
});

test('output change routes every remote participant and restores all outputs when switching fails', async () => {
  const room = createRoom();
  const speaker = reject => ({
    id: '',
    async setSinkId(id) {
      if (reject && id === 'bad') throw new Error('device unavailable');
      this.id = id;
    }
  });
  const a = speaker(false), b = speaker(true);
  room.peers.set('A', { audio: a });
  room.peers.set('C', { audio: b });
  await room.configureAudio({ outputId: 'headset' });
  assert.deepEqual([a.id, b.id], ['headset', 'headset']);
  await assert.rejects(room.configureAudio({ outputId: 'bad' }), /salida/);
  assert.deepEqual([room.settings.outputId, a.id, b.id], ['headset', 'headset', 'headset']);
});

for (const action of ['mute', 'leave']) {
  test(action + ' releases both microphones while a device change is pending', async t => {
    const original = fakeTrack();
    const replacement = fakeTrack();
    installMedia(t, async ({audio}) => fakeStream(audio.deviceId ? replacement : original));
    const room = createRoom();
    await room.setMicrophone(true);

    const started = Promise.withResolvers();
    const resume = Promise.withResolvers();
    room.peers.set('A', {
      incoming: Promise.resolve(),
      pc: {close() {}},
      audio: {pause() {}},
      transceiver: {sender: {async replaceTrack(track) {
        if (track === replacement) {
          started.resolve();
          await resume.promise;
        }
      }}}
    });
    const change = room.configureAudio({inputId:'second'});
    await started.promise;
    const stopped = action === 'leave' ? room.close() : room.setMicrophone(false);
    try {
      assert.equal(original.readyState, 'ended');
      assert.equal(replacement.readyState, 'ended');
    } finally {
      resume.resolve();
      await Promise.all([stopped, change]);
      room.close();
    }
  });
}

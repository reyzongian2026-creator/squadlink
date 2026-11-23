import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceRoom } from '../public/voice.js';

function input() {
  const track = {
    kind: 'audio',
    readyState: 'live',
    stop() { this.readyState = 'ended'; },
    disconnect() { this.stop(); this.onended?.(); }
  };
  return { track, get active() { return track.readyState === 'live'; },
    getTracks: () => [track], getAudioTracks: () => [track] };
}

function call(t, inputs, replaceTrack = async () => {}) {
  const notifications = [];
  const room = new VoiceRoom({ selfId: 'B', onMicrophoneEnded: () => notifications.push('ended') });
  const peer = { incoming: Promise.resolve(), transceiver: { sender: { replaceTrack } },
    pc: { close() {} }, audio: { pause() {} } };
  room.peers.set('A', peer);
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true,
    value: { getUserMedia: async () => inputs.shift() } });
  t.after(() => { room.close(); delete navigator.mediaDevices; });
  return { room, peer, notifications };
}

test('disconnecting the active mic mutes senders, keeps listening and allows reactivation', async t => {
  const usb = input(), headset = input();
  const sent = [];
  const { room, peer, notifications } = call(t, [usb, headset], async track => sent.push(track));
  await room.setMicrophone(true);
  usb.track.disconnect();
  await peer.incoming;
  assert.deepEqual(notifications, ['ended']);
  assert.deepEqual(sent, [usb.track, null]);
  assert.equal(room.stream, null);
  assert.equal(room.wantsMicrophone, false);
  assert.equal(room.peers.has('A'), true);
  await room.configureAudio({ inputId: 'headset' });
  assert.equal(await room.setMicrophone(true), true);
  assert.equal(sent.at(-1), headset.track);
  await room.setMicrophone(false);
  assert.deepEqual(notifications, ['ended']);
});

test('late notifications from a replaced mic or closed room leave the new state alone', async t => {
  const first = input(), second = input();
  const { room, notifications } = call(t, [first, second]);
  await room.setMicrophone(true);
  const oldEnded = first.track.onended;
  await room.configureAudio({ inputId: 'second' });
  oldEnded();
  assert.equal(room.stream, second);
  assert.equal(first.track.onended, null);
  const endedAfterExit = second.track.onended;
  room.close();
  endedAfterExit();
  assert.deepEqual(notifications, []);
});

test('loss during a pending sender switch releases both captures and leaves the sender muted', async t => {
  const first = input(), second = input();
  const started = Promise.withResolvers(), resume = Promise.withResolvers();
  const sent = [];
  const { room, peer, notifications } = call(t, [first, second], async track => {
    if (track === second.track) { started.resolve(); await resume.promise; }
    sent.push(track);
  });
  await room.setMicrophone(true);
  const switching = room.configureAudio({ inputId: 'second' });
  await started.promise;
  second.track.disconnect();
  resume.resolve();
  await switching;
  await peer.incoming;
  assert.equal(first.track.readyState, 'ended');
  assert.equal(room.captures.size, 0);
  assert.equal(sent.at(-1), null);
  assert.deepEqual(notifications, ['ended']);
});

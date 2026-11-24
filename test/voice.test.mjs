// Browser-independent checks for signaling order, media teardown and permission races.
import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceRoom } from '../public/voice.js';
import { microphoneConstraints, readAudioSettings, saveAudioSettings } from '../public/audio-settings.js';

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
  assert.deepEqual(nextRoom.settings, { inputId: 'usb-microphone', outputId: '', noiseSuppression: false, autoGainControl: false, listenVolume: 0.7, micGainDb: 0 });
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

test('an input unplugged during startup preserves the working microphone and saved device', async t => {
  const original = fakeTrack();
  const unplugged = fakeTrack();
  unplugged.stop();
  installMedia(t, async ({audio}) => fakeStream(audio.deviceId ? unplugged : original));
  const room = createRoom();
  t.after(() => room.close());
  const sent = [];
  room.peers.set('A', {incoming: Promise.resolve(), pc: {close() {}}, audio: {pause() {}},
    transceiver: {sender: {replaceTrack: async track => sent.push(track)}}});
  await room.setMicrophone(true);
  await assert.rejects(room.configureAudio({inputId:'usb'}), /micrófono/i);
  assert.deepEqual(sent,[original]);
  assert.equal(room.outgoingTrack(),original);
  assert.equal(original.readyState,'live');
  assert.equal(room.wantsMicrophone,true);
  assert.equal(room.settings.inputId,'');
  assert.equal(room.captures.size,1);
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

test('gain and noise adjustments reuse the live microphone, and an error preserves the settings', async t => {
  const track = fakeTrack();
  const observed = [];
  let opens = 0;
  track.applyConstraints = async constraints => {
    observed.push(constraints);
    if (constraints.noiseSuppression === false) throw new Error('unsupported combination');
  };
  installMedia(t, async () => { opens++; return fakeStream(track); });
  const room = createRoom();
  t.after(() => room.close());
  await room.setMicrophone(true);
  await room.configureAudio({autoGainControl: true});
  assert.equal(opens, 1);
  assert.equal(observed[0].autoGainControl, true);
  assert.equal(observed[0].echoCancellation, true);
  await assert.rejects(room.configureAudio({noiseSuppression: false}), /unsupported/);
  assert.equal(room.settings.noiseSuppression, true);
  assert.equal(room.stream.getAudioTracks()[0], track);
  assert.equal(track.readyState, 'live');
});

test('master listening volume preserves individual levels and applies to new peers', async t => {
  globalThis.RTCPeerConnection = class { close() {} };
  globalThis.document = { createElement: () => ({ pause() {} }) };
  t.after(() => { delete globalThis.RTCPeerConnection; delete globalThis.document; });
  const room = new VoiceRoom({selfId: 'Z'});
  t.after(() => room.close());
  room.setVolume('A', 0.5);
  await room.configureAudio({listenVolume: 0.8});
  room.syncMembers(['A','B']);
  assert.equal(room.peers.get('A').audio.volume, 0.4);
  assert.equal(room.peers.get('B').audio.volume, 0.8);
  await room.configureAudio({listenVolume: 0});
  assert.equal(room.peers.get('A').audio.volume, 0);
  await room.configureAudio({listenVolume: 1});
  assert.equal(room.peers.get('A').audio.volume, 0.5);
  assert.equal(room.stream, null);
});

test('las preferencias nuevas y parciales usan los valores recomendados y las guardadas conservan su valor', t => {
  const storage = new Map();
  globalThis.window = { localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) } };
  t.after(() => delete globalThis.window);
  const defaults = {inputId:'',outputId:'',noiseSuppression:true,autoGainControl:false,listenVolume:0.7,micGainDb:0};
  assert.deepEqual(readAudioSettings(),defaults);
  assert.deepEqual(microphoneConstraints(defaults),{
    channelCount:{ideal:1},sampleRate:{ideal:48000},echoCancellation:true,noiseSuppression:true,autoGainControl:false
  });
  for (const listenVolume of [0,1,1.5,2]) {
    const legacy = {inputId:'mic',outputId:'usb',noiseSuppression:false,autoGainControl:true,listenVolume};
    saveAudioSettings(legacy);
    assert.deepEqual(readAudioSettings(),{...legacy,micGainDb:0});
    assert.deepEqual(microphoneConstraints(readAudioSettings()).deviceId,{exact:'mic'});
  }
  for (const [stored, expected] of [[0,0],[8,8],[14.7,15],[-1,0],[20,18],['6',0]]) {
    saveAudioSettings({ micGainDb:stored, listenVolume:0.35, autoGainControl:true });
    const saved = readAudioSettings();
    assert.equal(saved.micGainDb,expected);
    assert.equal(saved.listenVolume,0.35);
    assert.equal(saved.autoGainControl,true);
  }
  saveAudioSettings({ listenVolume:2.5 });
  assert.equal(readAudioSettings().listenVolume,2);
  saveAudioSettings({inputId:'mic',listenVolume:0.35});
  assert.deepEqual(readAudioSettings(),{...defaults,inputId:'mic',listenVolume:0.35});
});

test('al cambiar de entrada durante el permiso inicial, activar refleja el micrófono vigente', async t => {
  const first = Promise.withResolvers();
  const late = fakeTrack(), selected = fakeTrack();
  const requests = [];
  installMedia(t, async ({audio}) => {
    requests.push(audio.deviceId?.exact || 'default');
    return audio.deviceId ? fakeStream(selected) : first.promise;
  });
  const room = createRoom();
  t.after(() => room.close());
  const activating = room.setMicrophone(true);
  await room.configureAudio({inputId:'auriculares'});
  assert.equal(await activating, true, 'la UI debe anunciar activo cuando la sala transmite');
  assert.equal(room.outgoingTrack(), selected);
  first.resolve(fakeStream(late));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(late.readyState, 'ended');
  assert.deepEqual(requests, ['default','auriculares']);
});

test('un permiso rechazado después de silenciar o cambiar de sala no altera la nueva activación', async t => {
  const pending = Promise.withResolvers();
  const selected = fakeTrack();
  let calls = 0;
  installMedia(t, () => ++calls === 1 ? pending.promise : Promise.resolve(fakeStream(selected)));
  const previous = createRoom();
  const activating = previous.setMicrophone(true);
  const duplicate = previous.setMicrophone(true);
  assert.equal(calls,1,'una activación repetida comparte la misma petición');
  await previous.setMicrophone(false);
  assert.deepEqual(await Promise.all([activating,duplicate]),[false,false]);
  previous.close();
  const current = createRoom();
  t.after(() => current.close());
  assert.equal(await current.setMicrophone(true), true);
  pending.reject(Object.assign(new Error('permiso anterior'), {name:'NotAllowedError'}));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(current.outgoingTrack(), selected);
  assert.equal(selected.readyState, 'live');
  assert.equal(previous.stream, null);
});

test('una selección de entrada tardía no sobrescribe la entrada más reciente ni el volumen', async t => {
  const storage = new Map();
  globalThis.window = {localStorage:{getItem:key => storage.get(key),setItem:(key,value) => storage.set(key,value)}};
  t.after(() => delete globalThis.window);
  const slow = Promise.withResolvers();
  const chosen = Promise.withResolvers();
  const old = fakeTrack(), late = fakeTrack(), current = fakeTrack();
  installMedia(t, ({audio}) => {
    if (audio.deviceId?.exact === 'lenta') return slow.promise;
    if (audio.deviceId?.exact === 'elegida') return chosen.promise;
    return Promise.resolve(fakeStream(old));
  });
  const room = createRoom();
  t.after(() => room.close());
  await room.setMicrophone(true);
  const olderChange = room.configureAudio({inputId:'lenta'});
  const newerChange = room.configureAudio({inputId:'elegida'});
  await room.configureAudio({listenVolume:0.4});
  chosen.resolve(fakeStream(current));
  await newerChange;
  slow.resolve(fakeStream(late));
  await olderChange;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(room.outgoingTrack(),current);
  assert.equal(late.readyState,'ended');
  assert.equal(room.settings.inputId,'elegida');
  assert.equal(room.settings.listenVolume,0.4);
  assert.equal(readAudioSettings().inputId,'elegida');
});

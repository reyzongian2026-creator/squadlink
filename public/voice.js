import { prepareVoiceCapture } from './voice-capture.js';
import { microphoneConstraints, readAudioSettings, saveAudioSettings } from './audio-settings.js';

const restartStepMs = 4000;
const maxRestartDelayMs = 30000;

// One audio transceiver per pair. Listening does not require microphone access.
export class VoiceRoom {
  constructor({ selfId, iceServers = [], sendSignal, onStatus = () => {}, onPeerState = () => {}, onMicrophoneEnded = () => {} }) {
    Object.assign(this, { selfId, iceServers, sendSignal, onStatus, onPeerState, onMicrophoneEnded });
    this.peers = new Map();
    this.memberGain = new Map();
    this.members = new Set();
    this.stream = null;
    this.captures = new Set();
    this.filters = new Map();
    this.captureRequest = 0;
    this.settings = readAudioSettings();
    this.wantsMicrophone = false;
    this.closed = false;
  }

  syncMembers(ids) {
    if (this.closed) return;
    this.members = new Set(ids.filter(id => id !== this.selfId));
    for (const id of this.peers.keys()) {
      if (!this.members.has(id)) this.removePeer(id);
    }
    for (const id of this.members) this.peer(id);
  }

  peer(id) {
    if (this.peers.has(id)) return this.peers.get(id);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const audio = document.createElement('audio');
    audio.autoplay = false;
    audio.volume = this.settings.listenVolume * (this.memberGain.get(id) ?? 1);
    const outputId = this.pendingOutputId ?? this.settings.outputId;
    const sinkReady = outputId && audio.setSinkId
      ? audio.setSinkId(outputId).catch(() => {
        if (!this.closed) this.onStatus('La salida guardada no está disponible. Se usará la salida del sistema.');
      })
      : Promise.resolve();
    const peer = { id, pc, audio, transceiver: null, incoming: Promise.resolve(), candidates: [],
      offerer: this.selfId < id, restartTimer: null, restartDelay: restartStepMs, dropped: false };
    this.peers.set(id, peer);
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && !peer.dropped) this.relay(peer, { candidate: candidate.toJSON() });
    };
    pc.ontrack = ({ track }) => {
      if (peer.dropped || track.kind !== 'audio' || audio.srcObject?.getAudioTracks()[0] === track) return;
      const stream = new MediaStream([track]);
      audio.srcObject = stream;
      const current = () => !peer.dropped && audio.srcObject === stream;
      sinkReady.then(() => current() && audio.play()).catch(error => {
        if (current() && error.name !== 'AbortError') this.onStatus('Pulsa el control de audio para escuchar a tu equipo.');
      });
    };
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      this.onPeerState(id, state);
      if (state === 'connected') {
        clearTimeout(peer.restartTimer);
        peer.restartTimer = null;
        peer.restartDelay = restartStepMs;
      } else if (state === 'disconnected' || state === 'failed') {
        if (peer.offerer) this.scheduleRestart(peer);
        if (state === 'failed') this.onStatus('La conexión de voz se interrumpió. Comprueba tu red.');
      }
    };
    if (peer.offerer) {
      const track = this.outgoingTrack();
      peer.transceiver = pc.addTransceiver(track ?? 'audio', { direction: 'sendrecv' });
      this.queue(peer, () => this.offer(peer));
    }
    return peer;
  }

  scheduleRestart(peer) {
    if (peer.restartTimer !== null || peer.dropped || peer.pc.connectionState === 'connected') return;
    peer.restartTimer = setTimeout(() => {
      peer.restartTimer = null;
      // A long outage must not strand a participant who is still in the room.
      peer.restartDelay = Math.min(peer.restartDelay + restartStepMs, maxRestartDelayMs);
      this.queue(peer, async () => {
        if (peer.pc.connectionState === 'connected') return;
        // An unanswered offer may have been lost with the event stream.
        if (peer.pc.signalingState === 'have-local-offer') {
          await peer.pc.setLocalDescription({ type: 'rollback' });
        }
        await this.offer(peer, true);
        this.scheduleRestart(peer);
      });
    }, peer.restartDelay);
  }

  queue(peer, operation) {
    peer.incoming = peer.incoming.then(() => {
      if (!peer.dropped) return operation();
    }).catch(() => {
      if (!peer.dropped) {
        this.onStatus('No se pudo negociar el audio con un participante.');
        if (peer.offerer) this.scheduleRestart(peer);
      }
    });
    return peer.incoming;
  }

  async relay(peer, data) {
    try {
      if (!peer.dropped) await this.sendSignal(peer.id, data);
    } catch {
      if (!peer.dropped) {
        this.onStatus('No se pudo enviar una señal de voz. Comprueba la conexión.');
        if (peer.offerer) this.scheduleRestart(peer);
      }
    }
  }

  async offer(peer, iceRestart = false) {
    const { pc } = peer;
    if (pc.signalingState !== 'stable') return;
    await pc.setLocalDescription(await pc.createOffer({ iceRestart }));
    await this.relay(peer, { description: pc.localDescription.toJSON() });
    // Covers a lost answer or a remote client refreshing during negotiation.
    this.scheduleRestart(peer);
  }

  receive(from, { description, candidate }) {
    if (this.closed || from === this.selfId || !this.members.has(from)) return;
    const peer = this.peer(from);
    const { pc } = peer;
    return this.queue(peer, async () => {
      if (description) {
        if ((description.type === 'offer') === peer.offerer) return;
        if (description.type === 'answer' && pc.signalingState !== 'have-local-offer') return;
        await pc.setRemoteDescription(description);
        if (description.type === 'offer') {
          // Reuse the incoming transceiver. Creating a second one would add a second audio m-line.
          peer.transceiver = pc.getTransceivers().find(t => t.receiver.track.kind === 'audio');
          peer.transceiver.direction = 'sendrecv';
          await peer.transceiver.sender.replaceTrack(this.outgoingTrack());
          await pc.setLocalDescription(await pc.createAnswer());
          await this.relay(peer, { description: pc.localDescription.toJSON() });
        }
        for (const pending of peer.candidates.splice(0)) {
          if (this.matchesRemoteIce(pc, pending)) await pc.addIceCandidate(pending);
        }
      } else if (candidate) {
        if (this.matchesRemoteIce(pc, candidate)) await pc.addIceCandidate(candidate);
        else if (peer.candidates.length < 128) peer.candidates.push(candidate);
      }
    });
  }

  matchesRemoteIce(pc, candidate) {
    if (!pc.remoteDescription) return false;
    if (!candidate.usernameFragment) return true;
    return pc.remoteDescription.sdp.split(/\r?\n/).includes('a=ice-ufrag:' + candidate.usernameFragment);
  }

  async replaceSenders(track, request) {
    const failures = [];
    await Promise.all(Array.from(this.peers.values(), peer => this.queue(peer, async () => {
      if (request !== this.captureRequest || !peer.transceiver) return;
      try { await peer.transceiver.sender.replaceTrack(track); }
      catch (err) { if (!peer.dropped) failures.push(err); }
    })));
    if (failures.length) throw new Error('No se pudo cambiar el micrófono en la llamada.');
  }

  outgoingTrack(stream = this.stream) {
    return (this.filters.get(stream)?.stream ?? stream)?.getAudioTracks()[0] ?? null;
  }

  async openMicrophone(settings, request) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Para activar el micrófono, abre la app mediante HTTPS o localhost.');
    const audio = microphoneConstraints(settings);
    let next;
    try { next = await navigator.mediaDevices.getUserMedia({ audio, video: false }); }
    catch (err) {
      if (err.name === 'NotAllowedError') throw new Error('Permiso de micrófono denegado. Puedes escuchar y activarlo desde los permisos de la app.');
      if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') throw new Error('No se encontró ese micrófono. Elige otra entrada en los ajustes de audio.');
      throw new Error('No se pudo abrir el micrófono. Revisa el dispositivo de entrada.');
    }
    if (this.closed || request !== this.captureRequest) {
      next.getTracks().forEach(t => t.stop());
      return false;
    }
    this.captures.add(next);
    const old = this.stream;
    const filter = prepareVoiceCapture(next, settings);
    this.filters.set(next, filter);
    const filtered = await filter.ready;
    if (this.closed || request !== this.captureRequest) {
      this.releaseCapture(next);
      return false;
    }
    this.stream = next;
    if (!filtered && globalThis.AudioWorkletNode) this.onStatus('Se usan los filtros de voz del dispositivo.');
    const track = next.getAudioTracks()[0];
    track.onended = () => this.handleMicrophoneEnded(next);
    if (track.readyState === 'ended') {
      this.handleMicrophoneEnded(next);
      return false;
    }
    try { await this.replaceSenders(this.outgoingTrack(next), request); }
    catch (err) {
      if (request === this.captureRequest && !this.closed) {
        this.stream = old;
        if (old?.getAudioTracks()[0]?.readyState === 'ended') {
          this.handleMicrophoneEnded(old);
          throw err;
        }
        try { await this.replaceSenders(this.outgoingTrack(old), request); } finally { this.releaseCapture(next); }
      } else this.releaseCapture(old);
      throw err;
    }
    this.releaseCapture(old);
    return this.stream === next && !this.closed;
  }

  handleMicrophoneEnded(stream) {
    if (this.closed || this.stream !== stream) return;
    this.setMicrophone(false).catch(err => {
      if (!this.closed && !this.wantsMicrophone) this.onStatus(err.message);
    });
    this.onMicrophoneEnded();
  }

  releaseCapture(stream) {
    if (this.captures.delete(stream)) {
      this.filters.get(stream)?.close();
      this.filters.delete(stream);
      for (const track of stream.getTracks()) {
        track.onended = null;
        track.stop();
      }
    }
  }

  stopCaptures() {
    // During a device switch, peers can temporarily be using different inputs.
    for (const stream of this.captures) this.releaseCapture(stream);
    this.stream = null;
  }

  async setMicrophone(enabled) {
    if (this.closed) return false;
    this.wantsMicrophone = enabled;
    if (enabled && this.stream?.active) return true;
    const request = ++this.captureRequest;
    if (enabled) {
      try { return await this.openMicrophone(this.settings, request); }
      catch (err) {
        if (request === this.captureRequest) this.wantsMicrophone = !!this.stream;
        throw err;
      }
    }
    this.stopCaptures();
    await this.replaceSenders(null, request);
    return false;
  }

  async configureAudio(patch) {
    if (this.closed) return;
    const previous = this.settings;
    const next = { ...previous, ...patch };
    if (next.outputId !== previous.outputId) {
      this.pendingOutputId = next.outputId;
      try {
        const results = await Promise.allSettled([...this.peers.values()].map(async peer => {
          try { await peer.audio.setSinkId(next.outputId); }
          catch (err) { if (!peer.dropped) throw err; }
        }));
        if (results.some(result => result.status === 'rejected')) throw new Error('output');
      } catch {
        this.pendingOutputId = previous.outputId;
        await Promise.allSettled([...this.peers.values()].map(async peer => peer.audio.setSinkId(previous.outputId)));
        throw new Error('No se pudo usar esa salida. Comprueba que esté conectada y autorizada.');
      } finally { this.pendingOutputId = undefined; }
    }
    const deviceChanged = next.inputId !== previous.inputId;
    const filtersChanged = next.noiseSuppression !== previous.noiseSuppression ||
      next.autoGainControl !== previous.autoGainControl;
    if ((deviceChanged || filtersChanged) && this.wantsMicrophone) {
      const request = ++this.captureRequest;
      try {
        const liveTrack = this.stream?.getAudioTracks()[0];
        if (!deviceChanged && liveTrack?.readyState === 'live' && liveTrack.applyConstraints) {
          await liveTrack.applyConstraints(microphoneConstraints(next));
          this.filters.get(this.stream)?.setNoise(next.noiseSuppression);
        } else {
          await this.openMicrophone(next, request);
        }
      }
      catch (err) {
        if (request === this.captureRequest) this.wantsMicrophone = !!this.stream;
        throw err;
      }
    }
    if (!this.closed) {
      this.settings = next;
      if (next.listenVolume !== previous.listenVolume) {
        for (const [id, peer] of this.peers) peer.audio.volume = next.listenVolume * (this.memberGain.get(id) ?? 1);
      }
      saveAudioSettings(next);
    }
  }

  setVolume(id, gain) {
    if (this.closed || !Number.isFinite(gain)) return;
    const value = Math.max(0, Math.min(1, gain));
    this.memberGain.set(id, value);
    const peer = this.peers.get(id);
    if (peer) peer.audio.volume = value * this.settings.listenVolume;
  }

  async resumePlayback() {
    await Promise.all([...this.peers.values()].filter(p => p.audio.srcObject).map(p =>
      p.audio.play().catch(() => this.onStatus('No se pudo reproducir el audio. Revisa la salida de sonido.'))));
  }

  removePeer(id) {
    const peer = this.peers.get(id);
    if (!peer) return;
    peer.dropped = true;
    clearTimeout(peer.restartTimer);
    peer.pc.onconnectionstatechange = peer.pc.ontrack = peer.pc.onicecandidate = null;
    peer.pc.close();
    peer.audio.pause();
    peer.audio.srcObject = null;
    this.peers.delete(id);
  }

  close() {
    this.closed = true;
    this.captureRequest++;
    for (const id of this.peers.keys()) this.removePeer(id);
    this.stopCaptures();
    this.memberGain.clear();
  }
}

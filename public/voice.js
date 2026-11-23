import { readAudioSettings, saveAudioSettings } from './audio-settings.js';

const restartStepMs = 4000;
const maxRestartDelayMs = 30000;

// One audio transceiver per pair. Listening does not require microphone access.
export class VoiceRoom {
  constructor({ selfId, iceServers = [], sendSignal, onStatus = () => {}, onPeerState = () => {}, onMicrophoneEnded = () => {} }) {
    Object.assign(this, { selfId, iceServers, sendSignal, onStatus, onPeerState, onMicrophoneEnded });
    this.peers = new Map();
    this.members = new Set();
    this.stream = null;
    this.captures = new Set();
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
      audio.srcObject = new MediaStream([track]);
      sinkReady.then(() => peer.dropped || audio.play()).catch(() => {
        if (!peer.dropped) this.onStatus('Pulsa el control de audio para escuchar a tu equipo.');
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
      const track = this.stream?.getAudioTracks()[0];
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
          await peer.transceiver.sender.replaceTrack(this.stream?.getAudioTracks()[0] ?? null);
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

  async openMicrophone(settings, request) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Para activar el micrófono, abre la app mediante HTTPS o localhost.');
    const audio = { channelCount: { ideal: 1 }, echoCancellation: true,
      noiseSuppression: settings.noiseSuppression, autoGainControl: true };
    if (settings.inputId) audio.deviceId = { exact: settings.inputId };
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
    this.stream = next;
    const track = next.getAudioTracks()[0];
    track.onended = () => this.handleMicrophoneEnded(next);
    if (track.readyState === 'ended') {
      this.handleMicrophoneEnded(next);
      return false;
    }
    try { await this.replaceSenders(track, request); }
    catch (err) {
      if (request === this.captureRequest && !this.closed) {
        this.stream = old;
        if (old?.getAudioTracks()[0]?.readyState === 'ended') {
          this.handleMicrophoneEnded(old);
          throw err;
        }
        try { await this.replaceSenders(old?.getAudioTracks()[0] ?? null, request); } finally { this.releaseCapture(next); }
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
    if ((next.inputId !== previous.inputId || next.noiseSuppression !== previous.noiseSuppression) && this.wantsMicrophone) {
      const request = ++this.captureRequest;
      try { await this.openMicrophone(next, request); }
      catch (err) {
        if (request === this.captureRequest) this.wantsMicrophone = !!this.stream;
        throw err;
      }
    }
    if (!this.closed) {
      this.settings = next;
      saveAudioSettings(next);
    }
  }

  setVolume(id, gain) {
    const peer = this.peers.get(id);
    if (peer && Number.isFinite(gain)) peer.audio.volume = Math.max(0, Math.min(1, gain));
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
  }
}

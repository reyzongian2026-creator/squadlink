// One audio transceiver per pair. Listening does not require microphone access.
export class VoiceRoom {
  constructor({ selfId, iceServers = [], sendSignal, onStatus = () => {}, onPeerState = () => {} }) {
    Object.assign(this, { selfId, iceServers, sendSignal, onStatus, onPeerState });
    this.peers = new Map();
    this.members = new Set();
    this.stream = null;
    this.captureRequest = 0;
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
    audio.autoplay = true;
    const peer = { id, pc, audio, transceiver: null, incoming: Promise.resolve(), candidates: [],
      offerer: this.selfId < id, restartTimer: null, attempts: 0, dropped: false };
    this.peers.set(id, peer);
    pc.onicecandidate = ({ candidate }) => {
      if (candidate && !peer.dropped) this.relay(peer, { candidate: candidate.toJSON() });
    };
    pc.ontrack = ({ track }) => {
      audio.srcObject = new MediaStream([track]);
      audio.play().catch(() => {
        if (!peer.dropped) this.onStatus('Pulsa el control de audio para escuchar a tu equipo.');
      });
    };
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      this.onPeerState(id, state);
      if (state === 'connected') {
        clearTimeout(peer.restartTimer);
        peer.restartTimer = null;
        peer.attempts = 0;
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
    if (peer.restartTimer || peer.attempts >= 3 || peer.dropped) return;
    peer.restartTimer = setTimeout(() => {
      peer.restartTimer = null;
      peer.attempts++;
      this.queue(peer, async () => {
        if (peer.pc.connectionState === 'connected') return;
        // An unanswered offer may have been lost with the event stream.
        if (peer.pc.signalingState === 'have-local-offer') {
          await peer.pc.setLocalDescription({ type: 'rollback' });
        }
        await this.offer(peer, true);
        this.scheduleRestart(peer);
      });
    }, 4000 * (peer.attempts + 1));
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

  async setMicrophone(enabled) {
    if (this.closed) return false;
    const request = ++this.captureRequest;
    if (!enabled) {
      for (const track of this.stream?.getTracks() ?? []) track.stop();
      this.stream = null;
    } else if (this.stream?.active) return true;
    else {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Para activar el micrófono, abre la app mediante HTTPS o localhost.');
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: { ideal: 1 }, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false
        });
      } catch (err) {
        if (err.name === 'NotAllowedError') throw new Error('Permiso de micrófono denegado. Puedes escuchar y activarlo desde los permisos de la app.');
        if (err.name === 'NotFoundError') throw new Error('No se encontró un micrófono. Conecta uno y vuelve a intentarlo.');
        throw new Error('No se pudo abrir el micrófono. Revisa el dispositivo de entrada.');
      }
      if (this.closed || request !== this.captureRequest) {
        stream.getTracks().forEach(track => track.stop());
        return false;
      }
      this.stream = stream;
    }
    const track = this.stream?.getAudioTracks()[0] ?? null;
    await Promise.all(Array.from(this.peers.values(), peer => this.queue(peer, async () => {
      if (request === this.captureRequest && peer.transceiver) await peer.transceiver.sender.replaceTrack(track);
    })));
    return !!this.stream;
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
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
  }
}

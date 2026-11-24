// WaveShaper inputs are bounded to [-1, 1]. The preceding gain uses half the
// requested multiplier, preserving headroom for the +6 dB transfer curve.
let boostCurve;
export function limitingCurve() {
  if (boostCurve) return boostCurve;
  boostCurve = Float32Array.from({length:4097}, (_, i) => {
    const sample = (i / 2048 - 1) * 2;
    const level = Math.abs(sample);
    if (level <= 0.85) return sample;
    return Math.sign(sample) * (0.85 + 0.11 * Math.tanh((level - 0.85) / 0.11));
  });
  return boostCurve;
}

export class VoicePlayback {
  constructor(onStatus) {
    this.onStatus = onStatus;
    this.context = null;
    this.boosted = new Map();
  }

  attach(peer, stream) {
    if (!stream || peer.audio.srcObject === stream || peer.dropped) return;
    peer.audio.srcObject = stream;
    const current = () => !peer.dropped && peer.audio.srcObject === stream;
    peer.sinkReady.then(() => current() && peer.audio.play()).catch(error => {
      if (current() && error.name !== 'AbortError') this.onStatus('Pulsa el control de audio para escuchar a tu equipo.');
    });
  }

  receive(peer, track) {
    if (peer.dropped || track.kind !== 'audio' || peer.remoteStream?.getAudioTracks()[0] === track) return;
    this.releaseBoost(peer);
    peer.remoteStream = new MediaStream([track]);
    this.setLevel(peer, peer.playbackLevel);
  }

  setLevel(peer, level) {
    peer.playbackLevel = level;
    peer.audio.volume = Math.min(1, level);
    if (!peer.remoteStream) return;
    if (level <= 1) {
      this.attach(peer, peer.remoteStream);
      this.releaseBoost(peer);
      return;
    }
    const graph = this.boosted.get(peer);
    if (graph) {
      graph.gain.gain.setTargetAtTime(level / 2, this.context.currentTime, 0.01);
      return;
    }
    try {
      this.context ??= new AudioContext({latencyHint:'interactive'});
      const ctx = this.context;
      const source = ctx.createMediaStreamSource(peer.remoteStream);
      const gain = ctx.createGain();
      const limiter = ctx.createWaveShaper();
      const destination = ctx.createMediaStreamDestination();
      // Chromium needs an HTML media consumer on the original RTC stream to
      // keep decoding it after the audible element switches to the filtered stream.
      const decoder = document.createElement('audio');
      decoder.muted = true;
      const next = {source, gain, limiter, destination, decoder};
      this.boosted.set(peer, next);
      destination.channelCount = 1;
      limiter.curve = limitingCurve();
      gain.gain.value = level / 2;
      source.connect(gain).connect(limiter).connect(destination);
      // Keep direct audio until the muted decoder is playing and the context
      // is ready. The existing sink-selected element is the only audible route.
      this.attach(peer, peer.remoteStream);
      decoder.srcObject = peer.remoteStream;
      const ready = ctx.state === 'running' ? Promise.resolve() : ctx.resume();
      Promise.all([decoder.play(),ready]).then(() => {
        if (this.boosted.get(peer) === next) this.attach(peer, destination.stream);
      }).catch(() => {
        if (this.boosted.get(peer) === next) this.fallback(peer);
      });
    } catch {
      this.fallback(peer);
    }
  }

  fallback(peer) {
    this.releaseBoost(peer);
    this.attach(peer, peer.remoteStream);
    this.onStatus('La amplificación no está disponible. La voz se reproduce al 100 %.');
  }

  async resume() {
    if (this.context?.state === 'suspended') await this.context.resume().catch(() => {});
  }

  releaseBoost(peer) {
    const graph = this.boosted.get(peer);
    if (graph) {
      this.boosted.delete(peer);
      graph.decoder.pause();
      graph.decoder.srcObject = null;
      graph.source.disconnect();
      graph.gain.disconnect();
      graph.limiter.disconnect();
      for (const track of graph.destination.stream.getTracks()) track.stop();
    }
    if (!this.boosted.size && this.context) {
      this.context.close().catch(() => {});
      this.context = null;
    }
  }
}

// The destination is a MediaStream for WebRTC or the local mic test. Never monitor
// the microphone through the speakers.
export function prepareVoiceCapture(input, settings) {
  let context, source, filter, destination, closed = false, timer, cancelSetup;
  let noise = settings.noiseSuppression;
  let micGainDb = settings.micGainDb ?? 0;
  const capture = {
    stream: input,
    get audioContext() { return closed ? null : context; },
    setNoise(enabled) {
      noise = enabled;
      if (filter) filter.parameters.get('reduceNoise').value = enabled ? 1 : 0;
    },
    setMicGainDb(db) {
      micGainDb = db;
      if (filter) filter.parameters.get('micGainDb').value = db;
    },
    close() {
      if (closed) return;
      closed = true;
      cancelSetup?.();
      clearTimeout(timer);
      source?.disconnect();
      filter?.disconnect();
      destination?.stream.getTracks().forEach(track => track.stop());
      if (context && context.state !== 'closed') void context.close().catch(() => {});
    },
  };
  capture.ready = (async () => {
    if (!globalThis.AudioContext || !globalThis.AudioWorkletNode) return false;
    try {
      context = new AudioContext({latencyHint: 'interactive'});
      if (!context.audioWorklet) throw Error('AudioWorklet unavailable');
      const setup = Promise.all([
        context.audioWorklet.addModule(new URL('./voice-cleaner-worklet.js', import.meta.url)),
        context.resume()
      ]);
      const timeout = new Promise((resolve, reject) => {
        cancelSetup = resolve;
        timer = setTimeout(() => reject(Error('Audio startup timed out')), 1800);
      });
      await Promise.race([setup, timeout]);
      if (closed) return false;
      source = context.createMediaStreamSource(input);
      filter = new AudioWorkletNode(context, 'squadlink-voice-cleaner', {
        channelCount: 1, channelCountMode: 'explicit', outputChannelCount: [1],
        parameterData: {reduceNoise: noise ? 1 : 0, micGainDb}
      });
      destination = context.createMediaStreamDestination();
      destination.channelCount = 1;
      source.connect(filter).connect(destination);
      capture.stream = destination.stream;
      return true;
    } catch {
      capture.close();
      return false;
    } finally { clearTimeout(timer); cancelSetup = null; }
  })();
  return capture;
}

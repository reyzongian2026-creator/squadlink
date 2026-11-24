// The time-domain samples stay on the device. Keep only per-window summary values.
export function microphoneReadings() {
  const levels = [];
  let nearLimit = 0, loudest = 0;
  const db = amplitude => Math.max(-96, 20 * Math.log10(amplitude));
  return {
    add(samples, input = samples) {
      if (!samples.length) return -96;
      let energy = 0, peak = 0, nearFullScale = 0;
      for (const value of samples) {
        energy += value * value;
        peak = Math.max(peak, Math.abs(value));
      }
      for (const value of input) if (Math.abs(value) >= 0.99) nearFullScale++;
      if (nearFullScale >= Math.max(3, Math.ceil(input.length / 1000))) nearLimit++;
      loudest = Math.max(loudest,peak);
      const level = db(Math.sqrt(energy / samples.length));
      levels.push(level);
      return level;
    },
    summary() {
      if (!levels.length) return '';
      // A single click should not count as speech. Pauses between words should not
      // bring an otherwise clear voice below the threshold for a quiet recording.
      const sorted = [...levels].sort((a,b) => b-a);
      const level = sorted[Math.min(2, sorted.length - 1)];
      const measured = 'Nivel de la muestra ' + Math.round(level) + ' dBFS.';
      if (nearLimit >= 2) return 'La entrada alcanza su límite. Baja el nivel del micrófono en el dispositivo. ' + measured;
      if (level <= -60 && db(loudest) < -50) return 'Se detectó silencio. Revisa la entrada y el botón de silencio del micrófono.';
      if (level < -35) return 'La muestra se oye débil. Acércate al micrófono o sube un poco su ganancia. ' + measured;
      if (level > -10) return 'El nivel es alto. Baja la ganancia del micrófono. ' + measured;
      return measured;
    },
  };
}

export function monitorMicrophone(raw, capture, meter) {
  const readings = microphoneReadings();
  let context = capture.audioContext, own = false, timer;
  const nodes = [];
  function stop() {
    clearInterval(timer);
    for (const node of nodes.splice(0)) node.disconnect();
    if (own && context?.state !== 'closed') context?.close().catch(() => {});
    meter.hidden = true;
  }
  try {
    if (!context) { context = new AudioContext({latencyHint:'interactive'}); own = true; }
    function analyser(stream) {
      const node = context.createAnalyser();
      nodes.push(node);
      node.fftSize = Math.max(2048, Math.min(16384, 2 ** Math.ceil(Math.log2(context.sampleRate / 10))));
      const source = context.createMediaStreamSource(stream);
      nodes.push(source);
      source.connect(node); // No connection to the speakers during recording.
      return node;
    }
    const recorded = analyser(capture.stream);
    const input = capture.stream === raw ? recorded : analyser(raw);
    const samples = new Float32Array(recorded.fftSize);
    const rawSamples = input === recorded ? samples : new Float32Array(input.fftSize);
    if (own && context.state === 'suspended') context.resume().catch(() => {});
    timer = setInterval(() => {
      if (context.state !== 'running') return;
      recorded.getFloatTimeDomainData(samples);
      if (input !== recorded) input.getFloatTimeDomainData(rawSamples);
      meter.value = Math.max(-60, Math.min(0,readings.add(samples,rawSamples)));
      meter.hidden = false;
    }, 100);
  } catch { stop(); } // MediaRecorder can still record without a Web Audio meter.
  return {stop, summary:readings.summary};
}

// Process one mono microphone. The relay and the listening path never run this filter.
class VoiceCleaner extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      {name: 'reduceNoise', defaultValue: 1, minValue: 0, maxValue: 1, automationRate: 'k-rate'},
      {name: 'micGainDb', defaultValue: 0, minValue: 0, maxValue: 18, automationRate: 'k-rate'},
    ];
  }

  constructor() {
    super();
    this.previousInput = 0;
    this.previousOutput = 0;
    this.highPass = Math.exp(-2 * Math.PI * 65 / sampleRate);
    this.openGain = 0.063;
    this.peakGain = 1;
    this.micGain = 1;
    this.hold = 0;
    this.blockSize = 0;
    this.requestedDb = 0;
    this.requestedGain = 1;
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;
    if (!input?.length) { output.fill(0); return true; }

    let energy = 0, peak = 0, crossings = 0;
    const highPass = this.highPass;
    let previousInput = this.previousInput, previousOutput = this.previousOutput;
    for (let i = 0; i < input.length; i++) {
      const sample = input[i];
      const value = highPass * (previousOutput + sample - previousInput);
      if ((value > 0) !== (previousOutput > 0)) crossings++;
      previousInput = sample;
      previousOutput = value;
      output[i] = value;
      energy += value * value;
      peak = Math.max(peak, Math.abs(value));
    }

    this.previousInput = previousInput;
    this.previousOutput = previousOutput;

    const seconds = input.length / sampleRate;
    if (this.blockSize !== input.length) {
      this.blockSize = input.length;
      this.openDecay = Math.exp(-seconds / 0.002);
      this.closeDecay = Math.exp(-seconds / 0.045);
      this.gainDecay = Math.exp(-seconds / 0.015);
      this.peakDecay = Math.exp(-seconds / 0.12);
    }
    const rms = Math.sqrt(energy / input.length);
    // Sustained broadband hiss crosses zero frequently. A short hold keeps consonants
    // attached to voiced syllables even when they resemble noise.
    const hiss = crossings / seconds > 8500;
    const threshold = 0.0035;
    const speech = !hiss && rms >= threshold;
    this.hold = speech ? 0.16 : Math.max(0, this.hold - seconds);
    const target = !parameters.reduceNoise[0] || this.hold > 0 ? 1 :
      hiss ? 0.063 : Math.max(0.063, Math.min(1, (rms / threshold) ** 3));
    const from = this.openGain;
    this.openGain = target + (from - target) * (target > from ? this.openDecay : this.closeDecay);

    // Only turn peaks down. Apply attenuation before the first sample in this block
    // to leave headroom for the codec without clipping the waveform.
    // Change gain smoothly after detecting speech so raising a quiet voice cannot
    // open the noise gate. Keep the residual noise at its original gain in pauses.
    const previousGain = this.micGain;
    const db = parameters.micGainDb?.[0] ?? 0;
    if (db !== this.requestedDb) {
      this.requestedDb = db;
      this.requestedGain = 10 ** (db / 20);
    }
    const blend = Math.max(0, (this.openGain - 0.063) / (1 - 0.063));
    const desiredGain = 1 + (this.requestedGain - 1) * blend;
    this.micGain = desiredGain + (previousGain - desiredGain) * this.gainDecay;
    const boostedPeak = peak * Math.max(previousGain, this.micGain);
    const ceiling = boostedPeak > 0.75 ? 0.75 / boostedPeak : 1;
    this.peakGain = Math.min(ceiling, 1 + (this.peakGain - 1) * this.peakDecay);
    // Sustained speech and background noise often have constant gain across
    // the block. The high-pass samples are already in the output buffer.
    if (this.openGain === from && this.micGain === previousGain) {
      const gain = from * previousGain * this.peakGain;
      if (gain !== 1) {
        for (let i = 0; i < input.length; i++) output[i] *= gain;
      }
      return true;
    }
    for (let i = 0; i < input.length; i++) {
      const gain = from + (this.openGain - from) * (i + 1) / input.length;
      const microphoneGain = previousGain + (this.micGain - previousGain) * (i + 1) / input.length;
      output[i] *= gain * microphoneGain * this.peakGain;
    }
    return true;
  }
}

registerProcessor('squadlink-voice-cleaner', VoiceCleaner);

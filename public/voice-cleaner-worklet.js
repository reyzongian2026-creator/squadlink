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
  }

  process(inputs, outputs, parameters) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;
    if (!input?.length) { output.fill(0); return true; }

    let energy = 0, peak = 0, crossings = 0;
    for (let i = 0; i < input.length; i++) {
      const value = this.highPass * (this.previousOutput + input[i] - this.previousInput);
      if ((value > 0) !== (this.previousOutput > 0)) crossings++;
      this.previousInput = input[i];
      this.previousOutput = value;
      output[i] = value;
      energy += value * value;
      peak = Math.max(peak, Math.abs(value));
    }

    const seconds = input.length / sampleRate;
    const rms = Math.sqrt(energy / input.length);
    // Sustained broadband hiss crosses zero frequently. A short hold keeps consonants
    // attached to voiced syllables. Strong signals always pass the noise detector.
    const hiss = crossings / seconds > 8500;
    const threshold = hiss ? 0.037 : 0.0035;
    const speech = rms >= threshold;
    this.hold = speech ? 0.16 : Math.max(0, this.hold - seconds);
    const target = !parameters.reduceNoise[0] || this.hold > 0 ? 1 :
      Math.max(0.063, Math.min(1, (rms / threshold) ** 3));
    const from = this.openGain;
    this.openGain = target + (from - target) * Math.exp(-seconds / (target > from ? 0.002 : 0.045));

    // Only turn peaks down. Apply attenuation before the first sample in this block
    // to leave headroom for the codec without clipping the waveform.
    // Change gain smoothly after detecting speech so raising a quiet voice cannot
    // open the noise gate. Keep the residual noise at its original gain in pauses.
    const previousGain = this.micGain;
    const requestedGain = 10 ** ((parameters.micGainDb?.[0] ?? 0) / 20);
    const blend = Math.max(0, (this.openGain - 0.063) / (1 - 0.063));
    const desiredGain = 1 + (requestedGain - 1) * blend;
    this.micGain = desiredGain + (previousGain - desiredGain) * Math.exp(-seconds / 0.015);
    const boostedPeak = peak * Math.max(previousGain, this.micGain);
    const ceiling = boostedPeak > 0.75 ? 0.75 / boostedPeak : 1;
    this.peakGain = Math.min(ceiling, 1 + (this.peakGain - 1) * Math.exp(-seconds / 0.12));
    for (let i = 0; i < input.length; i++) {
      const gain = from + (this.openGain - from) * (i + 1) / input.length;
      const microphoneGain = previousGain + (this.micGain - previousGain) * (i + 1) / input.length;
      output[i] *= gain * microphoneGain * this.peakGain;
    }
    return true;
  }
}

registerProcessor('squadlink-voice-cleaner', VoiceCleaner);

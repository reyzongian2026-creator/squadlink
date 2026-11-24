const assert = require('node:assert/strict');

// Used only by the desktop smoke's synthetic getUserMedia fixture.
function reference(frequency) {
  let seed = 12345, offset = 0;
  const pitch = frequency === 500 ? 100 : 150;
  const tau = 2*Math.PI/48000;
  const hissAmplitude = Math.sqrt(3) * 10**(-38/20);
  const sine = Float32Array.from({length:960}, (_, i) => 0.15 * Math.sin(2 * Math.PI * frequency * i / 48000));
  const block = new Float32Array(sine.length);
  return mode => {
    if (mode === 'tone') return sine;
    if (mode === 'silence') return block.fill(0);
    for (let i = 0; i < block.length; i++) {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      const noise = (2 * seed / 4294967296 - 1) * hissAmplitude;
      if (mode === 'noise' || mode === 'noiseBypass') block[i] = noise;
      else if (mode === 'overload') block[i] = sine[i] * 6.5;
      else {
        // A pitched, syllable-modulated synthetic vowel, independent of human speech.
        const t = (offset+i)*tau;
        const vowel = (0.66+0.34*Math.sin(4*t))*(0.07*Math.sin(pitch*t) +
          0.14*Math.sin(frequency*t) + 0.06*Math.sin(12*pitch*t) + 0.035*Math.sin(21*pitch*t));
        block[i] = mode === 'mixed' ? vowel+noise : vowel;
      }
    }
    offset += block.length;
    return block;
  };
}

// Playback uses the Web Audio rendering clock. No timer or writer runs for each
// frame, even when the test page is in the background. Only the remote WebRTC
// receiver plays the signal; the generator is not connected to local speakers.
async function microphone(frequency, generator) {
  const ctx = new AudioContext({sampleRate:48000});
  const destination = ctx.createMediaStreamDestination();
  destination.channelCount = 1;
  const buffers = new Map();
  let source;
  function select(mode) {
    const key = mode === 'noiseBypass' ? 'noise' : mode;
    if (!buffers.has(key)) {
      const buffer = ctx.createBuffer(1,48000,48000);
      const pcm = buffer.getChannelData(0), generate = generator(frequency);
      for (let i = 0; i < pcm.length; i += 960) pcm.set(generate(key),i);
      buffers.set(key,buffer);
    }
    const next = ctx.createBufferSource();
    next.buffer = buffers.get(key);
    next.loop = true;
    next.connect(destination);
    const now = ctx.currentTime;
    next.start(now);
    if (source) { source.stop(now); source.disconnect(); }
    source = next;
  }
  const track = destination.stream.getAudioTracks()[0];
  const stop = track.stop.bind(track);
  track.stop = () => {
    stop();
    if (source) { source.stop(); source.disconnect(); source = null; }
    if (ctx.state !== 'closed') void ctx.close().catch(()=>{});
  };
  window.qaRawTrack = track;
  window.qaSetSignal = select;
  select('tone');
  await ctx.resume();
  return destination.stream;
}

// Project each 20 ms frame onto the expected tone; arbitrary phase shifts between
// frames do not count as distortion. Both test frequencies make whole cycles.
function summarize(samples, rate, frequency) {
  const frame = Math.round(rate / 50);
  const length = Math.floor(samples.length / frame) * frame;
  if (!length) throw Error('Faltan muestras para medir el nivel.');
  const cos = Float64Array.from({length:frame}, (_, i) => Math.cos(2 * Math.PI * frequency * i / rate));
  const sin = Float64Array.from({length:frame}, (_, i) => Math.sin(2 * Math.PI * frequency * i / rate));
  const pitch = frequency === 500 ? 100 : 150;
  const pitchCos = Float64Array.from({length:frame}, (_, i) => Math.cos(2 * Math.PI * pitch * i / rate));
  const pitchSin = Float64Array.from({length:frame}, (_, i) => Math.sin(2 * Math.PI * pitch * i / rate));
  let total = 0, tone = 0, fundamental = 0, peak = 0, clipped = 0;
  let periods = 0, periodSamples = 0, active = 0, gap = 0, longestGap = 0;
  const slice = Math.round(frame/4); // 5 ms at the 48 kHz test rate.
  const activityPower = 10**(-34/10);
  for (let offset = 0; offset < length; offset += frame) {
    let x = 0, y = 0, px = 0, py = 0, power = 0, below = false;
    let firstCrossing = -1, lastCrossing = -1, crossings = 0, frameActive = true;
    for (let i = 0; i < frame; i++) {
      const v = samples[offset+i], magnitude = Math.abs(v);
      total += v*v; peak = Math.max(peak, magnitude);
      if (magnitude >= 0.99) clipped++;
      if (v < -0.015) below = true;
      if (below && v > 0.015) {
        if (!crossings) firstCrossing = i;
        lastCrossing = i; crossings++; below = false;
      }
      power += v*v;
      if ((i+1)%slice === 0) {
        if (power/slice >= activityPower) { active++; gap=0; }
        else { frameActive = false; gap++; longestGap = Math.max(longestGap,gap); }
        power = 0;
      }
      x += v*cos[i]; y += v*sin[i]; px += v*pitchCos[i]; py += v*pitchSin[i];
    }
    // A gap is a coverage failure, not a slower oscillation. Frequency uses
    // complete periods inside active frames; coverage inspects every slice.
    if (frameActive && crossings > 1) {
      periods += crossings-1;
      periodSamples += lastCrossing-firstCrossing;
    }
    tone += 2 * (x*x + y*y) / frame;
    fundamental += 2 * (px*px + py*py) / frame;
  }
  const round = value => Number(value.toFixed(2));
  const db = power => round(10 * Math.log10(Math.max(power, 1e-12)));
  return {sampleRateHz:rate, samples:length, rmsDbfs:db(total/length), peakDbfs:db(peak*peak),
    clippedSamples:clipped, crossingHz:periodSamples ? round(periods*rate/periodSamples) : 0,
    coveragePct:round(100*active*slice/length), longestGapMs:round(longestGap*slice*1000/rate),
    pitchDbfs:db(fundamental/length), referenceDbfs:db(tone/length), residualDbfs:db(Math.max(0, total-tone)/length)};
}

function verify(mode, result, hz, bypass) {
  const measured = JSON.stringify(result);
  assert.ok(result.samples >= 0.9 * result.sampleRateHz, measured);
  assert.equal(result.clippedSamples, 0, 'Saturación digital: ' + measured);
  if (mode === 'tone' || mode === 'overload') {
    assert.ok(result.coveragePct >= 90 && result.longestGapMs <= 60, 'Huecos en la señal continua: '+measured);
  }
  if (mode === 'silence') {
    assert.ok(result.rmsDbfs <= -48, 'Fondo durante silencio digital: ' + measured);
  } else if (mode === 'noiseBypass') {
    assert.ok(result.rmsDbfs >= -53 && result.rmsDbfs <= -29, 'Nivel del ruido sin atenuación: ' + measured);
  } else if (mode === 'noise') {
    assert.ok(bypass.rmsDbfs - result.rmsDbfs >= 6 && result.rmsDbfs <= -44,
      'Se requieren 6 dB de atenuación de fondo respecto al filtro desactivado: '+measured);
  } else if (mode === 'voice' || mode === 'mixed') {
    assert.ok(result.rmsDbfs >= -35 && result.rmsDbfs <= -12 &&
      result.referenceDbfs >= -38 && result.pitchDbfs >= -45,
      'Nivel, fundamental o formante de la vocal sintética insuficientes: '+measured);
  } else if (mode === 'overload') {
    // Opus can overshoot the pre-codec limiter slightly.
    assert.ok(result.peakDbfs <= -0.75 && result.rmsDbfs >= -13,
      'La entrada intensa debe llegar con margen de pico: '+measured);
  } else {
    assert.ok(result.referenceDbfs >= -29 && result.referenceDbfs <= -12, 'Nivel de referencia recibido: ' + measured);
    const minimumMargin = 7;
    assert.ok(result.referenceDbfs - result.residualDbfs >= minimumMargin,
      'Separación insuficiente entre tono y residuo: ' + measured);
    if (mode === 'tone') assert.ok(Math.abs(result.crossingHz - hz) <= 0.12 * hz, 'Frecuencia recibida: ' + measured);
  }
}

async function capture(frequency) {
  const pc = window.testPeers.find(connection => connection.connectionState === 'connected');
  const track = pc?.getReceivers().find(receiver => receiver.track.kind === 'audio')?.track;
  if (!track) throw Error('Falta la pista entrante en la llamada de prueba.');
  const ctx = new AudioContext({sampleRate:48000});
  const source = ctx.createMediaStreamSource(new MediaStream([track]));
  // ScriptProcessor runs in the test document and needs no worklet URL or CSP change.
  const processor = ctx.createScriptProcessor(2048, 1, 1);
  const mute = ctx.createGain();
  mute.gain.value = 0;
  const signal = new Float32Array(ctx.sampleRate);
  let settling = Math.round(ctx.sampleRate * 0.65), filled = 0;
  try {
    await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(Error('Sin muestras decodificadas durante la prueba de voz.')), 8000);
      processor.onaudioprocess = e => {
        const data = e.inputBuffer.getChannelData(0);
        const skip = Math.min(settling, data.length);
        settling -= skip;
        const take = Math.min(data.length-skip, signal.length-filled);
        if (take) { signal.set(data.subarray(skip, skip+take), filled); filled += take; }
        if (filled === signal.length) { clearTimeout(timeout); resolve(); }
      };
      source.connect(processor); processor.connect(mute); mute.connect(ctx.destination);
      ctx.resume().catch(error => { clearTimeout(timeout); reject(error); });
    });
    return window.qaSummarize(signal, ctx.sampleRate, frequency);
  } finally {
    processor.onaudioprocess = null;
    source.disconnect(); processor.disconnect(); mute.disconnect();
    await ctx.close();
  }
}

function observeCleaner() {
  const Native = window.AudioWorkletNode;
  if (!Native) return;
  window.AudioWorkletNode = class extends Native {
    constructor(context, name, options) {
      super(context, name, options);
      if (name === 'squadlink-voice-cleaner') window.qaCleaner = this;
    }
  };
}

function fixtureSetup(hz) {
  return '('+observeCleaner.toString()+')();\nwindow.qaMicrophone = () => (' + microphone.toString() +
    ')(' + hz + ', ' + reference.toString() + ');\nwindow.qaSummarize = ' + summarize.toString() + ';\n';
}

async function testVoiceQuality(electron, peer) {
  const pages = [electron, peer];
  const incomingHz = [900, 500];
  const directions = ['Navegador → Electron', 'Electron → navegador'];
  const bypass = [];
  for (const page of pages) {
    const active = await page.evaluate(() => {
      const sender = window.testPeers.find(pc => pc.connectionState === 'connected')
        ?.getSenders().find(item => item.track?.kind === 'audio');
      return Boolean(window.qaCleaner?.context.state === 'running' &&
        window.qaCleaner.parameters.get('reduceNoise')?.value === 1 &&
        window.qaRawTrack && sender?.track && sender.track.id !== window.qaRawTrack.id);
    });
    assert.ok(active, 'El emisor debe usar la pista procesada por squadlink-voice-cleaner.');
  }
  for (const mode of ['tone','silence','noiseBypass','noise','voice','mixed','overload']) {
    await Promise.all(pages.map(page => page.evaluate(value => {
      window.qaSetSignal(value);
      window.qaCleaner.parameters.get('reduceNoise').value = value === 'noiseBypass' ? 0 : 1;
    }, mode)));
    const readings = await Promise.all(pages.map((page, i) => page.evaluate(capture, incomingHz[i])));
    for (const [i, reading] of readings.entries()) {
      console.log('Voz PCM recibida', directions[i], mode, JSON.stringify(reading));
      if (mode === 'noiseBypass') bypass[i] = reading;
      verify(mode, reading, incomingHz[i], bypass[i]);
    }
  }
  await Promise.all(pages.map(page => page.evaluate(() => { window.qaSetSignal('tone'); })));
}

module.exports = {reference, summarize, verify, fixtureSetup, testVoiceQuality};

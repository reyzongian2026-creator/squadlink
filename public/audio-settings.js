import { mountSpeakerTest } from './speaker-test.js';
import { mountMicTest } from './mic-test.js';

export function microphoneConstraints(settings) {
  const audio = { channelCount: { ideal: 1 }, sampleRate: { ideal: 48000 }, echoCancellation: true,
    noiseSuppression: settings.noiseSuppression, autoGainControl: settings.autoGainControl };
  if (settings.inputId) audio.deviceId = { exact: settings.inputId };
  return audio;
}

const preferencesKey = 'squadlink.audio.v1';
const recommended = Object.freeze({ noiseSuppression: true, autoGainControl: false, listenVolume: 0.7, micGainDb: 0 });

export function readAudioSettings() {
  let stored;
  try { stored = JSON.parse(globalThis.window?.localStorage.getItem(preferencesKey) ?? 'null'); } catch {}
  return {
    inputId: typeof stored?.inputId === 'string' ? stored.inputId : '',
    outputId: typeof stored?.outputId === 'string' ? stored.outputId : '',
    noiseSuppression: typeof stored?.noiseSuppression === 'boolean' ? stored.noiseSuppression : recommended.noiseSuppression,
    autoGainControl: typeof stored?.autoGainControl === 'boolean' ? stored.autoGainControl : recommended.autoGainControl,
    micGainDb: Number.isFinite(stored?.micGainDb) ? Math.min(18, Math.max(0, Math.round(stored.micGainDb))) : recommended.micGainDb,
    listenVolume: Number.isFinite(stored?.listenVolume) ? Math.max(0, Math.min(2, stored.listenVolume)) : recommended.listenVolume
  };
}

export function saveAudioSettings(settings) {
  try { globalThis.window?.localStorage.setItem(preferencesKey, JSON.stringify(settings)); } catch {}
}

export function mountAudioSettings(container, getVoice, onStatus) {
  const field = (text, control) => {
    const label = document.createElement('label');
    label.append(text, control);
    return label;
  };
  const microphone = document.createElement('select');
  const speakers = document.createElement('select');
  const noise = document.createElement('input');
  noise.type = 'checkbox';
  const gain = document.createElement('input');
  gain.type = 'checkbox';
  const levelControl = (label, max, format) => {
    const slider = document.createElement('input');
    slider.type = 'range'; slider.min = '0'; slider.max = String(max); slider.step = '1';
    slider.setAttribute('aria-label', label);
    const element = field(label, slider);
    const value = document.createElement('span');
    value.setAttribute('aria-hidden', 'true');
    element.append(value);
    const updateLabel = () => {
      const text = format(Number(slider.value));
      value.textContent = text;
      slider.setAttribute('aria-valuetext', text);
    };
    let previewing = false;
    slider.oninput = () => { previewing = true; updateLabel(); };
    function sync(next, settled) {
      if (settled) previewing = false;
      if (previewing) return;
      slider.value = String(next);
      updateLabel();
    }
    return {slider, element, sync};
  };
  const inputLevel = levelControl('Ganancia de mi micrófono', 18, db => (db > 0 ? '+' : '') + db + ' dB');
  const listenLevel = levelControl('Volumen de las voces que escucho', 200, percent => percent + ' %');
  const micGain = inputLevel.slider;
  const volume = listenLevel.slider;
  function syncLevels(settings, settled = {}) {
    inputLevel.sync(settings.micGainDb, Object.hasOwn(settled,'micGainDb'));
    listenLevel.sync(Math.round(settings.listenVolume * 100), Object.hasOwn(settled,'listenVolume'));
  }
  syncLevels(getVoice()?.settings ?? readAudioSettings());
  const testArea = document.createElement('div');
  testArea.className = 'audio-tests';
  const micArea = document.createElement('div');
  const speakerArea = document.createElement('div');
  testArea.append(micArea, speakerArea);
  const help = document.createElement('p');
  help.textContent = 'Puedes probar el micrófono y el altavoz antes de entrar a la sala.';
  const micTest = mountMicTest(micArea, () => microphoneConstraints(readAudioSettings()), readAudioSettings);
  const speakerTest = mountSpeakerTest(speakerArea, readAudioSettings);
  micArea.addEventListener('click', event => {
    if (event.target.closest('button')) speakerTest.cancel();
  }, true);
  speakerArea.addEventListener('click', event => {
    if (event.target.closest('button')) micTest.cancelActive();
  }, true);
  const cancelTests = () => { micTest.cancel(); speakerTest.cancel(); };
  const syncProcessing = () => {
    const inRoom = !!getVoice() || document.getElementById('room')?.hidden === false;
    if (inRoom) cancelTests();
    testArea.hidden = inRoom;
    help.hidden = !inRoom;
  };
  const refresh = document.createElement('button');
  refresh.type = 'button';
  refresh.className = 'secondary';
  refresh.textContent = 'Actualizar dispositivos';
  const restore = document.createElement('button');
  restore.type = 'button';
  restore.className = 'secondary';
  restore.textContent = 'Restablecer volumen y filtros de voz';
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const media = navigator.mediaDevices;
  const outputSupported = typeof HTMLMediaElement.prototype.setSinkId === 'function';
  const noiseSupported = !!media?.getSupportedConstraints?.().noiseSuppression ||
    !!(globalThis.AudioContext && globalThis.AudioWorkletNode);
  const renderOptions = (select, devices, chosen, kind) => {
    select.replaceChildren(new Option('Predeterminado del sistema', ''));
    let number = 0;
    for (const item of devices.filter(d => d.kind === kind && d.deviceId && d.deviceId !== 'default')) {
      ++number;
      select.add(new Option(item.label || (kind === 'audioinput' ? 'Micrófono ' : 'Salida ') + number, item.deviceId));
    }
    if (chosen && ![...select.options].some(o => o.value === chosen))
      select.add(new Option('Dispositivo guardado', chosen));
    select.value = chosen;
  };
  let reading = 0;
  let saving = false;
  let devices = [];
  async function render(refreshDevices = true) {
    if (refreshDevices) {
      const sequence = ++reading;
      let list;
      try { list = await media?.enumerateDevices?.() ?? []; } catch { list = []; }
      if (sequence !== reading) return;
      devices = list;
    }
    const settings = getVoice()?.settings ?? readAudioSettings();
    renderOptions(microphone, devices, settings.inputId, 'audioinput');
    renderOptions(speakers, devices, settings.outputId, 'audiooutput');
    noise.checked = settings.noiseSuppression;
    gain.checked = settings.autoGainControl;
    syncLevels(settings);
    micGain.disabled = saving;
    gain.disabled = saving || !media?.getSupportedConstraints?.().autoGainControl;
    volume.disabled = saving;
    syncProcessing();
    microphone.disabled = saving || !media;
    speakers.disabled = saving || !outputSupported;
    noise.disabled = saving || !noiseSupported;
    refresh.disabled = restore.disabled = saving;
  }
  async function change(patch, confirmation = 'Preferencia de audio actualizada.') {
    if (saving) return;
    saving = true;
    cancelTests();
    let message;
    micGain.disabled = volume.disabled = gain.disabled = true;
    microphone.disabled = speakers.disabled = noise.disabled = refresh.disabled = restore.disabled = true;
    try {
      const voice = getVoice();
      if (voice) await voice.configureAudio(patch);
      else saveAudioSettings({ ...readAudioSettings(), ...patch });
      message = confirmation;
    } catch (err) {
      message = err.message;
      onStatus?.(err.message);
    } finally {
      saving = false;
      // An unrelated device refresh must not commit or discard a slider draft.
      syncLevels(getVoice()?.settings ?? readAudioSettings(), patch);
      const levelsOnly = Object.keys(patch).every(key => key === 'micGainDb' || key === 'listenVolume');
      await render(!levelsOnly);
      status.textContent = message;
    }
  }
  microphone.onchange = () => change({ inputId: microphone.value });
  speakers.onchange = () => change({ outputId: speakers.value });
  volume.onchange = () => change({ listenVolume: Number(volume.value) / 100 });
  micGain.onchange = () => change({ micGainDb: Number(micGain.value) });
  gain.onchange = () => change({ autoGainControl: gain.checked });
  noise.onchange = () => change({ noiseSuppression: noise.checked });
  restore.onclick = () => change(recommended, 'Volumen de voz al 70 %. Ganancia del micrófono a 0 dB. Reducción de ruido activada y ganancia automática desactivada.');
  refresh.onclick = async () => {
    await render();
    status.textContent = 'Lista actualizada. Activa el micrófono para ver los dispositivos autorizados.';
  };
  const note = document.createElement('p');
  note.textContent = outputSupported
    ? 'Activa el micrófono para que el navegador muestre los nombres de los dispositivos.'
    : 'La salida de audio se elige en los ajustes de sonido de tu sistema.';
  container.replaceChildren(field('Micrófono', microphone), inputLevel.element, field('Salida de audio', speakers),
    listenLevel.element, field('Reducir ruido de fondo', noise),
    field('Ganancia automática del micrófono', gain), restore, testArea, help, refresh, note, status);
  media?.addEventListener?.('devicechange', render);
  window.addEventListener('squadlink:audio-state', syncProcessing);
  render();
  return () => { ++reading; micTest.dispose(); speakerTest.dispose(); window.removeEventListener('squadlink:audio-state', syncProcessing); media?.removeEventListener?.('devicechange', render); };
}

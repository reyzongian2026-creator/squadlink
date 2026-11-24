import { mountMicTest } from './mic-test.js';

export function microphoneConstraints(settings) {
  const audio = { channelCount: { ideal: 1 }, sampleRate: { ideal: 48000 }, echoCancellation: true,
    noiseSuppression: settings.noiseSuppression, autoGainControl: settings.autoGainControl };
  if (settings.inputId) audio.deviceId = { exact: settings.inputId };
  return audio;
}

function describeProcessing(track) {
  if (!track || track.readyState === 'ended') return 'Activa el micrófono para comprobar los filtros.';
  const actual = track.getSettings?.() ?? {};
  const state = value => value === true ? 'activa' : value === false ? 'desactivada' : 'sin confirmar';
  return 'Reducción de ruido: ' + state(actual.noiseSuppression) +
    '. Ganancia automática: ' + state(actual.autoGainControl) + '.';
}

const preferencesKey = 'squadlink.audio.v1';
const recommended = Object.freeze({ noiseSuppression: true, autoGainControl: false, listenVolume: 0.7 });

export function readAudioSettings() {
  let stored;
  try { stored = JSON.parse(globalThis.window?.localStorage.getItem(preferencesKey) ?? 'null'); } catch {}
  return {
    inputId: typeof stored?.inputId === 'string' ? stored.inputId : '',
    outputId: typeof stored?.outputId === 'string' ? stored.outputId : '',
    noiseSuppression: typeof stored?.noiseSuppression === 'boolean' ? stored.noiseSuppression : recommended.noiseSuppression,
    autoGainControl: typeof stored?.autoGainControl === 'boolean' ? stored.autoGainControl : recommended.autoGainControl,
    listenVolume: Number.isFinite(stored?.listenVolume) ? Math.max(0, Math.min(1, stored.listenVolume)) : recommended.listenVolume
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
  const volume = document.createElement('input');
  volume.type = 'range'; volume.min = '0'; volume.max = '100';
  const actual = document.createElement('p');
  actual.setAttribute('role', 'status');
  const testArea = document.createElement('div');
  const syncProcessing = () => {
    actual.textContent = describeProcessing(getVoice()?.stream?.getAudioTracks()[0]);
    if (getVoice() || !document.getElementById('room')?.hidden) micTest.cancel();
    testArea.hidden = !!getVoice() || !document.getElementById('room')?.hidden;
  };
  const micTest = mountMicTest(testArea, () => microphoneConstraints(readAudioSettings()), () => readAudioSettings());
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
  const host = window.squadBridge ?? window.chrome?.webview;
  const sampleButton = testArea.querySelector('button');
  const sampleStatus = testArea.querySelector('[role="status"]');
  function notifyHost() {
    if (!host || document.body.dataset.workspace !== 'settings') return;
    const selector = el => ({value: el.value, enabled: !el.disabled, options: [...el.options].map(o=>[o.value, o.text])});
    const toggle = el => ({checked: el.checked, enabled: !el.disabled});
    host.postMessage({type:'desktop:audio-state', input:selector(microphone), output:selector(speakers),
      noise:toggle(noise), gain:toggle(gain), volume:Number(volume.value), canVolume:!volume.disabled,
      test:sampleButton.textContent, canTest:!sampleButton.disabled, showTest:!testArea.hidden,
      testStatus:sampleStatus?.textContent || '', filters:actual.textContent, status:status.textContent, canRefresh:!refresh.disabled});
  }
  const audioCommand = ({data}) => {
    if (data?.type === 'desktop:action' && data.action === 'settings') { queueMicrotask(notifyHost); return; }
    if (data?.type !== 'desktop:audio-change' || document.body.dataset.workspace !== 'settings') return;
    const el = {input:microphone, output:speakers, volume, noise, gain, test:sampleButton, refresh}[data.key];
    if (!el || el.disabled) return;
    if (el===sampleButton || el===refresh) { if(el!==sampleButton || !testArea.hidden) el.click(); return; }
    if (el.type==='checkbox') el.checked=data.value===true; else el.value=String(data.value);
    el.dispatchEvent(new Event('change'));
  };
  const audioObserver = host ? new MutationObserver(notifyHost) : null;
  audioObserver?.observe(container,{subtree:true,childList:true,characterData:true,attributeFilter:['disabled','hidden','aria-valuetext']});
  host?.addEventListener('message',audioCommand);
  const media = navigator.mediaDevices;
  const outputSupported = typeof HTMLMediaElement.prototype.setSinkId === 'function';
  const noiseSupported = !!media?.getSupportedConstraints?.().noiseSuppression;
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
  async function render() {
    const sequence = ++reading;
    let devices = [];
    try { devices = await media?.enumerateDevices?.() ?? []; } catch {}
    if (sequence !== reading) return;
    const settings = getVoice()?.settings ?? readAudioSettings();
    renderOptions(microphone, devices, settings.inputId, 'audioinput');
    renderOptions(speakers, devices, settings.outputId, 'audiooutput');
    noise.checked = settings.noiseSuppression;
    gain.checked = settings.autoGainControl;
    volume.value = String(Math.round(settings.listenVolume * 100));
    volume.setAttribute('aria-valuetext', volume.value + ' %');
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
    micTest.cancel();
    volume.disabled = gain.disabled = true;
    microphone.disabled = speakers.disabled = noise.disabled = refresh.disabled = restore.disabled = true;
    try {
      const voice = getVoice();
      if (voice) await voice.configureAudio(patch);
      else saveAudioSettings({ ...readAudioSettings(), ...patch });
      status.textContent = confirmation;
    } catch (err) {
      status.textContent = err.message;
      onStatus?.(err.message);
    } finally {
      saving = false;
      await render();
    }
  }
  microphone.onchange = () => change({ inputId: microphone.value });
  speakers.onchange = () => change({ outputId: speakers.value });
  volume.onchange = () => change({ listenVolume: Number(volume.value) / 100 });
  gain.onchange = () => change({ autoGainControl: gain.checked });
  noise.onchange = () => change({ noiseSuppression: noise.checked });
  restore.onclick = () => change(recommended, 'Volumen de voz al 70 %. Reducción de ruido activada y ganancia automática desactivada.');
  refresh.onclick = async () => {
    await render();
    status.textContent = 'Lista actualizada. Activa el micrófono para ver los dispositivos autorizados.';
  };
  const note = document.createElement('p');
  note.textContent = outputSupported
    ? 'Activa el micrófono para que el navegador muestre los nombres de los dispositivos.'
    : 'La salida de audio se elige en los ajustes de sonido de tu sistema.';
  container.replaceChildren(field('Micrófono', microphone), field('Salida de audio', speakers),
    field('Volumen de las voces que escucho', volume), field('Reducir ruido de fondo', noise),
    field('Ganancia automática del micrófono', gain), restore, actual, testArea, refresh, note, status);
  media?.addEventListener?.('devicechange', render);
  window.addEventListener('squadlink:audio-state', syncProcessing);
  render();
  return () => { ++reading; audioObserver?.disconnect(); host?.removeEventListener('message',audioCommand); micTest.dispose(); window.removeEventListener('squadlink:audio-state', syncProcessing); media?.removeEventListener?.('devicechange', render); };
}

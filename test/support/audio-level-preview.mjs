import assert from 'node:assert/strict';
import {mountAudioSettings,readAudioSettings} from '../../public/audio-settings.js';

// Hold the initial device enumeration until after the slider's input event.
export async function audioLevelPreview(Window) {
  const view = new Window({url:'http://localhost'});
  const doc = view.document;
  const originals = new Map();
  const media = new view.EventTarget();
  const pending = Promise.withResolvers();
  media.enumerateDevices = () => pending.promise;
  const option = function(label,value) {
    const el = doc.createElement('option');
    el.textContent = label;
    el.value = value;
    return el;
  };
  let dispose;
  try {
    for (const [key,value] of Object.entries({window:view,document:doc,navigator:{mediaDevices:media},
                                              HTMLMediaElement:view.HTMLMediaElement,Option:option})) {
      originals.set(key,Object.getOwnPropertyDescriptor(globalThis,key));
      Object.defineProperty(globalThis,key,{configurable:true,value});
    }
    const panel = doc.createElement('section');
    doc.body.append(panel);
    dispose = mountAudioSettings(panel,()=>null);
    const [mic,listen] = panel.querySelectorAll('[type="range"]');
    for (const [el,value] of [[mic,'7'],[listen,'130']]) {
      el.value = value;
      el.dispatchEvent(new view.Event('input',{bubbles:true}));
    }
    pending.resolve([{kind:'audioinput',deviceId:'nuevo',label:'Micrófono USB'}]);
    await new Promise(resolve=>setImmediate(resolve));
    assert.ok(panel.querySelector('option[value="nuevo"]'));
    assert.deepEqual([mic.value,mic.getAttribute('aria-valuetext')],['7','+7 dB']);
    assert.deepEqual([listen.value,listen.getAttribute('aria-valuetext')],['130','130 %']);
    assert.equal(readAudioSettings().micGainDb,0);
    assert.equal(readAudioSettings().listenVolume,0.7);
    mic.dispatchEvent(new view.Event('change'));
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(readAudioSettings().micGainDb,7);
    assert.deepEqual([listen.value,listen.getAttribute('aria-valuetext')],['130','130 %']);
    const restore = [...panel.querySelectorAll('button')].find(el=>el.textContent==='Restablecer volumen y filtros de voz');
    restore.click();
    await new Promise(resolve=>setImmediate(resolve));
    assert.deepEqual([mic.value,listen.value],['0','70']);
  } finally {
    dispose?.();
    await view.happyDOM.abort();
    for (const [key,descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis,key,descriptor);
      else delete globalThis[key];
    }
  }
}

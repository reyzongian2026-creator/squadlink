import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chromium } from 'playwright';

const relay = process.env.PILOT_RELAY;
const origin = 'https://squadlink-lobby.onrender.com';
const browser = await chromium.launch({ args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
try {
  for (const transport of ['udp', 'tcp']) {
    const contexts = [];
    const pages = [];
    const password = randomUUID();
    let code;
    try {
      for (let i = 0; i < 2; i++) {
        const context = await browser.newContext({ permissions: ['microphone'] });
        contexts.push(context);
        await context.addInitScript(({relay, transport}) => {
          window.pilotPeers = [];
          const NativePeer = window.RTCPeerConnection;
          window.RTCPeerConnection = class extends NativePeer {
            constructor(config) {
              const url = 'turn:' + relay + ':3478?transport=' + transport;
              const iceServers = (config?.iceServers || []).filter(s => [s.urls].flat().includes(url)).map(s => ({ ...s, urls: url }));
              if (!iceServers.length) throw Error('El lobby no ofreció el transporte esperado');
              super({ ...config, iceServers, iceTransportPolicy: 'relay' });
              window.pilotPeers.push(this);
            }
          };
        }, { relay, transport });
        const page = await context.newPage();
        pages.push(page);
        await page.goto(origin);
        await page.getByRole('button', { name: i ? 'Unirme con código' : 'Crear sala', exact: true }).first().click();
        await page.getByLabel('Tu apodo').fill('Prueba SCL ' + (i+1));
        if (i) await page.getByLabel('Código de sala').fill(code);
        else await page.getByLabel('Nombre de la sala').fill('Prueba privada Santiago');
        await page.getByLabel('Clave').fill(password);
        await page.locator('#submit-entry').click();
        await page.locator('#room-code').waitFor({state:'visible'});
        code = await page.locator('#room-code').innerText();
      }
      for (const page of pages) await page.getByRole('button',{name:'Activar micrófono'}).click();
      const results = await Promise.all(pages.map(async page => {
        const deadline = Date.now() + 50000;
        let data;
        while (!data && Date.now() < deadline) {
          data = await page.evaluate(async ip => {
          for (const peer of window.pilotPeers) {
            if (peer.connectionState !== 'connected') continue;
            const stats = await peer.getStats();
            const selected = [...stats.values()].find(s => s.type === 'transport' && s.selectedCandidatePairId);
            const pair = selected && stats.get(selected.selectedCandidatePairId);
            const candidate = pair && stats.get(pair.localCandidateId);
            const audio = [...stats.values()].find(s => s.type === 'inbound-rtp' && s.kind === 'audio');
            if (candidate?.candidateType === 'relay' && candidate.address === ip && audio?.packetsReceived >= 40 && audio.totalAudioEnergy > 0)
              return { ruta:candidate.candidateType, ip:candidate.address, paquetes:audio.packetsReceived, energia:audio.totalAudioEnergy, rtt_ms:Math.round(pair.currentRoundTripTime*1000) };
          }
          return false;
        }, relay);
          if (!data) await new Promise(resolve => setTimeout(resolve, 400));
        }
        if (!data) {
          const diagnostic = await page.evaluate(async () => Promise.all(window.pilotPeers.map(async p => ({state:p.connectionState, ice:p.iceConnectionState, candidates:[...(await p.getStats()).values()].filter(s=>s.type==='local-candidate'||s.type==='remote-candidate').map(s=>[s.type,s.candidateType,s.address,s.relayProtocol]), inbound:[...(await p.getStats()).values()].filter(s=>s.type==='inbound-rtp').map(s=>[s.packetsReceived,s.totalAudioEnergy])}))));
          throw Error(JSON.stringify(diagnostic));
        }
        return data;
      }));
      assert.equal(results.length, 2);
      assert.ok(results.every(result => result && result.ruta === 'relay' && result.paquetes >= 40 && result.energia > 0));
      console.log('Audio bidireccional', transport, JSON.stringify(results));
    } finally {
      for (const page of pages) {
        const leave = page.getByRole('button',{name:'Salir de la sala'});
        if (await leave.isVisible()) await leave.click({timeout:3000}).catch(()=>{});
      }
      for (const context of contexts) await context.close();
    }
  }
} finally { await browser.close(); }

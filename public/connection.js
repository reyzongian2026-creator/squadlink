const sampleDelay = 1200;
const formatter = new Intl.NumberFormat('es', {maximumFractionDigits:1});

function display(value, unit) {
  if (value > 0 && value < 0.1) return '<0,1 ' + unit;
  return formatter.format(value) + ' ' + unit;
}

function describePath(stats, audio) {
  const all = [...stats.values()];
  const transport = stats.get(audio?.transportId)
    ?? all.find(report => report.type === 'transport' && report.selectedCandidatePairId);
  const pair = stats.get(transport?.selectedCandidatePairId)
    ?? all.find(report => report.type === 'candidate-pair' && report.nominated && report.state === 'succeeded');
  if (!pair) return 'Esperando una ruta de audio';
  const endpoints = [stats.get(pair.localCandidateId), stats.get(pair.remoteCandidateId)];
  let route = 'Ruta sin identificar';
  if (endpoints.some(candidate => candidate?.candidateType === 'relay')) route = 'Por retransmisor';
  else if (endpoints.every(candidate => candidate?.candidateType)) route = 'Directa';
  if (!Number.isFinite(pair.currentRoundTripTime) || pair.currentRoundTripTime < 0)
    return route + ' · Ida y vuelta sin medición';
  return route + ' · ' + display(pair.currentRoundTripTime * 1000,'ms') + ' de ida y vuelta';
}

function isAudio(report, stats) {
  if (report.type !== 'inbound-rtp') return false;
  const kind = report.kind ?? report.mediaType;
  return kind ? kind === 'audio' : stats.get(report.codecId)?.mimeType?.startsWith('audio/');
}

function count(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function describeReceived(previous, current) {
  // A reused stats ID, a new SSRC or a reset counter cannot establish interval loss.
  const same = previous && current.ssrc != null && previous.ssrc === current.ssrc &&
    !(Number.isFinite(previous.timestamp) && Number.isFinite(current.timestamp) && current.timestamp <= previous.timestamp);
  const received = same && count(previous.packetsReceived) && count(current.packetsReceived)
    ? current.packetsReceived - previous.packetsReceived : null;
  const lost = same && count(previous.packetsLost) && count(current.packetsLost)
    ? current.packetsLost - previous.packetsLost : null;
  const hasReceivedAudio = count(current.packetsReceived) ? current.packetsReceived > 0 : current.jitter > 0;
  const jitter = Number.isFinite(current.jitter) && current.jitter >= 0 && hasReceivedAudio;
  const metrics = [jitter ? 'Último jitter ' + display(current.jitter * 1000,'ms') : 'Jitter sin medición'];
  if (received === 0 && lost === 0) metrics.push('Sin paquetes nuevos en la muestra');
  else if (received !== null && received >= 0 && lost !== null && lost >= 0 && Number.isSafeInteger(received + lost)) {
    const expected = received + lost;
    metrics.push('Pérdida en la muestra ' + display(lost * 100 / expected,'%') + ' (' + lost + ' de ' + expected + ')');
  } else metrics.push('Pérdida en la muestra sin medición');
  return metrics.join(' · ');
}

export function describeConnection(before, after) {
  if (!after) return before ? 'Una sola lectura · ' + describeConnection(null,before) : 'Medición no disponible';
  const streams = [...after.values()].filter(report => isAudio(report,after));
  const route = describePath(after,streams[0]);
  if (!streams.length) return route + ' · Sin estadísticas de audio recibido';
  const audio = streams.map((stream,index) => {
    const prior = before?.get(stream.id);
    const label = streams.length > 1 ? 'Audio ' + (index+1) + ' · ' : '';
    return label + describeReceived(prior && isAudio(prior,before) ? prior : null,stream);
  });
  return [route,...audio].join(' · ');
}

async function readStats(pc) {
  let timer;
  try {
    return await Promise.race([
      pc.getStats(),
      new Promise(resolve => { timer = setTimeout(() => resolve(null), 2500); })
    ]);
  } catch { return null; }
  finally { clearTimeout(timer); }
}

export function bindVoiceDiagnostics(getVoice, getMembers) {
  const button = document.getElementById('measure-voice');
  const output = document.getElementById('voice-measurements');
  button.onclick = async () => {
    if (button.disabled) return;
    const voice = getVoice();
    output.replaceChildren();
    if (!voice?.peers.size) {
      output.textContent = 'La medición estará disponible cuando entre otro jugador.';
      return;
    }
    button.disabled = true;
    output.setAttribute('aria-busy','true');
    output.textContent = 'Midiendo la conexión y el audio recibido…';
    const peers = [...voice.peers.values()];
    const present = peer => getVoice() === voice && voice.peers.get(peer.id) === peer;
    try {
      const first = await Promise.all(peers.map(peer => readStats(peer.pc)));
      if (!peers.some(present)) return;
      await new Promise(resolve => setTimeout(resolve,sampleDelay));
      const second = await Promise.all(peers.map(peer => present(peer) ? readStats(peer.pc) : null));
      if (getVoice() !== voice) return;
      output.replaceChildren();
      const members = getMembers();
      for (const [index,peer] of peers.entries()) {
        if (!present(peer)) continue;
        const row = document.createElement('div');
        const nick = members.find(member => member.id === peer.id)?.nick ?? 'Jugador';
        row.textContent = nick + ' · ' + describeConnection(first[index],second[index]);
        output.append(row);
      }
    } finally {
      if (getVoice() === voice && !peers.some(present)) output.textContent = 'Los participantes cambiaron. Vuelve a medir.';
      output.removeAttribute('aria-busy');
      button.disabled = false;
    }
  };
}

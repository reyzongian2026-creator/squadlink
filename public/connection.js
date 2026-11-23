function describePath(stats) {
  const all = [...stats.values()];
  const transport = all.find(report => report.type === 'transport' && report.selectedCandidatePairId);
  const pair = stats.get(transport?.selectedCandidatePairId)
    ?? all.find(report => report.type === 'candidate-pair' && report.nominated && report.state === 'succeeded');
  if (!pair) return 'Esperando una ruta de audio';
  const endpoints = [stats.get(pair.localCandidateId), stats.get(pair.remoteCandidateId)];
  let route = 'Ruta sin identificar';
  if (endpoints.some(candidate => candidate?.candidateType === 'relay')) route = 'Por retransmisor';
  else if (endpoints.every(candidate => candidate?.candidateType)) route = 'Directa';
  if (!Number.isFinite(pair.currentRoundTripTime)) return route + ' · Aún sin medición';
  return route + ' · ' + Math.round(pair.currentRoundTripTime * 1000) + ' ms de ida y vuelta';
}

export function bindVoiceDiagnostics(getVoice, getMembers) {
  const button = document.getElementById('measure-voice');
  const output = document.getElementById('voice-measurements');
  button.onclick = async () => {
    const voice = getVoice();
    const members = getMembers();
    output.replaceChildren();
    if (!voice?.peers.size) {
      output.textContent = 'La medición estará disponible cuando entre otro jugador.';
      return;
    }
    button.disabled = true;
    try {
      const lines = await Promise.all([...voice.peers.values()].map(async peer => {
        const nick = members.find(member => member.id === peer.id)?.nick ?? 'Jugador';
        try { return nick + ' · ' + describePath(await peer.pc.getStats()); }
        catch { return nick + ' · Medición no disponible'; }
      }));
      if (getVoice() !== voice) return;
      for (const line of lines) {
        const row = document.createElement('div');
        row.textContent = line;
        output.append(row);
      }
    } finally { button.disabled = false; }
  };
}

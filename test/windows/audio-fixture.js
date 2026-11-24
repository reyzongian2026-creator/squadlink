// Test fixture for the isolated Windows runner, whose image has no sound card.
// Only a private copy of the installed UI loads this file.
function installAudioFixture() {
  const Base = window.RTCPeerConnection;
  window.testPeers = [];
  window.RTCPeerConnection = class extends Base {
    constructor(...args) { super(...args); window.testPeers.push(this); }
  };
  navigator.mediaDevices.getUserMedia = async () => {
    if (window.qaMicrophone) return window.qaMicrophone();
    const track = new MediaStreamTrackGenerator({kind:'audio'});
    const writer = track.writable.getWriter();
    const block = Float32Array.from({length:960},(_,i)=>0.15*Math.sin(2*Math.PI*500*i/48000));
    let time=0, busy=false;
    const timer = setInterval(async () => {
      if (busy || track.readyState === 'ended') return;
      busy = true;
      const chunk = new AudioData({format:'f32',sampleRate:48000,numberOfFrames:960,numberOfChannels:1,timestamp:time,data:block});
      time+=20000;
      try { await writer.write(chunk); } catch { clearInterval(timer); }
      finally { chunk.close(); busy=false; }
    },20);
    const stop = track.stop.bind(track);
    track.stop = () => { clearInterval(timer); stop(); void writer.close().catch(()=>{}); };
    return new MediaStream([track]);
  };
}
installAudioFixture();
if(window.chrome?.webview){
  setInterval(async () => {
    for (const peer of window.testPeers) {
      if(peer.connectionState !== 'connected') continue;
      for (const r of (await peer.getStats()).values()) {
        if(r.type === 'inbound-rtp' && r.kind === 'audio') {
          await fetch('/api/test-audio?packets='+r.packetsReceived+'&energy='+(r.totalAudioEnergy||0),{method:'POST'}).catch(()=>{});
          return;
        }
      }
    }
  },1000);
}

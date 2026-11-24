import {radioStations, stationById} from "./radio-stations.js";

const videoPattern = /^[\w-]{11}$/;
const widgetChannel = "squadlink:music";
const desktopWidget = "https://squadlink-lobby.onrender.com/music-youtube.html";

export function youtubeId(input) {
  let url;
  try { url = new URL(input.trim()); } catch { return null; }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  let id;
  if (host === "youtu.be" && parts.length === 1) id = parts[0];
  if (["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com"].includes(host)) {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    if (parts.length === 2 && ["shorts", "embed", "live"].includes(parts[0])) id = parts[1];
  }
  return typeof id === "string" && videoPattern.test(id) ? id : null;
}

const maxFileBytes = 20 * 1024 * 1024;

export function stationsForGenre(genre) {
  return radioStations.filter(station => !genre || station.genre === genre);
}

export function roomPosition(startedAt, clockOffset, now = Date.now()) {
  return Number.isFinite(startedAt) ? Math.max(0, (now + clockOffset - startedAt) / 1000) : 0;
}

function fileDuration(file, signal) {
  return new Promise((resolve, reject) => {
    const audio = document.createElement("audio");
    const url = URL.createObjectURL(file);
    const timer = setTimeout(() => finish(Error("No se pudo leer la duración del archivo.")), 12000);
    const abort = () => finish(new DOMException("Cancelado", "AbortError"));
    function finish(error) {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      audio.onloadedmetadata = audio.onerror = null;
      const duration = audio.duration;
      audio.removeAttribute("src");
      audio.load();
      URL.revokeObjectURL(url);
      if (error) reject(error);
      else resolve(duration);
    }
    signal.addEventListener("abort", abort, {once: true});
    audio.preload = "metadata";
    audio.onloadedmetadata = () => finish(Number.isFinite(audio.duration) && audio.duration > 0
      ? null : Error("Elige un archivo con una duración definida."));
    audio.onerror = () => finish(Error("El navegador no puede reproducir este archivo."));
    if (signal.aborted) abort();
    else audio.src = url;
  });
}

export function createMusic({mount, api, notify}) {
  mount.innerHTML = `
    <section class="music-panel" aria-labelledby="music-heading">
      <header class="music-header"><h3 id="music-heading">Música de sala</h3><button type="button" data-listen class="secondary small" aria-pressed="false" aria-keyshortcuts="Alt+Shift+R"><span data-listen-label>Escuchar aquí</span><kbd aria-hidden="true"></kbd></button></header>
      <div class="music-current" hidden><div class="music-track"><strong data-title></strong><small data-kind></small></div><button type="button" data-shared class="secondary small" hidden>Volver a la música de sala</button><button type="button" data-next class="secondary small">Siguiente</button></div>
      <div data-player></div>
      <label class="music-volume" hidden>Volumen de música <input type="range" min="0" max="100" value="60" aria-label="Volumen de música"><output>60 %</output></label>
      <p class="music-empty" hidden>La cola está vacía.</p>
      <p class="music-notice" role="status"></p>
      <details class="music-queue" hidden><summary>Cola de reproducción</summary><ol></ol></details>
      <details class="music-add"><summary>Añadir música</summary><form>
        <fieldset class="music-picker source-picker"><legend>Fuente</legend>
          <div class="source-options">
            <label><input type="radio" name="music-source" value="radio" checked><span>Radio en directo</span></label>
            <label><input type="radio" name="music-source" value="file"><span>Archivo de audio</span></label>
            <label><input type="radio" name="music-source" value="youtube"><span>YouTube</span></label>
          </div>
        </fieldset>
        <fieldset class="music-picker genre-picker" data-radio><legend>Género</legend><div class="genre-options"></div></fieldset>
        <fieldset class="music-picker station-picker" data-radio><legend>Emisora</legend><div class="station-options"></div></fieldset>
        <p class="music-turn" data-radio>Turnos de 30 min en la sala.</p>
        <label data-link hidden>Enlace de YouTube<input type="url" placeholder="https://youtu.be/…" disabled></label>
        <label data-name hidden>Título (opcional)<input maxlength="80" autocomplete="off" disabled></label>
        <label data-file hidden>Archivo de audio (hasta 20 MiB)<input type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.webm" disabled></label>
        <div class="music-submit"><button type="button" class="secondary" data-personal data-radio>Escuchar solo aquí</button> <button class="primary" type="submit">Añadir a la sala</button></div>
      </form></details>
    </section>`;
  const el = selector => mount.querySelector(selector);
  if (window.squadBridge) {
    el("#music-heading").textContent = "Radio y música";
    const artist = document.createElement("small");
    artist.className = "room-dj";
    artist.textContent = "DJ Squadlink";
    el(".music-header").prepend(artist);
  }
  const listen = el("[data-listen]"), current = el(".music-current"), next = el("[data-next]");
  const player = el("[data-player]"), title = el("[data-title]"), notice = el(".music-notice");
  const volume = el('input[type="range"]'), volumeLabel = el(".music-volume");
  const volumeKey = "squadlink.music.volume";
  try {
    const saved = localStorage.getItem(volumeKey);
    if (saved !== null && /^(?:100|[1-9]?\d)$/.test(saved)) volume.value = saved;
  } catch {}
  el("output").textContent = volume.value + " %";
  volume.onchange = () => {
    try { localStorage.setItem(volumeKey, volume.value); } catch {}
  };
  const queueDetails = el(".music-queue"), queueList = el("ol");
  const form = el("form"), add = el('[type="submit"]'), file = el('[type="file"]');
  const link = el("[data-link] input"), name = el("[data-name] input");
  const genres = [...new Set(radioStations.map(station => station.genre))].sort((a, b) => a.localeCompare(b, "es"));
  const activeChoice = name => el('input[name="music-' + name + '"]:checked');
  function choice(name, value, text, selected) {
    const label = document.createElement("label");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "music-" + name;
    input.value = value;
    input.defaultChecked = selected;
    input.checked = selected;
    const caption = document.createElement("span");
    caption.textContent = text;
    label.append(input, caption);
    return label;
  }
  el(".genre-options").replaceChildren(...["", ...genres].map(value => choice("genre",value,value || "Todos",!value)));
  function listStations() {
    const previous = activeChoice("station")?.value;
    const matches = stationsForGenre(activeChoice("genre")?.value || "");
    const selected = matches.some(item => item.id === previous) ? previous : matches[0]?.id;
    el(".station-options").replaceChildren(...matches.map(station => {
      const row = choice("station",station.id,station.name,station.id === selected);
      row.dataset.stationId = station.id;
      const genre = document.createElement("small");
      genre.textContent = station.genre;
      row.lastChild.append(genre);
      return row;
    }));
  }
  listStations();
  el(".genre-options").onchange = listStations;
  let room = null, track = null, clockOffset = 0, optedIn = false;
  let release = null, setPlayerVolume = null, syncPlayer = null, delivery = null, skipId = null, lastQueue = "";
  let upload, personalStation = null;
  const muteKey = "squadlink.music.muted";
  let locallyMuted = false;
  try { locallyMuted = localStorage.getItem(muteKey) === "true"; } catch {}
  function setLocalListening(enabled) {
    optedIn = enabled;
    locallyMuted = !enabled;
    try { localStorage.setItem(muteKey, String(locallyMuted)); } catch {}
    drawListening();
  }
  const position = () => roomPosition(room?.music?.startedAt, clockOffset);
  const post = (action, data) => api("music/" + action, data);
  function feedback(text) { notice.textContent = text; }
  function stopPlayer() {
    release?.();
    release = setPlayerVolume = syncPlayer = delivery = null;
    player.replaceChildren();
  }
  const shortcutLabel = /Mac/i.test(navigator.platform) ? "⌥ ⇧ R" : "Alt + Mayús + R";
  listen.querySelector("kbd").textContent = shortcutLabel;
  listen.title = "Silenciar o reanudar solo en este equipo (" + shortcutLabel + ")";
  function drawListening() {
    listen.setAttribute("aria-pressed", String(optedIn));
    listen.querySelector("[data-listen-label]").textContent = optedIn ? "Silenciar solo para mí" : "Escuchar aquí";
    volumeLabel.hidden = !optedIn;
  }
  function setupPlayer() {
    stopPlayer();
    feedback("");
    if (!track || !optedIn) return;
    const item = track, code = room.code;
    const token = {};
    delivery = token;
    const active = () => delivery === token;
    let sentEnd = false;
    async function ended() {
      if (!active() || skipId === item.id || sentEnd) return;
      sentEnd = true;
      try { await post("ended", {room: code, id: item.id}); }
      catch (error) { if (active()) { sentEnd = false; feedback(error.message); } }
    }
    if (item.kind === "youtube" && videoPattern.test(item.videoId || "")) {
      const frame = document.createElement("iframe");
      const url = new URL(location.protocol === "squad:" ? desktopWidget : "/music-youtube.html", location.href);
      url.searchParams.set("video", item.videoId);
      frame.title = "Reproductor de YouTube · " + item.title;
      frame.allow = "autoplay; encrypted-media; fullscreen; picture-in-picture";
      frame.allowFullscreen = true;
      frame.referrerPolicy = "strict-origin-when-cross-origin";
      frame.onload = () => frame.contentWindow?.postMessage({channel: widgetChannel, action: "connect"}, url.origin);
      frame.src = url.href;
      let ready = false, visible = false, sentDuration = false;
      const send = (action, values = {}) => {
        if (ready) frame.contentWindow?.postMessage({channel: widgetChannel, action, ...values}, url.origin);
      };
      const canPlay = () => visible && !document.hidden;
      function visibility() {
        if (canPlay()) send("play", {position: position(), volume: Number(volume.value)});
        else send("pause");
      }
      const observer = new IntersectionObserver(entries => {
        if (!active()) return;
        const entry = entries[entries.length - 1];
        visible = entry.isIntersecting && entry.intersectionRatio >= 0.5;
        visibility();
      }, {threshold: [0, 0.5]});
      const timeout = setTimeout(() => {
        if (active() && !ready) feedback("YouTube no respondió. Puedes pasar a la siguiente pista.");
      }, 15000);
      function onMessage(event) {
        const data = event.data;
        if (!active() || event.origin !== url.origin || event.source !== frame.contentWindow || data?.channel !== widgetChannel) return;
        switch (data.action) {
          case "ready": ready = true; clearTimeout(timeout); feedback(""); visibility(); break;
          case "ended": ended(); break;
          case "blocked": feedback("Pulsa reproducir en el video para escuchar."); break;
          case "playing": feedback(""); break;
          case "unavailable": clearTimeout(timeout); feedback("Este video no admite reproducción aquí. Puedes pasar a la siguiente pista."); break;
          case "duration":
            if (!sentDuration && !item.duration && Number.isFinite(data.seconds) && data.seconds > 0) {
              sentDuration = true;
              post("duration", {room: code, id: item.id, duration: data.seconds}).catch(() => { sentDuration = false; });
            }
            break;
        }
      }
      window.addEventListener("message", onMessage);
      document.addEventListener("visibilitychange", visibility);
      setPlayerVolume = () => send("volume", {volume: Number(volume.value)});
      syncPlayer = () => { if (canPlay()) send("sync", {position: position()}); };
      release = () => {
        clearTimeout(timeout);
        observer.disconnect();
        window.removeEventListener("message", onMessage);
        document.removeEventListener("visibilitychange", visibility);
      };
      player.append(frame);
      observer.observe(frame);
      return;
    }
    const live = item.kind === "radio";
    const station = live && stationById(item.stationId);
    if (live ? !station : item.kind !== "file") {
      feedback("Esta pista ya no está disponible. Puedes pasar a la siguiente.");
      return;
    }
    const audio = document.createElement("audio");
    const retry = document.createElement("button");
    retry.type = "button";
    retry.className = "secondary small";
    retry.hidden = true;
    audio.preload = "auto";
    audio.volume = Number(volume.value) / 100;
    const src = live ? station.url : "/api/music/file?" + new URLSearchParams({room: code, id: item.id});
    let reconnect = false, stallTimer, retryTimer;
    let hasPlayed = false, recoveryUsed = false, playAttempt = 0;
    function awaitRadio() {
      if (!live || !active() || stallTimer || retryTimer) return;
      feedback("Conectando con la emisora…");
      stallTimer = setTimeout(unavailable, 15000);
    }
    function playing() {
      if (!active()) return;
      clearTimeout(stallTimer);
      clearTimeout(retryTimer);
      stallTimer = retryTimer = undefined;
      hasPlayed = true;
      reconnect = false;
      retry.hidden = true;
      feedback("");
    }
    function unavailable() {
      if (!active()) return;
      clearTimeout(stallTimer);
      stallTimer = undefined;
      if (live && retryTimer) return;
      if (live && hasPlayed && !recoveryUsed) {
        recoveryUsed = true;
        feedback("Se cortó la radio. Reconectando…");
        retryTimer = setTimeout(() => {
          retryTimer = undefined;
          if (!active()) return;
          audio.load();
          void play();
        }, 1000);
        return;
      }
      reconnect = true;
      retry.textContent = "Reintentar";
      retry.hidden = false;
      feedback(live ? "No se pudo conectar con la emisora. Reintenta o pasa a la siguiente pista."
        : "No se pudo reproducir el archivo. Reintenta o pasa a la siguiente pista.");
    }
    function syncFile() {
      if (!audio.readyState || !Number.isFinite(audio.duration)) return;
      const target = Math.min(position(), audio.duration);
      if (Math.abs(audio.currentTime - target) > 2) audio.currentTime = target;
    }
    async function play() {
      if (!active()) return;
      const attempt = ++playAttempt;
      if (live) awaitRadio();
      else syncFile();
      try {
        await audio.play();
        if (attempt === playAttempt) playing();
      } catch (error) {
        if (!active() || attempt !== playAttempt || error.name === "AbortError") return;
        if (error.name !== "NotAllowedError") { unavailable(); return; }
        clearTimeout(stallTimer);
        stallTimer = undefined;
        reconnect = false;
        retry.textContent = "Reproducir";
        retry.hidden = false;
        feedback("Pulsa Reproducir para escuchar la música.");
      }
    }
    retry.onclick = () => {
      retry.hidden = true;
      if (reconnect) { reconnect = false; audio.load(); }
      play();
    };
    // A radio may disconnect locally. Only the shared room timer or Siguiente ends its turn.
    audio.onended = live ? unavailable : ended;
    audio.onerror = unavailable;
    audio.onplaying = playing;
    if (live) audio.onwaiting = awaitRadio;
    if (!live) { syncPlayer = syncFile; audio.onloadedmetadata = syncFile; }
    audio.src = src;
    setPlayerVolume = () => { audio.volume = Number(volume.value) / 100; };
    release = () => {
      clearTimeout(retryTimer);
      clearTimeout(stallTimer);
      audio.onwaiting = audio.onplaying = audio.onended = audio.onloadedmetadata = audio.onerror = null;
      audio.pause();
      audio.removeAttribute("src");
      audio.load();
    };
    player.append(audio, retry);
    play();
  }

  listen.onclick = () => {
    if (!track && !optedIn) {
      el(".music-add").open = true;
      if (activeChoice("source").value === "file") file.focus();
      else if (activeChoice("source").value === "youtube") link.focus();
      else activeChoice("station")?.focus();
      return;
    }
    setLocalListening(!optedIn);
    setupPlayer();
  };
  function playPersonal(station) {
    const same = personalStation?.stationId === station.id;
    personalStation = {id:"personal/" + station.id, stationId:station.id, kind:"radio", title:station.name};
    setLocalListening(true);
    update(room);
    if (same) setupPlayer();
    el(".music-add").open = false;
  }
  el("[data-personal]").onclick = () => {
    const station = radioStations.find(item => item.id === activeChoice("station")?.value);
    if (room && station) playPersonal(station);
  };
  el("[data-shared]").onclick = () => {
    personalStation = null;
    update(room);
  };
  volume.oninput = () => {
    el("output").textContent = volume.value + " %";
    setPlayerVolume?.();
  };
  next.onclick = async () => {
    if (!room || !track || skipId) return;
    const id = track.id, code = room.code;
    skipId = id;
    next.disabled = true;
    try { await post("next", {room: code, id}); }
    catch (error) {
      if (room?.code === code && skipId === id) {
        skipId = null; next.disabled = false; feedback(error.message);
      }
    }
  };
  function selectSource() {
    const source = activeChoice("source").value;
    const isFile = source === "file", isRadio = source === "radio", isVideo = source === "youtube";
    link.disabled = name.disabled = !isVideo; link.required = isVideo;
    el("[data-link]").hidden = el("[data-name]").hidden = !isVideo;
    file.disabled = !isFile; file.required = isFile;
    el(".genre-picker").disabled = el(".station-picker").disabled = !isRadio;
    for (const field of mount.querySelectorAll("[data-radio]")) field.hidden = !isRadio;
    el("[data-file]").hidden = !isFile;
  }
  el(".source-options").onchange = selectSource;
  form.onsubmit = async event => {
    event.preventDefault();
    if (!room || upload) return;
    const controller = new AbortController(), code = room.code;
    upload = controller;
    add.disabled = true;
    try {
      if (activeChoice("source").value === "file") {
        const chosen = file.files?.[0];
        if (!chosen?.size || chosen.size > maxFileBytes) throw Error("Elige un archivo de audio de hasta 20 MiB.");
        const duration = await fileDuration(chosen, controller.signal);
        const params = new URLSearchParams({room: code, title: chosen.name.replace(/\.[^.]+$/, "").slice(0, 80) || "Audio", duration: String(duration)});
        const response = await fetch("/api/music/upload?" + params, {
          method: "POST", body: chosen, signal: controller.signal,
          headers: {"Content-Type": chosen.type || "application/octet-stream"}
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          throw Error(body.error || "No se pudo añadir el archivo.");
        }
      } else if (activeChoice("source").value === "youtube") {
        const videoId = youtubeId(link.value);
        if (!videoId) throw Error("Ingresa el enlace de un video de YouTube.");
        await api("music/add", {room:code, videoId, title:name.value.trim() || "YouTube · " + videoId}, controller.signal);
        if (upload !== controller) return;
        link.value = name.value = "";
      } else {
        const stationId = activeChoice("station")?.value;
        const station = radioStations.find(item => item.id === stationId);
        if (!station) throw Error("Selecciona una emisora.");
        const startListening = !room.music?.queue?.length && !personalStation;
        try {
          await api("music/add", {room:code, stationId}, controller.signal);
        } catch (error) {
          if (upload !== controller) return;
          if (error.status !== 400 || !/YouTube|Selecciona una emisora del catálogo/i.test(error.message)) throw error;
          if (startListening && !locallyMuted) {
            playPersonal(station);
            notify?.("Escuchando solo aquí. El servidor de esta sala todavía no admite emisoras compartidas.");
          } else {
            feedback("Esta sala aún no admite emisoras compartidas. Elige «Escuchar solo aquí» para reproducirla.");
          }
          return;
        }
        if (upload !== controller) return;
        if (startListening && !locallyMuted && !optedIn) {
          optedIn = true;
          drawListening();
          setupPlayer();
        }
      }
      if (upload !== controller) return;
      file.value = "";
      el(".music-add").open = false;
      notify?.("Pista añadida a la cola.");
    } catch (error) {
      if (upload === controller) feedback(error.message || "No se pudo añadir la pista.");
    } finally {
      if (upload === controller) { upload = null; add.disabled = false; }
    }
  };
  function close() {
    room = track = personalStation = null;
    optedIn = false;
    skipId = null;
    upload?.abort(); upload = null;
    stopPlayer();
    add.disabled = next.disabled = false;
    lastQueue = "";
    queueList.replaceChildren();
    current.hidden = queueDetails.hidden = el(".music-empty").hidden = true;
    queueDetails.open = el(".music-add").open = false;
    form.reset(); listStations(); selectSource(); drawListening(); feedback("");
  }
  function update(snapshot) {
    if (!snapshot) { close(); return; }
    if (room && room.code !== snapshot.code) close();
    const music = snapshot.music;
    const queue = Array.isArray(music?.queue) ? music.queue : [];
    const currentTrack = personalStation || queue[0] || null;
    const changed = track?.id !== currentTrack?.id;
    room = snapshot;
    if (Number.isFinite(music?.serverNow)) clockOffset = music.serverNow - Date.now();
    track = currentTrack;
    next.hidden = Boolean(personalStation);
    el("[data-shared]").hidden = !personalStation;
    current.hidden = !track;
    el(".music-empty").hidden = Boolean(track);
    title.textContent = track?.title || "";
    el("[data-kind]").textContent = personalStation ? "Radio en directo · Solo aquí" : track?.kind === "radio" ? "Radio en directo" : track?.kind === "youtube" ? "YouTube" : "Archivo de audio";
    const waiting = personalStation ? queue : queue.slice(1);
    const key = JSON.stringify(waiting.map(item => [item.id, item.title]));
    if (key !== lastQueue) {
      lastQueue = key;
      queueDetails.hidden = !waiting.length;
      queueDetails.querySelector("summary").textContent = "En cola (" + waiting.length + ")";
      queueList.replaceChildren(...waiting.map(item => {
        const row = document.createElement("li"); row.textContent = item.title; return row;
      }));
    }
    if (changed) {
      skipId = null; next.disabled = false;
      setupPlayer();
    } else syncPlayer?.();
  }
  function toggleFromShortcut() {
    if (!room) return;
    if (!track && !optedIn) { notify?.("No hay música en reproducción."); return; }
    setLocalListening(!optedIn);
    setupPlayer();
    notify?.(optedIn ? "Música activada en este equipo." : "Música silenciada solo para ti.");
  }
  return {update, close, toggleFromShortcut};
}

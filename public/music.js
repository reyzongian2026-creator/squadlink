const videoPattern = /^[\w-]{11}$/;
const widgetChannel = "squadlink:music";
const desktopWidget = "https://squadlink-lobby.onrender.com/music-youtube.html";
const maxFileBytes = 20 * 1024 * 1024;

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
      <header class="music-header"><h3 id="music-heading">Música de sala</h3><button type="button" data-listen class="secondary small" aria-pressed="false">Escuchar</button></header>
      <div class="music-current" hidden><strong data-title></strong><button type="button" data-next class="secondary small">Siguiente</button></div>
      <div data-player></div>
      <label class="music-volume" hidden>Volumen de música <input type="range" min="0" max="100" value="60" aria-label="Volumen de música"><output>60 %</output></label>
      <p class="music-empty" hidden>La cola está vacía.</p>
      <p class="music-notice" role="status"></p>
      <details class="music-queue" hidden><summary>Cola de reproducción</summary><ol></ol></details>
      <details class="music-add"><summary>Añadir música</summary><form>
        <label>Fuente<select data-source><option value="youtube">YouTube</option><option value="file">Archivo de audio</option></select></label>
        <label data-link>Enlace de YouTube<input type="url" placeholder="https://youtu.be/…" required></label>
        <label data-name>Título (opcional)<input maxlength="80" autocomplete="off"></label>
        <label data-file hidden>Archivo de audio (hasta 20 MiB)<input type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac,.webm" disabled></label>
        <button class="primary" type="submit">Añadir a la cola</button>
      </form></details>
    </section>`;
  const el = selector => mount.querySelector(selector);
  const listen = el("[data-listen]"), current = el(".music-current"), next = el("[data-next]");
  const player = el("[data-player]"), title = el("[data-title]"), notice = el(".music-notice");
  const volume = el('input[type="range"]'), volumeLabel = el(".music-volume");
  const queueDetails = el(".music-queue"), queueList = el("ol");
  const form = el("form"), add = el('[type="submit"]'), source = el("[data-source]");
  const link = el("[data-link] input"), name = el("[data-name] input"), file = el('[type="file"]');
  let room = null, track = null, clockOffset = 0, optedIn = false;
  let release = null, setPlayerVolume = null, syncPlayer = null, delivery = null, skipId = null, lastQueue = "";
  let upload;
  const position = () => roomPosition(room?.music?.startedAt, clockOffset);
  const post = (action, data) => api("music/" + action, data);
  function feedback(text) { notice.textContent = text; }
  function stopPlayer() {
    release?.();
    release = setPlayerVolume = syncPlayer = delivery = null;
    player.replaceChildren();
  }
  function drawListening() {
    listen.setAttribute("aria-pressed", String(optedIn));
    listen.textContent = optedIn ? "Dejar de escuchar" : "Escuchar";
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
    if (item.kind === "file") {
      const audio = document.createElement("audio");
      audio.preload = "auto";
      audio.volume = Number(volume.value) / 100;
      const sync = () => {
        if (!audio.readyState || !Number.isFinite(audio.duration)) return;
        const target = Math.min(position(), audio.duration);
        if (Math.abs(audio.currentTime - target) > 2) audio.currentTime = target;
      };
      async function play() {
        sync();
        try { await audio.play(); if (active()) feedback(""); }
        catch (error) {
          if (active() && error.name !== "AbortError") {
            feedback("Pulsa Reproducir para escuchar la música.");
            retry.hidden = false;
          }
        }
      }
      const retry = document.createElement("button");
      retry.type = "button";
      retry.className = "secondary small";
      retry.hidden = true;
      retry.textContent = "Reproducir";
      retry.onclick = () => { retry.hidden = true; play(); };
      audio.onloadedmetadata = play;
      audio.onended = ended;
      audio.onerror = () => feedback("Audio no disponible. Puedes pasar a la siguiente pista.");
      audio.src = "/api/music/file?" + new URLSearchParams({room: code, id: item.id});
      setPlayerVolume = () => { audio.volume = Number(volume.value) / 100; };
      syncPlayer = sync;
      release = () => {
        audio.onended = audio.onloadedmetadata = audio.onerror = null;
        audio.pause();
        audio.removeAttribute("src");
        audio.load();
      };
      player.append(audio, retry);
      return;
    }
    if (item.kind !== "youtube" || !videoPattern.test(item.videoId || "")) {
      feedback("Esta pista no está disponible.");
      return;
    }
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
  }

  listen.onclick = () => {
    optedIn = !optedIn;
    drawListening();
    setupPlayer();
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
    const isFile = source.value === "file";
    file.disabled = !isFile; file.required = isFile;
    link.disabled = name.disabled = isFile; link.required = !isFile;
    el("[data-file]").hidden = !isFile;
    el("[data-link]").hidden = el("[data-name]").hidden = isFile;
  }
  source.onchange = selectSource;
  form.onsubmit = async event => {
    event.preventDefault();
    if (!room || upload) return;
    const controller = new AbortController(), code = room.code;
    upload = controller;
    add.disabled = true;
    try {
      if (source.value === "file") {
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
      } else {
        const videoId = youtubeId(link.value);
        if (!videoId) throw Error("Ingresa el enlace de un video de YouTube.");
        await api("music/add", {room: code, videoId, title: name.value.trim() || "YouTube · " + videoId}, controller.signal);
      }
      if (upload !== controller) return;
      form.reset(); selectSource();
      el(".music-add").open = false;
      notify?.("Pista añadida a la cola.");
    } catch (error) {
      if (upload === controller) feedback(error.message || "No se pudo añadir la pista.");
    } finally {
      if (upload === controller) { upload = null; add.disabled = false; }
    }
  };
  function close() {
    room = track = null;
    optedIn = false;
    skipId = null;
    upload?.abort(); upload = null;
    stopPlayer();
    add.disabled = next.disabled = false;
    lastQueue = "";
    queueList.replaceChildren();
    current.hidden = queueDetails.hidden = el(".music-empty").hidden = true;
    queueDetails.open = el(".music-add").open = false;
    form.reset(); selectSource(); drawListening(); feedback("");
  }
  function update(snapshot) {
    if (!snapshot) { close(); return; }
    if (room && room.code !== snapshot.code) close();
    const music = snapshot.music;
    const queue = Array.isArray(music?.queue) ? music.queue : [];
    const changed = track?.id !== queue[0]?.id;
    room = snapshot;
    if (Number.isFinite(music?.serverNow)) clockOffset = music.serverNow - Date.now();
    track = queue[0] || null;
    current.hidden = !track;
    el(".music-empty").hidden = Boolean(track);
    title.textContent = track?.title || "";
    const waiting = queue.slice(1);
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
  return {update, close};
}

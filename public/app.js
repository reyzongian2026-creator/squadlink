import {mountPlayerPass} from "./player-pass.js";
import { readMemberVolumes, saveMemberVolume } from "./member-volumes.js";
import { bindVoiceDiagnostics } from "./connection.js";
import { mountDirectory } from "./directory.js";
const $ = (id) => document.getElementById(id);
const paths = {
  player: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M4 21a8 8 0 0 1 16 0",
  guide: "M4 4h6l2 2 2-2h6v15h-6l-2 2-2-2H4z M12 6v15",
  directory: "M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  search: "M10 3a7 7 0 1 0 .01 0 M15 15l6 6",
  refresh: "M20 5v5h-5 M4 19v-5h5 M20 10a8 8 0 0 0-14-4 M4 14a8 8 0 0 0 14 4",
  friends:
    "M3 21v-2a5 5 0 0 1 10 0v2 M8 4a4 4 0 1 0 .01 0 M16 5a3 3 0 1 1 0 6 M16 14a5 5 0 0 1 5 5v2",
  copy: "M8 8h12v13H8z M4 16V3h12",
  lobby: "M3 4h7v7H3z M14 4h7v7h-7z M3 15h7v6H3z M14 15h7v6h-7z",
  game: "M7 7h10c3 0 4 3 5 9 .4 3-2 4-4 2l-3-3H9l-3 3c-2 2-4.4 1-4-2 1-6 2-9 5-9z M7 9v4 M5 11h4 M16 10h.1 M19 12h.1",
  signal: "M3 18v2 M8 13v7 M13 8v12 M18 4v16",
  headphones:
    "M3 14v-2a9 9 0 0 1 18 0v2 M3 12h4v8H5a2 2 0 0 1-2-2z M21 12h-4v8h2a2 2 0 0 0 2-2z",
  plus: "M12 5v14 M5 12h14",
  enter: "M13 4h7v16h-7 M3 12h12 M10 7l5 5-5 5",
  play: "M8 5l11 7-11 7z",
  key: "M14 13a5 5 0 1 0-4-4l-7 7v5h5v-3h3v-3z M16 8h.1",
  focus: "M8 3H3v5 M16 3h5v5 M21 16v5h-5 M8 21H3v-5 M8 12h8",
};
for (const el of document.querySelectorAll("[data-icon]")) {
  el.setAttribute("aria-hidden", "true");
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  for (const [name, value] of Object.entries({
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "1.8",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  }))
    svg.setAttribute(name, value);
  const path = document.createElementNS(ns, "path");
  path.setAttribute("d", paths[el.dataset.icon]);
  svg.append(path);
  el.append(svg);
}

let self,
  room,
  stream,
  voice,
  microphone = false,
  microphoneUpdate = Promise.resolve(),
  mode,
  cleanupGame,
  toastTimer,
  generation = 0,
  gameRequest = 0;
const desktopClient = Boolean(document.querySelector('script[src="/desktop.js"]'));
let deviceRestoreBlocked = false;
const playerPass = mountPlayerPass({
  getSelf: () => self,
  tell,
  signedIn: async nick => {
    await identityReady;
    deviceRestoreBlocked = false;
    const result = await api("session", {nick});
    applySession(result);
    if (mode === "profile") $("entry").close();
  },
});
// Windows owns the room directory and refreshes it only when visible.
const directory = desktopClient && !window.squadBridge ? { reload() {}, draw() {} } : mountDirectory({
  api,
  getRoom: () => room,
  visitCurrent: showCurrentRoom,
  join: (code) => openEntry("join", { code }),
  create: () => openEntry("create", { published: true }),
});
let loadout, loadoutImport;
function prepareLoadout() {
  if (!loadoutImport)
    loadoutImport = import("./progression.js")
      .then(({ mountLoadout }) => {
        loadout = mountLoadout({
          api,
          getSelf: () => self,
          getRoom: () => room,
          getSocialId: () => $("friend-id").textContent,
          tell,
        });
        return loadout;
      })
      .catch((error) => {
        loadoutImport = null;
        throw error;
      });
  return loadoutImport;
}
function refreshLoadout() {
  return prepareLoadout()
    .then((controller) => controller.refresh())
    .catch(() => {
      if (!$("loadout").childElementCount)
        $("loadout").textContent = "No se pudo cargar el perfil de jugador.";
    });
}
let social, socialImport;
async function setupSocial() {
  if (!socialImport)
    socialImport = import("./social.js")
      .then(({ createSocial }) => {
        social = createSocial({
          api,
          tell,
          copy,
          enterRoom,
          onUnauthorized: checkExpiredSession,
          getRoom: () => room,
        });
        return social;
      })
      .catch((error) => {
        socialImport = null;
        throw error;
      });
  const client = await socialImport;
  await client.connect();
  playerPass.remember();
  if (!desktopClient || loadoutImport) refreshLoadout();
}
function startSocial() {
  setupSocial().catch((error) => {
    $("social-status").textContent = error.message;
    $("social-retry").hidden = false;
  });
}
$("social-retry").onclick = startSocial;
$("social-login").onclick = $("profile").onclick = () => openEntry("profile");
$("edit-room-fields").onclick = () => openEntry("edit");
$("copy-match-code").onclick = () =>
  copy(room.directory.gameCode, "Código de partida copiado.");
let audioMount;
$("audio-panel").ontoggle = () => {
  if (!$("audio-panel").open || audioMount) return;
  audioMount = import("./audio-settings.js")
    .then(({ mountAudioSettings }) =>
      mountAudioSettings($("audio-settings"), () => voice, tell),
    )
    .catch(() => {
      audioMount = null;
      tell("No se pudieron cargar los ajustes de audio.");
    });
};
const peerStates = new Map();
let volumes = readMemberVolumes();
const invited = new URLSearchParams(location.search).get("room") || "";
function readNick() {
  try {
    return localStorage.getItem("squadlink.nick") || "";
  } catch {
    return "";
  }
}
function showGuest(nick) {
  $("profile").textContent = nick || "Invitado";
  $("profile").title = nick ? "Editar mi apodo" : "Elegir mi apodo";
  $("profile").setAttribute("aria-label", $("profile").textContent + " · " + $("profile").title);
  $("avatar").textContent = [...(nick || "S")][0].toUpperCase();
}
let confirmedGuest = false;
let guestListener;
export function onConfirmedGuest(listener) {
  guestListener = listener;
  if (confirmedGuest) listener();
}
function markGuest() {
  if (confirmedGuest && !self && !room) return;
  if (room) resetRoom();
  self = null;
  social?.clearSession();
  showGuest(readNick());
  confirmedGuest = true;
  guestListener?.();
}
async function checkExpiredSession() {
  const player = self;
  if (!player) return;
  try { await api("session"); }
  catch (error) {
    if (error.status === 401 && self === player) markGuest();
  }
}
function applySession(result) {
  confirmedGuest = false;
  self = result.self;
  showGuest(self.nick);
  try {
    localStorage.setItem("squadlink.nick", self.nick);
  } catch {}
  startSocial();
}
function tell(message) {
  clearTimeout(toastTimer);
  $("feedback").textContent = message;
  $("feedback").hidden = false;
  toastTimer = setTimeout(() => {
    $("feedback").hidden = true;
  }, 4500);
}
async function api(path, data, signal) {
  let response;
  try {
    response = await fetch(
      "/api/" + path,
      data === undefined
        ? { cache: "no-store", signal }
        : {
            method: "POST",
            signal,
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(data),
          },
    );
  } catch {
    throw Error("No se pudo conectar al servidor. Revisa tu conexión.");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok)
    throw Object.assign(
      Error(body.error || "El servidor no pudo completar la solicitud."),
      { status: response.status },
    );
  return body;
}
function directoryFields() {
  return {
    published: $("directory-publish").checked,
    description: $("directory-description").value.trim(),
    game: $("directory-game").value.trim(),
    level: $("directory-level").value.trim(),
    gameCode: $("directory-game-code").value.trim(),
  };
}
function showCurrentRoom() {
  if (window.squadBridge) window.squadBridge.postMessage({type:"desktop:navigate", page:"lobby"});
  else location.hash = "main";
}

function openEntry(next, preset = {}) {
  if ((next === "create" || next === "join") && room) {
    showCurrentRoom();
    return;
  }
  mode = next;
  const edit = next === "edit",
    create = next === "create",
    join = next === "join";
  const fields = edit ? room.directory || {} : preset;
  $("entry-error").textContent = "";
  const titles = {
    create: "Crear sala",
    join: "Unirme a la sala",
    profile: "Mi apodo",
    edit: "Editar detalles",
  };
  $("entry-title").textContent = titles[next];
  $("submit-entry").textContent =
    edit || (next === "profile" && self)
      ? "Guardar cambios"
      : next === "profile"
        ? "Entrar con mi apodo"
        : titles[next];
  $("nickname").value = self?.nick || readNick();
  $("nickname-field").hidden = edit || (next !== "profile" && Boolean(self));
  $("nickname").disabled = $("nickname-field").hidden;
  $("player-pass").hidden = $("nickname-field").hidden;
  playerPass.show(Boolean(self || readNick()));
  $("name").value = "";
  $("name-field").hidden = !create;
  $("directory-fields").hidden = !create && !edit;
  $("directory-game").value = fields.game || "";
  $("directory-level").value = fields.level || "";
  $("directory-description").value = fields.description || "";
  $("directory-game-code").value = fields.gameCode || "";
  $("directory-publish").checked = (fields.published ?? create);
  $("code-field").hidden = !join;
  $("code").disabled = !join;
  $("code").required = join;
  $("code").value = join ? (preset.code || invited).toUpperCase() : "";
  $("password-field").hidden = !create && !join;
  $("password-hint").textContent = join ? "(si la sala la requiere)" : "(opcional)";
  $("password").value = "";
  $("entry").showModal();
  const first =
    next === "profile" || !$("nickname").value
      ? "nickname"
      : create
        ? "name"
        : edit
          ? "directory-game"
          : $("code").value
            ? "password"
            : "code";
  $(first).focus();
}
$("create").onclick = () => openEntry("create");
$("join").onclick = () => openEntry("join");
document.querySelectorAll("[data-dismiss]").forEach((button) => {
  button.onclick = () => button.dataset.dismiss === "game-dialog" ? closeGame() : $(button.dataset.dismiss).close();
});
$("entry-form").onsubmit = async (event) => {
  event.preventDefault();
  if ($("submit-entry").disabled) return;
  $("submit-entry").disabled = true;
  $("entry-error").textContent = "";
  try {
    if (mode === "edit") {
      const { room: updated } = await api("directory", directoryFields());
      updateRoom(updated);
      $("entry").close();
      directory.reload();
      return;
    }
    await identityReady;
    if (deviceRestoreBlocked) throw Error("Abre tu pase privado o desbloquea el almacén del equipo y vuelve a abrir Squadlink.");
    if (mode === "join" || mode === "create") {
      let current;
      try { current = await api("session"); }
      catch (error) { if (error.status !== 401) throw error; }
      if (current && self?.id !== current.self.id) applySession(current);
      if (current?.room) {
        $("entry").close();
        if (room?.code !== current.room.code) await enterRoom(current.room, true);
        showCurrentRoom();
        return;
      }
    }
    const nick = (mode !== "profile" && self ? self.nick : $("nickname").value.trim()) || self?.nick;
    if (!self || self.nick !== nick) {
      applySession(await api("session", { nick }));
    }
    if (mode === "profile") {
      $("entry").close();
      return;
    }
    const password = $("password").value;
    const creating = mode === "create";
    const payload = creating
      ? {
          name: $("name").value.trim() || "Lobby de " + self.nick,
          password,
          directory: directoryFields(),
        }
      : { code: $("code").value.trim().toUpperCase(), password };
    const result = await submitRoom(creating, nick, payload);
    $("entry").close();
    await enterRoom(result.room);
  } catch (error) {
    if ($("entry").open) $("entry-error").textContent = error.message;
    else tell(error.message);
  } finally {
    $("submit-entry").disabled = false;
  }
};
async function submitRoom(creating, nick, payload) {
  const endpoint = creating ? "rooms" : "join";
  try { return await api(endpoint, payload); }
  catch (error) {
    if (error.status !== 401) throw error;
    applySession(await api("session", { nick }));
    return api(endpoint, payload);
  }
}

export function desktopNickname() { return self?.nick || readNick(); }

export async function enterFromWindows(data) {
  await identityReady;
  if (room) throw Error("Ya estás en una sala.");
  const nick = data.nick || desktopNickname();
  if (!nick) throw Error("Escribe tu apodo para continuar.");
  if (!self || self.nick !== nick) applySession(await api("session", { nick }));
  const payload = data.creating
    ? {name: data.name || "Lobby de " + nick, password: data.password, directory: data.directory}
    : {code: data.code, password: data.password};
  const result = await submitRoom(data.creating, nick, payload);
  await enterRoom(result.room);
}

function renderMembers() {
  const fragment = document.createDocumentFragment();
  for (const member of room.members) {
    const li = document.createElement("li");
    const nick = document.createElement("strong");
    nick.textContent = member.nick + (member.id === self.id ? " (tú)" : "");
    if (window.squadBridge) {
      li.dataset.initials = member.nick.trim().split(/\s+/).slice(0,2).map(word=>[...word][0] || '').join('').toLocaleUpperCase('es');
      li.dataset.muted = String(member.muted);
    }
    const info = document.createElement("small");
    const state = peerStates.get(member.id);
    const suffix =
      state === "connected"
        ? " · Conectado"
        : ["disconnected", "failed"].includes(state)
          ? " · Sin conexión"
          : "";
    info.textContent =
      (member.muted ? "Micro apagado" : "Micro activo") + suffix;
    li.append(nick, info);
    if (member.joinedAt || member.game) {
      const activity = document.createElement("small");
      const clock = (time) =>
        new Date(time).toLocaleTimeString("es-PE", {
          hour: "2-digit",
          minute: "2-digit",
        });
      activity.textContent = [
        member.id === room.ownerId && "Anfitrión",
        !window.squadBridge && member.joinedAt && "En sala desde " + clock(member.joinedAt),
        member.game &&
          member.game + (member.since ? " desde " + clock(member.since) : ""),
      ]
        .filter(Boolean)
        .join(" · ");
      if (member.joinedAt) li.title = "En sala desde " + clock(member.joinedAt);
      if (activity.textContent) li.append(activity);
    }
    if (member.id !== self.id) {
      const slider = document.createElement("input");
      slider.type = "range";
      slider.min = "0";
      slider.max = "100";
      slider.value = String(volumes.get(member.id) ?? 100);
      slider.setAttribute("aria-label", "Volumen de " + member.nick);
      slider.oninput = () => {
        volumes.set(member.id, Number(slider.value));
        voice?.setVolume(member.id, Number(slider.value) / 100);
      };
      slider.onchange = () => saveMemberVolume(member.id, Number(slider.value));
      li.append(slider);
    }
    fragment.append(li);
  }
  if (!window.squadBridge && room.music?.queue?.length) {
    const bot = document.createElement('li');
    const name = document.createElement('strong'), playing = document.createElement('small');
    name.textContent = '♫ DJ Squadlink';
    playing.textContent = 'Bot de música · ' + room.music.queue[0].title;
    bot.dataset.musicBot = '';
    bot.append(name,playing);
    fragment.append(bot);
  }
  $("members").replaceChildren(fragment);
}
let roomMusicUI;
let leavingRoom = false;
let musicModule;
function toggleRoomRadio() {
  if (!room) return;
  roomMusicUI?.toggleFromShortcut();
}
window.squadBridge?.addEventListener('message', ({data}) => {
  if (data?.type === 'desktop:radio-toggle') toggleRoomRadio();
});
// Electron handles this in its main process, including when another app has focus.
if (!window.squadBridge) window.addEventListener('keydown', event => {
  if (!room || !event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.code !== 'KeyR') return;
  event.preventDefault();
  if (!event.repeat) toggleRoomRadio();
}, true);
function updateMusic() {
  if (leavingRoom) return;
  const attempt = generation;
  if (roomMusicUI) { roomMusicUI.update(room); return; }
  const currentCode = room.code;
  musicModule ??= import('./music.js').catch(error=>{ musicModule=null; throw error; });
  musicModule.then(({createMusic})=>{
    if (generation !== attempt || room?.code !== currentCode || roomMusicUI) return;
    roomMusicUI = createMusic({mount:$('room-music'),api,notify:tell});
    roomMusicUI.update(room);
  }).catch(()=>{ if(generation===attempt && room?.code===currentCode) $('room-music').textContent='No se pudo cargar la música.'; });
}
function updateRoom(snapshot) {
  const previousCode = room?.code;
  room = snapshot;
  updateMusic();
  $("room-name").textContent = room.name;
  const metadata = room.directory || {};
  for (const [id, value] of [
    ["room-description", metadata.description],
    ["room-game", metadata.game],
    ["room-level", metadata.level],
  ]) {
    $(id).textContent = value || "";
    $(id).hidden = !value;
  }
  $("room-published").textContent = metadata.published
    ? "En el directorio"
    : "Solo con invitación";
  $("private-match").hidden = !metadata.gameCode;
  $("match-code").textContent = metadata.gameCode || "";
  $("edit-room-fields").hidden = room.ownerId !== self.id;
  if (previousCode !== room.code) directory.draw();
  $("room-age").textContent = room.createdAt
    ? "Creada a las " +
      new Date(room.createdAt).toLocaleTimeString("es-PE", {
        hour: "2-digit",
        minute: "2-digit",
      })
    : "";
  social?.roomChanged();
  $("room-code").textContent = room.code;
  $("count").textContent = room.members.length + " / 5 jugadores";
  $("privacy").textContent = room.locked ? "Con clave" : "Acceso con código";
  renderMembers();
  voice?.syncMembers(room.members.map((member) => member.id));
}
function setConnection(text, connected) {
  $("connection").lastChild.textContent = text;
  $("connection").classList.toggle("connected", connected);
}
const retryRoomVoice = new WeakMap();
async function enterRoom(snapshot, restoring = false) {
  if (!desktopClient && !restoring && document.body.dataset.channel !== "main") location.hash = "main";
  resetRoom();
  const attempt = generation;
  $("room").hidden = false;
  $("home").hidden = true;
  audioStateChanged();
  setConnection("Conectando", false);
  updateRoom(snapshot);
  directory.reload();
  const pendingSignals = new Map();
  const listen = $("listen");
  let starting = false;
  async function startVoice() {
    if (generation !== attempt || starting || voice) return;
    starting = true;
    listen.disabled = true;
    $("voice-status").textContent = "Conectando el audio…";
    let channel;
    try {
      const [{ VoiceRoom }, { iceServers }] = await Promise.all([
        import("./voice.js"),
        api("ice", undefined, AbortSignal.timeout(10000)),
      ]);
      if (generation !== attempt) return;
      channel = new VoiceRoom({
        selfId: self.id,
        iceServers,
        sendSignal: (to, data) => api("signal", { to, ...data }),
        onStatus: (text) => {
          if (generation !== attempt || voice !== channel) return;
          $("voice-status").textContent = text;
          listen.hidden = false;
        },
        onMicrophoneEnded: () => {
          if (generation !== attempt || voice !== channel) return;
          $("voice-status").textContent = "El micrófono se desconectó. Conecta uno o elige otra entrada y vuelve a activarlo.";
          updateMicrophone(false).catch(error => {
            if (generation === attempt) tell(error.message);
          });
        },
        onPeerState: (id, state) => {
          if (generation !== attempt || voice !== channel) return;
          peerStates.set(id, state);
          renderMembers();
        },
      });
      for (const [id, percent] of volumes) channel.setVolume(id, percent / 100);
      channel.syncMembers(room.members.map(member => member.id));
      voice = channel;
      for (const [from, signals] of pendingSignals) {
        if (signals.description) channel.receive(from, {description:signals.description});
        for (const candidate of signals.candidates) channel.receive(from, {candidate});
      }
      pendingSignals.clear();
      listen.textContent = "Reanudar audio";
      listen.hidden = true;
      $("voice-status").textContent = "";
      $("mic").disabled = false;
    } catch (error) {
      if (generation !== attempt) return;
      channel?.close();
      voice = null;
      $("mic").disabled = true;
      $("voice-status").textContent = "No se pudo iniciar el audio. " + error.message;
      listen.textContent = "Reintentar conexión de voz";
      listen.hidden = false;
    } finally {
      if (generation === attempt) {
        starting = false;
        listen.disabled = false;
        audioStateChanged();
      }
    }
  }
  stream = new EventSource("/api/events");
  retryRoomVoice.set(stream, startVoice);
  const initialVoice = startVoice();
  stream.addEventListener("room", (event) => {
    if (attempt !== generation) return;
    updateRoom(JSON.parse(event.data));
    for (const id of pendingSignals.keys()) {
      if (!room.members.some(member => member.id === id)) pendingSignals.delete(id);
    }
    setConnection("En sala", true);
  });
  stream.addEventListener("signal", (event) => {
    if (attempt !== generation) return;
    const { from, ...data } = JSON.parse(event.data);
    if (voice) {
      voice.receive(from, data);
      return;
    }
    if (!room.members.some(member => member.id === from) || from === self.id) return;
    // ICE can arrive before the offer. Keep the latest negotiation per current peer.
    const signals = pendingSignals.get(from) || {candidates:[]};
    if (data.description) signals.description = data.description;
    if (data.candidate) {
      if (signals.candidates.length >= 128) signals.candidates.shift();
      signals.candidates.push(data.candidate);
    }
    pendingSignals.set(from, signals);
  });
  stream.addEventListener("superseded", () => {
    if (attempt !== generation) return;
    resetRoom();
    tell(
      "La sala se abrió en otra pestaña. El audio de esta ventana se cerró.",
    );
  });
  stream.onerror = async () => {
    if (attempt !== generation) return;
    setConnection("Reconectando", false);
    try {
      const result = await api("session");
      if (attempt === generation && !result.room) {
        resetRoom();
        tell("La sala ha terminado.");
      }
    } catch (error) {
      if (attempt === generation && error.status === 401) {
        markGuest();
        tell("La sesión terminó. Vuelve a entrar.");
      }
    }
  };
  if (
    snapshot.members.find((member) => member.id === self.id)?.muted === false
  ) {
    await api("member", { muted: true }).catch(() => {});
  }
  await initialVoice;
}
function audioStateChanged() {
  window.dispatchEvent(new window.Event('squadlink:audio-state'));
}
function closeRoomMedia() {
  generation++;
  stream?.close();
  stream = null;
  voice?.close();
  voice = null;
  roomMusicUI?.close();
  roomMusicUI = null;
  $('room-music').replaceChildren();
}
function resetRoom() {
  closeRoomMedia();
  leavingRoom = false;
  $("leave").disabled = false;
  room = null;
  $("match-code").textContent = $("directory-game-code").value = "";
  $("password").value = "";
  directory.draw();
  social?.roomChanged();
  microphone = false;
  microphoneUpdate = Promise.resolve();
  $("voice-measurements").replaceChildren();
  peerStates.clear();
  volumes = readMemberVolumes();
  $("mic").textContent = "Activar micrófono";
  $("mic").setAttribute("aria-pressed", "false");
  $("mic").disabled = true;
  $("listen").hidden = true;
  $("voice-status").textContent = "";
  $("room").hidden = true;
  audioStateChanged();
  $("home").hidden = false;
  document.body.classList.remove("in-match");
  $("compact").textContent = "Modo partida";
  $("compact").setAttribute("aria-pressed", "false");
  $("leave").textContent = "Salir de la sala";
  setConnection("Sin sala", false);
}
function updateMicrophone(enabled) {
  const current = voice;
  microphone = enabled;
  audioStateChanged();
  $("mic").textContent = enabled ? "Silenciar micrófono" : "Activar micrófono";
  $("mic").setAttribute("aria-pressed", String(enabled));
  // A device can disconnect while the previous presence update is in flight.
  microphoneUpdate = microphoneUpdate.catch(() => {}).then(() => {
    if (current === voice) return api("member", { muted: !enabled });
  });
  return microphoneUpdate;
}
$("mic").onclick = async () => {
  const current = voice;
  if (!current) return;
  $("mic").disabled = true;
  try {
    const requested = !microphone;
    $("voice-status").textContent = "";
    const enabled = await current.setMicrophone(requested);
    if (voice === current && enabled === requested) await updateMicrophone(enabled);
  } catch (error) {
    if (voice === current) $("voice-status").textContent = error.message;
  } finally {
    if (voice === current) $("mic").disabled = false;
  }
};
$("listen").onclick = () => {
  if (!voice) return retryRoomVoice.get(stream)?.();
  $("voice-status").textContent = "";
  return voice.resumePlayback();
};
$("leave").onclick = async () => {
  if (!room || $("leave").disabled) return;
  $("leave").disabled = true;
  leavingRoom = true;
  closeRoomMedia();
  const attempt = generation;
  audioStateChanged();
  microphone = false;
  $("mic").disabled = true;
  $("mic").textContent = "Micro apagado";
  $("mic").setAttribute("aria-pressed", "false");
  $("listen").hidden = true;
  $("voice-status").textContent = "Audio cerrado. Confirmando salida…";
  setConnection("Saliendo", false);
  try {
    await api("leave", {}, AbortSignal.timeout(8000));
  } catch (error) {
    if (attempt !== generation) return;
    if (error.status === 401) {
      markGuest();
      tell("Tu sesión terminó. Ya saliste de la sala.");
      return;
    }
    setConnection("Audio cerrado", false);
    $("voice-status").textContent =
      "El micrófono y la radio están apagados. Reintenta confirmar la salida cuando vuelva la conexión.";
    $("leave").textContent = "Reintentar salida";
    $("leave").disabled = false;
    return;
  }
  if (attempt !== generation) return;
  resetRoom();
  directory.reload();
  history.replaceState(null, "", location.pathname);
  $("create").focus();
};
$("compact").onclick = () => {
  const compact = document.body.classList.toggle("in-match");
  $("compact").textContent = compact ? "Volver al lobby" : "Modo partida";
  $("compact").setAttribute("aria-pressed", String(compact));
};
async function copy(value, notice) {
  try {
    await navigator.clipboard.writeText(value);
    tell(notice);
  } catch {
    window.prompt("Copia y comparte con tu grupo", value);
  }
}
$("copy").onclick = () => copy(room.code, "Código copiado.");
$("invite").onclick = () => {
  const link = new URL(location.pathname, window.squadBridge ? new URLSearchParams(location.search).get("server") : location.origin);
  link.searchParams.set("room", room.code);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(link.hostname);
  const notice = local
    ? "Enlace de prueba local. Para invitar desde otra PC, abre el lobby en su dirección HTTPS compartida."
    : "Enlace copiado. Comparte la clave por separado si la sala la pide.";
  copy(link.href, notice);
};
const gameFilters = [...document.querySelectorAll('[data-category]')];
for (const filter of gameFilters) {
  filter.onclick = () => {
    const category = filter.dataset.category;
    let count = 0;
    for (const card of document.querySelectorAll('.arcade-library .game-card')) {
      card.hidden = Boolean(category && card.dataset.genre !== category);
      if (!card.hidden) count++;
    }
    for (const option of gameFilters) option.setAttribute('aria-pressed', String(option === filter));
    document.querySelector('.arcade-count').textContent = count + (count === 1 ? ' juego' : ' juegos');
  };
}
for (const button of document.querySelectorAll("[data-game]")) {
  button.onclick = async () => {
    const request = ++gameRequest;
    $("game-title").textContent = button.querySelector("strong").textContent;
    $("game-mount").textContent = "Cargando juego…";
    $("game-dialog").showModal();
    try {
      const practice = button.hasAttribute('data-practice');
      const launch = practice ? (await import('./arcade-practice.js')).openPractice
        : (await import('./arcade.js')).openArcade;
      if (!practice && desktopClient) await openDesktopProgress();
      if (request === gameRequest && $("game-dialog").open)
        cleanupGame = launch(button.dataset.game, $("game-mount"), loadout);
    } catch {
      if (request === gameRequest)
        $("game-mount").textContent =
          "No se pudo abrir el juego. Cierra e inténtalo otra vez.";
    }
  };
}
const gameDialog = $("game-dialog");
function clearGame() {
  gameRequest++;
  cleanupGame?.();
  cleanupGame = null;
  $("game-mount").replaceChildren();
}
function closeGame() {
  if (!gameDialog.open) return;
  clearGame();
  gameDialog.close();
}
gameDialog.addEventListener('cancel', event => { event.preventDefault(); closeGame(); });
// A hidden Electron view can defer the native close event until its next paint.
new window.MutationObserver(() => {
  if (!gameDialog.open && $("game-mount").firstChild) clearGame();
}).observe(gameDialog, {attributes:true, attributeFilter:['open']});
window.addEventListener('pagehide', closeGame);
document.addEventListener('visibilitychange', () => {
  if (document.hidden && $("game-mount").querySelector('.doom-player')) closeGame();
});
function setupWebChannels() {
  const body = document.body;
  const toggle = $("channels-toggle");
  const links = [...$("channel-list").querySelectorAll("a")];
  const panels = [...document.querySelectorAll("[data-channel-panel]")];
  const titles = new Map(links.map(link => [link.hash.slice(1), link.textContent.trim()]));
  const narrow = window.matchMedia("(max-width: 760px)");

  function openMenu(open) {
    toggle.setAttribute("aria-expanded", String(open));
    body.classList.toggle("channels-open", open);
  }

  function selectChannel(moveFocus) {
    const fragment = location.hash.slice(1);
    const enclosingPanel = document.getElementById(fragment)?.closest("[data-channel-panel]");
    const channel = titles.has(fragment) ? fragment
      : enclosingPanel?.dataset.channelPanel.split(" ")[0] || (fragment.startsWith("kit-") ? "loadout" : "main");
    if (channel !== "main" && body.classList.contains("in-match")) $("compact").click();
    if (channel !== "arcade") closeGame();
    body.dataset.channel = channel;
    if (channel === "directory") directory.reload();
    for (const panel of panels) {
      panel.classList.toggle("channel-inactive", !panel.dataset.channelPanel.split(" ").includes(channel));
    }
    for (const link of links) {
      const active = link.hash === "#" + channel;
      link.classList.toggle("selected", active);
      if (active) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    }
    $("channel-title").textContent = titles.get(channel);
    document.title = titles.get(channel) + " · Squadlink";
    openMenu(false);
    if (moveFocus) {
      $("main").focus({preventScroll: true});
      window.scrollTo(0, 0);
    }
  }

  toggle.hidden = false;
  body.classList.add("web-client");
  selectChannel(false);
  toggle.addEventListener("click", () => openMenu(toggle.getAttribute("aria-expanded") !== "true"));
  window.addEventListener("hashchange", () => selectChannel(true));
  narrow.addEventListener("change", () => openMenu(false));
  for (const link of [...links, document.querySelector(".wordmark")]) {
    link.addEventListener("click", event => {
      if (!event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && link.hash === location.hash) {
        event.preventDefault();
        selectChannel(true);
      }
    });
  }
  document.querySelector(".skip").addEventListener("click", event => {
    event.preventDefault();
    openMenu(false);
    $("main").focus();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && body.classList.contains("channels-open")) {
      openMenu(false);
      toggle.focus();
    }
  });
}
if (!desktopClient) setupWebChannels();
async function restoreIdentity() {
  try { await playerPass.restoreDevice(); }
  catch (error) {
    // A locked keychain must not prevent signing in with an existing device key.
    if (!localStorage.getItem("squadlink.device.v1")) {
      deviceRestoreBlocked = true;
      throw Error("El respaldo del jugador no se pudo abrir. Puedes entrar con tu pase privado.");
    }
    tell("El respaldo automático del equipo no está disponible. Puedes guardar tu pase desde tu apodo.");
  }
  const nick = readNick();
  showGuest(nick);
  let result;
  try {
    result = await api("session");
  } catch (error) {
    if (error.status !== 401) throw error;
    if (nick) result = await api("session", { nick });
    else if (!self && !room) markGuest();
  }
  if (!result) return;
  applySession(result);
  if (result.room) await enterRoom(result.room, true);
}
export const identityReady = restoreIdentity().catch((error) => tell(error.message));
async function boot() {
  directory.reload();
  await identityReady;
  if (!self && !desktopClient) refreshLoadout();
  if (!self && !desktopClient && !invited && !location.hash && !$("entry").open) {
    try {
      if (!localStorage.getItem("squadlink.character.welcome")) {
        localStorage.setItem("squadlink.character.welcome", "1");
        location.hash = "loadout";
      }
    } catch {}
  }
  if (!room && /^[a-z0-9]{6}$/i.test(invited) && !$("entry").open)
    openEntry("join");
}
bindVoiceDiagnostics(
  () => voice,
  () => room?.members ?? [],
);
boot();

// The desktop host may release a guest renderer once restoration and room entry have settled.
export async function canReleaseGuestWorkspace() {
  await identityReady;
  return !self && !room && !$("submit-entry").disabled && !$("entry").open && !$("game-dialog").open;
}

let firstDesktopProgress;
export function openDesktopProgress() {
  if (!firstDesktopProgress) firstDesktopProgress = identityReady.then(refreshLoadout).finally(() => {
    if (!loadout) firstDesktopProgress = null;
  });
  return firstDesktopProgress;
}

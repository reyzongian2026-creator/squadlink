import { bindVoiceDiagnostics } from "./connection.js";
const $ = (id) => document.getElementById(id);
const paths = {
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
  mode,
  cleanupGame,
  toastTimer,
  generation = 0,
  gameRequest = 0;
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
}
function startSocial() {
  setupSocial().catch((error) => {
    $("social-status").textContent = error.message;
    $("social-retry").hidden = false;
  });
}
$("social-retry").onclick = startSocial;
$("social-login").onclick = () => openEntry("profile");
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
const volumes = new Map();
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
  $("avatar").textContent = [...(nick || "S")][0].toUpperCase();
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
        ? { cache: "no-store" }
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
function openEntry(next) {
  mode = next;
  $("entry-error").textContent = "";
  $("entry-title").textContent = $("submit-entry").textContent =
    next === "create"
      ? "Crear sala"
      : next === "join"
        ? "Unirme a la sala"
        : "Entrar con mi apodo";
  $("password-field").hidden = next === "profile";
  $("nickname").value = self?.nick || readNick();
  $("name").value = "";
  $("name-field").hidden = next !== "create";
  $("code-field").hidden = next !== "join";
  $("code").disabled = next !== "join";
  $("code").required = next === "join";
  $("code").value = next === "join" ? invited.toUpperCase() : "";
  $("password").value = "";
  $("entry").showModal();
  ($("nickname").value && next !== "profile"
    ? $(next === "create" ? "name" : "code")
    : $("nickname")
  ).focus();
}
$("create").onclick = () => openEntry("create");
$("join").onclick = () => openEntry("join");
document.querySelectorAll("[data-dismiss]").forEach((button) => {
  button.onclick = () => $(button.dataset.dismiss).close();
});
$("entry-form").onsubmit = async (event) => {
  event.preventDefault();
  if ($("submit-entry").disabled) return;
  $("submit-entry").disabled = true;
  $("entry-error").textContent = "";
  try {
    const login = await api("session", { nick: $("nickname").value.trim() });
    self = login.self;
    showGuest(self.nick);
    try {
      localStorage.setItem("squadlink.nick", self.nick);
    } catch {}
    startSocial();
    if (mode === "profile") {
      $("entry").close();
      return;
    }
    const password = $("password").value;
    const result =
      mode === "create"
        ? await api("rooms", {
            name: $("name").value.trim() || "Lobby de " + self.nick,
            password,
          })
        : await api("join", {
            code: $("code").value.trim().toUpperCase(),
            password,
          });
    $("entry").close();
    await enterRoom(result.room);
  } catch (error) {
    if ($("entry").open) $("entry-error").textContent = error.message;
    else tell(error.message);
  } finally {
    $("submit-entry").disabled = false;
  }
};
function renderMembers() {
  const fragment = document.createDocumentFragment();
  for (const member of room.members) {
    const li = document.createElement("li");
    const nick = document.createElement("strong");
    nick.textContent = member.nick + (member.id === self.id ? " (tú)" : "");
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
        member.joinedAt && "En sala desde " + clock(member.joinedAt),
        member.game &&
          member.game + (member.since ? " desde " + clock(member.since) : ""),
      ]
        .filter(Boolean)
        .join(" · ");
      li.append(activity);
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
      li.append(slider);
    }
    fragment.append(li);
  }
  $("members").replaceChildren(fragment);
}
function updateRoom(snapshot) {
  room = snapshot;
  $("room-name").textContent = room.name;
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
async function enterRoom(snapshot) {
  resetRoom();
  const attempt = generation;
  $("room").hidden = false;
  $("home").hidden = true;
  setConnection("Conectando", false);
  updateRoom(snapshot);
  try {
    const [{ VoiceRoom }, { iceServers }] = await Promise.all([
      import("./voice.js"),
      api("ice"),
    ]);
    if (generation !== attempt) return;
    voice = new VoiceRoom({
      selfId: self.id,
      iceServers,
      sendSignal: (to, data) => api("signal", { to, ...data }),
      onStatus: (text) => {
        $("voice-status").textContent = text;
        $("listen").hidden = false;
      },
      onPeerState: (id, state) => {
        if (room) {
          peerStates.set(id, state);
          renderMembers();
        }
      },
    });
    voice.syncMembers(snapshot.members.map((member) => member.id));
  } catch (error) {
    if (generation !== attempt) return;
    $("voice-status").textContent =
      "No se pudo iniciar el audio. " + error.message;
  }
  $("mic").disabled = !voice;
  stream = new EventSource("/api/events");
  stream.addEventListener("room", (event) => {
    updateRoom(JSON.parse(event.data));
    setConnection("En sala", true);
  });
  stream.addEventListener("signal", (event) => {
    const { from, ...data } = JSON.parse(event.data);
    voice?.receive(from, data);
  });
  stream.addEventListener("superseded", () => {
    resetRoom();
    tell(
      "La sala se abrió en otra pestaña. El audio de esta ventana se cerró.",
    );
  });
  stream.onerror = async () => {
    setConnection("Reconectando", false);
    try {
      const result = await api("session");
      if (attempt === generation && !result.room) {
        resetRoom();
        tell("La sala ha terminado.");
      }
    } catch (error) {
      if (attempt === generation && error.status === 401) {
        resetRoom();
        tell("La sesión terminó. Vuelve a entrar.");
      }
    }
  };
  if (
    snapshot.members.find((member) => member.id === self.id)?.muted === false
  ) {
    await api("member", { muted: true }).catch(() => {});
  }
}
function resetRoom() {
  generation++;
  stream?.close();
  stream = null;
  voice?.close();
  voice = null;
  room = null;
  social?.roomChanged();
  microphone = false;
  $("voice-measurements").replaceChildren();
  peerStates.clear();
  volumes.clear();
  $("mic").textContent = "Activar micrófono";
  $("mic").setAttribute("aria-pressed", "false");
  $("mic").disabled = true;
  $("listen").hidden = true;
  $("voice-status").textContent = "";
  $("room").hidden = true;
  $("home").hidden = false;
  document.body.classList.remove("in-match");
  $("compact").textContent = "Modo partida";
  $("leave").textContent = "Salir de la sala";
  setConnection("Sin sala", false);
}
$("mic").onclick = async () => {
  const current = voice;
  if (!current) return;
  $("mic").disabled = true;
  try {
    const enabled = await current.setMicrophone(!microphone);
    if (voice !== current) return;
    microphone = enabled;
    $("mic").textContent = microphone
      ? "Silenciar micrófono"
      : "Activar micrófono";
    $("mic").setAttribute("aria-pressed", String(microphone));
    $("voice-status").textContent = "";
    await api("member", { muted: !microphone });
  } catch (error) {
    if (voice === current) $("voice-status").textContent = error.message;
  } finally {
    if (voice === current) $("mic").disabled = false;
  }
};
$("listen").onclick = () => {
  $("voice-status").textContent = "";
  voice?.resumePlayback();
};
$("leave").onclick = async () => {
  $("leave").disabled = true;
  generation++;
  stream?.close();
  stream = null;
  voice?.close();
  voice = null;
  microphone = false;
  $("mic").disabled = true;
  $("mic").textContent = "Micro apagado";
  $("mic").setAttribute("aria-pressed", "false");
  $("listen").hidden = true;
  $("voice-status").textContent = "Audio cerrado. Confirmando salida…";
  setConnection("Saliendo", false);
  try {
    await api("leave", {}, AbortSignal.timeout(8000));
    resetRoom();
    history.replaceState(null, "", location.pathname);
    $("create").focus();
  } catch {
    setConnection("Audio cerrado", false);
    $("voice-status").textContent =
      "La voz está desconectada. Reintenta confirmar la salida cuando vuelva la conexión.";
    $("leave").textContent = "Reintentar salida";
  } finally {
    $("leave").disabled = false;
  }
};
$("compact").onclick = () => {
  const compact = document.body.classList.toggle("in-match");
  $("compact").textContent = compact ? "Volver al lobby" : "Modo partida";
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
  const link = new URL(location.pathname, location.origin);
  link.searchParams.set("room", room.code);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(link.hostname);
  const notice = local
    ? "Enlace de prueba local. Para invitar desde otra PC, abre el lobby en su dirección HTTPS compartida."
    : "Enlace copiado. Comparte la clave por separado si la sala la pide.";
  copy(link.href, notice);
};
for (const button of document.querySelectorAll("[data-game]")) {
  button.onclick = async () => {
    const request = ++gameRequest;
    $("game-title").textContent = button.querySelector("strong").textContent;
    $("game-mount").textContent = "Cargando juego…";
    $("game-dialog").showModal();
    try {
      const { openArcade } = await import("./arcade.js");
      if (request === gameRequest && $("game-dialog").open)
        cleanupGame = openArcade(button.dataset.game, $("game-mount"));
    } catch {
      if (request === gameRequest)
        $("game-mount").textContent =
          "No se pudo abrir el juego. Cierra e inténtalo otra vez.";
    }
  };
}
$("game-dialog").onclose = () => {
  gameRequest++;
  cleanupGame?.();
  cleanupGame = null;
  $("game-mount").replaceChildren();
};
for (const link of document.querySelectorAll("nav a"))
  link.onclick = () => {
    document
      .querySelectorAll("nav a")
      .forEach((item) => item.classList.toggle("selected", item === link));
  };
async function boot() {
  showGuest(readNick());
  try {
    const result = await api("session");
    self = result.self;
    showGuest(self.nick);
    startSocial();
    if (result.room) {
      await enterRoom(result.room);
      return;
    }
  } catch (error) {
    if (error.status !== 401) tell(error.message);
  }
  if (/^[a-z0-9]{6}$/i.test(invited) && !$("entry").open) openEntry("join");
}
bindVoiceDiagnostics(
  () => voice,
  () => room?.members ?? [],
);
boot();

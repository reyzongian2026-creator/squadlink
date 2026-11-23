const $ = (id) => document.getElementById(id);
const identityKey = "squadlink.device.v1";
const contactsKey = "squadlink.contacts.v1";
const friendId = /^[A-F0-9]{16}$/;
const secret = /^[a-f0-9]{64}$/;

function loadContacts() {
  const value = JSON.parse(localStorage.getItem(contactsKey) || "[]");
  return Array.isArray(value)
    ? value.filter(
        (item) => item && friendId.test(item.id) && secret.test(item.token),
      )
    : [];
}
function identity() {
  let key = localStorage.getItem(identityKey);
  if (!secret.test(key || "")) {
    key = Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) =>
      b.toString(16).padStart(2, "0"),
    ).join("");
    localStorage.setItem(identityKey, key);
  }
  return key;
}
function age(value) {
  if (!value) return "";
  const date = new Date(value);
  const today = new Date().toDateString() === date.toDateString();
  return (
    "desde " +
    date.toLocaleString(
      "es-PE",
      today
        ? { hour: "2-digit", minute: "2-digit" }
        : {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          },
    )
  );
}
function line(tag, value, className) {
  const element = document.createElement(tag);
  element.textContent = value;
  if (className) element.className = className;
  return element;
}

export function createSocial({ api, tell, copy, enterRoom, getRoom }) {
  let snapshot,
    connecting,
    timer,
    queue = Promise.resolve(),
    pulsePending = false;
  let bridgeReady = false,
    autoEnabled = false,
    detected = "",
    manual = "",
    detectionVersion = 0;
  const bridge = window.chrome?.webview;
  const roots = [
    "friends",
    "friend-requests",
    "room-requests",
    "room-admission",
  ];
  const signatures = new Map();
  function run(task) {
    const next = queue.then(task);
    queue = next.catch(() => {});
    return next;
  }
  function status(text) {
    $("social-status").textContent = text;
  }
  function action(label, name, id) {
    const button = line("button", label, "secondary small");
    button.type = "button";
    button.dataset.action = name;
    if (id) button.dataset.id = id;
    return button;
  }
  function row(title, info, buttons = [], online = undefined) {
    const box = document.createElement("div");
    box.className = "social-row";
    const copy = document.createElement("div");
    if (online !== undefined) {
      const dot = document.createElement("i");
      dot.className = online ? "dot online" : "dot";
      dot.setAttribute("aria-hidden", "true");
      copy.append(dot);
    }
    copy.append(line("strong", title));
    if (info) copy.append(line("p", info, "status"));
    box.append(copy);
    if (buttons.length) {
      const actions = document.createElement("div");
      actions.className = "row-actions";
      actions.setAttribute("role", "group");
      actions.setAttribute("aria-label", title);
      actions.append(...buttons);
      box.append(actions);
    }
    return box;
  }
  function refreshList(id, signature, build) {
    const value = JSON.stringify(signature);
    if (signatures.get(id) === value) return;
    signatures.set(id, value);
    $(id).replaceChildren(...build());
  }
  function draw() {
    if (!snapshot) return;
    const s = snapshot;
    $("friend-id").textContent = s.id;
    $("social-content").hidden = false;
    $("social-intro").hidden =
      $("social-login").hidden =
      $("social-retry").hidden =
        true;
    $("self-activity").textContent = s.game
      ? "Jugando " + s.game + " " + age(s.since)
      : "En línea " + age(s.onlineSince);
    $("auto-game").hidden = !bridgeReady;
    $("auto-game").setAttribute("aria-pressed", String(autoEnabled));
    $("auto-game").textContent = autoEnabled
      ? "Desactivar detección"
      : "Detectar juego en Windows";
    $("game-privacy").textContent = autoEnabled
      ? detected
        ? "Detección activa. Tus amigos y los participantes de tu sala pueden ver el juego detectado."
        : "Detección activa. Puedes indicar un juego manualmente para tus amigos y tu sala."
      : "Tus amigos y los participantes de tu sala pueden ver tu actividad.";
    const active = Boolean(getRoom());
    const sent = new Set(s.sentKnocks.map((item) => item.id));
    const approved = s.approvedRoom?.ownerId;
    refreshList("friends", [s.friends, s.sentKnocks, active, approved], () => {
      if (!s.friends.length)
        return [line("p", "Aún no tienes amigos. Comparte tu código o envía una solicitud.", "status")];
      return [...s.friends]
        .sort(
          (a, b) =>
            Number(b.online) - Number(a.online) || a.nick.localeCompare(b.nick),
        )
        .map((f) => {
          const state = f.online
            ? "En línea " + age(f.onlineSince)
            : "Desconectado";
          const room = f.online && f.room;
          const buttons =
            room &&
            !active &&
            !sent.has(room.ownerId) &&
            approved !== room.ownerId
              ? [action("Pedir entrar", "knock", room.ownerId)]
              : [];
          return row(
            f.nick,
            [
              state,
              f.online && f.game && "Jugando " + f.game + " " + age(f.since),
              room && "Sala «" + room.name + "» " + age(room.createdAt),
              room && sent.has(room.ownerId) && "Solicitud enviada",
            ]
              .filter(Boolean)
              .join(" · "),
            buttons,
            f.online,
          );
        });
    });
    refreshList("friend-requests", [s.incoming, s.outgoing], () => [
      ...s.incoming.map((f) =>
        row(f.nick, "Quiere agregarte como amigo", [
          action("Aceptar", "accept-friend", f.id),
          action("Rechazar", "reject-friend", f.id),
        ]),
      ),
      ...s.outgoing.map((f) => row(f.nick, "Solicitud de amistad enviada")),
    ]);
    $("room-requests").hidden = !active || !s.knocks.length;
    refreshList("room-requests", [active, s.knocks], () =>
      active
        ? s.knocks.map((f) =>
            row(f.nick, "Solicita entrar a tu sala", [
              action("Permitir entrada", "admit", f.id),
              action("Denegar", "reject-knock", f.id),
            ]),
          )
        : [],
    );
    refreshList("room-admission", [active, s.approvedRoom], () =>
      !active && s.approvedRoom
        ? [
            row(s.approvedRoom.name, "El anfitrión aprobó tu entrada.", [
              action("Entrar a la sala", "enter", s.approvedRoom.ownerId),
            ]),
          ]
        : [],
    );
  }
  function accept(s) {
    if (s.grants?.length) {
      const contacts = new Map(loadContacts().map((c) => [c.id, c]));
      for (const grant of s.grants)
        if (friendId.test(grant.id) && secret.test(grant.token))
          contacts.set(grant.id, {
            id: grant.id,
            nick: grant.nick,
            token: grant.token,
          });
      localStorage.setItem(contactsKey, JSON.stringify([...contacts.values()]));
    }
    const previous = snapshot;
    snapshot = s;
    if (!previous) {
      manual = s.game || "";
      $("player-game").value = manual;
    }
    draw();
    if (s.notice && s.notice !== previous?.notice) {
      status(s.notice);
      tell(s.notice);
    }
  }
  async function refresh() {
    if (!snapshot || pulsePending) return;
    pulsePending = true;
    try {
      await run(async () => {
        if (snapshot?.grants.length) {
          accept(
            await api("social/connect", {
              deviceKey: identity(),
              contacts: loadContacts(),
            }),
          );
        } else {
          accept(await api("social/pulse", {}));
        }
        if (autoEnabled && detected && snapshot.game !== detected)
          reportDetection();
      });
    } catch (error) {
      status(error.message);
      $("social-retry").hidden = false;
      if (error.status === 401 || error.status === 403) {
        $("social-login").hidden = false;
        $("social-intro").hidden = false;
        $("social-content").hidden = true;
        snapshot = null;
        window.clearInterval(timer);
      }
    } finally {
      pulsePending = false;
    }
  }
  async function connect() {
    if (connecting) return connecting;
    connecting = run(async () => {
      let deviceKey, contacts;
      try {
        deviceKey = identity();
        contacts = loadContacts();
      } catch {
        throw Error(
          "Habilita el almacenamiento local para guardar tu identidad de amigo en este equipo.",
        );
      }
      accept(await api("social/connect", { deviceKey, contacts }));
      if (autoEnabled && detected) reportDetection();
      status("");
      window.clearInterval(timer);
      timer = window.setInterval(refresh, 12000);
      timer?.unref?.();
    }).finally(() => {
      connecting = null;
    });
    return connecting;
  }
  function update(path, data) {
    return run(async () => {
      status("");
      accept(await api("social/" + path, data));
    });
  }
  async function click(event) {
    const button = event.target.closest("[data-action]");
    if (!button || button.disabled) return;
    const id = button.dataset.id;
    button.disabled = true;
    try {
      switch (button.dataset.action) {
        case "accept-friend":
        case "reject-friend":
          await update("answer", {
            id,
            accept: button.dataset.action === "accept-friend",
          });
          break;
        case "admit":
        case "reject-knock":
          await update("admit", {
            id,
            accept: button.dataset.action === "admit",
          });
          break;
        case "knock":
          await update("knock", { id });
          break;
        case "enter": {
          const result = await api("social/enter", {});
          await enterRoom(result.room);
          await refresh();
          break;
        }
      }
    } catch (error) {
      status(error.message);
      tell(error.message);
    } finally {
      button.disabled = false;
    }
  }
  for (const id of roots) $(id).addEventListener("click", click);
  $("copy-friend").onclick = () =>
    copy(snapshot.id, "Código de amigo copiado.");
  $("friend-form").onsubmit = async (event) => {
    event.preventDefault();
    const button = $("friend-add");
    if (button.disabled) return;
    button.disabled = true;
    try {
      await update("request", {
        id: $("friend-code").value.trim().toUpperCase(),
      });
      $("friend-code").value = "";
    } catch (error) {
      status(error.message);
    } finally {
      button.disabled = false;
    }
  };
  $("activity-form").onsubmit = async (event) => {
    event.preventDefault();
    const button = $("game-save");
    if (button.disabled) return;
    button.disabled = true;
    const game = $("player-game").value.trim();
    try {
      if (autoEnabled && detected) {
        status(
          "Desactiva la detección para cambiar manualmente el juego reconocido.",
        );
        return;
      }
      await update("game", { game });
      manual = game;
      status(game ? "Actividad guardada." : "Actividad borrada.");
    } catch (error) {
      status(error.message);
    } finally {
      button.disabled = false;
    }
  };
  function reportDetection() {
    const version = ++detectionVersion;
    if (!snapshot) return;
    run(async () => {
      if (version !== detectionVersion) return;
      const game = autoEnabled && detected ? detected : manual;
      if (snapshot && snapshot.game !== game)
        accept(await api("social/game", { game }));
    }).catch((error) => status(error.message));
  }
  if (bridge?.postMessage && bridge?.addEventListener) {
    bridge.addEventListener("message", (event) => {
      const data = event.data;
      if (
        data?.type !== "squadlink:game" ||
        typeof data.enabled !== "boolean" ||
        !(data.game === null || typeof data.game === "string")
      )
        return;
      bridgeReady = true;
      const changed =
        autoEnabled !== data.enabled || detected !== (data.game || "");
      autoEnabled = data.enabled;
      detected = data.game || "";
      draw();
      if (changed) reportDetection();
    });
    bridge.postMessage({ type: "squadlink:game:status" });
    $("auto-game").onclick = () =>
      bridge.postMessage({ type: "squadlink:game:set", enabled: !autoEnabled });
  }
  window.addEventListener("focus", refresh);
  return { connect, roomChanged: draw };
}

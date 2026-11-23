function label(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}

export function mountDirectory({ api, getRoom, join, create }) {
  const list = document.getElementById("directory-list");
  const query = document.getElementById("directory-query");
  const status = document.getElementById("directory-status");
  const refresh = document.getElementById("directory-refresh");
  const more = document.getElementById("directory-more");
  let rooms = [],
    pending,
    loaded = false,
    nextOffset = null;
  function draw() {
    const term = query.value.toLocaleLowerCase("es").trim();
    const results = rooms.filter((room) =>
      [room.name, room.game, room.level, room.description].some((value) =>
        (value || "").toLocaleLowerCase("es").includes(term),
      ),
    );
    const current = getRoom();
    const fragment = document.createDocumentFragment();
    for (const room of results) {
      const card = document.createElement("article");
      card.className = "directory-card";
      const heading = label("header", "", "directory-card-top");
      heading.append(
        label("span", room.game || "Sala de voz", "directory-game"),
        label("span", room.locked ? "Con clave" : "Abierta", "tag"),
      );
      card.append(heading, label("h3", room.name));
      if (room.description)
        card.append(label("p", room.description, "directory-desc"));
      const foot = label("div", "", "directory-card-foot");
      const info = label("div", "", "directory-card-data");
      info.append(
        label("strong", room.count + " / " + room.capacity + " jugadores"),
      );
      if (room.level) info.append(label("span", room.level));
      const button = label(
        "button",
        current?.code === room.code
          ? "Tu sala"
          : room.count >= room.capacity
            ? "Llena"
            : "Unirme",
        "secondary small",
      );
      button.type = "button";
      button.dataset.roomCode = room.code;
      button.disabled = Boolean(current) || room.count >= room.capacity;
      if (current && current.code !== room.code)
        button.title = "Sal de tu sala actual para unirte.";
      button.addEventListener("click", () => join(room.code));
      foot.append(info, button);
      card.append(foot);
      fragment.append(card);
    }
    if (!results.length && loaded) {
      const empty = label("div", "", "directory-empty");
      empty.append(
        label(
          "strong",
          term ? "No hay coincidencias" : "Aún no hay salas publicadas",
        ),
      );
      empty.append(
        label(
          "p",
          term
            ? "Prueba con otro juego, sala o nivel."
            : "Aquí aparecerán las salas que sus anfitriones decidan compartir.",
        ),
      );
      if (!term && !current) {
        const button = label(
          "button",
          "Crear una sala pública",
          "secondary small",
        );
        button.type = "button";
        button.onclick = create;
        empty.append(button);
      }
      fragment.append(empty);
    }
    list.replaceChildren(fragment);
  }
  async function reload(append = false) {
    if (pending) return pending;
    refresh.disabled = more.disabled = true;
    status.textContent = "Actualizando salas…";
    pending = api(
      append && nextOffset != null
        ? "directory?offset=" + nextOffset
        : "directory",
    )
      .then((result) => {
        rooms = append
          ? [
              ...new Map(
                [...rooms, ...result.rooms].map((room) => [room.code, room]),
              ).values(),
            ]
          : result.rooms;
        nextOffset = result.nextOffset ?? null;
        more.hidden = nextOffset === null;
        loaded = true;
        draw();
        status.textContent = "";
      })
      .catch((error) => {
        status.textContent =
          (loaded ? "No se pudo actualizar la lista. " : "") + error.message;
      })
      .finally(() => {
        pending = null;
        refresh.disabled = more.disabled = false;
      });
    return pending;
  }
  query.addEventListener("input", draw);
  refresh.onclick = () => reload();
  more.onclick = () => reload(true);
  window.addEventListener("focus", () => reload());
  return { reload, draw };
}

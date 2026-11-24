const pollInterval = 15_000;

export function watchLobbyDirectory(onRooms, onFailure) {
  const controller = new AbortController();
  let timer, pending = false, nextPoll = 0;

  function schedule() {
    clearTimeout(timer);
    if (controller.signal.aborted || document.hidden || pending) return;
    const wait = nextPoll - Date.now();
    if (wait > 0) timer = setTimeout(schedule, wait);
    else void refresh();
  }

  async function refresh() {
    pending = true;
    try {
      const response = await fetch('/api/directory', {signal:controller.signal, cache:'no-store'});
      if (!response.ok) throw Error('Directorio sin conexión.');
      const {rooms} = await response.json();
      if (!controller.signal.aborted) onRooms(rooms.slice(0, 3));
    } catch {
      if (!controller.signal.aborted) onFailure();
    } finally {
      pending = false;
      nextPoll = Date.now() + pollInterval;
      schedule();
    }
  }

  window.addEventListener('focus', schedule);
  document.addEventListener('visibilitychange', schedule);
  schedule();
  return {
    retry() { nextPoll = 0; schedule(); },
    stop() {
      if (controller.signal.aborted) return;
      controller.abort();
      clearTimeout(timer);
      window.removeEventListener('focus', schedule);
      document.removeEventListener('visibilitychange', schedule);
    },
  };
}

// The room remains connected while the integrated lobby is hidden or minimized.
export function createCallHomeController(bridge, load = () => import('./call-home.js')) {
  let active = false, visible = false, state;
  let mount, pending, panel;
  function refresh() {
    if (!active || !visible || !state?.joined) {
      panel?.close();
      panel = null;
      return;
    }
    if (mount) {
      panel ??= mount(bridge);
      panel.update(state);
    } else if (!pending) {
      pending = load().then(module => {
        mount = module.mountCallHome;
        refresh();
      }).catch(() => {
        if (active && visible) bridge.postMessage({type:'desktop:navigate',page:'lobby'});
      }).finally(() => { pending = null; });
    }
  }
  return {
    show(snapshot, shown) { active = true; visible = shown; state = snapshot; refresh(); },
    hide() { active = false; visible = false; state = null; refresh(); },
    update(snapshot) { if (active) { state = snapshot; refresh(); } },
    setVisible(shown) { if (active) { visible = shown; refresh(); } },
  };
}

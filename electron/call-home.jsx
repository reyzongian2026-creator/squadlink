import React from 'react';
import {createRoot} from 'react-dom/client';
import {DesktopShell,Lobby} from './lobby.jsx';

// Reuse the home presentation in the existing, unprivileged call renderer.
// Its shadow tree isolates the lobby styles and IDs from the live voice room.
export function mountCallHome(bridge) {
  const host = document.createElement('div');
  host.id = 'call-home-panel';
  const shadow = host.attachShadow({mode:'open'});
  for (const href of ['/home.css','/channels.css']) {
    const stylesheet = document.createElement('link');
    stylesheet.rel = 'stylesheet';
    stylesheet.href = href;
    shadow.append(stylesheet);
  }
  const content = document.createElement('div');
  shadow.append(content);
  document.body.append(host);
  const root = createRoot(content);
  const open = page => bridge.postMessage({type:'desktop:navigate',page});
  const call = action => bridge.postMessage({type:'desktop:lobby-control',action});
  return {
    update(state) {
      root.render(<DesktopShell state={state} open={open}><Lobby state={state} open={open} call={call}/></DesktopShell>);
    },
    close() { root.unmount(); host.remove(); },
  };
}

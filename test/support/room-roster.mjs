import assert from 'node:assert/strict';

// Replay SSE snapshots through the room client's real listener, as when other
// people change room details or the shared music queue during a call.
export function exerciseRoomRoster(win, events, snapshot) {
  const list = win.document.getElementById('members');
  const send = room => events.dispatchEvent(new win.MessageEvent('room', {data:JSON.stringify(room)}));
  const host = snapshot.members[0];
  const peer = {...host, id:'f2dd5c82-cbc1-45be-a3cf-7c19f01d0090', nick:'Otro', muted:true};
  peer.appearance = {avatar:{species:2,gender:1,skin:2,outfit:1,build:1,headgear:1,facialHair:0},level:30};
  const two = {...snapshot, members:[host,peer]};
  send(two);
  const portrait = list.lastElementChild.querySelector('.player-portrait svg');
  assert.ok(portrait);
  const slider = list.querySelector('input');
  slider.value = '42';
  slider.dispatchEvent(new win.Event('input'));
  slider.focus();
  const observer = new win.MutationObserver(() => {});
  observer.observe(list,{childList:true,subtree:true,attributes:true,characterData:true});
  try {
    for (let i = 0; i < 100; i++) send({...two,name:'Sala ' + i});
    const changes = observer.takeRecords();
    const created = changes.reduce((sum, change) => sum + change.addedNodes.length, 0);
    assert.equal(changes.length,0,'Mutaciones en la lista tras cien avisos ajenos a los participantes: ' + changes.length + ' (' + created + ' nodos añadidos)');
    assert.equal(win.document.activeElement,slider);
    send({...two,ownerId:peer.id,members:[host,{...peer,nick:'Pepe',muted:false,game:'2048'}]});
    assert.match(list.lastElementChild.textContent,/Pepe.*Micro activo.*Anfitrión.*2048/);
    assert.ok(!list.firstElementChild.textContent.includes('Anfitrión'));
    assert.equal(slider.getAttribute('aria-label'),'Volumen de Pepe');
    assert.equal(slider.value,'42');
    assert.equal(win.document.activeElement,slider);
    assert.equal(list.lastElementChild.querySelector('.player-portrait svg'),portrait);
    send({...two,members:[host,{...peer,appearance:{...peer.appearance,avatar:{...peer.appearance.avatar,species:3}}}]});
    assert.notEqual(list.lastElementChild.querySelector('.player-portrait svg'),portrait);
    send({...two,members:[host,{...peer,appearance:null}]});
    assert.equal(list.lastElementChild.querySelector('.player-portrait').textContent,'O');
    send({...two,members:[peer,host]});
    assert.equal(list.firstElementChild.querySelector('input'),slider);
    const music = {queue:[{id:'radio/1',kind:'radio',title:'Emisora de prueba'}]};
    send({...two,music});
    assert.match(list.lastElementChild.textContent,/DJ Squadlink.*Emisora de prueba/);
    send(snapshot);
    assert.equal(list.children.length,1);
    assert.equal(list.querySelector('input'),null);
  } finally {
    observer.disconnect();
  }
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHook } from 'node:async_hooks';
import { createInterface } from 'node:readline';
import { fixture } from './support/http.mjs';

async function guest(f, nick) {
  const player = f.player();
  const login = await player.hit('session', {nick});
  assert.equal(login.status,200);
  return {...player, id:login.data.self.id};
}

for (const action of ['rooms','join']) {
  test('salir durante la comprobación de la clave cancela ' + action, {timeout:5000}, async t => {
    const f = fixture(t);
    const player = await guest(f,'Pepe');
    const host = await guest(f,'Sol');
    const password = 'grupo-prueba';
    const room = (await host.hit('rooms',{name:'Sala existente',password})).data.room;
    // Wait for the real scrypt request to start before sending leave from the
    // same session. Both HTTP handlers run in-process with no timing sleeps.
    const started = Promise.withResolvers();
    const hook = createHook({init(_id,type) {
      if (type === 'SCRYPTREQUEST') started.resolve();
    }});
    t.after(()=>hook.disable());
    hook.enable();
    const pending = player.hit(action,action==='rooms'
      ? {name:'Creación cancelada',password,directory:{published:true}}
      : {code:room.code,password});
    await started.promise;
    hook.disable();
    assert.equal((await player.hit('leave',{})).status,200);
    assert.equal((await pending).status,409);
    assert.equal((await player.hit('session')).data.room,null);
    assert.deepEqual((await host.hit('session')).data.room.members.map(m=>m.id),[host.id]);
    assert.deepEqual((await player.hit('directory')).data.rooms,[]);
  });
}

for (const action of ['directory','leave']) {
  test('la petición atrasada '+action+' respeta la sala actual', async t => {
    const f = fixture(t);
    const player = await guest(f,'Pepe');
    const old = (await player.hit('rooms',{name:'Primera'})).data.room.code;
    assert.equal((await player.hit('leave',{room:old})).status,200);
    const current = (await player.hit('rooms',{name:'Segunda',directory:{published:true}})).data.room;
    const stale = await player.hit(action,{room:old,published:false});
    assert.equal(stale.status,action==='leave'?200:409);
    const actual = (await player.hit('session')).data.room;
    assert.equal(actual?.code,current.code);
    assert.equal(actual.ownerId,player.id);
    assert.deepEqual((await player.hit('directory')).data.rooms.map(r=>[r.code,r.count]),[[current.code,1]]);
    // Older builds omit the room from both operations.
    assert.equal((await player.hit('directory',{published:false})).status,200);
    assert.equal((await player.hit('leave',{})).status,200);
    assert.equal((await player.hit('session')).data.room,null);
  });
}

async function* events(response) {
  const lines = createInterface({input:response,crlfDelay:Infinity});
  let name;
  for await (const line of lines) {
    if (line.startsWith('event: ')) name=line.slice(7);
    if (line.startsWith('data: ')) yield {name,data:JSON.parse(line.slice(6))};
  }
}

test('al salir el anfitrión la pestaña activa conserva el rol y recibe señales', {timeout:5000}, async t => {
  const f=fixture(t);
  const [host,successor,member]=await Promise.all(['Pepe','Sol','Alex'].map(nick=>guest(f,nick)));
  const {code}=(await host.hit('rooms',{name:'Equipo'})).data.room;
  for (const player of [successor,member]) assert.equal((await player.hit('join',{code})).status,200);
  const first=events(await successor.request('/api/events'));
  assert.equal((await first.next()).value.data.ownerId,host.id);
  const active=events(await successor.request('/api/events'));
  assert.equal((await active.next()).value.data.ownerId,host.id);
  assert.equal((await first.next()).value.name,'superseded');
  assert.ok((await first.next()).done);
  assert.equal((await host.hit('leave',{room:code})).status,200);
  const snapshot=(await active.next()).value;
  assert.equal(snapshot.name,'room');
  assert.equal(snapshot.data.ownerId,successor.id);
  assert.deepEqual(snapshot.data.members.map(m=>m.id),[successor.id,member.id]);
  assert.equal((await successor.hit('directory',{room:code,published:true})).status,200);
  assert.equal((await active.next()).value.data.directory.published,true);
  const description={type:'offer',sdp:'v=0\r\n'};
  assert.equal((await member.hit('signal',{to:successor.id,description})).status,200);
  assert.deepEqual((await active.next()).value,{name:'signal',data:{from:member.id,description}});
});

for (const action of ['directory','leave','member']) {
  test('una petición '+action+' de la estancia anterior no afecta al regreso al mismo código', async t => {
    const f = fixture(t,{clock:()=>1700000000000});
    const original = await guest(f,'Pepe');
    const successor = await guest(f,'Sol');
    const created = (await original.hit('rooms',{name:'Equipo',directory:{published:true}})).data.room;
    const code = created.code;
    const oldMember = created.members.find(m=>m.id===original.id);
    const staleRequest = {room:code,visitId:oldMember.visitId};
    const occupied = (await successor.hit('join',{code})).data.room;
    const successorVisit = occupied.members.find(m=>m.id===successor.id).visitId;
    assert.equal((await original.hit('leave',staleRequest)).status,200);
    const returned = (await original.hit('join',{code})).data.room;
    assert.equal(returned.ownerId,successor.id);
    const newMember = returned.members.find(m=>m.id===original.id);
    assert.equal(newMember.joinedAt,oldMember.joinedAt);
    assert.equal((await successor.hit('leave',{room:code,visitId:successorVisit})).status,200);
    assert.equal((await original.hit('session')).data.room.ownerId,original.id);

    const stale = await original.hit(action,{...staleRequest,published:false,muted:false});
    assert.equal(stale.status,action==='leave'?200:409);
    const room = (await original.hit('session')).data.room;
    assert.equal(room?.code,code);
    assert.equal(room.directory.published,true);
    assert.equal(room.members[0].muted,true);
    assert.equal(typeof oldMember.visitId,'string');
    assert.notEqual(newMember.visitId,oldMember.visitId);
    const repeated = (await original.hit('join',{code})).data.room;
    assert.equal(repeated.members[0].visitId,newMember.visitId);
    const currentRequest = {room:code,visitId:newMember.visitId};
    assert.equal((await original.hit('directory',{...currentRequest,published:false})).status,200);
    assert.equal((await original.hit('leave',currentRequest)).status,200);
    assert.equal((await original.hit('session')).data.room,null);
  });
}

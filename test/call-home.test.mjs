import assert from 'node:assert/strict';
import test from 'node:test';
import {setImmediate as tick} from 'node:timers/promises';
import {createCallHomeController} from '../windows/Desktop/call-home-controller.js';

function fixture() {
  let resolve, loads = 0, mounts = 0, closes = 0;
  const updates = [];
  const controller = createCallHomeController({}, () => {
    loads++;
    return new Promise(done => {resolve = done;});
  });
  return {controller, updates, counts:()=>[loads,mounts,closes],
    finishLoad:()=>resolve({mountCallHome() {
      mounts++;
      return {update:state=>updates.push(state),close:()=>closes++};
    }})};
}

test('minimizar el lobby en plena carga evita montarlo hasta restaurar y conserva el estado más reciente',async()=>{
  const {controller,updates,counts,finishLoad}=fixture();
  controller.show({joined:true,mic:false},true);
  controller.setVisible(false);
  controller.update({joined:true,mic:true});
  finishLoad(); await tick();
  assert.deepEqual(counts(),[1,0,0]);
  controller.setVisible(true);
  assert.deepEqual(counts(),[1,1,0]);
  assert.deepEqual(updates,[{joined:true,mic:true}]);
  controller.setVisible(false);
  controller.setVisible(false);
  assert.deepEqual(counts(),[1,1,1]);
  controller.setVisible(true);
  assert.deepEqual(counts(),[1,2,1]);
  controller.update({joined:false});
  assert.deepEqual(counts(),[1,2,2]);
});

test('salir a otro canal durante la importación cancela el montaje, incluso si el SO restaura la ventana',async()=>{
  const {controller,counts,finishLoad}=fixture();
  controller.show({joined:true},false);
  assert.deepEqual(counts(),[0,0,0]);
  controller.setVisible(true);
  controller.hide();
  controller.update({joined:true,mic:true});
  controller.setVisible(true);
  finishLoad(); await tick();
  assert.deepEqual(counts(),[1,0,0]);
});

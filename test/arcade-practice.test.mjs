import test from 'node:test';
import assert from 'node:assert/strict';
import {slide,botMove,winningLine} from '../public/arcade-practice.js';

test('2048 fusiona una sola vez por ficha y conserva el tablero de entrada',()=>{
  const board=[2,2,2,2, 4,4,8,0, 0,0,0,0, 0,0,0,0];
  const moved=slide(board,'left');
  assert.deepEqual(moved.cells.slice(0,8),[4,4,0,0,8,8,0,0]);
  assert.equal(moved.points,16);
  assert.equal(board[0],2);
  assert.deepEqual(slide(board,'right').cells.slice(0,8),[0,0,4,4,0,0,8,8]);
});

test('2048 desplaza en vertical y distingue un tablero sin movimientos',()=>{
  const board=[2,0,0,0, 0,0,0,0, 2,0,0,0, 0,0,0,0];
  assert.equal(slide(board,'up').cells[0],4);
  assert.equal(slide(board,'down').cells[12],4);
  const full=[2,4,2,4, 4,2,4,2, 2,4,2,4, 4,2,4,2];
  for(const direction of ['up','down','left','right'])assert.equal(slide(full,direction).changed,false);
});

test('tres en raya gana antes de bloquear y evita una derrota inmediata',()=>{
  assert.equal(botMove(['O','O','','X','X','','','','']),2);
  assert.equal(botMove(['X','X','','','O','','','','']),2);
  assert.deepEqual(winningLine(['X','','','','X','','','','X'],'X'),[0,4,8]);
});

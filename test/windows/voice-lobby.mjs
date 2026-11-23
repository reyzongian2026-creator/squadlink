import {createServer} from '../../server.mjs';
const lobby = createServer();
const [app] = lobby.listeners('request');
lobby.removeListener('request', app);
let refuseDirectory = false;
let directoryFixture = null;
const fixtureRooms = ['Sala norte', 'Sala centro', 'Sala sur'].map((name, i) => ({
  name, code: 'TEST0' + i, game: 'VALORANT', level: 'Todos', count: 1, capacity: 5,
  description: 'Sala de prueba', locked: false
}));
let sample = [0,0];
lobby.on('request', (req,res) => {
  const url = new URL(req.url,'http://127.0.0.1');
  if (req.method === 'POST' && url.pathname === '/api/test-directory') {
    refuseDirectory = url.searchParams.get('fail') === '1';
    directoryFixture = url.searchParams.get('pages');
    res.writeHead(204);
    return res.end();
  }
  if (refuseDirectory && url.pathname === '/api/directory') {
    res.writeHead(503, {'Content-Type': 'application/json'});
    return res.end(JSON.stringify({error: 'Directorio temporalmente indisponible'}));
  }
  if (directoryFixture && url.pathname === '/api/directory') {
    const offset = Number(url.searchParams.get('offset'));
    if (directoryFixture === 'partial-error' && offset === 1) {
      res.writeHead(503);
      return res.end();
    }
    res.writeHead(200, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'});
    return res.end(JSON.stringify({
      rooms: fixtureRooms.slice(offset, offset + 1),
      nextOffset: offset + 1 < fixtureRooms.length ? offset + 1 : null
    }));
  }
  if (url.pathname !== '/api/test-audio') return app(req,res);
  if(req.method === 'POST') {
    sample = [Number(url.searchParams.get('packets')),Number(url.searchParams.get('energy'))];
  }
  res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify(sample));
});
lobby.listen(4179,'127.0.0.1');

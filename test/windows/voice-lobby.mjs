import {createServer} from '../../server.mjs';
const lobby = createServer();
const [app] = lobby.listeners('request');
lobby.removeListener('request', app);
let sample = [0,0];
lobby.on('request', (req,res) => {
  const url = new URL(req.url,'http://127.0.0.1');
  if (url.pathname !== '/api/test-audio') return app(req,res);
  if(req.method === 'POST') {
    sample = [Number(url.searchParams.get('packets')),Number(url.searchParams.get('energy'))];
  }
  res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify(sample));
});
lobby.listen(4179,'127.0.0.1');

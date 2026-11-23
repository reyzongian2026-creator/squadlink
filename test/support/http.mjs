import http from 'node:http';
import { Duplex, PassThrough } from 'node:stream';
import { createServer } from '../../server.mjs';

// Use real Node HTTP parsers over local streams, including unbuffered SSE.
// TCP port binding is unnecessary, and each test owns an independent server.
export function fixture(t) {
  const server = createServer();
  const agent = new http.Agent({ keepAlive: false });
  const streams = new Set();
  agent.createConnection = () => {
    const inbound = new PassThrough();
    const outbound = new PassThrough();
    const client = Duplex.from({ readable: outbound, writable: inbound });
    const peer = Duplex.from({ readable: inbound, writable: outbound });
    streams.add(client);
    streams.add(peer);
    server.emit('connection', peer);
    return client;
  };
  t.after(() => {
    agent.destroy();
    for (const socket of streams) socket.destroy();
    server.close();
  });
  function player() {
    let cookie = '';
    function request(path, body, extra = {}) {
      const data = body === undefined ? undefined : JSON.stringify(body);
      return new Promise((resolve, reject) => {
        const req = http.request({
          host: 'localhost', agent, path, method: data === undefined ? 'GET' : 'POST',
          headers: { ...(data === undefined ? {} : { 'content-type': 'application/json', origin: 'http://localhost' }), ...(cookie && { cookie }), ...extra }
        }, res => {
          if (res.headers['set-cookie']) cookie = res.headers['set-cookie'][0].split(';')[0];
          resolve(res);
        });
        req.on('error', reject);
        req.end(data);
      });
    }
    async function hit(path, body, extra) {
      const res = await request('/api/' + path, body, extra);
      const chunks = [];
      for await (const chunk of res) chunks.push(chunk);
      return { status: res.statusCode, headers: res.headers, data: JSON.parse(Buffer.concat(chunks).toString()) };
    }
    return { request, hit };
  }
  return { player };
}


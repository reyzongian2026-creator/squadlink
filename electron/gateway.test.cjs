const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http');
const {parseServer,relay}=require('./gateway.cjs');
test('valida servidor y restringe rutas', async()=>{
 assert.equal(parseServer('https://example.org/'),'https://example.org');
 for(const url of ['file:///tmp','http://example.org','https://user@example.org','https://example.org/x'])assert.throws(()=>parseServer(url));
 assert.equal((await relay(new Request('https://app/x'),'http://127.0.0.1',{})).status,403);
});
test('conserva el apodo, la cookie y el cuerpo entre llamadas',async t=>{
 const cookies=new Map();const jar={get:async({url})=>cookies.has(url)?[cookies.get(url)]:[],set:async c=>cookies.set(c.url,c),remove:async url=>cookies.delete(url)};
 const server=http.createServer(async(req,res)=>{
  if(req.url==='/api/join'){assert.equal(req.headers.cookie,'squad_session=abc');let body='';for await(const chunk of req)body+=chunk;assert.equal(JSON.parse(body).code,'ABC123');}
  else res.setHeader('Set-Cookie','squad_session=abc; HttpOnly; Path=/; SameSite=Strict; Max-Age=3600');
  res.setHeader('Content-Type','application/json');res.end('{"ok":true}');
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
 const origin='http://127.0.0.1:'+server.address().port;
 for(const route of ['session','join']){const req=new Request('https://app/api/'+route,{method:'POST',body:JSON.stringify({code:'ABC123'})});assert.deepEqual(await(await relay(req,origin,jar)).json(),{ok:true});}
});

// Forward only Squadlink API calls. Session credentials live in Electron's cookie store.
function parseServer(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/' ||
     !(url.protocol === 'https:' || (url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname))))
    throw Error('Usa una dirección HTTPS o un servidor local HTTP.');
  return url.origin;
}
async function relay(request, origin, cookies) {
  const path = new URL(request.url);
  if (!path.pathname.startsWith('/api/') || !['GET','HEAD','POST'].includes(request.method))
    return new Response(null,{status:403});
  const headers = {Origin:origin, Accept:request.headers.get('accept') || 'application/json'};
  const [session] = await cookies.get({url:origin, name:'squad_session'});
  if (session) headers.Cookie = 'squad_session=' + session.value;
  const uploading = path.pathname === '/api/music/upload' && request.method === 'POST';
  if (request.method === 'POST') headers['Content-Type']=uploading ? 'application/octet-stream' : 'application/json';
  if (path.pathname === '/api/music/file' && request.headers.has('range'))
    headers.Range=request.headers.get('range');
  let upstream;
  try {
    upstream = await fetch(origin + path.pathname + path.search, {
      method:request.method, headers, redirect:'error', signal:request.signal,
      body:uploading ? request.body : request.method === 'POST' ? await request.text() : undefined,
      ...(uploading && {duplex:'half'})
    });
    for (const header of upstream.headers.getSetCookie()) {
      const match = /^squad_session=([^;]*);/i.exec(header);
      if (!match) continue;
      const age = /(?:^|;)\s*max-age=(\d+)/i.exec(header);
      if (!match[1] || age?.[1] === '0') await cookies.remove(origin,'squad_session');
      else await cookies.set({url:origin, name:'squad_session', value:match[1], path:'/', httpOnly:true,
        secure:origin.startsWith('https:'), sameSite:'strict', ...(age && {expirationDate:Date.now()/1000+Number(age[1])})});
    }
  } catch {
    return Response.json({error:'No se pudo conectar con el servidor.'},{status:503});
  }
  const mediaHeaders={};
  if (path.pathname === '/api/music/file') {
    for (const name of ['content-range','accept-ranges','content-length']) {
      if (upstream.headers.has(name)) mediaHeaders[name]=upstream.headers.get(name);
    }
  }
  return new Response(upstream.body,{status:upstream.status,headers:{...mediaHeaders,
    'Content-Type':upstream.headers.get('content-type') || 'application/json','Cache-Control':'no-store',
    'X-Content-Type-Options':'nosniff'
  }});
}
module.exports={parseServer,relay};

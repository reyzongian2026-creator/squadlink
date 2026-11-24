// Render deploys asynchronously from the push that triggers the browser test.
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const files = ['index.html', 'app.js', 'style.css', 'descargar.html', 'descargas.js'];
const expected = await Promise.all(files.map(file => readFile(new URL('../../public/' + file, import.meta.url), 'utf8')));
async function matches(file, index) {
  const url = new URL('/' + file, 'https://squadlink-lobby.onrender.com');
  url.searchParams.set('revision', process.env.GITHUB_SHA ?? 'local');
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), cache: 'no-store' });
  return response.ok && await response.text() === expected[index];
}

const deadline = Date.now() + 180_000;
while (true) {
  try {
    if ((await Promise.all(files.map(matches))).every(Boolean)) break;
  } catch (error) { console.info('Esperando el servicio:', error.message); }
  if (Date.now() >= deadline) throw Error('Render todavía no sirve la revisión de cliente esperada.');
  await delay(5000);
}

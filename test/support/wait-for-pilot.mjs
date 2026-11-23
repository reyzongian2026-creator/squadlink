// Render deploys asynchronously from the push that triggers the browser test.
import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const file = 'app.js';
const expected = await readFile(new URL('../../public/' + file, import.meta.url), 'utf8');
const deadline = Date.now() + 180_000;
while (true) {
  try {
    const url = new URL('/' + file, 'https://squadlink-lobby.onrender.com');
    url.searchParams.set('revision', process.env.GITHUB_SHA ?? 'local');
    const response = await fetch(url, {signal:AbortSignal.timeout(15000), cache:'no-store'});
    if (response.ok && await response.text() === expected) break;
  } catch (error) { console.info('Esperando el servicio:', error.message); }
  if (Date.now() >= deadline) throw Error('Render todavía no sirve la revisión de cliente esperada.');
  await delay(5000);
}

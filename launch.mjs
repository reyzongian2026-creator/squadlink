import { spawn } from 'node:child_process';
import { createServer } from './server.mjs';

const port = Number(process.env.PORT || 4179);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('PORT debe ser un puerto entre 1 y 65535.');
  process.exit(1);
}

const server = createServer();
server.once('error', error => {
  if (error.code === 'EADDRINUSE') {
    console.error(`El puerto ${port} está ocupado. Cierra el otro servidor o elige otro puerto con PORT.`);
  } else {
    console.error(`No se pudo iniciar Squadlink: ${error.message}`);
  }
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  console.log(`Squadlink está disponible en ${url}\nMantén esta ventana abierta. Pulsa Ctrl+C para cerrar el servidor.`);
  if (process.argv.includes('--no-open')) return;

  const [command, ...args] = process.platform === 'win32'
    ? ['rundll32.exe', 'url.dll,FileProtocolHandler', url]
    : process.platform === 'darwin' ? ['open', url] : ['xdg-open', url];
  const browser = spawn(command, args, { stdio: 'ignore', windowsHide: true });
  browser.once('error', () => console.error(`Abre esta dirección en tu navegador: ${url}`));
  browser.once('exit', code => {
    if (code) console.error(`Abre esta dirección en tu navegador: ${url}`);
  });
  browser.unref();
});

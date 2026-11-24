const fs = require('node:fs');
const path = require('node:path');
const {execFile, spawn} = require('node:child_process');
const {promisify} = require('node:util');
const run = promisify(execFile);
const files = fs.promises;
const resources = 'Contents/Resources/app';
const bundleID = 'com.squadlink.moderno.preview';
const name = 'Squadlink Moderno.app';

function versionParts(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-preview\.(\d+))?$/.exec(version);
  if (!match) throw Error('Versión de escritorio no reconocida.');
  return [...match.slice(1,4).map(Number), match[4] === undefined ? Infinity : Number(match[4])];
}

async function inspect(bundle) {
  if (!(await files.lstat(bundle)).isDirectory()) throw Error('El paquete de macOS no es una carpeta de aplicación.');
  const plist = path.join(bundle,'Contents/Info.plist');
  const field = async key => (await run('/usr/bin/plutil',['-extract',key,'raw','-o','-',plist])).stdout.trim();
  const [id, short, build, executable, metadata] = await Promise.all([
    field('CFBundleIdentifier'),field('CFBundleShortVersionString'),field('CFBundleVersion'),field('CFBundleExecutable'),
    files.readFile(path.join(bundle,resources,'package.json'),'utf8').then(JSON.parse),
  ]);
  if (id !== bundleID || executable !== 'Electron' || metadata.name !== 'squadlink-desktop' ||
      !/^\d+(?:\.\d+){0,2}$/.test(build) ||
      (metadata.version !== short && metadata.version !== short + '-preview.' + build)) throw Error('Identidad o versión del paquete de macOS incorrecta.');
  await run('/usr/bin/codesign',['--verify','--deep','--strict',bundle]);
  const {stderr} = await run('/usr/bin/codesign',['-dv','--verbose=4',bundle]);
  return {version:metadata.version, team:stderr.match(/^TeamIdentifier=(.+)$/m)?.[1], adHoc:/^Signature=adhoc$/m.test(stderr)};
}

async function preserveCartridges(current, staged, candidate) {
  const oldDir = path.join(current, resources, 'cartridges');
  const target = path.join(staged, resources, 'cartridges');
  let directory;
  try { directory = await files.lstat(oldDir); }
  catch (err) { if (err.code === 'ENOENT') return; throw err; }
  if (!directory.isDirectory()) throw Error('No se pudieron leer los cartuchos instalados.');
  const cartridges = (await files.readdir(oldDir)).filter(file => file.toLowerCase().endsWith('.nes'));
  if (!cartridges.length) return;
  if (!candidate.adHoc) throw Error('Esta edición firmada necesita una migración de cartuchos compatible.');
  if (await files.realpath(path.dirname(target)) !== path.dirname(target)) throw Error('Destino de cartuchos no válido.');
  await files.mkdir(target,{recursive:true});
  if (!(await files.lstat(target)).isDirectory()) throw Error('Destino de cartuchos no válido.');
  for (const file of cartridges) {
    const source = path.join(oldDir,file);
    if (!(await files.lstat(source)).isFile()) throw Error('El cartucho instalado no es un archivo local.');
    // Never follow a link supplied by the staged bundle.
    const dest = path.join(target,file);
    await files.rm(dest,{force:true});
    await files.copyFile(source,dest,fs.constants.COPYFILE_EXCL);
  }
  await run('/usr/bin/codesign',['--force','--sign','-','--preserve-metadata=entitlements,requirements,flags,runtime',staged]);
  await run('/usr/bin/codesign',['--verify','--deep','--strict',staged]);
}

function arm(helper, args) {
  return new Promise((resolve,reject) => {
    const child = spawn(helper,args,{detached:true,stdio:['ignore','pipe','ignore']});
    let output = '';
    child.once('error',reject);
    child.once('exit',() => reject(Error('No se pudo preparar el reinicio de Squadlink.')));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data',chunk => {
      output += chunk;
      if (!output.includes('READY\n')) return;
      child.stdout.destroy();
      child.unref();
      resolve();
    });
  });
}

async function prepareMacUpdate({zipPath, expectedVersion, appPath, userDataPath}) {
  if (process.platform !== 'darwin') throw Error('Se necesita macOS para instalar este paquete.');
  if (userDataPath && !path.isAbsolute(userDataPath)) throw Error('La ruta del perfil de usuario no es absoluta.');
  const version = versionParts(expectedVersion);
  const installed = await files.realpath(appPath);
  if (!installed.endsWith('.app')) throw Error('Abre la aplicación instalada de Squadlink para actualizar.');
  const current = await inspect(installed);
  const prior = versionParts(current.version);
  const difference = version.findIndex((part,i) => part !== prior[i]);
  if (difference < 0 || version[difference] <= prior[difference]) throw Error('Esta versión ya está instalada o es anterior.');
  const original = await files.stat(installed,{bigint:true});
  let work;
  try {
    work = await files.mkdtemp(path.join(path.dirname(installed),'.squadlink-update-'));
  } catch (error) {
    if (['EROFS','EPERM','EACCES'].includes(error.code)) throw Error('Mueve Squadlink a una carpeta de Aplicaciones donde puedas actualizarla y vuelve a abrirla.');
    throw error;
  }
  const staged = path.join(work,name);
  const clean = () => files.rm(work,{recursive:true,force:true});
  try {
    const {stdout:list} = await run('/usr/bin/zipinfo',['-1',path.resolve(zipPath)],{maxBuffer:4*1024*1024});
    if (!list.trimEnd().split('\n').every(entry =>
      (entry.startsWith(name + '/') || entry.startsWith('__MACOSX/')) && !entry.split('/').includes('..'))) {
      throw Error('El archivo de actualización contiene rutas inesperadas.');
    }
    await run('/usr/bin/ditto',['-x','-k',path.resolve(zipPath),work]);
    const candidate = await inspect(staged);
    if (candidate.version !== expectedVersion ||
        (!current.adHoc && (candidate.adHoc || !current.team || current.team === 'not set' || current.team !== candidate.team)))
      throw Error('La firma o la versión no coincide con la actualización esperada.');
    await preserveCartridges(installed,staged,candidate);
    const helper = path.join(work,'install-helper');
    await files.copyFile(path.join(installed,resources,'update-mac-helper'),helper,fs.constants.COPYFILE_EXCL);
    await files.chmod(helper,0o700);
    const future = await files.stat(staged,{bigint:true});
    let phase = 'prepared';
    return {
      async cancel() {
        if (phase !== 'prepared') return;
        phase = 'cancelled';
        await clean();
      },
      async launch() {
        if (phase !== 'prepared') throw Error('La actualización ya se canceló o inició.');
        phase = 'launching';
        try {
          await arm(helper,[String(process.pid),installed,work,String(original.dev),String(original.ino),String(future.ino),userDataPath || '']);
        } catch (error) {
          await clean();
          throw error;
        }
      },
    };
  } catch (error) {
    await clean();
    throw error;
  }
}

// The updater supplies a pipe only to the replacement process. A normal Finder launch has none.
function confirmMacUpdateReady() {
  if (process.env.SQUADLINK_MAC_UPDATE_READY !== '3') return;
  delete process.env.SQUADLINK_MAC_UPDATE_READY;
  try {
    if (fs.fstatSync(3).isFIFO()) {
      try { fs.writeSync(3,'READY\n'); } finally { fs.closeSync(3); }
    }
  }
  catch { /* A helper that already exited no longer needs an acknowledgement. */ }
}

module.exports = {prepareMacUpdate, confirmMacUpdateReady};

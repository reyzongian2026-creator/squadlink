const {mkdirSync,cpSync,copyFileSync,readFileSync,writeFileSync}=require('node:fs');
const path=require('node:path');
const esbuild=require('esbuild');
const out=path.join(__dirname,'stage');
mkdirSync(out,{recursive:true});
cpSync(path.join(__dirname,'../public'),path.join(out,'client'),{recursive:true});
for(const file of ['main.cjs','preload.cjs','gateway.cjs','detection.cjs','player-vault.cjs','update-controller.cjs','update-release.cjs','update-windows.cjs','update-mac.cjs','home.html','home.css','space.css','channels.css','channels.js','feature.js']) copyFileSync(path.join(__dirname,file),path.join(out,file));
copyFileSync(path.join(__dirname,'../windows/Squadlink.ico'),path.join(out,'Squadlink.ico'));
cpSync(path.join(__dirname,'../windows/Desktop'),path.join(out,'client'),{recursive:true});
const client=path.join(out,'client');
let html=readFileSync(path.join(client,'index.html'),'utf8')
  .replace('<link rel="manifest" href="/manifest.webmanifest" />','')
  .replace('</head>','<link rel="stylesheet" href="/desktop.css" /><link rel="stylesheet" href="/space.css" /><link rel="stylesheet" href="/channels.css" /></head>')
  .replace('src="/install.js"','src="/desktop.js"')
  .replace('</body>','<script type="module" src="/feature.js"></script></body>');
writeFileSync(path.join(client,'index.html'),html);
for(const file of ['space.css','channels.css','channels.js','feature.js'])copyFileSync(path.join(out,file),path.join(client,file));
const pack=require('./package.json');
writeFileSync(path.join(out,'package.json'),JSON.stringify({name:pack.name,productName:'Squadlink',version:pack.version,main:pack.main,squadBuild:Number(process.env.GITHUB_RUN_NUMBER||0),squadAttempt:Number(process.env.GITHUB_RUN_ATTEMPT||1)}));
esbuild.buildSync({entryPoints:[path.join(__dirname,'home.jsx')],outfile:path.join(out,'home.js'),bundle:true,minify:true,define:{'process.env.NODE_ENV':'"production"'}});

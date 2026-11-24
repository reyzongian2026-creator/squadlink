const {execFile}=require('node:child_process');
const {join}=require('node:path');
const {promisify}=require('node:util');
const exec=promisify(execFile);
const games={
  'valorant-win64-shipping.exe':'VALORANT','cs2.exe':'Counter-Strike 2','rocketleague.exe':'Rocket League',
  'fortniteclient-win64-shipping.exe':'Fortnite','league of legends.exe':'League of Legends','dota2.exe':'Dota 2','overwatch.exe':'Overwatch 2'
};
async function detect(previous){
  if(process.platform!=='win32')return null;
  const {stdout}=await exec(join(process.env.SystemRoot,'System32','tasklist.exe'),['/fo','csv','/nh'],{windowsHide:true,timeout:8000,maxBuffer:4*1024*1024});
  const running=stdout.split(/\r?\n/).map(line=>games[/^"([^"]+)"/.exec(line)?.[1]?.toLowerCase()]).filter(Boolean);
  return running.includes(previous)?previous:running.sort()[0]||null;
}
module.exports={detect};

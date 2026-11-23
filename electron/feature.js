const bar=document.createElement('header');
bar.className='space-header';
const home=document.createElement('button');
home.type='button';home.textContent='‹  Inicio';home.addEventListener('click',()=>window.squadBridge.home());
const name=document.createElement('strong');name.textContent='SQUADLINK';
bar.append(home,name);document.body.prepend(bar);
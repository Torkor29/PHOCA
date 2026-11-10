// WikeGuard — coffre photo chiffré (AES-GCM, clé dérivée du code via PBKDF2), stocké en IndexedDB local.
const $=id=>document.getElementById(id), enc=new TextEncoder();
let key=null, urls=[], cur=null;
$('last').textContent=new Date().toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'});

const db=new Promise((ok,ko)=>{const r=indexedDB.open('wg',1);
  r.onupgradeneeded=()=>{r.result.createObjectStore('meta');r.result.createObjectStore('items',{keyPath:'id'})};
  r.onsuccess=()=>ok(r.result);r.onerror=()=>ko(r.error)});
const tx=async(s,m,f)=>{const d=await db;return new Promise((ok,ko)=>{const t=d.transaction(s,m),q=f(t.objectStore(s));t.oncomplete=()=>ok(q&&q.result);t.onerror=()=>ko(t.error)})};
const getMeta=()=>tx('meta','readonly',s=>s.get('m'));

async function derive(pin,salt){const b=await crypto.subtle.importKey('raw',enc.encode(pin),'PBKDF2',false,['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:310000,hash:'SHA-256'},b,{name:'AES-GCM',length:256},false,['encrypt','decrypt'])}
const seal=async d=>{const iv=crypto.getRandomValues(new Uint8Array(12));return{iv,data:await crypto.subtle.encrypt({name:'AES-GCM',iv},key,d)}};
const open_=o=>crypto.subtle.decrypt({name:'AES-GCM',iv:o.iv},key,o.data);

$('act').onclick=async()=>{
  const pin=$('key').value.trim(); $('key').value='';
  if(pin.length<4){$('msg').textContent='Clé produit invalide.';return}
  const m=await getMeta();
  if(!m){ // premier lancement : ce code devient le code secret
    const salt=crypto.getRandomValues(new Uint8Array(16)); key=await derive(pin,salt);
    const c=await seal(enc.encode('ok')); await tx('meta','readwrite',s=>s.put({salt,check:c},'m'));
  } else {
    try{key=await derive(pin,m.salt);await open_(m.check)}catch{key=null;$('msg').textContent='Clé produit invalide.';return}
  }
  $('msg').textContent=''; unlock();
};

async function unlock(){$('cover').classList.add('hide');$('vault').classList.remove('hide');render()}
function lock(){key=null;urls.forEach(URL.revokeObjectURL);urls=[];$('grid').innerHTML='';
  $('view').classList.add('hide');$('vault').classList.add('hide');$('cover').classList.remove('hide')}
$('lock').onclick=lock;
document.addEventListener('visibilitychange',()=>{if(document.hidden&&key)lock()});

async function render(){
  urls.forEach(URL.revokeObjectURL);urls=[];const g=$('grid');g.innerHTML='';
  const items=await tx('items','readonly',s=>s.getAll());
  $('info').textContent=items.length?'':'Vide. Touchez ＋ pour importer des photos.';
  for(const it of items.sort((a,b)=>b.id-a.id)){
    const u=URL.createObjectURL(new Blob([await open_(it)],{type:it.type}));urls.push(u);
    const i=new Image();i.src=u;i.onclick=()=>{cur=it.id;$('big').src=u;$('view').classList.remove('hide')};g.append(i)}
}
$('file').onchange=async e=>{
  const fs=[...e.target.files];e.target.value='';$('info').textContent='Import…';
  for(const f of fs){const s=await seal(await f.arrayBuffer());await tx('items','readwrite',st=>st.put({id:Date.now()+Math.random(),type:f.type,...s}))}
  render()};
$('close').onclick=()=>$('view').classList.add('hide');
$('del').onclick=async()=>{if(!confirm('Supprimer cette photo ?'))return;await tx('items','readwrite',s=>s.delete(cur));$('view').classList.add('hide');render()};
if(navigator.storage&&navigator.storage.persist)navigator.storage.persist();
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js');

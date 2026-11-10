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
  $('info').textContent=items.length?'':'Vide. Touchez ＋ pour importer photos et vidéos.';
  for(const it of items.sort((a,b)=>b.id-a.id)){
    const u=URL.createObjectURL(new Blob([await open_(it)],{type:it.type}));urls.push(u);
    const v=(it.type||'').startsWith('video');const i=v?document.createElement('video'):new Image();
    if(v){i.muted=true;i.playsInline=true;i.preload='metadata';i.src=u+'#t=0.1'}else i.src=u;
    i.onclick=()=>{cur=it.id;$('big').classList.toggle('hide',v);$('bigv').classList.toggle('hide',!v);
      if(v)$('bigv').src=u;else $('big').src=u;$('view').classList.remove('hide')};g.append(i)}
}
$('add').onclick=()=>$('pick').classList.remove('hide');
$('bLib').onclick=()=>$('fLib').click();
$('bFiles').onclick=()=>$('fFiles').click();
$('pickX').onclick=()=>$('pick').classList.add('hide');
$('fLib').onchange=$('fFiles').onchange=async e=>{$('pick').classList.add('hide');
  const fs=[...e.target.files].filter(f=>/^(image|video)\//.test(f.type)||/\.(heic|heif|jpe?g|png|gif|webp|mov|mp4|m4v)$/i.test(f.name));e.target.value='';$('info').textContent='Import…';
  for(const f of fs){const s=await seal(await f.arrayBuffer());await tx('items','readwrite',st=>st.put({id:Date.now()+Math.random(),type:f.type||(/\.(mov|mp4|m4v)$/i.test(f.name)?'video/mp4':'image/jpeg'),...s}))}
  await render();
  if(fs.length)alert(fs.length+' élément(s) importé(s) et chiffré(s).\n\nPour les retirer du téléphone : ouvre Photos, supprime-les, puis vide l\'album « Supprimés récemment ».\n\nPense à faire une sauvegarde (bouton •••).')};
$('close').onclick=()=>{$('bigv').pause();$('view').classList.add('hide')};
$('del').onclick=async()=>{if(!confirm('Supprimer cette photo ?'))return;await tx('items','readwrite',s=>s.delete(cur));$('view').classList.add('hide');render()};
// ---- Sauvegarde / restauration ----
const b64=u=>btoa(String.fromCharCode(...new Uint8Array(u))), unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
$('more').onclick=()=>$('opts').classList.remove('hide');
$('optsX').onclick=()=>$('opts').classList.add('hide');
$('bBak').onclick=async()=>{
  $('opts').classList.add('hide');$('info').textContent='Préparation de la sauvegarde…';
  const m=await getMeta(),items=await tx('items','readonly',s=>s.getAll());
  const head={v:1,salt:b64(m.salt),civ:b64(m.check.iv),cdata:b64(m.check.data),items:items.map(i=>({id:i.id,type:i.type,iv:b64(i.iv),len:i.data.byteLength}))};
  const hb=enc.encode(JSON.stringify(head)),n=new Uint8Array(4);new DataView(n.buffer).setUint32(0,hb.length);
  const d=new Date().toISOString().slice(0,10).replace(/-/g,'');
  const file=new File([n,hb,...items.map(i=>i.data)],'wikeguard-config-'+d+'.bak',{type:'application/octet-stream'});
  $('info').textContent=items.length?'':'Vide. Touchez ＋ pour importer photos et vidéos.';
  if(navigator.canShare&&navigator.canShare({files:[file]})){try{await navigator.share({files:[file]})}catch{}return}
  const a=document.createElement('a');a.href=URL.createObjectURL(file);a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),60000)};
$('bRes').onclick=()=>{$('opts').classList.add('hide');$('fRes').click()};
$('fRes').onchange=async e=>{
  const f=e.target.files[0];e.target.value='';if(!f)return;
  try{
    const buf=await f.arrayBuffer(),hl=new DataView(buf).getUint32(0),head=JSON.parse(new TextDecoder().decode(new Uint8Array(buf,4,hl)));
    const pin=prompt('Code de cette sauvegarde :');if(!pin)return;
    const k=await derive(pin,unb64(head.salt));
    try{await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(head.civ)},k,unb64(head.cdata))}catch{alert('Code incorrect pour cette sauvegarde.');return}
    $('info').textContent='Restauration…';
    const have=new Set((await tx('items','readonly',s=>s.getAllKeys())));let off=4+hl,n=0;
    for(const it of head.items){const data=buf.slice(off,off+it.len);off+=it.len;if(have.has(it.id))continue;
      const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(it.iv)},k,data);const s2=await seal(plain);
      await tx('items','readwrite',st=>st.put({id:it.id,type:it.type,...s2}));n++}
    await render();alert(n+' élément(s) restauré(s).');
  }catch(err){alert('Fichier de sauvegarde illisible.')}};
if(navigator.storage&&navigator.storage.persist)navigator.storage.persist();
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js');

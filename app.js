// WikeGuard — coffre photo chiffré (AES-GCM, clé dérivée du code via PBKDF2), stocké en IndexedDB local.
const $=id=>document.getElementById(id), enc=new TextEncoder();
let key=null, list=[], thumbUrls=[], full=new Map(), idx=0;
$('last').textContent=new Date().toLocaleString('fr-FR',{dateStyle:'short',timeStyle:'short'});

const db=new Promise((ok,ko)=>{const r=indexedDB.open('wg',2);
  r.onupgradeneeded=()=>{const d=r.result,n=d.objectStoreNames;if(!n.contains('meta'))d.createObjectStore('meta');
    if(!n.contains('items'))d.createObjectStore('items',{keyPath:'id'});if(!n.contains('thumbs'))d.createObjectStore('thumbs',{keyPath:'id'})};
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
function lock(){key=null;closeView();thumbUrls.forEach(URL.revokeObjectURL);thumbUrls=[];list=[];$('grid').innerHTML='';
  $('vault').classList.add('hide');$('cover').classList.remove('hide')}
$('lock').onclick=lock;
document.addEventListener('visibilitychange',()=>{if(document.hidden&&key)lock()});
const isVid=t=>(t||'').startsWith('video');
const fmt=d=>d?Math.floor(d/60)+':'+String(Math.round(d%60)).padStart(2,'0'):'';

// ---- Miniatures (petites, chiffrées à part : la grille reste rapide) ----
function makeThumb(blob,video){return new Promise(res=>{
  const u=URL.createObjectURL(blob),done=(el,w,h,dur)=>{const S=360,r=Math.max(S/w,S/h),c=document.createElement('canvas');
    c.width=S;c.height=S;c.getContext('2d').drawImage(el,(S-w*r)/2,(S-h*r)/2,w*r,h*r);URL.revokeObjectURL(u);
    c.toBlob(b=>res(b?{blob:b,dur}:null),'image/jpeg',.78)};
  const fail=()=>{URL.revokeObjectURL(u);res(null)};
  if(video){const v=document.createElement('video');v.muted=true;v.playsInline=true;v.preload='auto';
    v.onloadeddata=()=>{v.currentTime=Math.min(.5,(v.duration||1)/2)};v.onseeked=()=>done(v,v.videoWidth,v.videoHeight,v.duration);v.onerror=fail;v.src=u;v.load()}
  else{const i=new Image();i.onload=()=>done(i,i.naturalWidth,i.naturalHeight);i.onerror=fail;i.src=u}
  setTimeout(fail,15000)})}
async function storeThumb(id,blob,video){const t=await makeThumb(blob,video);if(!t)return null;
  const s=await seal(await t.blob.arrayBuffer());const rec={id,dur:t.dur,...s};await tx('thumbs','readwrite',st=>st.put(rec));return rec}

async function render(){
  thumbUrls.forEach(URL.revokeObjectURL);thumbUrls=[];const g=$('grid');g.innerHTML='';
  const keys=await tx('items','readonly',s=>s.getAllKeys());
  const thumbs=new Map((await tx('thumbs','readonly',s=>s.getAll())).map(t=>[t.id,t]));
  list=keys.sort((a,b)=>b-a).map(id=>({id}));
  $('info').textContent=list.length?'':'Vide. Touchez ＋ pour importer photos et vidéos.';
  list.forEach((it,n)=>{const c=document.createElement('div');c.className='cell';const im=new Image();c.append(im);
    c.onclick=()=>openView(n);g.append(c);it.cell=c;it.img=im});
  for(const it of list){let t=thumbs.get(it.id);
    if(!t){const full_=await tx('items','readonly',s=>s.get(it.id));it.type=full_.type;
      t=await storeThumb(it.id,new Blob([await open_(full_)],{type:full_.type}),isVid(full_.type))}
    if(!t)continue;const u=URL.createObjectURL(new Blob([await open_(t)],{type:'image/jpeg'}));thumbUrls.push(u);
    it.img.onload=()=>it.img.classList.add('on');it.img.src=u;
    if(t.dur){it.vid=true;const d=document.createElement('span');d.className='dur';d.textContent=fmt(t.dur);it.cell.append(d)}}
}
$('add').onclick=()=>$('pick').classList.remove('hide');
$('bLib').onclick=()=>$('fLib').click();
$('bFiles').onclick=()=>$('fFiles').click();
$('pickX').onclick=()=>$('pick').classList.add('hide');
$('fLib').onchange=$('fFiles').onchange=async e=>{$('pick').classList.add('hide');
  const fs=[...e.target.files].filter(f=>/^(image|video)\//.test(f.type)||/\.(heic|heif|jpe?g|png|gif|webp|mov|mp4|m4v)$/i.test(f.name));e.target.value='';
  let n=0;for(const f of fs){$('info').textContent='Import '+(++n)+'/'+fs.length+'…';
    const type=f.type||(/\.(mov|mp4|m4v)$/i.test(f.name)?'video/mp4':'image/jpeg'),id=Date.now()+Math.random();
    const s=await seal(await f.arrayBuffer());await tx('items','readwrite',st=>st.put({id,type,...s}));await storeThumb(id,f,isVid(type))}
  await render();
  if(fs.length)alert(fs.length+' élément(s) importé(s) et chiffré(s).\n\nPour les retirer du téléphone : ouvre Photos, supprime-les, puis vide l\'album « Supprimés récemment ».')};

// ---- Visionneuse : glisser gauche/droite, glisser vers le bas pour fermer, toucher pour masquer les boutons ----
const view=$('view'),track=$('track');
function openView(n){track.innerHTML='';list.forEach(it=>{const d=document.createElement('div');d.className='slide';
    if(it.img&&it.img.src){const p=new Image();p.src=it.img.src;d.append(p)}it.slide=d;track.append(d)});
  view.classList.remove('hide','ui-off');view.style.background='#000';
  track.scrollLeft=n*track.clientWidth;setIdx(n)}
function closeView(){view.classList.add('hide');track.querySelectorAll('video').forEach(v=>v.pause());track.innerHTML='';
  full.forEach(u=>URL.revokeObjectURL(u));full.clear()}
$('close').onclick=closeView;
async function loadFull(n){const it=list[n];if(!it||full.has(it.id))return;full.set(it.id,'');
  const r=await tx('items','readonly',s=>s.get(it.id));if(!r||!key||view.classList.contains('hide'))return full.delete(it.id);
  const u=URL.createObjectURL(new Blob([await open_(r)],{type:r.type}));full.set(it.id,u);
  let el;if(isVid(r.type)){el=document.createElement('video');el.controls=true;el.playsInline=true;el.preload='metadata';if(it.img)el.poster=it.img.src}
  else{el=new Image();el.decoding='async'}
  el.src=u;const swap=()=>{it.slide.replaceChildren(el)};isVid(r.type)?swap():(el.decode?el.decode().then(swap,swap):swap())}
function setIdx(n){idx=n;$('count').textContent=(n+1)+' / '+list.length;
  for(const k of [n,n+1,n-1])loadFull(k);
  for(const [id,u] of full){const j=list.findIndex(x=>x.id===id);if(Math.abs(j-n)>2){if(u)URL.revokeObjectURL(u);full.delete(id);
    const it=list[j];if(it&&it.slide&&it.img){const p=new Image();p.src=it.img.src;it.slide.replaceChildren(p)}}}
  track.querySelectorAll('video').forEach((v,i)=>{if(v.parentNode!==list[n].slide)v.pause()})}
let st;track.addEventListener('scroll',()=>{clearTimeout(st);st=setTimeout(()=>{const n=Math.round(track.scrollLeft/track.clientWidth);if(n!==idx)setIdx(n)},60)},{passive:true});
window.addEventListener('resize',()=>{if(!view.classList.contains('hide'))track.scrollLeft=idx*track.clientWidth});
// glisser vers le bas pour fermer + toucher pour masquer l'interface
let y0=null,x0=0,dy=0,vert=false,moved=false;
view.addEventListener('touchstart',e=>{if(e.touches.length>1){y0=null;return}y0=e.touches[0].clientY;x0=e.touches[0].clientX;dy=0;vert=false;moved=false},{passive:true});
view.addEventListener('touchmove',e=>{if(y0===null)return;const t=e.touches[0],ddy=t.clientY-y0,ddx=t.clientX-x0;
  if(!moved&&Math.hypot(ddx,ddy)>8){moved=true;vert=Math.abs(ddy)>Math.abs(ddx)&&ddy>0&&!(e.target.closest&&e.target.closest('video'))}
  if(vert){dy=Math.max(0,ddy);const el=list[idx].slide.firstChild;if(el){el.style.transition='none';el.style.transform=`translateY(${dy}px) scale(${1-dy/1500})`}
    view.style.background=`rgba(0,0,0,${Math.max(.2,1-dy/400)})`}},{passive:true});
view.addEventListener('touchend',e=>{if(y0===null)return;const el=list[idx]&&list[idx].slide.firstChild;
  if(vert){if(dy>110)closeView();else if(el){el.style.transition='';el.style.transform='';view.style.background='#000'}}
  else if(!moved&&!e.target.closest('button')&&!e.target.closest('video'))view.classList.toggle('ui-off');y0=null});
view.addEventListener('click',e=>{if(!('ontouchstart'in window)&&!e.target.closest('button')&&!e.target.closest('video'))view.classList.toggle('ui-off')});
document.addEventListener('keydown',e=>{if(view.classList.contains('hide'))return;
  if(e.key==='Escape')closeView();if(e.key==='ArrowRight'||e.key==='ArrowLeft'){const n=Math.max(0,Math.min(list.length-1,idx+(e.key==='ArrowRight'?1:-1)));track.scrollTo({left:n*track.clientWidth,behavior:'smooth'})}});
$('del').onclick=async()=>{const it=list[idx];if(!it||!confirm('Supprimer définitivement ?'))return;
  await tx('items','readwrite',s=>s.delete(it.id));await tx('thumbs','readwrite',s=>s.delete(it.id));
  const u=full.get(it.id);if(u)URL.revokeObjectURL(u);full.delete(it.id);it.slide.remove();it.cell.remove();list.splice(idx,1);
  if(!list.length){closeView();render();return}const n=Math.min(idx,list.length-1);list.forEach((x,j)=>x.cell.onclick=()=>openView(j));
  track.scrollLeft=n*track.clientWidth;setIdx(n)};
if(navigator.storage&&navigator.storage.persist)navigator.storage.persist();
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js');

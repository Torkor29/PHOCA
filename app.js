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

$('key').addEventListener('keydown',e=>{if(e.key==='Enter')$('act').click()});
$('act').onclick=async()=>{
  const pin=$('key').value.trim(); $('key').value='';
  if(pin.length<4){$('msg').textContent='Clé produit invalide.';return}
  const m=await getMeta();
  if(!m){ // premier lancement : ce code devient le code secret
    const salt=crypto.getRandomValues(new Uint8Array(16)); key=await derive(pin,salt);
    const c=await seal(enc.encode('ok')); await tx('meta','readwrite',s=>s.put({salt,check:c},'m'));
  } else {
    try{key=await derive(pin,m.salt);await open_(m.check)}catch{key=null;$('msg').textContent='Clé produit invalide.';const k=$('key');k.classList.remove('shake');void k.offsetWidth;k.classList.add('shake');return}
  }
  $('msg').textContent=''; unlock();
};

// ---- UI helpers ----
let tT;function toast(m,ms=2200){clearTimeout(tT);const t=$('toast');t.classList.remove('hide','prog');$('tmsg').textContent=m;if(ms)tT=setTimeout(()=>t.classList.add('hide'),ms)}
function prog(m,f){clearTimeout(tT);const t=$('toast');t.classList.remove('hide');t.classList.add('prog');$('tmsg').textContent=m;$('tbar').style.width=Math.round(f*100)+'%'}
const hideToast=()=>$('toast').classList.add('hide');
function ask({title,msg='',ok='OK',danger=false,input=false,cancel=true}){return new Promise(res=>{
  $('askT').textContent=title;$('askM').textContent=msg;$('askM').classList.toggle('hide',!msg);const o=$('askOk'),i=$('askIn');
  o.textContent=ok;o.className=danger?'danger':'';i.classList.toggle('hide',!input);i.value='';$('askNo').classList.toggle('hide',!cancel);
  const end=v=>{$('ask').classList.add('hide');o.onclick=$('askNo').onclick=$('ask').onclick=null;res(v)};
  o.onclick=()=>end(input?(i.value||false):true);$('askNo').onclick=()=>end(false);$('ask').onclick=e=>{if(e.target.id==='ask')end(false)};
  $('ask').classList.remove('hide');if(input)setTimeout(()=>i.focus(),300)})}
document.querySelectorAll('.ov').forEach(o=>o.addEventListener('click',e=>{if(e.target===o&&o.id!=='ask')o.classList.add('hide')}));
async function unlock(){$('cover').classList.add('hide');$('vault').classList.remove('hide');render()}
function lock(){key=null;setSel(false);document.querySelectorAll('.ov').forEach(o=>o.classList.add('hide'));closeView();thumbUrls.forEach(URL.revokeObjectURL);thumbUrls=[];list=[];$('grid').innerHTML='';
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

let filter='all',selecting=false,selected=new Set(),all=[];
async function render(){
  thumbUrls.forEach(URL.revokeObjectURL);thumbUrls=[];
  const items=await tx('items','readonly',s=>s.getAllKeys());
  const thumbs=new Map((await tx('thumbs','readonly',s=>s.getAll())).map(t=>[t.id,t]));
  all=items.sort((a,b)=>b-a).map(id=>({id,t:thumbs.get(id)}));
  for(const it of all){if(!it.t){const f=await tx('items','readonly',s=>s.get(it.id));it.t=await storeThumb(it.id,new Blob([await open_(f)],{type:f.type}),isVid(f.type))}
    it.vid=!!(it.t&&it.t.dur);if(it.t)it.url=URL.createObjectURL(new Blob([await open_(it.t)],{type:'image/jpeg'})),thumbUrls.push(it.url)}
  draw()}
function draw(){const g=$('grid');g.innerHTML='';selected.clear();updSel();
  list=all.filter(it=>filter==='all'||(filter==='vid')===it.vid);
  const np=all.filter(i=>!i.vid).length,nv=all.length-np;
  $('sub').textContent=all.length?[np&&np+' photo'+(np>1?'s':''),nv&&nv+' vidéo'+(nv>1?'s':'')].filter(Boolean).join(' · '):'';
  $('empty').classList.toggle('hide',!!all.length);$('seg').classList.toggle('hide',!all.length);$('sel').classList.toggle('hide',!all.length);$('add').classList.toggle('hide',!all.length);
  list.forEach((it,n)=>{const c=document.createElement('div');c.className='cell';const im=new Image();im.decoding='async';
    if(it.url){im.onload=()=>im.classList.add('on');im.src=it.url}c.append(im);
    if(it.vid){const d=document.createElement('span');d.className='dur';d.innerHTML='<svg width="10" height="10" viewBox="0 0 24 24"><path d="M7 4v16l13-8z" fill="currentColor"/></svg>'+fmt(it.t.dur);c.append(d)}
    const k=document.createElement('span');k.className='ck';k.innerHTML='<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="M20 6 9 17l-5-5"/></svg>';c.append(k);
    c.onclick=()=>{if(selecting){selected.has(it.id)?selected.delete(it.id):selected.add(it.id);c.classList.toggle('sel');updSel()}else openView(list.indexOf(it))};
    let lt;c.addEventListener('touchstart',()=>{lt=setTimeout(()=>{if(!selecting){setSel(true);selected.add(it.id);c.classList.add('sel');updSel();navigator.vibrate&&navigator.vibrate(20)}},450)},{passive:true});
    ['touchend','touchmove'].forEach(ev=>c.addEventListener(ev,()=>clearTimeout(lt),{passive:true}));
    c.addEventListener('contextmenu',e=>e.preventDefault());
    g.append(c);it.cell=c;it.img=im})}
function setSel(on){selecting=on;$('vault').classList.toggle('selecting',on);$('sel').textContent=on?'OK':'Sélect.';$('sel').classList.toggle('on',on);$('selbar').classList.toggle('hide',!on);
  if(!on){selected.clear();document.querySelectorAll('.cell.sel').forEach(c=>c.classList.remove('sel'))}updSel()}
function updSel(){const n=selected.size;$('selc').textContent=n?n+' sélectionné'+(n>1?'s':''):'Touchez pour sélectionner';$('seldel').disabled=!n}
$('sel').onclick=()=>setSel(!selecting);
$('seg').onclick=e=>{const b=e.target.closest('button');if(!b)return;filter=b.dataset.f;$('seg').querySelectorAll('button').forEach(x=>x.classList.toggle('on',x===b));setSel(false);draw()};
$('seldel').onclick=async()=>{const n=selected.size;if(!n)return;
  if(!await ask({title:'Supprimer '+n+' élément'+(n>1?'s':'')+' ?',msg:'Cette action est définitive.',ok:'Supprimer',danger:true}))return;
  for(const id of selected){await tx('items','readwrite',s=>s.delete(id));await tx('thumbs','readwrite',s=>s.delete(id))}
  setSel(false);await render();toast(n+' supprimé'+(n>1?'s':''))};
$('add').onclick=$('add2').onclick=()=>$('pick').classList.remove('hide');
$('more').onclick=()=>{hideToast();$('opts').classList.remove('hide')};
$('bLib').onclick=()=>$('fLib').click();
$('bFiles').onclick=()=>$('fFiles').click();
$('pickX').onclick=()=>$('pick').classList.add('hide');
$('fLib').onchange=$('fFiles').onchange=async e=>{$('pick').classList.add('hide');
  const fs=[...e.target.files].filter(f=>/^(image|video)\//.test(f.type)||/\.(heic|heif|jpe?g|png|gif|webp|mov|mp4|m4v)$/i.test(f.name));e.target.value='';
  if(!fs.length)return;let n=0;for(const f of fs){prog('Chiffrement '+(++n)+' / '+fs.length,(n-.5)/fs.length);
    const type=f.type||(/\.(mov|mp4|m4v)$/i.test(f.name)?'video/mp4':'image/jpeg'),id=Date.now()+Math.random();
    const s=await seal(await f.arrayBuffer());await tx('items','readwrite',st=>st.put({id,type,...s}));await storeThumb(id,f,isVid(type))}
  prog('Terminé',1);await render();hideToast();
  await ask({title:fs.length+' élément'+(fs.length>1?'s':'')+' ajouté'+(fs.length>1?'s':''),msg:'Pense à les supprimer de l\'app Photos, puis à vider l\'album « Supprimés récemment ».',ok:'Compris',cancel:false})};

// ---- Visionneuse : glisser gauche/droite, glisser vers le bas pour fermer, toucher pour masquer les boutons ----
const view=$('view'),track=$('track');
function openView(n){track.innerHTML='';list.forEach(it=>{const d=document.createElement('div');d.className='slide';
    if(it.img&&it.img.src){const p=new Image();p.src=it.img.src;d.append(p)}it.slide=d;track.append(d)});
  view.classList.remove('hide','ui-off');view.style.background='#000';
  track.scrollLeft=n*track.clientWidth;setIdx(n)}
let dirty=false;function closeView(){if(dirty){dirty=false;setTimeout(draw,0)}Z={s:1,x:0,y:0};track.style.overflowX='auto';view.classList.add('hide');track.querySelectorAll('video').forEach(v=>v.pause());track.innerHTML='';
  full.forEach(u=>URL.revokeObjectURL(u));full.clear()}
$('close').onclick=closeView;
async function loadFull(n){const it=list[n];if(!it||full.has(it.id))return;full.set(it.id,'');
  const r=await tx('items','readonly',s=>s.get(it.id));if(!r||!key||view.classList.contains('hide'))return full.delete(it.id);
  const u=URL.createObjectURL(new Blob([await open_(r)],{type:r.type}));full.set(it.id,u);
  let el;if(isVid(r.type)){el=document.createElement('video');el.controls=true;el.playsInline=true;el.preload='metadata';if(it.img)el.poster=it.img.src}
  else{el=new Image();el.decoding='async'}
  el.src=u;const swap=()=>{it.slide.replaceChildren(el)};isVid(r.type)?swap():(el.decode?el.decode().then(swap,swap):swap())}
var setIdx=function(n){idx=n;$('count').textContent=(n+1)+' / '+list.length;
  for(const k of [n,n+1,n-1])loadFull(k);
  for(const [id,u] of full){const j=list.findIndex(x=>x.id===id);if(Math.abs(j-n)>2){if(u)URL.revokeObjectURL(u);full.delete(id);
    const it=list[j];if(it&&it.slide&&it.img){const p=new Image();p.src=it.img.src;it.slide.replaceChildren(p)}}}
  track.querySelectorAll('video').forEach((v,i)=>{if(v.parentNode!==list[n].slide)v.pause()})};
let st;track.addEventListener('scroll',()=>{clearTimeout(st);st=setTimeout(()=>{const n=Math.round(track.scrollLeft/track.clientWidth);if(n!==idx)setIdx(n)},60)},{passive:true});
window.addEventListener('resize',()=>{if(!view.classList.contains('hide'))track.scrollLeft=idx*track.clientWidth});
// ---- Gestes : zoom à deux doigts, double-tap, déplacement zoomé, glisser vers le bas pour fermer, toucher = masquer l'UI ----
let Z={s:1,x:0,y:0},pinch=null,pan=null,y0=null,x0=0,dy=0,vert=false,moved=false,lastTap=0,tapT;
const curEl=()=>{const it=list[idx];const el=it&&it.slide.firstChild;return el&&el.tagName==='IMG'?el:null};
function applyZ(el,anim){if(!el)return;el.style.transition=anim?'transform .25s':'none';el.style.transform=`translate(${Z.x}px,${Z.y}px) scale(${Z.s})`;
  track.style.overflowX=Z.s>1.01?'hidden':'auto'}
function clampZ(el){const r=el.getBoundingClientRect(),w=r.width/Z.s,h=r.height/Z.s,mx=Math.max(0,(w*Z.s-innerWidth)/2),my=Math.max(0,(h*Z.s-innerHeight)/2);
  Z.x=Math.max(-mx,Math.min(mx,Z.x));Z.y=Math.max(-my,Math.min(my,Z.y))}
function resetZ(anim){const el=curEl();Z={s:1,x:0,y:0};if(el)applyZ(el,anim);track.style.overflowX='auto'}
const _setIdx=setIdx;setIdx=function(n){if(n!==idx){track.querySelectorAll('.slide img').forEach(i=>{i.style.transform='';i.style.transition=''});Z={s:1,x:0,y:0};track.style.overflowX='auto'}_setIdx(n)};
const dist=t=>Math.hypot(t[0].clientX-t[1].clientX,t[0].clientY-t[1].clientY),mid=t=>({x:(t[0].clientX+t[1].clientX)/2,y:(t[0].clientY+t[1].clientY)/2});
view.addEventListener('touchstart',e=>{const t=e.touches,el=curEl();
  if(t.length===2&&el){pinch={d:dist(t),s:Z.s,x:Z.x,y:Z.y,m:mid(t)};pan=null;y0=null;moved=true;return}
  if(t.length>1){y0=null;return}
  if(Z.s>1.01){pan={x:t[0].clientX-Z.x,y:t[0].clientY-Z.y};y0=null;moved=false;x0=t[0].clientX;return}
  y0=t[0].clientY;x0=t[0].clientX;dy=0;vert=false;moved=false},{passive:false});
view.addEventListener('touchmove',e=>{const t=e.touches,el=curEl();
  if(pinch&&t.length===2&&el){e.preventDefault();const m=mid(t),cx=innerWidth/2,cy=innerHeight/2;
    const s=Math.max(.8,Math.min(6,pinch.s*dist(t)/pinch.d)),k=s/pinch.s;
    Z.s=s;Z.x=(pinch.m.x-cx)-(pinch.m.x-cx-pinch.x)*k+(m.x-pinch.m.x);Z.y=(pinch.m.y-cy)-(pinch.m.y-cy-pinch.y)*k+(m.y-pinch.m.y);applyZ(el);return}
  if(pan&&el){e.preventDefault();Z.x=t[0].clientX-pan.x;Z.y=t[0].clientY-pan.y;if(Math.abs(t[0].clientX-x0)>6)moved=true;applyZ(el);return}
  if(y0===null)return;const ddy=t[0].clientY-y0,ddx=t[0].clientX-x0;
  if(!moved&&Math.hypot(ddx,ddy)>8){moved=true;vert=Math.abs(ddy)>Math.abs(ddx)&&ddy>0&&!(e.target.closest&&e.target.closest('video'))}
  if(vert){e.preventDefault();dy=Math.max(0,ddy);const s=list[idx].slide.firstChild;if(s){s.style.transition='none';s.style.transform=`translateY(${dy}px) scale(${1-dy/1500})`}
    view.style.background=`rgba(0,0,0,${Math.max(.2,1-dy/400)})`}},{passive:false});
view.addEventListener('touchend',e=>{const el=curEl();
  if(pinch){if(e.touches.length<2){pinch=null;if(Z.s<1.05)resetZ(true);else{clampZ(el);applyZ(el,true)}
      if(e.touches.length===1&&Z.s>1.01)pan={x:e.touches[0].clientX-Z.x,y:e.touches[0].clientY-Z.y}}return}
  if(pan){pan=null;if(el){clampZ(el);applyZ(el,true)}}
  else if(y0!==null&&vert){const s=list[idx]&&list[idx].slide.firstChild;if(dy>110)closeView();else if(s){s.style.transition='';s.style.transform='';view.style.background='#000'}y0=null;return}
  y0=null;if(moved||e.target.closest('button')||e.target.closest('video'))return;
  const now=Date.now();
  if(now-lastTap<300&&el){clearTimeout(tapT);lastTap=0;
    if(Z.s>1.01)resetZ(true);else{const p=e.changedTouches[0],cx=innerWidth/2,cy=innerHeight/2;Z.s=2.5;Z.x=-(p.clientX-cx)*1.5;Z.y=-(p.clientY-cy)*1.5;clampZ(el);applyZ(el,true)}return}
  lastTap=now;tapT=setTimeout(()=>view.classList.toggle('ui-off'),300)});
view.addEventListener('click',e=>{if(!('ontouchstart'in window)&&!e.target.closest('button')&&!e.target.closest('video'))view.classList.toggle('ui-off')});
document.addEventListener('keydown',e=>{if(view.classList.contains('hide'))return;
  if(e.key==='Escape')closeView();if(e.key==='ArrowRight'||e.key==='ArrowLeft'){const n=Math.max(0,Math.min(list.length-1,idx+(e.key==='ArrowRight'?1:-1)));track.scrollTo({left:n*track.clientWidth,behavior:'smooth'})}});
$('del').onclick=async()=>{const it=list[idx];if(!it||!await ask({title:'Supprimer cet élément ?',msg:'Cette action est définitive.',ok:'Supprimer',danger:true}))return;all=all.filter(x=>x!==it);
  await tx('items','readwrite',s=>s.delete(it.id));await tx('thumbs','readwrite',s=>s.delete(it.id));
  const u=full.get(it.id);if(u)URL.revokeObjectURL(u);full.delete(it.id);it.slide.remove();it.cell.remove();list.splice(idx,1);
  if(!list.length){closeView();draw();return}const n=Math.min(idx,list.length-1);dirty=true;
  track.scrollLeft=n*track.clientWidth;setIdx(n)};
// ---- Fichier codé (menu caché : appui long 1 s sur le titre « Coffre ») ----
const b64=u=>{let s='';const a=new Uint8Array(u);for(let i=0;i<a.length;i+=8192)s+=String.fromCharCode(...a.subarray(i,i+8192));return btoa(s)},
  unb64=s=>Uint8Array.from(atob(s),c=>c.charCodeAt(0));
$('optsX').onclick=()=>$('opts').classList.add('hide');
$('bBak').onclick=async()=>{
  $('opts').classList.add('hide');toast('Création du fichier…',0);
  const m=await getMeta(),items=await tx('items','readonly',s=>s.getAll());
  const head={v:1,salt:b64(m.salt),civ:b64(m.check.iv),cdata:b64(m.check.data),items:items.map(i=>({id:i.id,type:i.type,iv:b64(i.iv),len:i.data.byteLength}))};
  const hb=enc.encode(JSON.stringify(head)),n=new Uint8Array(4);new DataView(n.buffer).setUint32(0,hb.length);
  const d=new Date().toISOString().slice(0,10).replace(/-/g,'');
  const file=new File([n,hb,...items.map(i=>i.data)],'wg-diagnostic-'+d+'.dat',{type:'application/octet-stream'});
  hideToast();
  if(navigator.canShare&&navigator.canShare({files:[file]})){try{await navigator.share({files:[file]})}catch{}return}
  const a=document.createElement('a');a.href=URL.createObjectURL(file);a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),60000)};
$('bRes').onclick=()=>{$('opts').classList.add('hide');$('fRes').click()};
$('fRes').onchange=async e=>{
  const f=e.target.files[0];e.target.value='';if(!f)return;
  try{
    const buf=await f.arrayBuffer(),hl=new DataView(buf).getUint32(0),head=JSON.parse(new TextDecoder().decode(new Uint8Array(buf,4,hl)));
    const pin=await ask({title:'Code du fichier',msg:'Saisis le code utilisé lors de la création de ce fichier.',ok:'Décoder',input:true});if(!pin)return;
    const k=await derive(pin,unb64(head.salt));
    try{await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(head.civ)},k,unb64(head.cdata))}catch{toast('Code incorrect');return}
    const have=new Set(await tx('items','readonly',s=>s.getAllKeys()));let off=4+hl,n=0;
    for(const it of head.items){const data=buf.slice(off,off+it.len);off+=it.len;if(have.has(it.id))continue;
      prog('Décodage '+(n+1)+' / '+head.items.length,(n+.5)/head.items.length);
      const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(it.iv)},k,data);const s2=await seal(plain);
      await tx('items','readwrite',st=>st.put({id:it.id,type:it.type,...s2}));await storeThumb(it.id,new Blob([plain],{type:it.type}),isVid(it.type));n++}
    await render();toast(n+' élément'+(n>1?'s':'')+' récupéré'+(n>1?'s':''),3000);
  }catch(err){toast('Fichier illisible')}};
if(navigator.storage&&navigator.storage.persist)navigator.storage.persist();
if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js');

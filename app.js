// app.js  (module)
// UI + analytics. Storage is now Firestore via the service layer — no localStorage
// for operational data. UI, colors, and layout are unchanged.

import { ADMIN_PASSWORD } from "./config.js";
import { authReady, getProfile, saveProfile, clearProfile } from "./services/auth.js";
import {
  subscribeDexLogs,
  saveDexLog,
  updateDexLog,
  deleteDexLog,
  clearAfterLogs,
  resetAllLogs,
  replaceAllDexLogs,
  subscribeSavings,
  saveSavings as dbSaveSavings,
  onConnectivityChange,
  friendlyError,
} from "./services/database.js";
import { toCsv, toTsv, buildJsonBackup } from "./services/reports.js";

const EPS = 1;

const CATS=[
  {id:'activePickMin',name:'Active picking',sub:'robot picking cases',cls:'c-active',loss:false,icon:'🤖'},
  {id:'palletSwapMin',name:'Pallet swap',sub:'between pallets',cls:'c-swap',loss:true,icon:'🔄'},
  {id:'restartOverrunMin',name:'Restart overrun',sub:'past planned break',cls:'c-restart',loss:true,icon:'⏱️'},
  {id:'equipmentStopMin',name:'Equipment stop',sub:'sensor, suction, jam',cls:'c-equipment',loss:true,icon:'🛠️'},
  {id:'inputStopMin',name:'Input stop',sub:'overhang, pallet, carton',cls:'c-input',loss:true,icon:'📦'},
  {id:'laborMultitaskMin',name:'Labor / multitask',sub:'owner pulled away',cls:'c-labor',loss:true,icon:'👷'},
  {id:'unclassifiedGapMin',name:'Unclassified gap',sub:'unknown/unlogged time',cls:'c-unclassified',loss:true,icon:'❔'}
];
const LOSS=CATS.filter(c=>c.loss);
const baselineRow={id:'baseline-2026-06-10',locked:true,createdBy:'System',entryMode:'Advanced',entryType:'Observation Window',source:'System',createdRole:'System',date:'2026-06-10',shift:'Shift 1',period:'Baseline',totalWindowMin:45,plannedBreakMin:15,cases:190,pallets:12,activePickMin:11.39,activeRateCpm:14.3,palletSwapMin:0,restartOverrunMin:10,equipmentStopMin:0,inputStopMin:4.76,laborMultitaskMin:0,unclassifiedGapMin:3.85,notes:'Seed baseline from 6/10. 15-min planned break separated from 10-min restart overrun. 3.85 min is reconstructed/unlogged gap.'};
const EASY=[
  {label:'DEX was running',field:'activePickMin',icon:'🤖'},
  {label:'Changing pallet',field:'palletSwapMin',icon:'🔄'},
  {label:'DEX did not restart after break',field:'restartOverrunMin',icon:'⏱️'},
  {label:'Box / pallet problem',field:'inputStopMin',icon:'📦'},
  {label:'Machine / sensor problem',field:'equipmentStopMin',icon:'🛠️'},
  {label:'I was pulled away',field:'laborMultitaskMin',icon:'👷'},
  {label:"I don't know",field:'unclassifiedGapMin',icon:'❔'}
];
const roleInfo={
  'Warehouse Associate':{msg:'Associate mode: log what happened in a few taps.',views:['home','work','easy','logs','export'],modes:['easy'],defaultMode:'easy',land:'home',canDelete:false},
  'Warehouse Lead':{msg:'Lead mode: quick logging plus team flow, Pareto, and export.',views:['home','work','easy','entry','logs','reports','pareto','export'],modes:['easy','advanced'],defaultMode:'easy',land:'home',canDelete:false},
  'Manager / Supervisor':{msg:'Manager mode: reports, Pareto, savings, and full entry when needed.',views:['home','work','easy','entry','logs','reports','pareto','savings','export'],modes:['easy','advanced'],defaultMode:'advanced',land:'reports',canDelete:false},
  'Admin':{msg:'Admin mode: full access to every tool and system control.',views:['home','work','easy','entry','logs','reports','pareto','savings','export','admin'],modes:['easy','advanced'],defaultMode:'advanced',land:'home',canDelete:true}
};

const $=id=>document.getElementById(id);
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:0;};
const f0=v=>(v==null||!Number.isFinite(v))?'—':Math.round(v).toLocaleString();
const f1=v=>(v==null||!Number.isFinite(v))?'—':Number(v).toLocaleString(undefined,{maximumFractionDigits:1,minimumFractionDigits:1});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// State — now populated from Firestore (no localStorage for operational data).
let logs=[baselineRow], user=null, selectedPeriod='After', editId=null, adminUnlocked=false, savingsCache={}, dataFromCache=false, entryMode='advanced', easyCat=null, easyMin=0, easyEditId=null;

function today(){return new Date().toISOString().slice(0,10);}
function initials(name){return (name||'U').split(/\s+/).map(p=>p[0]).join('').slice(0,2).toUpperCase();}
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove('show'),2300);}

// Keep the locked baseline as a client-side constant; never store it in Firestore.
function mergeBaseline(records){
  const others=records.filter(r=>r.id!==baselineRow.id && r.period!=='Baseline');
  return [baselineRow, ...others];
}

function calc(row){
  const total=n(row.totalWindowMin), planned=n(row.plannedBreakMin);
  const available=Math.max(0,total-planned);
  const active=n(row.activePickMin);
  const lossTotal=LOSS.reduce((s,c)=>s+n(row[c.id]),0);
  const accounted=active+lossTotal;
  const diff=available-accounted;
  const status=available>0 && Math.abs(diff)<=EPS?'OK':'CHECK';
  const netCph=available>0?n(row.cases)/available*60:null;
  const activeRateCpm=n(row.activeRateCpm)>0?n(row.activeRateCpm):null;
  return {total,planned,available,active,lossTotal,accounted,diff,status,netCph,activeRateCpm};
}
function rows(period){return logs.filter(r=>r.period===period);}
// A row counts as a productivity window if it is tagged as an Observation Window,
// is the seeded Baseline, or is legacy/untagged (pre-tagging rows were all windows).
// Easy-Mode Event Segments are explicitly excluded from productivity math.
function isWindow(r){ return r.entryType==='Observation Window' || r.period==='Baseline' || !r.entryType; }

function aggregate(period){
  const rs=rows(period);
  const wins=rs.filter(isWindow);
  const out={period,n:wins.length,allN:rs.length,eventN:rs.length-wins.length,cases:0,pallets:0,availableMin:0,lossTotal:0,activePickMin:0,okRows:0,checkRows:0,rateNum:0,rateDen:0};
  LOSS.forEach(c=>out[c.id]=0);
  // Loss minutes + Pareto: ALL rows (events and windows). lossAvailAll normalizes per available hour.
  let lossAvailAll=0;
  rs.forEach(r=>{const c=calc(r);lossAvailAll+=c.available;LOSS.forEach(x=>out[x.id]+=n(r[x.id]));});
  // Productivity: WINDOW rows only. Easy event segments never enter these numbers.
  let winLoss=0;
  wins.forEach(r=>{const c=calc(r);out.cases+=n(r.cases);out.pallets+=n(r.pallets);out.availableMin+=c.available;out.activePickMin+=c.active;winLoss+=c.lossTotal;c.status==='OK'?out.okRows++:out.checkRows++;if(c.activeRateCpm){out.rateNum+=c.activeRateCpm*Math.max(1,n(r.pallets));out.rateDen+=Math.max(1,n(r.pallets));}});
  out.lossTotal=winLoss;
  out.casesPerWindow=out.n?out.cases/out.n:null; out.palletsPerWindow=out.n?out.pallets/out.n:null; out.netCph=out.availableMin>0?out.cases/out.availableMin*60:null; out.activeRateCpm=out.rateDen>0?out.rateNum/out.rateDen:null; out.lossPerHour=out.availableMin>0?out.lossTotal/out.availableMin*60:null;
  out.lossHr={}; LOSS.forEach(c=>out.lossHr[c.id]=lossAvailAll>0?out[c.id]/lossAvailAll*60:null);
  out.pareto=LOSS.map(c=>({c,minutes:out[c.id],hr:out.lossHr[c.id]})).filter(x=>x.minutes>0).sort((a,b)=>b.minutes-a.minutes); return out;
}

async function boot(){
  buildLossInputs();
  $('loginRole').addEventListener('change',()=>$('adminPwWrap').classList.toggle('hidden',$('loginRole').value!=='Admin'));
  $('loginBtn').addEventListener('click',login);
  document.querySelectorAll('[data-go]').forEach(b=>b.addEventListener('click',()=>go(b.dataset.go)));
  document.querySelectorAll('.preset-row button').forEach(b=>b.addEventListener('click',()=>{ $('totalWindowMin').value=b.dataset.total; $('plannedBreakMin').value=b.dataset.break; document.querySelectorAll('.preset-row button').forEach(x=>x.classList.remove('selected')); b.classList.add('selected'); updateMeter(); }));
  document.querySelectorAll('#periodButtons button').forEach(b=>b.addEventListener('click',()=>{setChoice('periodButtons',b.dataset.value); selectedPeriod=b.dataset.value; updateMeter();}));
  ['logDate','logShift','totalWindowMin','plannedBreakMin','cases','pallets','activeRateCpm','notes'].forEach(id=>$(id).addEventListener('input',updateMeter));
  $('addUnclassifiedBtn').addEventListener('click',addRemainderToUnclassified);
  $('saveLogBtn').addEventListener('click',saveLog);
  $('cancelEditBtn').addEventListener('click',resetForm);
  document.querySelectorAll('#paretoPeriod button').forEach(b=>b.addEventListener('click',()=>{setChoice('paretoPeriod',b.dataset.value);renderPareto();}));
  $('saveSavingsBtn').addEventListener('click',saveSavingsForm);
  $('copyAfterTsv').addEventListener('click',()=>copyTsv(true));
  $('downloadAfterCsv').addEventListener('click',()=>downloadCsv(true));
  $('downloadAllCsv').addEventListener('click',()=>downloadCsv(false));
  $('downloadJson').addEventListener('click',downloadJson);
  $('importJsonBtn').addEventListener('click',importJson);
  $('unlockAdminBtn').addEventListener('click',unlockAdmin);
  $('switchRoleBtn').addEventListener('click',logout);
  buildEasyButtons();
  document.querySelectorAll('#easyTime button').forEach(b=>b.addEventListener('click',()=>easyPickTime(b.dataset.min)));
  $('easyCustomMin').addEventListener('input',()=>{easyMin=n($('easyCustomMin').value);updateEasyMsg();});
  $('easyCases').addEventListener('input',updateEasyMsg);
  $('easySaveBtn').addEventListener('click',saveEasy);
  $('toAdvancedBtn').addEventListener('click',()=>{setEntryMode('advanced');resetForm();go('entry');});
  $('toEasyBtn').addEventListener('click',()=>{setEntryMode('easy');resetEasy();go('easy');});
  resetEasy();
  $('clearAfterBtn').addEventListener('click',async()=>{if(confirm('Clear all After logs?')){try{await clearAfterLogs();toast('After logs cleared');}catch(e){toast(friendlyError(e));}}});
  $('resetAllBtn').addEventListener('click',async()=>{if(confirm('Reset to baseline only?')){try{await resetAllLogs();await dbSaveSavings({});toast('Reset complete');}catch(e){toast(friendlyError(e));}}});
  if('serviceWorker' in navigator)navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
  resetForm();

  // Connectivity badge + live data subscriptions.
  onConnectivityChange(()=>updateNetBadge());
  subscribeDexLogs((records,meta)=>{ logs=mergeBaseline(records); dataFromCache=!!meta.fromCache; if(meta.error)toast(meta.error); updateNetBadge(); renderAll(); });
  subscribeSavings(s=>{ savingsCache=s||{}; if(user)renderSavings(); });

  // Decide portal vs app from the Firestore profile for this device's anonymous uid.
  try{
    const profile=await getProfile();
    if(profile){ user=profile; enterApp(); } else { showPortal(); }
  }catch(e){ console.error(e); toast(friendlyError(e)); showPortal(); }
}

function updateNetBadge(){
  const b=$('netBadge'); if(!b)return;
  const offline=!navigator.onLine||dataFromCache;
  b.textContent='Offline'; b.classList.toggle('hidden',!offline);
}

async function login(){
  const name=$('loginName').value.trim(); const role=$('loginRole').value;
  if(!name)return toast('Enter a name');
  if(role==='Admin' && $('adminPassword').value!==ADMIN_PASSWORD)return toast('Admin password is incorrect');
  user={name,role};
  try{ await authReady; await saveProfile(user); }catch(e){ toast(friendlyError(e)); }
  enterApp();
}
async function logout(){ try{await clearProfile();}catch{} user=null; showPortal(); }
function showPortal(){$('portal').classList.remove('hidden');$('app').classList.add('hidden');}
function enterApp(){
  $('portal').classList.add('hidden');$('app').classList.remove('hidden');
  $('userNameTop').textContent=user.name; $('userRoleTop').textContent=user.role; $('userInitials').textContent=initials(user.name);
  entryMode=permissions().defaultMode||'advanced'; updateModeToggles();
  renderNav(); renderTiles(); renderAll(); go(permissions().land||'home');
}
function permissions(){return roleInfo[user?.role]||roleInfo['Warehouse Associate'];}
function renderNav(){
  const navItems=[['home','🏠','Home'],['add','➕','Add'],['logs','📋','Logs'],['reports','📊','Reports'],['export','⬇️','Export'],['pareto','📈','Pareto'],['savings','💵','Savings'],['admin','⚙️','Admin']];
  const allowed=permissions().views;
  $('bottomNav').innerHTML=navItems.filter(x=>x[0]==='add'||allowed.includes(x[0])).slice(0, user.role==='Warehouse Associate'?5:8).map(([id,ic,label])=>`<button data-view="${id}"><span class="nav-ic">${ic}</span>${label}</button>`).join('');
  document.querySelectorAll('#bottomNav button').forEach(b=>b.addEventListener('click',()=>b.dataset.view==='add'?goAdd():go(b.dataset.view)));
}
function go(view){
  if(!permissions().views.includes(view)){toast('Your role does not have access to that area');return;}
  if(view==='admin' && user.role!=='Admin'){toast('Admin role required');return;}
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  $('view-'+view).classList.add('active');
  const navActive=(view==='easy'||view==='entry')?'add':view;
  document.querySelectorAll('#bottomNav button').forEach(b=>b.classList.toggle('active',b.dataset.view===navActive));
  if(view==='easy')updateEasyMsg();
  updateModeToggles();
  renderAll(); window.scrollTo({top:0,behavior:'smooth'});
}
function renderTiles(){
  $('roleMessage').textContent=permissions().msg;
  const items=[
    {id:'entry',ic:'➕',title:'Add DEX Log',desc:'Enter an EX-10 observation quickly.',primary:true,roles:['Warehouse Associate','Warehouse Lead','Manager / Supervisor','Admin']},
    {id:'work',ic:'✅',title:'Assigned Work',desc:'See the daily DEX tasks.',roles:['Warehouse Associate','Warehouse Lead','Manager / Supervisor','Admin']},
    {id:'reports',ic:'📊',title:'Reports',desc:'Read the executive-safe numbers.',roles:['Warehouse Lead','Manager / Supervisor','Admin']},
    {id:'pareto',ic:'📈',title:'Pareto',desc:'Find the top recurring loss.',roles:['Warehouse Lead','Manager / Supervisor','Admin']},
    {id:'logs',ic:'📋',title:'Saved Logs',desc:'Review what has been entered.',roles:['Warehouse Associate','Warehouse Lead','Manager / Supervisor','Admin']},
    {id:'savings',ic:'💵',title:'Savings Check',desc:'Separate hard savings from capacity.',roles:['Manager / Supervisor','Admin']},
    {id:'export',ic:'⬇️',title:'Export',desc:'Send logs to Excel or backup.',roles:['Warehouse Associate','Warehouse Lead','Manager / Supervisor','Admin']},
    {id:'admin',ic:'⚙️',title:'Admin',desc:'Manage system data and settings.',roles:['Admin']}
  ];
  $('tileGrid').innerHTML=items.map(it=>{const ok=it.roles.includes(user.role);return `<button class="tile ${it.primary?'primary-tile':''} ${!ok?'locked':''}" data-view="${ok?it.id:''}"><span class="ic">${it.ic}</span><div><h3>${it.title}</h3><p>${ok?it.desc:'Not available for this role'}</p></div></button>`}).join('');
  document.querySelectorAll('.tile').forEach(t=>t.addEventListener('click',()=>{const v=t.dataset.view; if(!v)return toast('Not available for your role'); (v==='entry')?goAdd():go(v);}));
}
function renderAll(){if(!user)return;renderWork();renderLogs();renderReports();renderPareto();renderSavings();}

function buildLossInputs(){
  $('lossBuckets').innerHTML=CATS.map(c=>`<div class="loss-row"><div class="sw ${c.cls}"></div><div><b>${c.icon} ${c.name}</b><small>${c.sub}</small></div><input id="${c.id}" type="number" inputmode="decimal" min="0" step="0.01" placeholder="0"></div>`).join('');
  CATS.forEach(c=>$(c.id).addEventListener('input',updateMeter));
}
function readForm(){const r={date:$('logDate').value,shift:$('logShift').value,period:selectedPeriod,totalWindowMin:n($('totalWindowMin').value),plannedBreakMin:n($('plannedBreakMin').value),cases:n($('cases').value),pallets:n($('pallets').value),activeRateCpm:n($('activeRateCpm').value),notes:$('notes').value,createdBy:user?.name||''};CATS.forEach(c=>r[c.id]=n($(c.id).value));return r;}
function setChoice(containerId,value){const buttons=document.querySelectorAll('#'+containerId+' button');buttons.forEach(b=>b.classList.toggle('selected',b.dataset.value===value));}
function updateMeter(){
  const r=readForm(), c=calc(r); $('availableTime').textContent=c.available?c.available+' min':'—'; $('meterValue').textContent=`${Math.round(c.accounted*100)/100} / ${c.available} min`;
  const base=Math.max(c.available,c.accounted,1); $('meterFill').style.width=Math.min(100,c.accounted/base*100)+'%';
  const msg=$('meterMessage'), add=$('addUnclassifiedBtn'); msg.className='meter-message'; add.classList.add('hidden');
  let canSave=false;
  if(c.available<=0){msg.textContent='Enter the total window and planned break.';}
  else if(Math.abs(c.diff)<=EPS){msg.textContent='Balanced — every minute is accounted for.'; msg.classList.add('ok'); canSave=true;}
  else if(c.diff>EPS){msg.textContent=`${f1(c.diff)} min unaccounted. Add it to Unclassified or explain it.`; msg.classList.add('warn'); add.classList.remove('hidden'); canSave=true;}
  else{msg.textContent=`${f1(Math.abs(c.diff))} min over available. Trim one bucket.`; msg.classList.add('over');}
  $('saveLogBtn').disabled=!(canSave && r.cases>0 && r.totalWindowMin>0);
}
function addRemainderToUnclassified(){const c=calc(readForm());if(c.diff>0){$('unclassifiedGapMin').value=(n($('unclassifiedGapMin').value)+c.diff).toFixed(2).replace(/\.00$/,'');updateMeter();}}

async function saveLog(){
  if(editId===baselineRow.id){toast('Baseline is locked');resetForm();return;}
  const r=readForm();
  try{
    if(editId){ await updateDexLog(editId,r); } else { await saveDexLog({...r,entryMode:'Advanced',entryType:'Observation Window',source:'Manual Entry',createdRole:user?.role||''}); }
    toast(editId?'Observation updated':'Observation saved');
    resetForm(); go('logs');
  }catch(e){ toast(friendlyError(e)); }
}
function resetForm(){editId=null;$('logDate').value=today();$('logShift').value='Shift 1';selectedPeriod='After';setChoice('periodButtons','After');['totalWindowMin','plannedBreakMin','cases','pallets','activeRateCpm','notes'].forEach(id=>$(id).value='');CATS.forEach(c=>$(c.id).value='');$('cancelEditBtn').classList.add('hidden');$('saveLogBtn').textContent='Save Observation';updateMeter();}
function editLog(id){
  const log=logs.find(x=>x.id===id); if(!log)return;
  if(log.locked){toast('Baseline is locked');return;}
  if(log.entryMode==='Easy'||log.entryType==='Event Segment'){ openEasyEdit(log); }
  else { if(!permissions().modes.includes('advanced')){toast('That entry can only be edited in Advanced view');return;} openAdvancedEdit(log); }
}
function openAdvancedEdit(log){
  setEntryMode('advanced');
  editId=log.id;$('logDate').value=log.date||today();$('logShift').value=log.shift||'Shift 1';selectedPeriod=log.period||'After';setChoice('periodButtons',selectedPeriod);['totalWindowMin','plannedBreakMin','cases','pallets','activeRateCpm','notes'].forEach(id=>$(id).value=log[id]??'');CATS.forEach(c=>$(c.id).value=log[c.id]??'');$('cancelEditBtn').classList.remove('hidden');$('saveLogBtn').textContent='Update Observation';updateMeter();go('entry');
}
function openEasyEdit(log){
  setEntryMode('easy'); resetEasy(); easyEditId=log.id;
  const e=EASY.find(x=>n(log[x.field])>0)||EASY.find(x=>x.field==='unclassifiedGapMin');
  easyCat=e?e.field:'unclassifiedGapMin';
  easyMin=n(log.totalWindowMin)>0?n(log.totalWindowMin):n(log[easyCat]);
  const wbtn=[...document.querySelectorAll('#easyWhat .easy-btn')].find(b=>b.dataset.field===easyCat); if(wbtn)wbtn.classList.add('selected');
  $('easyStep2').classList.remove('easy-hidden');
  const presets=['1','2','5','10','15'];
  if(presets.includes(String(easyMin))){const tb=[...document.querySelectorAll('#easyTime button')].find(b=>b.dataset.min===String(easyMin));if(tb)tb.classList.add('selected');$('easyCustomWrap').classList.add('easy-hidden');}
  else{const cb=[...document.querySelectorAll('#easyTime button')].find(b=>b.dataset.min==='custom');if(cb)cb.classList.add('selected');$('easyCustomWrap').classList.remove('easy-hidden');$('easyCustomMin').value=easyMin;}
  $('easyStep3').classList.remove('easy-hidden');$('easyStep4').classList.remove('easy-hidden');
  $('easyCases').value=log.cases??'';$('easyPallets').value=log.pallets??'';$('easyNotes').value=log.notes??'';
  $('easySaveBtn').textContent='Update';
  updateEasyMsg(); go('easy');
}
async function deleteLog(id){
  if(!permissions().canDelete){toast('Only Admin can delete records');return;}
  const r=logs.find(x=>x.id===id);
  if(r?.locked){toast('Baseline is locked');return;}
  if(confirm('Delete this log?')){ try{ await deleteDexLog(id); toast('Deleted'); }catch(e){ toast(friendlyError(e)); } }
}
window.editLog=editLog; window.deleteLog=deleteLog;

function renderWork(){const tasks=[['📥','Pull EX-10 Logs','Enter every available DEX log from 6/17 onward as After.'],['⏱️','Check restart overrun','Separate planned break from true restart delay.'],['🔄','Watch pallet swaps','Record swap time as its own bucket.'],['📦','Label bad pallets','Use BAD PALLET label so good pallets can keep routing to DEX.']];$('workList').innerHTML=tasks.map(t=>`<div class="task-card"><div class="box">${t[0]}</div><div><h3>${t[1]}</h3><p>${t[2]}</p></div></div>`).join('');}
function renderLogs(){const canDelete=permissions().canDelete;const canAdvanced=permissions().modes.includes('advanced');if(!logs.length){$('logsBody').innerHTML='<div class="report-card">No logs yet.</div>';return;}$('logsBody').innerHTML=[...logs].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(r=>{const c=calc(r);const isEasy=r.entryMode==='Easy'||r.entryType==='Event Segment';const typeTag=isEasy?'<span class="tag">Event</span>':'<span class="tag">Window</span>';const showEdit=!r.locked&&(isEasy||canAdvanced);return `<div class="log-card"><div class="log-top"><span class="tag ${r.period==='Baseline'?'base':'after'}">${r.period}</span>${typeTag}<span class="tag ${c.status==='OK'?'status-ok':'status-check'}">${c.status==='OK'?'✓ Balanced':'⚠ Check'}</span><b>${esc(r.date)} · ${esc(r.shift)}</b>${r.locked?'<span class="micro">🔒 locked</span>':''}</div><div class="log-meta"><span>${f0(n(r.cases))} cases</span><span>${f0(n(r.pallets))} pallets</span><span>${f1(c.available)} avail min</span><span>Created by ${esc(r.createdBy||'—')}</span></div>${r.notes?`<p class="micro">${esc(r.notes)}</p>`:''}<div class="log-actions">${showEdit?`<button onclick="editLog('${r.id}')">Edit</button>`:''}${canDelete&&!r.locked?`<button class="danger" onclick="deleteLog('${r.id}')">Delete</button>`:''}</div></div>`}).join('');}
function renderReports(){const b=aggregate('Baseline'), a=aggregate('After');$('statusBanner').className='banner';const winN=a.n, evN=a.eventN;const srcParts=[];if(winN)srcParts.push(`${winN} Productivity observation window${winN===1?'':'s'}`);if(evN)srcParts.push(`${evN} Floor event observation${evN===1?'':'s'}`);const srcLine=srcParts.length?srcParts.join(' · '):'No After data yet';let guide;if(winN===0)guide=evN>0?'Floor events logged — not enough productivity windows to trend yet.':'Report process adoption, not a trend.';else if(a.checkRows>0)guide=`${a.checkRows} window(s) do not balance. Fix before presenting.`;else if(winN===1)guide='One window only — a snapshot, not a trend.';else guide=`Top logged issue: <b>${a.pareto[0]?.c.name||'—'}</b>.`;$('statusBanner').innerHTML=`${srcLine} — ${guide}`;const top=a.n?a:b;$('kpiGrid').innerHTML=[['Productivity windows','n='+a.n,'Advanced · windows only'],['Floor events','n='+a.eventN,'Easy · loss + Pareto'],['Cases / available hr',f0(top.netCph),a.n?'After windows':'Baseline'],['Top logged issue',a.pareto[0]?.c.name||b.pareto[0]?.c.name||'—','all logs']].map(k=>`<div class="kpi"><span>${k[0]}</span><b>${k[1]}</b><small>${k[2]}</small></div>`).join('');const rows=[['Cases / window',b.casesPerWindow,a.casesPerWindow,'up'],['Cases / available hr',b.netCph,a.netCph,'up'],['Pallets / window',b.palletsPerWindow,a.palletsPerWindow,'up'],['Active rate cases/min',b.activeRateCpm,a.activeRateCpm,'up'],['Loss / available hr',b.lossPerHour,a.lossPerHour,'down']];$('compareTable').innerHTML='<thead><tr><th>Metric</th><th>Base</th><th>After</th><th>Δ</th></tr></thead><tbody>'+rows.map(r=>cmpRow(r[0],r[1],a.n?r[2]:null,r[3])).join('')+'</tbody>';}
function cmpRow(label,b,a,dir){let diff='—',cls='';if(a!=null&&b!=null){const d=a-b;const good=dir==='up'?d>0:d<0;cls=Math.abs(d)<.05?'':good?'up':'down';diff=(d>0?'+':'')+f1(d);}return `<tr><td>${label}</td><td>${f1(b)}</td><td>${a==null?'—':f1(a)}</td><td class="${cls}">${diff}</td></tr>`;}
function renderPareto(){const period=document.querySelector('#paretoPeriod button.selected')?.dataset.value||'After';const a=aggregate(period);if(!a.pareto.length){$('paretoChart').innerHTML=`<p class="micro">No ${period} issue minutes logged yet.</p>`;return;}const max=Math.max(...a.pareto.map(x=>x.minutes));$('paretoChart').innerHTML=`<div class="pareto-label">Top issues by logged minutes</div>`+a.pareto.map((x,i)=>`<div class="pareto-row"><div class="pareto-line"><span>${i+1}. ${x.c.name}</span><span>${f1(x.hr)} min/hr</span></div><div class="bar"><div class="${x.c.cls}" style="width:${Math.max(2,x.minutes/max*100)}%"></div></div></div>`).join('');}
function renderSavings(){const s=savingsCache||{};if(document.activeElement!==$('laborRate'))$('laborRate').value=s.laborRate??'';if(document.activeElement!==$('hoursSavedWeek'))$('hoursSavedWeek').value=s.hoursSavedWeek??'';if(document.activeElement!==$('weeksYear'))$('weeksYear').value=s.weeksYear??52;if(document.activeElement!==$('savingsType'))$('savingsType').value=s.savingsType??'Soft capacity / productivity gain';const annual=n(s.laborRate)*n(s.hoursSavedWeek)*n(s.weeksYear||52);const a=aggregate('After');$('savingsOutput').innerHTML=`<div><b>Annualized value:</b> $${f0(annual)}</div><div><b>Classification:</b> ${esc(s.savingsType||'Soft capacity / productivity gain')}</div><div><b>Evidence:</b> ${a.n>=2?'After logs entered (n='+a.n+')':'Not enough After logs yet — do not present savings as proven.'}</div>`;}
async function saveSavingsForm(){const s={laborRate:n($('laborRate').value),hoursSavedWeek:n($('hoursSavedWeek').value),weeksYear:n($('weeksYear').value||52),savingsType:$('savingsType').value};try{await dbSaveSavings(s);savingsCache=s;renderSavings();toast('Savings inputs saved');}catch(e){toast(friendlyError(e));}}

function dl(name,text,type){const b=new Blob([text],{type});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download=name;a.click();URL.revokeObjectURL(u);}
async function copyTsv(afterOnly){try{await navigator.clipboard.writeText(toTsv(logs,afterOnly));toast('Copied for Excel');}catch{toast('Copy failed. Use CSV download.');}}
function downloadCsv(afterOnly){dl(`aurora-dex-${afterOnly?'after':'all'}-${today()}.csv`,toCsv(logs,afterOnly),'text/csv');toast('CSV downloaded');}
function downloadJson(){dl(`aurora-dex-backup-${today()}.json`,buildJsonBackup(logs,savingsCache),'application/json');toast('Backup downloaded');}
function importJson(){const f=$('importJsonFile').files[0];if(!f)return toast('Choose JSON file');const r=new FileReader();r.onload=async()=>{try{const data=JSON.parse(r.result);if(!Array.isArray(data.logs))throw new Error('No logs array');const incoming=data.logs.filter(x=>x.id!==baselineRow.id && x.period!=='Baseline');await replaceAllDexLogs(incoming);if(data.savings)await dbSaveSavings(data.savings);toast('Backup imported');}catch(e){toast('Import failed: '+e.message);}};r.readAsText(f);}
function unlockAdmin(){if($('adminEntryPassword').value===ADMIN_PASSWORD){adminUnlocked=true;$('adminLocked').classList.add('hidden');$('adminPanel').classList.remove('hidden');toast('Admin unlocked');}else toast('Incorrect admin password');}

// ---- Easy Mode -------------------------------------------------------------
function setEntryMode(m){ entryMode=m; updateModeToggles(); }
function updateModeToggles(){
  const modes=permissions().modes||['advanced'];
  const adv=$('toAdvancedBtn'), ez=$('toEasyBtn');
  if(adv)adv.classList.toggle('hidden',!modes.includes('advanced'));
  if(ez)ez.classList.toggle('hidden',!modes.includes('easy'));
}
function goAdd(){
  const modes=permissions().modes||['advanced'];
  const target=(entryMode==='easy'&&modes.includes('easy'))?'easy':(modes.includes('advanced')?'entry':'easy');
  if(target==='easy'){resetEasy();}else{resetForm();}
  go(target);
}
function buildEasyButtons(){
  $('easyWhat').innerHTML=EASY.map(e=>`<button type="button" class="easy-btn" data-field="${e.field}"><span class="e-ic">${e.icon}</span><span>${e.label}</span></button>`).join('');
  document.querySelectorAll('#easyWhat .easy-btn').forEach(b=>b.addEventListener('click',()=>easyPick(b.dataset.field,b)));
}
function easyPick(field,btn){
  easyCat=field;
  document.querySelectorAll('#easyWhat .easy-btn').forEach(x=>x.classList.remove('selected'));
  btn.classList.add('selected');
  $('easyStep2').classList.remove('easy-hidden');
  updateEasyMsg();
}
function easyPickTime(val){
  document.querySelectorAll('#easyTime button').forEach(x=>x.classList.toggle('selected',x.dataset.min===val));
  if(val==='custom'){ $('easyCustomWrap').classList.remove('easy-hidden'); easyMin=n($('easyCustomMin').value); $('easyCustomMin').focus(); }
  else { $('easyCustomWrap').classList.add('easy-hidden'); easyMin=n(val); }
  $('easyStep3').classList.remove('easy-hidden'); $('easyStep4').classList.remove('easy-hidden');
  updateEasyMsg();
}
function updateEasyMsg(){
  const m=$('easyMsg'); if(!m)return; m.className='easy-msg'; let ok=false;
  if(!easyCat){ m.textContent='Step 1: Pick what happened.'; }
  else if(!easyMin||easyMin<=0){ m.textContent='Step 2: Pick how long it lasted.'; }
  else { ok=true;
    if(easyCat==='activePickMin' && n($('easyCases').value)<=0){ m.textContent='Looks good. Add how many cases were picked — or leave it blank if you are not sure.'; m.classList.add('warn'); }
    else { m.textContent='✓ Good — this log is ready. Tap Save.'; m.classList.add('ok'); }
  }
  $('easySaveBtn').disabled=!ok;
}
async function saveEasy(){
  if(!easyCat||!easyMin||easyMin<=0){ updateEasyMsg(); return; }
  // Editable segment fields only. On update, tags/identity (entryMode, entryType,
  // source, createdRole, createdBy, date, shift, period) are NOT sent, so they stay intact.
  const fields={totalWindowMin:easyMin,plannedBreakMin:0,cases:n($('easyCases').value),pallets:n($('easyPallets').value),activeRateCpm:0,notes:$('easyNotes').value};
  CATS.forEach(c=>fields[c.id]=0);
  fields[easyCat]=easyMin;
  try{
    if(easyEditId){ await updateDexLog(easyEditId,fields); toast('Updated ✓'); }
    else { await saveDexLog({...fields,date:today(),shift:'Shift 1',period:'After',createdBy:user?.name||'',entryMode:'Easy',entryType:'Event Segment',source:'Manual Entry',createdRole:user?.role||''}); toast('Saved ✓ Nice work!'); }
    resetEasy(); go('home');
  }catch(e){ toast(friendlyError(e)); }
}
function resetEasy(){
  easyCat=null; easyMin=0; easyEditId=null;
  document.querySelectorAll('#easyWhat .easy-btn').forEach(x=>x.classList.remove('selected'));
  document.querySelectorAll('#easyTime button').forEach(x=>x.classList.remove('selected'));
  ['easyStep2','easyStep3','easyStep4'].forEach(id=>$(id)&&$(id).classList.add('easy-hidden'));
  if($('easyCustomWrap'))$('easyCustomWrap').classList.add('easy-hidden');
  ['easyCustomMin','easyCases','easyPallets','easyNotes'].forEach(id=>{if($(id))$(id).value='';});
  if($('easySaveBtn'))$('easySaveBtn').textContent='Save';
  updateEasyMsg();
}

boot();

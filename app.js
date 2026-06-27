const STORAGE_KEY='aurora_redesign_logs_v1';
const USER_KEY='aurora_redesign_user_v1';
const SAVINGS_KEY='aurora_redesign_savings_v1';
const ADMIN_PASSWORD='Nacuchis1';
const EPS=1;

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
const baselineRow={id:'baseline-2026-06-10',locked:true,createdBy:'System',date:'2026-06-10',shift:'Shift 1',period:'Baseline',totalWindowMin:45,plannedBreakMin:15,cases:190,pallets:12,activePickMin:11.39,activeRateCpm:14.3,palletSwapMin:0,restartOverrunMin:10,equipmentStopMin:0,inputStopMin:4.76,laborMultitaskMin:0,unclassifiedGapMin:3.85,notes:'Seed baseline from 6/10. 15-min planned break separated from 10-min restart overrun. 3.85 min is reconstructed/unlogged gap.'};
const roleInfo={
  'Warehouse Associate':{msg:'Associate mode: log observations, view assigned work, and review your saved entries.',views:['home','work','entry','logs','export'],canDelete:false},
  'Warehouse Lead':{msg:'Lead mode: log observations, review team flow, use Pareto, and export logs.',views:['home','work','entry','logs','reports','pareto','export'],canDelete:false},
  'Manager / Supervisor':{msg:'Manager mode: view reports, Pareto, savings, work status, and exports.',views:['home','work','entry','logs','reports','pareto','savings','export'],canDelete:false},
  'Admin':{msg:'Admin mode: full access to reports, exports, savings, and system controls.',views:['home','work','entry','logs','reports','pareto','savings','export','admin'],canDelete:true}
};

const $=id=>document.getElementById(id);
const n=v=>{const x=Number(v);return Number.isFinite(x)?x:0;};
const f0=v=>(v==null||!Number.isFinite(v))?'—':Math.round(v).toLocaleString();
const f1=v=>(v==null||!Number.isFinite(v))?'—':Number(v).toLocaleString(undefined,{maximumFractionDigits:1,minimumFractionDigits:1});
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let logs=loadLogs(), user=loadUser(), selectedPeriod='After', editId=null, adminUnlocked=false;

function loadLogs(){try{const saved=JSON.parse(localStorage.getItem(STORAGE_KEY)||'[]'); if(Array.isArray(saved)&&saved.length){return saved.some(x=>x.id===baselineRow.id)?saved:[baselineRow,...saved];}}catch{} return [baselineRow];}
function saveLogs(){localStorage.setItem(STORAGE_KEY,JSON.stringify(logs));renderAll();}
function loadUser(){try{return JSON.parse(localStorage.getItem(USER_KEY)||'null');}catch{return null;}}
function saveUser(){localStorage.setItem(USER_KEY,JSON.stringify(user));}
function today(){return new Date().toISOString().slice(0,10);}
function initials(name){return (name||'U').split(/\s+/).map(p=>p[0]).join('').slice(0,2).toUpperCase();}
function toast(msg){const t=$('toast');t.textContent=msg;t.classList.add('show');clearTimeout(toast._t);toast._t=setTimeout(()=>t.classList.remove('show'),2300);}

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
function aggregate(period){
  const rs=rows(period); const out={period,n:rs.length,cases:0,pallets:0,availableMin:0,lossTotal:0,activePickMin:0,okRows:0,checkRows:0,rateNum:0,rateDen:0};
  LOSS.forEach(c=>out[c.id]=0);
  rs.forEach(r=>{const c=calc(r);out.cases+=n(r.cases);out.pallets+=n(r.pallets);out.availableMin+=c.available;out.lossTotal+=c.lossTotal;out.activePickMin+=c.active;c.status==='OK'?out.okRows++:out.checkRows++;LOSS.forEach(x=>out[x.id]+=n(r[x.id]));if(c.activeRateCpm){out.rateNum+=c.activeRateCpm*Math.max(1,n(r.pallets));out.rateDen+=Math.max(1,n(r.pallets));}});
  out.casesPerWindow=out.n?out.cases/out.n:null; out.palletsPerWindow=out.n?out.pallets/out.n:null; out.netCph=out.availableMin>0?out.cases/out.availableMin*60:null; out.activeRateCpm=out.rateDen>0?out.rateNum/out.rateDen:null; out.lossPerHour=out.availableMin>0?out.lossTotal/out.availableMin*60:null; out.lossHr={}; LOSS.forEach(c=>out.lossHr[c.id]=out.availableMin>0?out[c.id]/out.availableMin*60:null); out.pareto=LOSS.map(c=>({c,minutes:out[c.id],hr:out.lossHr[c.id]})).filter(x=>x.minutes>0).sort((a,b)=>b.minutes-a.minutes); return out;
}

function boot(){
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
  $('saveSavingsBtn').addEventListener('click',saveSavings);
  $('copyAfterTsv').addEventListener('click',()=>copyTsv(true));
  $('downloadAfterCsv').addEventListener('click',()=>downloadCsv(true));
  $('downloadAllCsv').addEventListener('click',()=>downloadCsv(false));
  $('downloadJson').addEventListener('click',downloadJson);
  $('importJsonBtn').addEventListener('click',importJson);
  $('unlockAdminBtn').addEventListener('click',unlockAdmin);
  $('clearAfterBtn').addEventListener('click',()=>{if(confirm('Clear all After logs?')){logs=logs.filter(r=>r.period!=='After');saveLogs();toast('After logs cleared');}});
  $('resetAllBtn').addEventListener('click',()=>{if(confirm('Reset to baseline only?')){logs=[baselineRow];localStorage.removeItem(SAVINGS_KEY);saveLogs();toast('Reset complete');}});
  if('serviceWorker' in navigator)navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
  resetForm();
  if(user)enterApp(); else showPortal();
}

function login(){
  const name=$('loginName').value.trim(); const role=$('loginRole').value;
  if(!name)return toast('Enter a name');
  if(role==='Admin' && $('adminPassword').value!==ADMIN_PASSWORD)return toast('Admin password is incorrect');
  user={name,role}; saveUser(); enterApp();
}
function logout(){user=null;localStorage.removeItem(USER_KEY);showPortal();}
function showPortal(){$('portal').classList.remove('hidden');$('app').classList.add('hidden');}
function enterApp(){
  $('portal').classList.add('hidden');$('app').classList.remove('hidden');
  $('userNameTop').textContent=user.name; $('userRoleTop').textContent=user.role; $('userInitials').textContent=initials(user.name);
  renderNav(); renderTiles(); renderAll(); go('home');
}
function permissions(){return roleInfo[user?.role]||roleInfo['Warehouse Associate'];}
function renderNav(){
  const navItems=[['home','🏠','Home'],['entry','➕','Add'],['logs','📋','Logs'],['reports','📊','Reports'],['export','⬇️','Export'],['pareto','📈','Pareto'],['savings','💵','Savings'],['admin','⚙️','Admin']];
  const allowed=permissions().views;
  $('bottomNav').innerHTML=navItems.filter(x=>allowed.includes(x[0])).slice(0, user.role==='Warehouse Associate'?5:8).map(([id,ic,label])=>`<button data-view="${id}"><span class="nav-ic">${ic}</span>${label}</button>`).join('');
  document.querySelectorAll('#bottomNav button').forEach(b=>b.addEventListener('click',()=>go(b.dataset.view)));
}
function go(view){
  if(!permissions().views.includes(view)){toast('Your role does not have access to that area');return;}
  if(view==='admin' && user.role!=='Admin'){toast('Admin role required');return;}
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  $('view-'+view).classList.add('active');
  document.querySelectorAll('#bottomNav button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
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
  document.querySelectorAll('.tile').forEach(t=>t.addEventListener('click',()=>t.dataset.view?go(t.dataset.view):toast('Not available for your role')));
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
function saveLog(){const r=readForm();if(editId){const i=logs.findIndex(x=>x.id===editId);if(i>-1){const locked=logs[i].locked;logs[i]={...logs[i],...r,id:editId,locked};}}else{r.id='log-'+Date.now();logs.push(r);}saveLogs();toast(editId?'Observation updated':'Observation saved');resetForm();go('logs');}
function resetForm(){editId=null;$('logDate').value=today();$('logShift').value='Shift 1';selectedPeriod='After';setChoice('periodButtons','After');['totalWindowMin','plannedBreakMin','cases','pallets','activeRateCpm','notes'].forEach(id=>$(id).value='');CATS.forEach(c=>$(c.id).value='');$('cancelEditBtn').classList.add('hidden');$('saveLogBtn').textContent='Save Observation';updateMeter();}
function editLog(id){const r=logs.find(x=>x.id===id);if(!r)return;editId=id;$('logDate').value=r.date||today();$('logShift').value=r.shift||'Shift 1';selectedPeriod=r.period||'After';setChoice('periodButtons',selectedPeriod);['totalWindowMin','plannedBreakMin','cases','pallets','activeRateCpm','notes'].forEach(id=>$(id).value=r[id]??'');CATS.forEach(c=>$(c.id).value=r[c.id]??'');$('cancelEditBtn').classList.remove('hidden');$('saveLogBtn').textContent='Update Observation';updateMeter();go('entry');}
function deleteLog(id){if(!permissions().canDelete){toast('Only Admin can delete records');return;}const r=logs.find(x=>x.id===id);if(r?.locked){toast('Baseline is locked');return;}if(confirm('Delete this log?')){logs=logs.filter(x=>x.id!==id);saveLogs();toast('Deleted');}}
window.editLog=editLog; window.deleteLog=deleteLog;

function renderWork(){const tasks=[['📥','Pull EX-10 Logs','Enter every available DEX log from 6/17 onward as After.'],['⏱️','Check restart overrun','Separate planned break from true restart delay.'],['🔄','Watch pallet swaps','Record swap time as its own bucket.'],['📦','Label bad pallets','Use BAD PALLET label so good pallets can keep routing to DEX.']];$('workList').innerHTML=tasks.map(t=>`<div class="task-card"><div class="box">${t[0]}</div><div><h3>${t[1]}</h3><p>${t[2]}</p></div></div>`).join('');}
function renderLogs(){const canDelete=permissions().canDelete;if(!logs.length){$('logsBody').innerHTML='<div class="report-card">No logs yet.</div>';return;}$('logsBody').innerHTML=[...logs].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).map(r=>{const c=calc(r);return `<div class="log-card"><div class="log-top"><span class="tag ${r.period==='Baseline'?'base':'after'}">${r.period}</span><span class="tag ${c.status==='OK'?'status-ok':'status-check'}">${c.status==='OK'?'✓ Balanced':'⚠ Check'}</span><b>${esc(r.date)} · ${esc(r.shift)}</b>${r.locked?'<span class="micro">🔒 locked</span>':''}</div><div class="log-meta"><span>${f0(n(r.cases))} cases</span><span>${f0(n(r.pallets))} pallets</span><span>${f1(c.available)} avail min</span><span>Created by ${esc(r.createdBy||'—')}</span></div>${r.notes?`<p class="micro">${esc(r.notes)}</p>`:''}<div class="log-actions"><button onclick="editLog('${r.id}')">Edit</button>${canDelete&&!r.locked?`<button class="danger" onclick="deleteLog('${r.id}')">Delete</button>`:''}</div></div>`}).join('');}
function renderReports(){const b=aggregate('Baseline'), a=aggregate('After');$('statusBanner').className='banner';$('statusBanner').innerHTML=a.n===0?'⚑ No After logs yet. Report process adoption, not a trend.':a.checkRows>0?`⚠ ${a.checkRows} After rows do not balance. Fix before presenting.`:a.n===1?'① One After window only. Snapshot, not a trend.':`✓ ${a.n} After windows ready. Top logged loss: <b>${a.pareto[0]?.c.name||'—'}</b>.`;const top=a.n?a:b;$('kpiGrid').innerHTML=[['Baseline windows','n='+b.n,'6/10 seeded'],['After windows','n='+a.n,a.n?'real logs entered':'waiting'],['Cases / available hr',f0(top.netCph),a.n?'After':'Baseline'],['Top logged loss',top.pareto[0]?.c.name||'—',a.n?'After':'Baseline']].map(k=>`<div class="kpi"><span>${k[0]}</span><b>${k[1]}</b><small>${k[2]}</small></div>`).join('');const rows=[['Cases / window',b.casesPerWindow,a.casesPerWindow,'up'],['Cases / available hr',b.netCph,a.netCph,'up'],['Pallets / window',b.palletsPerWindow,a.palletsPerWindow,'up'],['Active rate cases/min',b.activeRateCpm,a.activeRateCpm,'up'],['Loss / available hr',b.lossPerHour,a.lossPerHour,'down']];$('compareTable').innerHTML='<thead><tr><th>Metric</th><th>Base</th><th>After</th><th>Δ</th></tr></thead><tbody>'+rows.map(r=>cmpRow(r[0],r[1],a.n?r[2]:null,r[3])).join('')+'</tbody>';}
function cmpRow(label,b,a,dir){let diff='—',cls='';if(a!=null&&b!=null){const d=a-b;const good=dir==='up'?d>0:d<0;cls=Math.abs(d)<.05?'':good?'up':'down';diff=(d>0?'+':'')+f1(d);}return `<tr><td>${label}</td><td>${f1(b)}</td><td>${a==null?'—':f1(a)}</td><td class="${cls}">${diff}</td></tr>`;}
function renderPareto(){const period=document.querySelector('#paretoPeriod button.selected')?.dataset.value||'After';const a=aggregate(period);if(!a.pareto.length){$('paretoChart').innerHTML=`<p class="micro">No ${period} loss minutes logged yet.</p>`;return;}const max=Math.max(...a.pareto.map(x=>x.minutes));$('paretoChart').innerHTML=a.pareto.map((x,i)=>`<div class="pareto-row"><div class="pareto-line"><span>${i+1}. ${x.c.name}</span><span>${f1(x.hr)} min/hr</span></div><div class="bar"><div class="${x.c.cls}" style="width:${Math.max(2,x.minutes/max*100)}%"></div></div></div>`).join('');}
function renderSavings(){const s=JSON.parse(localStorage.getItem(SAVINGS_KEY)||'{}');if(document.activeElement!==$('laborRate'))$('laborRate').value=s.laborRate??'';if(document.activeElement!==$('hoursSavedWeek'))$('hoursSavedWeek').value=s.hoursSavedWeek??'';if(document.activeElement!==$('weeksYear'))$('weeksYear').value=s.weeksYear??52;if(document.activeElement!==$('savingsType'))$('savingsType').value=s.savingsType??'Soft capacity / productivity gain';const annual=n(s.laborRate)*n(s.hoursSavedWeek)*n(s.weeksYear||52);const a=aggregate('After');$('savingsOutput').innerHTML=`<div><b>Annualized value:</b> $${f0(annual)}</div><div><b>Classification:</b> ${esc(s.savingsType||'Soft capacity / productivity gain')}</div><div><b>Evidence:</b> ${a.n>=2?'After logs entered (n='+a.n+')':'Not enough After logs yet — do not present savings as proven.'}</div>`;}
function saveSavings(){const s={laborRate:n($('laborRate').value),hoursSavedWeek:n($('hoursSavedWeek').value),weeksYear:n($('weeksYear').value||52),savingsType:$('savingsType').value};localStorage.setItem(SAVINGS_KEY,JSON.stringify(s));renderSavings();toast('Savings inputs saved');}

const COLS=[['Date','date'],['Shift','shift'],['Period','period'],['Total Window Min','totalWindowMin'],['Planned Break Min','plannedBreakMin'],['Cases','cases'],['Pallets','pallets'],['Active Pick Min','activePickMin'],['Observed Cases per Min','activeRateCpm'],['Pallet Swap Min','palletSwapMin'],['Restart Overrun Min','restartOverrunMin'],['Unclassified/Unlogged Gap Min','unclassifiedGapMin'],['Equipment Stop Min','equipmentStopMin'],['Input Stop Min','inputStopMin'],['Labor/Multitask Min','laborMultitaskMin'],['Created By','createdBy'],['Notes','notes']];
function exportRows(afterOnly){return logs.filter(r=>!afterOnly||r.period==='After').map(r=>COLS.map(([,k])=>r[k]??''));}
function toCsv(afterOnly){const q=v=>{v=String(v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v};return [COLS.map(c=>q(c[0])).join(','),...exportRows(afterOnly).map(r=>r.map(q).join(','))].join('\n');}
function toTsv(afterOnly){return [COLS.map(c=>c[0]).join('\t'),...exportRows(afterOnly).map(r=>r.join('\t'))].join('\n');}
async function copyTsv(afterOnly){try{await navigator.clipboard.writeText(toTsv(afterOnly));toast('Copied for Excel');}catch{toast('Copy failed. Use CSV download.');}}
function dl(name,text,type){const b=new Blob([text],{type});const u=URL.createObjectURL(b);const a=document.createElement('a');a.href=u;a.download=name;a.click();URL.revokeObjectURL(u);}
function downloadCsv(afterOnly){dl(`aurora-dex-${afterOnly?'after':'all'}-${today()}.csv`,toCsv(afterOnly),'text/csv');toast('CSV downloaded');}
function downloadJson(){dl(`aurora-dex-backup-${today()}.json`,JSON.stringify({logs,savings:JSON.parse(localStorage.getItem(SAVINGS_KEY)||'{}')},null,2),'application/json');toast('Backup downloaded');}
function importJson(){const f=$('importJsonFile').files[0];if(!f)return toast('Choose JSON file');const r=new FileReader();r.onload=()=>{try{const data=JSON.parse(r.result);if(!Array.isArray(data.logs))throw new Error('No logs array');logs=data.logs.some(x=>x.id===baselineRow.id)?data.logs:[baselineRow,...data.logs];localStorage.setItem(STORAGE_KEY,JSON.stringify(logs));if(data.savings)localStorage.setItem(SAVINGS_KEY,JSON.stringify(data.savings));renderAll();toast('Backup imported');}catch(e){toast('Import failed: '+e.message);}};r.readAsText(f);}
function unlockAdmin(){if($('adminEntryPassword').value===ADMIN_PASSWORD){adminUnlocked=true;$('adminLocked').classList.add('hidden');$('adminPanel').classList.remove('hidden');toast('Admin unlocked');}else toast('Incorrect admin password');}

boot();

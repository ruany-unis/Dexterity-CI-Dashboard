/* ===== Aurora DEX Log — merged build =====
   PWA + JSON backup + savings (from Cody's structure)
   reconcile meter + save-gate + no silent rate derivation (honesty fixes)
*/
const STORAGE_KEY='aurora_dex_logs_v3';
const SAVINGS_KEY='aurora_dex_savings_v1';
const EPS=1; // minutes tolerance for reconciliation

/* resilient storage: window.storage (Claude) -> localStorage (real browser) -> memory */
let mem={};
const Store={
  get(k){
    try{const v=localStorage.getItem(k);if(v!=null)return JSON.parse(v);}catch(e){}
    return mem[k]??null;
  },
  set(k,v){
    const s=JSON.stringify(v);
    try{localStorage.setItem(k,s);}catch(e){}
    try{if(window.storage)window.storage.set(k,s,false);}catch(e){}
    mem[k]=v;
  }
};

const CATS=[
  {id:'activePickMin',  name:'Active picking',    sub:'robot actually picking',       cls:'c-active',  loss:false},
  {id:'palletSwapMin',  name:'Pallet swap',       sub:'between one pallet & the next', cls:'c-swap',    loss:true},
  {id:'restartOverrunMin',name:'Restart overrun', sub:'time past the planned break',   cls:'c-restart', loss:true},
  {id:'equipmentStopMin',name:'Equipment stop',   sub:'sensor, suction, reset, jam',   cls:'c-equip',   loss:true},
  {id:'inputStopMin',   name:'Input stop',        sub:'overhang, bad pallet, carton',  cls:'c-input',   loss:true},
  {id:'laborMultitaskMin',name:'Labor / multitask',sub:'owner working elsewhere',      cls:'c-labor',   loss:true},
  {id:'unclassifiedGapMin',name:'Unclassified gap',sub:'time you can\u2019t attribute yet',cls:'c-uncl', loss:true},
];
const LOSS=CATS.filter(c=>c.loss);

const baselineRow={
  id:'baseline-2026-06-10',locked:true,date:'2026-06-10',shift:'Shift 1',period:'Baseline',
  totalWindowMin:45,plannedBreakMin:15,cases:190,pallets:12,activePickMin:11.39,activeRateCpm:14.3,
  palletSwapMin:0,restartOverrunMin:10,equipmentStopMin:0,inputStopMin:4.76,laborMultitaskMin:0,unclassifiedGapMin:3.85,
  notes:'Seed baseline from 6/10 observation. 15-min planned break separated from 10-min restart overrun. 3.85 min is reconstructed/unlogged gap, not assumed empty lane.'
};

let logs=loadLogs();
let deferred=null;

const n=v=>{const x=Number(v);return Number.isFinite(x)?x:0;};
const f1=v=>(v==null||!Number.isFinite(v))?'\u2014':Number(v).toLocaleString(undefined,{maximumFractionDigits:1,minimumFractionDigits:1});
const f0=v=>(v==null||!Number.isFinite(v))?'\u2014':Math.round(v).toLocaleString();
const esc=t=>String(t).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));

function loadLogs(){
  const saved=Store.get(STORAGE_KEY);
  if(!Array.isArray(saved)||!saved.length)return [baselineRow];
  return saved.some(r=>r.id===baselineRow.id)?saved:[baselineRow,...saved];
}
function saveLogs(){Store.set(STORAGE_KEY,logs);refreshCounts();}

/* ---- core calc: NEVER derive active rate from cases/pick-time ---- */
function calc(row){
  const total=n(row.totalWindowMin), planned=n(row.plannedBreakMin);
  const available=Math.max(0,total-planned);
  const active=n(row.activePickMin);
  const lossTotal=LOSS.reduce((s,c)=>s+n(row[c.id]),0);
  const accounted=active+lossTotal;
  const diff=available-accounted;
  const status=(available>0&&Math.abs(diff)<=EPS)?'OK':'CHECK';
  const netCph=available>0?n(row.cases)/available*60:null;
  // active rate: ONLY the log's stated value. blank -> null (never cases/active)
  const activeRateCpm=n(row.activeRateCpm)>0?n(row.activeRateCpm):null;
  const casesPerPallet=n(row.pallets)>0?n(row.cases)/n(row.pallets):null;
  return {total,planned,available,active,lossTotal,accounted,diff,status,netCph,activeRateCpm,casesPerPallet};
}

function periodRows(p){return logs.filter(r=>r.period===p);}
function aggregate(period){
  const rows=periodRows(period), N=rows.length;
  const t={period,n:N,availableMin:0,activePickMin:0,cases:0,pallets:0,lossTotal:0,okRows:0,checkRows:0,
    rateNum:0,rateDen:0};
  LOSS.forEach(c=>t[c.id]=0);
  rows.forEach(r=>{const c=calc(r);
    t.availableMin+=c.available;t.activePickMin+=c.active;t.cases+=n(r.cases);t.pallets+=n(r.pallets);
    t.lossTotal+=c.lossTotal;c.status==='OK'?t.okRows++:t.checkRows++;
    LOSS.forEach(x=>t[x.id]+=n(r[x.id]));
    if(c.activeRateCpm){t.rateNum+=c.activeRateCpm*Math.max(1,n(r.pallets));t.rateDen+=Math.max(1,n(r.pallets));}
  });
  t.casesPerWindow=N?t.cases/N:null;
  t.palletsPerWindow=N?t.pallets/N:null;
  t.netCph=t.availableMin>0?t.cases/t.availableMin*60:null;
  t.activeRateCpm=t.rateDen>0?t.rateNum/t.rateDen:null;
  t.lossPerAvailHour=t.availableMin>0?t.lossTotal/t.availableMin*60:null;
  t.lossHr={};LOSS.forEach(c=>t.lossHr[c.id]=t.availableMin>0?t[c.id]/t.availableMin*60:null);
  t.pareto=LOSS.map(c=>({c,minutes:t[c.id],hr:t.lossHr[c.id]})).filter(x=>x.minutes>0).sort((a,b)=>b.minutes-a.minutes);
  return t;
}

/* ---------------- form ---------------- */
const $=id=>document.getElementById(id);
let editId=null, fShift='Shift 1', fPeriod='After';
const fInputs={};

function buildAlloc(){
  const w=$('alloc');w.innerHTML='';
  CATS.forEach(c=>{
    const row=document.createElement('div');row.className='alloc';
    row.innerHTML=`<span class="swatch ${c.cls}"></span>
      <span class="name">${c.name}<small>${c.sub}</small></span>
      <input type="number" inputmode="decimal" step="0.01" min="0" data-cat="${c.id}" placeholder="0">`;
    w.appendChild(row);
    const inp=row.querySelector('input');fInputs[c.id]=inp;inp.addEventListener('input',updateMeter);
  });
}
function readForm(){
  const r={date:$('date').value,shift:fShift,period:fPeriod,
    totalWindowMin:$('totalWindowMin').value,plannedBreakMin:$('plannedBreakMin').value,
    cases:$('cases').value,pallets:$('pallets').value,activeRateCpm:$('activeRateCpm').value,
    notes:$('notes').value};
  CATS.forEach(c=>r[c.id]=fInputs[c.id].value);
  return r;
}
function updateMeter(){
  const r=readForm(), c=calc(r);
  $('availChip').textContent=(n(r.totalWindowMin)||n(r.plannedBreakMin))?c.available+' min':'\u2014 min';
  $('mVal').textContent=`${Math.round(c.accounted*100)/100} / ${c.available} min`;
  const fill=$('mFill');fill.innerHTML='';
  const base=Math.max(c.available,c.accounted,1);
  CATS.forEach(cat=>{const v=n(r[cat.id]);if(v<=0)return;
    const seg=document.createElement('div');seg.className='seg-fill';
    seg.style.background=getComputedStyle(document.querySelector('.'+cat.cls)).backgroundColor;
    seg.style.width=(v/base*100)+'%';fill.appendChild(seg);});
  fill.style.width=Math.min(100,c.accounted/base*100)+'%';
  const msg=$('mMsg'), meter=$('meter');msg.className='recon-msg';meter.classList.remove('ok');
  const diff=Math.round(c.diff*100)/100;let balanced=false;
  if(c.available<=0){msg.innerHTML='<span class="dot" style="background:#b6c2cd"></span>Enter the window above to begin.';}
  else if(Math.abs(diff)<=EPS){balanced=true;msg.classList.add('ok');meter.classList.add('ok');
    msg.innerHTML='<span class="dot" style="background:var(--green)"></span>Balanced \u2014 every minute accounted for.';}
  else if(diff>EPS){balanced=false;msg.classList.add('warn');
    msg.innerHTML=`<span class="dot" style="background:var(--amber)"></span>${diff} min unaccounted.
      <button class="btn-mini" type="button" id="dropBtn">Add to Unclassified</button>`;
    setTimeout(()=>{const b=$('dropBtn');if(b)b.onclick=dropRemainder;},0);}
  else{msg.classList.add('over');
    msg.innerHTML=`<span class="dot" style="background:var(--red)"></span>${Math.abs(diff)} min over available \u2014 trim a bucket.`;}
  $('saveBtn').disabled=!(balanced && n(r.cases)>0 && n(r.totalWindowMin)>0);
}
function dropRemainder(){const r=readForm(),c=calc(r);if(c.diff>0){
  fInputs.unclassifiedGapMin.value=(n(r.unclassifiedGapMin)+c.diff).toFixed(2).replace(/\.00$/,'');updateMeter();}}

function setSeg(id,v){$(id).querySelectorAll('button').forEach(b=>b.classList.toggle('on',b.dataset.v===v));}
function wireSeg(id,setter){$(id).querySelectorAll('button').forEach(b=>b.onclick=()=>{
  $(id).querySelectorAll('button').forEach(x=>x.classList.remove('on'));b.classList.add('on');setter(b.dataset.v);});}

function resetForm(keepDate){
  editId=null;$('entryTitle').textContent='New observation';
  $('saveBtn').textContent='Save observation';$('cancelBtn').classList.add('hidden');
  if(!keepDate)$('date').value=new Date().toISOString().slice(0,10);
  ['totalWindowMin','plannedBreakMin','cases','pallets','activeRateCpm','notes'].forEach(k=>$(k).value='');
  CATS.forEach(c=>fInputs[c.id].value='');
  fShift='Shift 1';setSeg('shiftSeg','Shift 1');fPeriod='After';setSeg('periodSeg','After');
  updateMeter();
}
function fillForm(row){
  editId=row.id;
  $('date').value=row.date||'';$('totalWindowMin').value=row.totalWindowMin??'';$('plannedBreakMin').value=row.plannedBreakMin??'';
  $('cases').value=row.cases??'';$('pallets').value=row.pallets??'';$('activeRateCpm').value=row.activeRateCpm??'';$('notes').value=row.notes||'';
  CATS.forEach(c=>fInputs[c.id].value=row[c.id]??'');
  fShift=row.shift||'Shift 1';setSeg('shiftSeg',fShift);
  fPeriod=row.period||'After';setSeg('periodSeg',fPeriod);
  $('entryTitle').textContent=row.locked?'Edit baseline':'Edit observation';
  $('saveBtn').textContent='Update observation';$('cancelBtn').classList.remove('hidden');
  updateMeter();
}
window.editLog=id=>{const r=logs.find(x=>x.id===id);if(r){fillForm(r);setView('entry');}};
window.deleteLog=id=>{const r=logs.find(x=>x.id===id);if(!r||r.locked)return;
  if(confirm('Delete this observation?')){logs=logs.filter(x=>x.id!==id);saveLogs();render();toast('Deleted');}};

function save(){
  const r=readForm();
  CATS.forEach(c=>r[c.id]=n(r[c.id]));
  ['totalWindowMin','plannedBreakMin','cases','pallets','activeRateCpm'].forEach(k=>r[k]=n(r[k]));
  if(editId){const i=logs.findIndex(x=>x.id===editId);
    if(i>=0){const lk=logs[i].locked;logs[i]={...logs[i],...r,id:editId,locked:lk};}}
  else{r.id='log-'+Date.now();logs.push(r);}
  saveLogs();toast(editId?'Observation updated':'Observation saved');
  const d=$('date').value;resetForm(true);$('date').value=d;setView('logs');
}

/* ---------------- render ---------------- */
function setView(name){
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  $('view-'+name).classList.add('active');
  document.querySelectorAll('.bottom-nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===name));
  window.scrollTo({top:0,behavior:'smooth'});render();
}
function refreshCounts(){
  const after=periodRows('After').length;
  $('hCount').textContent=logs.length;
  const t=$('navTally');t.style.display=after?'flex':'none';t.textContent=after;
}
function bn(t,ic,h,p){return `<div class="banner ${t}"><span class="bd">${ic}</span><div><h4>${h}</h4><p>${p}</p></div></div>`;}

function renderDash(){
  const b=aggregate('Baseline'), a=aggregate('After');
  let fork;
  if(a.n===0)fork=bn('warn','\u2691','No After logs yet','Report the process-adoption finding, not a trend. Pull the EX-10 logs, add them as After, then read this.');
  else if(a.checkRows>0)fork=bn('warn','\u26A0',`${a.checkRows} After window(s) don\u2019t balance`,'Fix the rows marked CHECK in Logs before trusting the comparison.');
  else if(a.n===1)fork=bn('warn','1\u20E3','One After window \u2014 a snapshot','Add a few more shifts before claiming a trend.');
  else fork=bn('go','\u2713',`${a.n} After windows ready`,`Top logged loss: <strong>${a.pareto[0]?a.pareto[0].c.name:'\u2014'}</strong>. Build the deck only after reviewing this.`);
  $('forkMessage').outerHTML=`<div id="forkMessage" class="banner ${fork.match(/banner (\w+)/)[1]}">${fork.replace(/^<div[^>]*>/,'').replace(/<\/div>$/,'')}</div>`;

  const top=a.n?a:b, label=a.n?'After':'Baseline';
  $('kpiGrid').innerHTML=[
     st('Baseline windows',`n=${b.n}`,'6/10 reference seeded'),
    st('After windows',`n=${a.n}`,a.n?'real logs entered':'waiting on EX-10 logs'),
    st('Cases / available hr',f0(top.netCph),label+' \u00B7 honest productivity'),
    st('Top logged loss',top.pareto[0]?top.pareto[0].c.name:'\u2014',label),
  ].join('');

  // before vs after
  const rows=[
    ['Cases / window',f0(b.casesPerWindow),a.n?f0(a.casesPerWindow):'\u2014',a.n?d(a.casesPerWindow,b.casesPerWindow,'up',f0):null],
    ['Cases / available hr',f0(b.netCph),a.n?f0(a.netCph):'\u2014',a.n?d(a.netCph,b.netCph,'up',f0):null],
    ['Pallets / window',f1(b.palletsPerWindow),a.n?f1(a.palletsPerWindow):'\u2014',a.n?d(a.palletsPerWindow,b.palletsPerWindow,'up',f1):null],
    ['Active rate (cases/min)',f1(b.activeRateCpm),a.n?f1(a.activeRateCpm):'\u2014',a.n?d(a.activeRateCpm,b.activeRateCpm,'up',f1):null],
    ['Loss / available hr',f1(b.lossPerAvailHour),a.n?f1(a.lossPerAvailHour):'\u2014',a.n?d(a.lossPerAvailHour,b.lossPerAvailHour,'down',f1):null],
  ];
  $('beforeAfterTable').innerHTML=`<thead><tr><th>Metric</th><th>Base<br>(n=${b.n})</th><th>After<br>(n=${a.n})</th><th>\u0394</th></tr></thead><tbody>`+
    rows.map(r=>`<tr><td class="lab">${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td>${r[3]||'<td class="na">\u2014</td>'}</tr>`).join('')+`</tbody>`;
}
function st(k,v,note){return `<div class="stat"><div class="k">${k}</div><div class="v${v==='\u2014'?' dash':''}">${v}</div><div class="note">${note}</div></div>`;}
function d(a,b,good,fmt){if(a==null||b==null||!Number.isFinite(a)||!Number.isFinite(b))return '<td class="na">\u2014</td>';
  const diff=a-b, improved=good==='up'?diff>0:diff<0, cls=Math.abs(diff)<0.05?'':(improved?'up':'down');
  return `<td class="${cls}">${diff>0?'+':''}${fmt(diff)}</td>`;}

function renderLogs(){
  const body=$('logsBody');
  if(!logs.length){body.innerHTML=empty('No observations yet. Tap Add.');return;}
  const sorted=[...logs].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  body.innerHTML=sorted.map(r=>{const c=calc(r);const ok=c.status==='OK';
    return `<div class="entry">
      <div class="top"><span class="tag ${r.period==='Baseline'?'base':'after'}">${r.period}</span>
        <span class="dt">${r.date||'no date'} \u00B7 ${(r.shift||'').replace('Shift ','')||'?'}</span>
        ${r.locked?'<span class="lock">\u{1F512} locked</span>':''}
        <span class="badge ${ok?'ok':'chk'}">${ok?'\u2713 balanced':'\u26A0 check'}</span></div>
      <div class="met"><span>${f0(n(r.cases))} <b>cases</b></span><span>${f0(n(r.pallets))} <b>pallets</b></span>
        <span>${c.available} <b>avail min</b></span>${!ok?`<span style="color:var(--red)">\u0394 ${f1(c.diff)} min</span>`:''}</div>
      ${r.notes?`<div class="nt">${esc(r.notes.slice(0,120))}</div>`:''}
      <div class="acts"><button onclick="editLog('${r.id}')">Edit</button>
        ${r.locked?'':`<button class="del" onclick="deleteLog('${r.id}')">Delete</button>`}</div>
    </div>`;}).join('');
}
function renderPareto(){
  const period=$('paretoSeg').querySelector('button.on').dataset.v;
  const a=aggregate(period), chart=$('paretoChart');
  if(!a.pareto.length){chart.innerHTML=`<p class="muted small">No ${period} loss minutes logged yet.</p>`;return;}
  const max=Math.max(...a.pareto.map(x=>x.minutes));
  chart.innerHTML=a.pareto.map((x,i)=>{
    const col=getComputedStyle(document.querySelector('.'+x.c.cls)).backgroundColor;
    return `<div class="bar-row"><div class="bl"><span class="nm"><span class="rk">${i+1}</span>${x.c.name}</span>
      <span class="mn">${f1(x.hr)} min/hr</span></div>
      <div class="track"><div class="barfill" style="width:${x.minutes/max*100}%;background:${col}"></div></div></div>`;
  }).join('');
}
function renderSavings(){
  const s=Store.get(SAVINGS_KEY)||{};
  ['laborRate','hoursSavedWeek','weeksYear','savingsType'].forEach(id=>{const el=$(id);
    if(document.activeElement!==el)el.value=s[id]??(id==='weeksYear'?52:'');});
  const annual=n(s.laborRate)*n(s.hoursSavedWeek)*n(s.weeksYear||52);
  const a=aggregate('After');
  $('savingsOutput').innerHTML=`
    <div class="savings-box"><b>Annualized value:</b> $${annual.toLocaleString(undefined,{maximumFractionDigits:0})}</div>
    <div class="savings-box"><b>Classification:</b> ${esc(s.savingsType||'Soft capacity / productivity gain')}</div>
    <div class="savings-box"><b>Evidence:</b> ${a.n>=2?`After logs entered (n=${a.n})`:'Not enough After logs yet \u2014 do not present savings as proven.'}</div>`;
}
function empty(m){return `<div class="empty"><div class="ic">\u{1F4CB}</div><p>${m}</p></div>`;}
function render(){renderDash();renderLogs();renderPareto();renderSavings();}

/* ---------------- export / import ---------------- */
const COLS=[['Date','date'],['Shift','shift'],['Period','period'],['Total Window Min','totalWindowMin'],
  ['Planned Break Min','plannedBreakMin'],['Cases','cases'],['Pallets','pallets'],['Active Pick Min','activePickMin'],
  ['Observed Cases per Min','activeRateCpm'],['Pallet Swap Min','palletSwapMin'],['Restart Overrun Min','restartOverrunMin'],
  ['Unclassified/Unlogged Gap Min','unclassifiedGapMin'],['Equipment Stop Min','equipmentStopMin'],
  ['Input Stop Min','inputStopMin'],['Labor/Multitask Min','laborMultitaskMin'],['Notes','notes']];
function exportableRows(mode='all'){
  const source = mode==='after' ? logs.filter(r=>r.period==='After') : logs;
  return source.map(r=>COLS.map(([,k])=>r[k]??''));
}
function toCSV(mode='all'){const q=v=>{v=String(v);return /[",\n]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v;};
  const data=exportableRows(mode);
  return [COLS.map(c=>q(c[0])).join(','),...data.map(r=>r.map(q).join(','))].join('\n');}
function toTSV(mode='all'){
  const data=exportableRows(mode);
  return [COLS.map(c=>c[0]).join('\t'),...data.map(r=>r.join('\t'))].join('\n');}
function dl(name,text,type){const b=new Blob([text],{type});const u=URL.createObjectURL(b);
  const a=document.createElement('a');a.href=u;a.download=name;a.click();URL.revokeObjectURL(u);}
function afterCount(){return logs.filter(r=>r.period==='After').length;}

/* ---------------- boot ---------------- */
function boot(){
  buildAlloc();
  wireSeg('shiftSeg',v=>fShift=v);
  wireSeg('periodSeg',v=>{fPeriod=v;updateMeter();});
  ['totalWindowMin','plannedBreakMin','cases','pallets','activeRateCpm'].forEach(id=>$(id).addEventListener('input',updateMeter));
  $('saveBtn').onclick=save;
  $('cancelBtn').onclick=()=>{resetForm();setView('logs');};
  document.querySelectorAll('.bottom-nav button').forEach(b=>b.onclick=()=>setView(b.dataset.view));
  $('paretoSeg').querySelectorAll('button').forEach(b=>b.onclick=()=>{
    $('paretoSeg').querySelectorAll('button').forEach(x=>x.classList.remove('on'));b.classList.add('on');renderPareto();});
  $('copyAfterTSV').onclick=async()=>{
    if(!afterCount())return toast('No After logs to copy yet');
    try{await navigator.clipboard.writeText(toTSV('after'));toast('After logs copied — paste below the workbook baseline');}
    catch(e){toast('Copy failed — use After CSV');}};
  $('exportAfterCsvBtn').onclick=()=>{
    if(!afterCount())return toast('No After logs to export yet');
    dl(`aurora-dex-after-logs-${new Date().toISOString().slice(0,10)}.csv`,toCSV('after'),'text/csv');toast('After CSV downloaded');};
  $('copyTSV').onclick=async()=>{
    try{await navigator.clipboard.writeText(toTSV('all'));toast('Full table copied');}
    catch(e){toast('Copy failed — use Full CSV');}};
  $('exportCsvBtn').onclick=()=>{dl(`aurora-dex-full-logs-${new Date().toISOString().slice(0,10)}.csv`,toCSV('all'),'text/csv');toast('Full CSV downloaded');};
  $('exportJsonBtn').onclick=()=>{dl(`aurora-dex-backup-${new Date().toISOString().slice(0,10)}.json`,
    JSON.stringify({logs,savings:Store.get(SAVINGS_KEY)||{}},null,2),'application/json');toast('Backup downloaded');};
  $('importJsonBtn').onclick=()=>{const f=$('importJsonFile').files[0];if(!f)return toast('Choose a JSON file first');
    const rd=new FileReader();rd.onload=()=>{try{const d=JSON.parse(rd.result);
      if(!Array.isArray(d.logs))throw new Error('no logs array');
      logs=d.logs.some(r=>r.id===baselineRow.id)?d.logs:[baselineRow,...d.logs];saveLogs();
      if(d.savings)Store.set(SAVINGS_KEY,d.savings);render();toast('Backup imported');
    }catch(e){toast('Import failed: '+e.message);}};rd.readAsText(f);};

  $('saveSavingsBtn').onclick=()=>{Store.set(SAVINGS_KEY,{
    laborRate:n($('laborRate').value),hoursSavedWeek:n($('hoursSavedWeek').value),
    weeksYear:n($('weeksYear').value||52),savingsType:$('savingsType').value});renderSavings();toast('Savings inputs saved');};

  $('seedBtn').onclick=()=>{if(logs.some(r=>r.id===baselineRow.id))return toast('Baseline already loaded');
    logs.unshift({...baselineRow});saveLogs();render();toast('6/10 baseline loaded');};
  $('clearAfterBtn').onclick=()=>{if(confirm('Clear all After logs? Baseline stays.')){
    logs=logs.filter(r=>r.period!=='After');saveLogs();render();toast('After logs cleared');}};
  $('resetAllBtn').onclick=()=>{if(confirm('Reset to the 6/10 baseline only?')){
    logs=[{...baselineRow}];Store.set(SAVINGS_KEY,{});saveLogs();render();toast('Reset to baseline');}};

  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferred=e;$('installBtn').classList.remove('hidden');});
  $('installBtn').onclick=async()=>{if(!deferred)return;deferred.prompt();await deferred.userChoice;deferred=null;$('installBtn').classList.add('hidden');};
  if('serviceWorker'in navigator)window.addEventListener('load',()=>navigator.serviceWorker.register('./service-worker.js').catch(()=>{}));

  refreshCounts();resetForm();render();
}
let toastT;function toast(m){const t=$('toast');t.textContent=m;t.classList.add('show');clearTimeout(toastT);toastT=setTimeout(()=>t.classList.remove('show'),2200);}
boot();

/* Mon Classeur Prof — application.
   Les données restent dans le navigateur (localStorage, clé KEY) : ne jamais changer cette clé
   ni le format existant sans migration, sinon les classeurs en cours disparaîtraient. */
(function(){
"use strict";
const KEY="mon-classeur-prof-v1";
const BACKUP_REMINDER_DAYS=14;
const APP_VERSION=23;
const uid=()=>Math.random().toString(36).slice(2)+Date.now().toString(36);
const initial=()=>({version:1,year:"2026–2027",classes:[]});
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const plural=(n,word)=>n+" "+word+(n>1?"s":"");
const byName=(a,b)=>a.name.localeCompare(b.name,"fr",{sensitivity:"base"});

/* ---------- Données ---------- */
function normalize(d){
 d.classes=Array.isArray(d.classes)?d.classes.filter(c=>c&&typeof c==="object"):[];
 d.classes.forEach(c=>{
  c.id=c.id||uid();c.name=c.name||"Classe";
  c.students=Array.isArray(c.students)?c.students.filter(Boolean):[];
  c.folders=Array.isArray(c.folders)?c.folders:[];
  c.tables=Array.isArray(c.tables)?c.tables.filter(Boolean):[];
  c.tables.forEach(t=>{
   t.id=t.id||uid();t.name=t.name||"Évaluation";
   t.observables=Array.isArray(t.observables)?t.observables:[];
   t.groups=Array.isArray(t.groups)?t.groups:[];
   t.groups.forEach(g=>{g.studentIds=Array.isArray(g.studentIds)?g.studentIds:[]});
   t.results=t.results&&typeof t.results==="object"?t.results:{};
  });
 });
 d.year=d.year||initial().year;
 return d;
}
let data,loadProblem=false;
/* Module du carnet : les données viennent de la base du carnet (classes et élèves partagés). */
data=window.ClasseurBridge.data;
normalize(data);

let saveFailed=false,saveTimer=null,toastTimer=null;
function statusText(){return saveFailed?"Non enregistré : stockage plein":"Enregistré sur cet appareil"}
function showStatus(text){const el=$("status");if(!el)return;el.textContent=text||statusText();el.classList.toggle("fail",saveFailed)}
function save(){
 clearTimeout(saveTimer);saveTimer=null;
 try{
  if(!window.ClasseurBridge.save(data))throw Error("save");
  saveFailed=false;showStatus();window.__quotaWarned=false;return true;
 }catch{
  saveFailed=true;showStatus();
  if(!window.__quotaWarned){window.__quotaWarned=true;alert("Enregistrement impossible dans ce navigateur : tes dernières saisies ne sont pas enregistrées. Fais une sauvegarde depuis le carnet.")}
  return false;
 }
}
/* Saisie au clavier : mémoire immédiate, écriture groupée, et écriture forcée si l'app passe en arrière-plan. */
function saveSoon(){showStatus("Enregistrement…");clearTimeout(saveTimer);saveTimer=setTimeout(save,350)}
function flushSave(){if(saveTimer)save()}
addEventListener("pagehide",flushSave);
document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")flushSave()});

function toast(msg){const el=$("toast");el.textContent=msg;el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>{el.hidden=true},3800)}
const storageBytes=()=>{try{return new Blob([JSON.stringify(data)]).size}catch{return 0}};
const storageLabel=n=>n>=1048576?(n/1048576).toFixed(2)+" Mo":(n/1024).toFixed(0)+" Ko";
const storageWarning=n=>n>=200*1048576?"Niveau élevé : archive tes évaluations terminées.":"Niveau normal.";

/* ---------- État de navigation ---------- */
let view={page:"classes",classId:null,tableId:null};
function carnetLink(){const c=cls();return c?"../#classe/"+encodeURIComponent(c.id):"../#classes"}
{const m=/(?:^#|&)classe=([^&]+)/.exec(location.hash),t=/(?:^#|&)t=([123])/.exec(location.hash);if(m){view={page:"class",classId:decodeURIComponent(m[1]),tableId:null}}if(t)window.__classeurTerm="T"+t[1]}
let activeTrimester=window.__classeurTerm||currentTrimester();
let terrainSelection=new Set(),observationGroupId=null,observationStudentId=null,lastPageKey="",noticeDismissed=false;
const lastTab={};
const groupColors=["#2563eb","#dc2626","#15803d","#eab308","#7e22ce","#ea580c","#0f766e","#db2777"];
const validGroupColor=color=>/^#[0-9a-fA-F]{6}$/.test(color);
const groupColor=g=>validGroupColor(g.color)?g.color:"#64748b";
function onColor(hex){const v=parseInt(hex.slice(1),16),r=v>>16&255,g=v>>8&255,b=v&255;return (r*299+g*587+b*114)/1000>150?"#14263d":"#ffffff"}
const bibStyle=g=>'style="background:'+groupColor(g)+';color:'+onColor(groupColor(g))+'"';
const nextGroupName=t=>{let n=1;while((t.groups||[]).some(g=>g.name==="Groupe "+n))n++;return "Groupe "+n};
function currentTrimester(){const m=new Date().getMonth()+1;return m>=9&&m<=11?"T1":m===12||m<=3?"T2":"T3"}
const cls=()=>data.classes.find(c=>c.id===view.classId);
const tab=()=>cls()?.tables.find(t=>t.id===view.tableId);
const trimesterLabels={T1:"1er trimestre",T2:"2e trimestre",T3:"3e trimestre"};
const STATUS={absent:"Absent",dispense:"Dispensé"};

/* ---------- Petits composants ---------- */
const btn=(label,act,kind="")=>'<button type="button" class="btn '+kind+'" data-action="'+esc(act)+'">'+label+'</button>';
const menu=(label,items,keep)=>'<details class="menu"'+(keep?' data-keep="'+esc(keep)+'"':'')+'><summary class="btn small" aria-label="'+esc(label)+'">⋯</summary><div class="menu-list">'+items+'</div></details>';
const field=(label,id,value="",type="text",extra="")=>'<label class="field">'+esc(label)+'<input id="'+id+'" type="'+type+'" value="'+esc(value)+'" '+extra+'></label>';
const input=id=>$(id)?.value.trim()||"";
/* Portraits du trombinoscope du carnet. */
const initials=n=>String(n||"").split(/[\s-]+/).filter(Boolean).slice(0,2).map(w=>w[0]).join("").toUpperCase();
const face=(s,size="")=>{const src=/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(s?.portrait||"")?s.portrait:"";return src?'<img class="face '+size+'" src="'+src+'" alt="" loading="lazy">':'<span class="face face-empty '+size+'" aria-hidden="true">'+esc(initials(s?.name))+'</span>'};
const sexTag=s=>s.sex==="F"?'<span class="sex" title="Fille">F</span>':s.sex==="M"?'<span class="sex" title="Garçon">G</span>':"";
function hasObservation(t,sid){const r=t.results[sid]||{};return !!(r.comment||r.drawing||Object.values(r.levels||{}).some(Boolean)||(r.note!==""&&r.note!=null)||(r.ccf&&(Object.values(r.ccf.v||{}).some(x=>String(x??"").trim())||Object.values(r.ccf.d||{}).some(Boolean))))}
function studentState(t,sid){const r=t.results[sid]||{};if(STATUS[r.status])return '<span class="state '+r.status+'">'+STATUS[r.status]+'</span>';return hasObservation(t,sid)?'<span class="state done">Observé</span>':'<span class="state">À observer</span>'}
function trimesterOptions(chosen){return '<label class="field">Trimestre<select id="ftrimester">'+Object.entries(trimesterLabels).map(([k,l])=>'<option value="'+k+'"'+(chosen===k?" selected":"")+'>'+l+'</option>').join("")+'<option value=""'+(!chosen?" selected":"")+'>À classer</option></select></label>'}

/* ---------- Modale ---------- */
let lastFocus=null;
function modal(title,body,onSave,opts={}){
 lastFocus=document.activeElement;
 $("modalhost").innerHTML='<div class="modalbg"><div class="modal '+(opts.wide?"wide":"")+'" role="dialog" aria-modal="true" aria-label="'+esc(title)+'"><h2>'+esc(title)+'</h2><div>'+body+'</div><footer>'+(onSave?btn("Annuler","close-modal")+btn(opts.saveLabel||"Enregistrer","submit-modal","primary"):btn("Fermer","close-modal","primary"))+'</footer></div></div>';
 window._modalSave=onSave||null;
 ($("modalhost").querySelector("input:not([type=hidden]):not([type=radio]):not([type=checkbox]),textarea,select")||$("modalhost").querySelector("footer .btn:last-child"))?.focus();
}
function close(){const host=$("modalhost");if(host)host.innerHTML="";window._modalSave=null;lastFocus?.isConnected&&lastFocus.focus();lastFocus=null}

/* ---------- Rendu ---------- */
const pages={
home(){
 return '<section class="hero hero-refined"><div class="hero-content"><div class="eyebrow">LE CARNET DE TERRAIN EPS</div><h1>Mon Classeur<br>Prof<span class="hero-dot">.</span></h1><p>Vos classes, vos groupes, vos observations.<br>Un espace pensé pour enseigner, pas pour gérer des tableaux.</p>'+btn("Entrer dans mon classeur","classes","primary")+'<div class="hero-features"><span>◉ Classes et groupes</span><span>✎ Apple Pencil</span><span>▣ Évaluations</span></div></div><div class="hero-bottom"><span>⌁ Données conservées sur cet iPad</span><button type="button" data-action="privacy-info" class="privacy-link">Confidentialité et sauvegardes</button></div></section>';
},
classes(){
 const active=data.classes.filter(c=>!c.archived),archived=data.classes.filter(c=>c.archived);
 const card=c=>{
  const list=classEvals(c),rest=c.tables.length-list.length;
  return '<article class="class-card'+(c.archived?" archived":"")+'"'+(Array.isArray(c.carnetColor)&&/^#[0-9a-f]{6}$/i.test(c.carnetColor[0])?' style="--class-color:'+c.carnetColor[0]+'"':'')+'><button type="button" class="class-open" data-action="open-class:'+esc(c.id)+'"><span class="class-name">'+esc(c.name)+'</span><span class="class-meta">'+(/^(?:6|5|4|3)(?![0-9])/i.test(c.name.trim())?"Collège":"Lycée")+', '+plural(c.students.length,"élève")+'</span></button><div class="class-body">'+
  (list.length?list.map(t=>evalLink(c,t)).join(""):'<p class="muted small-text">Aucune évaluation pour l’instant.</p>')+
  (rest>0?'<button type="button" class="class-more" data-action="open-class:'+esc(c.id)+'">'+(rest>1?"Voir les "+rest+" autres":"Voir l’autre évaluation")+'</button>':"")+
  '</div><div class="class-foot">'+btn("+ Évaluation","quick-eval:"+c.id,"small quiet")+menu("Options de "+c.name,btn("Renommer","edit-class:"+c.id,"small")+btn(c.archived?"Réactiver":"Archiver la classe","archive-class:"+c.id,"small")+"")+'</div></article>';
 };
 if(!data.classes.length)return installNotice()+'<div class="page-head"><h1>Mes classes</h1></div><div class="empty"><p>Crée ta première classe pour commencer, ou restaure une sauvegarde.</p><div class="row" style="justify-content:center">'+btn("Créer ma première classe","add-class","primary")+btn("Restaurer une sauvegarde","import-json")+'</div></div>';
 const notice=backupNotice();
 return notice+installNotice()+'<div class="page-head"><div><h1>Mes classes</h1><p class="muted">Année '+esc(data.year)+'</p></div><div class="row">'+btn("Changer l’année","year","quiet small")+btn("+ Nouvelle classe","add-class","primary")+'</div></div>'+resumeBar()+
 (active.length?'<div class="class-grid">'+active.map(card).join("")+'</div>':'<div class="empty"><p>Toutes tes classes sont archivées.</p>'+btn("+ Nouvelle classe","add-class","primary")+'</div>')+
 (archived.length?'<details class="archive-box" data-keep="archives"><summary>Classes archivées ('+archived.length+')</summary><div class="class-grid">'+archived.map(card).join("")+'</div></details>':"")+
 (notice?"":'<div class="home-foot"><span>Enregistré dans le carnet : sauvegarde et cloud chiffrés. '+esc(storageLabel(storageBytes()))+'.</span><div class="row">'+btn("Sauvegarde du carnet","export-json","small")+'</div></div>');
},
class(){
 const c=cls(),ccfTab=activeTrimester==="ccf",key=activeTrimester==="unclassified"||ccfTab?"":activeTrimester,current=ccfTab?c.tables.filter(isCcf):c.tables.filter(t=>(t.trimester||"")===key);
 const tabs=Object.entries(trimesterLabels).map(([id,label])=>segBtn(id,label,c.tables.filter(t=>t.trimester===id).length)).join("")+(c.tables.some(t=>!t.trimester)?segBtn("unclassified","À classer",c.tables.filter(t=>!t.trimester).length):"")+segBtn("ccf","CCF Terminale",c.tables.filter(isCcf).length);
 let html='<div class="crumbs">'+btn("← Mes classes","classes","quiet small")+'</div><div class="page-head"><div><h1>'+esc(c.name)+'</h1><p class="muted">'+plural(c.students.length,"élève")+'</p></div><div class="row">'+btn("Élèves","students")+btn("Bilan du trimestre","bilan")+(ccfTab?btn("+ Épreuve CCF","new-ccf","primary"):btn("+ Nouvelle évaluation","new-trimester:"+key,"primary"))+'</div></div>';
 if(!c.students.length)html+='<div class="notice"><p>Commence par ajouter tes élèves : importe un fichier CSV ou colle une liste.</p><div class="row">'+btn("Importer un CSV","import-csv","primary small")+btn("Coller une liste","paste-students","small")+'</div></div>';
 html+='<div class="seg" role="group" aria-label="Choisir un trimestre">'+tabs+'</div>';
 html+=current.length?'<div class="eval-list">'+current.map(evalRow).join("")+'</div>':ccfTab?'<div class="empty" style="margin-top:14px"><p>Aucune épreuve CCF pour l’instant. Les fiches certificatives du lycée sont prêtes pour 10 activités : la saisie du jour calcule la note au regard du barème.</p>'+btn("+ Épreuve CCF","new-ccf","primary")+'</div>':'<div class="empty" style="margin-top:14px"><p>Aucune évaluation dans cette période.</p>'+btn("+ Nouvelle évaluation","new-trimester:"+key,"primary")+'</div>';
 if(c.folders.length)html+='<details class="archive-box" data-keep="folders"><summary>Dossiers ('+c.folders.length+')</summary>'+c.folders.map(f=>'<div class="section-head"><h3>'+esc(f.name)+'</h3><div class="row">'+btn("Renommer","rename-folder:"+f.id,"small")+btn("Supprimer le dossier","delete-folder:"+f.id,"small danger")+'</div></div><div class="eval-list">'+(c.tables.filter(t=>t.folderId===f.id).map(evalRow).join("")||'<p class="muted">Dossier vide.</p>')+'</div>').join("")+'</details>';
 return html;
},
students(){
 const c=cls(),list=[...c.students].sort(byName);
 return '<div class="crumbs">'+btn("← "+esc(c.name),"open-class:"+c.id,"quiet small")+'</div><div class="page-head"><div><h1>Élèves de '+esc(c.name)+'</h1><p class="muted">Un élève ajouté ici apparaît dans toutes les évaluations de la classe.</p></div><div class="row">'+btn("Importer un CSV","import-csv")+btn("Coller une liste","paste-students")+btn("+ Ajouter un élève","add-student","primary")+'</div></div>'+
 (list.length?'<div class="student-grid">'+list.map(s=>'<div class="student-line"><span>'+face(s,"sm")+esc(s.name)+sexTag(s)+'</span>'+btn("Modifier","edit-student:"+s.id,"small quiet")+""+'</div>').join("")+'</div>':'<div class="empty"><p>Aucun élève dans cette classe pour l’instant.</p></div>');
},
storage(){
 const n=storageBytes(),drawings=data.classes.flatMap(c=>c.tables.flatMap(t=>Object.values(t.results||{}))).filter(r=>r.drawing).length;
 const items=data.classes.flatMap(c=>c.tables.map(t=>({c,t})));
 return '<div class="crumbs">'+btn("← Mes classes","classes","quiet small")+'</div><div class="page-head"><h1>Stockage et sauvegardes</h1></div><div class="sheet"><h2>'+storageLabel(n)+' de données</h2><p>'+esc(storageWarning(n))+'</p><p class="muted small-text">'+plural(drawings,"note manuscrite")+'. '+esc(backupAge())+' Les données sont enregistrées dans la base du carnet.</p><div class="row" style="margin-top:12px">'+btn("Faire une sauvegarde","export-json","primary")+btn("Restaurer une sauvegarde","import-json")+'</div></div><div class="section-head"><h2>Évaluations</h2></div>'+
 (items.length?'<div class="eval-list">'+items.map(({c,t})=>{const count=Object.keys(t.results||{}).filter(id=>hasObservation(t,id)).length;return '<div class="eval-row"><div><h3>'+esc(t.name)+'</h3><p>'+esc(c.name)+', '+plural(count,"élève")+' avec observations</p></div><div class="row">'+btn("Archiver en HTML","export-storage:"+c.id+":"+t.id,"small")+btn("Vider les observations","clear-results:"+c.id+":"+t.id,"small danger")+'</div></div>'}).join("")+'</div>':'<div class="empty"><p>Aucune évaluation pour l’instant.</p></div>');
},
setup(){
 const t=tab(),list=t.observables;
 return evalHead()+(!isCollegeClass()?'<div class="notice ccf-notice"><p><b>Épreuve de Terminale ?</b> Le mode CCF calcule la note à partir des fiches certificatives (AFL1, AFL2, AFL3). Il se crée depuis l’onglet « CCF Terminale » de la classe.</p>'+btn("Créer une épreuve CCF","new-ccf","primary small")+'</div>':"")+'<div class="page-head"><div><h2>Compétences évaluées</h2><p class="muted">Degrés de maîtrise de 1 à 4, individuels ou par groupe.</p></div>'+competencyActions()+'</div>'+
 (list.length?'<div class="comp-list">'+list.map(o=>'<div class="comp-row"><div><h3>'+esc(o.name)+'</h3><span class="tag">'+esc(referenceLevelLabel(resolvedReference(o)))+'</span> <span class="tag">'+(observableScope(o)==="collective"?"Par groupe":"Par élève")+'</span></div>'+'<label class="points-field">Points<input class="input" type="number" inputmode="decimal" min="0" step=".5" data-observable-points="'+esc(o.id)+'" value="'+esc(o.points??"")+'"></label>'+btn("Modifier les critères","edit-observable:"+o.id,"small")+'<div class="scale-line" data-scale="'+esc(o.id)+'">'+degreeScale(o)+'</div></div>').join("")+'</div><section class="sheet scale"><p id="points-total">'+esc(pointsTotal(t))+'</p></section>':'<div class="empty"><p>Choisis des compétences dans le catalogue par APSA, ou crée les tiennes. Tu peux aussi observer sans compétence.</p>'+btn("Ouvrir le catalogue APSA","catalog-apsa","primary")+'</div>')+
 '<div class="row" style="margin-top:18px">'+btn("Composer les groupes","tab:terrain")+btn("Observer","tab:observation","primary")+'</div>';
},
terrain(){
 const c=cls(),t=tab(),groups=t.groups;
 const unique=new Set();let changed=false;
 groups.forEach(g=>{const before=g.studentIds.length;g.studentIds=g.studentIds.filter(sid=>{if(unique.has(sid))return false;unique.add(sid);return true});if(before!==g.studentIds.length)changed=true});
 if(changed)save();
 const out=s=>STATUS[t.results[s.id]?.status];
 const chip=st=>'<span class="chip'+(terrainSelection.has(st.id)?" picked":"")+(out(st)?" out":"")+'"><button type="button" class="chip-name" aria-pressed="'+terrainSelection.has(st.id)+'" data-drag-student="'+esc(st.id)+'" data-action="terrain-pick:'+esc(st.id)+'">'+face(st,"sm")+esc(st.name)+sexTag(st)+'</button><button type="button" class="chip-open" data-action="terrain-student-open:'+esc(st.id)+'" aria-label="Ouvrir la fiche de '+esc(st.name)+'">↗</button></span>';
 const free=[...c.students].sort(byName).filter(st=>!unique.has(st.id));
 const n=terrainSelection.size;
 let html=evalHead()+'<div class="page-head"><div><h2>Composer les groupes</h2><p class="muted">Touche des élèves pour les sélectionner, ou maintiens un nom appuyé pour le glisser.</p></div><div class="row">'+btn("Groupes automatiques","auto-groups")+btn("+ Groupe vide","terrain-new")+'</div></div>';
 if(n)html+='<div class="select-bar"><strong>'+plural(n,"élève")+' '+(n>1?"sélectionnés":"sélectionné")+'</strong>'+btn("Créer un groupe","terrain-create-selected","primary small")+btn("Retirer des groupes","terrain-move:pool","small")+btn("Annuler","terrain-clear","small quiet")+'</div>';
 html+='<div class="board"><section class="zone" data-drop-zone="pool"><div class="zone-head"><h2>Sans groupe ('+free.length+')</h2></div><div class="zone-body"><div class="people">'+free.map(chip).join("")+'</div>'+(free.length?"":'<p class="muted small-text">Tous les élèves sont dans un groupe.</p>')+'</div></section>';
 html+=groups.map(g=>'<section class="zone" data-drop-zone="'+esc(g.id)+'"><div class="zone-head" '+bibStyle(g)+'><h2>'+esc(g.name)+' ('+g.studentIds.length+')</h2>'+btn("Modifier","terrain-rename:"+g.id,"small")+'</div><div class="zone-body"><div class="people">'+g.studentIds.map(id=>c.students.find(st=>st.id===id)).filter(Boolean).map(chip).join("")+'</div><div class="zone-actions">'+(n?btn("Ajouter ici ("+n+")","terrain-move:"+g.id,"small primary"):"")+btn("Observer ce groupe","terrain-observe:"+g.id,"small")+'</div></div></section>').join("")+'</div>';
 return html;
},
observation(){
 const c=cls(),t=tab(),groups=t.groups;
 return evalHead()+obsSwitch()+(groups.length?'<div class="group-grid">'+groups.map(g=>'<button type="button" class="group-card" data-action="observation-open:'+esc(g.id)+'"><span class="bib" '+bibStyle(g)+'><span>'+esc(g.name)+'</span><span>'+g.studentIds.length+'</span></span><p>'+g.studentIds.map(id=>c.students.find(st=>st.id===id)?.name||"").filter(Boolean).map(esc).join(", ")+'</p></button>').join("")+'</div>':'<div class="empty"><p>Aucun groupe dans cette évaluation.</p>'+btn("Composer les groupes","tab:terrain","primary")+'</div>');
},
"observation-group"(){
 const c=cls(),t=tab(),g=t.groups.find(x=>x.id===observationGroupId);
 if(!g){view.page="observation";return pages.observation()}
 const members=g.studentIds.map(id=>c.students.find(st=>st.id===id)).filter(Boolean);
 const collective=t.observables.some(o=>observableScope(o)==="collective");
 return evalHead()+'<div class="row" style="margin-bottom:10px">'+btn("← Tous les groupes","observation-back","quiet small")+'</div><div class="bib-head" '+bibStyle(g)+'><span>'+esc(g.name)+'</span>'+btn("Modifier le groupe","terrain-rename:"+g.id,"small")+'</div>'+
 '<div class="'+(collective?"two-col":"")+'"><section class="sheet"><label class="field">Observation collective<textarea data-observation-group="'+esc(g.id)+'" placeholder="Coopération, sécurité, organisation…">'+esc(g.comment||"")+'</textarea></label></section>'+(collective?competencyPanel(t,g.levels||{},"collective",g.id):"")+'</div>'+
 '<div class="student-cards">'+members.map(st=>{const a=t.results[st.id]||{};return '<section class="student-card"><div class="student-card-head"><strong>'+face(st)+esc(st.name)+'</strong>'+btn("Fiche complète","observation-student:"+st.id,"small")+'</div><label class="field">Note /20'+noteField(t,st.id,a)+'</label><label class="field">Observation<textarea data-observation-student="'+esc(st.id)+'" placeholder="Ce que j’observe…">'+esc(a.comment||"")+'</textarea></label>'+competencyPanel(t,a.levels||{},"individual",st.id,true)+scoreLine(t,st.id)+'</section>'}).join("")+'</div>';
},
"observation-individual"(){
 const c=cls(),t=tab(),students=[...c.students].sort(byName),done=students.filter(s=>hasObservation(t,s.id)||t.results[s.id]?.status).length;
 return evalHead()+obsSwitch()+(students.length?'<div class="progress"><span>'+done+' sur '+students.length+'</span><div class="progress-bar"><span style="width:'+Math.round(done/students.length*100)+'%"></span></div></div><div class="obs-list">'+students.map(st=>'<button type="button" class="obs-row" data-action="individual-student:'+esc(st.id)+'"><span>'+face(st,"sm")+esc(st.name)+'</span>'+studentState(t,st.id)+'</button>').join("")+'</div>':noStudents());
},
"observation-student"(){
 const c=cls(),t=tab(),st=c.students.find(x=>x.id===observationStudentId);
 if(!st){view.page="observation-individual";return pages["observation-individual"]()}
 const g=t.groups.find(x=>x.id===observationGroupId),a=t.results[st.id]||{};
 const order=(g?g.studentIds.map(id=>c.students.find(s=>s.id===id)).filter(Boolean):[...c.students].sort(byName)),i=order.findIndex(s=>s.id===st.id),prev=order[i-1],next=order[i+1];
 const status=[["","Présent"],["absent","Absent"],["dispense","Dispensé"]].map(([k,l])=>'<button type="button" data-status="'+k+'" aria-pressed="'+((a.status||"")===k)+'" data-action="set-status:'+esc(st.id)+':'+k+'">'+l+'</button>').join("");
 const panel=competencyPanel(t,a.levels||{},"individual",st.id);
 return evalHead()+'<div class="row" style="margin-bottom:10px">'+btn(g?"← "+esc(g.name):"← Liste des élèves","observation-student-back","quiet small")+'</div>'+
 '<div class="sheet-nav">'+(prev?btn("‹ <span>"+esc(prev.name)+"</span>","go-student:"+prev.id):'<span></span>')+'<div><h2>'+face(st,"lg")+esc(st.name)+'</h2><span class="muted small-text">'+(i+1)+' sur '+order.length+'</span></div>'+(next?btn("<span>"+esc(next.name)+"</span> ›","go-student:"+next.id,"primary"):'<span></span>')+'</div>'+
 '<div class="two-col"><section class="sheet"><div class="seg status-seg" role="group" aria-label="Présence">'+status+'</div><label class="field">Note /20'+noteField(t,st.id,a)+'</label><label class="field">Observation<textarea class="obs-text" data-observation-student="'+esc(st.id)+'" placeholder="Ce que j’observe pendant l’activité…">'+esc(a.comment||"")+'</textarea></label>'+btn(a.drawing?"Modifier la note manuscrite":"Écrire à la main","draw:"+st.id)+(a.drawing?'<img class="drawing-preview" alt="Note manuscrite de '+esc(st.name)+'" src="'+esc(safeImage(a.drawing))+'">':"")+'</section><div>'+panel+scoreLine(t,st.id)+'</div></div>';
},
table(){
 const c=cls(),t=tab(),students=[...c.students].sort(byName),ind=t.observables.filter(o=>observableScope(o)==="individual");
 const notes=students.map(s=>finalNote(t,s.id)).filter(n=>n!==null),absent=students.filter(s=>t.results[s.id]?.status).length;
 const pts=scored(t).length>0;
 const mean=notes.length?(notes.reduce((x,y)=>x+y,0)/notes.length).toFixed(2).replace(".",","):"–";
 return evalHead()+'<div class="page-head"><h2>Bilan de l’évaluation</h2><div class="row">'+btn("Exporter les notes (CSV)","export-csv")+btn("Archiver en HTML","export-html")+'</div></div><div class="stats"><div><strong>'+notes.length+'/'+students.length+'</strong>élèves notés</div><div><strong>'+mean+'</strong>moyenne de classe</div><div><strong>'+absent+'</strong>absents ou dispensés</div></div>'+
 (students.length?'<div class="tablewrap"><table><thead><tr><th>Élève</th>'+ind.map(o=>'<th>'+esc(o.name)+'</th>').join("")+'<th>Moyenne /4</th>'+(pts?'<th>Points</th>':"")+'<th>Note /20</th><th>Observation</th></tr></thead><tbody>'+students.map(s=>{
  const a=t.results[s.id]||{},m=degreeMean(ind,a);
  return '<tr><td>'+face(s,"sm")+esc(s.name)+(STATUS[a.status]?' <span class="state '+a.status+'">'+STATUS[a.status]+'</span>':"")+'</td>'+ind.map(o=>'<td><div class="mini-degrees">'+[1,2,3,4].map(n=>'<button type="button" class="degree d'+n+'" aria-pressed="'+(a.levels?.[o.id]===n)+'" aria-label="'+esc(s.name)+', '+esc(o.name)+', degré '+n+'" data-action="level:'+esc(s.id)+':'+esc(o.id)+':'+n+'">'+n+'</button>').join("")+'</div></td>').join("")+'<td><b>'+(m||"–")+'</b></td>'+(pts?scoreCells(t,s.id):"")+'<td>'+noteField(t,s.id,a,"input")+'</td><td><input class="input" data-observation-student="'+esc(s.id)+'" value="'+esc(a.comment||"")+'" aria-label="Observation de '+esc(s.name)+'"></td></tr>'}).join("")+'</tbody></table></div>':noStudents());
},
bilan(){return bilanPage()}
};
function scoreCells(t,sid){const s=computedScore(t,sid);return s.missing?'<td class="muted small-text">'+plural(s.missing,"compétence")+' à évaluer</td>':'<td>'+fr(s.earned)+' / '+fr(s.max)+'</td>'}
const segBtn=(id,label,n)=>'<button type="button" data-action="select-trimester:'+id+'" aria-pressed="'+(activeTrimester===id)+'">'+label+'<b>'+n+'</b></button>';
const noStudents=()=>'<div class="empty"><p>Ajoute d’abord les élèves de cette classe.</p>'+btn("Élèves","students","primary")+'</div>';
const noteInput=(sid,a,cls="")=>'<input class="note-input '+cls+'" type="number" inputmode="decimal" min="0" max="20" step=".25" data-observation-note="'+esc(sid)+'" value="'+esc(a.note??"")+'" aria-label="Note sur 20">';
const safeImage=v=>/^data:image\/(png|jpeg|webp);base64,/.test(v||"")?v:"";
function parseNote(v){if(v===""||v==null)return null;const n=Number(String(v).replace(",","."));return Number.isFinite(n)?n:null}
function degreeMean(items,a){const vals=items.map(o=>Number(a.levels?.[o.id]||0)).filter(Boolean);return vals.length?(vals.reduce((x,y)=>x+y,0)/vals.length).toFixed(2).replace(".",","):""}
/* Barème : chaque compétence vaut des points, répartis à parts égales sur les degrés :
   une compétence à 4 points donne 1, 2, 3 ou 4 points selon le degré.
   La note reste vide tant qu'une compétence notée n'est pas évaluée, pour ne pas fausser le résultat. */
const fr=n=>String(Math.round(n*100)/100).replace(".",",");
const degreePoints=(o,n)=>Number(o.points)*n/4;
const pointsLabel=v=>fr(v)+(v>1?" pts":" pt");
const degreeScale=o=>Number(o.points)>0?[1,2,3,4].map(n=>'<span class="rate d'+n+'">Degré '+n+' : <b>'+pointsLabel(degreePoints(o,n))+'</b></span>').join(""):'<span class="muted small-text">Indique les points de cette compétence.</span>';
const scored=t=>t.observables.filter(o=>Number(o.points)>0);
function computedScore(t,sid){
 const items=scored(t);if(!items.length)return null;
 const r=t.results[sid]||{},g=t.groups.find(x=>x.studentIds.includes(sid));
 let earned=0,max=0,missing=0;
 items.forEach(o=>{const p=Number(o.points),level=observableScope(o)==="collective"?g?.levels?.[o.id]:r.levels?.[o.id];max+=p;if(level)earned+=degreePoints(o,level);else missing++});
 return {earned,max,missing,note:missing?null:Math.round(earned/max*20*4)/4};
}
function scoreText(t,sid){const s=computedScore(t,sid);return !s?"":s.missing?plural(s.missing,"compétence")+" à évaluer":fr(s.earned)+" / "+fr(s.max)+" points, soit "+fr(s.note)+" / 20"}
const scoreLine=(t,sid)=>scored(t).length?'<p class="score-line" data-score="'+esc(sid)+'">'+esc(scoreText(t,sid))+'</p>':"";
/* Avec des points, la note est calculée ; sans points, c'est la note saisie à la main qui compte. */
function finalNote(t,sid){if(isCcf(t)){const r=t.results[sid];return r&&STATUS[r.status]?null:ccfEval(t,sid)?.note??null}return scored(t).length?computedScore(t,sid).note:parseNote(t.results[sid]?.note)}
const autoNote=(t,sid)=>{const n=finalNote(t,sid);return n===null?"–":fr(n)};
function noteField(t,sid,a,cls=""){return scored(t).length?'<output class="note-auto" data-note-auto="'+esc(sid)+'">'+esc(autoNote(t,sid))+'</output>':noteInput(sid,a,cls)}
function refreshScores(t){
 document.querySelectorAll("[data-score]").forEach(el=>{el.textContent=scoreText(t,el.dataset.score)});
 document.querySelectorAll("[data-note-auto]").forEach(el=>{el.textContent=autoNote(t,el.dataset.noteAuto)});
}
function pointsTotal(t){const max=scored(t).reduce((n,o)=>n+Number(o.points),0);return !max?"Indique des points pour calculer la note.":max===20?"Total : 20 points.":"Total : "+fr(max)+" points, ramenés sur 20 dans la note."}
const doneCount=(c,t)=>c.students.filter(s=>hasObservation(t,s.id)||t.results[s.id]?.status).length;
function classEvals(c){const now=currentTrimester(),current=c.tables.filter(t=>t.trimester===now);return [...(current.length?current:c.tables)].slice(-3).reverse()}
function evalLink(c,t){
 const done=doneCount(c,t),n=c.students.length,pct=n?Math.round(done/n*100):0;
 return '<button type="button" class="eval-link" data-action="open-eval:'+esc(c.id)+':'+esc(t.id)+'"><span class="eval-link-top"><b>'+esc(t.name)+'</b><span>'+done+'/'+n+'</span></span><span class="mini-bar"><span style="width:'+pct+'%"></span></span></button>';
}
function resumeBar(){
 const last=data.lastOpened,c=data.classes.find(x=>x.id===last?.classId&&!x.archived),t=c?.tables.find(x=>x.id===last.tableId);
 if(!t)return "";
 return '<button type="button" class="resume" data-action="open-eval:'+esc(c.id)+':'+esc(t.id)+'"><span><small>Reprendre</small><b>'+esc(t.name)+', '+esc(c.name)+'</b></span><span class="resume-state">'+doneCount(c,t)+' sur '+c.students.length+' observés ›</span></button>';
}
function evalRow(t){
 const c=cls(),seen=Object.keys(t.results).filter(id=>hasObservation(t,id)).length;
 const sub=isCcf(t)?'<span class="tag ccf-tag">CCF '+esc(ccfSpec(t).ca)+'</span> '+esc(ccfSpec(t).name)+', '+c.students.filter(s=>finalNote(t,s.id)!==null).length+'/'+c.students.length+' élèves notés'+(trimesterLabels[t.trimester]?', '+trimesterLabels[t.trimester]:""):plural(t.observables.length,"compétence")+', '+plural(t.groups.length,"groupe")+', '+seen+'/'+c.students.length+' élèves observés';
 return '<article class="eval-row"><div><h3>'+esc(t.name)+'</h3><p>'+sub+'</p></div>'+btn("Ouvrir","open-table:"+t.id,"primary")+menu("Options de "+t.name,btn("Renommer ou changer de trimestre","edit-table:"+t.id,"small")+btn("Réutiliser dans une autre classe","reuse-table:"+t.id,"small")+btn("Dupliquer sans les notes","duplicate-table:"+t.id,"small")+btn("Archiver en HTML","export-table:"+t.id,"small")+btn("Supprimer l’évaluation","delete-table:"+t.id,"small danger"))+'</article>';
}
function evalHead(){
 const c=cls(),t=tab(),p=view.page;
 if(isCcf(t)){
  const act=p==="ccf-table"?"ccf-table":p==="ccf-bareme"?"ccf-bareme":"ccf",it=(id,label)=>'<button type="button" data-action="tab:'+id+'"'+(act===id?' aria-current="page"':"")+'>'+label+'</button>';
  return '<header class="eval-head"><div class="eval-title"><div class="crumbs">'+btn("← "+esc(c.name),"open-class:"+c.id,"quiet small")+'</div><h1>'+esc(t.name)+'</h1><p class="eval-sub">Épreuve CCF · '+esc(ccfSpec(t).name)+' · '+esc(ccfSpec(t).ca)+'</p></div><nav class="tabs" aria-label="Étapes de l’épreuve">'+it("ccf","Saisie")+it("ccf-table","Bilan")+it("ccf-bareme","Barème")+'</nav></header>';
 }
 const active=p==="setup"?"setup":p==="terrain"?"terrain":p==="table"?"table":"observation";
 const item=(id,label)=>'<button type="button" data-action="tab:'+id+'"'+(active===id?' aria-current="page"':"")+'>'+label+'</button>';
 return '<header class="eval-head"><div class="eval-title"><div class="crumbs">'+btn("← "+esc(c.name),"open-class:"+c.id,"quiet small")+'</div><h1>'+esc(t.name)+'</h1></div><nav class="tabs" aria-label="Étapes de l’évaluation">'+item("setup","Compétences")+item("terrain","Groupes")+item("observation","Observer")+item("table","Bilan")+'</nav></header>';
}
function obsSwitch(){
 const p=view.page;
 return '<div class="seg" role="group" aria-label="Mode d’observation" style="margin-bottom:14px"><button type="button" data-action="observation-start" aria-pressed="'+(p==="observation")+'">Par groupe</button><button type="button" data-action="observation-individual-start" aria-pressed="'+(p==="observation-individual")+'">Par élève</button></div>';
}
function daysSinceBackup(){return data.lastBackup?Math.floor((Date.now()-new Date(data.lastBackup))/864e5):null}
function backupAge(){const d=daysSinceBackup();return d===null?"Aucune sauvegarde enregistrée depuis cet appareil.":d===0?"Dernière sauvegarde aujourd’hui.":"Dernière sauvegarde il y a "+plural(d,"jour")+"."}
function backupNotice(){return "";
 const has=data.classes.some(c=>c.students.length),d=daysSinceBackup();
 if(noticeDismissed||!has||(d!==null&&d<BACKUP_REMINDER_DAYS))return "";
 return '<div class="notice"><p>'+esc(backupAge())+' Tes données n’existent que sur cet appareil.</p><div class="row">'+btn("Faire une sauvegarde","export-json","primary small")+btn("Plus tard","dismiss-notice","small quiet")+'</div></div>';
}
const isIOS=()=>/iPad|iPhone|iPod/.test(navigator.userAgent)||(navigator.platform==="MacIntel"&&navigator.maxTouchPoints>1);
const isStandalone=()=>matchMedia("(display-mode: standalone)").matches||navigator.standalone===true;
function installNotice(){return "";
 let hidden=false;try{hidden=!!localStorage.getItem(KEY+"-install-vu")}catch{}
 if(hidden||!isIOS()||isStandalone())return "";
 return '<div class="notice"><p>Sur iPad, Safari peut effacer les données d’un site peu visité. Installe le classeur sur l’écran d’accueil pour les protéger.</p><div class="row">'+btn("Voir comment","install-info","small primary")+btn("Masquer","dismiss-install","small quiet")+'</div></div>';
}
/* Une couleur par espace : le prof sait où il est sans lire. */
/* Couleur de la classe dans le carnet : reprise dans tout le module. */
function classAccent(){const c=cls(),k=c&&Array.isArray(c.carnetColor)?c.carnetColor:null;if(!k||!/^#[0-9a-f]{6}$/i.test(k[0])||!/^#[0-9a-f]{6}$/i.test(k[1]))return "";return ' style="--accent:'+k[0]+';--accent-dark:'+k[0]+';--accent-tint:'+k[1]+'"'}
function accentFor(page){
 if(page==="class"||page==="bilan")return {T1:"blue",T2:"green",T3:"purple",ccf:"orange"}[activeTrimester]||"slate";
 if(page==="terrain"||page==="students")return "green";
 if(page==="table"||page==="storage"||page==="ccf-table")return "purple";
 if(page.startsWith("ccf"))return "orange";
 if(page.startsWith("observation"))return "orange";
 return "blue";
}
function render(){
 const page=pages[view.page]&&(!["class","students","bilan"].includes(view.page)||cls())&&(!["setup","terrain","observation","observation-group","observation-individual","observation-student","table","ccf","ccf-student","ccf-table","ccf-bareme"].includes(view.page)||tab())?view.page:"classes";
 view.page=page;
 const open=[...document.querySelectorAll("details[data-keep][open]")].map(d=>d.dataset.keep);
 const pageKey=page+view.classId+view.tableId+observationStudentId+observationGroupId,y=scrollY;
 $("app").innerHTML='<div class="app"><header class="topbar"><a class="brand" href="'+esc(carnetLink())+'"><img src="assets/icon.svg" alt=""><span>← Carnet</span></a><div class="topbar-right"><span class="status" id="status"></span><details class="menu"><summary class="btn small">Options</summary><div class="menu-list">'+btn("Mes classes","classes","small")+btn("Sauvegarde du carnet","export-json","small")+btn("Stockage","storage","small")+btn("Mode admin","admin","small")+btn("Recharger (version "+APP_VERSION+")","force-update","small")+'</div></details></div></header><main class="wrap accent-'+accentFor(page)+'"'+classAccent()+'>'+pages[page]()+'</main></div>';
 showStatus();
 document.querySelectorAll("details[data-keep]").forEach(d=>{if(open.includes(d.dataset.keep))d.open=true});
 if(pageKey!==lastPageKey){scrollTo(0,0);lastPageKey=pageKey}else scrollTo(0,y);
}

/* ---------- Bilan trimestriel ---------- */
/* Rangé dans chaque classe : c.bilans.T1 = {coefs:{idÉvaluation:n}, overrides:{idÉlève:"note"}, remarks:{idÉlève:"texte"}, tags:{idÉlève:[…]}, classTags:[…], classRemark:""}.
   Simple ajout de champs : les classeurs et sauvegardes existants restent lisibles sans migration. */
const ADMIN_CODE="3946";
function settings(){if(!data.settings||typeof data.settings!=="object")data.settings={};return data.settings}
const remarksOn=()=>!!settings().remarques;
const bilanTri=()=>trimesterLabels[activeTrimester]?activeTrimester:currentTrimester();
function bilanOf(c,tri){
 if(!c.bilans||typeof c.bilans!=="object")c.bilans={};
 const b=c.bilans[tri]=c.bilans[tri]&&typeof c.bilans[tri]==="object"?c.bilans[tri]:{};
 ["coefs","overrides","remarks","tags"].forEach(k=>{if(!b[k]||typeof b[k]!=="object")b[k]={}});
 if(!Array.isArray(b.classTags))b.classTags=[];
 if(typeof b.classRemark!=="string")b.classRemark="";
 return b;
}
const bilanTables=(c,tri)=>c.tables.filter(t=>t.trimester===tri);
function coefOf(b,t){const v=parseNote(b.coefs[t.id]);return v===null||v<0?1:v}
/* Un élève absent ou dispensé n'est pas compté dans l'activité concernée. */
function bilanNotes(c,tri,sid){
 const b=bilanOf(c,tri);
 return bilanTables(c,tri).map(t=>{const r=t.results[sid]||{};return {t,coef:coefOf(b,t),status:STATUS[r.status]?r.status:"",note:STATUS[r.status]?null:finalNote(t,sid)}});
}
function computedMean(c,tri,sid){
 let sum=0,w=0;
 bilanNotes(c,tri,sid).forEach(x=>{if(x.note!==null&&x.coef>0){sum+=x.note*x.coef;w+=x.coef}});
 return w?Math.round(sum/w*100)/100:null;
}
function overrideOf(c,tri,sid){const o=parseNote(bilanOf(c,tri).overrides[sid]);return o!==null&&o>=0&&o<=20?o:null}
function retainedMean(c,tri,sid){const o=overrideOf(c,tri,sid);return o!==null?o:computedMean(c,tri,sid)}
function bilanStats(c,tri){
 const n=c.students.length,means=c.students.map(s=>retainedMean(c,tri,s.id)).filter(x=>x!==null);
 const mean=means.length?Math.round(means.reduce((x,y)=>x+y,0)/means.length*100)/100:null;
 return {n,means,mean,html:'<div><strong>'+means.length+'/'+n+'</strong>élèves avec une moyenne</div><div><strong>'+(mean===null?"–":fr(mean))+'</strong>moyenne de classe</div><div><strong>'+(means.length?fr(Math.min(...means))+" à "+fr(Math.max(...means)):"–")+'</strong>moyenne min. à max.</div>'};
}
const STUDENT_TAGS=[["investi","Investi·e"],["discret","Discret·ète"],["progres","En progrès"],["comportement","Comportement à revoir"],["implication","Manque d’implication"],["arrive","Arrivé·e en cours de trimestre"]];
const CLASS_TAGS=[["agreable","Agréable"],["travailleuse","Travailleuse"],["dissipee","Dissipée"],["heterogene","Résultats hétérogènes"]];
const tagBtn=(target,k,label,on)=>'<button type="button" class="remark-tag" aria-pressed="'+on+'" data-action="bilan-tag:'+esc(target)+':'+k+'">'+label+'</button>';
const countLabel=v=>plural(String(v||"").length,"caractère");
function bilanPage(){
 const c=cls(),tri=bilanTri(),b=bilanOf(c,tri),tables=bilanTables(c,tri),students=[...c.students].sort(byName),on=remarksOn();
 const tabs=Object.entries(trimesterLabels).map(([id,label])=>'<button type="button" data-action="bilan-trimester:'+id+'" aria-pressed="'+(tri===id)+'">'+label+'<b>'+bilanTables(c,id).length+'</b></button>').join("");
 let html='<div class="crumbs">'+btn("← "+esc(c.name),"open-class:"+c.id,"quiet small")+'</div><div class="page-head"><div><h1>Bilan du '+trimesterLabels[tri]+'</h1><p class="muted">'+esc(c.name)+', '+plural(tables.length,"évaluation")+'</p></div><div class="row">'+(tables.length&&students.length?btn("Exporter le bilan (CSV)","bilan-csv"):"")+'</div></div>';
 html+='<div class="seg" role="group" aria-label="Choisir un trimestre" style="margin-bottom:14px">'+tabs+'</div>';
 if(!students.length)return html+noStudents();
 if(!tables.length)return html+'<div class="empty"><p>Aucune évaluation rangée dans ce trimestre. Pour en ajouter une, ouvre son menu ⋯ puis « Renommer ou changer de trimestre ».</p>'+btn("← Retour à la classe","open-class:"+c.id,"primary")+'</div>';
 const st=bilanStats(c,tri);
 html+='<div class="stats" id="bilan-stats">'+st.html+'</div>';
 html+='<p class="muted small-text bilan-help">Le coefficient de chaque activité se règle dans la ligne grise (0 pour ne pas la compter). Un élève absent ou dispensé n’est pas compté dans l’activité concernée. « Moyenne retenue » permet de corriger la moyenne à la main ; vide, elle reprend la moyenne calculée.</p>';
 html+='<div class="tablewrap bilan-table"><table><thead><tr><th>Élève</th>'+tables.map(t=>'<th>'+esc(t.name)+'</th>').join("")+'<th>Moyenne calculée</th><th>Moyenne retenue</th></tr><tr class="coef-row"><th>Coefficient</th>'+tables.map(t=>'<th><input class="input coef-input" type="number" inputmode="decimal" min="0" step=".5" data-bilan-coef="'+esc(t.id)+'" value="'+esc(b.coefs[t.id]??1)+'" aria-label="Coefficient de '+esc(t.name)+'"></th>').join("")+'<th></th><th></th></tr></thead><tbody>'+students.map(s=>{
  const cells=bilanNotes(c,tri,s.id).map(x=>'<td>'+(x.status?'<span class="state '+x.status+'">'+STATUS[x.status]+'</span>':x.note===null?'<span class="muted">–</span>':fr(x.note))+'</td>').join("");
  const m=computedMean(c,tri,s.id);
  return '<tr><td>'+esc(s.name)+'</td>'+cells+'<td><b data-bilan-computed="'+esc(s.id)+'">'+(m===null?"–":fr(m))+'</b></td><td><input class="input note-input" type="number" inputmode="decimal" min="0" max="20" step=".01" data-bilan-override="'+esc(s.id)+'" value="'+esc(b.overrides[s.id]??"")+'" placeholder="'+(m===null?"":esc(fr(m)))+'" aria-label="Moyenne retenue de '+esc(s.name)+'"></td></tr>';
 }).join("")+'</tbody></table></div>';
 if(!on)return html;
 html+='<div class="section-head"><h2>Appréciations pour le bulletin</h2><div class="row">'+btn("Proposer pour les appréciations vides","bilan-propose-all","primary")+btn("Copie élève par élève","bilan-copy-step","")+btn("Tout copier","bilan-copy-all","")+btn("Effacer toutes les appréciations","bilan-clear-all","danger")+'</div></div>';
 html+='<p class="muted small-text bilan-help">Coche au besoin un ou deux repères, puis « Reformuler » : chaque appui donne une autre appréciation. Le texte reste modifiable ; « Effacer » vide la case.</p>';
 html+='<section class="sheet remark-card remark-class"><div class="remark-head"><strong>Appréciation générale de la classe</strong></div><div class="remark-tags">'+CLASS_TAGS.map(([k,l])=>tagBtn("class",k,l,b.classTags.includes(k))).join("")+'</div><textarea class="input remark-text" data-bilan-class-remark="1" rows="3" placeholder="Appréciation de la classe…" aria-label="Appréciation générale de la classe">'+esc(b.classRemark)+'</textarea><div class="remark-foot"><span class="muted small-text" data-count="class">'+countLabel(b.classRemark)+'</span><div class="row">'+btn("Effacer","bilan-clear:class","small quiet")+btn("Copier","bilan-copy:class","small quiet")+btn("Reformuler","bilan-propose:class","small")+'</div></div></section>';
 html+='<div class="remark-list">'+students.map(s=>{
  const tags=b.tags[s.id]||[],m=retainedMean(c,tri,s.id);
  const summary=bilanNotes(c,tri,s.id).map(x=>esc(x.t.name)+' '+(x.status?STATUS[x.status].toLowerCase():x.note===null?"–":fr(x.note))).join(" · ");
  return '<section class="sheet remark-card"><div class="remark-head"><strong>'+face(s)+esc(s.name)+'</strong><span class="remark-mean" data-bilan-mean="'+esc(s.id)+'">'+(m===null?"–":fr(m))+'</span></div><p class="muted small-text remark-notes">'+summary+'</p><div class="remark-tags">'+STUDENT_TAGS.map(([k,l])=>tagBtn(s.id,k,l,tags.includes(k))).join("")+'</div><textarea class="input remark-text" data-bilan-remark="'+esc(s.id)+'" rows="3" placeholder="Appréciation pour le bulletin…" aria-label="Appréciation de '+esc(s.name)+'">'+esc(b.remarks[s.id]||"")+'</textarea><div class="remark-foot"><span class="muted small-text" data-count="'+esc(s.id)+'">'+countLabel(b.remarks[s.id])+'</span><div class="row">'+btn("Effacer","bilan-clear:"+s.id,"small quiet")+btn("Copier","bilan-copy:"+s.id,"small quiet")+btn("Reformuler","bilan-propose:"+s.id,"small")+'</div></div></section>';
 }).join("")+'</div>';
 return html;
}
/* Copie élève par élève pour PRONOTE : chaque appui copie l'appréciation de l'élève affiché, puis passe au suivant. */
const copyStep={
 index:0,
 bar(){let el=document.getElementById("copyStep");if(!el){el=document.createElement("div");el.id="copyStep";el.className="copy-step";el.setAttribute("role","region");el.setAttribute("aria-label","Copie élève par élève");document.body.append(el)}return el},
 list(){const c=cls();const b=bilanOf(c,bilanTri());return c.students.map(s=>({s,text:(b.remarks[s.id]||"").trim()}))},
 open(){this.index=0;this.done=null;this.draw()},
 close(){document.getElementById("copyStep")?.remove()},
 draw(){
  const items=this.list();if(!items.length){this.close();return}
  this.index=Math.max(0,Math.min(this.index,items.length-1));
  const it=items[this.index];
  this.bar().innerHTML='<div class="copy-step-info"><span class="muted small-text">'+(this.done?"✓ "+esc(this.done)+" copiée · ":"")+"Élève "+(this.index+1)+" / "+items.length+'</span><strong>'+face(it.s,"sm")+esc(it.s.name)+'</strong><span class="copy-step-text">'+(it.text?esc(it.text):'<em class="muted">Pas d’appréciation</em>')+'</span></div><div class="copy-step-actions"><button type="button" class="btn small quiet" data-step="prev" aria-label="Élève précédent">←</button><button type="button" class="btn primary" data-step="copy"'+(it.text?"":" disabled")+'>Copier</button><button type="button" class="btn small quiet" data-step="next" aria-label="Élève suivant">→</button><button type="button" class="btn small quiet" data-step="close">Fermer</button></div>';
  this.bar().onclick=e=>{const a=e.target.closest("[data-step]")?.dataset.step;if(!a)return;if(a==="close")this.close();if(a==="prev"){this.index--;this.done=null;this.draw()}if(a==="next"){this.index++;this.done=null;this.draw()}if(a==="copy")this.copy()};
 },
 async copy(){
  const items=this.list(),it=items[this.index];if(!it?.text)return;
  try{await navigator.clipboard.writeText(it.text)}catch{toast("Copie impossible : sélectionne le texte puis copie-le.");return}
  this.done=it.s.name;
  if(this.index<items.length-1)this.index++;else toast("Dernier élève : toutes les appréciations sont passées.");
  this.draw();
 }
};
/* Mise à jour ciblée pendant la saisie : le clavier reste ouvert sur iPad. */
function refreshBilan(){
 const c=cls();if(!c||view.page!=="bilan")return;const tri=bilanTri();
 document.querySelectorAll("[data-bilan-computed]").forEach(el=>{const m=computedMean(c,tri,el.dataset.bilanComputed);el.textContent=m===null?"–":fr(m)});
 document.querySelectorAll("[data-bilan-override]").forEach(el=>{const m=computedMean(c,tri,el.dataset.bilanOverride);el.placeholder=m===null?"":fr(m)});
 document.querySelectorAll("[data-bilan-mean]").forEach(el=>{const m=retainedMean(c,tri,el.dataset.bilanMean);el.textContent=m===null?"–":fr(m)});
 const box=$("bilan-stats");if(box)box.innerHTML=bilanStats(c,tri).html;
}
function exportBilanCsv(){
 const c=cls(),tri=bilanTri(),b=bilanOf(c,tri),tables=bilanTables(c,tri),on=remarksOn();
 const rows=[["Élève",...tables.map(t=>t.name+" (coef "+fr(coefOf(b,t))+")"),"Moyenne calculée","Moyenne retenue",...(on?["Appréciation"]:[])]];
 [...c.students].sort(byName).forEach(s=>{const m=computedMean(c,tri,s.id),r=retainedMean(c,tri,s.id);rows.push([s.name,...bilanNotes(c,tri,s.id).map(x=>x.status?STATUS[x.status]:x.note===null?"":fr(x.note)),m===null?"":fr(m),r===null?"":fr(r),...(on?[b.remarks[s.id]||""]:[])])});
 if(on&&b.classRemark)rows.push([],["Appréciation de la classe",b.classRemark]);
 exportFile("bilan-"+safeName(c.name)+"-"+tri+"-"+today()+".csv","﻿"+rows.map(r=>r.map(csvCell).join(";")).join("\r\n"),"text/csv;charset=utf-8");
}

/* ---------- Propositions d'appréciation ---------- */
/* Phrases écrites dans le style des appréciations du professeur ; aucune donnée ne quitte l'appareil. */
function firstName(s){
 const parts=String(s.name||"").trim().split(/\s+/).filter(Boolean),order=settings().nameOrder||"auto";
 if(parts.length<2)return parts[0]||"";
 if(order==="prenom-nom")return parts[0];
 if(order==="nom-prenom")return parts[parts.length-1];
 const upper=w=>/\p{L}{2}/u.test(w)&&w===w.toLocaleUpperCase("fr");
 const rest=parts.filter(w=>!upper(w));
 return rest.length&&rest.length<parts.length?rest.join(" "):parts[0];
}
function hashStr(x){let h=7;for(const ch of String(x))h=(h*31+ch.codePointAt(0))>>>0;return h}
const proposalTurns={},lastProposal={};
const tierOf=m=>m===null?null:m>=17.5?"A":m>=16?"B":m>=14?"C":m>=12?"D":m>=10?"E":"F";
const apsaLabel=n=>/^\p{Lu}\p{Ll}/u.test(n)?n.charAt(0).toLocaleLowerCase("fr")+n.slice(1):n;
function studentProposal(c,tri,s){
 const b=bilanOf(c,tri),tags=b.tags[s.id]||[],has=k=>tags.includes(k),P=firstName(s)||"l’élève",G=(m,f)=>s.sex==="F"?f:m,il=G("il","elle");
 const notes=bilanNotes(c,tri,s.id),m=retainedMean(c,tri,s.id),tier=tierOf(m),t3=tri==="T3";
 const key=s.id+tri,turn=proposalTurns[key]=(proposalTurns[key]??-1)+1,seed=hashStr(key)+turn;
 const pick=(list,k=0)=>list[(seed+k*7)%list.length];
 if(m===null){
  if(has("arrive"))return G("Arrivé","Arrivée")+" en cours de trimestre, "+P+" n’a pas pu être "+G("évalué","évaluée")+". "+(t3?"Je lui souhaite une bonne continuation.":"Je compte sur son implication pour aborder sereinement le prochain trimestre.");
  if(notes.length&&notes.every(x=>x.status==="dispense"))return G("Élève dispensé","Élève dispensée")+" lors des évaluations ce trimestre.";
  if(notes.some(x=>x.status))return G("Non évalué","Non évaluée")+" ce trimestre en raison de ses absences ou dispenses.";
  return "Aucune note enregistrée ce trimestre.";
 }
 const parts=[];
 if(has("arrive"))parts.push(G("Arrivé","Arrivée")+" en cours de trimestre, "+P+" n’a pas pu être "+G("évalué","évaluée")+" dans toutes les activités.");
 const discretOpen=has("discret")&&"ABCD".includes(tier);
 const OPEN={
  A:["Un excellent trimestre pour "+P+".","D’excellents résultats ce trimestre pour "+P+".","Un excellent trimestre à tout point de vue.",...(t3?["Un excellent troisième trimestre pour "+P+", à l’image de son année menée avec rigueur et sérieux."]:[])],
  B:["De très bons résultats ce trimestre.","Un très bon trimestre pour "+P+".",P+" obtient de très bons résultats ce trimestre."],
  C:["De bons résultats ce trimestre.","Un bon trimestre pour "+P+".",P+" obtient de bons résultats ce trimestre."],
  D:["Des résultats satisfaisants ce trimestre.","Ensemble satisfaisant.","Un trimestre satisfaisant pour "+P+"."],
  E:["Des résultats convenables et largement perfectibles.","Des résultats justes satisfaisants pour "+P+" ce trimestre.","Un trimestre convenable, mais "+P+" peut viser mieux."],
  F:["Un trimestre fragile.","Des résultats insuffisants ce trimestre.","Un trimestre difficile pour "+P+"."]
 };
 parts.push(discretOpen?G("Discret mais travailleur","Discrète mais travailleuse")+", "+P+" réalise "+{A:"un excellent",B:"un très bon",C:"un bon",D:"un"}[tier]+(t3?" troisième":"")+" trimestre"+(tier==="D"?" satisfaisant":"")+".":pick(OPEN[tier]));
 const att=[];
 if(has("progres"))att.push(pick(["Du mieux ce trimestre tant du point de vue de l’implication que du travail.","Des progrès réels se sont fait sentir au cours du trimestre."],1));
 if(has("investi"))att.push(pick(["Très "+G("investi","investie")+" dans la matière, "+il+" fait preuve d’une participation active.","Le travail et la participation ont été sérieux et appliqués.","L’implication en cours est remarquable."],2));
 if(has("comportement"))att.push(pick(["Attention cependant au comportement, qui reste largement perfectible.","Il faut canaliser cette énergie et la mettre au service de vos apprentissages.","Le comportement doit progresser pour prétendre à de meilleurs résultats."],3));
 if(has("implication"))att.push(pick(["Les résultats auraient pu être bien meilleurs avec une plus grande implication en classe.","Il faudra s’impliquer davantage en classe : "+il+" en a les capacités.","Le manque d’implication en classe freine les progrès."],4));
 if(has("discret")&&!discretOpen)att.push("Élève "+G("discret","discrète")+", "+P+" doit oser s’engager davantage dans les activités.");
 const BASE={
  A:["Le travail a été sérieux et appliqué.","Un travail de qualité et une participation active.","Le travail et la participation ont été sérieux et appliqués."],
  B:["Le travail a été sérieux et appliqué.","Un travail sérieux et une participation active.","Le travail est rigoureux et la participation active."],
  C:["Le travail et l’implication dans la matière sont sérieux.","La participation et l’implication en cours sont satisfaisantes.","Le travail est sérieux et appliqué."],
  D:["Le travail est sérieux mais peut encore gagner en régularité.","Une implication plus constante permettrait de progresser.","Il reste une belle marge de progression dans la matière."],
  E:["Une plus grande concentration en classe permettrait de progresser.","Il faudra s’impliquer davantage pour progresser.","Il reste une belle marge de progression : "+il+" en a les capacités."],
  F:["Il faut s’investir davantage dans les situations d’apprentissage pour progresser.","L’engagement en cours doit nettement progresser.","Il faudra se mobiliser davantage et ne pas se décourager."]
 };
 if(!att.length&&!discretOpen)att.push(pick(BASE[tier],5));
 parts.push(...att.slice(0,2));
 const graded=notes.filter(x=>x.note!==null&&x.coef>0);
 if(graded.length>1){
  const low=graded.reduce((a,x)=>x.note<a.note?x:a);
  if(low.note<10||low.note<=m-3){const A=apsaLabel(low.t.name);parts.push(pick(["Des difficultés en "+A+" ont pesé sur la moyenne trimestrielle.","Moins à l’aise en "+A+", "+il+" doit poursuivre ses efforts dans cette activité.","Il faudra continuer à travailler en "+A+" sans se démobiliser."],6))}
 }
 const neg=has("comportement")||has("implication");
 const CLOSE=t3?{A:["Le bilan annuel est très positif. Félicitations.","Félicitations pour cette belle année."],B:["Le bilan annuel est très positif.","Le bilan annuel est très positif. Félicitations."],C:["Le bilan annuel est positif."],D:["Le bilan annuel est satisfaisant."],E:["Le bilan annuel reste perfectible."],F:["Il faudra se mobiliser davantage l’an prochain. Courage."]}
  :{A:["Félicitations, poursuivez ainsi.","Félicitations."],B:["Poursuivez ainsi.","Félicitations, poursuivez ainsi."],C:["Poursuivez ainsi."],D:["Il faut poursuivre dans cette voie.","Poursuivez vos efforts."],E:["Il faut se mobiliser davantage au prochain trimestre."],F:["Réagissez !","Courage, il faut se ressaisir."]};
 let close=pick(CLOSE[tier],8);
 if(neg&&!t3&&"ABCD".includes(tier))close="Des efforts sont attendus au prochain trimestre.";
 if(neg&&t3&&/Félicitations/.test(close))close="Le bilan annuel est positif.";
 parts.push(close);
 return parts.join(" ");
}
function classProposal(c,tri){
 const b=bilanOf(c,tri),has=k=>b.classTags.includes(k),st=bilanStats(c,tri),tier=tierOf(st.mean)||"C",t3=tri==="T3",good="ABCD".includes(tier);
 const key=c.id+tri,turn=proposalTurns[key]=(proposalTurns[key]??-1)+1,seed=hashStr(key)+turn,pick=(list,k=0)=>list[(seed+k*7)%list.length];
 const qual=[has("agreable")&&"très agréable",has("travailleuse")&&"travailleuse"].filter(Boolean).join(" et ");
 const qualG=qual.replace(/travailleuse$/,"travailleur");
 const parts=[];
 if(has("dissipee"))parts.push(pick([(has("agreable")?"Classe sympathique mais":"Classe")+" trop souvent dissipée, ce qui freine les apprentissages.","Un groupe aux capacités réelles mais dont l’agitation pénalise le travail en cours."]));
 else if(t3){parts.push("Un trimestre à l’image de l’année scolaire, "+(good?"très satisfaisant":"perfectible")+" du point de vue du travail et de l’implication.");if(qual)parts.push("Un groupe classe "+qualG+" avec lequel il a été très intéressant de travailler.")}
 else if(qual)parts.push(pick(["Classe "+qual+" avec laquelle je prends un réel plaisir à enseigner.","Un groupe classe "+qualG+" avec lequel il est très intéressant de travailler."],1));
 else parts.push(pick(good?["Une classe sérieuse et impliquée dans la matière.","Un groupe classe sérieux dans l’ensemble."]:["Une classe qui doit se mobiliser davantage.","Un groupe qui doit s’impliquer davantage dans la matière."],2));
 if(has("heterogene"))parts.push("Les résultats restent hétérogènes : certains élèves doivent s’impliquer davantage.");
 if(!t3)parts.push(has("dissipee")||!good?"Des efforts sont attendus au prochain trimestre.":"Poursuivez ainsi.");
 return parts.join(" ");
}
function setRemark(target,text){
 const c=cls(),b=bilanOf(c,bilanTri());
 if(target==="class")b.classRemark=text;else b.remarks[target]=text;
 const el=document.querySelector(target==="class"?"[data-bilan-class-remark]":'[data-bilan-remark="'+CSS.escape(target)+'"]');if(el)el.value=text;
 const n=document.querySelector('[data-count="'+CSS.escape(target)+'"]');if(n)n.textContent=countLabel(text);
}
function adminPanel(){
 const order=settings().nameOrder||"auto",opt=(v,l)=>'<option value="'+v+'"'+(order===v?" selected":"")+'>'+l+'</option>';
 modal("Réglages admin",'<label class="check"><input type="checkbox" id="fremarques"'+(remarksOn()?" checked":"")+'>Appréciations pour le bulletin dans le bilan du trimestre</label><label class="field">Prénom utilisé dans les appréciations<select id="fnameorder">'+opt("auto","Automatique (le NOM en majuscules est ignoré)")+opt("prenom-nom","Listes au format Prénom Nom")+opt("nom-prenom","Listes au format Nom Prénom")+'</select></label><p class="muted small-text">Le bilan chiffré (moyennes et coefficients) reste toujours disponible. Ce réglage n’affiche ou ne masque que la partie appréciations ; les textes déjà écrits sont conservés.</p>',()=>{
  settings().remarques=$("fremarques").checked;settings().nameOrder=input("fnameorder")||"auto";
  save();close();render();toast(remarksOn()?"Appréciations activées.":"Appréciations masquées.");
 },{saveLabel:"Enregistrer"});
}

/* ---------- Épreuves CCF de Terminale ---------- */
/* Une épreuve CCF est une évaluation avec t.ccf = {apsa}. Les saisies de chaque élève sont dans
   t.results[idÉlève].ccf = {v: valeurs saisies, d: degrés choisis, p: points ajustés, rep: répartition, role}.
   La note /20 passe par finalNote : elle remonte dans les bilans comme les autres évaluations. */
const CCFX=window.CCF||{SPECS:{},REPARTITIONS:{},DEG_PTS:[],evaluate:()=>null};
const CCF_DESC=window.CCF_DESC||{};
const isCcf=t=>!!(t&&t.ccf&&CCFX.SPECS[t.ccf.apsa]);
const ccfSpec=t=>CCFX.SPECS[t.ccf.apsa];
const classOfTable=t=>data.classes.find(c=>c.tables.includes(t));
function ccfEval(t,sid,c){c=c||classOfTable(t);const st=c?.students.find(s=>s.id===sid);return CCFX.evaluate(t.ccf.apsa,t.results[sid]?.ccf,st?.sex||"")}
function ccfWrite(sid,fn,later){updateResult(sid,r=>{if(!r.ccf||typeof r.ccf!=="object")r.ccf={};["v","d","p"].forEach(k=>{if(!r.ccf[k]||typeof r.ccf[k]!=="object")r.ccf[k]={}});fn(r.ccf)},later)}
const ptsLabel=n=>n==null?"–":fr(n);
const pointSteps=(a,b)=>{const out=[];for(let x=a;x<=b+1e-9;x+=0.25)out.push(Math.round(x*100)/100);return out};
function ccfDescBlock(t,key,keep,title){
 const list=CCF_DESC[t.ccf.apsa]?.[key];if(!list)return "";
 return '<details class="criteria" data-keep="'+esc(keep)+'"><summary>Repères des degrés'+(title?" · "+esc(title):"")+'</summary>'+list.map((txt,i)=>'<div class="criterion c'+(i+1)+'"><b>'+(i+1)+'</b><span>'+esc(txt)+'</span></div>').join("")+'<p class="criteria-note">Repères issus de la fiche certificative de l’épreuve.</p></details>';
}
function ccfDegreeButtons(sid,k,deg,auto,labels){
 return '<div class="ccf-degrees">'+[1,2,3,4].map(n=>'<button type="button" class="ccf-deg d'+n+(auto&&deg===n?" auto":"")+'" aria-pressed="'+(deg===n)+'" data-action="ccf-deg:'+esc(sid)+':'+k+':'+n+'" aria-label="Degré '+n+'">Degré '+n+(labels?.[n-1]!=null?'<small>'+labels[n-1]+'</small>':"")+'</button>').join("")+'</div>';
}
/* Détail du calcul, écrit comme sur une feuille de jury. */
function ccfCalc(e,sp){
 const out={},f=fr;
 out.afl1=e.afl1pts!=null?(e.afl1.length>1?e.afl1.map(o=>f(o.pts)).join(" + ")+" = ":"")+f(e.afl1pts)+" / 12":"";
 if(e.afl2pts!=null){const pts=e.a2.map(o=>o.pts),m=pts.reduce((a,b)=>a+b,0)/pts.length;out.afl2="Niveau "+e.a2[0].deg+" (choix "+e.rep.replace("-"," - ")+") → "+f(e.afl2pts)+" / "+2*e.R.c2}
 if(e.afl3pts!=null){
  if(sp.afl3.mode==="weighted"){const m=e.a3.reduce((s,o)=>s+o.pts*o.weight,0);out.afl3=e.a3.map(o=>f(o.pts)+" × "+f(o.weight)).join(" + ")+" = "+f(Math.round(m*1000)/1000)+" sur 2 × "+e.R.c3+" = "+f(Math.round(e.afl3pts*100)/100)+" / "+2*e.R.c3}
  else{const r=e.a3.find(o=>o.k===e.role);out.afl3=(sp.afl3.items.length>1?r.label+" : ":"")+"niveau "+r.deg+" (choix "+e.rep.replace("-"," - ")+") → "+f(e.afl3pts)+" / "+2*e.R.c3}
 }
 out.total=e.note!=null?f(e.afl1pts)+" + "+f(Math.round(e.afl2pts*100)/100)+" + "+f(Math.round(e.afl3pts*100)/100)+" = "+f(e.note)+" / 20":"";
 return out;
}
function ccfSummary(t,st){
 const sp=ccfSpec(t),e=ccfEval(t,st.id),k=ccfCalc(e,sp),out=STATUS[(t.results[st.id]||{}).status];
 const box=(title,val,max,calc)=>'<div class="ccf-sum-box"><span>'+title+'</span><strong>'+ptsLabel(val==null?null:Math.round(val*100)/100)+'<small> / '+max+'</small></strong><em>'+esc(calc||"à compléter")+'</em></div>';
 return '<div class="ccf-summary">'+box("AFL1",e.afl1pts,12,k.afl1)+box("AFL2",e.afl2pts,2*e.R.c2,k.afl2)+box("AFL3",e.afl3pts,2*e.R.c3,k.afl3)+'<div class="ccf-sum-box ccf-sum-total"><span>Note</span><strong>'+(out?"–":ptsLabel(e.note))+'<small> / 20</small></strong><em>'+esc(out?out:k.total||"à compléter")+'</em></div></div>';
}
function ccfRepGrid(rep){
 const R=CCFX.REPARTITIONS[rep]||CCFX.REPARTITIONS["4-4"],rows=[[1,"2"],[2,"4"],[3,"6"]];
 return '<table class="ccf-grid"><thead><tr><th>Points</th><th>Degré 1</th><th>Degré 2</th><th>Degré 3</th><th>Degré 4</th><th></th></tr></thead><tbody>'+rows.map(([c,label])=>{const tags=[R.c2===c?"AFL2":"",R.c3===c?"AFL3":""].filter(Boolean);return '<tr class="g'+c+(tags.length?" on":"")+'"><th>/ '+label+'</th>'+CCFX.DEG_PTS.map(x=>'<td>'+fr(x*c)+'</td>').join("")+'<td>'+tags.map(x=>'<span class="tag">'+x+'</span>').join(" ")+'</td></tr>'}).join("")+'</tbody></table>';
}
function ccfLive(t,st){
 const sp=ccfSpec(t),e=ccfEval(t,st.id),sid=st.id,R=e.R;
 let html=e.info.filter(Boolean).length?'<div class="ccf-info">'+e.info.map(x=>'<p>'+esc(x)+'</p>').join("")+'</div>':"";
 const calc=ccfCalc(e,sp);
 html+='<section class="ccf-section"><div class="ccf-section-head"><h3>AFL1 · produire</h3><b>'+ptsLabel(e.afl1pts)+' / 12</b></div>'+(calc.afl1?'<p class="ccf-calc">'+esc(calc.afl1)+'</p>':"");
 let lastGroup="";
 e.afl1.forEach((o,i)=>{
  const c=sp.afl1[i];
  if(c.group&&c.group!==lastGroup){html+='<h4 class="ccf-group">'+esc(c.group)+'</h4>';lastGroup=c.group}
  html+='<div class="ccf-comp"><div class="ccf-comp-head"><span>'+esc(o.label)+' <small class="muted">/ '+fr(o.max)+'</small></span><b class="ccf-pts'+(o.pts==null?" empty":"")+'">'+ptsLabel(o.pts)+'</b></div>';
  if(c.kind==="auto"){html+='<p class="ccf-why">'+esc(o.why||"")+(o.pts!=null?' <span class="tag">calcul automatique</span>':"")+'</p>'}
  else{
   const labels=c.kind==="cells"?(o.cellLabels&&o.cellLabels.some(x=>x!=null)?o.cellLabels.map(x=>x==null?"":fr(x)):null):c.ranges.map(([a,b])=>fr(a)+" à "+fr(b));
   html+=ccfDegreeButtons(sid,c.k,o.deg,o.degAuto,labels);
   if(o.degAuto)html+='<p class="ccf-why"><span class="tag">degré proposé</span> '+esc(o.sugWhy||"")+' — touche un degré pour confirmer ou corriger.</p>';
   else if(o.sugWhy&&o.suggested)html+='<p class="ccf-why muted">Aide : '+esc(o.sugWhy)+' (degré '+o.suggested+' proposé).</p>';
   if(c.kind==="range"&&o.deg){
    html+='<div class="ccf-chips" role="group" aria-label="Points dans le degré">'+pointSteps(o.range[0],o.range[1]).map(x=>'<button type="button" class="ccf-chip" aria-pressed="'+(Math.abs(x-o.pts)<1e-9)+'" data-action="ccf-pts:'+esc(sid)+':'+c.k+':'+x+'">'+fr(x)+(Math.abs(x-o.proposed)<1e-9?'<small>proposé</small>':"")+'</button>').join("")+'</div>';
   }
   if(o.why)html+='<p class="ccf-why muted">'+esc(o.why)+'</p>';
  }
  if(c.desc)html+=ccfDescBlock(t,c.desc,"ccf1:"+c.k);
  html+='</div>';
 });
 html+='</section>';
 const afl=(title,list,pts,coef,items,mode,calcLine)=>{
  let h='<section class="ccf-section"><div class="ccf-section-head"><h3>'+title+' <small class="muted">(choix '+e.rep.replace("-"," - ")+' : sur '+2*coef+')</small></h3><b>'+ptsLabel(pts==null?null:Math.round(pts*100)/100)+' / '+(2*coef)+'</b></div>'+(calcLine?'<p class="ccf-calc">'+esc(calcLine)+'</p>':"");
  list.forEach((o,i)=>{
   const f=coef*(o.weight||1)/(mode==="all"?list.length:1);
   const it=items[i],retained=mode==="choice"&&e.role===o.k&&items.length>1;
   h+='<div class="ccf-comp'+(mode==="choice"&&items.length>1&&!retained?" ccf-dim":"")+'"><div class="ccf-comp-head"><span>'+esc(o.label)+(retained?' <span class="tag">rôle retenu</span>':"")+'</span><b class="ccf-pts'+(o.pts==null?" empty":"")+'">'+(o.pts==null?"–":fr(o.pts*f))+'</b></div>'+ccfDegreeButtons(sid,o.k,o.deg,o.degAuto,CCFX.DEG_PTS.map(x=>fr(Math.round(x*f*100)/100)+" pt"));
   if(o.degAuto)h+='<p class="ccf-why"><span class="tag">degré proposé</span> '+esc(o.why)+' — touche un degré pour confirmer ou corriger.</p>';
   else if(o.why)h+='<p class="ccf-why muted">'+esc(o.why)+(o.suggested?' (degré '+o.suggested+' proposé)':"")+'</p>';
   h+=(it.parts?'<ul class="ccf-parts">'+it.parts.map(p=>'<li>'+esc(p.label)+'</li>').join("")+'</ul>'+it.parts.map(p=>ccfDescBlock(t,p.desc,"ccf:"+p.k,p.label)).join(""):ccfDescBlock(t,it.desc,"ccf:"+o.k))+'</div>';
  });
  return h+'</section>';
 };
 html+=afl("AFL2 · s’entraîner",e.a2,e.afl2pts,R.c2,sp.afl2,"all",calc.afl2);
 html+=afl("AFL3 · rôles",e.a3,e.afl3pts,R.c3,sp.afl3.items,sp.afl3.mode,calc.afl3);
 const r2=x=>ptsLabel(x==null?null:Math.round(x*100)/100);
 html+='<div class="ccf-total"><span>AFL1 '+r2(e.afl1pts)+'/12 · AFL2 '+r2(e.afl2pts)+'/'+2*R.c2+' · AFL3 '+r2(e.afl3pts)+'/'+2*R.c3+'</span><strong>'+(e.note!=null?fr(e.note)+' / 20':'À compléter')+'</strong></div>';
 if(e.note==null&&e.missing.length)html+='<p class="muted small-text ccf-missing">Reste à renseigner : '+e.missing.map(esc).join(" ; ")+'.</p>';
 return html;
}
function patchCcf(){const t=tab(),st=cls()?.students.find(s=>s.id===observationStudentId),box=$("ccf-live"),sum=$("ccf-summary");if(sum&&t&&st&&isCcf(t))sum.innerHTML=ccfSummary(t,st);if(box&&t&&st&&isCcf(t)){const open=[...box.querySelectorAll("details[data-keep][open]")].map(d=>d.dataset.keep);box.innerHTML=ccfLive(t,st);box.querySelectorAll("details[data-keep]").forEach(d=>{if(open.includes(d.dataset.keep))d.open=true})}}
function ccfPreview(f,value){if(!String(value??"").trim())return "&nbsp;";const x=CCFX.parseTime(value,f.long);return x==null?'<span class="ccf-bad">temps non reconnu</span>':"= "+esc(CCFX.fmtTime(x))}
function ccfField(sid,f,value){
 const common='data-ccf-field="'+esc(f.k)+'" data-ccf-student="'+esc(sid)+'" aria-label="'+esc(f.label)+'"';
 if(f.type==="select")return '<label class="field">'+esc(f.label)+'<select '+common+'>'+f.opts.map(([k,l])=>'<option value="'+esc(k)+'"'+(String(value||"")===k?" selected":"")+'>'+esc(l)+'</option>').join("")+'</select></label>';
 const prev=f.type==="time"?'<small class="ccf-preview" data-ccf-preview="'+esc(f.k)+'">'+ccfPreview(f,value)+'</small>':"";
 return '<label class="field">'+esc(f.label)+'<input class="input" '+common+' value="'+esc(value??"")+'" placeholder="'+esc(f.ph||"")+'" inputmode="decimal" enterkeyhint="next" autocomplete="off">'+prev+'</label>';
}
/* Nom et prénom séparés pour la plateforme : même règle que pour les appréciations (NOM en majuscules, ou réglage admin). */
function splitName(s){
 const parts=String(s.name||"").trim().split(/\s+/).filter(Boolean),first=firstName(s);
 if(parts.length<2)return {nom:parts[0]||"",prenom:""};
 const fp=first.split(/\s+/);let i=-1;
 for(let k=0;k+fp.length<=parts.length;k++)if(parts.slice(k,k+fp.length).join(" ")===first){i=k;break}
 return i<0?{nom:parts.slice(1).join(" "),prenom:parts[0]}:{nom:[...parts.slice(0,i),...parts.slice(i+fp.length)].join(" "),prenom:first};
}
function ccfPlatformRows(t,c){
 const r2=x=>x==null?"":fr(Math.round(x*100)/100);
 return [...c.students].sort(byName).map(s=>{const r=t.results[s.id]||{},e=ccfEval(t,s.id,c),out=STATUS[r.status],n=splitName(s);
  return {s,e,r,nom:n.nom,prenom:n.prenom,out,saisi:!!r.ccf?.saisi,afl1:out?"":r2(e.afl1pts),choix:e.rep,choixAuto:e.repAuto,afl2:out?"":r2(e.afl2pts),afl2max:2*e.R.c2,afl3:out?"":r2(e.afl3pts),afl3max:2*e.R.c3,note:out?"":r2(e.note),complete:!out&&e.note!=null}});
}
/* Fiche plateforme d'un élève : un seul élève ouvert à la fois (details name), notes dans l'ordre de saisie. */
function ccfPlatformDetail(t,x){
 if(x.out)return '<div class="pf-body"><p class="pf-out">'+esc(x.out)+' : pas de note pour cette épreuve.</p></div>';
 const box=(cls,label,val,max)=>'<div class="pf-box '+cls+'"><span>'+label+'</span><strong>'+val+(max?'<small> / '+max+'</small>':"")+'</strong></div>';
 return '<div class="pf-body"><div class="pf-row pf-row-top">'+box("pf-c-name","Nom Prénom",'<b class="pf-big-name">'+esc(x.nom)+'</b> '+esc(x.prenom),"")+box("pf-c-choice","Choix AFL2 - AFL3",x.choix.replace("-"," - ")+(x.choixAuto?'<small> (par défaut)</small>':""),"")+'</div>'+
  '<div class="pf-row pf-row-afl">'+box("pf-c-afl1","AFL1 =",x.afl1||"–",12)+box("pf-c-afl2","AFL2 =",x.afl2||"–",x.afl2max)+box("pf-c-afl3","AFL3 =",x.afl3||"–",x.afl3max)+'</div>'+
  (!x.complete?'<p class="pf-missing">À compléter : '+x.e.missing.map(esc).join(" ; ")+'.</p>':"")+'</div>';
}
function ccfPlatformItem(t,x,exported){
 const state=x.out?'<span class="pf-tag out">'+esc(x.out)+'</span>':x.complete?'<span class="pf-note">'+x.note+'<small> / 20</small></span>':'<span class="pf-tag todo">À compléter</span>';
 const check=exported?'<label class="pf-check"><input type="checkbox" data-saisi="'+esc(x.s.id)+'"> Saisi sur la plateforme</label>':'<button type="button" class="btn small'+(x.saisi?" primary":"")+'" data-action="ccf-saisi:'+esc(x.s.id)+'">'+(x.saisi?"✓ Saisi sur la plateforme":"Marquer comme saisi sur la plateforme")+'</button>'+btn("Ouvrir la fiche","ccf-open:"+x.s.id,"small quiet");
 return '<details class="pf-item'+(x.saisi?" done":"")+'" name="pf-eleves" data-keep="pf:'+esc(x.s.id)+'" data-id="'+esc(x.s.id)+'"><summary><span class="pf-mark">✓</span><span class="pf-name"><b>'+esc(x.nom)+'</b> '+esc(x.prenom)+'</span>'+state+'</summary>'+ccfPlatformDetail(t,x)+'<div class="pf-actions">'+check+'</div></details>';
}
const PF_CSS2='.pf-row{display:grid;gap:10px}.pf-row+.pf-row{margin-top:10px}.pf-row-top{grid-template-columns:2fr 1fr}.pf-row-afl{grid-template-columns:repeat(3,minmax(0,1fr))}.pf-box{border-width:3px}.pf-box strong{font-size:34px}.pf-big-name{font-weight:800;letter-spacing:.02em}.pf-c-name{background:#e4eef8;border-color:#1c5fa6}.pf-c-name span{color:#134680}.pf-c-name strong{font-size:28px;font-weight:500}.pf-c-choice{background:#efe7f7;border-color:#7647a4}.pf-c-choice span{color:#5f3786}.pf-c-afl1{background:#fcebdf;border-color:#b8521f}.pf-c-afl1 span{color:#96421a}.pf-c-afl2{background:#e1f2ed;border-color:#0e7a63}.pf-c-afl2 span{color:#0a5e4c}.pf-c-afl3{background:#fff6d1;border-color:#b99400}.pf-c-afl3 span{color:#6b5300}@media(max-width:700px){.pf-row-top{grid-template-columns:1fr}.pf-row-afl{grid-template-columns:1fr 1fr 1fr}.pf-box strong{font-size:26px}}';
const PF_CSS='.pf-list{display:grid;gap:8px}.pf-item{background:#fff;border-radius:10px;box-shadow:0 2px 4px #1b2c400f,0 6px 16px #1b2c4014;overflow:hidden}.pf-item>summary{display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;list-style:none;min-height:56px;font-size:18px}.pf-item>summary::-webkit-details-marker{display:none}.pf-item[open]>summary{background:#1b2c40;color:#fff}.pf-name{flex:1}.pf-name b{letter-spacing:.02em}.pf-mark{display:grid;place-items:center;width:26px;height:26px;border-radius:50%;border:2px solid #aab7c6;color:transparent;font-weight:700;flex:0 0 auto}.pf-item.done .pf-mark{background:#0e7a63;border-color:#0e7a63;color:#fff}.pf-item.done:not([open])>summary{opacity:.6}.pf-note{font-weight:700;font-size:20px}.pf-note small{font-size:14px;opacity:.7}.pf-tag{padding:3px 10px;border-radius:6px;font-size:14px;font-weight:600}.pf-tag.todo{background:#fff6d1;color:#6b5300}.pf-tag.out{background:#e3e8ee;color:#46586d}.pf-body{padding:16px}.pf-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px}.pf-box{border:2px solid #e0ded6;border-radius:10px;padding:10px 12px;display:flex;flex-direction:column;gap:4px}.pf-box span{font-size:13px;font-weight:700;color:#46586d;text-transform:uppercase;letter-spacing:.03em}.pf-box strong{font-size:30px;line-height:1.1}.pf-box strong small{font-size:15px;color:#46586d;font-weight:600}.pf-total{background:#1b2c40;border-color:#1b2c40;color:#fff}.pf-total span,.pf-total strong small{color:#c9d4df}.pf-missing{margin:10px 0 0;padding:8px 12px;background:#fff6d1;border-radius:8px;color:#6b5300}.pf-out{margin:0;font-weight:600}.pf-detail{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px 20px;margin-top:14px;font-size:15px}.pf-detail h4{margin:0 0 4px;font-size:15px;color:#5f3786}.pf-detail p{margin:0 0 10px}.pf-detail ul{margin:0 0 10px;padding-left:18px}.pf-detail li{margin-bottom:4px}.pf-detail small{color:#46586d}.pf-actions{display:flex;gap:8px;flex-wrap:wrap;padding:0 16px 16px}.pf-check{display:flex;align-items:center;gap:10px;font-weight:600;font-size:17px;padding:8px 12px;border:2px solid #0e7a63;border-radius:10px;color:#0a5e4c}.pf-check input{width:24px;height:24px;accent-color:#0e7a63}@media(max-width:700px){.pf-grid{grid-template-columns:1fr 1fr}.pf-total{grid-column:1/-1}}'+PF_CSS2;
function exportCcfHtml(){
 const c=cls(),t=tab(),sp=ccfSpec(t),plat=ccfPlatformRows(t,c),done=plat.filter(x=>x.complete).length;
 const key="pf-"+c.id+"-"+t.id;
 const html='<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+esc(t.name)+' · '+esc(c.name)+'</title><style>*{box-sizing:border-box}body{margin:0;background:#f6f4ee;color:#14263d;font:17px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1000px;margin:auto;padding:16px 14px 60px}header{background:#1b2c40;color:#fff;border-radius:14px;padding:20px 22px;margin-bottom:14px;border-bottom:6px solid #b8521f}header h1{margin:0 0 4px;font-size:28px}header p{margin:0;color:#d5dfe9}.hint{color:#46586d;font-size:15px;margin:0 0 12px}'+PF_CSS+'@media print{.pf-item{break-inside:avoid}.pf-actions{display:none}}</style></head><body><main><header><h1>'+esc(t.name)+'</h1><p>'+esc(c.name)+' · '+esc(sp.name)+' · '+esc(data.year)+' · '+done+'/'+plat.length+' élèves notés · exporté le '+esc(new Date().toLocaleDateString("fr-FR"))+'</p></header><p class="hint">Touche un élève : nom et prénom, choix AFL2 - AFL3, puis AFL1, AFL2 et AFL3. Un seul élève reste ouvert à la fois.</p><div class="pf-list">'+plat.map(x=>ccfPlatformItem(t,x,true)).join("")+'</div><p class="hint" style="margin-top:16px">Document contenant des données d’élèves : à conserver dans un espace privé.</p></main><script>(function(){var K='+JSON.stringify(key)+',all=function(s){return Array.prototype.slice.call(document.querySelectorAll(s))},saved={};try{saved=JSON.parse(localStorage.getItem(K)||"{}")}catch(e){}all(".pf-item").forEach(function(d){d.addEventListener("toggle",function(){if(d.open){all(".pf-item").forEach(function(o){if(o!==d)o.open=false});setTimeout(function(){d.scrollIntoView({block:"nearest",behavior:"smooth"})},30)}})});all("[data-saisi]").forEach(function(c){var id=c.getAttribute("data-saisi");c.checked=!!saved[id];c.closest(".pf-item").classList.toggle("done",c.checked);c.addEventListener("change",function(){saved[id]=c.checked;c.closest(".pf-item").classList.toggle("done",c.checked);try{localStorage.setItem(K,JSON.stringify(saved))}catch(e){}})})})()<\/script></body></html>';
 exportFile("plateforme-"+safeName(c.name)+"-"+safeName(t.name)+"-"+today()+".html",html,"text/html;charset=utf-8");
}
function exportCcfPlatform(){
 const c=cls(),t=tab(),rows=[["Nom","Prénom","AFL1 /12","Choix AFL2 - AFL3","AFL2 sur","AFL3 sur","AFL2","AFL3","Total /20","Remarque"]];
 ccfPlatformRows(t,c).forEach(x=>rows.push([x.nom,x.prenom,x.afl1,x.choix.replace("-"," - "),x.afl2max,x.afl3max,x.afl2,x.afl3,x.note,x.out||(x.complete?"":"À compléter")]));
 exportFile("plateforme-"+safeName(c.name)+"-"+safeName(t.name)+"-"+today()+".csv","\uFEFF"+rows.map(r=>r.map(csvCell).join(";")).join("\r\n"),"text/csv;charset=utf-8");
}
const ccfPages={
"ccf"(){
 const c=cls(),t=tab(),sp=ccfSpec(t),students=[...c.students].sort(byName);
 if(!students.length)return evalHead()+noStudents();
 let done=0;
 const rows=students.map(s=>{const r=t.results[s.id]||{},e=ccfEval(t,s.id,c);if(e.note!=null||STATUS[r.status])done++;
  const state=STATUS[r.status]?'<span class="state '+r.status+'">'+STATUS[r.status]+'</span>':e.note!=null?'<span class="state done">'+fr(e.note)+' / 20</span>':hasObservation(t,s.id)?'<span class="state">En cours</span>':'<span class="state">À évaluer</span>';
  const r2=x=>x==null?"–":fr(Math.round(x*100)/100),parts=STATUS[r.status]?"":'<span class="ccf-row-parts">AFL1 '+r2(e.afl1pts)+'/12 · AFL2 '+r2(e.afl2pts)+'/'+2*e.R.c2+' · AFL3 '+r2(e.afl3pts)+'/'+2*e.R.c3+'</span>';
  return '<button type="button" class="obs-row" data-action="ccf-open:'+esc(s.id)+'"><span>'+face(s,"sm")+esc(s.name)+sexTag(s)+parts+'</span>'+state+'</button>'}).join("");
 return evalHead()+'<p class="muted ccf-epreuve">'+esc(sp.epreuve)+'</p><div class="progress"><span>'+done+' sur '+students.length+'</span><div class="progress-bar"><span style="width:'+Math.round(done/students.length*100)+'%"></span></div></div><div class="obs-list">'+rows+'</div>';
},
"ccf-student"(){
 const c=cls(),t=tab(),sp=ccfSpec(t),st=c.students.find(x=>x.id===observationStudentId);
 if(!st){view.page="ccf";return ccfPages.ccf()}
 const order=[...c.students].sort(byName),i=order.findIndex(s=>s.id===st.id),prev=order[i-1],next=order[i+1];
 const r=t.results[st.id]||{},cc=r.ccf||{},v=cc.v||{},e=ccfEval(t,st.id,c);
 const seg=(label,items,cur,act)=>'<div class="ccf-choice"><span class="ccf-choice-label">'+label+'</span><div class="seg">'+items.map(([k,l])=>'<button type="button" aria-pressed="'+(cur===k)+'" data-action="'+act+':'+esc(st.id)+':'+k+'">'+l+'</button>').join("")+'</div></div>';
 let html=evalHead()+'<div class="row" style="margin-bottom:10px">'+btn("← Liste des élèves","ccf-back","quiet small")+'</div>'+
 '<div class="sheet-nav">'+(prev?btn("‹ <span>"+esc(prev.name)+"</span>","ccf-open:"+prev.id):'<span></span>')+'<div><h2>'+face(st,"lg")+esc(st.name)+'</h2><span class="muted small-text">'+(i+1)+' sur '+order.length+'</span></div>'+(next?btn("<span>"+esc(next.name)+"</span> ›","ccf-open:"+next.id,"primary"):'<span></span>')+'</div>';
 html+='<div id="ccf-summary">'+ccfSummary(t,st)+'</div>';
 html+='<section class="sheet ccf-choices">'+seg("Présence",[["","Présent"],["absent","Absent"],["dispense","Dispensé"]],r.status||"","set-status")+
  (sp.sex?seg("Barème",[["F","Fille"],["M","Garçon"]],st.sex||"","ccf-sex"):"")+
  seg("Points AFL2 - AFL3 choisis par l’élève"+(cc.rep?"":' <span class="tag">4 - 4 par défaut</span>'),Object.entries(CCFX.REPARTITIONS).map(([k,o])=>[k,'<b>'+o.label+'</b><small class="seg-sub">'+o.long+'</small>']),cc.rep||"","ccf-rep")+ccfRepGrid(cc.rep)+
  (sp.afl3.mode==="choice"&&sp.afl3.items.length>1?seg("Rôle évalué (AFL3)"+(cc.role?"":' <span class="tag">meilleur rôle noté</span>'),sp.afl3.items.map(x=>[x.k,x.label]),cc.role||"","ccf-role"):"")+'</section>';
 if(STATUS[r.status])html+='<div class="notice"><p>'+esc(st.name)+' est noté'+(st.sex==="F"?"e":"")+' « '+STATUS[r.status].toLowerCase()+' » : aucune note n’est calculée pour cette épreuve.</p></div>';
 if(sp.fields.length)html+='<section class="sheet ccf-inputs"><h3>Saisies du jour</h3>'+sp.fields.map(g=>'<fieldset class="ccf-fieldset"><legend>'+esc(g.group)+'</legend><div class="ccf-fields">'+g.items.map(f=>ccfField(st.id,f,v[f.k])).join("")+'</div></fieldset>').join("")+'<p class="muted small-text">'+(sp.fields.some(g=>g.items.some(f=>f.type==="time"))?"Tape les temps sans apostrophe : 45 = 0’45, 120 = 1’20, 310 = 3’10 (52,5 pour 52 s 5). Le temps reconnu s’affiche sous chaque case. ":"")+'Le calcul se met à jour pendant la saisie.</p></section>';
 html+='<div id="ccf-live">'+ccfLive(t,st)+'</div>';
 html+='<section class="sheet"><label class="field">Observation<textarea class="obs-text" data-observation-student="'+esc(st.id)+'" placeholder="Remarques du jury…">'+esc(r.comment||"")+'</textarea></label></section>';
 return html;
},
"ccf-table"(){
 const c=cls(),t=tab(),sp=ccfSpec(t),students=[...c.students].sort(byName);
 const evals=students.map(s=>({s,r:t.results[s.id]||{},e:ccfEval(t,s.id,c)})),notes=evals.map(x=>STATUS[x.r.status]?null:x.e.note).filter(n=>n!=null);
 const mean=notes.length?fr(Math.round(notes.reduce((a,b)=>a+b,0)/notes.length*100)/100):"–";
 const plat=ccfPlatformRows(t,c),missing=plat.filter(x=>!x.complete&&!x.out).length;
 return evalHead()+'<div class="page-head"><div><h2>Bilan pour la plateforme</h2><p class="muted small-text">Touche un élève : ses notes s’affichent dans l’ordre de la plateforme. Coche « Saisi sur la plateforme » au fur et à mesure.'+(missing?' '+plural(missing,"élève")+' à compléter.':"")+'</p></div><div class="row">'+btn("Exporter en HTML","ccf-platform-html","primary")+btn("CSV plateforme","ccf-platform")+btn("CSV détaillé","ccf-csv")+'</div></div>'+
 (students.length?'<div class="pf-list">'+plat.map(x=>ccfPlatformItem(t,x,false)).join("")+'</div>':"")+
 '<div class="section-head"><h2>Détail de l’épreuve</h2></div><div class="stats"><div><strong>'+notes.length+'/'+students.length+'</strong>élèves notés</div><div><strong>'+mean+'</strong>moyenne</div><div><strong>'+(notes.length?fr(Math.min(...notes))+" à "+fr(Math.max(...notes)):"–")+'</strong>note min. à max.</div></div>'+
 (students.length?'<div class="tablewrap ccf-table"><table><thead><tr><th>Élève</th>'+sp.afl1.map(o=>'<th>'+esc(o.label)+' <small>/'+fr(o.max)+'</small></th>').join("")+'<th>AFL1 /12</th><th>Choix AFL2 - AFL3</th><th>AFL2</th><th>AFL3</th><th>Note /20</th></tr></thead><tbody>'+evals.map(({s,r,e})=>{
  const out=STATUS[r.status];
  return '<tr><td><button type="button" class="linkish" data-action="ccf-open:'+esc(s.id)+'">'+esc(s.name)+'</button>'+(out?' <span class="state '+r.status+'">'+out+'</span>':"")+'</td>'+e.afl1.map(o=>'<td>'+ptsLabel(o.pts)+'</td>').join("")+'<td><b>'+ptsLabel(e.afl1pts)+'</b></td><td>'+e.rep.replace("-"," - ")+'</td><td>'+ptsLabel(e.afl2pts==null?null:Math.round(e.afl2pts*100)/100)+' <small>/'+2*e.R.c2+'</small></td><td>'+ptsLabel(e.afl3pts==null?null:Math.round(e.afl3pts*100)/100)+' <small>/'+2*e.R.c3+'</small>'+(e.role&&sp.afl3.items.length>1?' <small>'+esc(sp.afl3.items.find(x=>x.k===e.role)?.label||"")+'</small>':"")+'</td><td><b>'+(out?"–":ptsLabel(e.note))+'</b></td></tr>'}).join("")+'</tbody></table></div>':noStudents());
},
"ccf-bareme"(){
 const t=tab(),sp=ccfSpec(t),D=CCF_DESC[t.ccf.apsa]||{};
 const descTable=key=>D[key]?'<div class="ccf-desc-grid">'+D[key].map((x,i)=>'<div class="criterion c'+(i+1)+'"><b>'+(i+1)+'</b><span>'+esc(x)+'</span></div>').join("")+'</div>':"";
 const how=c=>c.kind==="auto"?"Calculé automatiquement à partir des saisies du jour.":c.kind==="cells"?"Le jury choisit le degré ; la case du barème dépend des saisies du jour : "+c.cells.map((row,i)=>"degré "+(i+1)+" : "+row.map(fr).join(" / ")).join(" ; ")+".":"Le jury choisit le degré puis la note dans l’empan : "+c.ranges.map(([a,b],i)=>"degré "+(i+1)+" : "+fr(a)+" à "+fr(b)).join(" ; ")+".";
 return evalHead()+'<section class="sheet"><h2>'+esc(sp.name)+' · '+esc(sp.ca)+'</h2><p>'+esc(sp.epreuve)+'</p><p class="muted small-text">AFL1 sur 12 points. AFL2 et AFL3 sur 8 points, répartis au choix de l’élève : 4/4, 6/2 ou 2/6 (un seul niveau par AFL, sans intermédiaire : sur 2 = 0,5 / 1 / 1,5 / 2 ; sur 4 = 1 / 2 / 3 / 4 ; sur 6 = 1,5 / 3 / 4,5 / 6).</p></section>'+
 '<div class="section-head"><h2>AFL1</h2></div>'+sp.afl1.map(c=>'<section class="sheet ccf-bareme"><h3>'+esc(c.label)+' <small class="muted">/ '+fr(c.max)+'</small></h3><p class="muted small-text">'+esc(how(c))+'</p>'+(c.desc?descTable(c.desc):"")+'</section>').join("")+
 '<div class="section-head"><h2>AFL2 · un seul niveau</h2></div>'+sp.afl2.map(c=>c.parts?c.parts.map(p=>'<section class="sheet ccf-bareme"><h3>'+esc(p.label)+'</h3>'+descTable(p.desc)+'</section>').join(""):'<section class="sheet ccf-bareme"><h3>'+esc(c.label)+'</h3>'+descTable(c.desc)+'</section>').join("")+
 '<div class="section-head"><h2>AFL3</h2></div>'+sp.afl3.items.map(c=>'<section class="sheet ccf-bareme"><h3>'+esc(c.label)+'</h3>'+descTable(c.desc)+'</section>').join("");
}
};
function exportCcfCsv(){
 const c=cls(),t=tab(),sp=ccfSpec(t),fields=sp.fields.flatMap(g=>g.items);
 const rows=[["Élève","Statut",...(sp.sex?["Sexe"]:[]),...fields.map(f=>f.label),...sp.afl1.map(o=>o.label+" /"+fr(o.max)),"AFL1 /12","Choix AFL2 - AFL3","AFL2","AFL2 sur","Rôle AFL3","AFL3","AFL3 sur","Note /20","Observation"]];
 [...c.students].sort(byName).forEach(s=>{const r=t.results[s.id]||{},e=ccfEval(t,s.id,c),v=r.ccf?.v||{};
  rows.push([s.name,STATUS[r.status]||"",...(sp.sex?[s.sex==="F"?"Fille":s.sex==="M"?"Garçon":""]:[]),...fields.map(f=>f.type==="select"?(f.opts.find(o=>o[0]===v[f.k])?.[1]||""):v[f.k]||""),...e.afl1.map(o=>o.pts==null?"":fr(o.pts)),e.afl1pts==null?"":fr(e.afl1pts),e.rep.replace("-"," - "),e.afl2pts==null?"":fr(Math.round(e.afl2pts*100)/100),2*e.R.c2,sp.afl3.items.find(x=>x.k===e.role)?.label||"",e.afl3pts==null?"":fr(Math.round(e.afl3pts*100)/100),2*e.R.c3,STATUS[r.status]||e.note==null?"":fr(e.note),r.comment||""])});
 exportFile("ccf-"+safeName(c.name)+"-"+safeName(t.name)+"-"+today()+".csv","﻿"+rows.map(r=>r.map(csvCell).join(";")).join("\r\n"),"text/csv;charset=utf-8");
}
function newCcfForm(){
 const c=cls(),groups={};Object.entries(CCFX.SPECS).forEach(([k,s])=>{(groups[s.ca]=groups[s.ca]||[]).push([k,s.name])});
 modal("Nouvelle épreuve CCF (Terminale)",'<label class="field">Activité<select id="fccf">'+Object.entries(groups).map(([ca,list])=>'<optgroup label="'+esc(ca)+'">'+list.map(([k,n])=>'<option value="'+esc(k)+'">'+esc(n)+'</option>').join("")+'</optgroup>').join("")+'</select></label>'+field("Nom de l’épreuve (facultatif)","fname","","text",'placeholder="CCF Demi-fond"')+trimesterOptions(currentTrimester())+'<p class="muted small-text">Barèmes repris des fiches certificatives du lycée. La note /20 remonte dans le bilan du trimestre choisi.</p>',()=>{
  const apsa=input("fccf"),sp=CCFX.SPECS[apsa];if(!sp)return;
  const t={id:uid(),name:input("fname")||"CCF "+sp.name.replace(/ \(.*\)$/,""),trimester:input("ftrimester"),folderId:null,observables:[],results:{},groups:[],ccf:{apsa}};
  c.tables.push(t);save();close();terrainSelection.clear();view.tableId=t.id;data.lastOpened={classId:c.id,tableId:t.id};go("ccf");
 },{saveLabel:"Créer"});
}
Object.assign(pages,ccfPages);

/* ---------- Catalogue APSA et critères ---------- */
/* Catalogue pédagogique : exemples modifiables, pas des citations de textes officiels. */
const APSA_CATALOG={"Demi-fond":["Réguler son allure de course","Construire et respecter un projet de performance","Analyser ses temps et ajuster son effort","Tenir le rôle de chronométreur ou d’observateur"],"Escalade":["Choisir une voie adaptée à ses ressources","Utiliser ses appuis et placements pour progresser","Gérer sa sécurité et celle de son partenaire","Assurer et communiquer avec son partenaire"],"Natation":["Coordonner respiration et propulsion","Adapter son allure à la distance","Optimiser départ, virages et coulées","Observer et conseiller un partenaire"],"Volley-ball":["Se rendre disponible pour recevoir","Assurer la continuité du jeu","Construire une attaque pertinente","Communiquer avec ses partenaires"],"Badminton":["Varier trajectoires et zones visées","Se replacer après la frappe","Construire et conclure le point","Arbitrer une rencontre"],"Tennis de table":["Maintenir un échange régulier","Varier placements et trajectoires","Se placer et se replacer","Construire le point et arbitrer"],"Football":["Conserver et faire progresser le ballon","Se démarquer et proposer une solution","Défendre et récupérer le ballon","Coopérer dans un projet de jeu"],"Basket-ball":["Progresser collectivement vers le panier","Se démarquer pour recevoir","Choisir un tir favorable","Se replacer et défendre"],"Handball":["Faire progresser collectivement le ballon","Se démarquer et créer un espace","Tirer en position favorable","Se replacer en défense"],"Ultimate":["Se démarquer pour recevoir le disque","Faire progresser le disque par la passe","Défendre sans contact","Respecter l’esprit du jeu et l’auto-arbitrage"],"Pickleball":["Assurer la continuité de l’échange","Varier direction et profondeur des frappes","Se placer efficacement en double","Communiquer avec son partenaire"],"Danse":["Mobiliser le corps de façon expressive","Organiser une phrase chorégraphique","Varier espace, temps et énergie","Interpréter une composition collective"],"Musculation":["Réaliser les exercices en sécurité","Adapter charge et répétitions à un objectif","Contrôler posture et amplitude","Suivre et analyser ses progrès"],"Gymnastique":["Réaliser des éléments maîtrisés","Enchaîner les actions avec fluidité","Contrôler équilibre et réception","Observer et sécuriser un partenaire"],"Course d’orientation":["Lire la carte et choisir un itinéraire","Se repérer sur le terrain","Adapter sa progression","Respecter les consignes de sécurité"],"Sprint / relais":["Accélérer puis maintenir sa vitesse","Optimiser la transmission du témoin","Respecter les zones de transmission","Coopérer dans un projet de relais"]};
/* Les fiches ressources sont dans assets/referentiel.js. Ce catalogue ne sert qu'aux activités qu'elles ne couvrent pas. */
const REF=window.EPS_REFERENTIEL||{};
const CP_LABELS={1:"CP1 · Performance mesurée",2:"CP2 · Milieux variés",3:"CP3 · Prestation artistique ou acrobatique",4:"CP4 · Affrontement",5:"CP5 · Développement de soi"};
const OTHER_APSA={N1:["Musculation","Ultimate","Pickleball"],N2:["Musculation","Ultimate","Pickleball"],N3:["Ultimate","Pickleball"],N4:["Ultimate","Pickleball"]};
const OFFICIAL_DEGREES=["Ne réalise pas encore cet attendu, même accompagné.","Réalise cet attendu avec aide ou de façon irrégulière.","Réalise cet attendu seul et de façon régulière.","Réalise cet attendu avec aisance et sait l’adapter à de nouvelles situations."];
let lastCatalogLevel=null;
function apsaKey(x){return String(x||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9 ]/g," ").replace(/ +/g," ").trim()}
function apsaChoice(level,name,fallback){
 const keys=[...Object.keys(REF[level]||{}),...(OTHER_APSA[level]||[])],match=v=>{const k=apsaKey(v);return k&&keys.find(x=>{const y=apsaKey(x);return k===y||k.includes(y)||(y.includes(k)&&k.length>3)})};
 return match(name)||match(fallback)||keys[0];
}
function apsaSelectOptions(level,chosen){
 const ref=REF[level]||{},option=k=>'<option value="'+esc(k)+'"'+(k===chosen?" selected":"")+'>'+esc(k)+'</option>';
 return Object.entries(CP_LABELS).map(([cp,label])=>{const items=Object.keys(ref).filter(k=>ref[k].cp===Number(cp));return items.length?'<optgroup label="'+esc(label)+'">'+items.map(option).join("")+'</optgroup>':""}).join("")+'<optgroup label="Hors fiches ressources">'+(OTHER_APSA[level]||[]).map(option).join("")+'</optgroup>';
}
const catalogItems=(level,apsa)=>{const f=REF[level]?.[apsa];return f?[...f.p,...f.r]:APSA_CATALOG[apsa]||[]};
function apsaOptions(level,apsa){
 const f=REF[level]?.[apsa],check=(name,i)=>'<label class="check"><input type="checkbox" class="apsa-check" value="'+i+'"><span>'+esc(name)+'</span></label>';
 if(!f)return '<p class="muted small-text">Activité absente des fiches ressources : compétences proposées par le classeur, avec les mêmes critères pour chaque niveau.</p><div class="apsa-options">'+(APSA_CATALOG[apsa]||[]).map(check).join("")+'</div>';
 return (f.a?'<details class="attendue" data-keep="attendue" open><summary>Compétence attendue</summary><p>'+esc(f.a)+'</p></details>':"")+'<div class="apsa-options"><h3>Pratiquant</h3>'+f.p.map(check).join("")+(f.r.length?'<h3>Autres rôles et aide aux apprentissages</h3>'+f.r.map((n,i)=>check(n,f.p.length+i)).join(""):"")+'</div><p class="criteria-note">Capacités issues des fiches ressources Éduscol.</p>';
}

/* Niveau du référentiel (N1 à N4) à ne pas confondre avec le degré de maîtrise évalué (1 à 4). */
function isCollegeClass(){return /^(?:6|5|4|3)(?![0-9])/i.test(String(cls()?.name||"").trim())}
function referenceLevels(){return isCollegeClass()?["N1","N2"]:["N3","N4"]}
function referenceLevelLabel(level){return level+" "+(["N1","N2"].includes(level)?"collège":"lycée")}
function referenceSelect(selected,id){
 const levels=referenceLevels(),choice=levels.includes(selected)?selected:levels[0];
 return '<label class="field">Niveau de compétence (ancien référentiel EPS)<select id="'+id+'">'+levels.map(l=>'<option value="'+l+'"'+(choice===l?" selected":"")+'>'+referenceLevelLabel(l)+'</option>').join("")+'</select></label>';
}
function resolvedReference(o){const levels=referenceLevels();return levels.includes(o?.refLevel)?o.refLevel:levels[0]}
function openApsaCatalog(){
 const t=tab();if(!t)return;
 const levels=referenceLevels(),level=levels.includes(lastCatalogLevel)?lastCatalogLevel:levels[0],apsa=apsaChoice(level,t.name,t.observables[0]?.apsa);
 modal("Catalogue de compétences",referenceSelect(level,"apsa-ref-level")+'<label class="field">APSA<select id="apsa-select">'+apsaSelectOptions(level,apsa)+'</select></label><label class="field">Évaluation<select id="apsa-scope"><option value="individual">Par élève</option><option value="collective">Par groupe</option></select></label><div id="apsa-list">'+apsaOptions(level,apsa)+'</div>',()=>{
  const key=input("apsa-select"),refLevel=input("apsa-ref-level"),official=!!REF[refLevel]?.[key],names=catalogItems(refLevel,key),picked=[...document.querySelectorAll(".apsa-check:checked")];
  if(!picked.length){toast("Sélectionne au moins une compétence.");return}
  const scope=input("apsa-scope")==="collective"?"collective":"individual";let added=0;
  picked.forEach(check=>{const name=names[Number(check.value)];if(!name||t.observables.some(o=>apsaKey(o.name)===apsaKey(name)&&observableScope(o)===scope))return;
   const descriptors=official?OFFICIAL_DEGREES.map((v,i)=>"Degré "+(i+1)+" — "+v):expectedDescriptors(name,key,refLevel);
   t.observables.push({id:uid(),name,scope,descriptors,apsa:key,refLevel,...(official?{source:"fiche"}:{})});added++});
  if(!added){toast("Ces compétences sont déjà dans l’évaluation.");return}
  lastCatalogLevel=refLevel;save();close();render();toast(plural(added,"compétence")+" "+(added>1?"ajoutées":"ajoutée")+".");
 },{saveLabel:"Ajouter"});
}
/* Interprétations opérationnelles, modifiables ; aucune citation officielle. */
function specificAction(name,apsa){
 const n=apsaKey(name),a=apsaKey(apsa);
 if(n.includes("chor")||a.includes("danse"))return ["Réalise des gestes isolés peu lisibles et n'assume pas son intention.","Enchaîne quelques actions expressives avec des ruptures ou hésitations.","Compose et interprète une séquence cohérente en variant espace, rythme et énergie.","Affirme une intention artistique lisible et ajuste finement ses choix au collectif."];
 if(n.includes("demarquer"))return ["Reste derrière son défenseur, se déplace tardivement et ne propose pas de réception exploitable.","Cherche un espace libre, mais ses appels restent tardifs ou peu visibles pour le porteur.","Se rend disponible à distance de passe, change de direction et offre une solution claire au bon moment.","Anticipe les déplacements, alterne appels et changements de rythme pour créer régulièrement un espace favorable."];
 if(n.includes("transmission"))return ["Transmet à l'arrêt ou hors zone, sans repère avec son partenaire.","Transmet dans la zone avec une perte de vitesse nette, sur signal parfois tardif.","Transmet en vitesse dans la zone grâce à des repères de départ et un signal clairs.","Ajuste ses repères au partenaire et conserve la vitesse du témoin tout au long de la transmission."];
 if(n.includes("progresser le disque"))return ["Tente des passes risquées ou imprécises, sans prendre en compte ses partenaires.","Réalise quelques passes courtes valides, mais lit difficilement l'opposition et les déplacements.","Fait progresser le disque par des passes adaptées, sûres et opportunes vers un partenaire démarqué.","Enchaîne rapidement les passes pertinentes et oriente le jeu pour déséquilibrer la défense."];
 if(n.includes("defendre sans contact"))return ["Perd son adversaire ou commet des contacts ; ne gêne pas la progression du disque.","Suit son adversaire de manière irrégulière et gêne ponctuellement les passes sans contact.","Se place entre adversaire et espace favorable, suit les déplacements et défend sans contact.","Anticipe les lignes de passe, coordonne son placement avec ses partenaires et récupère sans faute."];
 if(n.includes("esprit du jeu")||n.includes("auto arbitrage"))return ["Connaît mal les règles et interrompt le jeu par des contestations ou des comportements inadaptés.","Respecte les règles simples avec rappel ; participe parfois à la résolution d'un désaccord.","Applique les règles, annonce ses fautes et règle les désaccords par un échange respectueux.","Favorise un jeu équitable, aide à résoudre les litiges et fait vivre l'auto-arbitrage avec constance."];
 if(n.includes("allure")||n.includes("projet de performance"))return ["Part trop vite ou trop lentement et ne maintient pas l'allure visée.","Identifie une allure de référence mais présente des écarts importants entre les passages.","Respecte une allure annoncée, exploite les temps intermédiaires et ajuste son effort.","Anticipe les variations, régule précisément son allure et adapte son projet aux résultats observés."];
 if(n.includes("temps")||n.includes("chronometreur"))return ["Relève des temps incomplets ou interprète difficilement les écarts.","Recueille des temps simples mais peine à en tirer une décision pour la course.","Mesure avec fiabilité, compare les passages et formule un ajustement pertinent.","Analyse les tendances, justifie les choix d'allure et conseille efficacement un partenaire."];
 if(n.includes("assurer et")||n.includes("securite")||n.includes("securis"))return ["Oublie des contrôles essentiels ou agit sans appliquer la procédure de sécurité.","Applique les contrôles avec rappels et communique de façon encore irrégulière.","Vérifie systématiquement le matériel et les procédures, communique clairement et agit en sécurité.","Anticipe les risques, maintient des contrôles constants et aide son partenaire à sécuriser son action."];
 if(n.includes("appui")||n.includes("voie"))return ["Grimpe principalement en traction et hésite longtemps sans anticiper les prises.","Utilise quelques appuis efficaces, mais équilibre et lecture de la voie restent fragiles.","Lit une séquence de prises, transfère son poids et progresse avec des appuis adaptés.","Anticipe plusieurs mouvements, économise ses efforts et adapte finement ses placements à la voie."];
 if(n.includes("recev")||n.includes("continuite")||n.includes("echange"))return ["Se déplace tard et interrompt souvent l'échange.","Réalise des renvois simples mais manque de régularité dans son placement.","Se place tôt, contrôle la trajectoire et entretient régulièrement l'échange.","Anticipe, varie les réponses et crée des conditions favorables pour poursuivre ou conclure l'échange."];
 if(n.includes("cooper")||n.includes("communiquer")||n.includes("partenaire"))return ["Agit isolément et communique peu avec ses partenaires.","Coopère sur sollicitation et transmet des informations parfois tardives.","Partage des informations utiles et coordonne ses actions avec celles du groupe.","Anticipe les besoins collectifs, facilite les choix de l'équipe et soutient les partenaires."];
 if(n.includes("placement")||n.includes("replac"))return ["Reste statique ou se trouve souvent hors de la zone d'action.","Se replace après un délai et ajuste parfois sa position.","Se replace rapidement et choisit une position adaptée à la situation.","Anticipe les trajectoires et optimise son placement pour préparer l'action suivante."];
 if(n.includes("charge")||n.includes("posture")||a.includes("musculation"))return ["Adopte une posture instable ou une charge inadaptée à sa capacité.","Corrige certains placements sur rappel et adapte parfois la charge.","Contrôle sa posture, sa respiration et le dosage de l'effort en lien avec son objectif.","Régule précisément la charge, analyse ses sensations et ajuste son projet en autonomie."];
 return [
  "L'action «"+name+"» reste très irrégulière, inadaptée à la situation ou réalisée sans les repères nécessaires.",
  "L'action «"+name+"» réussit dans des situations simples, avec aide, mais manque de régularité.",
  "L'action «"+name+"» est réalisée régulièrement et de façon autonome dans une situation habituelle.",
  "L'action «"+name+"» est efficace, stable et adaptée à des situations variées, avec des choix justifiés."
 ];
}
function expectedDescriptors(name,apsa,refLevel){
 const ref=["N1","N2","N3","N4"].includes(refLevel)?refLevel:referenceLevels()[0];
 const context=ref==="N1"?"dans une situation aménagée avec repères simples":ref==="N2"?"dans une situation de pratique progressivement complexe":ref==="N3"?"dans une situation représentative de l'APSA avec prise de décision autonome":"dans une situation exigeante avec anticipation et adaptation";
 return specificAction(name,apsa).map((v,i)=>"Degré "+(i+1)+" — "+v+" Attendu observé "+context+".");
}
function isGeneratedDescriptor(value){return /^(?:(?:Degré|Niveau|N)\s*[1-4]\s*[·.:–—-]\s*)?(?:Non acquis|En cours|Acquis|Très bien maîtrisé)\s*:\s*/i.test(String(value||""))}
function actualDescriptors(o){
 const old=Array.isArray(o?.descriptors)?o.descriptors:[];
 return expectedDescriptors(o?.name||"",o?.apsa||tab()?.name||"",resolvedReference(o)).map((v,i)=>!old[i]||isGeneratedDescriptor(old[i])?v:old[i]);
}
function descriptorFields(o){
 const drafts=expectedDescriptors(o?.name||"",o?.apsa||tab()?.name||"",resolvedReference(o)),existing=o?.descriptors||[];
 return [1,2,3,4].map(n=>field("Degré de maîtrise "+n,"fdesc"+n,existing[n-1]&&!isGeneratedDescriptor(existing[n-1])?existing[n-1]:drafts[n-1])).join("");
}
function fillSuggestedDescriptors(){
 const name=input("fname");
 if(!name){toast("Indique d’abord le nom de la compétence.");return}
 if([1,2,3,4].some(n=>input("fdesc"+n))&&!confirm("Remplacer les critères affichés par une nouvelle proposition ?"))return;
 expectedDescriptors(name,tab()?.name||"",input("freflevel")).forEach((v,i)=>{const el=$("fdesc"+(i+1));if(el)el.value=v});
}
function observableScope(o){return o.scope==="collective"?"collective":"individual"}
const levelTitle=(o,n)=>actualDescriptors(o)[n-1];
const degreeText=(o,n)=>String(levelTitle(o,n)).replace(new RegExp("^Degré\\s*"+n+"\\s*[—–·:-]\\s*"),"");
function competencyActions(){return '<div class="row">'+btn("Catalogue APSA","catalog-apsa","primary")+btn("Créer une compétence","add-observable")+'</div>'}
function criterionDetails(o,target){
 return '<details class="criteria" data-keep="crit:'+esc(target)+':'+esc(o.id)+'"><summary>Voir les critères</summary>'+[1,2,3,4].map(n=>'<div class="criterion c'+n+'"><b>'+n+'</b><span>'+esc(degreeText(o,n))+'</span></div>').join("")+'<p class="criteria-note">'+(o.source==="fiche"?"Compétence issue des fiches ressources Éduscol. Échelle de degrés commune, modifiable.":"Repères pédagogiques modifiables et non officiels.")+'</p></details>';
}
function competencyPanel(t,values,scope,target,compact){
 const items=t.observables.filter(o=>observableScope(o)===scope),title=scope==="collective"?"Compétences du groupe":"Compétences";
 if(!items.length)return compact?"":'<section class="comp-panel"><h3>'+title+'</h3><p class="muted small-text">Aucune compétence à évaluer.</p>'+btn("Ajouter des compétences","tab:setup","small")+'</section>';
 return '<section class="comp-panel"'+(compact?' style="border:0;padding:0"':"")+'>'+(compact?"":'<h3>'+title+'</h3>')+items.map(o=>{
  const current=values?.[o.id];
  return '<div class="comp-item"><div class="comp-name">'+esc(o.name)+'</div><div class="degrees">'+[1,2,3,4].map(n=>'<button type="button" class="degree d'+n+'" data-action="competency-level:'+scope+':'+esc(target)+':'+esc(o.id)+':'+n+'" aria-label="'+esc(o.name)+', degré '+n+'" title="'+esc(degreeText(o,n))+'" aria-pressed="'+(current===n)+'">'+n+(Number(o.points)>0?'<small>'+pointsLabel(degreePoints(o,n))+'</small>':"")+'</button>').join("")+'</div>'+criterionDetails(o,target)+'</div>'}).join("")+'</section>';
}
function updateResult(sid,fn,later){const t=tab();if(!t.results[sid])t.results[sid]={levels:{},note:"",comment:"",drawing:""};fn(t.results[sid]);if(later)saveSoon();else save()}

/* ---------- Exports ---------- */
function exportFile(name,content,mime){const blob=new Blob([content],{type:mime}),u=URL.createObjectURL(blob),a=document.createElement("a");a.href=u;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),1500)}
const safeName=x=>x.normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-zA-Z0-9_-]+/g,"-").slice(0,55);
const today=()=>new Date().toISOString().slice(0,10);
function exportBackup(){data.lastBackup=new Date().toISOString();save();exportFile("mon-classeur-prof-sauvegarde-"+today()+".json",JSON.stringify(data,null,2),"application/json");render();toast("Sauvegarde créée. Range-la hors de cet appareil.")}
function csvCell(v){let s=String(v??"");if(/^[=+\-@]/.test(s))s="'"+s;return /[;"\n\r]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s}
function exportCsv(c,t){
 const ind=t.observables.filter(o=>observableScope(o)==="individual");
 const pts=scored(t).length>0,rows=[["Élève","Statut",...ind.map(o=>o.name),"Moyenne /4",...(pts?["Points"]:[]),"Note /20","Observation"]];
 [...c.students].sort(byName).forEach(s=>{const a=t.results[s.id]||{};rows.push([s.name,STATUS[a.status]||"",...ind.map(o=>a.levels?.[o.id]||""),degreeMean(ind,a),...(pts?(s0=>[s0.missing?"":fr(s0.earned)+"/"+fr(s0.max)])(computedScore(t,s.id)):[]),finalNote(t,s.id)===null?"":fr(finalNote(t,s.id)),a.comment||""])});
 exportFile("notes-"+safeName(c.name)+"-"+safeName(t.name)+"-"+today()+".csv","﻿"+rows.map(r=>r.map(csvCell).join(";")).join("\r\n"),"text/csv;charset=utf-8");
}
function archiveHtml(tableId){
 const c=cls(),t=c?.tables.find(x=>x.id===tableId);if(!c||!t){toast("Ouvre une évaluation avant de l’archiver.");return}
 const e=esc,students=[...c.students].sort(byName),groups=t.groups,pts=scored(t).length>0;
 const groupOf=sid=>groups.find(g=>g.studentIds.includes(sid));
 const levelOf=(o,sid)=>observableScope(o)==="collective"?groupOf(sid)?.levels?.[o.id]:t.results[sid]?.levels?.[o.id];
 const notes=students.map(s=>finalNote(t,s.id)).filter(n=>n!==null);
 const mean=notes.length?fr(Math.round(notes.reduce((x,y)=>x+y,0)/notes.length*100)/100):"–";
 const absent=students.filter(s=>t.results[s.id]?.status).length;
 const stat=(v,l)=>'<div class="stat"><strong>'+v+'</strong>'+l+'</div>';
 const degreeBadge=(n,o)=>n?'<span class="d d'+n+'">'+n+'</span>'+(Number(o.points)>0?'<small>'+pointsLabel(degreePoints(o,n))+'</small>':""):'<span class="none">–</span>';
 const style='*{box-sizing:border-box}body{margin:0;background:#f6f4ee;color:#14263d;font:17px/1.45 "Avenir Next",-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}main{max-width:1040px;margin:auto;padding:20px 16px 60px}header{background:#1b2c40;color:#fff;padding:24px 26px;border-radius:14px;border-bottom:6px solid #7647a4;margin-bottom:16px}header h1{margin:0 0 4px;font-size:32px;line-height:1.1}header p{margin:0;color:#d5dfe9}h2{font-size:21px;margin:26px 0 10px;color:#5f3786}.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}.stat{background:#fff;border-radius:10px;padding:12px 16px;border-left:6px solid #7647a4;font-size:15px;color:#46586d;box-shadow:0 3px 10px #1b2c4014}.stat:nth-child(2){border-left-color:#177f73}.stat:nth-child(3){border-left-color:#285c9d}.stat:nth-child(4){border-left-color:#b0521e}.stat strong{display:block;font-size:28px;line-height:1.15;color:#14263d}.scale{display:grid;gap:6px}.scale div{display:flex;justify-content:space-between;gap:12px;background:#fff;border-radius:8px;padding:8px 14px;box-shadow:0 2px 6px #1b2c400f}.tools{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin:10px 0}.tools input{flex:1 1 200px;min-height:44px;padding:8px 12px;border:1.5px solid #aab7c6;border-radius:8px;font:inherit}.tools button{min-height:44px;border:1.5px solid #aab7c6;background:#fff;color:#14263d;border-radius:8px;padding:8px 14px;font:inherit;font-weight:700}.wrap{overflow:auto;background:#fff;border-radius:10px;box-shadow:0 3px 10px #1b2c4014}table{border-collapse:collapse;width:100%;font-size:15px}th{background:#efe7f7;color:#5f3786;text-align:left;vertical-align:bottom;font-size:14px}td,th{padding:8px 10px;border-bottom:1px solid #e0ded6}td:first-child,th:first-child{position:sticky;left:0;background:#fff;min-width:170px}th:first-child{background:#efe7f7}td a{color:inherit;font-weight:600;text-decoration:none}td.num{font-weight:700;font-size:17px;white-space:nowrap}.d{display:inline-grid;place-items:center;width:26px;height:26px;margin-right:5px;border-radius:6px;color:#fff;font-weight:700;font-size:14px}.d1{background:#b3372f}.d2{background:#a86a00}.d3{background:#1c5fa6}.d4{background:#0e7a63}small{color:#46586d}.none{color:#8a97a6}.group{background:#fff;border-radius:10px;overflow:hidden;margin:8px 0;box-shadow:0 2px 6px #1b2c400f}.bib{padding:8px 14px;font-weight:700}.group .body{padding:10px 14px}.student{background:#fff;border-radius:10px;margin:8px 0;overflow:hidden;box-shadow:0 2px 6px #1b2c400f}.student summary{display:flex;align-items:center;gap:10px;cursor:pointer;padding:13px 16px;font-weight:700}.student.empty summary{color:#6b7886;font-weight:500}.student .body{padding:12px 16px;border-top:1px solid #e0ded6}.tag{padding:2px 8px;border-radius:6px;font-size:14px;background:#e7ebf0;color:#3f5062;white-space:nowrap}.tag.note{margin-left:auto;background:#efe7f7;color:#5f3786;font-size:16px;font-weight:700}.tag.first{margin-left:auto}.tag.first+.tag.note{margin-left:0}.comp{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:2px 12px;padding:8px 0;border-bottom:1px solid #eeece5}.comp p{grid-column:1/-1;margin:0;font-size:15px;color:#46586d}.comp b{font-weight:600}.total{margin:10px 0 0;padding:8px 12px;border-radius:8px;background:#efe7f7;color:#5f3786;font-weight:700}.label{font-size:14px;font-weight:700;color:#46586d;margin-top:12px}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:4px 0}img{max-width:100%;height:auto;border:1px solid #e0ded6;border-radius:8px}.muted{color:#46586d;font-size:15px}@media print{body{background:#fff;font-size:12px}main{max-width:none;padding:0}header{-webkit-print-color-adjust:exact;print-color-adjust:exact}.tools{display:none}.student{break-inside:avoid;box-shadow:none;border:1px solid #ddd}.d{-webkit-print-color-adjust:exact;print-color-adjust:exact}.student.empty{display:none}}';
 const parts=['<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+e(t.name)+', '+e(c.name)+'</title><style>'+style+'</style></head><body><main><header><h1>'+e(t.name)+'</h1><p>'+e(c.name)+', '+e(data.year)+(trimesterLabels[t.trimester]?', '+trimesterLabels[t.trimester]:"")+'. Archivé le '+e(new Date().toLocaleDateString("fr-FR"))+'.</p></header>'];
 parts.push('<section class="stats">'+stat(notes.length+'/'+students.length,"élèves notés")+stat(mean,"moyenne de classe")+stat(notes.length?fr(Math.min(...notes))+" à "+fr(Math.max(...notes)):"–","note min. à max.")+stat(absent,"absents ou dispensés")+'</section>');
 if(t.observables.length)parts.push('<h2>Compétences évaluées</h2><div class="scale">'+t.observables.map(o=>'<div><span>'+e(o.name)+(observableScope(o)==="collective"?' <small>(par groupe)</small>':"")+'</span><b>'+(Number(o.points)>0?pointsLabel(Number(o.points)):"sans points")+'</b></div>').join("")+'</div>');
 parts.push('<h2>Récapitulatif</h2><div class="tools"><input id="q" type="search" placeholder="Chercher un élève" aria-label="Chercher un élève"><button type="button" id="sort-name">Trier par nom</button><button type="button" id="sort-note">Trier par note</button></div><div class="wrap"><table><thead><tr><th>Élève</th>'+t.observables.map(o=>'<th>'+e(o.name)+'</th>').join("")+(pts?'<th>Points</th>':"")+'<th>Note /20</th></tr></thead><tbody id="rows">');
 students.forEach((st,i)=>{
  const r=t.results[st.id]||{},n=finalNote(t,st.id),s0=computedScore(t,st.id);
  parts.push('<tr data-name="'+e(st.name.toLowerCase())+'" data-note="'+(n??-1)+'"><td><a href="#e'+i+'">'+e(st.name)+'</a>'+(STATUS[r.status]?' <span class="tag">'+STATUS[r.status]+'</span>':"")+'</td>'+t.observables.map(o=>'<td>'+degreeBadge(levelOf(o,st.id),o)+'</td>').join("")+(pts?'<td>'+(s0.missing?'<small>'+plural(s0.missing,"compétence")+' à évaluer</small>':fr(s0.earned)+' / '+fr(s0.max))+'</td>':"")+'<td class="num">'+(n===null?"–":fr(n))+'</td></tr>');
 });
 parts.push('</tbody></table></div>');
 if(groups.length){
  parts.push('<h2>Groupes</h2>');
  groups.forEach(g=>{
   const names=g.studentIds.map(id=>students.find(st=>st.id===id)).filter(Boolean).map(st=>st.name);
   const items=t.observables.filter(o=>observableScope(o)==="collective"&&g.levels?.[o.id]);
   parts.push('<section class="group"><div class="bib" style="background:'+groupColor(g)+';color:'+onColor(groupColor(g))+'">'+e(g.name)+'</div><div class="body"><p class="muted">'+e(names.join(", "))+'</p>'+(g.comment?'<pre>'+e(g.comment)+'</pre>':"")+items.map(o=>'<div class="comp"><b>'+e(o.name)+'</b><span>'+degreeBadge(g.levels[o.id],o)+'</span><p>'+e(degreeText(o,g.levels[o.id]))+'</p></div>').join("")+'</div></section>');
  });
 }
 parts.push('<h2>Détail par élève</h2><div class="tools"><button type="button" id="toggle">Tout déplier ou replier</button></div><div id="details">');
 students.forEach((st,i)=>{
  const r=t.results[st.id]||{},n=finalNote(t,st.id),g=groupOf(st.id),s0=computedScore(t,st.id);
  const rated=t.observables.filter(o=>levelOf(o,st.id)),missing=t.observables.filter(o=>!levelOf(o,st.id));
  const has=n!==null||rated.length||r.comment||safeImage(r.drawing)||r.status;
  parts.push('<details class="student'+(has?"":" empty")+'" id="e'+i+'" data-name="'+e(st.name.toLowerCase())+'"><summary><span>'+e(st.name)+'</span>'+(STATUS[r.status]?'<span class="tag first">'+STATUS[r.status]+'</span>':"")+'<span class="tag note">'+(n===null?(has?"À compléter":"Non évalué"):fr(n)+" / 20")+'</span></summary><div class="body">');
  if(g)parts.push('<p class="muted">'+e(g.name)+'</p>');
  rated.forEach(o=>{const n0=levelOf(o,st.id);parts.push('<div class="comp"><b>'+e(o.name)+(observableScope(o)==="collective"?' <small>(groupe)</small>':"")+'</b><span>'+degreeBadge(n0,o)+'</span><p>'+e(degreeText(o,n0))+'</p></div>')});
  missing.forEach(o=>parts.push('<div class="comp"><b>'+e(o.name)+'</b><span class="none">Non évaluée</span></div>'));
  if(s0&&!s0.missing)parts.push('<p class="total">Total : '+fr(s0.earned)+' / '+fr(s0.max)+' points, soit '+fr(s0.note)+' / 20</p>');
  if(r.comment)parts.push('<div class="label">Observation</div><pre>'+e(r.comment)+'</pre>');
  if(safeImage(r.drawing))parts.push('<div class="label">Note manuscrite</div><img alt="Note manuscrite" src="'+r.drawing+'">');
  if(!has)parts.push('<p class="muted">Aucune observation enregistrée.</p>');
  parts.push('</div></details>');
 });
 parts.push('</div><p class="muted">Archive consultable sans connexion. Elle contient des données d’élèves : conserve-la dans un espace privé.</p></main><script>(function(){var $=function(i){return document.getElementById(i)},rows=$("rows"),all=function(s){return Array.prototype.slice.call(document.querySelectorAll(s))};function sort(f){all("#rows tr").sort(f).forEach(function(r){rows.appendChild(r)})}$("sort-name").onclick=function(){sort(function(a,b){return a.dataset.name.localeCompare(b.dataset.name,"fr")})};$("sort-note").onclick=function(){sort(function(a,b){return b.dataset.note-a.dataset.note})};$("q").oninput=function(){var q=this.value.toLowerCase();all("[data-name]").forEach(function(x){x.style.display=x.dataset.name.indexOf(q)<0?"none":""})};$("toggle").onclick=function(){var d=all(".student"),open=d.some(function(x){return !x.open});d.forEach(function(x){x.open=open})};rows.onclick=function(ev){var a=ev.target.closest("a");if(a)$(a.getAttribute("href").slice(1)).open=true};addEventListener("beforeprint",function(){all(".student").forEach(function(x){x.open=true})})})()<\/script></body></html>');
 exportFile("evaluation-"+safeName(c.name)+"-"+safeName(t.name)+"-"+today()+".html",parts.join(""),"text/html;charset=utf-8");
}

/* ---------- Note manuscrite ---------- */
function draw(sid){
 const a=tab().results[sid]||{};let changed=false;
 modal("Note manuscrite",'<canvas id="ink" width="1000" height="500"></canvas><div class="row" style="margin-top:10px">'+btn("Effacer","clear-canvas")+'<span class="muted small-text">Au stylet ou au doigt. La paume est ignorée dès que le stylet est utilisé.</span></div>',()=>{
  if(changed)updateResult(sid,r=>{r.drawing=$("ink").dataset.blank==="1"?"":$("ink").toDataURL("image/png")});
  close();render();
 },{wide:true});
 const ink=$("ink"),ctx=ink.getContext("2d");
 ctx.lineWidth=3.5;ctx.lineCap="round";ctx.lineJoin="round";ctx.strokeStyle="#193b68";ctx.fillStyle="#fff";ctx.fillRect(0,0,ink.width,ink.height);
 if(safeImage(a.drawing)){const img=new Image();img.onload=()=>ctx.drawImage(img,0,0,ink.width,ink.height);img.src=a.drawing}
 let active=null,last=null,penSeen=false;
 const pt=e=>{const r=ink.getBoundingClientRect();return{x:(e.clientX-r.left)*ink.width/r.width,y:(e.clientY-r.top)*ink.height/r.height}};
 const line=(p,q)=>{ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);ctx.stroke()};
 ink.onpointerdown=e=>{if(e.pointerType==="pen")penSeen=true;if(active!==null||(penSeen&&e.pointerType==="touch"))return;e.preventDefault();active=e.pointerId;ink.setPointerCapture(active);last=pt(e);line(last,{x:last.x+.1,y:last.y+.1});changed=true;ink.dataset.blank="0"};
 ink.onpointermove=e=>{if(e.pointerId!==active)return;const list=e.getCoalescedEvents?.()||[e];(list.length?list:[e]).forEach(ev=>{const p=pt(ev);line(last,p);last=p})};
 ink.onpointerup=ink.onpointercancel=e=>{if(e.pointerId===active)active=null};
 window._markInk=()=>{changed=true;ink.dataset.blank="1"};
}

/* ---------- Groupes ---------- */
function autoGroups(){
 const c=cls(),t=tab(),hasObs=t.groups.some(g=>g.comment||Object.values(g.levels||{}).some(Boolean));
 modal("Groupes automatiques",field("Nombre de groupes","fcount",Math.min(t.groups.length||4,Math.max(c.students.length,1)),"number",'inputmode="numeric" min="1"')+'<label class="check"><input type="checkbox" id="fmix" checked>Équilibrer filles et garçons</label><label class="check"><input type="checkbox" id="fpresent" checked>Laisser de côté les absents et dispensés</label><p class="muted small-text">La composition actuelle des groupes sera remplacée.'+(hasObs?" Les groupes en trop perdront leur observation collective.":"")+'</p>',()=>{
  const n=Math.floor(Number(input("fcount")));
  if(!(n>=1)){toast("Indique un nombre de groupes.");return}
  let pool=c.students;
  if($("fpresent").checked)pool=pool.filter(s=>!t.results[s.id]?.status);
  if(!pool.length){toast("Aucun élève disponible.");return}
  const shuffle=a=>{a=[...a];for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a};
  const ordered=$("fmix").checked?[...shuffle(pool.filter(s=>s.sex==="F")),...shuffle(pool.filter(s=>s.sex==="M")),...shuffle(pool.filter(s=>s.sex!=="F"&&s.sex!=="M"))]:shuffle(pool);
  t.groups=t.groups.slice(0,n);
  while(t.groups.length<n)t.groups.push({id:uid(),name:nextGroupName(t),color:groupColors[t.groups.length%groupColors.length],studentIds:[],comment:""});
  t.groups.forEach(g=>{g.studentIds=[]});
  ordered.forEach((s,i)=>t.groups[i%n].studentIds.push(s.id));
  terrainSelection.clear();save();close();render();toast(plural(n,"groupe")+" "+(n>1?"créés":"créé")+".");
 },{saveLabel:"Créer les groupes"});
}
let terrainDrag=null,terrainDragTimer=null,terrainDragSuppressUntil=0;
function terrainDropStudent(sid,destination){
 const t=tab(),c=cls();if(view.page!=="terrain"||!t||!c||!c.students.some(st=>st.id===sid))return;
  const target=destination==="pool"||destination==="selection"?null:t.groups.find(g=>g.id===destination);
 if(!target&&destination!=="pool"&&destination!=="selection")return;
 if(destination==="selection"){terrainSelection.add(sid);render();return}
 t.groups.forEach(g=>g.studentIds=(g.studentIds||[]).filter(x=>x!==sid));
 terrainSelection.delete(sid);
 if(target){target.studentIds=target.studentIds||[];target.studentIds.push(sid)}
 save();render();
}
function clearTerrainDrag(){
 clearTimeout(terrainDragTimer);terrainDragTimer=null;
 document.querySelectorAll(".terrain-drop-active").forEach(x=>x.classList.remove("terrain-drop-active"));
 document.querySelectorAll(".terrain-drag-source").forEach(x=>x.classList.remove("terrain-drag-source"));
 document.querySelector(".terrain-drag-ghost")?.remove();
 terrainDrag=null;
}
document.addEventListener("pointerdown",e=>{
 const el=e.target.closest("[data-drag-student]");
 if(!el||view.page!=="terrain"||e.button!==0)return;
 clearTerrainDrag();
 terrainDrag={id:el.dataset.dragStudent,el,pointerId:e.pointerId,x:e.clientX,y:e.clientY,startX:e.clientX,startY:e.clientY,active:false};
 terrainDragTimer=setTimeout(()=>{
  const d=terrainDrag;if(!d||d.pointerId!==e.pointerId)return;
  d.active=true;terrainDragSuppressUntil=Date.now()+850;
  d.el.classList.add("terrain-drag-source");
  const ghost=document.createElement("div");ghost.className="terrain-drag-ghost";ghost.textContent=d.el.textContent.trim();document.body.appendChild(ghost);d.ghost=ghost;
  ghost.style.left=d.x+"px";ghost.style.top=d.y+"px";
  document.querySelectorAll("[data-drop-zone]").forEach(z=>z.classList.add("terrain-drop-active"));
  if(navigator.vibrate)navigator.vibrate(20);
 },420);
},{passive:true});
document.addEventListener("pointermove",e=>{
 const d=terrainDrag;if(!d||e.pointerId!==d.pointerId)return;
 d.x=e.clientX;d.y=e.clientY;
 if(!d.active){if(Math.hypot(d.x-d.startX,d.y-d.startY)>12){clearTimeout(terrainDragTimer);terrainDragTimer=null}return}
 if(e.cancelable)e.preventDefault();
 if(d.ghost){d.ghost.style.left=d.x+"px";d.ghost.style.top=d.y+"px"}
 document.querySelectorAll(".terrain-drop-hover").forEach(z=>z.classList.remove("terrain-drop-hover"));
 const z=document.elementFromPoint(d.x,d.y)?.closest("[data-drop-zone]");if(z)z.classList.add("terrain-drop-hover");
},{passive:false});
document.addEventListener("pointerup",e=>{
 const d=terrainDrag;if(!d||e.pointerId!==d.pointerId)return;
 const active=d.active,sid=d.id,z=active?document.elementFromPoint(e.clientX,e.clientY)?.closest("[data-drop-zone]"):null;
 if(active){terrainDragSuppressUntil=Date.now()+850;e.preventDefault()}
 clearTerrainDrag();
 if(active&&z)terrainDropStudent(sid,z.dataset.dropZone);
},{capture:true});
document.addEventListener("pointercancel",()=>clearTerrainDrag());
/* Pendant un glissement, le doigt déplace l'élève ; le reste du temps, il fait défiler la page. */
document.addEventListener("touchmove",e=>{if(terrainDrag?.active&&e.cancelable)e.preventDefault()},{passive:false});
document.addEventListener("click",e=>{if(Date.now()<terrainDragSuppressUntil&&e.target.closest("[data-drag-student]")){e.preventDefault();e.stopImmediatePropagation()}},true);

/* ---------- Saisie ---------- */
document.addEventListener("input",e=>{
 const d=e.target.dataset;
 if(d.observationGroup){const g=tab()?.groups.find(x=>x.id===d.observationGroup);if(g){g.comment=e.target.value;saveSoon()}}
 else if(d.observationStudent)updateResult(d.observationStudent,r=>{r.comment=e.target.value},true);
 else if(d.observationNote)updateResult(d.observationNote,r=>{r.note=e.target.value},true);
 else if(d.ccfField){ccfWrite(d.ccfStudent,cc=>{cc.v[d.ccfField]=e.target.value},true);const t=tab(),f=t&&isCcf(t)?ccfSpec(t).fields.flatMap(g=>g.items).find(x=>x.k===d.ccfField):null,pv=document.querySelector('[data-ccf-preview="'+CSS.escape(d.ccfField)+'"]');if(f&&pv)pv.innerHTML=ccfPreview(f,e.target.value);patchCcf()}
 else if(d.bilanRemark){setRemark(d.bilanRemark,e.target.value);saveSoon()}
 else if(d.bilanClassRemark){setRemark("class",e.target.value);saveSoon()}
 else if(d.bilanOverride||d.bilanCoef){const c=cls(),b=bilanOf(c,bilanTri());if(d.bilanOverride)b.overrides[d.bilanOverride]=e.target.value;else b.coefs[d.bilanCoef]=e.target.value;saveSoon();refreshBilan()}
 else if(d.observablePoints){const t=tab(),o=t?.observables.find(x=>x.id===d.observablePoints);if(o){o.points=e.target.value;saveSoon();const el=$("points-total");if(el)el.textContent=pointsTotal(t);const line=document.querySelector('[data-scale="'+CSS.escape(o.id)+'"]');if(line)line.innerHTML=degreeScale(o)}}
});
document.addEventListener("change",e=>{
 const d=e.target.dataset;
 if(d.observationNote){const n=parseNote(e.target.value);if(e.target.value!==""&&(n===null||n<0||n>20)){e.target.value="";updateResult(d.observationNote,r=>{r.note=""});toast("La note doit être comprise entre 0 et 20.")}return}
 if(d.bilanOverride||d.bilanCoef){
  const c=cls(),b=bilanOf(c,bilanTri()),v=e.target.value,n=parseNote(v),bad=v!==""&&(n===null||n<0||(d.bilanOverride&&n>20));
  if(bad){if(d.bilanOverride){e.target.value="";b.overrides[d.bilanOverride]=""}else{e.target.value=1;b.coefs[d.bilanCoef]=1}toast(d.bilanOverride?"La moyenne doit être comprise entre 0 et 20.":"Le coefficient doit être positif ou nul.")}
  else if(d.bilanCoef&&v==="")b.coefs[d.bilanCoef]=1;
  save();refreshBilan();return;
 }
 if(e.target.id==="apsa-ref-level"||e.target.id==="apsa-select"){
  const level=input("apsa-ref-level"),sel=$("apsa-select");
  if(e.target.id==="apsa-ref-level"){const apsa=apsaChoice(level,sel.value);sel.innerHTML=apsaSelectOptions(level,apsa);sel.value=apsa}
  $("apsa-list").innerHTML=apsaOptions(level,sel.value);return
 }
 if(e.target.id==="custom-group-color")window._customColorPicked=true;
});
document.addEventListener("keydown",e=>{
 if(!$("modalhost")?.firstChild)return;
 if(e.key==="Escape"){e.preventDefault();close()}
 if(e.key==="Enter"&&e.target.tagName==="INPUT"&&e.target.type!=="file"&&window._modalSave){e.preventDefault();window._modalSave()}
});
/* Bilan plateforme : un seul élève ouvert à la fois, même sur les navigateurs qui ignorent details[name]. */
document.addEventListener("toggle",e=>{const d=e.target;if(d.matches?.(".pf-item")&&d.open){document.querySelectorAll(".pf-item[open]").forEach(o=>{if(o!==d)o.open=false});setTimeout(()=>d.scrollIntoView({block:"nearest",behavior:"smooth"}),30)}},true);
document.addEventListener("click",e=>{document.querySelectorAll("details.menu[open]").forEach(m=>{if(!m.contains(e.target)||e.target.closest(".menu-list"))m.open=false})},true);

/* ---------- Actions ---------- */
function go(page,extra={}){view={...view,...extra,page};if(view.tableId&&["setup","terrain","table","ccf","ccf-table","ccf-bareme"].includes(page))lastTab[view.tableId]=page;render()}
const actions={
 classes(){view={page:"classes",classId:null,tableId:null};render()},
 home(){view={page:"home",classId:null,tableId:null};render()},
 "open-class"(id){view={page:"class",classId:id,tableId:null};activeTrimester=currentTrimester();render()},
 "select-trimester"(id){activeTrimester=id;render()},
 "open-eval"(cid,id){view={page:"class",classId:cid,tableId:null};activeTrimester=currentTrimester();actions["open-table"](id)},
 "quick-eval"(cid){view={page:"class",classId:cid,tableId:null};activeTrimester=currentTrimester();actions["new-trimester"](activeTrimester)},
 "open-table"(id){const t=cls().tables.find(x=>x.id===id);data.lastOpened={classId:view.classId,tableId:id};save();terrainSelection.clear();observationGroupId=null;view.tableId=id;view.page=isCcf(t)?(lastTab[id]||"ccf"):lastTab[id]||(!t.observables.length?"setup":t.groups.length?"observation":"observation-individual");render()},
 tab(id){terrainSelection.clear();go(id==="observation"&&!tab().groups.length?"observation-individual":id)},
 "observation-start"(){go("observation")},
 "observation-individual-start"(){observationGroupId=null;go("observation-individual")},
 "individual-student"(id){observationStudentId=id;observationGroupId=null;go("observation-student")},
 "observation-open"(id){observationGroupId=id;go("observation-group")},
 "observation-back"(){go("observation")},
 "observation-student"(id){observationStudentId=id;go("observation-student")},
 "go-student"(id){observationStudentId=id;go("observation-student")},
 "terrain-student-open"(id){observationStudentId=id;observationGroupId=tab()?.groups.find(g=>g.studentIds.includes(id))?.id||null;go("observation-student")},
 "observation-student-back"(){go(observationGroupId?"observation-group":"observation-individual")},
 students(){go("students")},storage(){go("storage")},
 "close-modal"(){close()},
 "submit-modal"(){window._modalSave?.()},
 "dismiss-notice"(){noticeDismissed=true;render()},
 "dismiss-install"(){try{localStorage.setItem(KEY+"-install-vu","1")}catch{}render()},
 year(){modal("Année scolaire",field("Année","fyear",data.year),()=>{data.year=input("fyear")||data.year;save();close();render()})},
 "add-class"(){classForm(null)},
 "edit-class"(id){classForm(data.classes.find(x=>x.id===id))},
 "delete-class"(id){
  alert("Pour supprimer une classe et toutes ses données (appel, bulletins, évaluations), utilise « Modifier la classe » dans le carnet.");return;
  const index=data.classes.findIndex(x=>x.id===id);if(index<0)return;
  const target=data.classes[index];
  if(!confirm("Supprimer définitivement la classe « "+target.name+" » ?\n\nSes élèves, évaluations, groupes, notes et observations seront effacés de cet appareil. Fais une sauvegarde avant de continuer."))return;
  const typed=prompt("Pour confirmer, saisis exactement le nom de la classe : "+target.name);
  if(typed!==target.name){if(typed!==null)toast("Nom incorrect : suppression annulée.");return}
  const removed=data.classes.splice(index,1)[0];
  if(!save()){data.classes.splice(index,0,removed);toast("Suppression non enregistrée : la classe est conservée.");return}
  actions.classes();
 },
 "archive-class"(id){const x=data.classes.find(x=>x.id===id);x.archived=!x.archived;save();render()},
 "new-trimester"(id){const c=cls();modal("Nouvelle évaluation",'<div class="notice ccf-notice"><p><b>Classe de Terminale ?</b> Pour une épreuve certificative (CCF) avec le barème des fiches du lycée, choisis plutôt l’épreuve CCF.</p>'+btn("Créer une épreuve CCF","new-ccf","primary small")+'</div>'+field("Activité (ex. Escalade, Volley-ball)","fname")+trimesterOptions(id),()=>{const name=input("fname");if(!name){toast("Donne un nom à l’évaluation.");return}const t={id:uid(),name,trimester:input("ftrimester"),folderId:null,observables:[],results:{},groups:[]};c.tables.push(t);activeTrimester=t.trimester||"unclassified";save();close();go("setup",{tableId:t.id})},{saveLabel:"Créer"})},
 "edit-table"(id){const c=cls(),t=c.tables.find(x=>x.id===id);modal("Renommer ou changer de trimestre",field("Nom de l’évaluation","fname",t.name)+trimesterOptions(t.trimester)+(c.folders.length?'<label class="field">Dossier<select id="ffolder"><option value="">Aucun</option>'+c.folders.map(f=>'<option value="'+esc(f.id)+'"'+(t.folderId===f.id?" selected":"")+'>'+esc(f.name)+'</option>').join("")+'</select></label>':""),()=>{const name=input("fname");if(!name)return;t.name=name;t.trimester=input("ftrimester");if($("ffolder"))t.folderId=input("ffolder")||null;save();close();render()})},
 "duplicate-table"(id){const c=cls(),t=c.tables.find(x=>x.id===id),copy=JSON.parse(JSON.stringify(t));copy.id=uid();copy.name=t.name+" (copie)";copy.results={};copy.groups.forEach(g=>{g.id=uid();g.comment="";g.levels={}});c.tables.push(copy);save();render();toast("Évaluation dupliquée sans les notes.")},
 "reuse-table"(id){
  const c=cls(),t=c.tables.find(x=>x.id===id),others=data.classes.filter(x=>x.id!==c.id&&!x.archived);
  if(!others.length){toast("Crée d’abord une autre classe.");return}
  modal("Réutiliser dans une autre classe",'<p class="muted">Copie le nom et les compétences de « '+esc(t.name)+' ». Les notes et les groupes restent ici.</p><label class="field">Classe<select id="fclass">'+others.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name)+'</option>').join("")+'</select></label>',()=>{
   const target=data.classes.find(x=>x.id===input("fclass"));if(!target)return;
   target.tables.push({id:uid(),name:t.name,trimester:t.trimester,folderId:null,observables:JSON.parse(JSON.stringify(t.observables)),results:{},groups:[],...(t.ccf?{ccf:{...t.ccf}}:{})});
   save();close();render();toast("Évaluation copiée dans "+target.name+".");
  },{saveLabel:"Copier"});
 },
 "delete-table"(id){const c=cls();if(!confirm("Supprimer cette évaluation, ses notes et ses observations ?"))return;c.tables=c.tables.filter(x=>x.id!==id);save();render()},
 "add-student"(){studentForm(null)},
 "edit-student"(id){studentForm(cls().students.find(x=>x.id===id))},
 "delete-student"(id){
  alert("Pour retirer un élève, utilise « Modifier la classe et le trombinoscope » dans le carnet : ses données sont conservées et il pourra être réintégré.");return;
  const c=cls();if(!confirm("Supprimer cet élève ainsi que ses notes et observations dans toutes les évaluations de la classe ?"))return;
  c.students=c.students.filter(x=>x.id!==id);
  c.tables.forEach(t=>{delete t.results[id];t.groups.forEach(g=>{g.studentIds=g.studentIds.filter(x=>x!==id)})});
  save();render();
 },
 "paste-students"(){const c=cls();modal("Coller une liste d’élèves",'<label class="field">Un élève par ligne<textarea id="flist" rows="9"></textarea></label>',()=>{const seen=new Set(c.students.map(s=>s.name.toLocaleLowerCase("fr")));let n=0;input("flist").split(/\n/).map(x=>x.replace(/\s+/g," ").trim()).filter(Boolean).forEach(name=>{const k=name.toLocaleLowerCase("fr");if(seen.has(k))return;seen.add(k);c.students.push({id:uid(),name});n++});save();close();render();toast(plural(n,"élève")+" "+(n>1?"ajoutés":"ajouté")+".")},{saveLabel:"Ajouter"})},
 "catalog-apsa"(){openApsaCatalog()},
 "prefill-descriptors"(){fillSuggestedDescriptors()},
 "add-observable"(){observableForm(null)},
 "edit-observable"(id){const o=tab().observables.find(x=>x.id===id);if(o)observableForm(o)},
 "delete-observable"(id){if(!confirm("Supprimer cette compétence de l’évaluation ?"))return;tab().observables=tab().observables.filter(o=>o.id!==id);save();close();render()},
 "competency-level"(scope,target,oid,n,el){
  const t=tab(),o=t?.observables.find(x=>x.id===oid),num=Number(n);if(!o||observableScope(o)!==scope)return;
  let value;
  if(scope==="collective"){const g=t.groups.find(x=>x.id===target);if(!g)return;g.levels=g.levels||{};value=g.levels[oid]=g.levels[oid]===num?null:num;save()}
  else updateResult(target,r=>{r.levels=r.levels||{};value=r.levels[oid]=r.levels[oid]===num?null:num});
  /* Mise à jour ciblée : le clavier et le texte en cours restent en place. */
  el.parentElement.querySelectorAll(".degree").forEach((b,i)=>b.setAttribute("aria-pressed",String(value===i+1)));
  refreshScores(t);
 },
 level(sid,oid,n){updateResult(sid,r=>{r.levels=r.levels||{};r.levels[oid]=r.levels[oid]===Number(n)?null:Number(n)});render()},
 "set-status"(sid,status){updateResult(sid,r=>{if(status)r.status=status;else delete r.status});render()},
 "terrain-pick"(id){if(terrainSelection.has(id))terrainSelection.delete(id);else terrainSelection.add(id);render()},
 "terrain-clear"(){terrainSelection.clear();render()},
 "terrain-new"(){newGroup([])},
 "terrain-create-selected"(){newGroup([...terrainSelection])},
 "terrain-move"(id){const t=tab(),ids=[...terrainSelection],dest=id==="pool"?null:t.groups.find(g=>g.id===id);if(!ids.length||(id!=="pool"&&!dest))return;t.groups.forEach(g=>{g.studentIds=g.studentIds.filter(sid=>!terrainSelection.has(sid))});if(dest)dest.studentIds.push(...ids);terrainSelection.clear();save();render()},
 "terrain-rename"(id){
  const t=tab(),g=t.groups.find(x=>x.id===id);if(!g)return;
  const palette='<div class="field">Couleur de chasuble</div><div class="palette">'+groupColors.map(color=>'<label class="swatch" style="background:'+color+'"><input type="radio" name="group-color" value="'+color+'"'+(g.color===color?" checked":"")+' aria-label="Couleur '+color+'"><span>✓</span></label>').join("")+'</div>';
  window._customColorPicked=false;
  modal("Modifier le groupe",field("Nom du groupe","fname",g.name)+palette+'<label class="check">Autre couleur <input type="color" id="custom-group-color" style="width:56px;height:40px" value="'+groupColor(g)+'"></label><div class="modal-tools">'+btn("Supprimer le groupe","delete-group:"+g.id,"danger small")+'</div>',()=>{g.name=input("fname")||g.name;g.color=window._customColorPicked?$("custom-group-color").value:(document.querySelector('input[name="group-color"]:checked')?.value||g.color);save();close();render()});
 },
 "delete-group"(id){if(!confirm("Supprimer ce groupe ? Ses élèves redeviennent sans groupe."))return;tab().groups=tab().groups.filter(x=>x.id!==id);if(observationGroupId===id){observationGroupId=null;if(view.page==="observation-group")view.page="observation"}save();close();render()},
 "terrain-observe"(id){observationGroupId=id;go("observation-group")},
 "auto-groups"(){autoGroups()},
 "rename-folder"(id){const f=cls().folders.find(x=>x.id===id);modal("Renommer le dossier",field("Nom du dossier","fname",f?.name),()=>{const name=input("fname");if(!name)return;f.name=name;save();close();render()})},
 "delete-folder"(id){const c=cls();if(!confirm("Supprimer ce dossier ? Ses évaluations sont conservées."))return;c.tables.forEach(t=>{if(t.folderId===id)t.folderId=null});c.folders=c.folders.filter(f=>f.id!==id);save();render()},
 draw(id){draw(id)},
 "clear-canvas"(){const ink=$("ink");if(ink){const ctx=ink.getContext("2d");ctx.fillStyle="#fff";ctx.fillRect(0,0,ink.width,ink.height);window._markInk?.()}},
 "privacy-info"(){modal("Confidentialité",'<p>Tes classes, notes et observations restent dans le navigateur de cet appareil. Rien n’est envoyé sur Internet, et le site ne mesure pas ton activité.</p><p>Les sauvegardes et archives contiennent des données d’élèves. Garde-les dans un espace privé, jamais sur un dépôt GitHub public, et verrouille ton appareil par un code.</p>')},
 "install-info"(){modal("Installer sur l’appareil",'<p>Une fois installé, le classeur s’ouvre comme une application et fonctionne sans réseau.</p><p><b>Sur iPad</b>, l’application installée ne voit pas les données de Safari. Si tu as déjà des classes dans Safari :</p><ol><li>Dans Safari, ouvre Options puis « Faire une sauvegarde ».</li><li>Touche le bouton Partager, puis « Sur l’écran d’accueil ».</li><li>Ouvre l’application installée, puis « Restaurer une sauvegarde ».</li><li>Vérifie tes classes avant d’effacer quoi que ce soit dans Safari.</li></ol>')},
 async "force-update"(){
  /* Ne touche qu'aux fichiers de l'application : les classes restent dans le stockage local. */
  flushSave();location.reload();
  return;
  location.replace(location.pathname+"?maj="+Date.now());
 },
 "export-json"(){flushSave();location.href="../#sauvegarde"},
 "export-html"(){archiveHtml(tab()?.id)},
 "export-table"(id){archiveHtml(id)},
 "export-csv"(){exportCsv(cls(),tab())},
 "export-storage"(id,tid){view.classId=id;archiveHtml(tid);view.classId=null},
 "clear-results"(id,tid){
  const tt=data.classes.find(x=>x.id===id)?.tables.find(x=>x.id===tid);if(!tt)return;
  if(!confirm("As-tu archivé cette évaluation et vérifié le fichier ? Les notes et observations seront effacées de l’application."))return;
  if(!confirm("Dernière confirmation : effacer les observations de « "+tt.name+" » ? Les élèves et les groupes sont conservés."))return;
  tt.results={};tt.groups.forEach(g=>{g.comment="";g.levels={}});save();render();
 },
 bilan(){go("bilan")},
 "new-ccf"(){close();activeTrimester="ccf";newCcfForm()},
 "ccf-open"(sid){observationStudentId=sid;go("ccf-student")},
 "ccf-back"(){go("ccf")},
 "ccf-sex"(sid,sex){const s=cls().students.find(x=>x.id===sid);if(!s)return;s.sex=s.sex===sex?null:sex;save();render()},
 "ccf-rep"(sid,k){ccfWrite(sid,cc=>{cc.rep=k});render()},
 "ccf-role"(sid,k){ccfWrite(sid,cc=>{cc.role=cc.role===k?"":k});render()},
 "ccf-deg"(sid,k,n){const num=Number(n);ccfWrite(sid,cc=>{cc.d[k]=cc.d[k]===num?null:num;delete cc.p[k]});patchCcf()},
 "ccf-pts"(sid,k,x){ccfWrite(sid,cc=>{cc.p[k]=x});patchCcf()},
 "ccf-csv"(){exportCcfCsv()},
 "ccf-platform"(){exportCcfPlatform()},
 "ccf-platform-html"(){exportCcfHtml()},
 "ccf-saisi"(sid){ccfWrite(sid,cc=>{cc.saisi=!cc.saisi});render()},
 "bilan-trimester"(id){activeTrimester=id;render()},
 "bilan-csv"(){exportBilanCsv()},
 "bilan-tag"(target,k,el){
  const b=bilanOf(cls(),bilanTri()),list=target==="class"?b.classTags:(b.tags[target]=b.tags[target]||[]),i=list.indexOf(k);
  if(i<0)list.push(k);else list.splice(i,1);
  save();el.setAttribute("aria-pressed",String(i<0));
 },
 "bilan-propose"(target){
  const c=cls(),tri=bilanTri(),b=bilanOf(c,tri),current=target==="class"?b.classRemark:b.remarks[target]||"";
  const s=c.students.find(x=>x.id===target);if(target!=="class"&&!s)return;
  if(current.trim()&&current!==lastProposal[target]&&!confirm("Remplacer l’appréciation écrite à la main par une nouvelle formulation ?"))return;
  /* « Reformuler » : on tourne dans les variantes jusqu'à obtenir un texte différent de l'actuel. */
  let text="";for(let i=0;i<8;i++){text=target==="class"?classProposal(c,tri):studentProposal(c,tri,s);if(text!==current)break}
  lastProposal[target]=text;setRemark(target,text);save();
 },
 "bilan-clear"(target){
  const b=bilanOf(cls(),bilanTri()),current=target==="class"?b.classRemark:b.remarks[target]||"";
  if(!current.trim())return;
  if(current!==lastProposal[target]&&!confirm("Effacer cette appréciation écrite à la main ?"))return;
  delete lastProposal[target];setRemark(target,"");save();toast("Appréciation effacée.");
 },
 "bilan-clear-all"(){
  const c=cls(),tri=bilanTri(),b=bilanOf(c,tri),n=Object.values(b.remarks).filter(x=>String(x||"").trim()).length+(b.classRemark.trim()?1:0);
  if(!n){toast("Aucune appréciation à effacer.");return}
  if(!confirm("Effacer les "+plural(n,"appréciation")+" du "+trimesterLabels[tri]+" pour "+c.name+" ? Les repères cochés sont conservés."))return;
  b.remarks={};b.classRemark="";Object.keys(lastProposal).forEach(k=>delete lastProposal[k]);save();render();toast(plural(n,"appréciation")+" "+(n>1?"effacées":"effacée")+".");
 },
 "bilan-propose-all"(){
  const c=cls(),tri=bilanTri(),b=bilanOf(c,tri);let n=0;
  [...c.students].sort(byName).forEach(s=>{if((b.remarks[s.id]||"").trim())return;const text=studentProposal(c,tri,s);lastProposal[s.id]=text;b.remarks[s.id]=text;n++});
  save();render();toast(n?plural(n,"appréciation")+" "+(n>1?"proposées":"proposée")+". Relis-les avant de les copier.":"Toutes les appréciations sont déjà écrites.");
 },
 async "bilan-copy-all"(){
  const c=cls(),b=bilanOf(c,bilanTri());
  const parts=[];
  if(b.classRemark.trim())parts.push("Appréciation de la classe\n"+b.classRemark.trim());
  for(const s of c.students){const r=(b.remarks[s.id]||"").trim();if(r)parts.push(s.name+"\n"+r)}
  if(!parts.length){toast("Aucune appréciation à copier.");return}
  try{await navigator.clipboard.writeText(parts.join("\n\n"));toast(parts.length+" appréciation"+(parts.length>1?"s":"")+" copiée"+(parts.length>1?"s":"")+".")}catch{toast("Copie impossible sur cet appareil.")}
 },
 "bilan-copy-step"(){copyStep.open()},
 async "bilan-copy"(target){
  const b=bilanOf(cls(),bilanTri()),text=target==="class"?b.classRemark:b.remarks[target]||"";
  if(!text.trim()){toast("Rien à copier.");return}
  try{await navigator.clipboard.writeText(text);toast("Appréciation copiée.")}catch{toast("Copie impossible : sélectionne le texte puis copie-le.")}
 },
 admin(){modal("Mode admin",field("Code admin","fadmin","","password",'inputmode="numeric" autocomplete="off"'),()=>{if(input("fadmin")!==ADMIN_CODE){toast("Code incorrect.");const f=$("fadmin");if(f){f.value="";f.focus()}return}close();adminPanel()},{saveLabel:"Valider"})},
 "import-json"(){flushSave();location.href="../#sauvegarde"},
 "import-csv"(){$("csv-import").click()}
};
function classForm(old){modal(old?"Renommer la classe":"Nouvelle classe",field("Classe (ex. 4B, 2A, 1GHI)","fname",old?.name),()=>{const name=input("fname");if(!name){toast("Indique le nom de la classe.");return}if(old)old.name=name;else data.classes.push({id:uid(),name,level:"",description:"",archived:false,students:[],folders:[],tables:[]});save();close();render()})}
function studentForm(s){const c=cls();modal(s?"Modifier l’élève":"Ajouter un élève",field("Nom et prénom","fname",s?.name)+'<label class="field">Sexe (pour équilibrer les groupes)<select id="fsex"><option value="">Non renseigné</option><option value="F"'+(s?.sex==="F"?" selected":"")+'>Fille</option><option value="M"'+(s?.sex==="M"?" selected":"")+'>Garçon</option></select></label>',()=>{const name=input("fname"),sex=input("fsex")||null;if(!name){toast("Indique le nom de l’élève.");return}if(s){s.name=name;s.sex=sex}else c.students.push({id:uid(),name,sex});save();close();render()})}
function newGroup(ids){const t=tab();t.groups.forEach(g=>{g.studentIds=g.studentIds.filter(sid=>!ids.includes(sid))});t.groups.push({id:uid(),name:nextGroupName(t),color:groupColors[t.groups.length%groupColors.length],studentIds:ids,comment:""});terrainSelection.clear();save();render()}
function observableForm(o){
 const t=tab();
 const scope='<label class="field">Évaluation<select id="fscope"><option value="individual"'+(o&&observableScope(o)==="collective"?"":" selected")+'>Par élève</option><option value="collective"'+(o&&observableScope(o)==="collective"?" selected":"")+'>Par groupe</option></select></label>';
 const fields=o?descriptorFields(o):[1,2,3,4].map(n=>field("Degré de maîtrise "+n,"fdesc"+n)).join("");
 modal(o?"Modifier les critères":"Créer une compétence",field("Compétence","fname",o?.name||"")+referenceSelect(o?.refLevel,"freflevel")+scope+'<div class="modal-tools"><strong>Critères par degré de maîtrise</strong>'+btn("Proposer des critères","prefill-descriptors","small")+'</div><p class="muted small-text">Propositions modifiables. N1 et N2 désignent le collège, N3 et N4 le lycée. Les degrés 1 à 4 évaluent la maîtrise.</p>'+fields+(o?'<div class="modal-tools">'+btn("Supprimer cette compétence","delete-observable:"+o.id,"danger small")+'</div>':""),()=>{
  const name=input("fname");if(!name){toast("Indique le nom de la compétence.");return}
  const scopeValue=input("fscope"),refLevel=input("freflevel");let descriptors=[1,2,3,4].map(n=>input("fdesc"+n));
  const defaults=expectedDescriptors(name,o?.apsa||t.name,refLevel);
  descriptors=descriptors.map((v,i)=>!v||isGeneratedDescriptor(v)?defaults[i]:v);
  if(o){o.name=name;o.scope=scopeValue;o.descriptors=descriptors;o.refLevel=refLevel}
  else t.observables.push({id:uid(),name,scope:scopeValue,descriptors,refLevel});
  save();close();render();
 },{wide:true});
}
document.addEventListener("click",e=>{
 const el=e.target.closest("[data-action]");if(!el)return;
 const [act,...args]=el.dataset.action.split(":");
 const fn=actions[act];if(fn)fn(...args,el);
});

/* ---------- Imports ---------- */
function parseCSV(text,delimiter){
let rows=[],row=[],cell="",quoted=false;
text=text.replace(/^\uFEFF/,"");
for(let i=0;i<text.length;i++){let ch=text[i];if(quoted){if(ch==='"'&&text[i+1]==='"'){cell+='"';i++}else if(ch==='"')quoted=false;else cell+=ch}else if(ch==='"')quoted=true;else if(ch===delimiter){row.push(cell);cell=""}else if(ch==="\n"||ch==="\r"){if(ch==="\r"&&text[i+1]==="\n")i++;row.push(cell);if(row.some(v=>v.trim()))rows.push(row);row=[];cell=""}else cell+=ch}
row.push(cell);if(row.some(v=>v.trim()))rows.push(row);return rows;
}
function readStudentsCSV(text){
 const first=text.replace(/^﻿/,"").split(/\r?\n/)[0]||"";
 const delimiter=[";",",","\t"].sort((a,b)=>first.split(b).length-first.split(a).length)[0];
 const rows=parseCSV(text,delimiter);if(!rows.length)throw Error("Le fichier est vide.");
 const headers=rows[0].map(v=>v.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,""));
 const firstIdx=headers.findIndex(h=>/^prenoms?$/.test(h));
 let idx=headers.findIndex(h=>/^(eleves?|noms?( et prenoms?)?|nom complet|nom prenom|nom de famille|student|name)$/.test(h));
 if(idx<0)idx=headers.findIndex(h=>h.includes("eleve")||(h.includes("nom")&&!/^prenom/.test(h)));
 const sexIdx=headers.findIndex(h=>/^(sexe|sex|genre)$/.test(h));
 const start=idx>=0||firstIdx>=0?1:0;
 const separate=idx>=0&&firstIdx>=0&&idx!==firstIdx;
 if(idx<0)idx=firstIdx>=0?firstIdx:0;
 const seen=new Set();
 return rows.slice(start).map(r=>{
  const name=((r[idx]||"")+(separate?" "+(r[firstIdx]||""):"")).replace(/\s+/g," ").trim();
  const sexRaw=(r[sexIdx]||"").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"");
  return {name,sex:/^(masculin|male|m|garcon|g)$/.test(sexRaw)?"M":/^(feminin|female|f|fille)$/.test(sexRaw)?"F":null};
 }).filter(s=>{const key=s.name.toLocaleLowerCase("fr");if(!key||seen.has(key)||/^eleves?$/i.test(s.name))return false;seen.add(key);return true});
}
/* Excel enregistre souvent ses CSV en Windows-1252 : sans ce repli, les accents seraient cassés. */
async function readTextFile(file){
 const buffer=await file.arrayBuffer();
 try{return new TextDecoder("utf-8",{fatal:true}).decode(buffer)}catch{return new TextDecoder("windows-1252").decode(buffer)}
}
$("csv-import").addEventListener("change",async e=>{
 const file=e.target.files?.[0];if(!file)return;
 try{
  const c=cls();if(!c)throw Error("Ouvre d’abord une classe.");
  const names=readStudentsCSV(await readTextFile(file));
  if(!names.length)throw Error("Aucun élève trouvé dans ce fichier.");
  const existing=new Set(c.students.map(s=>s.name.trim().toLocaleLowerCase("fr"))),fresh=names.filter(n=>!existing.has(n.name.toLocaleLowerCase("fr")));
  if(fresh.length&&!confirm("Importer "+plural(fresh.length,"élève")+" dans "+c.name+" ?\n"+plural(names.length-fresh.length,"doublon")+" ignoré(s).\nSeuls le nom, le prénom et le sexe sont conservés.\n\nExemple : "+fresh[0].name))return;
  fresh.forEach(st=>c.students.push({id:uid(),name:st.name,sex:st.sex}));
  names.forEach(st=>{const match=c.students.find(x=>x.name.toLocaleLowerCase("fr")===st.name.toLocaleLowerCase("fr"));if(match&&st.sex)match.sex=st.sex});
  save();render();toast(plural(fresh.length,"élève")+" "+(fresh.length>1?"importés":"importé")+" dans "+c.name+".");
 }catch(err){alert("Import impossible : "+err.message)}
 e.target.value="";
});
$("import").addEventListener("change",async e=>{
 const file=e.target.files?.[0];if(!file)return;
 try{
  const parsed=JSON.parse(await file.text());
  if(!Array.isArray(parsed.classes))throw Error("ce fichier n’est pas une sauvegarde du classeur.");
  if(confirm("Remplacer le classeur actuel par cette sauvegarde ("+plural(parsed.classes.length,"classe")+") ?")){
   const previous=data;data=normalize(parsed);
   if(save()){view={page:"classes",classId:null,tableId:null};render();toast("Sauvegarde restaurée.")}
   else{data=previous;save();render()}
  }
 }catch(err){alert("Restauration impossible : "+err.message)}
 e.target.value="";
});

/* ---------- Démarrage ---------- */
navigator.storage?.persist?.().catch(()=>{});

render();
if(loadProblem)alert("Le classeur enregistré n’a pas pu être lu. Une copie est conservée sur cet appareil : restaure ta dernière sauvegarde.");
})();

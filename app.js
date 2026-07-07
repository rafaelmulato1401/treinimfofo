// =========================================================
// ESTADO
// =========================================================
const appState = {
  role: null,          // 'coach' | 'athlete'
  weekday: (new Date()).getDay(), // 0=Domingo ... 6=Sábado
  currentAlunoId: null,
  currentAlunoName: null,
  plan: [],            // exercícios do dia da semana atual
  customExercises: [], // biblioteca criada pelos usuários
  alunos: [],          // lista de alunos cadastrados
};
let selectedExercise = null;
let selectedFile = null;
let activeGifTab = 'url';
let activeGroupFilter = 'Todos';
let unsubscribePlanListener = null;
let unsubscribeAlunosListener = null;
let firebaseReady = false;
let db = null;
let storage = null;

const WEEKDAYS_FULL = ['DOMINGO','SEGUNDA-FEIRA','TERÇA-FEIRA','QUARTA-FEIRA','QUINTA-FEIRA','SEXTA-FEIRA','SÁBADO'];

// fallback local (usado somente se o Firebase não estiver configurado)
const localPlans = {};   // key: `${alunoId}_${weekday}`
let localAlunos = [];

// =========================================================
// INIT
// =========================================================
function initFirebase(){
  const isPlaceholder = !firebaseConfig.apiKey || firebaseConfig.apiKey === "SUA_API_KEY";
  if(isPlaceholder){
    firebaseReady = false;
    document.getElementById('config-warning').classList.remove('hidden');
    return;
  }
  try{
    firebase.initializeApp(firebaseConfig);
    db = firebase.firestore();
    storage = firebase.storage();
    firebaseReady = true;
  }catch(e){
    console.error('Erro ao iniciar Firebase', e);
    firebaseReady = false;
    document.getElementById('config-warning').classList.remove('hidden');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  initFirebase();
  buildGroupChips();

  document.getElementById('new-ex-url').addEventListener('input', (e)=>{
    const url = e.target.value.trim();
    const prev = document.getElementById('url-preview');
    if(url){ prev.src = url; prev.classList.remove('hidden'); }
    else { prev.classList.add('hidden'); }
  });

  const savedRole = localStorage.getItem('treino_role');
  if(savedRole){
    appState.role = savedRole;
    showMain();
  }

  if(firebaseReady){
    loadCustomExercises();
    loadAlunos();
  }
});

// =========================================================
// ROLE
// =========================================================
function selectRole(role){
  appState.role = role;
  localStorage.setItem('treino_role', role);
  showMain();
}
function switchRole(){
  localStorage.removeItem('treino_role');
  if(unsubscribePlanListener) unsubscribePlanListener();
  document.getElementById('screen-main').classList.add('hidden');
  document.getElementById('screen-role').classList.remove('hidden');
}
function showMain(){
  document.getElementById('screen-role').classList.add('hidden');
  document.getElementById('screen-main').classList.remove('hidden');
  const isCoach = appState.role === 'coach';
  document.getElementById('header-title').textContent = isCoach ? 'Montar Treino' : 'Meu Treino';
  document.getElementById('header-sub').textContent = isCoach ? 'PAINEL DA TREINADORA' : 'SEMANA DE TREINO';
  document.getElementById('role-pill-btn').textContent = isCoach ? 'treinadora' : 'aluno';
  document.getElementById('sb-label').textContent = isCoach ? 'MONTANDO TREINO PARA' : 'TREINO DE';

  // restaura aluno salvo
  const savedAlunoKey = isCoach ? 'treino_coach_aluno_id' : 'treino_meu_aluno_id';
  const savedAlunoName = isCoach ? 'treino_coach_aluno_nome' : 'treino_meu_aluno_nome';
  const savedId = localStorage.getItem(savedAlunoKey);
  const savedName = localStorage.getItem(savedAlunoName);
  if(savedId && savedName){
    appState.currentAlunoId = savedId;
    appState.currentAlunoName = savedName;
  }

  updateStudentBarUI();
  updateWeekdayNavUI();

  if(!firebaseReady){
    appState.alunos = localAlunos;
    if(!appState.currentAlunoId){
      renderNoStudentPrompt();
    } else {
      loadPlan();
    }
    return;
  }

  if(appState.currentAlunoId){
    loadPlan();
  } else {
    renderNoStudentPrompt();
  }
}

function renderNoStudentPrompt(){
  const isCoach = appState.role === 'coach';
  document.getElementById('content').innerHTML = `
    <div class="empty-state">
      <div class="big-emoji">👤</div>
      <strong>${isCoach ? 'Escolha um aluno' : 'Quem é você?'}</strong>
      ${isCoach ? 'Selecione ou cadastre um aluno para montar o treino.' : 'Selecione seu perfil na lista de alunos.'}
    </div>
    <button class="add-fab" onclick="openStudentPicker()">＋ ${isCoach ? 'Selecionar / cadastrar aluno' : 'Selecionar meu perfil'}</button>
  `;
}

// =========================================================
// WEEKDAY NAV (sem datas — treino recorrente semanal)
// =========================================================
function updateWeekdayNavUI(){
  document.getElementById('dn-date').textContent = WEEKDAYS_FULL[appState.weekday];
  const today = new Date().getDay();
  document.getElementById('dn-today').textContent = (appState.weekday === today) ? 'HOJE' : '';
}
function changeWeekday(delta){
  appState.weekday = (appState.weekday + delta + 7) % 7;
  updateWeekdayNavUI();
  loadPlan();
}

// =========================================================
// ALUNOS
// =========================================================
function loadAlunos(){
  unsubscribeAlunosListener = db.collection('alunos').orderBy('name').onSnapshot(snap => {
    appState.alunos = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    if(document.getElementById('modal-students').classList.contains('open')) renderStudentsList();
  }, err => console.error(err));
}

function openStudentPicker(){
  const isCoach = appState.role === 'coach';
  document.getElementById('students-modal-title').textContent = isCoach ? 'Montar treino para quem?' : 'Quem é você?';
  document.getElementById('new-aluno-field').classList.toggle('hidden', !isCoach);
  document.getElementById('new-aluno-name').value = '';
  renderStudentsList();
  openModal('modal-students');
}

function renderStudentsList(){
  const el = document.getElementById('students-list');
  const list = firebaseReady ? appState.alunos : localAlunos;
  if(list.length === 0){
    el.innerHTML = `<div class="empty-state" style="padding:20px 10px;"><strong>Nenhum aluno cadastrado</strong>${appState.role === 'coach' ? 'Cadastre o primeiro aluno abaixo.' : 'Peça para a treinadora cadastrar seu perfil.'}</div>`;
    return;
  }
  el.innerHTML = list.map(a => `
    <div class="pick-item">
      <div class="student-avatar" style="width:46px;height:46px;">👤</div>
      <div class="pi-info">
        <div class="pi-name">${escapeHtml(a.name)}</div>
      </div>
      <button onclick='chooseAluno("${a.id}", ${JSON.stringify(a.name)})'>Selecionar</button>
    </div>
  `).join('');
}

function chooseAluno(id, name){
  appState.currentAlunoId = id;
  appState.currentAlunoName = name;
  const isCoach = appState.role === 'coach';
  localStorage.setItem(isCoach ? 'treino_coach_aluno_id' : 'treino_meu_aluno_id', id);
  localStorage.setItem(isCoach ? 'treino_coach_aluno_nome' : 'treino_meu_aluno_nome', name);
  updateStudentBarUI();
  closeModal('modal-students');
  loadPlan();
}

function createAluno(){
  const name = document.getElementById('new-aluno-name').value.trim();
  if(!name){ showToast('Digite o nome do aluno'); return; }

  if(!firebaseReady){
    const id = 'local_' + Date.now();
    localAlunos.push({id, name});
    chooseAluno(id, name);
    showToast('Aluno cadastrado ✓');
    return;
  }

  db.collection('alunos').add({ name, createdAt: firebase.firestore.FieldValue.serverTimestamp() })
    .then(docRef => {
      chooseAluno(docRef.id, name);
      showToast('Aluno cadastrado ✓');
    })
    .catch(err => {
      console.error(err);
      showToast('Erro ao cadastrar aluno');
    });
}

function updateStudentBarUI(){
  document.getElementById('sb-name').textContent = appState.currentAlunoName || 'Selecionar aluno';
}

// =========================================================
// LOAD / SAVE PLAN (por aluno + dia da semana)
// =========================================================
function planKey(){
  return `${appState.currentAlunoId}_${appState.weekday}`;
}

function loadPlan(){
  if(unsubscribePlanListener) unsubscribePlanListener();
  if(!appState.currentAlunoId){
    renderNoStudentPrompt();
    return;
  }
  const key = planKey();

  if(!firebaseReady){
    appState.plan = localPlans[key] ? JSON.parse(JSON.stringify(localPlans[key])) : [];
    render();
    return;
  }

  document.getElementById('content').innerHTML = `<div class="empty-state"><div class="big-emoji">⏳</div><strong>Carregando...</strong></div>`;
  unsubscribePlanListener = db.collection('planos').doc(key).onSnapshot(doc=>{
    appState.plan = doc.exists ? (doc.data().exercises || []) : [];
    render();
  }, err=>{
    console.error(err);
    showToast('Erro ao carregar o treino');
  });
}

function savePlan(){
  if(!appState.currentAlunoId) return;
  const key = planKey();
  if(!firebaseReady){
    localPlans[key] = JSON.parse(JSON.stringify(appState.plan));
    render();
    return;
  }
  db.collection('planos').doc(key).set({
    alunoId: appState.currentAlunoId,
    weekday: appState.weekday,
    exercises: appState.plan,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
  }, {merge:true}).catch(err=>{
    console.error(err);
    showToast('Erro ao salvar');
  });
}

// =========================================================
// RENDER
// =========================================================
function render(){
  if(!appState.currentAlunoId){ renderNoStudentPrompt(); return; }
  if(appState.role === 'coach') renderCoach();
  else renderAthlete();
}

function renderCoach(){
  const el = document.getElementById('content');
  let html = '';
  if(appState.plan.length === 0){
    html += `<div class="empty-state"><div class="big-emoji">🗓️</div><strong>Nenhum exercício ainda</strong>Toque abaixo para montar o treino deste dia.</div>`;
  } else {
    appState.plan.forEach(ex => {
      html += `
        <div class="plan-row">
          <img class="plan-thumb" src="${ex.frames[0]}" loading="lazy">
          <div class="plan-info">
            <div class="nm">${escapeHtml(ex.name)}</div>
            <div class="sr">${ex.sets}x${escapeHtml(String(ex.reps))} · ${escapeHtml(ex.group)}</div>
          </div>
          <button class="plan-del" onclick="removeExercise('${ex.key}')">✕</button>
        </div>`;
    });
  }
  html += `<button class="add-fab" onclick="openModalPicker()">＋ Adicionar exercício</button>`;
  el.innerHTML = html;
}

function renderAthlete(){
  const el = document.getElementById('content');
  if(appState.plan.length === 0){
    el.innerHTML = `<div class="empty-state"><div class="big-emoji">😴</div><strong>Sem treino para este dia</strong>Peça para sua treinadora montar o treino deste dia da semana.</div>`;
    return;
  }
  let html = '';
  appState.plan.forEach(ex => {
    const frames = ex.frames || [];
    let media = '';
    if(frames.length > 1){
      media = `<img src="${frames[0]}" class="pose-a" loading="lazy"><img src="${frames[1]}" class="pose-b" loading="lazy">`;
    } else if(frames.length === 1){
      media = `<img src="${frames[0]}" class="pose-single" loading="lazy">`;
    }
    html += `
      <div class="ex-card ${ex.done ? 'done' : ''}">
        <div class="ex-media">
          ${media}
          <div class="ex-tag">${escapeHtml(ex.group)}</div>
        </div>
        <div class="ex-body">
          <div class="ex-name">${escapeHtml(ex.name)}</div>
          <div class="ex-meta">
            <div><span class="num">${ex.sets}</span><span class="lbl">séries</span></div>
            <div><span class="num">${escapeHtml(String(ex.reps))}</span><span class="lbl">repetições</span></div>
          </div>
          ${ex.obs ? `<div class="ex-obs">${escapeHtml(ex.obs)}</div>` : ''}
          <button class="done-toggle ${ex.done ? 'checked' : ''}" onclick="toggleDone('${ex.key}')">
            ${ex.done ? '✓ Concluído' : 'Marcar como concluído'}
          </button>
        </div>
      </div>`;
  });
  el.innerHTML = html;
}

function escapeHtml(str){
  const d = document.createElement('div');
  d.textContent = str ?? '';
  return d.innerHTML;
}

// =========================================================
// PLAN MUTATIONS
// =========================================================
function removeExercise(key){
  appState.plan = appState.plan.filter(e => e.key !== key);
  savePlan();
}
function toggleDone(key){
  appState.plan = appState.plan.map(e => e.key === key ? {...e, done: !e.done} : e);
  savePlan();
}

// =========================================================
// MODALS
// =========================================================
function openModal(id){ document.getElementById(id).classList.add('open'); }
function closeModal(id){ document.getElementById(id).classList.remove('open'); }

function openModalPicker(){
  if(!appState.currentAlunoId){ showToast('Selecione um aluno primeiro'); openStudentPicker(); return; }
  activeGroupFilter = 'Todos';
  document.getElementById('pick-search').value = '';
  buildGroupChips();
  renderPickList();
  openModal('modal-picker');
}

function allExercises(){
  const builtin = BUILTIN_EXERCISES.map(e => ({...e, isCustom:false}));
  return builtin.concat(appState.customExercises);
}

function buildGroupChips(){
  const groups = ['Todos', ...new Set(allExercises().map(e=>e.group))];
  const el = document.getElementById('pick-groups');
  el.innerHTML = groups.map(g =>
    `<button class="chip ${g===activeGroupFilter?'active':''}" onclick="setGroupFilter('${g.replace(/'/g,"\\'")}')">${g}</button>`
  ).join('');
}
function setGroupFilter(g){
  activeGroupFilter = g;
  buildGroupChips();
  renderPickList();
}

function renderPickList(){
  const term = document.getElementById('pick-search').value.trim().toLowerCase();
  let list = allExercises();
  if(activeGroupFilter !== 'Todos') list = list.filter(e => e.group === activeGroupFilter);
  if(term) list = list.filter(e => e.name.toLowerCase().includes(term));
  list.sort((a,b)=> a.name.localeCompare(b.name, 'pt-BR'));

  const el = document.getElementById('pick-list');
  if(list.length === 0){
    el.innerHTML = `<div class="empty-state" style="padding:30px 10px;"><strong>Nada encontrado</strong>Tente outro termo ou crie um novo movimento.</div>`;
    return;
  }
  el.innerHTML = list.map(e => `
    <div class="pick-item">
      <img src="${e.frames[0]}" loading="lazy">
      <div class="pi-info">
        <div class="pi-name">${escapeHtml(e.name)}${e.isCustom ? '<span class="custom-badge">SEU</span>' : ''}</div>
        <div class="pi-group">${escapeHtml(e.group)}</div>
      </div>
      <button onclick='openSetsModal(${JSON.stringify(e).replace(/'/g,"&apos;")})'>Add</button>
    </div>
  `).join('');
}

function openSetsModal(exercise){
  selectedExercise = exercise;
  closeModal('modal-picker');
  closeModal('modal-create');
  document.getElementById('sets-ex-name').textContent = exercise.name;
  document.getElementById('input-sets').value = 3;
  document.getElementById('input-reps').value = 12;
  document.getElementById('input-obs').value = '';
  openModal('modal-sets');
}

function confirmAddExercise(){
  if(!selectedExercise) return;
  const sets = parseInt(document.getElementById('input-sets').value) || 1;
  const reps = document.getElementById('input-reps').value.trim() || '10';
  const obs = document.getElementById('input-obs').value.trim();

  appState.plan.push({
    key: Date.now().toString(36) + Math.random().toString(36).slice(2,7),
    name: selectedExercise.name,
    group: selectedExercise.group,
    frames: selectedExercise.frames,
    sets, reps, obs,
    done: false,
    isCustom: !!selectedExercise.isCustom
  });
  savePlan();
  closeModal('modal-sets');
  showToast('Exercício adicionado ao treino ✓');
}

// =========================================================
// CRIAR NOVO EXERCÍCIO (com GIF por URL ou upload)
// =========================================================
function openCreateExercise(){
  document.getElementById('new-ex-name').value = '';
  document.getElementById('new-ex-group').value = 'Peito';
  document.getElementById('new-ex-url').value = '';
  document.getElementById('url-preview').classList.add('hidden');
  document.getElementById('new-ex-file').value = '';
  document.getElementById('file-preview').classList.add('hidden');
  document.getElementById('upload-zone-text').textContent = '📁 Toque para escolher um GIF';
  document.getElementById('upload-progress-wrap').classList.add('hidden');
  document.getElementById('upload-progress-bar').style.width = '0%';
  selectedFile = null;
  setGifTab('url');
  closeModal('modal-picker');
  openModal('modal-create');
}

function setGifTab(tab){
  activeGifTab = tab;
  document.getElementById('tab-url-btn').classList.toggle('active', tab==='url');
  document.getElementById('tab-upload-btn').classList.toggle('active', tab==='upload');
  document.getElementById('gif-tab-url').classList.toggle('hidden', tab!=='url');
  document.getElementById('gif-tab-upload').classList.toggle('hidden', tab!=='upload');
}

function handleFileSelect(event){
  const file = event.target.files[0];
  if(!file) return;
  selectedFile = file;
  document.getElementById('upload-zone-text').textContent = file.name;
  const reader = new FileReader();
  reader.onload = e => {
    const prev = document.getElementById('file-preview');
    prev.src = e.target.result;
    prev.classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

async function saveNewExercise(){
  const name = document.getElementById('new-ex-name').value.trim();
  const group = document.getElementById('new-ex-group').value;
  if(!name){ showToast('Digite o nome do exercício'); return; }

  const btn = document.getElementById('btn-save-new-ex');
  const originalLabel = btn.textContent;

  let gifUrl = null;

  if(activeGifTab === 'url'){
    gifUrl = document.getElementById('new-ex-url').value.trim();
    if(!gifUrl){ showToast('Cole o link do GIF ou troque para upload'); return; }
  } else {
    if(!selectedFile){ showToast('Escolha um arquivo GIF'); return; }
    if(!firebaseReady){ showToast('Configure o Firebase para poder subir arquivos'); return; }
    try{
      btn.innerHTML = `<span class="spinner"></span> Enviando...`;
      btn.disabled = true;
      document.getElementById('upload-progress-wrap').classList.remove('hidden');
      gifUrl = await uploadGifFile(selectedFile);
    }catch(e){
      console.error(e);
      showToast('Erro ao enviar o arquivo');
      btn.textContent = originalLabel;
      btn.disabled = false;
      return;
    }
  }

  const newExercise = {
    name, group,
    frames: [gifUrl],
    isCustom: true,
    createdAt: firebaseReady ? firebase.firestore.FieldValue.serverTimestamp() : Date.now()
  };

  if(firebaseReady){
    try{
      const docRef = await db.collection('exerciciosCustom').add(newExercise);
      newExercise.id = docRef.id;
    }catch(e){
      console.error(e);
      showToast('Erro ao salvar o exercício');
      btn.textContent = originalLabel;
      btn.disabled = false;
      return;
    }
  } else {
    newExercise.id = 'local_' + Date.now();
    appState.customExercises.push(newExercise);
  }

  btn.textContent = originalLabel;
  btn.disabled = false;
  closeModal('modal-create');
  showToast('Movimento criado ✓');
  openSetsModal(newExercise);
}

function uploadGifFile(file){
  return new Promise((resolve, reject) => {
    const path = `gifs/${Date.now()}_${file.name}`;
    const ref = storage.ref().child(path);
    const task = ref.put(file);
    task.on('state_changed', snap => {
      const pct = (snap.bytesTransferred / snap.totalBytes) * 100;
      document.getElementById('upload-progress-bar').style.width = pct + '%';
    }, err => reject(err), async () => {
      const url = await task.snapshot.ref.getDownloadURL();
      resolve(url);
    });
  });
}

function loadCustomExercises(){
  db.collection('exerciciosCustom').orderBy('name').onSnapshot(snap => {
    appState.customExercises = snap.docs.map(d => ({ id:d.id, isCustom:true, ...d.data() }));
    if(document.getElementById('modal-picker').classList.contains('open')){
      buildGroupChips();
      renderPickList();
    }
  }, err => console.error(err));
}

// =========================================================
// TOAST
// =========================================================
let toastTimer = null;
function showToast(msg){
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=> t.classList.remove('show'), 2200);
}

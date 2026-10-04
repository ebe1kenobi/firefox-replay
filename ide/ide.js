'use strict';

const $ = id => document.getElementById(id);

const DEFAULT_SETTINGS = {
  timeout: 30000,
  autoWait: true,
  postActionDelay: 150,
  ajaxTimeout: 30000,
  ajaxIgnore: '',
  highlight: true,
  maxLoops: 1000,
  speed: 0,
  shotOnFailure: true
};

let library;
let project;
let settings;
let batchRunning = false;
let batchStop = false;
let currentTestId;
let sel = { anchor: -1, focus: -1 };
const statuses = new Map();
let rec = null;
let pickTabId = null;
let runTabId = null;
let runningTestId = null;
let clipboard = null;
const undoStack = [];

// =====================================================================
// Persistance
// =====================================================================

let saveTimer = 0;
let saveSeq = 0;
function flushSave() {
  clearTimeout(saveTimer);
  saveTimer = 0;
  // savedBy permet à une autre instance de l'outil de reconnaître un changement qui ne vient pas d'elle.
  browser.storage.local.set({
    library, currentProjectId: project.id, currentTestId, savedBy: PANEL_ID + ':' + (++saveSeq)
  });
}

function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, 250);
}

function onStorageChanged(changes, area) {
  if (area !== 'local') return;
  if (changes.settings && changes.settings.newValue) {
    settings = Object.assign({}, DEFAULT_SETTINGS, changes.settings.newValue);
    $('speed').value = settings.speed;
  }
  const by = changes.savedBy && String(changes.savedBy.newValue);
  if (!changes.library || !by || by.startsWith(PANEL_ID + ':')) return;
  if (busy() || rec) {
    setStatusText('Les projets ont été modifiés dans une autre fenêtre ; ils seront écrasés par celle-ci.', true);
    return;
  }
  library = FTProject.normalizeLibrary(changes.library.newValue);
  project = library.projects.find(p => p.id === project.id) || library.projects[0];
  if (!project.tests.some(t => t.id === currentTestId)) currentTestId = project.tests[0].id;
  statuses.clear();
  undoStack.length = 0;
  const n = currentTest().commands.length;
  if (sel.focus >= n) sel = n ? { anchor: n - 1, focus: n - 1 } : { anchor: -1, focus: -1 };
  renderTests();
  renderTable();
  renderEditor();
}

function saveSettings() {
  browser.storage.local.set({ settings });
}

async function load() {
  const r = await browser.storage.local.get(['library', 'project', 'settings', 'currentProjectId', 'currentTestId', 'ui']);
  settings = Object.assign({}, DEFAULT_SETTINGS, r.settings || {});
  if (r.ui) {
    navMode = r.ui.navMode === 'scenarios' ? 'scenarios' : 'projects';
    for (const id of r.ui.expanded || []) expanded.add(id);
  }
  // Les versions précédentes ne gardaient qu'un projet, sous la clé « project ».
  library = FTProject.normalizeLibrary(r.library || { projects: r.project ? [r.project] : [] });
  if (!r.library && r.project) {
    browser.storage.local.set({ library }).then(() => browser.storage.local.remove('project'));
  }
  project = library.projects.find(p => p.id === r.currentProjectId) || library.projects[0];
  currentTestId = r.currentTestId;
  if (!project.tests.some(t => t.id === currentTestId)) currentTestId = project.tests[0].id;
}

// =====================================================================
// Accès et sélection
// =====================================================================

const currentTest = () => project.tests.find(t => t.id === currentTestId) || project.tests[0];

function selRange() {
  if (sel.focus < 0) return null;
  const a = sel.anchor < 0 ? sel.focus : sel.anchor;
  return [Math.min(a, sel.focus), Math.max(a, sel.focus)];
}

function selectedCommand() {
  const t = currentTest();
  return sel.focus >= 0 && sel.focus < t.commands.length ? t.commands[sel.focus] : null;
}

function select(i, extend) {
  const n = currentTest().commands.length;
  if (!n) { sel = { anchor: -1, focus: -1 }; }
  else {
    i = Math.max(0, Math.min(n - 1, i));
    sel = extend && sel.anchor >= 0 ? { anchor: sel.anchor, focus: i } : { anchor: i, focus: i };
  }
  renderSelection();
  renderEditor();
  const tr = $('cmdBody').children[sel.focus];
  if (tr) tr.scrollIntoView({ block: 'nearest' });
}

const busy = () => engine.state !== 'idle' || batchRunning;

// =====================================================================
// Rendu
// =====================================================================

function setStatusText(text, isError) {
  const s = $('status');
  s.textContent = text;
  s.title = text;
  s.classList.toggle('error', !!isError);
}

function renderTests() {
  const s = $('testSelect');
  s.textContent = '';
  for (const t of project.tests) {
    const o = document.createElement('option');
    o.value = t.id;
    o.textContent = t.name + ' (' + t.commands.length + ')';
    s.appendChild(o);
  }
  s.value = currentTestId;
  $('projTitle').textContent = project.name;
  $('projTitle').title = project.name;
  $('baseUrl').value = project.url || '';
  document.title = 'Replay — ' + project.name;
  renderUrlOverride();
  renderNav();
}

// L'URL d'un scénario remplace celle de ses projets : on le signale sur le projet, sinon c'est un piège.
function renderUrlOverride() {
  const over = library.scenarios.filter(s => s.url && s.items.includes(project.id) && s.url !== project.url);
  const box = $('urlOverride');
  box.hidden = !over.length;
  box.textContent = over.map(s => 'Lancé par le scénario « ' + s.name + ' », ce projet utilise l\'URL du scénario : ' + s.url +
    ' (à modifier dans le scénario déplié, mode Scénarios).').join(' ');
}

const OPENERS = new Set(['if', 'while', 'times', 'forEach', 'do', 'elseIf', 'else']);
const CLOSERS = new Set(['end', 'elseIf', 'else', 'repeatIf']);

function statusClass(st) {
  return st ? 'st-' + st.state : '';
}

function renderTable() {
  const test = currentTest();
  const body = $('cmdBody');
  body.textContent = '';
  const st = statuses.get(test.id) || new Map();
  const range = selRange();
  let depth = 0;
  test.commands.forEach((c, i) => {
    const name = c.command || '';
    if (CLOSERS.has(name)) depth = Math.max(0, depth - 1);
    const tr = document.createElement('tr');
    tr.dataset.i = i;
    const disabled = name.startsWith('//');
    if (disabled) tr.classList.add('disabled');
    if (FTEngine.FLOW.has(name)) tr.classList.add('flow');
    if (c.breakpoint) tr.classList.add('breakpoint');
    if (range && i >= range[0] && i <= range[1]) tr.classList.add('selected');
    const s = st.get(i);
    if (s) tr.classList.add(statusClass(s));

    const tdBp = document.createElement('td');
    tdBp.className = 'bp';
    const tdNum = document.createElement('td');
    tdNum.className = 'num';
    tdNum.textContent = i + 1;
    const tdCmd = document.createElement('td');
    tdCmd.className = 'cmd';
    tdCmd.style.paddingLeft = (4 + depth * 12) + 'px';
    tdCmd.textContent = name;
    if (!disabled && name && !FT_COMMANDS[name]) tdCmd.classList.add('unknown');
    if (c.comment) {
      const sp = document.createElement('span');
      sp.className = 'comment';
      sp.textContent = '  // ' + c.comment;
      tdCmd.appendChild(sp);
    }
    const tdT = document.createElement('td');
    tdT.textContent = c.target;
    const tdV = document.createElement('td');
    tdV.textContent = c.value;
    tr.title = [c.comment, c.target, c.value, s && s.msg].filter(Boolean).join('\n');
    tr.append(tdBp, tdNum, tdCmd, tdT, tdV);
    body.appendChild(tr);
    if (OPENERS.has(name)) depth++;
  });
  $('emptyHint').hidden = test.commands.length > 0;
  const opt = $('testSelect').options[$('testSelect').selectedIndex];
  if (opt) opt.textContent = test.name + ' (' + test.commands.length + ')';
}

function renderSelection() {
  const range = selRange();
  for (const tr of $('cmdBody').children) {
    const i = Number(tr.dataset.i);
    tr.classList.toggle('selected', !!range && i >= range[0] && i <= range[1]);
  }
}

function updateRowStatus(testId, i) {
  if (testId !== currentTestId) return;
  const tr = $('cmdBody').children[i];
  if (!tr) return;
  for (const c of [...tr.classList]) if (c.startsWith('st-')) tr.classList.remove(c);
  const s = (statuses.get(testId) || new Map()).get(i);
  if (s) {
    tr.classList.add(statusClass(s));
    if (s.msg) tr.title = s.msg;
    if (s.state === 'running' || s.state === 'failed' || s.state === 'paused') tr.scrollIntoView({ block: 'nearest' });
  }
}

function renderEditor() {
  const c = selectedCommand();
  $('editor').classList.toggle('disabled', !c);
  const cmd = c || { command: '', target: '', value: '', comment: '', targets: [] };
  $('edCommand').value = cmd.command;
  $('edTarget').value = cmd.target;
  $('edValue').value = cmd.value;
  $('edComment').value = cmd.comment;
  fitTextarea($('edTarget'));
  fitTextarea($('edValue'));
  const ts = $('edTargets');
  ts.textContent = '';
  const head = document.createElement('option');
  head.value = '';
  head.textContent = cmd.targets.length ? 'Autres localisateurs (' + cmd.targets.length + ')…' : 'Aucun autre localisateur';
  ts.appendChild(head);
  for (const [loc, kind] of cmd.targets) {
    const o = document.createElement('option');
    o.value = loc;
    o.textContent = '[' + kind + '] ' + loc;
    ts.appendChild(o);
  }
  ts.disabled = !cmd.targets.length;
  renderHelp();
}

function renderHelp() {
  const name = $('edCommand').value.replace(/^\/\//, '');
  const meta = FT_COMMANDS[name];
  $('edHelp').textContent = meta ? meta.d : (name ? 'Commande inconnue.' : '');
  $('edTargetHelp').textContent = meta && meta.t ? meta.t : '';
  $('edValueHelp').textContent = meta && meta.v ? meta.v : '';
}

function fitTextarea(ta) {
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight + 2, 200) + 'px';
}

function updateControls() {
  const st = engine.state;
  const idle = !busy();
  $('btnRun').disabled = !idle;
  $('btnRunFrom').disabled = !idle;
  $('btnRunAll').disabled = !idle;
  $('btnExecOne').disabled = !idle;
  $('btnRecord').disabled = !idle;
  $('btnPause').disabled = idle;
  $('btnPause').textContent = st === 'paused' ? '▶ Reprendre' : '❚❚ Pause';
  $('btnStep').disabled = st !== 'paused';
  $('btnStop').disabled = idle;
  const rb = $('btnRecord');
  rb.classList.toggle('on', !!rec);
  rb.textContent = rec ? '■ Arrêter l\'enregistrement' : '● Enregistrer';
}

// =====================================================================
// Journal
// =====================================================================

// Identifie cette fenêtre auprès de sa fenêtre de journal.
const PANEL_ID = FTProject.uid();
const logEntries = [];
let logSeq = 0;
let logWindowId = null;

function log(level, text) {
  const e = { n: logSeq++, level, time: new Date().toLocaleTimeString(), text };
  logEntries.push(e);
  if (logEntries.length > FTLog.MAX) logEntries.shift();
  if (logWindowId == null) FTLog.append($('log'), e);
  else browser.runtime.sendMessage({ type: 'logEntry', src: PANEL_ID, entry: e }).catch(() => {});
  if (level === 'error') setStatusText(text, true);
}

function clearLog() {
  logEntries.length = 0;
  $('log').textContent = '';
  if (logWindowId != null) browser.runtime.sendMessage({ type: 'logCleared', src: PANEL_ID }).catch(() => {});
}

function showVars() {
  const v = engine.vars || {};
  log('var', Object.keys(v).length ? 'Variables : ' + JSON.stringify(v, null, 2) : 'Aucune variable.');
}

function setLogDetached(detached) {
  $('logbox').classList.toggle('detached', detached);
  $('logTitle').textContent = detached ? 'Journal (fenêtre séparée)' : 'Journal';
  $('btnDetach').textContent = detached ? 'Rattacher' : 'Détacher';
  if (!detached) FTLog.fill($('log'), logEntries);
}

async function toggleLogWindow() {
  if (logWindowId != null) {
    browser.windows.remove(logWindowId).catch(() => {});
    return;
  }
  const w = await browser.windows.create({
    type: 'popup',
    url: browser.runtime.getURL('ide/log.html') + '?src=' + PANEL_ID,
    width: 800,
    height: 500
  });
  logWindowId = w.id;
  setLogDetached(true);
}

// =====================================================================
// Modifications (avec annulation)
// =====================================================================

function pushUndo() {
  const t = currentTest();
  undoStack.push({ testId: t.id, commands: JSON.stringify(t.commands), sel: Object.assign({}, sel) });
  if (undoStack.length > 100) undoStack.shift();
}

function undo() {
  const u = undoStack.pop();
  if (!u) { setStatusText('Rien à annuler.'); return; }
  const t = project.tests.find(x => x.id === u.testId);
  if (!t) return;
  t.commands = JSON.parse(u.commands);
  currentTestId = t.id;
  sel = u.sel;
  statuses.delete(t.id);
  save();
  renderTests();
  renderTable();
  renderEditor();
}

// Modification de structure (insertion, suppression, déplacement).
function mutate(fn) {
  if (busy()) { setStatusText('Impossible pendant l\'exécution.', true); return false; }
  pushUndo();
  const t = currentTest();
  fn(t);
  statuses.delete(t.id);
  save();
  renderTable();
  renderSelection();
  renderEditor();
  return true;
}

function insertCommands(cmds, at) {
  mutate(t => {
    t.commands.splice(at, 0, ...cmds);
    sel = { anchor: at, focus: at + cmds.length - 1 };
  });
}

function insertionIndex() {
  const r = selRange();
  return r ? r[1] + 1 : currentTest().commands.length;
}

function deleteSelection() {
  const r = selRange();
  if (!r) return;
  mutate(t => {
    t.commands.splice(r[0], r[1] - r[0] + 1);
    const n = t.commands.length;
    sel = n ? { anchor: Math.min(r[0], n - 1), focus: Math.min(r[0], n - 1) } : { anchor: -1, focus: -1 };
  });
}

function moveSelection(delta) {
  const r = selRange();
  if (!r) return;
  const t = currentTest();
  if ((delta < 0 && r[0] === 0) || (delta > 0 && r[1] >= t.commands.length - 1)) return;
  mutate(t2 => {
    const block = t2.commands.splice(r[0], r[1] - r[0] + 1);
    t2.commands.splice(r[0] + delta, 0, ...block);
    sel = { anchor: sel.anchor + delta, focus: sel.focus + delta };
  });
}

function copySelection(cut) {
  const r = selRange();
  if (!r) return;
  clipboard = JSON.stringify(currentTest().commands.slice(r[0], r[1] + 1));
  navigator.clipboard.writeText(clipboard).catch(() => {});
  if (cut) deleteSelection();
  setStatusText((r[1] - r[0] + 1) + ' commande(s) ' + (cut ? 'coupée(s)' : 'copiée(s)') + '.');
}

async function paste() {
  let text = clipboard;
  try {
    const sys = await navigator.clipboard.readText();
    if (sys && sys.trim().startsWith('[')) text = sys;
  } catch (e) { /* lecture du presse-papiers refusée */ }
  if (!text) return;
  let cmds;
  try { cmds = JSON.parse(text); } catch (e) { return; }
  if (!Array.isArray(cmds)) return;
  cmds = cmds.map(c => Object.assign(FTProject.normalizeCommand(c || {}), { id: FTProject.uid() }));
  insertCommands(cmds, insertionIndex());
}

// Édition des champs d'une commande (ne change pas les indices : permise en pause).
function editField(field, value) {
  const c = selectedCommand();
  if (!c) return;
  c[field] = value;
  if (field === 'command' || field === 'target' || field === 'value' || field === 'comment') {
    const tr = $('cmdBody').children[sel.focus];
    if (tr) {
      if (field === 'command') renderTable();
      else if (field === 'target') tr.children[3].textContent = value;
      else if (field === 'value') tr.children[4].textContent = value;
      else renderTable();
    }
  }
  save();
}

// =====================================================================
// Tests
// =====================================================================

async function ask(text, def, withInput) {
  const dlg = $('askDlg');
  const inp = $('askInput');
  const input = withInput !== false;
  $('askText').textContent = text;
  inp.hidden = !input;
  inp.value = def || '';
  dlg.returnValue = '';
  return new Promise(res => {
    dlg.onclose = () => res(dlg.returnValue === 'ok' ? (input ? inp.value : true) : null);
    dlg.showModal();
    if (input) inp.select();
  });
}
const confirmBox = text => ask(text, '', false);

function switchTest(id) {
  currentTestId = id;
  sel = { anchor: -1, focus: -1 };
  save();
  renderTests();
  renderTable();
  select(0);
}

async function addTest() {
  const name = await ask('Nom du nouveau test :', 'Test ' + (project.tests.length + 1));
  if (!name) return;
  const t = FTProject.newTest(name.trim());
  project.tests.push(t);
  if (project.suites[0]) project.suites[0].tests.push(t.id);
  switchTest(t.id);
}

async function renameTest() {
  const t = currentTest();
  const name = await ask('Nouveau nom du test :', t.name);
  if (!name) return;
  t.name = name.trim();
  save();
  renderTests();
}

function duplicateTest() {
  const t = currentTest();
  const c = FTProject.cloneTest(t);
  c.name = t.name + ' (copie)';
  project.tests.splice(project.tests.indexOf(t) + 1, 0, c);
  for (const s of project.suites) if (s.tests.includes(t.id)) s.tests.push(c.id);
  switchTest(c.id);
}

async function deleteTest() {
  if (busy()) return;
  const t = currentTest();
  if (!(await confirmBox('Supprimer le test « ' + t.name + ' » ?'))) return;
  project.tests = project.tests.filter(x => x.id !== t.id);
  for (const s of project.suites) s.tests = s.tests.filter(id => id !== t.id);
  if (!project.tests.length) project.tests.push(FTProject.newTest('Test 1'));
  switchTest(project.tests[0].id);
}

// =====================================================================
// Onglet cible
// =====================================================================

// La fenêtre de l'outil n'a pas d'onglet à tester : elle agit sur l'onglet actif de la dernière fenêtre Firefox utilisée.
let targetWindowId = Number(new URLSearchParams(location.search).get('target')) || null;
let ownWindowId = null;

async function activeTab() {
  let tabs = [];
  if (targetWindowId != null) tabs = await browser.tabs.query({ active: true, windowId: targetWindowId }).catch(() => []);
  if (!tabs.length) {
    const wins = await browser.windows.getAll({ windowTypes: ['normal'] });
    const w = wins.find(x => x.focused) || wins[0];
    if (!w) return null;
    targetWindowId = w.id;
    tabs = await browser.tabs.query({ active: true, windowId: w.id });
  }
  return tabs[0] || null;
}

async function updateTargetInfo() {
  const tab = await activeTab();
  $('targetInfo').textContent = tab
    ? 'Onglet cible : « ' + (tab.title || tab.url) + ' » — cliquez dans une autre fenêtre Firefox pour changer de cible'
    : 'Aucune fenêtre Firefox ouverte : ouvrez la page à tester.';
}

async function initTargetTracking() {
  ownWindowId = (await browser.windows.getCurrent()).id;
  browser.windows.onFocusChanged.addListener(async id => {
    if (id === browser.windows.WINDOW_ID_NONE || id === ownWindowId) return;
    try {
      const w = await browser.windows.get(id);
      if (w.type === 'normal') { targetWindowId = id; updateTargetInfo(); }
    } catch (e) { /* fenêtre fermée entre-temps */ }
  });
  browser.windows.onRemoved.addListener(id => {
    if (id === targetWindowId) { targetWindowId = null; updateTargetInfo(); }
  });
  browser.tabs.onActivated.addListener(() => updateTargetInfo());
  browser.tabs.onUpdated.addListener((id, info) => {
    if (info.title || info.url || info.status === 'complete') updateTargetInfo();
  });
  updateTargetInfo();
}

const injectable = url => /^(https?|file):/i.test(url || '');

// Cadre (liste de selectFrame) en vigueur avant la ligne i, en lecture linéaire.
function staticFrameAt(cmds, i) {
  let frame = [];
  for (let k = 0; k < i; k++) {
    const c = cmds[k];
    if (c.command !== 'selectFrame') continue;
    const t = c.target.trim();
    if (t === 'relative=top' || !t) frame = [];
    else if (t === 'relative=parent') frame = frame.slice(0, -1);
    else frame = frame.concat([t]);
  }
  return frame;
}

function navigateTab(tabId, url, timeout) {
  return new Promise((resolve, reject) => {
    let done = false;
    const wn = browser.webNavigation;
    const finish = err => {
      if (done) return;
      done = true;
      wn.onCompleted.removeListener(onDone);
      wn.onReferenceFragmentUpdated.removeListener(onDone);
      wn.onErrorOccurred.removeListener(onError);
      clearTimeout(timer);
      if (err) reject(err); else resolve();
    };
    const onDone = d => { if (d.tabId === tabId && d.frameId === 0) finish(); };
    const onError = d => {
      if (d.tabId !== tabId || d.frameId !== 0) return;
      if (/ABORT/i.test(d.error || '')) return;
      finish(new FTCmdError('Erreur de navigation : ' + d.error));
    };
    wn.onCompleted.addListener(onDone);
    wn.onReferenceFragmentUpdated.addListener(onDone);
    wn.onErrorOccurred.addListener(onError);
    const timer = setTimeout(() => finish(new FTCmdError('Chargement de ' + url + ' trop long (' + timeout + ' ms)')), timeout);
    browser.tabs.update(tabId, { url }).catch(e => finish(new FTCmdError(e.message)));
  });
}

// =====================================================================
// Moteur
// =====================================================================

const engine = new FTEngine({
  send: msg => browser.tabs.sendMessage(runTabId, msg, { frameId: 0 }),
  activity: () => browser.runtime.sendMessage({ type: 'getActivity', tabId: runTabId }),
  navigate: (url, timeout) => navigateTab(runTabId, url, timeout),
  screenshot: info => captureScreenshot(info)
}, {
  status(i, state, msg) {
    if (!runningTestId || i < 0) return;
    let m = statuses.get(runningTestId);
    if (!m) { m = new Map(); statuses.set(runningTestId, m); }
    m.set(i, { state, msg });
    updateRowStatus(runningTestId, i);
  },
  log,
  state(name, idx) {
    updateControls();
    if (name === 'paused') setStatusText('En pause avant la ligne ' + (idx + 1) + '. « Reprendre » ou « Pas à pas ».');
    else if (name === 'running') setStatusText('Exécution…');
  }
});

function engineSettings(url) {
  return Object.assign({}, settings, { baseUrl: url || project.url });
}

// ---------- Captures d'écran ----------

// Dossier des captures d'une exécution : Téléchargements/Replay/<scénario ou projet>/<date-heure>/.
let shotRun = null;

const safeName = s => String(s).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '_').replace(/\s+/g, ' ')
  .trim().replace(/^\.+|\.+$/g, '').slice(0, 90) || 'sans nom';

function newShotRun(name, withProject) {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  const stamp = d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' +
    p(d.getHours()) + 'h' + p(d.getMinutes()) + 'm' + p(d.getSeconds()) + 's';
  return { folder: 'Replay/' + safeName(name) + '/' + stamp, seq: 0, withProject };
}

async function captureScreenshot(info) {
  if (!shotRun) shotRun = newShotRun(project.name, false);
  let dataUrl = null;
  if (info.mode !== 'visible') {
    try {
      const size = await browser.tabs.sendMessage(runTabId, { type: 'shotPrepare' }, { frameId: 0 });
      // Au-delà d'environ 40 mégapixels Firefox refuse l'image : on réduit l'échelle.
      const scale = Math.min(size.dpr, Math.sqrt(40e6 / Math.max(1, size.width * size.height)));
      dataUrl = await browser.tabs.captureTab(runTabId, {
        format: 'png', scale, rect: { x: 0, y: 0, width: size.width, height: size.height }
      });
    } catch (e) {
      dataUrl = null;
    } finally {
      await browser.tabs.sendMessage(runTabId, { type: 'shotRestore' }, { frameId: 0 }).catch(() => {});
    }
  }
  if (!dataUrl) dataUrl = await browser.tabs.captureTab(runTabId, { format: 'png' });
  const parts = [String(++shotRun.seq).padStart(3, '0')];
  if (shotRun.withProject) parts.push(project.name);
  parts.push(info.test, info.line ? 'ligne ' + info.line : '', info.command, info.label);
  const filename = shotRun.folder + '/' + safeName(parts.filter(Boolean).join(' - ')) + '.png';
  const url = URL.createObjectURL(await (await fetch(dataUrl)).blob());
  const id = await browser.downloads.download({ url, filename, saveAs: false, conflictAction: 'uniquify' });
  // Le fichier reste sur le disque ; on le retire seulement de la liste des téléchargements.
  const done = d => {
    if (d.id !== id || !d.state || d.state.current === 'in_progress') return;
    browser.downloads.onChanged.removeListener(done);
    URL.revokeObjectURL(url);
    if (d.state.current === 'complete') browser.downloads.erase({ id }).catch(() => {});
  };
  browser.downloads.onChanged.addListener(done);
  return filename;
}

async function prepareRun() {
  if (busy()) return false;
  if (rec) await stopRecording();
  const tab = await activeTab();
  if (!tab) return false;
  runTabId = tab.id;
  engine.settings = engineSettings();
  return true;
}

// Lance les tests à la suite dans le projet courant ; renvoie [[test, résultat], ...].
// Les variables passent d'un test au suivant, et d'un projet au suivant dans un scénario.
async function runTestList(tests, from, vars) {
  const results = [];
  let carry = vars || {};
  for (const t of tests) {
    if (batchStop) break;
    runningTestId = t.id;
    statuses.set(t.id, new Map());
    if (t.id !== currentTestId) {
      currentTestId = t.id;
      sel = { anchor: -1, focus: -1 };
      renderTests();
      renderEditor();
    }
    renderTable();
    let r;
    try {
      r = await engine.runTest(t, { from: tests.length === 1 ? from : 0, vars: carry });
      carry = engine.vars;
    } catch (e) {
      log('error', 'Erreur interne : ' + e.message);
      r = { passed: false, stopped: true };
    }
    results.push([t, r]);
    if (r.stopped) { batchStop = true; break; }
  }
  runningTestId = null;
  return results;
}

function testsSummary(results, total) {
  const ok = results.filter(([, r]) => r.passed).length;
  const failed = results.filter(([, r]) => !r.passed && !r.stopped).map(([t]) => t.name);
  return { ok, failed, text: ok + '/' + total + ' test(s) réussi(s)' + (failed.length ? ' — échecs : ' + failed.join(', ') : '') };
}

async function runBatch(fn, runName, withProject) {
  if (!(await prepareRun())) return;
  shotRun = newShotRun(runName, !!withProject);
  batchRunning = true;
  batchStop = false;
  updateControls();
  renderNav();
  try {
    await fn();
  } finally {
    batchRunning = false;
    runningTestId = null;
    updateControls();
    renderNav();
  }
}

function runTests(tests, from) {
  const whole = tests.length === project.tests.length && tests.length > 1;
  const p = project;
  return runBatch(async () => {
    if (whole) { projectResults.set(p.id, 'running'); renderNav(); }
    // On reprend les variables de l'exécution précédente : on peut rejouer une étape ou un projet d'un scénario
    // avec les mêmes identifiants. « Vider les variables » repart de zéro.
    const start = Object.assign({}, engine.vars);
    const results = await runTestList(tests, from, start);
    if (tests.length > 1) {
      const s = testsSummary(results, tests.length);
      log(s.failed.length ? 'error' : 'ok', 'Bilan : ' + s.text);
    }
    if (whole) {
      if (batchStop) projectResults.delete(p.id);
      else projectResults.set(p.id, results.every(([, r]) => r.passed) ? 'ok' : 'fail');
      renderNav();
    }
    const last = results[results.length - 1];
    if (last && !batchStop) setStatusText(last[1].passed ? 'Test réussi.' : 'Test en échec (voir le journal).', !last[1].passed);
    else setStatusText('Arrêté.');
  }, p.name);
}

function runScenario(scen) {
  const projects = scen.items.map(id => library.projects.find(p => p.id === id)).filter(Boolean);
  if (!projects.length) { setStatusText('Ce scénario ne contient aucun projet.', true); return; }
  const states = [];
  scenarioResults.set(scen.id, states);
  return runBatch(async () => {
    log('info', '▶▶ Scénario « ' + scen.name + ' » : ' + projects.length + ' projet(s)' +
      (scen.url ? ' — URL du scénario ' + scen.url + ', qui remplace celle de chaque projet' : ''));
    const lines = [];
    let allOk = true;
    let vars = {};
    for (let k = 0; k < projects.length; k++) {
      const p = projects[k];
      if (batchStop) break;
      states[k] = 'running';
      showProject(p.id);
      const url = scen.url || p.url;
      engine.settings = engineSettings(url);
      log('info', '═══ Projet « ' + p.name + ' » (' + (url || 'sans URL de base') + ') ═══');
      const results = await runTestList(p.tests.slice(), 0, vars);
      vars = engine.vars;
      const s = testsSummary(results, p.tests.length);
      const ok = s.ok === p.tests.length;
      states[k] = batchStop ? undefined : ok ? 'ok' : 'fail';
      if (!batchStop) projectResults.set(p.id, states[k]);
      renderNav();
      allOk = allOk && ok;
      lines.push((ok ? '✔ ' : '✘ ') + p.name + ' : ' + s.text);
      if (!ok && scen.stopOnFailure && !batchStop) {
        log('warn', 'Scénario arrêté : le projet « ' + p.name + ' » a échoué.');
        break;
      }
    }
    const done = lines.length;
    log(allOk && done === projects.length && !batchStop ? 'ok' : 'error',
      'Bilan du scénario « ' + scen.name + ' » (' + done + '/' + projects.length + ' projet(s) joué(s)) :\n' + lines.join('\n'));
    setStatusText(batchStop ? 'Scénario arrêté.' : allOk ? 'Scénario réussi.' : 'Scénario en échec (voir le journal).', !allOk || batchStop);
  }, scen.name, true);
}

async function execOne() {
  const c = selectedCommand();
  if (!c || !(await prepareRun())) return;
  shotRun = null;
  runningTestId = currentTestId;
  engine.frame = staticFrameAt(currentTest().commands, sel.focus);
  const i = sel.focus;
  engine.hooks.status(i, 'running');
  const r = await engine.runOne(c);
  engine.hooks.status(i, r.ok ? 'ok' : 'failed', r.message);
  log(r.ok ? 'info' : 'error', 'Ligne ' + (i + 1) + ' ' + c.command + (r.ok ? ' : OK' : ' : ' + r.message));
  runningTestId = null;
}

// =====================================================================
// Enregistrement
// =====================================================================

function relativeUrl(url) {
  const base = String(project.url || '').replace(/\/+$/, '');
  if (base && url.startsWith(base) && /^($|[/?#])/.test(url.slice(base.length))) {
    return url.slice(base.length) || '/';
  }
  return url;
}

async function startRecording() {
  const tab = await activeTab();
  if (!tab || !injectable(tab.url)) {
    setStatusText('Ouvrez d\'abord la page à tester (http, https ou file) dans l\'onglet actif.', true);
    return;
  }
  rec = { tabId: tab.id, frame: [] };
  const t = currentTest();
  if (!t.commands.length) {
    if (!project.url && /^https?:/.test(tab.url)) {
      project.url = new URL(tab.url).origin;
      renderTests();
    }
    insertCommands([FTProject.newCommand('open', relativeUrl(tab.url))], 0);
  } else {
    // L'enregistrement suppose le cadre principal à l'endroit d'insertion.
    rec.frame = staticFrameAt(t.commands, insertionIndex());
  }
  await browser.runtime.sendMessage({ type: 'setRecording', tabId: tab.id });
  updateControls();
  setStatusText('Enregistrement dans « ' + (tab.title || tab.url) + ' ». Clic droit dans la page : attentes et vérifications.');
  log('info', '● Enregistrement démarré');
}

async function stopRecording() {
  if (!rec) return;
  rec = null;
  await browser.runtime.sendMessage({ type: 'setRecording', tabId: null }).catch(() => {});
  updateControls();
  setStatusText('Enregistrement arrêté.');
  log('info', '■ Enregistrement arrêté');
}

function sameFrame(a, b) {
  return JSON.stringify(a || []) === JSON.stringify(b || []);
}

function onRecorded(msg) {
  const t = currentTest();
  const c = Object.assign(FTProject.newCommand(), msg.cmd, { id: FTProject.uid() });
  c.targets = c.targets || [];
  let at = insertionIndex();
  const add = [];

  if (msg.frame === null) {
    log('warn', 'Action dans un cadre d\'une autre origine : elle ne pourra pas être rejouée.');
  } else if (msg.frame !== undefined && !sameFrame(msg.frame, rec.frame)) {
    add.push(FTProject.newCommand('selectFrame', 'relative=top'));
    for (const loc of msg.frame) add.push(FTProject.newCommand('selectFrame', loc));
    rec.frame = msg.frame;
  }

  const prev = t.commands[at - 1];
  if (!add.length && prev) {
    if ((c.command === 'type' || c.command === 'editContent') && prev.command === c.command && prev.target === c.target) {
      pushUndo();
      prev.value = c.value;
      save();
      renderTable();
      select(at - 1);
      return;
    }
    if (c.command === 'sendKeys' && prev.command === 'sendKeys' && prev.target === c.target) {
      pushUndo();
      prev.value += c.value;
      save();
      renderTable();
      select(at - 1);
      return;
    }
  }

  add.push(c);
  mutate(t2 => {
    // Un double-clic arrive après ses deux clics : on les remplace.
    let removed = 0;
    while (msg.collapseClicks && removed < 2 && at > 0 &&
           t2.commands[at - 1].command === 'click' && t2.commands[at - 1].target === c.target) {
      t2.commands.splice(at - 1, 1);
      at--;
      removed++;
    }
    t2.commands.splice(at, 0, ...add);
    const last = at + add.length - 1;
    sel = { anchor: last, focus: last };
  });
  const tr = $('cmdBody').children[sel.focus];
  if (tr) tr.scrollIntoView({ block: 'nearest' });
}

// =====================================================================
// Désignation et recherche d'élément
// =====================================================================

async function startPick() {
  const tab = await activeTab();
  if (!tab || !injectable(tab.url)) { setStatusText('Aucune page utilisable dans l\'onglet actif.', true); return; }
  pickTabId = tab.id;
  await browser.tabs.sendMessage(tab.id, { type: 'pick', on: true }).catch(() => {});
  setStatusText('Cliquez sur un élément de la page (Échap pour annuler).');
}

function onPicked(msg) {
  browser.tabs.sendMessage(pickTabId, { type: 'pick', on: false }).catch(() => {});
  pickTabId = null;
  if (!msg.targets || !msg.targets.length) { setStatusText('Désignation annulée.'); return; }
  const c = selectedCommand();
  if (!c) return;
  pushUndo();
  c.target = msg.targets[0][0];
  c.targets = msg.targets;
  save();
  renderTable();
  renderSelection();
  renderEditor();
  const expected = staticFrameAt(currentTest().commands, sel.focus);
  if (msg.frame && !sameFrame(msg.frame, expected)) {
    log('warn', 'L\'élément est dans une iframe : ajoutez avant cette ligne « selectFrame relative=top » puis ' +
      msg.frame.map(f => '« selectFrame ' + f + ' »').join(', '));
  }
  setStatusText('Cible : ' + c.target);
}

async function findTarget() {
  const c = selectedCommand();
  if (!c || !c.target) return;
  const tab = await activeTab();
  if (!tab) return;
  const target = engine.interp ? engine.interp(c.target) : c.target;
  const frame = staticFrameAt(currentTest().commands, sel.focus);
  let r;
  try {
    r = await browser.tabs.sendMessage(tab.id, { type: 'highlight', target, frame }, { frameId: 0 });
  } catch (e) {
    setStatusText('Page non disponible.', true);
    return;
  }
  if (!r || !r.found) setStatusText('Élément introuvable : ' + target + (r && r.message ? ' (' + r.message + ')' : ''), true);
  else setStatusText(r.found === 1 ? 'Élément trouvé.' : r.found + ' éléments correspondent (le premier visible est surligné).');
}

// =====================================================================
// Import / export
// =====================================================================

let fileMode = 'open';

function chooseFile(mode) {
  fileMode = mode;
  $('fileInput').value = '';
  $('fileInput').click();
}

function uniqueName(name, taken) {
  let n = name, k = 2;
  while (taken.includes(n)) n = name + ' (' + k++ + ')';
  return n;
}

// Ajoute un projet lu dans un fichier ; s'il est déjà dans la bibliothèque (même id), demande s'il faut le remplacer.
async function addProjectToLibrary(p) {
  const idx = library.projects.findIndex(x => x.id === p.id);
  if (idx >= 0) {
    const replace = await confirmBox('Le projet « ' + library.projects[idx].name + ' » est déjà dans la bibliothèque. ' +
      'OK : le remplacer par la version du fichier. Annuler : l\'ajouter comme copie.');
    if (replace) {
      if (project === library.projects[idx]) project = p;
      library.projects[idx] = p;
      return p;
    }
    p.id = FTProject.uid();
  }
  p.name = uniqueName(p.name, library.projects.map(x => x.name));
  library.projects.push(p);
  return p;
}

async function onFileChosen() {
  const f = $('fileInput').files[0];
  if (!f) return;
  let parsed;
  try {
    parsed = FTProject.parseAny(await f.text());
  } catch (e) {
    setStatusText(e.message, true);
    return;
  }
  if (fileMode === 'import') {
    if (parsed.kind !== 'project') { setStatusText('« Importer » attend un fichier .side ; utilisez « Ouvrir » pour un scénario.', true); return; }
    const added = FTProject.merge(project, parsed.project);
    if (project.suites[0]) project.suites[0].tests.push(...added.map(t => t.id));
    log('info', added.length + ' test(s) importé(s) depuis ' + f.name + ' dans « ' + project.name + ' ».');
    save();
    renderTests();
    switchTest(added[0].id);
    return;
  }
  if (parsed.kind === 'project') {
    const p = await addProjectToLibrary(parsed.project);
    log('info', 'Projet « ' + p.name + ' » ajouté (' + p.tests.length + ' test(s)).');
    showProject(p.id);
    return;
  }
  const ids = new Map();
  for (const p of parsed.projects) {
    const oldId = p.id;
    ids.set(oldId, (await addProjectToLibrary(p)).id);
  }
  const scen = parsed.scenario;
  scen.id = FTProject.uid();
  scen.items = scen.items.map(id => ids.get(id)).filter(Boolean);
  scen.name = uniqueName(scen.name, library.scenarios.map(s => s.name));
  library.scenarios.push(scen);
  log('info', 'Scénario « ' + scen.name + ' » ajouté avec ' + parsed.projects.length + ' projet(s).' +
    (scen.url ? ' Son URL de base (' + scen.url + ') remplace celle des projets : la modifier dans le scénario déplié.' : ''));
  expanded.add(scen.id);
  setNavMode('scenarios');
  showProject(scen.items[0] || project.id);
}

// =====================================================================
// Projets de la bibliothèque
// =====================================================================

function notifyLogTitle() {
  if (logWindowId != null) browser.runtime.sendMessage({ type: 'logTitle', src: PANEL_ID, title: project.name }).catch(() => {});
}

// Affiche un projet ; utilisé aussi par le scénario en cours d'exécution.
function showProject(id) {
  const p = library.projects.find(x => x.id === id);
  if (!p) return;
  project = p;
  currentTestId = p.tests[0].id;
  sel = { anchor: -1, focus: -1 };
  undoStack.length = 0;
  save();
  renderTests();
  renderTable();
  select(0);
  notifyLogTitle();
}

async function switchProject(id) {
  if (id === project.id) return;
  if (busy()) { setStatusText('Impossible pendant l\'exécution.', true); return; }
  if (rec) await stopRecording();
  showProject(id);
}

async function newProject() {
  const name = await ask('Nom du nouveau projet :', 'Projet ' + (library.projects.length + 1));
  if (!name) return;
  const p = FTProject.newProject();
  p.name = uniqueName(name.trim() || 'Projet', library.projects.map(x => x.name));
  p.url = project.url;
  library.projects.push(p);
  await switchProject(p.id);
}

async function renameProject() {
  const name = await ask('Nouveau nom du projet :', project.name);
  if (!name || !name.trim()) return;
  project.name = uniqueName(name.trim(), library.projects.filter(p => p !== project).map(p => p.name));
  save();
  renderTests();
  notifyLogTitle();
}

async function deleteProject(target) {
  const p = target || project;
  if (busy()) { setStatusText('Impossible pendant l\'exécution.', true); return; }
  const scens = library.scenarios.filter(s => s.items.includes(p.id)).map(s => '« ' + s.name + ' »');
  if (!(await confirmBox('Supprimer le projet « ' + p.name + ' » et ses ' + p.tests.length + ' test(s) ? ' +
    (scens.length ? 'Il sera aussi retiré du ou des scénarios ' + scens.join(', ') + '. ' : '') +
    'Pensez à l\'exporter avant si vous voulez le garder.'))) return;
  const current = p === project;
  if (current && rec) await stopRecording();
  library.projects = library.projects.filter(x => x.id !== p.id);
  for (const s of library.scenarios) s.items = s.items.filter(x => x !== p.id);
  if (!library.projects.length) library.projects.push(FTProject.newProject());
  projectResults.delete(p.id);
  log('info', 'Projet « ' + p.name + ' » supprimé.');
  if (current || !library.projects.includes(project)) {
    showProject(library.projects[0].id);
  } else {
    save();
    renderNav();
  }
}

// =====================================================================
// Navigation : liste des projets, ou scénarios dépliables
// =====================================================================

let navMode = 'projects';
const expanded = new Set();
// Dernier résultat connu (« Tous les tests » ou scénario) : 'ok', 'fail' ou 'running'.
const projectResults = new Map();
// Par scénario : état de chaque ligne lors de sa dernière exécution.
const scenarioResults = new Map();

function saveUi() {
  browser.storage.local.set({ ui: { navMode, expanded: [...expanded] } });
}

function setNavMode(mode) {
  navMode = mode;
  saveUi();
  renderNav();
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

function smallButton(text, title, fn) {
  const b = el('button', null, text);
  b.type = 'button';
  b.title = title;
  b.onclick = e => { e.stopPropagation(); fn(); };
  return b;
}

// Ligne cliquable d'un projet ; `state` colore la pastille.
function projectRow(p, state, tools) {
  const row = el('div', 'proj' + (p.id === project.id ? ' current' : ''));
  row.title = p.name + (p.url ? '\n' + p.url : '');
  row.appendChild(el('span', 'dot' + (state ? ' ' + state : '')));
  const name = el('span', 'name', p.name);
  name.appendChild(el('span', 'sub', p.tests.length + ' test' + (p.tests.length > 1 ? 's' : '') + (p.url ? ' · ' + p.url : '')));
  row.appendChild(name);
  if (tools && tools.length) {
    const t = el('span', 'tools');
    t.append(...tools);
    row.appendChild(t);
  }
  row.onclick = () => switchProject(p.id);
  return row;
}

function renderNav() {
  renderUrlOverride();
  const projMode = navMode === 'projects';
  $('modeProjects').classList.toggle('on', projMode);
  $('modeScenarios').classList.toggle('on', !projMode);
  $('modeProjects').setAttribute('aria-selected', projMode);
  $('modeScenarios').setAttribute('aria-selected', !projMode);
  $('projectList').hidden = !projMode;
  $('scenarioList').hidden = projMode;
  $('btnNavNew').textContent = projMode ? '+ Nouveau projet' : '+ Nouveau scénario';
  if (projMode) renderProjectList();
  else renderScenarioList();
}

function renderProjectList() {
  const list = $('projectList');
  list.textContent = '';
  for (const p of library.projects) {
    const li = el('li');
    li.appendChild(projectRow(p, projectResults.get(p.id), [
      smallButton('✕', 'Supprimer ce projet', () => deleteProject(p))
    ]));
    list.appendChild(li);
  }
}

function renderScenarioList() {
  const list = $('scenarioList');
  list.textContent = '';
  if (!library.scenarios.length) {
    list.appendChild(el('li', 'empty hint',
      'Aucun scénario. Un scénario lance plusieurs projets à la suite, chacun avec tous ses tests et sa propre URL de base.'));
    return;
  }
  for (const s of library.scenarios) {
    const li = el('li', 'scen');
    const open = expanded.has(s.id);
    const head = el('div', 'scen-head');
    head.title = open ? 'Replier' : 'Déplier';
    head.append(el('span', 'twisty', open ? '▾' : '▸'), el('span', 'name', s.name),
      el('span', 'count', String(s.items.length)));
    const run = smallButton('▶', 'Lancer le scénario', () => runScenario(s));
    run.className = 'run';
    run.disabled = busy() || !s.items.length;
    head.appendChild(run);
    head.onclick = () => {
      if (expanded.has(s.id)) expanded.delete(s.id); else expanded.add(s.id);
      saveUi();
      renderNav();
    };
    li.appendChild(head);
    if (open) li.appendChild(scenarioBody(s));
    list.appendChild(li);
  }
}

function scenarioBody(s) {
  const body = el('div', 'scen-body');
  const change = fn => () => { if (busy()) return; fn(); scenarioResults.delete(s.id); save(); renderNav(); };
  const states = scenarioResults.get(s.id) || [];
  const ol = el('ol');
  s.items.forEach((id, i) => {
    const p = library.projects.find(x => x.id === id);
    if (!p) return;
    const li = el('li');
    li.appendChild(projectRow(p, states[i], [
      smallButton('↑', 'Monter', change(() => { if (i > 0) s.items.splice(i - 1, 0, s.items.splice(i, 1)[0]); })),
      smallButton('↓', 'Descendre', change(() => { if (i < s.items.length - 1) s.items.splice(i + 1, 0, s.items.splice(i, 1)[0]); })),
      smallButton('✕', 'Retirer du scénario (le projet n\'est pas supprimé)', change(() => { s.items.splice(i, 1); }))
    ]));
    ol.appendChild(li);
  });
  if (!s.items.length) ol.appendChild(el('li', 'hint', 'Aucun projet : ajoutez-en ci-dessous, dans l\'ordre où ils doivent être joués.'));
  body.appendChild(ol);

  const row = el('div', 'row');
  const pick = el('select');
  pick.title = 'Projet à ajouter';
  for (const p of library.projects) {
    const o = el('option', null, p.name);
    o.value = p.id;
    pick.appendChild(o);
  }
  pick.value = project.id;
  row.append(pick, smallButton('Ajouter', 'Ajouter ce projet à la fin du scénario', change(() => s.items.push(pick.value))));
  body.appendChild(row);

  const urlLabel = el('label', 'url');
  const urlInput = el('input');
  urlInput.placeholder = 'URL de base du scénario (sinon, celle de chaque projet)';
  urlInput.title = 'Si elle est remplie, elle remplace l\'URL de base de tous les projets pendant le scénario';
  urlInput.value = s.url || '';
  urlInput.spellcheck = false;
  urlInput.onchange = () => { s.url = urlInput.value.trim(); save(); renderUrlOverride(); };
  urlLabel.appendChild(urlInput);
  body.appendChild(urlLabel);

  const stop = el('label');
  const cb = el('input');
  cb.type = 'checkbox';
  cb.checked = s.stopOnFailure;
  cb.onchange = () => { s.stopOnFailure = cb.checked; save(); };
  stop.append(cb, document.createTextNode('Arrêter dès qu\'un projet échoue'));
  body.appendChild(stop);

  const actions = el('div', 'actions');
  const run = smallButton('▶ Lancer', 'Lancer tous les projets du scénario, dans l\'ordre', () => runScenario(s));
  run.className = 'primary';
  run.disabled = busy() || !s.items.length;
  actions.append(run,
    smallButton('Renommer', 'Renommer le scénario', () => renameScenario(s)),
    smallButton('Exporter', 'Enregistrer le scénario et ses projets dans un fichier ; « Ouvrir un fichier… » le recharge',
      () => downloadText(FTProject.serializeScenario(s, library.projects), s.name + '.scenario.json')),
    smallButton('Supprimer', 'Supprimer le scénario (les projets restent)', () => deleteScenario(s)));
  body.appendChild(actions);
  return body;
}

async function newScenario() {
  const name = await ask('Nom du nouveau scénario :', 'Scénario ' + (library.scenarios.length + 1));
  if (!name || !name.trim()) return;
  const s = FTProject.newScenario(uniqueName(name.trim(), library.scenarios.map(x => x.name)));
  library.scenarios.push(s);
  expanded.add(s.id);
  save();
  setNavMode('scenarios');
}

async function renameScenario(s) {
  const name = await ask('Nouveau nom du scénario :', s.name);
  if (!name || !name.trim()) return;
  s.name = uniqueName(name.trim(), library.scenarios.filter(x => x !== s).map(x => x.name));
  save();
  renderNav();
}

async function deleteScenario(s) {
  if (busy()) return;
  if (!(await confirmBox('Supprimer le scénario « ' + s.name + ' » ? Ses projets ne sont pas supprimés.'))) return;
  library.scenarios = library.scenarios.filter(x => x !== s);
  expanded.delete(s.id);
  scenarioResults.delete(s.id);
  save();
  saveUi();
  renderNav();
}

async function downloadText(text, name) {
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const filename = name.replace(/[\\/:*?"<>|]+/g, '_');
  try {
    await browser.downloads.download({ url, filename, saveAs: true });
    setStatusText('Fichier exporté : ' + filename);
  } catch (e) {
    if (!/cancel/i.test(e.message)) setStatusText('Export impossible : ' + e.message, true);
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

function exportProject() {
  return downloadText(FTProject.serialize(project), (project.name || 'projet') + '.side');
}

// =====================================================================
// Réglages
// =====================================================================

function openSettings() {
  $('setTimeout').value = settings.timeout;
  $('setAutoWait').checked = settings.autoWait;
  $('setPostDelay').value = settings.postActionDelay;
  $('setAjaxTimeout').value = settings.ajaxTimeout;
  $('setAjaxIgnore').value = settings.ajaxIgnore;
  $('setHighlight').checked = settings.highlight;
  $('setShotOnFailure').checked = settings.shotOnFailure;
  $('setMaxLoops').value = settings.maxLoops;
  const dlg = $('settingsDlg');
  dlg.returnValue = '';
  dlg.onclose = () => {
    if (dlg.returnValue !== 'ok') return;
    const num = (id, def) => { const n = Number($(id).value); return Number.isFinite(n) && n >= 0 ? n : def; };
    settings.timeout = num('setTimeout', DEFAULT_SETTINGS.timeout) || DEFAULT_SETTINGS.timeout;
    settings.autoWait = $('setAutoWait').checked;
    settings.postActionDelay = num('setPostDelay', DEFAULT_SETTINGS.postActionDelay);
    settings.ajaxTimeout = num('setAjaxTimeout', DEFAULT_SETTINGS.ajaxTimeout) || DEFAULT_SETTINGS.ajaxTimeout;
    settings.ajaxIgnore = $('setAjaxIgnore').value;
    settings.highlight = $('setHighlight').checked;
    settings.shotOnFailure = $('setShotOnFailure').checked;
    settings.maxLoops = num('setMaxLoops', DEFAULT_SETTINGS.maxLoops) || DEFAULT_SETTINGS.maxLoops;
    saveSettings();
    setStatusText('Réglages enregistrés.');
  };
  dlg.showModal();
}

// =====================================================================
// Événements de l'interface
// =====================================================================

function bindUi() {
  const dl = $('cmdList');
  for (const name of Object.keys(FT_COMMANDS).sort()) {
    const o = document.createElement('option');
    o.value = name;
    dl.appendChild(o);
  }

  $('baseUrl').addEventListener('change', e => { project.url = e.target.value.trim(); save(); renderUrlOverride(); renderNav(); });
  $('modeProjects').onclick = () => setNavMode('projects');
  $('modeScenarios').onclick = () => setNavMode('scenarios');
  $('btnNavNew').onclick = () => (navMode === 'projects' ? newProject() : newScenario());
  $('btnOpen').onclick = () => chooseFile('open');
  $('btnRenameProject').onclick = renameProject;
  $('btnDelProject').onclick = () => deleteProject();
  $('btnImport').onclick = () => chooseFile('import');
  $('fileInput').addEventListener('change', onFileChosen);
  $('btnExport').onclick = exportProject;
  $('btnSettings').onclick = openSettings;
  browser.storage.onChanged.addListener(onStorageChanged);

  $('testSelect').addEventListener('change', e => {
    if (busy()) { e.target.value = currentTestId; return; }
    switchTest(e.target.value);
  });
  $('btnAddTest').onclick = addTest;
  $('btnRenameTest').onclick = renameTest;
  $('btnDupTest').onclick = duplicateTest;
  $('btnDelTest').onclick = deleteTest;

  $('btnRecord').onclick = () => (rec ? stopRecording() : startRecording());
  $('btnRun').onclick = () => runTests([currentTest()], 0);
  $('btnRunFrom').onclick = () => runTests([currentTest()], Math.max(0, sel.focus));
  $('btnRunAll').onclick = () => runTests(project.tests.slice(), 0);
  $('btnPause').onclick = () => (engine.state === 'paused' ? engine.resume() : engine.pause());
  $('btnStep').onclick = () => engine.step();
  $('btnStop').onclick = () => { batchStop = true; engine.stop(); };
  $('speed').value = settings.speed;
  $('speed').addEventListener('input', e => {
    settings.speed = Number(e.target.value);
    engine.speed = settings.speed;
    saveSettings();
  });

  $('btnAddCmd').onclick = () => {
    insertCommands([FTProject.newCommand()], insertionIndex());
    $('edCommand').focus();
  };
  $('btnDelCmd').onclick = deleteSelection;
  $('btnUp').onclick = () => moveSelection(-1);
  $('btnDown').onclick = () => moveSelection(1);
  $('btnToggle').onclick = toggleDisabled;
  $('btnBreak').onclick = toggleBreakpoint;
  $('btnExecOne').onclick = execOne;
  $('btnUndo').onclick = undo;

  const body = $('cmdBody');
  body.addEventListener('mousedown', e => {
    const tr = e.target.closest('tr');
    if (!tr) return;
    const i = Number(tr.dataset.i);
    if (e.target.closest('td.bp')) {
      const c = currentTest().commands[i];
      c.breakpoint = !c.breakpoint;
      if (!c.breakpoint) delete c.breakpoint;
      tr.classList.toggle('breakpoint', !!c.breakpoint);
      save();
      return;
    }
    select(i, e.shiftKey);
    $('cmdTable').focus();
  });
  body.addEventListener('dblclick', () => $('edCommand').focus());

  $('cmdTable').addEventListener('keydown', e => {
    const ctrl = e.ctrlKey || e.metaKey;
    const n = currentTest().commands.length;
    if (e.key === 'ArrowDown' && e.altKey) { moveSelection(1); e.preventDefault(); }
    else if (e.key === 'ArrowUp' && e.altKey) { moveSelection(-1); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { select(Math.min(n - 1, sel.focus + 1), e.shiftKey); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { select(Math.max(0, sel.focus - 1), e.shiftKey); e.preventDefault(); }
    else if (e.key === 'Delete') { deleteSelection(); e.preventDefault(); }
    else if (e.key === 'Insert') { $('btnAddCmd').click(); e.preventDefault(); }
    else if (e.key === 'Enter') { $('edCommand').focus(); e.preventDefault(); }
    else if (ctrl && e.key.toLowerCase() === 'c') { copySelection(false); e.preventDefault(); }
    else if (ctrl && e.key.toLowerCase() === 'x') { copySelection(true); e.preventDefault(); }
    else if (ctrl && e.key.toLowerCase() === 'v') { paste(); e.preventDefault(); }
    else if (ctrl && e.key.toLowerCase() === 'a') { sel = { anchor: 0, focus: n - 1 }; renderSelection(); e.preventDefault(); }
    else if (ctrl && e.key.toLowerCase() === 'z') { undo(); e.preventDefault(); }
  });

  // Une entrée dans l'historique d'annulation par prise de focus d'un champ.
  for (const id of ['edCommand', 'edTarget', 'edValue', 'edComment']) {
    $(id).addEventListener('focus', () => { if (selectedCommand()) pushUndo(); });
  }
  $('edCommand').addEventListener('input', e => { editField('command', e.target.value.trim()); renderHelp(); });
  $('edTarget').addEventListener('input', e => { editField('target', e.target.value); fitTextarea(e.target); });
  $('edValue').addEventListener('input', e => { editField('value', e.target.value); fitTextarea(e.target); });
  $('edComment').addEventListener('input', e => editField('comment', e.target.value));
  $('edTargets').addEventListener('change', e => {
    if (!e.target.value) return;
    pushUndo();
    editField('target', e.target.value);
    $('edTarget').value = e.target.value;
    e.target.value = '';
  });
  $('btnPick').onclick = startPick;
  $('btnFind').onclick = findTarget;

  $('btnVars').onclick = showVars;
  $('btnForgetVars').onclick = () => {
    engine.vars = {};
    log('var', 'Variables vidées.');
  };
  $('btnCopyLog').onclick = () => {
    navigator.clipboard.writeText(FTLog.text(logEntries)).then(() => setStatusText('Journal copié.'));
  };
  $('btnClearLog').onclick = clearLog;
  $('btnDetach').onclick = toggleLogWindow;
  browser.windows.onRemoved.addListener(id => {
    if (id !== logWindowId) return;
    logWindowId = null;
    setLogDetached(false);
  });

  document.addEventListener('keydown', e => {
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !inField) { undo(); e.preventDefault(); }
  });

  browser.runtime.onMessage.addListener((msg, sender) => {
    if (!msg) return undefined;
    if (msg.type === 'record' && rec) {
      const tabId = sender.tab ? sender.tab.id : msg.tabId;
      if (tabId === rec.tabId) onRecorded(msg);
    } else if (msg.type === 'picked' && sender.tab && sender.tab.id === pickTabId) {
      onPicked(msg);
    } else if (msg.type === 'setTarget' && !sender.tab) {
      targetWindowId = msg.windowId;
      updateTargetInfo();
    } else if (msg.src === PANEL_ID) {
      if (msg.type === 'logHello') return Promise.resolve({ title: project.name, entries: logEntries });
      if (msg.type === 'logClear') clearLog();
      else if (msg.type === 'logShowVars') showVars();
    }
    return undefined;
  });

  window.addEventListener('unload', () => {
    if (saveTimer) flushSave();
    if (rec) browser.runtime.sendMessage({ type: 'setRecording', tabId: null });
    if (pickTabId != null) browser.tabs.sendMessage(pickTabId, { type: 'pick', on: false });
    if (logWindowId != null) browser.windows.remove(logWindowId);
  });
}

function toggleDisabled() {
  const r = selRange();
  if (!r) return;
  mutate(t => {
    const cmds = t.commands.slice(r[0], r[1] + 1);
    const allDisabled = cmds.every(c => c.command.startsWith('//'));
    for (const c of cmds) {
      if (allDisabled) c.command = c.command.replace(/^\/\/\s*/, '');
      else if (!c.command.startsWith('//')) c.command = '//' + c.command;
    }
  });
}

function toggleBreakpoint() {
  const c = selectedCommand();
  if (!c) return;
  if (c.breakpoint) delete c.breakpoint;
  else c.breakpoint = true;
  save();
  renderTable();
}

(async function init() {
  await load();
  bindUi();
  await initTargetTracking();
  renderTests();
  renderTable();
  select(0);
  updateControls();
})();

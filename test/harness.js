'use strict';

// Banc d'essai hors Firefox : le vrai script de contenu est injecté dans l'iframe #page
// avec une fausse API `browser`, et le vrai moteur la pilote.
const frameEl = document.getElementById('page');
const $ = id => document.getElementById(id);
let recording = false;
let recorded = [];
let recFrame = [];
let topListener = null;
let listeners = [];
let loading = false;
let pending = 0;

function out(level, text) {
  const d = document.createElement('div');
  d.className = level;
  d.textContent = text;
  $('log').appendChild(d);
  $('right').scrollTop = $('right').scrollHeight;
}

function showCmds() {
  $('cmds').textContent = recorded.map((c, i) => (i + 1) + '. ' + c.command + ' | ' + c.target + ' | ' + c.value).join('\n');
}

function onRecord(msg) {
  const c = Object.assign({}, msg.cmd);
  if (msg.frame && JSON.stringify(msg.frame) !== JSON.stringify(recFrame)) {
    recorded.push({ command: 'selectFrame', target: 'relative=top', value: '' });
    for (const f of msg.frame) recorded.push({ command: 'selectFrame', target: f, value: '' });
    recFrame = msg.frame;
  }
  const prev = recorded[recorded.length - 1];
  if (prev && (c.command === 'type' || c.command === 'editContent') && prev.command === c.command && prev.target === c.target) {
    prev.value = c.value;
  } else if (prev && c.command === 'sendKeys' && prev.command === 'sendKeys' && prev.target === c.target) {
    prev.value += c.value;
  } else {
    if (msg.collapseClicks) {
      for (let k = 0; k < 2 && recorded.length && recorded[recorded.length - 1].command === 'click' &&
        recorded[recorded.length - 1].target === c.target; k++) recorded.pop();
    }
    recorded.push(c);
  }
  showCmds();
}

function makeBrowser(win) {
  return {
    runtime: {
      sendMessage(msg) {
        if (msg.type === 'getRecordingState') return Promise.resolve({ recording });
        if (msg.type === 'record') onRecord(msg);
        return Promise.resolve(undefined);
      },
      onMessage: {
        addListener(fn) {
          listeners.push(fn);
          if (win === frameEl.contentWindow) topListener = fn;
        }
      }
    },
    menus: { getTargetElement: () => null }
  };
}

function inject(win, isTop) {
  let doc;
  try { doc = win.document; } catch (e) { return; }
  if (!doc || win.__ftideInjected) return;
  win.__ftideInjected = true;
  if (isTop) win.__ftideTop = true;
  win.browser = makeBrowser(win);
  const origFetch = win.fetch;
  win.fetch = function () {
    pending++;
    return origFetch.apply(this, arguments).finally(() => { pending--; });
  };
  if (isTop) {
    win.addEventListener('beforeunload', () => { loading = true; });
    win.addEventListener('pagehide', () => { loading = true; });
  }
  for (const src of ['../content/locators.js', '../content/content.js']) {
    const s = doc.createElement('script');
    s.src = new URL(src, location.href).href + '?t=' + Date.now();
    s.async = false;
    doc.documentElement.appendChild(s);
  }
  for (const f of doc.querySelectorAll('iframe')) inject(f.contentWindow, false);
}

frameEl.addEventListener('load', () => {
  listeners = [];
  topListener = null;
  inject(frameEl.contentWindow, true);
  loading = false;
});

function broadcast(msg) {
  for (const fn of listeners) fn(msg, {});
}

const engine = new FTEngine({
  async send(msg) {
    if (!topListener || loading) throw new Error('Pas de destinataire');
    return topListener(msg, {});
  },
  async activity() { return { loading, pending, urls: [] }; },
  navigate(url, timeout) {
    return new Promise((resolve, reject) => {
      loading = true;
      const t = setTimeout(() => reject(new Error('Chargement trop long')), timeout);
      frameEl.addEventListener('load', () => { clearTimeout(t); setTimeout(resolve, 50); }, { once: true });
      frameEl.src = url;
    });
  }
}, {
  status(i, state, msg) { if (state === 'failed') out('error', '  ligne ' + (i + 1) + ' en échec : ' + msg); },
  log(level, text) { out(level, text); },
  state(name) { $('state').textContent = name; }
});
engine.settings = {
  timeout: 8000, autoWait: true, postActionDelay: 150, ajaxTimeout: 8000, highlight: true, maxLoops: 1000, speed: 0,
  baseUrl: new URL('.', location.href).href
};

$('rec').onclick = () => {
  recording = true;
  recorded = [{ command: 'open', target: '/page.html', value: '' }];
  recFrame = [];
  showCmds();
  broadcast({ type: 'recordingState', recording: true });
  $('state').textContent = 'enregistrement';
};
$('stop').onclick = () => {
  recording = false;
  broadcast({ type: 'recordingState', recording: false });
  $('state').textContent = 'arrêté';
};
$('play').onclick = async () => {
  $('log').textContent = '';
  const r = await engine.runTest({ name: 'enregistrement', commands: recorded }, {});
  window.lastResult = r;
};

const C = (command, target, value) => ({ command, target: target || '', value: value || '' });
const AUTO = [
  C('open', '/page.html'),
  C('assertTitle', 'Page de test Moodle'),
  C('store', 'Aut', 'prefix'),
  C('type', 'label=Nom complet du cours', 'Cours ${prefix}'),
  C('sendKeys', 'id=id_fullname', 'o'),
  C('assertValue', 'id=id_fullname', 'Cours Auto'),
  C('select', 'id=id_category', 'label=Sciences'),
  C('assertSelectedLabel', 'id=id_category', 'Sciences'),
  C('check', 'label=Visible'),
  C('assertChecked', 'id=id_visible'),
  C('click', 'css=button[data-action="load-data"]'),
  C('assertText', 'css=[data-region=result]', 'Données chargées : 42'),
  C('storeText', 'css=[data-region=result]', 'res'),
  C('executeScript', 'return vars.res.split(":")[1].trim();', 'n'),
  C('assert', 'n', '42'),
  C('if', '${n} == 42'),
  C('echo', 'branche if (attendue)'),
  C('elseIf', 'true'),
  C('echo', 'branche elseIf : ERREUR'),
  C('else'),
  C('echo', 'branche else : ERREUR'),
  C('end'),
  C('times', '3'),
  C('executeScript', 'vars.count = (vars.count || 0) + 1;'),
  C('end'),
  C('assert', 'count', '3'),
  C('storeJson', '["a","b"]', 'list'),
  C('forEach', 'list', 'item'),
  C('echo', 'élément ${item}'),
  C('end'),
  C('store', '0', 'i'),
  C('while', '${i} < 2'),
  C('executeScript', 'vars.i = Number(vars.i) + 1;'),
  C('end'),
  C('assert', 'i', '2'),
  C('do'),
  C('executeScript', 'vars.i = Number(vars.i) - 1;'),
  C('repeatIf', '${i} > 0'),
  C('assert', 'i', '0'),
  C('selectFrame', 'id=id_summary_ifr'),
  C('editContent', 'id=tinymce', '<p>Résumé <b>auto</b></p>'),
  C('assertText', 'id=tinymce', 'Résumé auto'),
  C('selectFrame', 'relative=top'),
  C('click', 'linkText=Actions'),
  C('waitForElementVisible', 'id=action-edit'),
  C('click', 'linkText=Modifier'),
  C('assertText', 'css=[data-region=result]', 'Mode édition'),
  C('verifyText', 'css=[data-region=result]', 'faux (échec volontaire)'),
  C('storeUniqueId', 'etu', 'id'),
  C('createFile', 'username,email\n${id}-1,${id}-1@exemple.fr', 'inscrits-${id}.csv'),
  C('uploadFile', 'id=id_userfile', 'inscrits-${id}.csv'),
  C('assertText', 'id=fileresult', 'regexp:^input: inscrits-etu-\\d{8}-\\d{6}-\\w{4}\\.csv \\[text/csv\\] username,email etu-\\d{8}-\\d{6}-\\w{4}-1,'),
  C('createFile', 'base64:SGVsbG8=', 'bonjour.txt'),
  C('uploadFile', 'css=[data-region=dropzone]', 'bonjour.txt'),
  C('assertText', 'id=fileresult', 'drop: bonjour.txt [text/plain] Hello'),
  C('waitForCondition', 'document.readyState === "complete"', '2000'),
  C('//click', 'id=inexistant'),
  C('sendKeys', 'id=id_fullname', '${KEY_ENTER}'),
  C('waitForTextPresent', 'Cours enregistré'),
  C('assertText', 'id=summary', 'Nom : Cours Auto | Catégorie : 2 | Visible : 1'),
  C('assertText', 'id=summary', 'regexp:^Nom : Cours'),
  C('echo', 'FIN')
];

$('auto').onclick = async () => {
  $('log').textContent = '';
  const t0 = Date.now();
  const r = await engine.runTest({ name: 'automatique', commands: AUTO }, {});
  const good = r.failures === 1 && !r.stopped && $('log').textContent.includes('FIN') &&
    !$('log').textContent.includes('ERREUR');
  out(good ? 'ok' : 'error', 'RÉSULTAT DU BANC : ' + (good ? 'CONFORME' : 'NON CONFORME') +
    ' (failures=' + r.failures + ', attendu 1 ; ' + (Date.now() - t0) + ' ms)');
  window.lastResult = { r, good };
};

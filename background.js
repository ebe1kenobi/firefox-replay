'use strict';

// Onglet en cours d'enregistrement (un seul à la fois).
const recording = { tabId: null };

// Requêtes XHR/fetch en cours par onglet, et navigation en cours du cadre principal.
const pending = new Map();
const nav = new Map();
const STALE_MS = 120000;
let ignoreRegexps = [];

function loadIgnore(settings) {
  ignoreRegexps = [];
  const src = (settings && settings.ajaxIgnore) || '';
  for (const line of src.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    try { ignoreRegexps.push(new RegExp(s)); } catch (e) { /* motif invalide ignoré */ }
  }
}
browser.storage.local.get('settings').then(r => loadIgnore(r.settings));
browser.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.settings) loadIgnore(changes.settings.newValue);
});

function tabPending(tabId) {
  let m = pending.get(tabId);
  if (!m) { m = new Map(); pending.set(tabId, m); }
  return m;
}

browser.webRequest.onBeforeRequest.addListener(d => {
  if (d.tabId < 0 || d.type !== 'xmlhttprequest') return;
  if (ignoreRegexps.some(r => r.test(d.url))) return;
  tabPending(d.tabId).set(d.requestId, { url: d.url, t: Date.now() });
}, { urls: ['<all_urls>'] });

const finishRequest = d => {
  const m = pending.get(d.tabId);
  if (m) m.delete(d.requestId);
};
browser.webRequest.onCompleted.addListener(finishRequest, { urls: ['<all_urls>'] });
browser.webRequest.onErrorOccurred.addListener(finishRequest, { urls: ['<all_urls>'] });

browser.webNavigation.onBeforeNavigate.addListener(d => {
  if (d.frameId !== 0) return;
  nav.set(d.tabId, { loading: true, t: Date.now() });
});
const navDone = d => {
  if (d.frameId !== 0) return;
  nav.set(d.tabId, { loading: false, t: Date.now() });
};
browser.webNavigation.onCompleted.addListener(navDone);
browser.webNavigation.onErrorOccurred.addListener(navDone);

browser.tabs.onRemoved.addListener(tabId => {
  pending.delete(tabId);
  nav.delete(tabId);
  if (recording.tabId === tabId) setRecording(null);
});

function activity(tabId) {
  const now = Date.now();
  const urls = [];
  const m = pending.get(tabId);
  if (m) {
    for (const [id, r] of m) {
      if (now - r.t > STALE_MS) m.delete(id);
      else urls.push(r.url);
    }
  }
  const n = nav.get(tabId);
  return {
    loading: !!(n && n.loading && now - n.t < STALE_MS),
    pending: urls.length,
    urls: urls.slice(0, 5)
  };
}

// ---------- Enregistrement ----------

function notifyTab(tabId, on) {
  if (tabId == null) return;
  browser.tabs.sendMessage(tabId, { type: 'recordingState', recording: on }).catch(() => {});
}

function setRecording(tabId) {
  const old = recording.tabId;
  recording.tabId = tabId;
  if (old != null && old !== tabId) notifyTab(old, false);
  if (tabId != null) notifyTab(tabId, true);
  browser.menus.update(MENU_ROOT, { visible: tabId != null }).catch(() => {});
}

// ---------- Menu contextuel (pendant l'enregistrement) ----------

const MENU_ROOT = 'ftide-root';
const ELEMENT_MENUS = [
  ['waitForElementVisible', 'Attendre : élément visible'],
  ['waitForElementPresent', 'Attendre : élément présent'],
  ['waitForText', 'Attendre : texte de l\'élément'],
  ['assertText', 'Vérifier (assert) : texte'],
  ['verifyText', 'Vérifier (verify, non bloquant) : texte'],
  ['assertElementPresent', 'Vérifier : élément présent'],
  ['assertValue', 'Vérifier : valeur du champ'],
  ['storeText', 'Stocker le texte dans une variable'],
  ['click', 'Clic (forcer l\'enregistrement)']
];
const PAGE_MENUS = [
  ['waitForAjax', 'Attendre la fin des chargements AJAX'],
  ['pause', 'Pause 1 s']
];

browser.menus.create({ id: MENU_ROOT, title: 'Replay', contexts: ['all'], visible: false });
for (const [id, title] of ELEMENT_MENUS) {
  browser.menus.create({ id: 'el:' + id, parentId: MENU_ROOT, title, contexts: ['all'] });
}
browser.menus.create({ id: 'sep', parentId: MENU_ROOT, type: 'separator', contexts: ['all'] });
for (const [id, title] of PAGE_MENUS) {
  browser.menus.create({ id: 'pg:' + id, parentId: MENU_ROOT, title, contexts: ['all'] });
}

browser.menus.onClicked.addListener((info, tab) => {
  if (!tab || tab.id !== recording.tabId) return;
  const [kind, command] = String(info.menuItemId).split(':');
  if (kind === 'el') {
    browser.tabs.sendMessage(tab.id,
      { type: 'contextRecord', command, elementId: info.targetElementId },
      { frameId: info.frameId || 0 }).catch(() => {});
  } else if (kind === 'pg') {
    const cmd = command === 'pause'
      ? { command: 'pause', target: '1000', value: '' }
      : { command: 'waitForAjax', target: '', value: '' };
    browser.runtime.sendMessage({ type: 'record', tabId: tab.id, cmd }).catch(() => {});
  }
});

// ---------- Messages ----------

browser.runtime.onMessage.addListener((msg, sender) => {
  switch (msg && msg.type) {
    case 'getRecordingState':
      return Promise.resolve({ recording: !!sender.tab && sender.tab.id === recording.tabId });
    case 'setRecording':
      setRecording(msg.tabId);
      return Promise.resolve(true);
    case 'getActivity':
      return Promise.resolve(activity(msg.tabId));
  }
  return undefined;
});

// La fenêtre de l'outil ; une seule à la fois. Elle agit sur la fenêtre d'où on l'a ouverte.
async function openIdeWindow(targetWindowId) {
  const base = browser.runtime.getURL('ide/ide.html');
  for (const w of await browser.windows.getAll({ populate: true })) {
    if ((w.tabs || []).some(t => t.url && t.url.startsWith(base))) {
      await browser.windows.update(w.id, { focused: true });
      if (targetWindowId != null) browser.runtime.sendMessage({ type: 'setTarget', windowId: targetWindowId }).catch(() => {});
      return;
    }
  }
  const url = base + (targetWindowId != null ? '?target=' + targetWindowId : '');
  try {
    await browser.windows.create({ type: 'popup', url, state: 'maximized' });
  } catch (e) {
    await browser.windows.create({ type: 'popup', url, width: 1400, height: 900 });
  }
}

browser.browserAction.onClicked.addListener(tab => {
  openIdeWindow(tab ? tab.windowId : null);
});

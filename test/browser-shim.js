'use strict';

// API `browser` simulée pour afficher le panneau hors de Firefox. Les messages runtime passent par un
// BroadcastChannel, ce qui relie plusieurs onglets d'aperçu (panneau + fenêtre de journal).
(function () {
  const store = {};
  // #ancien : simule le stockage d'avant la bibliothèque (un seul projet sous la clé « project »).
  if (location.hash === '#ancien') {
    store.project = { id: 'p-ancien', name: 'Projet ancien', url: 'http://moodle.local', tests: [{ id: 't1', name: 'Vieux test', commands: [{ command: 'echo', target: 'ok', value: '' }] }] };
  }
  const ev = () => {
    const ls = [];
    return { addListener: f => ls.push(f), removeListener() {}, fire: (...a) => ls.forEach(f => f(...a)) };
  };
  const bus = new BroadcastChannel('ftide-preview');
  const msgListeners = [];
  const waiting = new Map();
  const removed = ev();
  const LOG_WINDOW_ID = 777;
  const myWindowId = /[?&]src=/.test(location.search) ? LOG_WINDOW_ID : Math.floor(Math.random() * 1e9);

  bus.onmessage = async ({ data }) => {
    if (data.kind === 'res') {
      const w = waiting.get(data.id);
      if (w && data.value !== undefined) { waiting.delete(data.id); w(data.value); }
    } else if (data.kind === 'req') {
      for (const f of msgListeners) {
        const r = f(data.msg, {});
        if (r && typeof r.then === 'function') bus.postMessage({ kind: 'res', id: data.id, value: await r });
      }
    } else if (data.kind === 'closed') {
      removed.fire(data.windowId);
    } else if (data.kind === 'close' && data.windowId === myWindowId) {
      window.close();
    }
  };
  window.addEventListener('pagehide', () => bus.postMessage({ kind: 'closed', windowId: myWindowId }));

  window.browser = {
    storage: {
      local: {
        get: async keys => {
          const out = {};
          for (const k of [].concat(keys)) if (k in store) out[k] = JSON.parse(JSON.stringify(store[k]));
          return out;
        },
        set: async obj => { Object.assign(store, JSON.parse(JSON.stringify(obj))); },
        remove: async k => { delete store[k]; }
      },
      onChanged: ev()
    },
    tabs: {
      query: async () => [{ id: 1, url: 'http://localhost:8765/test/page.html', title: 'Page de test' }],
      sendMessage: async () => { throw new Error('Aperçu : pas d\'onglet'); },
      update: async () => ({}),
      onActivated: ev(),
      onUpdated: ev()
    },
    runtime: {
      getURL: p => location.origin + '/' + p,
      sendMessage: msg => new Promise(resolve => {
        const id = Math.random().toString(36).slice(2);
        waiting.set(id, resolve);
        bus.postMessage({ kind: 'req', id, msg });
        setTimeout(() => { if (waiting.delete(id)) resolve(undefined); }, 500);
      }),
      onMessage: { addListener: f => msgListeners.push(f) }
    },
    windows: {
      create: async o => {
        const url = o.url.replace('/ide/log.html', '/test/log-preview.html');
        // À ouvrir à la main dans un second onglet (l'aperçu ne gère pas les fenêtres).
        window.lastWindowUrl = url;
        return { id: LOG_WINDOW_ID };
      },
      WINDOW_ID_NONE: -1,
      getCurrent: async () => ({ id: myWindowId }),
      get: async id => ({ id, type: 'normal' }),
      getAll: async () => [{ id: 1, focused: true, type: 'normal' }],
      onFocusChanged: ev(),
      remove: async id => bus.postMessage({ kind: 'close', windowId: id }),
      onRemoved: removed
    },
    downloads: { download: async o => { window.lastDownload = o; return 1; } },
    webNavigation: { onCompleted: ev(), onErrorOccurred: ev(), onReferenceFragmentUpdated: ev() }
  };
})();

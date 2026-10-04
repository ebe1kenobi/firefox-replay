'use strict';

// Fenêtre de journal détachée : reçoit les entrées du panneau qui l'a ouverte (paramètre src).
const src = new URLSearchParams(location.search).get('src');
const box = document.getElementById('log');
const entries = [];
let lastN = -1;

function add(e) {
  if (e.n <= lastN) return;
  lastN = e.n;
  entries.push(e);
  if (entries.length > FTLog.MAX) entries.shift();
  FTLog.append(box, e);
}

function applyFilters() {
  box.classList.toggle('hide-vars', !document.getElementById('showVars').checked);
  box.classList.toggle('only-errors', document.getElementById('onlyErrors').checked);
  box.scrollTop = box.scrollHeight;
}

browser.runtime.onMessage.addListener(msg => {
  if (!msg || msg.src !== src) return undefined;
  if (msg.type === 'logEntry') add(msg.entry);
  else if (msg.type === 'logCleared') { entries.length = 0; box.textContent = ''; }
  else if (msg.type === 'logTitle') document.title = 'Journal — ' + msg.title;
  return undefined;
});

browser.runtime.sendMessage({ type: 'logHello', src }).then(r => {
  if (!r) {
    box.textContent = 'Le panneau Test IDE qui a ouvert cette fenêtre est fermé.';
    return;
  }
  document.title = 'Journal — ' + r.title;
  document.getElementById('title').textContent = 'Journal — ' + r.title;
  for (const e of r.entries) add(e);
  box.scrollTop = box.scrollHeight;
});

document.getElementById('showVars').onchange = applyFilters;
document.getElementById('onlyErrors').onchange = applyFilters;
document.getElementById('btnVars').onclick = () => browser.runtime.sendMessage({ type: 'logShowVars', src });
document.getElementById('btnCopy').onclick = () => navigator.clipboard.writeText(FTLog.text(entries));
document.getElementById('btnClear').onclick = () => browser.runtime.sendMessage({ type: 'logClear', src });
document.getElementById('btnAttach').onclick = () =>
  browser.windows.getCurrent().then(w => browser.windows.remove(w.id));

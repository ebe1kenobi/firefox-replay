'use strict';

// Affichage d'une entrée du journal, partagé par le panneau et la fenêtre détachée.
const FTLog = {
  MAX: 3000,

  line(e) {
    const d = document.createElement('div');
    d.className = e.level;
    const t = document.createElement('span');
    t.className = 'time';
    t.textContent = e.time;
    d.append(t, document.createTextNode(e.text));
    return d;
  },

  // Ne suit la fin que si l'utilisateur y était déjà : on peut remonter lire pendant l'exécution.
  append(box, e) {
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 40;
    box.appendChild(this.line(e));
    while (box.children.length > this.MAX) box.firstChild.remove();
    if (atBottom) box.scrollTop = box.scrollHeight;
  },

  fill(box, entries) {
    box.textContent = '';
    for (const e of entries) box.appendChild(this.line(e));
    box.scrollTop = box.scrollHeight;
  },

  text(entries) {
    return entries.map(e => e.time + ' ' + e.text).join('\n');
  }
};

'use strict';

class FTStop extends Error {}
class FTCmdError extends Error {}

// Moteur de rejeu. `adapter` parle à l'onglet :
//   send(msg)                -> réponse du script de contenu (cadre racine)
//   activity()               -> { loading, pending, urls }
//   navigate(url, timeout)   -> résolu à la fin du chargement
// `hooks` informe l'interface : status(index, state, message), log(level, text), state(name, index).
class FTEngine {
  constructor(adapter, hooks) {
    this.adapter = adapter;
    this.hooks = hooks;
    this.state = 'idle';
    this.vars = {};
    this.frame = [];
    this._resume = null;
    this.pauseReq = false;
    this.stopReq = false;
  }

  // ---------- Contrôle ----------

  pause() { if (this.state === 'running') this.pauseReq = true; }
  resume() { if (this._resume) { const r = this._resume; this._resume = null; r(); } }
  step() {
    if (this.state !== 'paused') return;
    this.pauseReq = true;
    this.resume();
  }
  stop() {
    this.stopReq = true;
    this.resume();
  }

  checkStop() { if (this.stopReq) throw new FTStop('Arrêt demandé'); }

  async sleep(ms) {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      this.checkStop();
      await new Promise(r => setTimeout(r, Math.min(100, end - Date.now())));
    }
  }

  async waitWhilePaused(pc) {
    this.state = 'paused';
    this.hooks.state('paused', pc);
    await new Promise(r => { this._resume = r; });
    this.checkStop();
    this.state = 'running';
    this.hooks.state('running', pc);
  }

  // ---------- Variables ----------

  getVar(path) {
    const parts = path.split('.');
    if (!(parts[0] in this.vars)) return undefined;
    let v = this.vars[parts[0]];
    for (const p of parts.slice(1)) v = v == null ? undefined : v[p];
    return v;
  }

  interp(s) {
    return String(s == null ? '' : s).replace(/\$\{([A-Za-z_$][\w$]*(?:\.[\w$]+)*)\}/g, (m, path) => {
      if (!(path.split('.')[0] in this.vars)) return m;
      const v = this.getVar(path);
      return v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v);
    });
  }

  // Dans le code JS, ${x} devient une référence à la variable (et non son texte).
  interpScript(s) {
    return String(s == null ? '' : s).replace(/\$\{([A-Za-z_$][\w$]*)((?:\.[\w$]+)*)\}/g, (m, name, rest) => {
      if (!(name in this.vars)) return m;
      return 'vars[' + JSON.stringify(name) + ']' + rest;
    });
  }

  setVar(name, value) {
    if (!name) return;
    this.vars[name] = value;
    this.hooks.log('var', name + ' = ' + (typeof value === 'object' ? JSON.stringify(value) : String(value)));
  }

  // ---------- Structure des blocs ----------

  static analyze(cmds) {
    const info = cmds.map(() => ({}));
    const stack = [];
    const err = (i, m) => { throw new Error('Ligne ' + (i + 1) + ' : ' + m); };
    cmds.forEach((c, i) => {
      const name = c.command;
      if (!name || name.startsWith('//')) return;
      if (FT_BLOCK_OPEN.has(name)) {
        stack.push({ i, type: name, branches: [] });
      } else if (name === 'do') {
        stack.push({ i, type: 'do', branches: [] });
      } else if (name === 'elseIf' || name === 'else') {
        const top = stack[stack.length - 1];
        if (!top || top.type !== 'if') err(i, name + ' sans if');
        if (top.hasElse) err(i, name + ' après else');
        if (name === 'else') top.hasElse = true;
        top.branches.push(i);
        info[i].owner = top.i;
      } else if (name === 'end') {
        const top = stack.pop();
        if (!top || top.type === 'do') err(i, 'end sans bloc ouvert');
        info[top.i].end = i;
        info[top.i].branches = top.branches;
        info[top.i].type = top.type;
        info[i].owner = top.i;
      } else if (name === 'repeatIf') {
        const top = stack.pop();
        if (!top || top.type !== 'do') err(i, 'repeatIf sans do');
        info[i].owner = top.i;
      }
    });
    if (stack.length) {
      const top = stack[stack.length - 1];
      err(top.i, top.type + ' non fermé' + (top.type === 'do' ? ' (repeatIf manquant)' : ' (end manquant)'));
    }
    return info;
  }

  // ---------- Exécution ----------

  async runTest(test, opts) {
    const o = opts || {};
    const s = this.settings;
    const cmds = test.commands;
    this.state = 'running';
    this.stopReq = false;
    this.pauseReq = false;
    this.vars = Object.assign({}, o.vars || {});
    this.frame = [];
    this.timeout = s.timeout;
    this.speed = s.speed;
    this.loops = new Map();
    this.files = new Map();
    this.hooks.state('running', null);
    this.testName = test.name;
    this.lastAction = '';
    this.hooks.log('info', '▶ Test « ' + test.name + ' »');

    let info;
    try {
      info = FTEngine.analyze(cmds);
    } catch (e) {
      this.hooks.log('error', 'Structure invalide : ' + e.message);
      this.state = 'idle';
      this.hooks.state('idle', null);
      return { passed: false, failures: 1, stopped: false };
    }
    this.info = info;
    this.currentCommands = cmds;

    let pc = o.from || 0;
    let failures = 0;
    let stopped = false;
    const t0 = Date.now();

    try {
      while (pc < cmds.length) {
        this.checkStop();
        const cmd = cmds[pc];
        if (!cmd.command || cmd.command.startsWith('//')) {
          this.hooks.status(pc, 'skipped');
          pc++;
          continue;
        }
        if (cmd.breakpoint || this.pauseReq) {
          this.pauseReq = false;
          this.hooks.status(pc, 'paused');
          await this.waitWhilePaused(pc);
        }
        this.hooks.status(pc, 'running');
        try {
          const next = await this.exec(cmd, pc);
          if (cmd.command !== 'screenshot') this.lastAction = cmd.command;
          this.hooks.status(pc, 'ok');
          pc = next == null ? pc + 1 : next;
        } catch (e) {
          if (e instanceof FTStop) throw e;
          failures++;
          const msg = e && e.message || String(e);
          this.hooks.status(pc, 'failed', msg);
          this.hooks.log('error', 'Ligne ' + (pc + 1) + ' ' + cmd.command + ' : ' + msg);
          if (this.settings.shotOnFailure) await this.screenshot('ECHEC', 'page', pc, cmd.command);
          if (cmd.command.startsWith('verify')) { pc++; continue; }
          break;
        }
        if (this.speed > 0) await this.sleep(this.speed);
      }
    } catch (e) {
      if (!(e instanceof FTStop)) throw e;
      stopped = true;
      this.hooks.log('warn', '■ Exécution arrêtée');
    } finally {
      this.state = 'idle';
      this._resume = null;
      this.hooks.state('idle', null);
    }
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const passed = failures === 0 && !stopped;
    if (!stopped) {
      this.hooks.log(passed ? 'ok' : 'error',
        (passed ? '✔ Réussi' : '✘ Échec (' + failures + ' erreur' + (failures > 1 ? 's' : '') + ')') +
        ' : « ' + test.name + ' » en ' + secs + ' s');
    }
    return { passed, failures, stopped };
  }

  // Exécute une seule commande avec l'état courant (bouton « exécuter la ligne »).
  async runOne(cmd) {
    this.state = 'running';
    this.stopReq = false;
    this.hooks.state('running', null);
    if (!this.loops) this.loops = new Map();
    if (!this.files) this.files = new Map();
    this.timeout = this.timeout || this.settings.timeout;
    try {
      if (cmd.command && FTEngine.FLOW.has(cmd.command)) throw new FTCmdError('Structure de contrôle : exécuter le test complet');
      await this.exec(cmd, -1);
      return { ok: true };
    } catch (e) {
      return { ok: false, message: e.message };
    } finally {
      this.state = 'idle';
      this.hooks.state('idle', null);
    }
  }

  async exec(cmd, pc) {
    const name = cmd.command;
    const meta = FT_COMMANDS[name];
    if (!meta) throw new FTCmdError('Commande inconnue : ' + name);
    if (meta.kind === 'flow') return this.flow(cmd, pc);

    const s = this.settings;
    const target = meta.kind === 'script' ? this.interpScript(cmd.target) : this.interp(cmd.target);
    const value = this.interp(cmd.value);

    switch (name) {
      case 'open': {
        const url = this.resolveUrl(target);
        this.hooks.log('info', 'Ouverture de ' + url);
        this.frame = [];
        await this.adapter.navigate(url, this.timeout);
        await this.waitIdle(this.timeout, false);
        return null;
      }
      case 'pause':
        await this.sleep(Number(target || value) || 0);
        return null;
      case 'echo':
      case 'log':
        this.hooks.log('echo', target);
        return null;
      case 'store':
        this.setVar(value, target);
        return null;
      case 'storeJson': {
        let v;
        try { v = JSON.parse(target); } catch (e) { throw new FTCmdError('JSON invalide : ' + e.message); }
        this.setVar(value, v);
        return null;
      }
      case 'assert':
      case 'verify': {
        const v = this.getVar(target);
        const actual = v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v);
        if (actual !== value) throw new FTCmdError('${' + target + '} vaut « ' + actual + ' », attendu « ' + value + ' »');
        return null;
      }
      case 'selectFrame':
        return this.selectFrame(target);
      case 'waitForAjax':
      case 'waitForPageLoad':
        await this.waitIdle(Number(target) || this.timeout, true);
        return null;
      case 'setSpeed':
        this.speed = Number(target) || 0;
        return null;
      case 'setTimeout':
        this.timeout = Number(target) || s.timeout;
        return null;
      case 'screenshot':
        await this.screenshot(target.trim(), value.trim().toLowerCase() === 'visible' ? 'visible' : 'page', pc, this.lastAction);
        return null;
      case 'storeUniqueId':
        this.setVar(value, FTEngine.uniqueId(target.trim()));
        return null;
      case 'createFile':
        this.createFile(value.trim(), target);
        return null;
    }

    if (meta.kind === 'script') {
      switch (name) {
        case 'executeScript':
        case 'executeAsyncScript': {
          const r = await this.script(target, this.timeout);
          if (value) this.setVar(value, r);
          break;
        }
        case 'runScript':
          await this.script(target, this.timeout);
          break;
        case 'storeEval':
          this.setVar(value, await this.script('return (' + target + '\n);', this.timeout));
          return null;
        case 'waitForCondition':
          await this.waitCondition(target, Number(value) || this.timeout);
          return null;
        case 'assertCondition':
        case 'verifyCondition':
          if (!(await this.condition(target))) throw new FTCmdError('Condition fausse : ' + cmd.target);
          return null;
      }
      if (s.autoWait) await this.afterAction();
      return null;
    }

    // Commandes DOM exécutées par le script de contenu.
    let timeout = this.timeout;
    let v = value;
    if (/^waitForElement/.test(name) && /^\d+$/.test(value.trim())) {
      timeout = Number(value);
      v = '';
    }
    const r = await this.domRetry({ type: 'exec', cmd: { command: name, target, value: v, files: name === 'uploadFile' ? this.filesFor(value) : undefined }, highlight: s.highlight }, timeout);
    if (r.store) this.setVar(r.store.name, r.store.value);
    if (meta.kind === 'action' && s.autoWait) await this.afterAction();
    return null;
  }

  // label 'ECHEC' : capture automatique après un échec, qui ne doit jamais masquer l'erreur d'origine.
  async screenshot(label, mode, pc, command) {
    if (!this.adapter.screenshot) return;
    try {
      const file = await this.adapter.screenshot({
        label, mode, command, test: this.testName || '', line: pc >= 0 ? pc + 1 : null
      });
      this.hooks.log('info', 'Capture enregistrée : ' + file);
    } catch (e) {
      if (label !== 'ECHEC') throw new FTCmdError('Capture impossible : ' + e.message);
      this.hooks.log('warn', 'Capture de l\'échec impossible : ' + e.message);
    }
  }

  // Ex. « etu-20260925-215930-k3f9 » : lisible, trié par date, sans collision entre deux exécutions.
  static uniqueId(prefix) {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    const stamp = d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
    const rnd = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
    return (prefix ? prefix + '-' : '') + stamp + '-' + rnd;
  }

  createFile(name, content) {
    if (!name) throw new FTCmdError('Nom de fichier manquant (colonne Valeur)');
    const base64 = content.startsWith('base64:');
    const data = base64 ? content.slice(7).replace(/\s+/g, '') : content;
    const ext = (name.split('.').pop() || '').toLowerCase();
    const type = FTEngine.MIME[ext] || 'application/octet-stream';
    this.files.set(name, { name, type, content: data, base64 });
    const size = base64 ? Math.floor(data.length * 3 / 4) - (data.match(/=*$/)[0].length) : new Blob([data]).size;
    this.hooks.log('var', 'Fichier « ' + name + ' » créé (' + size + ' octets)' +
      (base64 ? '' : ' : ' + (data.length > 300 ? data.slice(0, 300) + '…' : data)));
  }

  filesFor(value) {
    const names = value.split('\n').map(s => s.trim()).filter(Boolean);
    if (!names.length) throw new FTCmdError('Nom de fichier manquant (colonne Valeur)');
    return names.map(n => {
      const f = this.files.get(n);
      if (!f) throw new FTCmdError('Fichier « ' + n + ' » inconnu : créez-le avant avec createFile');
      return f;
    });
  }

  resolveUrl(target) {
    const t = String(target).trim();
    if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return t;
    const base = String(this.settings.baseUrl || '').replace(/\/+$/, '');
    if (!base) throw new FTCmdError('URL relative « ' + t + ' » mais aucune URL de base définie dans le projet');
    return base + (t.startsWith('/') ? t : '/' + t);
  }

  async selectFrame(target) {
    const t = target.trim();
    if (t === 'relative=top' || t === '') { this.frame = []; return null; }
    if (t === 'relative=parent') { this.frame = this.frame.slice(0, -1); return null; }
    const next = this.frame.concat([t]);
    await this.domRetry({ type: 'checkFrame', frame: next }, this.timeout);
    this.frame = next;
    return null;
  }

  // Envoie un message au script de contenu en réessayant tant que la page n'est pas prête.
  async domRetry(msg, timeout) {
    const deadline = Date.now() + timeout;
    let last = '';
    for (;;) {
      this.checkStop();
      let r;
      try {
        r = await this.send(Object.assign({ frame: this.frame }, msg));
      } catch (e) {
        r = null;
      }
      if (!r) r = { status: 'retry', message: 'Page non disponible (chargement en cours ?)' };
      if (r.status === 'ok') return r;
      if (r.status === 'fail') throw new FTCmdError(r.message);
      last = r.message;
      if (Date.now() >= deadline) throw new FTCmdError(last + ' (délai de ' + timeout + ' ms dépassé)');
      await this.sleep(100);
    }
  }

  // Une page déchargée pendant l'échange peut ne jamais répondre : on borne chaque message.
  send(msg) {
    let limit = 15000;
    if (msg.type === 'script') limit = (msg.timeout || 30000) + 2000;
    else if (msg.cmd) limit += 20 * String(msg.cmd.value || '').length;
    let timer;
    return Promise.race([
      Promise.resolve(this.adapter.send(msg)),
      new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Pas de réponse de la page')), limit); })
    ]).finally(() => clearTimeout(timer));
  }

  sendQuick(msg) {
    let timer;
    return Promise.race([
      Promise.resolve(this.adapter.send(msg)),
      new Promise((resolve, reject) => { timer = setTimeout(() => reject(new Error('Pas de réponse de la page')), 2000); })
    ]).finally(() => clearTimeout(timer));
  }

  async script(code, timeout) {
    const r = await this.domRetry({ type: 'script', code, vars: this.vars, timeout }, timeout);
    if (r.vars && typeof r.vars === 'object') {
      for (const [k, v] of Object.entries(r.vars)) {
        if (JSON.stringify(this.vars[k]) !== JSON.stringify(v)) this.setVar(k, v);
      }
    }
    return r.value;
  }

  async condition(expr) {
    return !!(await this.script('return (' + this.interpScript(expr) + '\n);', this.timeout));
  }

  async waitCondition(expr, timeout) {
    const deadline = Date.now() + timeout;
    for (;;) {
      let ok = false;
      try {
        ok = !!(await this.script('return (' + expr + '\n);', Math.max(1000, deadline - Date.now())));
      } catch (e) {
        if (Date.now() >= deadline) throw e;
      }
      if (ok) return;
      if (Date.now() >= deadline) throw new FTCmdError('Condition toujours fausse après ' + timeout + ' ms : ' + expr);
      await this.sleep(150);
    }
  }

  async afterAction() {
    await this.sleep(this.settings.postActionDelay);
    await this.waitIdle(this.settings.ajaxTimeout || this.timeout, false);
  }

  // Attend : pas de navigation, document chargé, aucune requête XHR/fetch, jQuery.active = 0,
  // M.util.pending_js vide ; le calme doit durer ~100 ms.
  async waitIdle(timeout, strict) {
    const deadline = Date.now() + timeout;
    let quietSince = null;
    let unavailable = 0;
    let last = '';
    for (;;) {
      this.checkStop();
      let a;
      try { a = await this.adapter.activity(); } catch (e) { a = null; }
      a = a || { loading: false, pending: 0, urls: [] };
      let st = null;
      if (!a.loading) {
        try { st = await this.sendQuick({ type: 'pageState' }); } catch (e) { st = null; }
      }
      let busy = null;
      if (a.loading) busy = 'chargement de la page';
      else if (!st) busy = ++unavailable > 40 ? null : 'page indisponible';
      else if (st.readyState !== 'complete') busy = 'document en cours de chargement';
      else if (a.pending) busy = a.pending + ' requête(s) AJAX en cours : ' + a.urls.join(', ');
      else if (st.jq) busy = 'jQuery.active = ' + st.jq;
      else if (st.pendingJs && st.pendingJs.length) busy = 'M.util.pending_js : ' + st.pendingJs.join(', ');
      if (st) unavailable = 0;

      const now = Date.now();
      if (!busy) {
        if (quietSince && now - quietSince >= 100) return true;
        if (!quietSince) quietSince = now;
      } else {
        quietSince = null;
        last = busy;
      }
      if (now >= deadline) {
        const m = 'Délai d\'attente dépassé (' + timeout + ' ms) : ' + last;
        if (strict) throw new FTCmdError(m);
        this.hooks.log('warn', m + ' — on continue');
        return false;
      }
      await this.sleep(50);
    }
  }

  // ---------- Structures de contrôle ----------

  async flow(cmd, pc) {
    const info = this.info;
    const cmds = this.currentCommands;
    const name = cmd.command;
    const me = info[pc];
    const maxLoops = this.settings.maxLoops || 1000;

    const countLoop = i => {
      const st = this.loops.get(i) || { n: 0 };
      st.n++;
      if (st.n > maxLoops) throw new FTCmdError('Plus de ' + maxLoops + ' tours de boucle');
      this.loops.set(i, st);
    };

    switch (name) {
      case 'if': {
        if (await this.condition(cmd.target)) return pc + 1;
        return this.nextBranch(pc, pc, cmds);
      }
      case 'elseIf':
      case 'else':
        return info[me.owner].end + 1;
      case 'end': {
        const owner = me.owner;
        return info[owner].type === 'if' ? pc + 1 : owner;
      }
      case 'while': {
        if (await this.condition(cmd.target)) { countLoop(pc); return pc + 1; }
        this.loops.delete(pc);
        return me.end + 1;
      }
      case 'times': {
        let st = this.loops.get(pc);
        if (!st) {
          const n = Number(this.interp(cmd.target));
          if (!Number.isFinite(n) || n < 0) throw new FTCmdError('Nombre invalide : ' + cmd.target);
          st = { n: 0, max: n };
          this.loops.set(pc, st);
        }
        if (st.n < st.max) { st.n++; return pc + 1; }
        this.loops.delete(pc);
        return me.end + 1;
      }
      case 'forEach': {
        let st = this.loops.get(pc);
        if (!st) {
          const arr = this.getVar(this.interp(cmd.target).trim());
          if (!Array.isArray(arr)) throw new FTCmdError('La variable « ' + cmd.target + ' » n\'est pas un tableau');
          st = { k: 0, arr };
          this.loops.set(pc, st);
        }
        if (st.k < st.arr.length) {
          this.setVar(this.interp(cmd.value).trim(), st.arr[st.k]);
          st.k++;
          return pc + 1;
        }
        this.loops.delete(pc);
        return me.end + 1;
      }
      case 'do':
        return pc + 1;
      case 'repeatIf': {
        if (await this.condition(cmd.target)) { countLoop(pc); return me.owner + 1; }
        this.loops.delete(pc);
        return pc + 1;
      }
    }
    throw new FTCmdError('Structure inconnue : ' + name);
  }

  async nextBranch(ifIdx, from, cmds) {
    const own = this.info[ifIdx];
    for (;;) {
      const b = own.branches.find(x => x > from);
      if (b == null) return own.end + 1;
      if (cmds[b].command === 'else') return b + 1;
      this.hooks.status(b, 'running');
      if (await this.condition(cmds[b].target)) { this.hooks.status(b, 'ok'); return b + 1; }
      this.hooks.status(b, 'ok');
      from = b;
    }
  }
}

FTEngine.MIME = {
  txt: 'text/plain', csv: 'text/csv', json: 'application/json', xml: 'application/xml', html: 'text/html',
  htm: 'text/html', md: 'text/markdown', pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg',
  jpeg: 'image/jpeg', gif: 'image/gif', svg: 'image/svg+xml', zip: 'application/zip', mbz: 'application/vnd.moodle.backup',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  odt: 'application/vnd.oasis.opendocument.text', mp3: 'audio/mpeg', mp4: 'video/mp4'
};
FTEngine.FLOW = new Set(['if', 'elseIf', 'else', 'end', 'while', 'times', 'forEach', 'do', 'repeatIf']);

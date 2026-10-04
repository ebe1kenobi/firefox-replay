'use strict';

// Modèle de projet, au format .side de Selenium IDE (version 2.0).
const FTProject = {
  uid() {
    return crypto.randomUUID();
  },

  newCommand(command, target, value) {
    return { id: this.uid(), comment: '', command: command || '', target: target || '', targets: [], value: value || '' };
  },

  newTest(name) {
    return { id: this.uid(), name: name || 'Nouveau test', commands: [] };
  },

  newProject() {
    const t = this.newTest('Test 1');
    return {
      id: this.uid(),
      version: '2.0',
      name: 'Nouveau projet',
      url: '',
      tests: [t],
      suites: [{ id: this.uid(), name: 'Suite par défaut', persistSession: false, parallel: false, timeout: 300, tests: [t.id] }],
      urls: [],
      plugins: []
    };
  },

  normalizeCommand(c) {
    const str = v => (v == null ? '' : String(v));
    const cmd = {
      id: str(c.id) || this.uid(),
      comment: str(c.comment),
      command: str(c.command),
      target: str(c.target),
      targets: Array.isArray(c.targets)
        ? c.targets.filter(t => Array.isArray(t) && t.length).map(t => [str(t[0]), str(t[1])])
        : [],
      value: str(c.value)
    };
    if (c.breakpoint) cmd.breakpoint = true;
    return cmd;
  },

  normalizeTest(t) {
    return {
      id: String(t.id || this.uid()),
      name: String(t.name || 'Test sans nom'),
      commands: (Array.isArray(t.commands) ? t.commands : []).map(c => this.normalizeCommand(c || {}))
    };
  },

  // Accepte un .side complet, ou un test seul { name, commands }.
  parse(text) {
    let o;
    try { o = JSON.parse(text); } catch (e) { throw new Error('Fichier JSON invalide : ' + e.message); }
    if (o && Array.isArray(o.commands) && !o.tests) o = { name: o.name, tests: [o] };
    if (!o || !Array.isArray(o.tests)) throw new Error('Ce fichier ne contient pas de tests (format .side attendu)');
    const tests = o.tests.map(t => this.normalizeTest(t || {}));
    const ids = new Set(tests.map(t => t.id));
    const suites = (Array.isArray(o.suites) ? o.suites : []).map(s => ({
      id: String(s.id || this.uid()),
      name: String(s.name || 'Suite'),
      persistSession: !!s.persistSession,
      parallel: !!s.parallel,
      timeout: Number(s.timeout) || 300,
      tests: (Array.isArray(s.tests) ? s.tests : []).map(String).filter(id => ids.has(id))
    }));
    return {
      id: String(o.id || this.uid()),
      version: '2.0',
      name: String(o.name || 'Projet importé'),
      url: String(o.url || ''),
      tests: tests.length ? tests : [this.newTest('Test 1')],
      suites,
      urls: Array.isArray(o.urls) ? o.urls.map(String) : [],
      plugins: Array.isArray(o.plugins) ? o.plugins : []
    };
  },

  serialize(project) {
    const p = JSON.parse(JSON.stringify(project));
    if (p.url && !p.urls.includes(p.url)) p.urls.unshift(p.url);
    return JSON.stringify(p, null, 2);
  },

  // Ajoute les tests de `other` au projet (les ids en double sont régénérés).
  merge(project, other) {
    const ids = new Set(project.tests.map(t => t.id));
    const names = new Set(project.tests.map(t => t.name));
    const added = [];
    for (const t of other.tests) {
      const copy = this.normalizeTest(t);
      if (ids.has(copy.id)) copy.id = this.uid();
      let name = copy.name, n = 2;
      while (names.has(name)) name = copy.name + ' (' + n++ + ')';
      copy.name = name;
      ids.add(copy.id);
      names.add(name);
      project.tests.push(copy);
      added.push(copy);
    }
    if (!project.url && other.url) project.url = other.url;
    return added;
  },

  // ---------- Bibliothèque : plusieurs projets, et des scénarios qui les enchaînent ----------

  newScenario(name) {
    return { id: this.uid(), name: name || 'Nouveau scénario', url: '', stopOnFailure: false, items: [] };
  },

  normalizeLibrary(lib) {
    const projects = [];
    for (const p of (lib && Array.isArray(lib.projects) ? lib.projects : [])) {
      try { projects.push(this.parse(JSON.stringify(p))); } catch (e) { /* projet illisible ignoré */ }
    }
    if (!projects.length) projects.push(this.newProject());
    const ids = new Set(projects.map(p => p.id));
    const scenarios = (lib && Array.isArray(lib.scenarios) ? lib.scenarios : []).map(s => ({
      id: String(s.id || this.uid()),
      name: String(s.name || 'Scénario'),
      url: String(s.url || ''),
      stopOnFailure: !!s.stopOnFailure,
      items: (Array.isArray(s.items) ? s.items : []).map(String).filter(id => ids.has(id))
    }));
    return { projects, scenarios };
  },

  // Fichier d'échange d'un scénario : le scénario et tous ses projets.
  serializeScenario(scenario, projects) {
    const used = [...new Set(scenario.items)].map(id => projects.find(p => p.id === id)).filter(Boolean);
    return JSON.stringify({ format: 'ftide-scenario', version: 1, scenario, projects: used }, null, 2);
  },

  // Renvoie { kind: 'project', project } ou { kind: 'scenario', scenario, projects }.
  parseAny(text) {
    let o;
    try { o = JSON.parse(text); } catch (e) { throw new Error('Fichier JSON invalide : ' + e.message); }
    if (o && o.format === 'ftide-scenario') {
      const projects = (Array.isArray(o.projects) ? o.projects : []).map(p => this.parse(JSON.stringify(p)));
      const lib = this.normalizeLibrary({ projects, scenarios: [o.scenario || {}] });
      return { kind: 'scenario', scenario: lib.scenarios[0], projects };
    }
    return { kind: 'project', project: this.parse(text) };
  },

  cloneTest(t) {
    const c = this.normalizeTest(JSON.parse(JSON.stringify(t)));
    c.id = this.uid();
    c.commands.forEach(cmd => { cmd.id = this.uid(); });
    return c;
  }
};

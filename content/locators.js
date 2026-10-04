'use strict';

// Résolution et génération de localisateurs, format Selenium IDE :
// id=, name=, css=, xpath=, linkText=, partialLinkText=, label=, index= (cadres).
var FTLocators = (function () {
  const PREFIXES = new Set(['id', 'name', 'css', 'xpath', 'link', 'linkText', 'partialLinkText', 'label', 'identifier']);

  const norm = s => String(s == null ? '' : s).replace(/[\s ]+/g, ' ').trim();

  function parse(locator) {
    const loc = String(locator || '').trim();
    const m = /^([a-zA-Z]+)=([\s\S]*)$/.exec(loc);
    if (m && PREFIXES.has(m[1])) return { kind: m[1], value: m[2] };
    if (loc.startsWith('//') || loc.startsWith('(/')) return { kind: 'xpath', value: loc };
    return { kind: 'identifier', value: loc };
  }

  function byXPath(expr, doc) {
    const out = [];
    const snap = doc.evaluate(expr, doc, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    for (let i = 0; i < snap.snapshotLength; i++) {
      const n = snap.snapshotItem(i);
      if (n.nodeType === 1) out.push(n);
    }
    return out;
  }

  function labelControl(label) {
    if (label.control) return label.control;
    const f = label.getAttribute('for');
    if (f) return label.ownerDocument.getElementById(f);
    return label.querySelector('input,select,textarea');
  }

  function byLabel(text, doc) {
    const want = norm(text);
    const labels = [...doc.querySelectorAll('label')];
    let hits = labels.filter(l => norm(l.textContent) === want);
    if (!hits.length) hits = labels.filter(l => norm(l.textContent).startsWith(want));
    const out = hits.map(labelControl).filter(Boolean);
    for (const el of doc.querySelectorAll('[aria-label]')) {
      if (norm(el.getAttribute('aria-label')) === want) out.push(el);
    }
    return [...new Set(out)];
  }

  function findAll(locator, doc) {
    const { kind, value } = parse(locator);
    if (!value) return [];
    switch (kind) {
      case 'id': {
        const el = doc.getElementById(value);
        return el ? [el] : [];
      }
      case 'name':
        return [...doc.getElementsByName(value)];
      case 'identifier': {
        const el = doc.getElementById(value);
        return el ? [el] : [...doc.getElementsByName(value)];
      }
      case 'css':
        return [...doc.querySelectorAll(value)];
      case 'xpath':
        return byXPath(value, doc);
      case 'link':
      case 'linkText': {
        const want = norm(value);
        return [...doc.querySelectorAll('a')].filter(a => norm(a.textContent) === want);
      }
      case 'partialLinkText': {
        const want = norm(value);
        return [...doc.querySelectorAll('a')].filter(a => norm(a.textContent).includes(want));
      }
      case 'label':
        return byLabel(value, doc);
    }
    return [];
  }

  function find(locator, doc) {
    return findAll(locator, doc)[0] || null;
  }

  // ---------- Génération ----------

  // Rejette les id générés (YUI de Moodle, uniqid, compteurs longs).
  function stableId(id) {
    if (!id) return false;
    if (/^yui_/i.test(id)) return false;
    if (/\d{5,}/.test(id)) return false;
    if (/[0-9a-f]{10,}/i.test(id) && /\d/.test(id)) return false;
    if (/^(ember|react|ext-gen|ui-id-)/i.test(id)) return false;
    return true;
  }

  const UNSTABLE_CLASS = /^(active|show|showing|focus|focused|hover|collapsed|selected|open|disabled|visible|hidden|is-|js-|yui|d-|p[xytblr]?-|m[xytblr]?-|text-|bg-|w-|h-|col-|justify-|align-|flex-|float-|border|rounded|shadow|position-|sr-only)/i;

  function stableClasses(el) {
    return [...el.classList].filter(c => !UNSTABLE_CLASS.test(c) && !/\d{3,}/.test(c) && c.length < 40);
  }

  const cssEsc = s => (window.CSS && CSS.escape) ? CSS.escape(s) : String(s).replace(/([^\w-])/g, '\\$1');
  const attrEsc = s => String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  function xpathLiteral(s) {
    if (!s.includes("'")) return "'" + s + "'";
    if (!s.includes('"')) return '"' + s + '"';
    return 'concat(' + s.split("'").map(p => "'" + p + "'").join(', "\'", ') + ')';
  }

  function isUnique(locator, el) {
    try {
      const all = findAll(locator, el.ownerDocument);
      return all.length === 1 && all[0] === el;
    } catch (e) {
      return false;
    }
  }

  function segment(el) {
    const tag = el.localName;
    if (el.id && stableId(el.id)) return '#' + cssEsc(el.id);
    let seg = tag;
    const cls = stableClasses(el).slice(0, 2);
    if (cls.length) seg += cls.map(c => '.' + cssEsc(c)).join('');
    const parent = el.parentElement;
    if (parent) {
      const same = [...parent.children].filter(c => c.localName === tag);
      if (same.length > 1) {
        const sameSeg = cls.length ? same.filter(c => cls.every(k => c.classList.contains(k))) : same;
        if (sameSeg.length > 1) seg += ':nth-of-type(' + (same.indexOf(el) + 1) + ')';
      }
    }
    return seg;
  }

  function cssPath(el) {
    const doc = el.ownerDocument;
    const parts = [];
    let cur = el;
    for (let depth = 0; cur && cur.nodeType === 1 && depth < 12; depth++) {
      parts.unshift(segment(cur));
      const sel = parts.join(' > ');
      try {
        const all = doc.querySelectorAll(sel);
        if (all.length === 1 && all[0] === el) return sel;
      } catch (e) { /* sélecteur invalide : on continue */ }
      if (cur.localName === 'html') break;
      cur = cur.parentElement;
    }
    return null;
  }

  function absXPath(el) {
    const parts = [];
    for (let cur = el; cur && cur.nodeType === 1; cur = cur.parentElement) {
      const tag = cur.localName;
      const parent = cur.parentElement;
      let idx = '';
      if (parent) {
        const same = [...parent.children].filter(c => c.localName === tag);
        if (same.length > 1) idx = '[' + (same.indexOf(cur) + 1) + ']';
      }
      parts.unshift(tag + idx);
    }
    return '/' + parts.join('/');
  }

  const TEXT_TAGS = new Set(['a', 'button', 'label', 'span', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'td', 'th', 'div', 'p', 'strong', 'summary', 'legend', 'option', 'dt', 'dd']);

  function labelTextFor(el) {
    if (!/^(input|select|textarea)$/.test(el.localName)) return null;
    const labels = el.labels ? [...el.labels] : [];
    for (const l of labels) {
      const t = norm(l.textContent);
      if (t && t.length < 80) return t;
    }
    return null;
  }

  function build(el) {
    const out = [];
    const add = (loc, kind) => {
      if (!loc || out.some(o => o[0] === loc)) return;
      if (isUnique(loc, el)) out.push([loc, kind]);
    };
    const tag = el.localName;

    if (el.id && stableId(el.id)) add('id=' + el.id, 'id');
    const name = el.getAttribute('name');
    if (name && !/\d{5,}/.test(name)) add('name=' + name, 'name');

    const lt = labelTextFor(el);
    if (lt) add('label=' + lt, 'label');

    if (tag === 'a') {
      const t = norm(el.textContent);
      if (t && t.length < 80) add('linkText=' + t, 'linkText');
    }

    for (const attr of ['data-testid', 'data-action', 'data-region', 'data-key', 'data-value', 'aria-label', 'title', 'placeholder', 'data-type']) {
      const v = el.getAttribute(attr);
      if (v && v.length < 80 && !/\d{5,}/.test(v)) add('css=' + tag + '[' + attr + '="' + attrEsc(v) + '"]', 'css:attributes');
    }
    if ((tag === 'input' || tag === 'button') && /^(submit|button|reset)$/.test(el.type) && el.value && el.value.length < 60) {
      add('css=' + tag + '[value="' + attrEsc(el.value) + '"]', 'css:attributes');
    }

    if (TEXT_TAGS.has(tag)) {
      const t = norm(el.textContent);
      if (t && t.length < 60 && el.children.length < 4) {
        add('xpath=//' + tag + '[normalize-space()=' + xpathLiteral(t) + ']', 'xpath:innerText');
      }
    }

    const css = cssPath(el);
    if (css) add('css=' + css, 'css:finder');

    if (tag === 'a') {
      const href = el.getAttribute('href');
      if (href && !href.startsWith('javascript:') && !/sesskey=/.test(href) && href.length < 150) {
        add('xpath=//a[@href=' + xpathLiteral(href) + ']', 'xpath:href');
      }
    }

    add('xpath=' + absXPath(el), 'xpath:position');
    return out;
  }

  // Localisateur d'un <iframe> dans son document parent.
  function frameLocator(frameEl) {
    const locs = build(frameEl);
    if (locs.length) return locs[0][0];
    const doc = frameEl.ownerDocument;
    const idx = [...doc.querySelectorAll('iframe,frame')].indexOf(frameEl);
    return 'index=' + idx;
  }

  function resolveFrame(doc, locator) {
    const loc = String(locator).trim();
    let frameEl;
    const m = /^index=(\d+)$/.exec(loc);
    if (m) frameEl = doc.querySelectorAll('iframe,frame')[Number(m[1])];
    else frameEl = find(loc, doc);
    if (!frameEl) throw new Error('Cadre introuvable : ' + loc);
    let inner;
    try { inner = frameEl.contentDocument; } catch (e) { inner = null; }
    if (!inner) throw new Error('Cadre inaccessible (autre origine ?) : ' + loc);
    return inner;
  }

  return { norm, parse, findAll, find, build, frameLocator, resolveFrame, stableId };
})();

'use strict';

(function () {
  if (window.__ftideLoaded) return;
  window.__ftideLoaded = true;

  const L = FTLocators;
  const isRoot = w => { try { return !!w.__ftideTop || w === w.top; } catch (e) { return true; } };
  const IS_TOP = isRoot(window);
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function send(msg) {
    try { browser.runtime.sendMessage(msg).catch(() => {}); } catch (e) { /* extension rechargée */ }
  }

  // Chemin de localisateurs d'iframes depuis le document racine ; null si un cadre est d'une autre origine.
  function framePath() {
    const path = [];
    let w = window;
    try {
      while (!isRoot(w)) {
        const fe = w.frameElement;
        if (!fe) return null;
        path.unshift(L.frameLocator(fe));
        w = w.parent;
      }
    } catch (e) {
      return null;
    }
    return path;
  }

  const textOf = el => L.norm(typeof el.innerText === 'string' ? el.innerText : el.textContent);

  // =====================================================================
  // Enregistrement
  // =====================================================================

  let recording = false;
  let lastClick = null;
  let lastEnter = null;
  let editState = null;
  const lastValue = new WeakMap();

  const TEXT_TYPES = new Set(['text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'time',
    'datetime-local', 'month', 'week', 'color', 'range']);
  const isTextInput = el => el.localName === 'textarea' ||
    (el.localName === 'input' && TEXT_TYPES.has((el.type || 'text').toLowerCase()));

  const INTERACTIVE = 'a[href],button,input,select,textarea,label,summary,[role=button],[role=link],' +
    '[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=tab],[role=option],[role=checkbox],' +
    '[role=radio],[role=switch],[role=treeitem],[onclick],[data-action],[data-toggle],[data-bs-toggle]';
  const clickTarget = t => (t.closest && t.closest(INTERACTIVE)) || t;

  function record(command, el, value, comment) {
    const targets = el ? L.build(el) : [];
    send({
      type: 'record',
      cmd: {
        command, target: targets.length ? targets[0][0] : '', targets,
        value: value == null ? '' : String(value), comment: comment || ''
      },
      frame: framePath()
    });
  }

  function editableHost(t) {
    if (!t || t.nodeType !== 1 || !t.isContentEditable) return null;
    let h = t;
    while (h.parentElement && h.parentElement.isContentEditable) h = h.parentElement;
    return h;
  }

  function flushEdit() {
    if (!editState) return;
    const el = editState.el;
    clearTimeout(editState.timer);
    editState = null;
    if (recording) record('editContent', el, el.innerHTML);
  }

  function flushType(el) {
    if (isTextInput(el) && lastValue.get(el) !== el.value) {
      lastValue.set(el, el.value);
      record('type', el, el.value);
    }
  }

  window.addEventListener('click', e => {
    if (picking || !recording || !e.isTrusted || e.button !== 0) return;
    const t = e.target;
    if (!t || t.nodeType !== 1) return;
    flushEdit();
    if (t.closest('select') || t.localName === 'option') return;
    if (isTextInput(t) || t.isContentEditable) return;
    const el = clickTarget(t);
    if (el.localName === 'html' || el.localName === 'body') return;
    const fileInput = el.localName === 'label' ? el.control : el;
    if (fileInput && fileInput.localName === 'input' && fileInput.type === 'file') return;
    const now = Date.now();
    // Entrée dans un champ déclenche un clic simulé sur le bouton d'envoi : déjà couvert par sendKeys.
    if (lastEnter && now - lastEnter.t < 500 && e.detail === 0 && el.form && el.form === lastEnter.form) return;
    // Un clic sur un <label> relance un clic sur son contrôle : on n'en garde qu'un.
    if (lastClick && now - lastClick.t < 400 && lastClick.el.localName === 'label' &&
        lastClick.el.control === el) return;
    lastClick = { el, t: now };
    record('click', el);
  }, true);

  window.addEventListener('dblclick', e => {
    if (picking || !recording || !e.isTrusted) return;
    const t = e.target;
    if (!t || t.nodeType !== 1 || isTextInput(t)) return;
    const el = clickTarget(t);
    const targets = L.build(el);
    send({
      type: 'record',
      cmd: { command: 'doubleClick', target: targets.length ? targets[0][0] : '', targets, value: '' },
      frame: framePath(),
      collapseClicks: true
    });
  }, true);

  window.addEventListener('change', e => {
    if (!recording || !e.isTrusted) return;
    const t = e.target;
    if (!t || t.nodeType !== 1) return;
    if (t.localName === 'select') {
      if (t.multiple) {
        for (const opt of t.selectedOptions) record('addSelection', t, 'label=' + L.norm(opt.textContent));
      } else {
        const opt = t.options[t.selectedIndex];
        if (opt) record('select', t, 'label=' + L.norm(opt.textContent));
      }
    } else if (t.localName === 'input' && t.type === 'file') {
      const names = [...t.files].map(f => f.name).join('\n');
      if (names) record('uploadFile', t, names, 'à créer avant avec createFile');
    } else {
      flushType(t);
    }
  }, true);

  const RECORDED_KEYS = { Enter: 'KEY_ENTER', Escape: 'KEY_ESC', ArrowDown: 'KEY_DOWN', ArrowUp: 'KEY_UP' };
  window.addEventListener('keydown', e => {
    if (!recording || !e.isTrusted) return;
    const t = e.target;
    const k = RECORDED_KEYS[e.key];
    if (!k || !t || t.nodeType !== 1 || !isTextInput(t)) return;
    if (t.localName === 'textarea' && e.key === 'Enter') return;
    if (e.key === 'Enter') lastEnter = { form: t.form, t: Date.now() };
    flushType(t);
    record('sendKeys', t, '${' + k + '}');
  }, true);

  window.addEventListener('input', e => {
    if (!recording) return;
    const host = editableHost(e.target);
    if (!host) return;
    if (editState && editState.el !== host) flushEdit();
    if (!editState) editState = { el: host, timer: 0 };
    clearTimeout(editState.timer);
    editState.timer = setTimeout(flushEdit, 1500);
  }, true);
  window.addEventListener('focusout', () => flushEdit(), true);
  window.addEventListener('blur', () => flushEdit());

  function contextRecord(msg) {
    let el = null;
    try { el = browser.menus.getTargetElement(msg.elementId); } catch (e) { el = null; }
    if (!el) return;
    if (el.nodeType !== 1) el = el.parentElement;
    const c = msg.command;
    let value = '';
    if (c === 'waitForText' || c === 'assertText' || c === 'verifyText') value = textOf(el);
    else if (c === 'storeText') value = 'texte';
    else if (c === 'assertValue') value = el.value == null ? '' : el.value;
    if (c === 'click') el = clickTarget(el);
    record(c, el, value);
  }

  try {
    browser.runtime.sendMessage({ type: 'getRecordingState' })
      .then(r => { if (r && r.recording) recording = true; })
      .catch(() => {});
  } catch (e) { /* ignore */ }

  // =====================================================================
  // Sélecteur d'élément (bouton « cible » du panneau)
  // =====================================================================

  let picking = false;
  let hovered = null;

  function outline(el, on) {
    if (!el || !el.style) return;
    if (on) {
      if (el.__ftideOutline === undefined) el.__ftideOutline = el.style.outline;
      el.style.outline = '2px solid #e8413c';
    } else if (el.__ftideOutline !== undefined) {
      el.style.outline = el.__ftideOutline;
      delete el.__ftideOutline;
    }
  }

  function setPick(on) {
    picking = on;
    if (!on && hovered) { outline(hovered, false); hovered = null; }
  }

  window.addEventListener('mouseover', e => {
    if (!picking) return;
    if (hovered) outline(hovered, false);
    hovered = e.target.nodeType === 1 ? e.target : null;
    outline(hovered, true);
  }, true);

  for (const type of ['mousedown', 'mouseup', 'pointerdown', 'pointerup']) {
    window.addEventListener(type, e => {
      if (picking) { e.preventDefault(); e.stopPropagation(); }
    }, true);
  }
  window.addEventListener('click', e => {
    if (!picking) return;
    e.preventDefault();
    e.stopPropagation();
    const el = e.target.nodeType === 1 ? e.target : e.target.parentElement;
    setPick(false);
    send({ type: 'picked', targets: L.build(el), frame: framePath() });
  }, true);
  window.addEventListener('keydown', e => {
    if (picking && e.key === 'Escape') {
      setPick(false);
      send({ type: 'picked', targets: null });
    }
  }, true);

  function flash(el, ms) {
    outline(el, true);
    setTimeout(() => outline(el, false), ms);
  }

  // =====================================================================
  // Exécution des commandes (cadre racine uniquement)
  // =====================================================================

  class Retry extends Error {}
  class Fail extends Error {}
  const retry = m => { throw new Retry(m); };
  const fail = m => { throw new Fail(m); };

  function docFor(frame) {
    let doc = document;
    for (const loc of frame || []) {
      try { doc = L.resolveFrame(doc, loc); } catch (e) { retry(e.message); }
    }
    return doc;
  }

  function isVisible(el) {
    if (!el.isConnected) return false;
    if (typeof el.checkVisibility === 'function') {
      if (!el.checkVisibility({ checkVisibilityCSS: true, visibilityProperty: true })) return false;
    } else {
      const cs = el.ownerDocument.defaultView.getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
    }
    return el.getClientRects().length > 0;
  }

  const isDisabled = el => !!el.disabled || el.getAttribute('aria-disabled') === 'true';
  const isEditable = el => el.isContentEditable ||
    (('value' in el) && /^(input|textarea|select)$/.test(el.localName) && !el.disabled && !el.readOnly);

  function findAll(ctx, locator) {
    try {
      return L.findAll(locator, ctx.doc);
    } catch (e) {
      fail('Localisateur invalide « ' + locator + ' » : ' + e.message);
    }
  }

  function getEl(ctx, opts) {
    const o = opts || {};
    const all = findAll(ctx, ctx.target);
    if (!all.length) retry('Élément introuvable : ' + ctx.target);
    let el = all[0];
    if (o.visible) {
      el = all.find(isVisible);
      if (!el) retry('Élément présent mais invisible : ' + ctx.target);
    }
    if (o.enabled && isDisabled(el)) retry('Élément désactivé : ' + ctx.target);
    if (ctx.highlight) flash(el, 400);
    return el;
  }

  function matches(actual, pattern) {
    const p = String(pattern == null ? '' : pattern);
    let m;
    try {
      if ((m = /^regexp(i?):([\s\S]*)$/.exec(p))) return new RegExp(m[2], m[1] ? 'i' : '').test(actual);
    } catch (e) {
      fail('Expression régulière invalide : ' + e.message);
    }
    if (p.startsWith('contains:')) return actual.includes(L.norm(p.slice(9)));
    if (p.startsWith('exact:')) return actual === p.slice(6);
    if (p.startsWith('glob:')) {
      const re = p.slice(5).replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[\\s\\S]*').replace(/\?/g, '.');
      return new RegExp('^' + re + '$').test(actual);
    }
    return actual === L.norm(p);
  }

  // ---------- Événements synthétiques ----------

  function fireMouse(el, type, detail) {
    const r = el.getBoundingClientRect();
    const init = {
      bubbles: true, cancelable: true, composed: true,
      clientX: r.left + r.width / 2, clientY: r.top + r.height / 2,
      button: 0, buttons: /down$/.test(type) ? 1 : 0, detail: detail || 1
    };
    let ev;
    if (type.startsWith('pointer') && typeof PointerEvent === 'function') {
      ev = new PointerEvent(type, Object.assign(init, { pointerId: 1, pointerType: 'mouse', isPrimary: true }));
    } else {
      ev = new MouseEvent(type, init);
    }
    return el.dispatchEvent(ev);
  }

  function doClick(el, detail) {
    el.scrollIntoView({ block: 'center', inline: 'nearest' });
    fireMouse(el, 'pointerover');
    fireMouse(el, 'mouseover');
    fireMouse(el, 'pointerdown');
    const ok = fireMouse(el, 'mousedown', detail);
    if (ok && typeof el.focus === 'function') el.focus({ preventScroll: true });
    fireMouse(el, 'pointerup');
    fireMouse(el, 'mouseup', detail);
    if (typeof el.click === 'function') el.click();
    else fireMouse(el, 'click', detail);
  }

  const fire = (el, type) => el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }));
  const fireInput = (el, data) => {
    let ev;
    try { ev = new InputEvent('input', { bubbles: true, inputType: 'insertText', data: data || null }); }
    catch (e) { ev = new Event('input', { bubbles: true }); }
    el.dispatchEvent(ev);
  };

  const KEY_TOKENS = {
    KEY_ENTER: 'Enter', KEY_RETURN: 'Enter', KEY_TAB: 'Tab', KEY_ESC: 'Escape', KEY_ESCAPE: 'Escape',
    KEY_BACKSPACE: 'Backspace', KEY_BKSP: 'Backspace', KEY_DELETE: 'Delete', KEY_DEL: 'Delete',
    KEY_SPACE: ' ', KEY_LEFT: 'ArrowLeft', KEY_UP: 'ArrowUp', KEY_RIGHT: 'ArrowRight', KEY_DOWN: 'ArrowDown',
    KEY_HOME: 'Home', KEY_END: 'End', KEY_PAGE_UP: 'PageUp', KEY_PGUP: 'PageUp',
    KEY_PAGE_DOWN: 'PageDown', KEY_PGDN: 'PageDown'
  };
  const KEY_CODES = {
    Enter: 13, Tab: 9, Escape: 27, Backspace: 8, Delete: 46, ' ': 32, ArrowLeft: 37, ArrowUp: 38,
    ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, PageUp: 33, PageDown: 34
  };

  function parseKeys(s) {
    const out = [];
    const re = /\$\{(KEY_[A-Z_]+)\}/g;
    let last = 0, m;
    while ((m = re.exec(s))) {
      for (const ch of s.slice(last, m.index)) out.push({ char: ch });
      const k = KEY_TOKENS[m[1]];
      if (k) out.push(k === ' ' ? { char: ' ' } : { key: k });
      else for (const ch of m[0]) out.push({ char: ch });
      last = re.lastIndex;
    }
    for (const ch of s.slice(last)) out.push({ char: ch });
    return out;
  }

  function fireKey(el, type, key) {
    const isChar = key.length === 1;
    const code = isChar ? key.toUpperCase().charCodeAt(0) : (KEY_CODES[key] || 0);
    const init = {
      key, bubbles: true, cancelable: true, composed: true,
      keyCode: type === 'keypress' ? (isChar ? key.charCodeAt(0) : code) : code,
      charCode: type === 'keypress' && isChar ? key.charCodeAt(0) : 0,
      which: type === 'keypress' && isChar ? key.charCodeAt(0) : code
    };
    return el.dispatchEvent(new KeyboardEvent(type, init));
  }

  function insertText(el, text) {
    if (el.isContentEditable) {
      el.ownerDocument.execCommand('insertText', false, text);
      return;
    }
    if (!('value' in el)) return;
    try {
      const s = el.selectionStart, e = el.selectionEnd;
      if (typeof s === 'number') { el.setRangeText(text, s, e, 'end'); fireInput(el, text); return; }
    } catch (err) { /* types sans sélection (number, email...) */ }
    el.value = String(el.value) + text;
    fireInput(el, text);
  }

  function deleteBack(el) {
    if (el.isContentEditable) { el.ownerDocument.execCommand('delete'); return; }
    if (!('value' in el)) return;
    const v = String(el.value);
    try {
      const s = el.selectionStart, e = el.selectionEnd;
      if (typeof s === 'number') {
        if (s !== e) el.setRangeText('', s, e, 'end');
        else if (s > 0) el.setRangeText('', s - 1, s, 'end');
        fireInput(el);
        return;
      }
    } catch (err) { /* ignore */ }
    el.value = v.slice(0, -1);
    fireInput(el);
  }

  function submitFromEnter(el) {
    if (el.localName === 'textarea' || el.isContentEditable) { insertText(el, '\n'); return; }
    if (el.localName === 'button' || el.localName === 'a') { el.click(); return; }
    const form = el.form;
    if (el.localName !== 'input' || !form) return;
    const btn = [...form.elements].find(b =>
      (b.localName === 'button' && (b.type || 'submit') === 'submit') ||
      (b.localName === 'input' && (b.type === 'submit' || b.type === 'image')));
    if (btn) { if (!btn.disabled) btn.click(); return; }
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.submit();
  }

  function focusNext(el) {
    const doc = el.ownerDocument;
    const all = [...doc.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])')]
      .filter(x => !x.disabled && isVisible(x));
    const i = all.indexOf(el);
    const next = all[i + 1];
    if (next) { fire(el, 'change'); next.focus(); }
  }

  function findOption(sel, spec) {
    const s = String(spec);
    const m = /^(label|value|index|id)=([\s\S]*)$/.exec(s);
    const kind = m ? m[1] : 'label';
    const v = m ? m[2] : s;
    const opts = [...sel.options];
    switch (kind) {
      case 'value': return opts.find(o => o.value === v);
      case 'index': return opts[Number(v)];
      case 'id': return opts.find(o => o.id === v);
      default: return opts.find(o => matches(L.norm(o.textContent), v));
    }
  }

  // ---------- Vérifications (familles assert / verify / waitFor) ----------

  function attrTarget(ctx) {
    const i = ctx.target.lastIndexOf('@');
    if (i < 0) fail('Cible attendue : localisateur@attribut');
    return { loc: ctx.target.slice(0, i), attr: ctx.target.slice(i + 1) };
  }

  const bodyText = doc => textOf(doc.body || doc.documentElement);
  const q = s => '« ' + s + ' »';

  // Chaque vérification renvoie [réussi, message d'échec].
  const CHECKS = {
    Text: ctx => { const a = textOf(getEl(ctx)); return [matches(a, ctx.value), 'texte ' + q(a) + ', attendu ' + q(ctx.value)]; },
    NotText: ctx => { const a = textOf(getEl(ctx)); return [!matches(a, ctx.value), 'texte ' + q(a) + ' non désiré']; },
    Value: ctx => { const a = String(getEl(ctx).value); return [matches(a, ctx.value), 'valeur ' + q(a) + ', attendue ' + q(ctx.value)]; },
    NotValue: ctx => { const a = String(getEl(ctx).value); return [!matches(a, ctx.value), 'valeur ' + q(a) + ' non désirée']; },
    ElementPresent: ctx => [findAll(ctx, ctx.target).length > 0, 'élément absent : ' + ctx.target],
    ElementNotPresent: ctx => [findAll(ctx, ctx.target).length === 0, 'élément présent : ' + ctx.target],
    ElementVisible: ctx => [findAll(ctx, ctx.target).some(isVisible), 'élément non visible : ' + ctx.target],
    ElementNotVisible: ctx => [!findAll(ctx, ctx.target).some(isVisible), 'élément visible : ' + ctx.target],
    Editable: ctx => [isEditable(getEl(ctx)), 'élément non modifiable'],
    NotEditable: ctx => [!isEditable(getEl(ctx)), 'élément modifiable'],
    Checked: ctx => [!!getEl(ctx).checked, 'case non cochée'],
    NotChecked: ctx => [!getEl(ctx).checked, 'case cochée'],
    SelectedLabel: ctx => {
      const el = getEl(ctx);
      const o = el.options && el.options[el.selectedIndex];
      const a = o ? L.norm(o.textContent) : '';
      return [matches(a, ctx.value), 'option ' + q(a) + ', attendue ' + q(ctx.value)];
    },
    SelectedValue: ctx => { const a = String(getEl(ctx).value); return [matches(a, ctx.value), 'valeur ' + q(a) + ', attendue ' + q(ctx.value)]; },
    NotSelectedValue: ctx => { const a = String(getEl(ctx).value); return [!matches(a, ctx.value), 'valeur ' + q(a) + ' non désirée']; },
    Title: ctx => { const a = L.norm(ctx.doc.title); return [matches(a, ctx.target), 'titre ' + q(a) + ', attendu ' + q(ctx.target)]; },
    TextPresent: ctx => [bodyText(ctx.doc).includes(L.norm(ctx.target)), 'texte absent de la page : ' + q(ctx.target)],
    TextNotPresent: ctx => [!bodyText(ctx.doc).includes(L.norm(ctx.target)), 'texte présent dans la page : ' + q(ctx.target)],
    Attribute: ctx => {
      const { loc, attr } = attrTarget(ctx);
      const el = getEl(Object.assign({}, ctx, { target: loc }));
      const a = el.getAttribute(attr) || '';
      return [matches(a, ctx.value), 'attribut ' + attr + ' = ' + q(a) + ', attendu ' + q(ctx.value)];
    },
    ElementCount: ctx => {
      const n = findAll(ctx, ctx.target).length;
      return [n === Number(ctx.value), n + ' élément(s), attendu ' + ctx.value];
    }
  };

  const COMMANDS = {};
  for (const [name, check] of Object.entries(CHECKS)) {
    COMMANDS['assert' + name] = COMMANDS['verify' + name] = ctx => {
      const [ok, msg] = check(ctx);
      if (!ok) fail(msg);
    };
    COMMANDS['waitFor' + name] = ctx => {
      const [ok, msg] = check(ctx);
      if (!ok) retry('En attente : ' + msg);
    };
  }
  COMMANDS.waitForElementEditable = COMMANDS.waitForEditable;
  COMMANDS.waitForElementNotEditable = COMMANDS.waitForNotEditable;

  // ---------- Actions ----------

  Object.assign(COMMANDS, {
    click: ctx => doClick(getEl(ctx, { visible: true, enabled: true })),
    clickAt: ctx => COMMANDS.click(ctx),
    doubleClick: ctx => {
      const el = getEl(ctx, { visible: true, enabled: true });
      doClick(el, 1);
      doClick(el, 2);
      fireMouse(el, 'dblclick', 2);
    },
    doubleClickAt: ctx => COMMANDS.doubleClick(ctx),
    mouseOver: ctx => {
      const el = getEl(ctx, { visible: true });
      fireMouse(el, 'pointerover'); fireMouse(el, 'mouseover'); fireMouse(el, 'mouseenter');
      fireMouse(el, 'mousemove');
    },
    mouseOut: ctx => {
      const el = getEl(ctx);
      fireMouse(el, 'pointerout'); fireMouse(el, 'mouseout'); fireMouse(el, 'mouseleave');
    },
    mouseDown: ctx => { const el = getEl(ctx, { visible: true }); fireMouse(el, 'pointerdown'); fireMouse(el, 'mousedown'); },
    mouseUp: ctx => { const el = getEl(ctx, { visible: true }); fireMouse(el, 'pointerup'); fireMouse(el, 'mouseup'); },
    focus: ctx => getEl(ctx).focus(),
    type: ctx => {
      const el = getEl(ctx, { visible: true });
      if (el.isContentEditable) {
        el.focus();
        el.textContent = ctx.value;
        fireInput(el, ctx.value);
        return;
      }
      if (!('value' in el) || el.localName === 'select') fail('Élément non saisissable : ' + ctx.target);
      if (el.type === 'file') fail('Les champs fichier ne peuvent pas être remplis par une extension');
      if (el.disabled || el.readOnly) retry('Champ désactivé ou en lecture seule : ' + ctx.target);
      el.focus();
      el.value = ctx.value;
      const last = ctx.value.slice(-1) || 'a';
      fireKey(el, 'keydown', last);
      fireInput(el, ctx.value);
      fireKey(el, 'keyup', last);
      fire(el, 'change');
    },
    sendKeys: async ctx => {
      const el = getEl(ctx, { visible: true });
      const doc = el.ownerDocument;
      if (doc.activeElement !== el && typeof el.focus === 'function') el.focus();
      const editable = el.isContentEditable || ('value' in el && el.localName !== 'select');
      const tokens = parseKeys(ctx.value);
      for (let n = 0; n < tokens.length; n++) {
        // Pas d'attente après la dernière touche : Entrée peut avoir déchargé la page.
        if (n > 0) await sleep(15);
        const tk = tokens[n];
        const cur = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : el;
        if (tk.char) {
          const ok = fireKey(cur, 'keydown', tk.char);
          const ok2 = ok && fireKey(cur, 'keypress', tk.char);
          if (ok2 && editable) insertText(cur, tk.char);
          fireKey(cur, 'keyup', tk.char);
        } else {
          const ok = fireKey(cur, 'keydown', tk.key);
          if (tk.key === 'Enter') {
            const ok2 = ok && fireKey(cur, 'keypress', 'Enter');
            if (ok2) submitFromEnter(cur);
          } else if (ok && tk.key === 'Backspace' && editable) {
            deleteBack(cur);
          } else if (ok && tk.key === 'Tab') {
            focusNext(cur);
          }
          fireKey(cur, 'keyup', tk.key);
        }
      }
    },
    select: ctx => {
      const el = getEl(ctx);
      if (el.localName !== 'select') fail('Pas une liste <select> : ' + ctx.target);
      if (isDisabled(el)) retry('Liste désactivée : ' + ctx.target);
      const opt = findOption(el, ctx.value);
      if (!opt) retry('Option introuvable : ' + ctx.value);
      if (el.multiple) { for (const o of el.options) o.selected = false; opt.selected = true; }
      else el.selectedIndex = opt.index;
      fire(el, 'input');
      fire(el, 'change');
    },
    addSelection: ctx => {
      const el = getEl(ctx);
      const opt = findOption(el, ctx.value);
      if (!opt) retry('Option introuvable : ' + ctx.value);
      opt.selected = true;
      fire(el, 'input');
      fire(el, 'change');
    },
    removeSelection: ctx => {
      const el = getEl(ctx);
      const opt = findOption(el, ctx.value);
      if (!opt) retry('Option introuvable : ' + ctx.value);
      opt.selected = false;
      fire(el, 'input');
      fire(el, 'change');
    },
    check: ctx => setChecked(ctx, true),
    uncheck: ctx => setChecked(ctx, false),
    submit: ctx => {
      const el = getEl(ctx);
      const form = el.localName === 'form' ? el : (el.form || el.closest('form'));
      if (!form) fail('Aucun formulaire pour : ' + ctx.target);
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.submit();
    },
    editContent: ctx => {
      const el = getEl(ctx);
      const doc = el.ownerDocument;
      if (!el.isContentEditable && doc.designMode !== 'on') fail('Élément non éditable : ' + ctx.target);
      el.focus();
      el.innerHTML = ctx.value;
      fireInput(el);
      fire(el, 'change');
    },
    scrollTo: ctx => getEl(ctx).scrollIntoView({ block: 'center' }),
    uploadFile: ctx => {
      const el = getEl(ctx);
      const dt = new DataTransfer();
      for (const f of ctx.files || []) {
        const data = f.base64 ? Uint8Array.from(atob(f.content), ch => ch.charCodeAt(0)) : f.content;
        dt.items.add(new File([data], f.name, { type: f.type }));
      }
      if (!dt.files.length) fail('Aucun fichier à envoyer');
      if (el.localName === 'input' && el.type === 'file') {
        if (isDisabled(el)) retry('Champ fichier désactivé : ' + ctx.target);
        el.files = dt.files;
        fire(el, 'input');
        fire(el, 'change');
        return;
      }
      // Sinon : glisser-déposer sur l'élément (zone de dépôt Moodle).
      el.scrollIntoView({ block: 'center' });
      const r = el.getBoundingClientRect();
      for (const type of ['dragenter', 'dragover', 'drop']) {
        el.dispatchEvent(new DragEvent(type, {
          bubbles: true, cancelable: true, composed: true, dataTransfer: dt,
          clientX: r.left + r.width / 2, clientY: r.top + r.height / 2
        }));
      }
    },

    storeText: ctx => ({ store: { name: ctx.value, value: textOf(getEl(ctx)) } }),
    storeValue: ctx => ({ store: { name: ctx.value, value: String(getEl(ctx).value) } }),
    storeAttribute: ctx => {
      const { loc, attr } = attrTarget(ctx);
      const el = getEl(Object.assign({}, ctx, { target: loc }));
      return { store: { name: ctx.value, value: el.getAttribute(attr) } };
    },
    storeTitle: ctx => ({ store: { name: ctx.value || ctx.target, value: L.norm(ctx.doc.title) } }),
    storeXpathCount: ctx => ({ store: { name: ctx.value, value: findAll(ctx, 'xpath=' + ctx.target.replace(/^xpath=/, '')).length } }),
    storeElementCount: ctx => ({ store: { name: ctx.value, value: findAll(ctx, ctx.target).length } }),
    storeLocation: ctx => ({ store: { name: ctx.value || ctx.target, value: ctx.doc.location.href } })
  });

  function setChecked(ctx, want) {
    const el = getEl(ctx);
    if (!('checked' in el)) fail('Pas une case à cocher : ' + ctx.target);
    if (!!el.checked === want) return;
    if (isDisabled(el)) retry('Case désactivée : ' + ctx.target);
    if (isVisible(el)) {
      doClick(el);
    } else {
      el.checked = want;
      fire(el, 'input');
      fire(el, 'change');
    }
    if (!!el.checked !== want) fail('La case n\'a pas changé d\'état : ' + ctx.target);
  }

  async function execCommand(msg) {
    const c = msg.cmd;
    const fn = COMMANDS[c.command];
    if (!fn) return { status: 'fail', message: 'Commande inconnue : ' + c.command };
    try {
      const doc = docFor(msg.frame);
      const ctx = { doc, target: c.target || '', value: c.value == null ? '' : String(c.value), highlight: msg.highlight, files: c.files };
      const r = await fn(ctx);
      return Object.assign({ status: 'ok' }, r || {});
    } catch (e) {
      if (e instanceof Retry) return { status: 'retry', message: e.message };
      if (e instanceof Fail) return { status: 'fail', message: e.message };
      return { status: 'fail', message: 'Erreur : ' + (e && e.message || e) };
    }
  }

  // ---------- Scripts dans le contexte de la page ----------

  // Le code tourne dans la page (accès à M, require, jQuery) comme corps d'une fonction async(vars).
  function runPageScript(doc, code, vars, timeout) {
    return new Promise(resolve => {
      const id = 'ftide-' + Math.random().toString(36).slice(2);
      let done = false;
      const finish = r => {
        if (done) return;
        done = true;
        doc.removeEventListener(id, onResult);
        clearTimeout(timer);
        resolve(r);
      };
      const onResult = ev => {
        try { finish(JSON.parse(ev.detail)); } catch (e) { finish({ ok: false, error: 'Réponse illisible du script' }); }
      };
      doc.addEventListener(id, onResult);
      const timer = setTimeout(() => finish({
        ok: false,
        error: 'Pas de réponse du script après ' + timeout + ' ms (script trop long, ou bloqué par la CSP de la page)'
      }), timeout);

      const src = '(function(){' +
        'var __d=document;' +
        'function __send(o){var s;try{s=JSON.stringify(o)}catch(e){s=JSON.stringify({ok:true,value:String(o.value),vars:o.vars})}' +
        '__d.dispatchEvent(new CustomEvent(' + JSON.stringify(id) + ',{detail:s}))}' +
        'try{' +
        'var vars=' + JSON.stringify(vars || {}) + ';' +
        'var AF=Object.getPrototypeOf(async function(){}).constructor;' +
        'var f=new AF("vars",' + JSON.stringify(code) + ');' +
        'Promise.resolve(f.call(window,vars)).then(' +
        'function(v){__send({ok:true,value:v===undefined?null:v,vars:vars})},' +
        'function(e){__send({ok:false,error:String(e&&e.message||e)})});' +
        '}catch(e){__send({ok:false,error:String(e&&e.message||e)})}' +
        '})();';
      const s = doc.createElement('script');
      s.textContent = src;
      (doc.head || doc.documentElement).appendChild(s);
      s.remove();
    });
  }

  async function execScript(msg) {
    let doc;
    try { doc = docFor(msg.frame); } catch (e) { return { status: 'retry', message: e.message }; }
    const r = await runPageScript(doc, msg.code, msg.vars, msg.timeout || 30000);
    if (!r.ok) return { status: 'fail', message: 'Erreur JavaScript : ' + r.error };
    return { status: 'ok', value: r.value, vars: r.vars };
  }

  function pageState() {
    const w = window.wrappedJSObject || window;
    let jq = 0;
    const pendingJs = [];
    try { if (w.jQuery && typeof w.jQuery.active === 'number') jq = w.jQuery.active; } catch (e) { /* ignore */ }
    try {
      const pj = w.M && w.M.util && w.M.util.pending_js;
      if (pj) for (let i = 0; i < pj.length; i++) pendingJs.push(String(pj[i]));
    } catch (e) { /* ignore */ }
    return { readyState: document.readyState, url: location.href, jq, pendingJs };
  }

  // ---------- Capture pleine page ----------

  // Moodle 4 fait défiler #page et non le document : pour capturer toute la page, on déplie
  // provisoirement le plus grand bloc défilant et ses ancêtres.
  let shotRestore = null;

  function shotPrepare() {
    if (shotRestore) shotRestore();
    const doc = document.documentElement;
    const saved = [];
    const setStyle = (el, props) => {
      saved.push([el, el.getAttribute('style')]);
      for (const [k, v] of Object.entries(props)) el.style.setProperty(k, v, 'important');
    };
    if (doc.scrollHeight <= window.innerHeight + 5) {
      let best = null;
      for (const el of document.querySelectorAll('body *')) {
        if (el.scrollHeight <= el.clientHeight + 5 || el.clientHeight < window.innerHeight * 0.5) continue;
        if (!/(auto|scroll)/.test(getComputedStyle(el).overflowY)) continue;
        if (!best || el.scrollHeight > best.scrollHeight) best = el;
      }
      for (let el = best; el; el = el.parentElement) {
        setStyle(el, { height: 'auto', 'max-height': 'none', 'overflow-y': 'visible' });
      }
    }
    shotRestore = () => {
      for (const [el, style] of saved.reverse()) {
        if (style == null) el.removeAttribute('style'); else el.setAttribute('style', style);
      }
      shotRestore = null;
    };
    return {
      width: Math.max(doc.scrollWidth, document.body ? document.body.scrollWidth : 0),
      height: Math.max(doc.scrollHeight, document.body ? document.body.scrollHeight : 0),
      dpr: window.devicePixelRatio || 1
    };
  }

  function highlight(msg) {
    let doc;
    try { doc = docFor(msg.frame); } catch (e) { return { found: 0, message: e.message }; }
    let all;
    try { all = L.findAll(msg.target, doc); } catch (e) { return { found: 0, message: 'Localisateur invalide : ' + e.message }; }
    if (all.length) {
      const el = all.find(isVisible) || all[0];
      el.scrollIntoView({ block: 'center' });
      flash(el, 1500);
    }
    return { found: all.length };
  }

  browser.runtime.onMessage.addListener(msg => {
    if (!msg) return undefined;
    switch (msg.type) {
      case 'recordingState':
        if (!msg.recording) flushEdit();
        recording = !!msg.recording;
        return undefined;
      case 'pick':
        setPick(!!msg.on);
        return undefined;
      case 'contextRecord':
        contextRecord(msg);
        return undefined;
    }
    if (!IS_TOP) return undefined;
    switch (msg.type) {
      case 'exec': return execCommand(msg);
      case 'script': return execScript(msg);
      case 'pageState': return Promise.resolve(pageState());
      case 'shotPrepare': return Promise.resolve(shotPrepare());
      case 'shotRestore':
        if (shotRestore) shotRestore();
        return Promise.resolve(true);
      case 'highlight': return Promise.resolve(highlight(msg));
      case 'checkFrame':
        try { docFor(msg.frame); return Promise.resolve({ status: 'ok' }); }
        catch (e) { return Promise.resolve({ status: 'retry', message: e.message }); }
    }
    return undefined;
  });
})();

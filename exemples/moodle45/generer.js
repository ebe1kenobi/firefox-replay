'use strict';

// Génère la recette « testeric » pour Moodle 4.5 : un .side par projet et un .scenario.json qui les enchaîne.
//   node exemples/moodle45/generer.js
// Chaque projet est vérifié : commandes connues, blocs fermés, syntaxe des scripts, variables définies avant usage.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { randomUUID } = require('crypto');

const ctx = vm.createContext({ crypto: { randomUUID }, Blob, console });
for (const f of ['commands.js', 'project.js', 'engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'ide', f), 'utf8'), ctx, { filename: f });
}
const { FTProject, FTEngine, FT_COMMANDS } = vm.runInContext('({ FTProject, FTEngine, FT_COMMANDS })', ctx);
const paquets = JSON.parse(fs.readFileSync(path.join(__dirname, 'paquets.json'), 'utf8'));

const URL_BASE = 'https://moodle.exemple.fr';

// ---------------------------------------------------------------------------
// Petites briques
// ---------------------------------------------------------------------------

const C = (command, target, value, comment) => [command, target || '', value || '', comment || ''];
const js = (...lines) => lines.join('\n');

// Appel des services web internes de Moodle avec la session de l'administrateur.
const WS = js(
  'const ajax = await new Promise((ok, ko) => require([\'core/ajax\'], ok, ko));',
  'const call = (methodname, args) => ajax.call([{ methodname, args }])[0];'
);

// Remplit un éditeur de texte riche (TinyMCE de Moodle 4.5, Atto, ou simple zone de texte).
function editor(fieldId, htmlExpr, comment) {
  return C('executeScript', js(
    'const fid = \'' + fieldId + '\';',
    'const html = ' + htmlExpr + ';',
    'const ta = document.getElementById(fid);',
    'if (!ta) throw new Error(\'Éditeur introuvable : \' + fid);',
    'for (let i = 0; i < 50; i++) {',
    '  let tiny = null;',
    '  try {',
    '    const mod = await new Promise((ok, ko) => require([\'editor_tiny/editor\'], ok, ko));',
    '    tiny = mod.getInstanceForElementId(fid);',
    '  } catch (e) { /* TinyMCE absent */ }',
    '  if (tiny) { tiny.setContent(html); tiny.save(); return \'TinyMCE\'; }',
    '  const atto = document.getElementById(fid + \'editable\');',
    '  if (atto) { atto.innerHTML = html; ta.value = html; return \'Atto\'; }',
    '  await new Promise(r => setTimeout(r, 100));',
    '}',
    'ta.value = html;',
    'return \'zone de texte\';'
  ), '', comment || 'remplit l\'éditeur ' + fieldId);
}

// Après l'envoi d'un formulaire Moodle : si on est encore sur la même page, il a été refusé.
function formAccepted(pagePath) {
  return C('executeScript', js(
    'if (location.pathname.endsWith(\'' + pagePath + '\')) {',
    '  const errs = [...document.querySelectorAll(\'.invalid-feedback, .alert-danger, .error\')]',
    '    .map(e => e.textContent.trim()).filter(Boolean);',
    '  throw new Error(\'Formulaire refusé\' + (errs.length ? \' : \' + errs.join(\' / \') : \'\'));',
    '}',
    'return true;'
  ), '', 'vérifie que Moodle a accepté le formulaire');
}

// Dépôt d'un fichier (créé par createFile) par le sélecteur de fichiers de Moodle.
const REPO_UPLOAD = 'xpath=//span[contains(@class,\'fp-repo-name\')][normalize-space()=\'Déposer un fichier\' or normalize-space()=\'Upload a file\']';
function pickFile(openLocator, fileName, openComment) {
  return [
    C('click', openLocator, '', openComment),
    C('click', REPO_UPLOAD, '', 'dépôt « Déposer un fichier » du sélecteur'),
    C('uploadFile', 'css=input[name=repo_upload_file]', fileName),
    C('click', 'css=.fp-upload-btn', '', 'bouton « Déposer ce fichier »'),
    C('waitForTextPresent', fileName, '', 'le fichier apparaît dans le formulaire')
  ];
}

const tests = [];
function test(name, ...rows) {
  const out = [];
  for (const r of rows) {
    if (Array.isArray(r[0])) out.push(...r); else out.push(r);
  }
  return { name, rows: out };
}

// ---------------------------------------------------------------------------
// 00 — Initialisation et connexion
// ---------------------------------------------------------------------------

const p00 = {
  name: 'testeric 00 - Initialisation et connexion',
  tests: [
    test('Paramètres de la recette',
      C('store', 'admin', 'identifiant', 'À ADAPTER : compte administrateur'),
      C('store', 'MotDePasse!1', 'motdepasse', 'À ADAPTER : son mot de passe'),
      C('store', 'regexpi:^\\s*SAS\\s*/\\s*ERIC\\s*$', 'categorieParente', 'catégorie parente, telle qu\'affichée dans la liste « Catégorie parente »'),
      C('store', 'regexpi:^(apprenant|étudiant|student)', 'roleApprenant', 'rôle « apprenant » (libellé de la liste des rôles)'),
      C('store', 'regexpi:^(tuteur|enseignant non éditeur|non-editing teacher)', 'roleTuteur', 'rôle « tuteur »'),
      C('store', 'Testeric-2026!', 'motdepasseTest', 'mot de passe des comptes créés (respecte la politique par défaut)'),
      C('storeUniqueId', '', 'id', 'identifiant unique de cette exécution, ex. 20260926-143012-k3f9'),
      C('echo', 'Recette testeric : identifiant ${id}')),
    test('Accueil et connexion',
      C('open', '/'),
      C('screenshot', 'accueil'),
      C('open', '/login/index.php'),
      C('storeElementCount', 'id=username', 'champsConnexion', '0 si l\'on est déjà connecté'),
      C('if', '${champsConnexion} > 0'),
      C('type', 'id=username', '${identifiant}'),
      C('type', 'id=password', '${motdepasse}'),
      C('click', 'id=loginbtn'),
      C('else'),
      C('echo', 'Déjà connecté'),
      C('end'),
      C('waitForCondition', '!document.body.classList.contains(\'notloggedin\') && !location.pathname.endsWith(\'/login/index.php\')', '30000',
        'connecté (indépendant du thème, Academi compris)'),
      C('executeScript', 'return M.cfg.wwwroot;', 'racine'),
      C('echo', 'Moodle : ${racine}'),
      C('open', '/'),
      C('screenshot', 'connecte'))
  ]
};

// ---------------------------------------------------------------------------
// 01 — Utilisateurs
// ---------------------------------------------------------------------------

const userIhm = 'testericihm${id}_${n}';
const p01 = {
  name: 'testeric 01 - Utilisateurs',
  tests: [
    test('Créer deux utilisateurs par l\'interface',
      C('storeJson', '[1, 2]', 'numeros'),
      C('forEach', 'numeros', 'n'),
      C('open', '/user/editadvanced.php?id=-1'),
      C('type', 'id=id_username', userIhm),
      C('click', 'css=#fitem_id_newpassword [data-passwordunmask=edit]', '', 'ouvre la saisie du mot de passe'),
      C('type', 'id=id_newpassword', '${motdepasseTest}'),
      C('type', 'id=id_firstname', 'testericfirstnameihm${id}_${n}'),
      C('type', 'id=id_lastname', 'testericlastnameihm${id}_${n}'),
      C('type', 'id=id_email', 'testericmailihm${id}_${n}@testeric.fr'),
      C('screenshot', 'formulaire utilisateur ${n}'),
      C('click', 'id=id_submitbutton', '', '« Créer l\'utilisateur »'),
      formAccepted('/user/editadvanced.php'),
      C('end')),
    test('Vérifier les utilisateurs créés par l\'interface',
      C('executeScript', js(
        WS,
        'const noms = [1, 2].map(n => \'testericihm\' + ${id} + \'_\' + n);',
        'const users = await call(\'core_user_get_users_by_field\', { field: \'username\', values: noms });',
        'if (users.length !== 2) throw new Error(\'Attendu 2 utilisateurs, trouvé \' + users.length);',
        'const byName = Object.fromEntries(users.map(u => [u.username, u]));',
        'vars.uidIhm1 = byName[noms[0]].id;',
        'vars.uidIhm2 = byName[noms[1]].id;',
        'return users.map(u => u.fullname + \' <\' + u.email + \'>\').join(\', \');'
      ), 'utilisateursIhm', 'contrôle par le service web core_user_get_users_by_field')),
    test('Créer deux utilisateurs par dépôt CSV',
      C('createFile', js(
        'username,firstname,lastname,email,password',
        'testericcsv${id}_1,testericfirstnamecsv${id}_1,testericlastnamecsv${id}_1,testericmailcsv${id}_1@testeric.fr,${motdepasseTest}',
        'testericcsv${id}_2,testericfirstnamecsv${id}_2,testericlastnamecsv${id}_2,testericmailcsv${id}_2@testeric.fr,${motdepasseTest}'
      ), 'testeric_utilisateurs_${id}.csv'),
      C('open', '/admin/tool/uploaduser/index.php'),
      pickFile('css=#fitem_id_userfile .fp-btn-choose', 'testeric_utilisateurs_${id}.csv', 'bouton « Choisir un fichier… »'),
      C('click', 'id=id_submitbutton', '', '« Déposer des utilisateurs » : aperçu'),
      C('waitForElementPresent', 'id=id_uutype'),
      C('select', 'id=id_uutype', 'value=0', 'type de dépôt : ajouter seulement les nouveaux'),
      C('screenshot', 'apercu depot utilisateurs'),
      C('click', 'id=id_submitbutton', '', 'lance le dépôt'),
      C('screenshot', 'resultat depot utilisateurs')),
    test('Vérifier les utilisateurs créés par CSV',
      C('executeScript', js(
        WS,
        'const noms = [1, 2].map(n => \'testericcsv\' + ${id} + \'_\' + n);',
        'const users = await call(\'core_user_get_users_by_field\', { field: \'username\', values: noms });',
        'if (users.length !== 2) throw new Error(\'Attendu 2 utilisateurs CSV, trouvé \' + users.length);',
        'const byName = Object.fromEntries(users.map(u => [u.username, u]));',
        'vars.uidCsv1 = byName[noms[0]].id;',
        'vars.uidCsv2 = byName[noms[1]].id;',
        'return users.map(u => u.fullname).join(\', \');'
      ), 'utilisateursCsv'))
  ]
};

// ---------------------------------------------------------------------------
// 02 — Catégorie et cours
// ---------------------------------------------------------------------------

const p02 = {
  name: 'testeric 02 - Catégorie et cours',
  tests: [
    test('Créer la catégorie dans SAS / ERIC',
      C('open', '/course/editcategory.php?parent=0'),
      C('select', 'id=id_parent', 'label=${categorieParente}', 'catégorie parente'),
      C('type', 'id=id_name', 'testeric_createcategorie_${id}_1'),
      C('type', 'id=id_idnumber', 'testeric_createcategorie_${id}_1'),
      editor('id_description_editor', '\'<p>Catégorie de test testeric \' + ${id} + \'</p>\''),
      C('click', 'id=id_submitbutton', '', '« Créer la catégorie »'),
      formAccepted('/course/editcategory.php'),
      C('executeScript', js(
        'const id = new URL(location.href).searchParams.get(\'categoryid\');',
        'if (!id) throw new Error(\'Identifiant de la catégorie introuvable dans \' + location.href);',
        'return id;'
      ), 'catid', 'la page de gestion affiche la nouvelle catégorie'),
      C('screenshot', 'categorie creee')),
    test('Créer le cours dans la catégorie',
      C('open', '/course/edit.php?category=${catid}'),
      C('type', 'id=id_fullname', 'testeric_createcours_${id}_1'),
      C('type', 'id=id_shortname', 'testeric_createcours_${id}_1'),
      editor('id_summary_editor', '\'<p>Cours de test testeric \' + ${id} + \'</p>\''),
      C('click', 'id=id_saveanddisplay', '', '« Enregistrer et afficher »'),
      formAccepted('/course/edit.php'),
      C('executeScript', js(
        'const id = new URL(location.href).searchParams.get(\'id\');',
        'if (!location.pathname.endsWith(\'/course/view.php\') || !id) throw new Error(\'Page du cours attendue : \' + location.href);',
        'return id;'
      ), 'courseid'),
      C('screenshot', 'cours cree'),
      C('open', '/course/index.php?categoryid=${catid}'),
      C('assertTextPresent', 'testeric_createcours_${id}_1', '', 'le cours est bien dans la catégorie'))
  ]
};

// ---------------------------------------------------------------------------
// 03 — Activités
// ---------------------------------------------------------------------------

const MODS = [
  ['assign', 'Devoir'], ['book', 'Livre'], ['choice', 'Sondage (choix)'], ['data', 'Base de données'],
  ['feedback', 'Feedback'], ['folder', 'Dossier'], ['forum', 'Forum'], ['glossary', 'Glossaire'],
  ['imscp', 'Paquetage IMS'], ['label', 'Zone texte et média'], ['lesson', 'Leçon'], ['page', 'Page'],
  ['quiz', 'Test'], ['resource', 'Fichier'], ['scorm', 'Paquetage SCORM'], ['url', 'URL'],
  ['wiki', 'Wiki'], ['workshop', 'Atelier']
];

function extraFields(mod, name) {
  switch (mod) {
    case 'choice': return [
      C('type', 'id=id_option_0', 'Option A'),
      C('type', 'id=id_option_1', 'Option B')];
    case 'page': return [editor('id_page', '\'<p>Contenu de la page \' + ${id} + \'</p>\'', 'contenu de la page (obligatoire)')];
    case 'url': return [C('type', 'id=id_externalurl', 'https://moodle.org', 'adresse (obligatoire)')];
    case 'wiki': return [C('type', 'id=id_firstpagetitle', 'Accueil ' + name, 'titre de la première page (obligatoire)')];
    case 'resource': return [
      C('createFile', 'Fichier de test testeric ${id}', 'testeric_fichier_${id}.txt'),
      ...pickFile('css=#fitem_id_files .fp-btn-add a', 'testeric_fichier_${id}.txt', 'bouton « Ajouter… » du gestionnaire de fichiers')];
    case 'scorm': return [
      C('createFile', 'base64:' + paquets.scorm, 'testeric_scorm_${id}.zip', 'paquet SCORM 1.2 minimal'),
      ...pickFile('css=#fitem_id_packagefile .fp-btn-add a', 'testeric_scorm_${id}.zip', 'bouton « Ajouter… »')];
    case 'imscp': return [
      C('createFile', 'base64:' + paquets.imscp, 'testeric_imscp_${id}.zip', 'paquet IMS minimal'),
      ...pickFile('css=#fitem_id_package .fp-btn-choose', 'testeric_imscp_${id}.zip', 'bouton « Choisir un fichier… »')];
  }
  return [];
}

function activity(mod, label) {
  const name = 'testeric_create' + mod + '_${id}_1';
  return test(label + ' (' + mod + ')',
    // Pas de « sr=0 » : Moodle 4.5 renverrait sur la page de la section 0, où l'activité n'apparaît pas.
    C('open', '/course/modedit.php?add=' + mod + '&type=&course=${courseid}&section=1'),
    C('type', 'id=id_name', name),
    editor('id_introeditor', '\'<p>Description de \' + \'' + name.replace('${id}', '\' + ${id} + \'') + '\' + \'</p>\''),
    ...extraFields(mod, name),
    C('click', 'id=id_submitbutton2', '', '« Enregistrer et revenir au cours »'),
    formAccepted('/course/modedit.php'),
    C('waitForTextPresent', name),
    C('screenshot', mod));
}

const disabledMods = [
  ['chat', 'Chat', []],
  ['survey', 'Consultation', [C('select', 'id=id_template', 'index=1', 'type de consultation (obligatoire)')]],
  ['subsection', 'Sous-section', []],
  ['bigbluebuttonbn', 'BigBlueButton', []]
];

const p03 = {
  name: 'testeric 03 - Activités',
  tests: [
    ...MODS.map(([m, l]) => activity(m, l)),
    test('Activités désactivées par défaut (à activer avant de décommenter)',
      C('echo', 'Chat, Consultation, Sous-section et BigBlueButton sont désactivés à l\'installation de Moodle 4.5 ; H5P et Outil externe demandent un fichier .h5p ou un outil configuré.'),
      ...disabledMods.flatMap(([m, l, extra]) => {
        const name = 'testeric_create' + m + '_${id}_1';
        return [
          C('//open', '/course/modedit.php?add=' + m + '&type=&course=${courseid}&section=1', '', l),
          C('//type', 'id=id_name', name),
          ...extra.map(r => ['//' + r[0], r[1], r[2], r[3]]),
          C('//click', 'id=id_submitbutton2'),
          C('//waitForTextPresent', name)
        ];
      })),
    test('Vérifier toutes les activités du cours',
      C('open', '/course/view.php?id=${courseid}'),
      ...MODS.map(([m]) => C('assertTextPresent', 'testeric_create' + m + '_${id}_1')),
      C('screenshot', 'toutes les activites'))
  ]
};

// ---------------------------------------------------------------------------
// 04 — Cohortes
// ---------------------------------------------------------------------------

const cohortIds = js(
  WS,
  'const res = await call(\'core_cohort_search_cohorts\', {',
  '  query: \'testeric_createcohorte\', context: { contextid: 1 }, includes: \'all\', limitfrom: 0, limitnum: 100 });',
  'const find = name => {',
  '  const c = res.cohorts.find(x => x.name === name);',
  '  if (!c) throw new Error(\'Cohorte introuvable : \' + name);',
  '  return c.id;',
  '};'
);

function assignPage(varName) {
  return C('open', '/cohort/assign.php?id=${' + varName + '}');
}

const p04 = {
  name: 'testeric 04 - Cohortes',
  tests: [
    test('Créer deux cohortes par l\'interface',
      C('storeJson', '[1, 2]', 'numeros'),
      C('forEach', 'numeros', 'n'),
      C('open', '/cohort/edit.php?contextid=1'),
      C('type', 'id=id_name', 'testeric_createcohorte_${id}_${n}'),
      C('type', 'id=id_idnumber', 'testeric_createcohorte_${id}_${n}'),
      editor('id_description_editor', '\'<p>Cohorte testeric \' + ${id} + \' n° \' + ${n} + \'</p>\''),
      C('click', 'id=id_submitbutton'),
      formAccepted('/cohort/edit.php'),
      C('end'),
      C('executeScript', js(
        cohortIds,
        'vars.cohortIhm1 = find(\'testeric_createcohorte_\' + ${id} + \'_1\');',
        'vars.cohortIhm2 = find(\'testeric_createcohorte_\' + ${id} + \'_2\');',
        'return [vars.cohortIhm1, vars.cohortIhm2].join(\', \');'
      ), 'cohortesIhm'),
      C('open', '/cohort/index.php?contextid=1'),
      C('screenshot', 'cohortes interface')),
    ...[1, 2].map(k => test('Ajouter les 2 utilisateurs interface à la cohorte ' + k + ' (interface)',
      assignPage('cohortIhm' + k),
      C('type', 'id=addselect_searchtext', 'testericlastnameihm${id}', 'recherche des utilisateurs'),
      C('waitForElementPresent', 'xpath=//select[@id=\'addselect\']//option[contains(., \'testericlastnameihm${id}_2\')]'),
      C('addSelection', 'id=addselect', 'label=contains:testericlastnameihm${id}_1'),
      C('addSelection', 'id=addselect', 'label=contains:testericlastnameihm${id}_2'),
      C('click', 'id=add', '', '◄ Ajouter'),
      C('waitForElementPresent', 'xpath=//select[@id=\'removeselect\']//option[contains(., \'testericlastnameihm${id}_1\')]'),
      C('waitForElementPresent', 'xpath=//select[@id=\'removeselect\']//option[contains(., \'testericlastnameihm${id}_2\')]'),
      C('screenshot', 'membres cohorte ' + k))),
    test('Créer deux cohortes par dépôt CSV',
      C('createFile', js(
        'name,idnumber,description',
        'testeric_createcohortecsv_${id}_1,testeric_createcohortecsv_${id}_1,Cohorte CSV testeric 1',
        'testeric_createcohortecsv_${id}_2,testeric_createcohortecsv_${id}_2,Cohorte CSV testeric 2'
      ), 'testeric_cohortes_${id}.csv'),
      C('open', '/cohort/upload.php?contextid=1'),
      pickFile('css=#fitem_id_cohortfile .fp-btn-choose', 'testeric_cohortes_${id}.csv', 'bouton « Choisir un fichier… »'),
      C('click', 'id=id_previewbutton', '', '« Aperçu » : active le bouton de dépôt'),
      C('waitForElementPresent', 'xpath=//input[@id=\'id_submitbutton\' and not(@disabled)]'),
      C('screenshot', 'apercu cohortes csv'),
      C('click', 'id=id_submitbutton', '', '« Déposer les cohortes »'),
      C('executeScript', js(
        cohortIds,
        'vars.cohortCsv1 = find(\'testeric_createcohortecsv_\' + ${id} + \'_1\');',
        'vars.cohortCsv2 = find(\'testeric_createcohortecsv_\' + ${id} + \'_2\');',
        'return [vars.cohortCsv1, vars.cohortCsv2].join(\', \');'
      ), 'cohortesCsv'),
      C('screenshot', 'cohortes csv')),
    test('Importer les utilisateurs CSV dans les 4 cohortes',
      C('createFile', js(
        'username,cohort1,cohort2,cohort3,cohort4',
        'testericcsv${id}_1,testeric_createcohorte_${id}_1,testeric_createcohorte_${id}_2,testeric_createcohortecsv_${id}_1,testeric_createcohortecsv_${id}_2',
        'testericcsv${id}_2,testeric_createcohorte_${id}_1,testeric_createcohorte_${id}_2,testeric_createcohortecsv_${id}_1,testeric_createcohortecsv_${id}_2'
      ), 'testeric_import_cohortes_${id}.csv', 'les colonnes cohortN désignent les cohortes par leur numéro d\'identification'),
      C('open', '/admin/tool/uploaduser/index.php'),
      pickFile('css=#fitem_id_userfile .fp-btn-choose', 'testeric_import_cohortes_${id}.csv', 'bouton « Choisir un fichier… »'),
      C('click', 'id=id_submitbutton', '', 'aperçu'),
      C('waitForElementPresent', 'id=id_uutype'),
      C('select', 'id=id_uutype', 'value=3', 'type de dépôt : mettre à jour les utilisateurs existants seulement'),
      C('select', 'id=id_uuupdatetype', 'value=0', 'sans modifier leur profil'),
      C('screenshot', 'apercu import cohortes'),
      C('click', 'id=id_submitbutton'),
      C('screenshot', 'resultat import cohortes')),
    test('Vérifier le nombre de membres des 4 cohortes',
      C('storeJson', '[["cohortIhm1", 4], ["cohortIhm2", 4], ["cohortCsv1", 2], ["cohortCsv2", 2]]', 'attendus',
        'cohortes interface : 2 utilisateurs interface + 2 CSV ; cohortes CSV : 2 utilisateurs CSV'),
      C('forEach', 'attendus', 'attendu'),
      C('executeScript', 'vars.cohorteCourante = vars[${attendu}[0]];'),
      C('open', '/cohort/assign.php?id=${cohorteCourante}'),
      C('executeScript', js(
        'const n = document.querySelectorAll(\'#removeselect option\').length;',
        'if (n !== ${attendu}[1]) throw new Error(${attendu}[0] + \' : \' + n + \' membre(s), attendu \' + ${attendu}[1]);',
        'return n;'
      ), 'membres'),
      C('screenshot', 'membres ${cohorteCourante}'),
      C('end'))
  ]
};

// ---------------------------------------------------------------------------
// 05 — Groupes et inscriptions par synchronisation de cohorte
// ---------------------------------------------------------------------------

const groupIds = js(
  WS,
  'const groups = await call(\'core_group_get_course_groups\', { courseid: Number(${courseid}) });',
  'const find = name => {',
  '  const g = groups.find(x => x.name === name);',
  '  if (!g) throw new Error(\'Groupe introuvable : \' + name);',
  '  return g.id;',
  '};'
);

const groupOption = (name, count) =>
  C('assertElementPresent', 'xpath=//select[@id=\'groups\' or @name=\'groups[]\']/option[contains(normalize-space(.), \'' + name + ' (' + count + ')\')]',
    '', count + ' membre(s) attendu(s)');

const p05 = {
  name: 'testeric 05 - Groupes et inscriptions',
  tests: [
    test('Créer 4 groupes dans le cours',
      C('storeJson', '[1, 2, 3, 4]', 'numeros'),
      C('forEach', 'numeros', 'n'),
      C('open', '/group/group.php?courseid=${courseid}'),
      C('type', 'id=id_name', 'testeric_creategroupe_${id}_${n}'),
      C('type', 'id=id_idnumber', 'testeric_creategroupe_${id}_${n}'),
      editor('id_description_editor', '\'<p>Groupe testeric \' + ${n} + \'</p>\''),
      C('click', 'id=id_submitbutton'),
      formAccepted('/group/group.php'),
      C('end'),
      C('executeScript', js(
        groupIds,
        'for (const n of [1, 2, 3, 4]) vars[\'groupe\' + n] = find(\'testeric_creategroupe_\' + ${id} + \'_\' + n);',
        'return [1, 2, 3, 4].map(n => vars[\'groupe\' + n]).join(\', \');'
      ), 'groupes'),
      C('open', '/group/index.php?id=${courseid}'),
      C('screenshot', 'groupes crees')),
    test('Synchroniser les 4 cohortes avec rôle et groupe',
      C('storeJson', JSON.stringify([
        ['testeric_createcohorte_${id}_1', 'roleApprenant', 1],
        ['testeric_createcohorte_${id}_2', 'roleTuteur', 2],
        ['testeric_createcohortecsv_${id}_1', 'roleApprenant', 3],
        ['testeric_createcohortecsv_${id}_2', 'roleTuteur', 4]
      ]), 'syncs', '[cohorte, rôle, groupe]'),
      C('forEach', 'syncs', 'sync'),
      C('executeScript', js(
        'vars.cohorteNom = ${sync}[0];',
        'vars.roleCible = vars[${sync}[1]];',
        'vars.groupeNom = \'testeric_creategroupe_\' + ${id} + \'_\' + ${sync}[2];'
      )),
      C('open', '/enrol/editinstance.php?type=cohort&courseid=${courseid}'),
      C('type', 'css=#fitem_id_customint1 input[type=text]', '${cohorteNom}', 'recherche de la cohorte'),
      C('waitForElementVisible', 'xpath=//div[@id=\'fitem_id_customint1\']//li[@role=\'option\'][contains(normalize-space(.), \'${cohorteNom}\')]'),
      C('click', 'xpath=//div[@id=\'fitem_id_customint1\']//li[@role=\'option\'][contains(normalize-space(.), \'${cohorteNom}\')]'),
      C('waitForElementPresent', 'xpath=//div[@id=\'fitem_id_customint1\']//*[contains(@class,\'form-autocomplete-selection\')]//*[contains(normalize-space(.), \'${cohorteNom}\')]',
        '', 'la cohorte est sélectionnée'),
      C('select', 'id=id_roleid', 'label=${roleCible}'),
      C('select', 'id=id_customint2', 'label=${groupeNom}', 'ajouter au groupe'),
      C('screenshot', 'synchro ${cohorteNom}'),
      C('click', 'id=id_submitbutton'),
      formAccepted('/enrol/editinstance.php'),
      C('assertTextPresent', '${cohorteNom}', '', 'la méthode apparaît dans la liste'),
      C('end'),
      C('screenshot', 'methodes d inscription')),
    test('Vérifier les inscrits et les groupes',
      C('open', '/user/index.php?id=${courseid}&perpage=5000'),
      ...['ihm', 'csv'].flatMap(k => [1, 2].map(n =>
        C('assertTextPresent', 'testericlastname' + k + '${id}_' + n))),
      C('screenshot', 'participants'),
      C('executeScript', js(
        WS,
        'const users = await call(\'core_enrol_search_users\', {',
        '  courseid: Number(${courseid}), search: \'testeric\', searchanywhere: true, page: 0, perpage: 100 });',
        'const ids = users.map(u => u.id);',
        'const manquants = [${uidIhm1}, ${uidIhm2}, ${uidCsv1}, ${uidCsv2}].filter(id => !ids.includes(Number(id)));',
        'if (manquants.length) throw new Error(\'Utilisateurs non inscrits : \' + manquants.join(\', \'));',
        'return users.length;'
      ), 'inscrits', 'contrôle par core_enrol_search_users'),
      C('open', '/group/index.php?id=${courseid}'),
      groupOption('testeric_creategroupe_${id}_1', 4),
      groupOption('testeric_creategroupe_${id}_2', 4),
      groupOption('testeric_creategroupe_${id}_3', 2),
      groupOption('testeric_creategroupe_${id}_4', 2),
      C('open', '/group/overview.php?id=${courseid}'),
      C('screenshot', 'vue d ensemble des groupes'))
  ]
};

// ---------------------------------------------------------------------------
// 06 — Modifications et contrôles (uniquement sur ce que la recette a créé)
// ---------------------------------------------------------------------------

const instanceRow = 'xpath=//tr[contains(normalize-space(.), \'testeric_createcohortecsv_${id}_2\')]';
const cohortVisible = expected => C('executeScript', js(
  WS,
  'const res = await call(\'core_cohort_search_cohorts\', {',
  '  query: \'testeric_createcohortecsv_\' + ${id} + \'_1\', context: { contextid: 1 }, includes: \'all\', limitfrom: 0, limitnum: 10 });',
  'const c = res.cohorts.find(x => Number(x.id) === Number(${cohortCsv1}));',
  'if (!c) throw new Error(\'Cohorte introuvable\');',
  'if (!!c.visible !== ' + expected + ') throw new Error(\'Visibilité de la cohorte : \' + c.visible + \', attendu ' + expected + '\');',
  'return c.visible;'
), '', 'contrôle de la visibilité par le service web');
const userSuspended = expected => C('executeScript', js(
  WS,
  'const [u] = await call(\'core_user_get_users_by_field\', { field: \'id\', values: [String(${uidIhm2})] });',
  'if (!!u.suspended !== ' + expected + ') throw new Error(\'Suspendu : \' + u.suspended + \', attendu ' + expected + '\');',
  'return u.suspended;'
), '', 'contrôle par le service web');

const p06 = {
  name: 'testeric 06 - Modifications et contrôles',
  tests: [
    test('Désactiver puis réactiver une synchronisation de cohorte',
      C('open', '/enrol/instances.php?id=${courseid}'),
      C('click', instanceRow + '//a[contains(@href,\'action=disable\')]', '', 'icône « Désactiver » de la méthode'),
      C('waitForElementPresent', instanceRow + '//a[contains(@href,\'action=enable\')]', '', 'la méthode est désactivée'),
      C('screenshot', 'synchro desactivee'),
      C('click', instanceRow + '//a[contains(@href,\'action=enable\')]', '', 'icône « Activer »'),
      C('waitForElementPresent', instanceRow + '//a[contains(@href,\'action=disable\')]', '', 'la méthode est réactivée'),
      C('screenshot', 'synchro reactivee')),
    test('Masquer puis réafficher une cohorte',
      C('open', '/cohort/edit.php?id=${cohortCsv1}'),
      C('uncheck', 'id=id_visible'),
      C('click', 'id=id_submitbutton'),
      formAccepted('/cohort/edit.php'),
      cohortVisible(false),
      C('screenshot', 'cohorte masquee'),
      C('open', '/cohort/edit.php?id=${cohortCsv1}'),
      C('check', 'id=id_visible'),
      C('click', 'id=id_submitbutton'),
      formAccepted('/cohort/edit.php'),
      cohortVisible(true)),
    test('Suspendre puis réactiver un utilisateur',
      C('open', '/user/editadvanced.php?id=${uidIhm2}&course=1'),
      C('check', 'id=id_suspended'),
      C('click', 'id=id_submitbutton'),
      formAccepted('/user/editadvanced.php'),
      userSuspended(true),
      C('open', '/user/editadvanced.php?id=${uidIhm2}&course=1'),
      C('uncheck', 'id=id_suspended'),
      C('click', 'id=id_submitbutton'),
      formAccepted('/user/editadvanced.php'),
      userSuspended(false)),
    test('Modifier le profil d\'un utilisateur',
      C('open', '/user/editadvanced.php?id=${uidIhm1}&course=1'),
      C('type', 'id=id_city', 'Ville testeric ${id}'),
      C('click', 'id=id_submitbutton'),
      formAccepted('/user/editadvanced.php'),
      C('open', '/user/profile.php?id=${uidIhm1}'),
      C('assertTextPresent', 'Ville testeric ${id}'),
      C('screenshot', 'profil modifie')),
    test('Renommer un groupe',
      C('open', '/group/group.php?courseid=${courseid}&id=${groupe4}'),
      C('type', 'id=id_name', 'testeric_updategroupe_${id}_4'),
      C('click', 'id=id_submitbutton'),
      formAccepted('/group/group.php'),
      C('open', '/group/index.php?id=${courseid}'),
      groupOption('testeric_updategroupe_${id}_4', 2),
      C('screenshot', 'groupe renomme')),
    test('Créer un groupement et y placer deux groupes',
      C('open', '/group/grouping.php?courseid=${courseid}'),
      C('type', 'id=id_name', 'testeric_creategroupement_${id}_1'),
      C('type', 'id=id_idnumber', 'testeric_creategroupement_${id}_1'),
      C('click', 'id=id_submitbutton'),
      formAccepted('/group/grouping.php'),
      C('executeScript', js(
        'const nom = \'testeric_creategroupement_\' + ${id} + \'_1\';',
        'const row = [...document.querySelectorAll(\'tr\')].find(tr => tr.textContent.includes(nom));',
        'const a = row && row.querySelector(\'a[href*="/group/assign.php"]\');',
        'if (!a) throw new Error(\'Groupement introuvable : \' + nom);',
        'return new URL(a.href).searchParams.get(\'id\');'
      ), 'groupement1'),
      C('open', '/group/assign.php?id=${groupement1}'),
      C('addSelection', 'id=addselect', 'label=contains:testeric_creategroupe_${id}_1'),
      C('addSelection', 'id=addselect', 'label=contains:testeric_creategroupe_${id}_3'),
      C('click', 'id=add'),
      C('waitForElementPresent', 'xpath=//select[@id=\'removeselect\']//option[contains(., \'testeric_creategroupe_${id}_1\')]'),
      C('waitForElementPresent', 'xpath=//select[@id=\'removeselect\']//option[contains(., \'testeric_creategroupe_${id}_3\')]'),
      C('screenshot', 'groupement')),
    test('Renommer, masquer puis réafficher une activité',
      C('open', '/course/view.php?id=${courseid}'),
      C('executeScript', js(
        'const nom = \'testeric_createpage_\' + ${id} + \'_1\';',
        'const a = [...document.querySelectorAll(\'a[href*="/mod/page/view.php?id="]\')].find(x => x.textContent.includes(nom));',
        'if (!a) throw new Error(\'Activité introuvable : \' + nom);',
        'return new URL(a.href).searchParams.get(\'id\');'
      ), 'cmPage'),
      C('open', '/course/modedit.php?update=${cmPage}'),
      C('type', 'id=id_name', 'testeric_updatepage_${id}_1'),
      C('select', 'id=id_visible', 'value=0', 'masquée pour les étudiants'),
      C('click', 'id=id_submitbutton2'),
      formAccepted('/course/modedit.php'),
      C('waitForTextPresent', 'testeric_updatepage_${id}_1'),
      C('screenshot', 'activite masquee'),
      C('open', '/course/modedit.php?update=${cmPage}'),
      C('assertSelectedValue', 'id=id_visible', '0'),
      C('select', 'id=id_visible', 'value=1'),
      C('click', 'id=id_submitbutton2'),
      formAccepted('/course/modedit.php'),
      C('open', '/course/modedit.php?update=${cmPage}'),
      C('assertSelectedValue', 'id=id_visible', '1')),
    test('Modifier le résumé et la visibilité du cours',
      C('open', '/course/edit.php?id=${courseid}'),
      editor('id_summary_editor', '\'<p>Résumé modifié testeric \' + ${id} + \'</p>\''),
      C('select', 'id=id_visible', 'value=0', 'cours caché'),
      C('click', 'id=id_saveanddisplay'),
      formAccepted('/course/edit.php'),
      C('open', '/course/edit.php?id=${courseid}'),
      C('assertSelectedValue', 'id=id_visible', '0'),
      C('select', 'id=id_visible', 'value=1', 'cours de nouveau visible'),
      C('click', 'id=id_saveanddisplay'),
      formAccepted('/course/edit.php'),
      C('open', '/course/index.php?categoryid=${catid}'),
      C('assertTextPresent', 'Résumé modifié testeric ${id}'),
      C('screenshot', 'cours modifie')),
    test('Modifier la description de la catégorie',
      C('open', '/course/editcategory.php?id=${catid}'),
      editor('id_description_editor', '\'<p>Description modifiée testeric \' + ${id} + \'</p>\''),
      C('click', 'id=id_submitbutton'),
      formAccepted('/course/editcategory.php'),
      C('open', '/course/index.php?categoryid=${catid}'),
      C('assertTextPresent', 'Description modifiée testeric ${id}'),
      C('screenshot', 'categorie modifiee')),
    test('Bilan',
      C('open', '/user/index.php?id=${courseid}&perpage=5000'),
      C('screenshot', 'participants final'),
      C('open', '/group/overview.php?id=${courseid}'),
      C('screenshot', 'groupes final'),
      C('echo', 'Recette ${id} : catégorie ${catid}, cours ${courseid}, utilisateurs ${uidIhm1} ${uidIhm2} ${uidCsv1} ${uidCsv2}, cohortes ${cohortIhm1} ${cohortIhm2} ${cohortCsv1} ${cohortCsv2}, groupes ${groupe1} ${groupe2} ${groupe3} ${groupe4}, groupement ${groupement1}'))
  ]
};

// ---------------------------------------------------------------------------
// Construction et vérification
// ---------------------------------------------------------------------------

const PROJECTS = [p00, p01, p02, p03, p04, p05, p06];
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const errors = [];
const defined = new Set(['KEY_ENTER']);

// Simule l'interprétation des scripts par le moteur : ${x} devient vars["x"].
const asScript = code => code.replace(/\$\{([A-Za-z_$][\w$]*)\}/g, 'vars["$1"]');

function checkRow(where, [command, target, value]) {
  const name = command.replace(/^\/\//, '');
  if (!FT_COMMANDS[name]) { errors.push(where + ' : commande inconnue ' + command); return; }
  if (command.startsWith('//')) return;
  const meta = FT_COMMANDS[name];
  const scriptish = meta.kind === 'script' || ['if', 'elseIf', 'while', 'repeatIf'].includes(name);
  const uses = new Set();
  for (const text of [target, value]) {
    for (const m of text.matchAll(/\$\{([A-Za-z_$][\w$]*)/g)) uses.add(m[1]);
  }
  // Valeur = nom de variable remplie par la commande : elle ne compte pas comme usage.
  for (const u of uses) {
    if (!defined.has(u)) errors.push(where + ' : variable ${' + u + '} utilisée avant d\'être définie');
  }
  if (scriptish) {
    const body = meta.kind === 'script' && name !== 'storeEval' && name !== 'waitForCondition' && !name.endsWith('Condition')
      ? target : 'return (' + target + '\n);';
    try { new AsyncFunction('vars', asScript(body)); } catch (e) { errors.push(where + ' : script invalide — ' + e.message); }
    for (const m of target.matchAll(/vars\.([A-Za-z_$][\w$]*)\s*=[^=]/g)) defined.add(m[1]);
    for (const m of target.matchAll(/vars\['([A-Za-z_$]+)' \+ n\]/g)) [1, 2, 3, 4].forEach(k => defined.add(m[1] + k));
  }
  if (/^store/.test(name) || name === 'executeScript' || name === 'storeEval') { if (value) defined.add(value); }
  if (name === 'storeUniqueId' || name === 'storeJson' || name === 'store') defined.add(value);
  if (name === 'forEach') defined.add(value);
}

const library = { projects: [], scenarios: [] };
for (const p of PROJECTS) {
  const proj = FTProject.newProject();
  proj.name = p.name;
  proj.url = URL_BASE;
  proj.tests = p.tests.map(t => {
    const test = FTProject.newTest(t.name);
    test.commands = t.rows.map((r, i) => {
      checkRow(p.name + ' / ' + t.name + ' / ligne ' + (i + 1), r);
      return Object.assign(FTProject.newCommand(r[0], r[1], r[2]), { comment: r[3] || '' });
    });
    try { FTEngine.analyze(test.commands); } catch (e) { errors.push(p.name + ' / ' + t.name + ' : ' + e.message); }
    return test;
  });
  proj.suites = [{ id: FTProject.uid(), name: 'Tous les tests', persistSession: false, parallel: false, timeout: 300, tests: proj.tests.map(t => t.id) }];
  library.projects.push(proj);
}

if (errors.length) {
  console.error('ERREURS :\n' + errors.join('\n'));
  process.exit(1);
}

const scenario = Object.assign(FTProject.newScenario('testeric - recette Moodle 4.5'), {
  url: URL_BASE,
  stopOnFailure: true,
  items: library.projects.map(p => p.id)
});

const outDir = __dirname;
const slug = s => s.replace(/[^\w-]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
for (const p of library.projects) fs.writeFileSync(path.join(outDir, slug(p.name) + '.side'), FTProject.serialize(p));
fs.writeFileSync(path.join(outDir, 'testeric-moodle45.scenario.json'), FTProject.serializeScenario(scenario, library.projects));

// Relecture : le fichier scénario doit se recharger tel quel.
const back = FTProject.parseAny(fs.readFileSync(path.join(outDir, 'testeric-moodle45.scenario.json'), 'utf8'));
const nbCmds = library.projects.reduce((s, p) => s + p.tests.reduce((a, t) => a + t.commands.length, 0), 0);
console.log('OK : ' + back.projects.length + ' projets, ' + library.projects.reduce((s, p) => s + p.tests.length, 0) +
  ' tests, ' + nbCmds + ' commandes ; scénario « ' + back.scenario.name + ' ».');

'use strict';

// Génère exemples-moodle.side (node exemples/generer.js) et vérifie chaque test avec le vrai moteur.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { randomUUID } = require('crypto');

const ctx = vm.createContext({ crypto: { randomUUID }, Blob, console });
for (const f of ['commands.js', 'project.js', 'engine.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'ide', f), 'utf8'), ctx, { filename: f });
}
const { FTProject, FTEngine, FT_COMMANDS } = vm.runInContext('({ FTProject, FTEngine, FT_COMMANDS })', ctx);

// [commande, cible, valeur, commentaire]
const TESTS = {
  '01 - Variables : les bases': [
    ['open', '/', ''],
    ['store', 'Bonjour', 'salutation', 'crée la variable « salutation »'],
    ['echo', '${salutation} tout le monde', ''],
    ['storeTitle', '', 'titre', 'lit le titre de la page'],
    ['echo', 'Le titre de la page est : ${titre}', ''],
    ['storeLocation', '', 'adresse'],
    ['echo', 'Nous sommes sur ${adresse}', ''],
    ['store', '3', 'nombre'],
    ['assert', 'nombre', '3', 'arrête le test si nombre ne vaut pas 3']
  ],
  '02 - Connexion': [
    ['store', 'admin', 'identifiant', 'à remplacer'],
    ['store', 'MotDePasse!1', 'motdepasse', 'à remplacer'],
    ['open', '/login/index.php', ''],
    ['storeElementCount', 'id=username', 'champs', '1 si le formulaire est affiché, 0 si déjà connecté'],
    ['if', '${champs} > 0', ''],
    ['type', 'id=username', '${identifiant}'],
    ['type', 'id=password', '${motdepasse}'],
    ['click', 'id=loginbtn', ''],
    ['else', '', ''],
    ['echo', 'Déjà connecté : connexion ignorée', ''],
    ['end', '', ''],
    ['waitForElementPresent', 'id=user-menu-toggle', '', 'le menu utilisateur prouve la connexion']
  ],
  '03 - Créer un cours au nom unique': [
    ['storeUniqueId', 'cours', 'id', 'ex. cours-20260925-221530-k3f9'],
    ['open', '/course/edit.php?category=1', ''],
    ['type', 'id=id_fullname', 'Cours de test ${id}'],
    ['type', 'id=id_shortname', '${id}'],
    ['click', 'id=id_saveanddisplay', ''],
    ['waitForTextPresent', 'Cours de test ${id}', ''],
    ['storeLocation', '', 'urlCours'],
    ['echo', 'Cours créé : ${urlCours}', '']
  ],
  '04 - JavaScript et variables': [
    ['open', '/', ''],
    ['executeScript', 'return M.cfg.wwwroot;', 'racine', 'le résultat du return va dans « racine »'],
    ['echo', 'Adresse du Moodle : ${racine}', ''],
    ['executeScript', 'return document.querySelectorAll(\'a\').length;', 'nbLiens'],
    ['if', '${nbLiens} > 10', ''],
    ['echo', 'Page riche : ${nbLiens} liens', ''],
    ['end', '', ''],
    ['store', '5', 'a'],
    ['executeScript', 'vars.b = Number(${a}) * 2;\nvars.message = \'le double de \' + ${a} + \' est \' + vars.b;', '', 'crée b et message'],
    ['echo', '${message}', ''],
    ['assert', 'b', '10', '']
  ],
  '05 - Boucles': [
    ['open', '/', '', 'les conditions s\'évaluent dans la page : il en faut une'],
    ['storeJson', '["Alice", "Bob", "Chloé"]', 'prenoms'],
    ['forEach', 'prenoms', 'prenom', 'prenom prend chaque valeur de la liste'],
    ['echo', 'Bonjour ${prenom}', ''],
    ['end', '', ''],
    ['times', '3', ''],
    ['storeUniqueId', 'u', 'id'],
    ['echo', 'Identifiant tiré : ${id}', ''],
    ['end', '', ''],
    ['store', '0', 'compteur'],
    ['while', '${compteur} < 3', ''],
    ['executeScript', 'vars.compteur = Number(${compteur}) + 1;', ''],
    ['echo', 'Tour numéro ${compteur}', ''],
    ['end', '', '']
  ],
  '06 - Déposer des utilisateurs générés': [
    ['storeUniqueId', 'etu', 'id'],
    ['createFile',
      'username,firstname,lastname,email,password\n' +
      '${id}-1,Alice,Test,${id}-1@exemple.fr,Test-1234!\n' +
      '${id}-2,Bob,Test,${id}-2@exemple.fr,Test-1234!',
      'utilisateurs-${id}.csv', 'fabrique le CSV en mémoire'],
    ['open', '/admin/tool/uploaduser/index.php', ''],
    ['click', 'css=.fp-btn-choose', '', 'bouton « Choisir un fichier… »'],
    ['click', 'xpath=//span[contains(@class,\'fp-repo-name\')][normalize-space()=\'Déposer un fichier\']', ''],
    ['uploadFile', 'name=repo_upload_file', 'utilisateurs-${id}.csv'],
    ['click', 'css=.fp-upload-btn', '', 'bouton « Déposer ce fichier »'],
    ['waitForTextPresent', 'utilisateurs-${id}.csv', '', 'le nom du fichier apparaît dans le formulaire'],
    ['click', 'id=id_submitbutton', '', 'vers l\'aperçu'],
    ['click', 'id=id_submitbutton', '', 'lance la création'],
    ['waitForTextPresent', 'Utilisateurs créés', ''],
    ['assertTextPresent', '${id}-1', '']
  ],
  '07 - Attendre les chargements': [
    ['open', '/my/', ''],
    ['waitForAjax', '', '', 'navigation, requêtes, jQuery et M.util.pending_js terminés'],
    ['waitForCondition', 'M.util.pending_js.length === 0', '20000', 'la même chose, écrite en JavaScript'],
    ['echo', 'Tableau de bord chargé', '']
  ]
};

const project = FTProject.newProject();
project.name = 'Exemples Moodle';
project.url = 'https://moodle.exemple.fr';
project.tests = [];
for (const [name, rows] of Object.entries(TESTS)) {
  const t = FTProject.newTest(name);
  t.commands = rows.map(([c, target, value, comment]) =>
    Object.assign(FTProject.newCommand(c, target, value), { comment: comment || '' }));
  for (const c of t.commands) {
    if (!FT_COMMANDS[c.command]) throw new Error(name + ' : commande inconnue ' + c.command);
  }
  FTEngine.analyze(t.commands);
  project.tests.push(t);
}
project.suites = [{ id: FTProject.uid(), name: 'Tous les exemples', persistSession: false, parallel: false, timeout: 300, tests: project.tests.map(t => t.id) }];

const out = path.join(__dirname, 'exemples-moodle.side');
fs.writeFileSync(out, FTProject.serialize(project));
FTProject.parse(fs.readFileSync(out, 'utf8'));
console.log('OK : ' + project.tests.length + ' tests écrits dans ' + out);

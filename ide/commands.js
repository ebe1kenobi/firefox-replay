'use strict';

// kind : engine (géré par le moteur), action (DOM + attente AJAX après), dom (DOM sans attente),
// script (JavaScript dans la page), flow (structure de contrôle).
const FT_COMMANDS = (function () {
  const LOC = 'localisateur';
  const PAT = 'texte attendu (préfixes possibles : contains:, regexp:, regexpi:, glob:, exact:)';
  const C = {};
  const def = (name, kind, t, v, d) => { C[name] = { kind, t, v, d }; };

  def('open', 'engine', 'URL (absolue, ou relative à l\'URL de base du projet)', '', 'Ouvre une URL et attend la fin du chargement.');
  def('pause', 'engine', 'durée en ms', '', 'Attend la durée indiquée.');
  def('echo', 'engine', 'message (les ${variables} sont remplacées)', '', 'Écrit un message dans le journal.');
  def('store', 'engine', 'valeur', 'nom de variable', 'Stocke une valeur dans une variable.');
  def('storeJson', 'engine', 'JSON', 'nom de variable', 'Stocke un objet ou un tableau JSON dans une variable.');
  def('assert', 'engine', 'nom de variable', 'valeur attendue', 'Arrête le test si la variable n\'a pas la valeur attendue.');
  def('verify', 'engine', 'nom de variable', 'valeur attendue', 'Comme assert, mais le test continue en cas d\'échec.');
  def('selectFrame', 'engine', 'relative=top | relative=parent | index=N | localisateur de l\'iframe', '', 'Les commandes suivantes s\'exécutent dans ce cadre (iframe).');
  def('waitForAjax', 'engine', 'délai max en ms (optionnel)', '', 'Attend la fin des navigations, des requêtes XHR/fetch, de jQuery.active et de M.util.pending_js (Moodle).');
  def('waitForPageLoad', 'engine', 'délai max en ms (optionnel)', '', 'Identique à waitForAjax.');
  def('setSpeed', 'engine', 'délai entre commandes (ms)', '', 'Change la vitesse d\'exécution.');
  def('setTimeout', 'engine', 'délai en ms', '', 'Change le délai maximal d\'attente des éléments pour la suite du test.');
  def('storeUniqueId', 'engine', 'préfixe (optionnel)', 'nom de variable', 'Stocke un identifiant unique, ex. etu-20260925-215930-k3f9 (date, heure et 4 caractères aléatoires).');
  def('createFile', 'engine', 'contenu du fichier (plusieurs lignes et ${variables} permises ; base64:... pour un fichier binaire)', 'nom du fichier, ex. inscrits-${id}.csv', 'Crée un fichier en mémoire pour ce test, à envoyer ensuite avec uploadFile.');
  def('screenshot', 'engine', 'libellé ajouté au nom du fichier (optionnel)', 'vide = page entière ; visible = partie affichée seulement',
    'Enregistre une capture PNG dans Téléchargements/Replay/<scénario ou projet>/<date-heure du lancement>/, nommée : numéro d\'ordre - test - ligne - commande précédente - libellé.');
  def('log', 'engine', 'expression ou ${variable}', '', 'Alias de echo.');

  def('executeScript', 'script', 'code JavaScript (corps de fonction, utiliser return ; await possible)', 'variable où stocker le résultat (optionnel)', 'Exécute du JS dans la page. Les variables sont accessibles par ${nom} ou vars.nom ; modifier vars.x crée/modifie la variable x.');
  def('executeAsyncScript', 'script', 'code JavaScript (await possible)', 'variable (optionnel)', 'Identique à executeScript.');
  def('runScript', 'script', 'code JavaScript', '', 'Exécute du JS dans la page sans stocker de résultat.');
  def('storeEval', 'script', 'expression JavaScript', 'nom de variable', 'Évalue une expression dans la page et stocke le résultat.');
  def('waitForCondition', 'script', 'expression JavaScript', 'délai max en ms (optionnel)', 'Attend que l\'expression soit vraie.');
  def('assertCondition', 'script', 'expression JavaScript', '', 'Arrête le test si l\'expression est fausse.');
  def('verifyCondition', 'script', 'expression JavaScript', '', 'Comme assertCondition, sans arrêter le test.');

  def('if', 'flow', 'expression JavaScript', '', 'Exécute le bloc si l\'expression est vraie. Fermer par end.');
  def('elseIf', 'flow', 'expression JavaScript', '', 'Branche alternative d\'un if.');
  def('else', 'flow', '', '', 'Branche par défaut d\'un if.');
  def('while', 'flow', 'expression JavaScript', '', 'Répète le bloc tant que l\'expression est vraie. Fermer par end.');
  def('times', 'flow', 'nombre de répétitions', '', 'Répète le bloc N fois. Fermer par end.');
  def('forEach', 'flow', 'variable contenant un tableau', 'variable d\'itération', 'Répète le bloc pour chaque élément du tableau. Fermer par end.');
  def('do', 'flow', '', '', 'Début d\'une boucle terminée par repeatIf.');
  def('repeatIf', 'flow', 'expression JavaScript', '', 'Recommence la boucle do si l\'expression est vraie.');
  def('end', 'flow', '', '', 'Ferme un bloc if, while, times ou forEach.');

  def('click', 'action', LOC, '', 'Clique sur l\'élément (attend qu\'il soit visible et actif).');
  def('clickAt', 'action', LOC, 'coordonnées (ignorées)', 'Comme click.');
  def('doubleClick', 'action', LOC, '', 'Double-clic.');
  def('doubleClickAt', 'action', LOC, 'coordonnées (ignorées)', 'Comme doubleClick.');
  def('type', 'action', LOC, 'texte', 'Remplace la valeur du champ.');
  def('sendKeys', 'action', LOC, 'touches, ex. abc${KEY_ENTER}', 'Tape touche par touche. Touches : ${KEY_ENTER} ${KEY_TAB} ${KEY_ESC} ${KEY_BACKSPACE} ${KEY_DOWN} ${KEY_UP} ${KEY_LEFT} ${KEY_RIGHT}...');
  def('select', 'action', LOC + ' du <select>', 'label=... | value=... | index=... | id=...', 'Choisit une option d\'une liste.');
  def('addSelection', 'action', LOC + ' du <select multiple>', 'label=... | value=...', 'Ajoute une option à une sélection multiple.');
  def('removeSelection', 'action', LOC + ' du <select multiple>', 'label=... | value=...', 'Retire une option d\'une sélection multiple.');
  def('check', 'action', LOC, '', 'Coche la case (sans effet si déjà cochée).');
  def('uncheck', 'action', LOC, '', 'Décoche la case.');
  def('submit', 'action', LOC + ' du formulaire ou d\'un de ses champs', '', 'Soumet le formulaire.');
  def('editContent', 'action', LOC + ' de la zone éditable', 'HTML', 'Remplace le contenu d\'une zone contenteditable (éditeur TinyMCE/Atto).');
  def('uploadFile', 'action', LOC + ' du champ fichier, ou de la zone de dépôt', 'nom du fichier créé par createFile (un par ligne pour plusieurs)', 'Met le fichier dans un <input type=file>, ou le dépose par glisser-déposer sur l\'élément (gestionnaire de fichiers de Moodle).');
  def('mouseOver', 'action', LOC, '', 'Survol de l\'élément.');
  def('mouseOut', 'action', LOC, '', 'Fin de survol.');
  def('mouseDown', 'action', LOC, '', 'Bouton de souris enfoncé.');
  def('mouseUp', 'action', LOC, '', 'Bouton de souris relâché.');
  def('focus', 'dom', LOC, '', 'Donne le focus à l\'élément.');
  def('scrollTo', 'dom', LOC, '', 'Fait défiler jusqu\'à l\'élément.');

  def('storeText', 'dom', LOC, 'nom de variable', 'Stocke le texte visible de l\'élément.');
  def('storeValue', 'dom', LOC, 'nom de variable', 'Stocke la valeur d\'un champ.');
  def('storeAttribute', 'dom', LOC + '@attribut', 'nom de variable', 'Stocke un attribut, ex. css=a.btn@href.');
  def('storeTitle', 'dom', '', 'nom de variable', 'Stocke le titre de la page.');
  def('storeLocation', 'dom', '', 'nom de variable', 'Stocke l\'URL courante.');
  def('storeXpathCount', 'dom', 'expression XPath', 'nom de variable', 'Stocke le nombre d\'éléments trouvés.');
  def('storeElementCount', 'dom', LOC, 'nom de variable', 'Stocke le nombre d\'éléments trouvés.');

  const CHECKS = {
    Text: [LOC, PAT, 'le texte visible de l\'élément correspond'],
    NotText: [LOC, PAT, 'le texte de l\'élément ne correspond pas'],
    Value: [LOC, PAT, 'la valeur du champ correspond'],
    NotValue: [LOC, PAT, 'la valeur du champ ne correspond pas'],
    ElementPresent: [LOC, '', 'l\'élément existe'],
    ElementNotPresent: [LOC, '', 'l\'élément n\'existe pas'],
    ElementVisible: [LOC, '', 'l\'élément est visible'],
    ElementNotVisible: [LOC, '', 'l\'élément est absent ou invisible'],
    Editable: [LOC, '', 'le champ est modifiable'],
    NotEditable: [LOC, '', 'le champ n\'est pas modifiable'],
    Checked: [LOC, '', 'la case est cochée'],
    NotChecked: [LOC, '', 'la case n\'est pas cochée'],
    SelectedLabel: [LOC, PAT, 'le libellé de l\'option choisie correspond'],
    SelectedValue: [LOC, PAT, 'la valeur de l\'option choisie correspond'],
    NotSelectedValue: [LOC, PAT, 'la valeur choisie ne correspond pas'],
    Title: ['titre attendu', '', 'le titre de la page correspond'],
    TextPresent: ['texte', '', 'le texte apparaît dans la page'],
    TextNotPresent: ['texte', '', 'le texte n\'apparaît pas dans la page'],
    Attribute: [LOC + '@attribut', PAT, 'l\'attribut correspond'],
    ElementCount: [LOC, 'nombre', 'le nombre d\'éléments trouvés est exact']
  };
  for (const [s, [t, v, what]] of Object.entries(CHECKS)) {
    def('assert' + s, 'dom', t, v, 'Arrête le test sauf si ' + what + '.');
    def('verify' + s, 'dom', t, v, 'Signale une erreur sans arrêter le test sauf si ' + what + '.');
    def('waitFor' + s, 'dom', t, v, 'Attend que ' + what + ' (jusqu\'au délai maximal).');
  }
  def('waitForElementEditable', 'dom', LOC, '', 'Attend que le champ soit modifiable.');
  def('waitForElementNotEditable', 'dom', LOC, '', 'Attend que le champ ne soit plus modifiable.');
  return C;
})();

const FT_BLOCK_OPEN = new Set(['if', 'while', 'times', 'forEach']);

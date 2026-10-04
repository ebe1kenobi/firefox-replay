# Replay

Extension Firefox inspirée de Selenium IDE : elle enregistre les actions faites dans une page, puis les rejoue.
Elle est pensée pour les tests fonctionnels d'un Moodle (attente des chargements AJAX, éditeur TinyMCE en iframe,
id dynamiques ignorés), mais marche sur n'importe quel site.

Les projets s'enregistrent au format **.side** de Selenium IDE : on peut échanger les fichiers avec lui.

**Pour apprendre par l'exemple : [GUIDE.md](GUIDE.md)** (variables, JavaScript, boucles, fichiers générés,
attentes), avec les tests correspondants à ouvrir (« Ouvrir un fichier… ») : `exemples/exemples-moodle.side`
(régénéré et vérifié par `node exemples/generer.js`).

## Installation

**Pour essayer** (l'extension disparaît à la fermeture de Firefox) :

1. Ouvrir `about:debugging#/runtime/this-firefox`.
2. Cliquer sur « Charger un module complémentaire temporaire… » et choisir `manifest.json` dans ce dossier.

**Pour la garder** : Firefox n'accepte durablement que les extensions signées. Deux solutions :

- Firefox Developer Edition ou Nightly : mettre `xpinstall.signatures.required` à `false` dans `about:config`,
  puis installer le zip de l'extension (voir « Empaqueter » plus bas).
- Faire signer l'extension (gratuitement, sans la publier) sur addons.mozilla.org, en mode « non listé ».

## Utilisation

Le bouton de l'extension (ou **Ctrl+Maj+Y**) ouvre la fenêtre de l'outil, agrandie ; un second clic la ramène au
premier plan. Elle se compose de trois zones :

- **à gauche, la navigation**, avec en haut deux modes : **Projets** (tous les projets) et **Scénarios** (tous les
  scénarios, dépliables pour voir leurs projets). Un clic sur un projet, dans l'un ou l'autre mode, le charge au centre ;
- **au centre, le projet chargé** : son nom et ses actions, l'URL de base, le choix du test, les boutons
  d'enregistrement et de lecture, puis le tableau des commandes ;
- **à droite**, l'éditeur de la commande sélectionnée et le journal.

La fenêtre agit sur **l'onglet actif de la dernière fenêtre Firefox utilisée** : la barre bleue en haut indique lequel.
Pour changer de cible, cliquer dans une autre fenêtre Firefox. Avec deux écrans : l'outil sur l'un, le site sur l'autre.

1. Ouvrir la page Moodle de départ, puis cliquer sur **● Enregistrer**.
2. Agir normalement : clics, saisies, listes, cases à cocher, touches Entrée/Échap/flèches, éditeur de texte.
3. **Clic droit dans la page > Replay** : ajouter une attente ou une vérification sur l'élément visé
   (« attendre que ce texte apparaisse », « vérifier le texte », « stocker le texte dans une variable »,
   « attendre la fin des chargements AJAX », « pause 1 s »).
4. Arrêter l'enregistrement, puis **▶ Test** pour rejouer.

Pendant le rejeu : **❚❚ Pause**, **Pas à pas**, **■ Stop**, et le curseur de vitesse. Un clic dans la marge
gauche d'une ligne pose un **point d'arrêt**. **▶ D'ici** lance le test à partir de la ligne sélectionnée ;
**Exécuter la ligne** n'exécute que celle-ci (pratique pour mettre au point un localisateur ou un script).

Dans l'éditeur de commande, **Désigner** permet de cliquer sur un élément de la page pour remplir la cible,
et **Voir** surligne l'élément correspondant à la cible. La liste « Autres localisateurs » propose les variantes
enregistrées (id, name, label, texte du lien, CSS, XPath).

**Détacher** (en tête du journal) ouvre le journal dans une fenêtre séparée, redimensionnable, avec des filtres
(masquer les variables, erreurs seulement). Fermer cette fenêtre ou cliquer sur « Rattacher » le remet à sa place.
Le journal ne suit la fin que si on y est déjà : on peut remonter le lire pendant l'exécution.

Raccourcis dans le tableau : flèches, Maj+clic (sélection multiple), Suppr, Inser, Ctrl+C / Ctrl+X / Ctrl+V,
Ctrl+A (tout sélectionner), Alt+↑ / Alt+↓ (déplacer), Ctrl+Z (annuler), Entrée (éditer).

### Projets et scénarios

L'outil garde **plusieurs projets** ; chacun a ses tests et sa propre URL de base. Dans la navigation, mode Projets :
**+ Nouveau projet** crée un projet vide, **Ouvrir un fichier…** ajoute un projet depuis un `.side` (s'il est déjà
présent, on choisit entre le remplacer et en faire une copie). En haut du projet chargé : **Renommer**,
**Importer des tests…** (ajoute les tests d'un `.side` à ce projet), **Exporter** (en `.side`), **Supprimer**.
Dans la liste des projets, le bouton **✕** d'une ligne (visible au survol, et sur le projet chargé) supprime ce
projet sans avoir à le charger ; il est aussi retiré des scénarios qui l'utilisaient (une confirmation les cite).
Tout est sauvegardé automatiquement dans le navigateur.

Un **scénario** enchaîne plusieurs projets et les lance d'un coup. Dans la navigation, mode Scénarios :

1. **+ Nouveau scénario**, puis, dans le scénario déplié, choisir un projet et **Ajouter**, dans l'ordre voulu
   (le même projet peut revenir plusieurs fois, par exemple un projet « Connexion » en tête). Les boutons ↑ ↓ ✕
   d'un projet du scénario le déplacent ou le retirent (le projet lui-même n'est pas supprimé).
2. **▶** (sur la ligne du scénario) ou **▶ Lancer** : chaque projet joue tous ses tests, avec sa propre URL de base
   (ou celle du scénario si elle est remplie, voir plus bas).
   Une pastille indique l'état de chaque projet : jaune en cours, vert réussi, rouge en échec. Le journal indique le
   début de chaque projet, puis un bilan : projets réussis ou en échec, et quels tests ont échoué.
3. Par défaut, un projet en échec n'empêche pas les suivants ; cocher « Arrêter dès qu'un projet échoue »
   pour le contraire. **■ Stop** arrête tout le scénario.

**Exporter** (dans le scénario déplié) crée un fichier `.scenario.json` qui contient le scénario **et** ses projets :
le transmettre suffit, **Ouvrir un fichier…** le recharge tel quel chez quelqu'un d'autre.

En mode Projets, la pastille d'un projet montre le résultat de son dernier « Tous les tests » ou scénario.

Le scénario déplié a aussi un champ **URL de base du scénario** : s'il est rempli, il **remplace** l'URL de base de
tous ses projets pendant le scénario (pratique pour passer d'un Moodle de recette à un autre). Dans ce cas, changer
l'URL d'un projet ne change rien pendant le scénario : un bandeau jaune sous l'URL du projet le rappelle, et le
journal l'indique au lancement. Vider le champ pour que chaque projet utilise sa propre URL.

**Variables** : un seul jeu de variables, commun à tout l'outil. Elles passent d'un test au suivant et d'un projet
au suivant dans un scénario ; un scénario part de zéro ; les autres lancements reprennent les variables de
l'exécution précédente ; **Vider les variables** (en tête du journal) les efface ; fermer la fenêtre les perd.
Détail et exemples : [GUIDE.md](GUIDE.md), « Durée de vie des variables ».

Une recette complète pour Moodle 4.5 est fournie : [exemples/moodle45](exemples/moodle45/README.md).

### URL de base

La première commande `open` est enregistrée en chemin relatif (`/course/view.php?id=2`) et complétée par
l'URL de base du projet. Pour passer d'un Moodle de développement à un Moodle de recette, il suffit de changer
l'URL de base. Si Moodle est dans un sous-dossier, l'indiquer : `https://serveur/moodle`.

Ordre de priorité : pendant un scénario, **l'URL du scénario** si elle est remplie, sinon celle du projet ; en
dehors d'un scénario, toujours celle du projet. Une URL complète (`https://…`) dans un `open` n'est jamais modifiée.

## Attentes et chargements AJAX

Après chaque action (clic, saisie, envoi, script…), le moteur attend que la page soit calme pendant 100 ms :

- aucune navigation en cours ;
- document entièrement chargé ;
- aucune requête XHR/fetch en cours dans l'onglet (suivies par l'extension, indépendamment de la page) ;
- `jQuery.active` à 0 ;
- `M.util.pending_js` vide — c'est le compteur que Moodle tient pour ses propres tests Behat.

Avant d'agir sur un élément, le moteur attend aussi qu'il existe, qu'il soit visible et actif, jusqu'au délai
maximal (30 s par défaut, dans **Réglages**).

Si une requête tourne en permanence (sondage de la messagerie, par exemple), le journal l'indique après le délai ;
ajouter son URL dans **Réglages > URL à ignorer** (une expression régulière par ligne).

Commandes d'attente explicites : `waitForAjax`, `waitForElementPresent`, `waitForElementVisible`,
`waitForElementNotVisible`, `waitForText`, `waitForTextPresent`, `waitForValue`, `waitForCondition` (expression
JavaScript), `pause` (durée fixe). Pour les commandes `waitForElement…`, la colonne Valeur peut donner un délai
maximal en ms.

## Variables et JavaScript

- `store | Bonjour | salut` crée la variable `salut` ; `${salut}` est remplacé partout dans les cibles et valeurs.
- `storeJson | ["a","b"] | liste` crée un tableau ; `${obj.champ}` lit un champ d'objet.
- `storeText`, `storeValue`, `storeAttribute` (`css=a.btn@href`), `storeTitle`, `storeLocation`,
  `storeElementCount` lisent la page.
- `executeScript | return document.title; | titre` exécute du JavaScript **dans la page** (accès à `M`,
  `require`, `jQuery`…) et stocke le résultat. `await` est permis.
  Dans le code, `${x}` désigne la variable elle-même (pas besoin de guillemets), et `vars.x = …` crée ou modifie
  une variable.
- `assert | titre | Accueil` compare une variable ; `assertCondition | ${n} > 3` teste une expression.

Structures de contrôle (fermées par `end`) : `if` / `elseIf` / `else`, `while`, `times`, `forEach`
(`forEach | liste | element`), et `do` … `repeatIf`. Préfixer une commande par `//` la désactive.

Exemple :

```
open            | /login/index.php
type            | id=username                | ${utilisateur}
type            | id=password                | ${motdepasse}
click           | id=loginbtn
waitForElementVisible | css=[data-region="drawer"]
executeScript   | return M.cfg.sesskey;      | sesskey
if              | ${sesskey}.length > 0
  echo          | Connecté, sesskey = ${sesskey}
end
```

Les textes attendus des commandes `assert…` / `verify…` / `waitFor…` sont comparés exactement (espaces
normalisés), sauf préfixe : `contains:`, `regexp:`, `regexpi:`, `glob:` (avec `*` et `?`), `exact:`.
Les `assert…` arrêtent le test en cas d'échec, les `verify…` le signalent et continuent.

La liste complète des commandes, avec leur aide, apparaît dans l'éditeur (autocomplétion du champ Commande).

## Envoi de fichiers

Les fichiers sont fabriqués pendant le test, en mémoire, ce qui permet un contenu différent à chaque exécution :

```
storeUniqueId | etu                                   | id
createFile    | username,firstname,lastname,email
                ${id}-1,Alice,Test,${id}-1@exemple.fr
                ${id}-2,Bob,Test,${id}-2@exemple.fr   | inscrits-${id}.csv
uploadFile    | name=userfile                         | inscrits-${id}.csv
```

- `storeUniqueId` donne un identifiant du type `etu-20260925-215930-k3f9` (date, heure, 4 caractères aléatoires).
- `createFile` : la cible est le contenu (plusieurs lignes et `${variables}` permises), la valeur le nom du fichier ;
  le type MIME vient de l'extension (`.csv`, `.txt`, `.pdf`, `.png`…). Pour un fichier binaire : `base64:…`.
  Le contenu peut aussi venir d'un script : `executeScript | …return texte; | contenu` puis `createFile | ${contenu} | …`.
- `uploadFile` : sur un `<input type=file>`, le fichier y est placé ; sur tout autre élément, il est déposé par
  glisser-déposer, ce qui marche avec la zone de dépôt du gestionnaire de fichiers de Moodle.
  Plusieurs fichiers : un nom par ligne.
- Dans le sélecteur de fichiers de Moodle : cliquer sur « Ajouter… », puis « Déposer un fichier »,
  `uploadFile | name=repo_upload_file | …`, puis cliquer sur « Déposer ce fichier ».

Les fichiers n'existent que pendant l'exécution du test ; ils ne sont pas enregistrés dans le `.side`.

## Captures d'écran

`screenshot | libellé (facultatif) | vide ou visible` enregistre une capture PNG de la page entière (ou seulement
de la partie affichée avec `visible`) dans le dossier Téléchargements :

```
Replay/<nom du scénario ou du projet>/<date-heure du lancement>/<n°> - [<projet> -] <test> - ligne <n> - <commande précédente> - <libellé>.png
```

Le numéro d'ordre suit l'exécution, les fichiers sont donc triés chronologiquement. Sur Moodle 4, où la page défile
dans un bloc intérieur, ce bloc est déplié le temps de la capture. Par défaut (Réglages), une capture est aussi prise
quand une commande échoue (libellé `ECHEC`). Les captures n'encombrent pas la liste des téléchargements de Firefox.

## Conseils pour Moodle

- Les id générés par YUI (`yui_3_17_…`) et les id `uniqid` sont écartés à l'enregistrement : le localisateur
  retenu est alors `data-region`, `data-action`, le texte du lien ou du bouton, ou un chemin CSS.
- `label=Nom complet du cours` trouve un champ par son libellé : lisible et robuste.
- L'éditeur TinyMCE est dans une iframe : l'enregistrement ajoute `selectFrame` et une commande `editContent`.
- Ne pas enregistrer d'URL contenant `sesskey` dans un `open` : la clé change à chaque session.
- Les mots de passe saisis sont enregistrés en clair dans le test : utiliser un compte de test, ou une variable
  (`${motdepasse}`) définie par un `store` en tête de test et retirée avant de partager le fichier.

## Limites

- Les iframes d'**une autre origine** ne sont pas accessibles (le journal le signale à l'enregistrement).
- Un fichier choisi à la main pendant l'enregistrement ne peut pas être relu depuis le disque : l'enregistrement
  produit `uploadFile` avec son nom, et il faut ajouter avant un `createFile` qui le fabrique.
- Les liens qui ouvrent un **nouvel onglet** ne sont pas suivis : le test reste dans l'onglet de départ.
- Les scripts (`executeScript`, conditions) sont injectés dans la page : une page dont la CSP interdit les scripts
  en ligne les bloque (ce n'est pas le cas de Moodle par défaut).
- Les événements rejoués sont simulés (non « de confiance ») : un code qui vérifie `event.isTrusted` les refuse.

## Empaqueter

```bash
npx web-ext@7.12.0 build --source-dir . --ignore-files test exemples
```

(Avec Node 18.12, la dernière version de web-ext ne démarre pas ; la version 7 fonctionne.)

## Banc d'essai (développement)

`test/` contient une page imitant Moodle et un harnais qui charge le vrai script de contenu et le vrai moteur
avec une API `browser` simulée, pour tester hors de Firefox :

```bash
python -m http.server 8765 --bind 127.0.0.1
```

- `http://localhost:8765/test/harness.html` : « Test automatique » rejoue 62 commandes (AJAX, iframe, boucles,
  variables, fichiers générés et envoyés, envoi par Entrée) et doit afficher « CONFORME » ; « Enregistrer » permet d'essayer l'enregistreur.
- `http://localhost:8765/test/ide-preview.html` : aperçu de la fenêtre de l'outil.

## Organisation

- `background.js` : suivi des requêtes et navigations par onglet, état d'enregistrement, menu contextuel.
- `content/locators.js` : génération et résolution des localisateurs.
- `content/content.js` : enregistreur, exécution des commandes dans la page, désignation d'élément.
- `ide/engine.js` : moteur de rejeu (structures de contrôle, variables, attentes).
- `ide/commands.js` : catalogue et aide des commandes.
- `ide/project.js` : format `.side`, bibliothèque de projets et scénarios.
- `ide/ide.*` : fenêtre de l'outil ; `ide/log.*` : journal détaché.

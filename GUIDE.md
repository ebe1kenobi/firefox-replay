# Guide pratique : variables, JavaScript, boucles, fichiers

Chaque exemple de ce guide existe tout prêt dans [exemples/exemples-moodle.side](exemples/exemples-moodle.side).

## 0. Charger les exemples

1. Dans la navigation à gauche (mode **Projets**), cliquer sur **Ouvrir un fichier…** et choisir
   `exemples/exemples-moodle.side`. Le projet « Exemples Moodle » s'ajoute à la liste et se charge au centre ;
   ses sept tests, de « 01 » à « 07 », sont dans la liste « Test ».
2. Remplacer l'**URL de base** par l'adresse de votre Moodle, par exemple `http://localhost/moodle`.
3. Choisir un test dans la liste, puis **▶ Test**. Le journal montre chaque étape.

Les tests 03 et 06 demandent d'être connecté en administrateur : lancer d'abord le 02, ou vous connecter
à la main. La session reste ouverte ensuite, comme dans une navigation normale.

## 1. Lire une ligne

Chaque ligne du tableau est une commande, en trois colonnes :

| Commande | Cible | Valeur |
|---|---|---|
| ce qu'on fait | sur quoi on le fait | avec quelle donnée |

Exemple : `type | id=id_fullname | Mon cours` veut dire « écrire *Mon cours* dans le champ dont l'id est *id_fullname* ».

Pour écrire une ligne à la main : **+ Ligne**, puis remplir les champs Commande, Cible et Valeur sous le tableau.
Sous chaque champ, une aide rappelle ce qu'il attend pour la commande choisie.
Dans Cible et Valeur, **Entrée** passe à la ligne : c'est ainsi qu'on écrit un script ou un fichier de plusieurs lignes.

## 2. Les variables : le principe

Une variable est une boîte qui porte un nom.

- **La remplir** : les commandes `store…` ou `executeScript`. On écrit son **nom tout seul**, sans `${ }`,
  dans la colonne Valeur.
- **S'en servir** : on écrit `${nom}` n'importe où dans Cible ou Valeur ; au moment de l'exécution,
  `${nom}` est remplacé par son contenu.

### Durée de vie des variables

Il n'y a qu'**un seul jeu de variables**, commun à tout l'outil. Il se remplit pendant les exécutions et reste en
mémoire entre elles :

| Situation | Les variables existantes… |
|---|---|
| d'une ligne à l'autre d'un test | sont conservées |
| d'un test au suivant, pendant **▶▶ Tous les tests** | sont conservées |
| d'un projet au suivant, pendant un **scénario** | sont conservées : `${id}` créé dans le projet 00 sert jusqu'au dernier projet |
| au lancement d'un **scénario** | sont **vidées** : un scénario part toujours de zéro |
| au lancement de **▶ Test**, **▶ D'ici**, **▶▶ Tous les tests** ou **Exécuter la ligne** | sont **reprises** de l'exécution précédente, quelle qu'elle soit (même un scénario) |
| bouton **Vider les variables** (en tête du journal) | sont vidées |
| fermeture de la fenêtre de l'outil | sont perdues (elles ne sont pas enregistrées) |

Conséquence pratique : après un scénario en échec au projet 04, on peut corriger le projet 04 puis le relancer
seul avec **▶▶ Tous les tests** ; il retrouve `${id}`, `${courseid}`, etc. du scénario. Pour repartir d'un état
propre, cliquer sur **Vider les variables** avant de lancer.

Une variable remplie avec la même valeur qu'avant écrase simplement l'ancienne. Le bouton **Variables** du journal
affiche le jeu courant.

Ne durent que le temps d'un test (remis à zéro au début de chaque test) :

- les fichiers créés par `createFile` : `createFile` et `uploadFile` doivent être dans le même test ;
- le cadre choisi par `selectFrame` (chaque test commence dans la page principale) ;
- les compteurs des boucles, et les réglages `setSpeed` / `setTimeout`.

### Exemple 01 — les bases

| # | Commande | Cible | Valeur | Ce qui se passe |
|---|---|---|---|---|
| 1 | open | / | | ouvre la page d'accueil du Moodle |
| 2 | store | Bonjour | salutation | met « Bonjour » dans la variable `salutation` |
| 3 | echo | ${salutation} tout le monde | | écrit « Bonjour tout le monde » dans le journal |
| 4 | storeTitle | | titre | met le titre de la page dans `titre` |
| 5 | echo | Le titre de la page est : ${titre} | | |
| 6 | storeLocation | | adresse | met l'adresse de la page dans `adresse` |
| 7 | echo | Nous sommes sur ${adresse} | | |
| 8 | store | 3 | nombre | |
| 9 | assert | nombre | 3 | arrête le test si `nombre` ne vaut pas 3 |

Exemple de journal (le titre et l'adresse dépendent de votre Moodle ; les lignes `nom = valeur` montrent chaque variable au moment où elle est remplie) :

```
salutation = Bonjour
Bonjour tout le monde
titre = Accueil | Mon Moodle
Le titre de la page est : Accueil | Mon Moodle
adresse = http://localhost/moodle/
Nous sommes sur http://localhost/moodle/
nombre = 3
✔ Réussi : « 01 - Variables : les bases » en 0.8 s
```

Attention à `assert` : la Cible est le **nom** de la variable (`nombre`), pas `${nombre}`.

Pour voir toutes les variables à un instant donné : bouton **Variables** du journal (pratique en pause).

Autres façons de remplir une variable depuis la page :

| Commande | Cible | Valeur | Résultat |
|---|---|---|---|
| storeText | css=.page-header-headings h1 | titreCours | le texte visible de l'élément |
| storeValue | id=id_shortname | court | le contenu d'un champ de formulaire |
| storeAttribute | linkText=Participants@href | lien | un attribut (ici l'adresse du lien) |
| storeElementCount | css=.activity | nbActivites | le nombre d'éléments trouvés |

## 3. Réutiliser des valeurs et décider : la connexion (exemple 02)

On met l'identifiant et le mot de passe en variables en haut du test : il n'y a qu'un endroit à modifier.
Le `if` évite d'échouer si l'on est déjà connecté.

| # | Commande | Cible | Valeur | Ce qui se passe |
|---|---|---|---|---|
| 1 | store | admin | identifiant | à remplacer par votre compte |
| 2 | store | MotDePasse!1 | motdepasse | à remplacer |
| 3 | open | /login/index.php | | |
| 4 | storeElementCount | id=username | champs | 1 si le formulaire de connexion est là, 0 sinon |
| 5 | if | ${champs} > 0 | | si le formulaire est là… |
| 6 | type | id=username | ${identifiant} | |
| 7 | type | id=password | ${motdepasse} | |
| 8 | click | id=loginbtn | | |
| 9 | else | | | …sinon… |
| 10 | echo | Déjà connecté : connexion ignorée | | |
| 11 | end | | | fin du si |
| 12 | waitForElementPresent | id=user-menu-toggle | | attend le menu utilisateur : on est connecté |

La cible d'un `if` est une condition écrite en JavaScript : `${champs} > 0`, `${nom} === 'admin'`,
`${a} > 2 && ${b} < 5`…

## 4. Des valeurs différentes à chaque exécution (exemple 03)

Un nom court de cours doit être unique : en le rejouant, le test échouerait la deuxième fois.
`storeUniqueId` fabrique un identifiant jamais identique, du type `cours-20260925-221530-k3f9`
(préfixe, date, heure, 4 caractères au hasard).

| # | Commande | Cible | Valeur | Ce qui se passe |
|---|---|---|---|---|
| 1 | storeUniqueId | cours | id | `id` vaut par exemple `cours-20260925-221530-k3f9` |
| 2 | open | /course/edit.php?category=1 | | formulaire de création de cours |
| 3 | type | id=id_fullname | Cours de test ${id} | nom complet : « Cours de test cours-2026… » |
| 4 | type | id=id_shortname | ${id} | nom abrégé unique |
| 5 | click | id=id_saveanddisplay | | « Enregistrer et afficher » |
| 6 | waitForTextPresent | Cours de test ${id} | | attend que le nom du cours s'affiche |
| 7 | storeLocation | | urlCours | garde l'adresse du cours créé |
| 8 | echo | Cours créé : ${urlCours} | | |

## 5. JavaScript (exemple 04)

`executeScript` exécute du code **dans la page**, avec accès à tout ce que la page connaît (`M.cfg`,
`document`, `jQuery`…). Trois règles :

1. Ce qui suit `return` est rangé dans la variable nommée dans la colonne **Valeur**.
2. Dans le code, `${a}` désigne la variable `a` elle-même. **Pas de guillemets autour** :
   écrire `${a} + 1`, pas `'${a}' + 1`.
3. `vars.x = …` crée ou modifie la variable `x` pour la suite du test.

| # | Commande | Cible | Valeur | Ce qui se passe |
|---|---|---|---|---|
| 1 | open | / | | |
| 2 | executeScript | return M.cfg.wwwroot; | racine | lit l'adresse du Moodle dans sa configuration |
| 3 | echo | Adresse du Moodle : ${racine} | | |
| 4 | executeScript | return document.querySelectorAll('a').length; | nbLiens | compte les liens |
| 5 | if | ${nbLiens} > 10 | | |
| 6 | echo | Page riche : ${nbLiens} liens | | |
| 7 | end | | | |
| 8 | store | 5 | a | |
| 9 | executeScript | *(voir ci-dessous)* | | crée `b` et `message` |
| 10 | echo | ${message} | | |
| 11 | assert | b | 10 | |

Code de la ligne 9, sur deux lignes dans la Cible :

```js
vars.b = Number(${a}) * 2;
vars.message = 'le double de ' + ${a} + ' est ' + vars.b;
```

Exemple de journal (le nombre de liens dépend de la page) :

```
racine = http://localhost/moodle
Adresse du Moodle : http://localhost/moodle
nbLiens = 57
Page riche : 57 liens
a = 5
b = 10
message = le double de 5 est 10
le double de 5 est 10
```

Pourquoi `Number(${a})` ? Une variable remplie par `store` contient du **texte** (« 5 »). En JavaScript,
`'5' + 1` donne `'51'` ; `Number('5') + 1` donne `6`.

Autres commandes JavaScript utiles :

| Commande | Cible | Valeur | Rôle |
|---|---|---|---|
| storeEval | ${a} * 3 | triple | comme executeScript, mais la Cible est une simple expression, sans `return` |
| runScript | document.querySelector('#id_name').focus() | | exécute sans rien stocker |
| waitForCondition | document.querySelectorAll('.activity').length > 2 | 10000 | attend que l'expression soit vraie, 10 s au plus |
| assertCondition | ${nbLiens} > 0 | | arrête le test si l'expression est fausse |

## 6. Boucles (exemple 05)

| # | Commande | Cible | Valeur | Ce qui se passe |
|---|---|---|---|---|
| 1 | open | / | | les conditions s'évaluent dans une page : il en faut une ouverte |
| 2 | storeJson | ["Alice", "Bob", "Chloé"] | prenoms | une liste de trois valeurs |
| 3 | forEach | prenoms | prenom | pour chaque valeur de `prenoms`, la met dans `prenom`… |
| 4 | echo | Bonjour ${prenom} | | |
| 5 | end | | | |
| 6 | times | 3 | | répète 3 fois… |
| 7 | storeUniqueId | u | id | |
| 8 | echo | Identifiant tiré : ${id} | | |
| 9 | end | | | |
| 10 | store | 0 | compteur | |
| 11 | while | ${compteur} < 3 | | tant que la condition est vraie… |
| 12 | executeScript | vars.compteur = Number(${compteur}) + 1; | | ajoute 1 |
| 13 | echo | Tour numéro ${compteur} | | |
| 14 | end | | | |

Journal obtenu :

```
Bonjour Alice
Bonjour Bob
Bonjour Chloé
Identifiant tiré : u-20260925-224148-wun3
Identifiant tiré : u-20260925-224148-3rmn
Identifiant tiré : u-20260925-224148-p045
Tour numéro 1
Tour numéro 2
Tour numéro 3
```

Chaque `if`, `forEach`, `times` et `while` se ferme par un `end`. Dans le tableau, les lignes à l'intérieur
d'un bloc sont décalées vers la droite : si le décalage est faux, il manque un `end`.

## 7. Fichier généré et envoyé (exemple 06)

Trois étapes :

1. **Fabriquer** les valeurs uniques : `storeUniqueId`.
2. **Créer le fichier** : `createFile`. Cible = le contenu du fichier, Valeur = son nom. Le fichier n'existe
   que pendant l'exécution du test, en mémoire ; rien n'est écrit sur le disque.
3. **L'envoyer** : `uploadFile`. Cible = le champ fichier, Valeur = le nom donné à l'étape 2.

L'exemple crée deux utilisateurs par l'outil « Déposer des utilisateurs » de Moodle :

| # | Commande | Cible | Valeur | Ce qui se passe |
|---|---|---|---|---|
| 1 | storeUniqueId | etu | id | ex. `etu-20260925-222633-1j50` |
| 2 | createFile | *(contenu ci-dessous)* | utilisateurs-${id}.csv | le fichier CSV, en mémoire |
| 3 | open | /admin/tool/uploaduser/index.php | | page « Déposer des utilisateurs » |
| 4 | click | css=.fp-btn-choose | | bouton « Choisir un fichier… » |
| 5 | click | xpath=//span[contains(@class,'fp-repo-name')][normalize-space()='Déposer un fichier'] | | onglet « Déposer un fichier » du sélecteur |
| 6 | uploadFile | name=repo_upload_file | utilisateurs-${id}.csv | met le fichier dans le champ |
| 7 | click | css=.fp-upload-btn | | bouton « Déposer ce fichier » |
| 8 | waitForTextPresent | utilisateurs-${id}.csv | | le fichier apparaît dans le formulaire |
| 9 | click | id=id_submitbutton | | vers l'aperçu |
| 10 | click | id=id_submitbutton | | lance la création |
| 11 | waitForTextPresent | Utilisateurs créés | | |
| 12 | assertTextPresent | ${id}-1 | | le premier utilisateur figure dans le résultat |

Contenu de la Cible de la ligne 2 (trois lignes, en appuyant sur Entrée entre chaque) :

```
username,firstname,lastname,email,password
${id}-1,Alice,Test,${id}-1@exemple.fr,Test-1234!
${id}-2,Bob,Test,${id}-2@exemple.fr,Test-1234!
```

À l'exécution, le fichier `utilisateurs-etu-20260925-222633-1j50.csv` contient :

```
username,firstname,lastname,email,password
etu-20260925-222633-1j50-1,Alice,Test,etu-20260925-222633-1j50-1@exemple.fr,Test-1234!
etu-20260925-222633-1j50-2,Bob,Test,etu-20260925-222633-1j50-2@exemple.fr,Test-1234!
```

Le journal affiche le début du fichier créé, pour contrôle.

Variantes :

- Contenu calculé par un script (par exemple 50 utilisateurs) :

  | Commande | Cible | Valeur |
  |---|---|---|
  | executeScript | *(code ci-dessous)* | csv |
  | createFile | ${csv} | utilisateurs-${id}.csv |

  ```js
  let s = 'username,firstname,lastname,email\n';
  for (let i = 1; i <= 50; i++) {
    s += ${id} + '-' + i + ',Prenom' + i + ',Test,' + ${id} + '-' + i + '@exemple.fr\n';
  }
  return s;
  ```

- Zone de glisser-déposer (gestionnaire de fichiers d'une ressource, d'un devoir…) : `uploadFile` avec,
  en Cible, la zone elle-même ; utiliser le bouton **Désigner** pour la trouver.
- Plusieurs fichiers d'un coup : un nom par ligne dans la Valeur de `uploadFile`.

Les textes de Moodle (« Utilisateurs créés », « Déposer un fichier ») dépendent de la langue et de la version :
si une étape échoue, désigner l'élément avec **Désigner** et reprendre le localisateur proposé.

## 8. Attendre (exemple 07)

Après chaque action, le moteur attend déjà tout seul la fin des chargements. On ajoute une attente explicite
quand l'information arrive plus tard, par exemple après une mise à jour qui se fait en différé :

| Commande | Cible | Valeur | Attend que… |
|---|---|---|---|
| waitForAjax | | | plus rien ne charge |
| waitForElementVisible | css=[data-region="drawer"] | | l'élément soit visible |
| waitForElementNotVisible | css=.spinner-border | | l'élément disparaisse |
| waitForText | css=[data-region="result"] | contains:terminé | le texte de l'élément contienne « terminé » |
| waitForTextPresent | Modifications enregistrées | | ce texte apparaisse n'importe où dans la page |
| waitForCondition | M.util.pending_js.length === 0 | 20000 | l'expression JavaScript soit vraie (20 s au plus) |
| pause | 2000 | | 2 secondes, sans condition (à éviter si une attente précise est possible) |

Le plus simple : pendant l'enregistrement, **clic droit sur l'élément > Replay > Attendre : texte de l'élément**.

## 9. Aide-mémoire : où mettre quoi

| Commande | Cible | Valeur |
|---|---|---|
| store | la valeur | le nom de la variable |
| storeText / storeValue | l'élément | le nom de la variable |
| storeUniqueId | un préfixe (facultatif) | le nom de la variable |
| storeJson | une liste ou un objet JSON | le nom de la variable |
| executeScript | le code (avec `return`) | le nom de la variable (facultatif) |
| echo | le message | |
| assert | le **nom** de la variable | la valeur attendue |
| if / while | la condition JavaScript | |
| forEach | le nom de la liste | le nom de la variable de boucle |
| times | le nombre de tours | |
| createFile | le contenu du fichier | le nom du fichier |
| uploadFile | le champ ou la zone de dépôt | le nom du fichier |

## 10. Erreurs fréquentes

| Symptôme dans le journal | Cause | Correction |
|---|---|---|
| le texte contient `${nom}` tel quel | la variable n'existe pas (faute de frappe, ou pas encore remplie) | vérifier le nom avec le bouton **Variables** |
| `${x} vaut « undefined »` | `store` écrit avec `${x}` dans la Valeur | écrire `x` tout seul dans la Valeur |
| `Erreur JavaScript` sur une ligne qui contient `${…}` | la variable n'existe pas encore : `` reste tel quel et casse le code | la créer plus haut, ou corriger son nom |
| `'5' + 1` donne `51` | les variables `store` sont du texte | utiliser `Number(${x})` |
| `Fichier « … » inconnu` | `uploadFile` avant `createFile`, ou nom différent | mêmes noms dans les deux lignes |
| `if non fermé (end manquant)` | un bloc sans `end` | ajouter la ligne `end` |

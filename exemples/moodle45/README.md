# Recette « testeric » pour Moodle 4.5

Tout ce que la recette crée porte le préfixe `testeric_` suivi du type d'action, de l'identifiant unique de
l'exécution `${id}` (ex. `20260926-143012-k3f9`) et d'un numéro : `testeric_createcours_${id}_1`,
`testeric_creategroupe_${id}_3`… Les utilisateurs s'appellent `testericihm${id}_1` (créés par l'interface) et
`testericcsv${id}_1` (créés par CSV), avec `testericfirstname…`, `testericlastname…` et
`testericmail…@testeric.fr`. La recette ne supprime rien et ne modifie que ce qu'elle a créé.

## Charger et lancer

1. Dans l'outil, mode **Scénarios** : **Ouvrir un fichier…** → `testeric-moodle45.scenario.json`.
   Les 7 projets et le scénario « testeric - recette Moodle 4.5 » s'ajoutent.
2. Déplier le scénario et remplacer `https://moodle.exemple.fr` par l'adresse de votre Moodle dans
   **l'URL de base du scénario**. C'est elle qui compte : elle remplace l'URL de chacun des 7 projets pendant le
   scénario, et modifier l'URL du projet 00 ne suffit pas.
3. Projet **testeric 00**, test « Paramètres de la recette » : adapter `identifiant`, `motdepasse`,
   `categorieParente` (par défaut `SAS / ERIC`) et, si besoin, les libellés des rôles `roleApprenant` et `roleTuteur`.
4. Se placer sur un onglet quelconque de Firefox (il sera piloté), puis **▶ Lancer** sur le scénario.

Les captures sont dans `Téléchargements/Replay/testeric - recette Moodle 4.5/<date-heure>/`.
Le scénario s'arrête au premier projet en échec (case cochée) ; les variables (`${id}`, identifiants des objets
créés) passent d'un projet au suivant. Après un échec, on peut corriger puis relancer **le projet concerné seul**
(▶▶ Tous les tests) : il reprend les variables de l'exécution précédente. Attention : lancé seul, un projet utilise
**sa propre** URL de base, pas celle du scénario ; mettre la même dans les projets qu'on relance seuls.
Le scénario, lui, repart toujours de zéro avec un nouvel `${id}`.

## Contenu

| Projet | Ce qu'il fait |
|---|---|
| 00 Initialisation et connexion | paramètres, identifiant unique, accueil, connexion si besoin |
| 01 Utilisateurs | 2 utilisateurs par le formulaire, 2 par dépôt CSV ; contrôle par service web |
| 02 Catégorie et cours | catégorie dans SAS / ERIC, cours dans cette catégorie |
| 03 Activités | une activité de chaque type actif par défaut (titre + description, et le minimum obligatoire : options du choix, contenu de page, URL, première page du wiki, fichier, paquets SCORM et IMS générés) |
| 04 Cohortes | 2 cohortes par le formulaire, les 2 utilisateurs « interface » ajoutés par l'écran d'affectation, 2 cohortes par CSV, puis les 2 utilisateurs « CSV » importés dans les 4 cohortes par dépôt d'utilisateurs ; contrôle du nombre de membres |
| 05 Groupes et inscriptions | 4 groupes ; 4 méthodes « Synchronisation des cohortes » (apprenant/tuteur, chacune dans un groupe) ; contrôle des inscrits et des effectifs des groupes |
| 06 Modifications et contrôles | désactiver/réactiver une synchronisation, masquer/réafficher une cohorte, suspendre/réactiver un utilisateur, modifier un profil, renommer un groupe, groupement, renommer/masquer une activité, modifier le cours et la catégorie, bilan |

Effectifs attendus : cohortes « interface » 4 membres, cohortes CSV 2 membres ; groupes 1 et 2 : 4 membres,
groupes 3 et 4 : 2 membres.

Les activités désactivées à l'installation de Moodle 4.5 (Chat, Consultation, Sous-section, BigBlueButton) sont
dans un test à part, lignes désactivées : les activer dans Moodle, puis réactiver les lignes (bouton « // Désactiver »).
H5P et Outil externe demandent un vrai fichier `.h5p` ou un outil configuré : non couverts.

## Prérequis sur le Moodle

- un compte administrateur ;
- la catégorie parente (`SAS / ERIC`) existe ;
- les méthodes d'inscription « Synchronisation des cohortes » et le dépôt « Déposer un fichier » sont activés
  (c'est le cas par défaut) ;
- la politique de mot de passe accepte `Testeric-2026!` (sinon changer `motdepasseTest`).

Les champs sont repérés par leurs identifiants Moodle (`id_name`, `id_fullname`…), qui ne dépendent pas du thème :
la recette doit fonctionner avec Boost comme avec Academi. Les identifiants des objets créés (catégorie, cours,
cohortes, groupes, utilisateurs) sont retrouvés dans l'adresse des pages ou par les services web internes de Moodle
(`core_user_get_users_by_field`, `core_cohort_search_cohorts`, `core_group_get_course_groups`,
`core_enrol_search_users`), appelés avec la session de l'administrateur.

## Essayer sur le Moodle de démonstration 4.5

`https://sandbox405.moodledemo.net` (en anglais, remis à zéro régulièrement ; identifiants affichés sur sa page
de connexion). Mettre cette adresse comme URL du scénario, et dans le projet 00 une catégorie parente qui existe,
`regexpi:^Miscellaneous$` (la démonstration n'a que « Miscellaneous »).

## Régénérer

Les fichiers sont produits par `node exemples/moodle45/generer.js`, qui vérifie aussi chaque projet (commandes
connues, blocs fermés, syntaxe des scripts, variables définies avant usage).

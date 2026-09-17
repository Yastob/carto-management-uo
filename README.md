# Cartographie management UO

Outil 100 % local pour visualiser qui encadre qui, et quelles réunions de management
(équipe, individuelles...) existent dans l'UO — sous forme de graphe interactif.

## 3 fichiers, 2 pages d'édition, 1 visualisation

| Fichier | Contenu | Comment le produire |
|---|---|---|
| `data/collaborateurs.xlsx` | Référentiel : id, nom, prénom, poste, **senior_manager_id** | Saisie manuelle directe dans Excel (seul fichier à remplir à la main) |
| `data/rattachements.xlsx` | Manager / CP / DP opérationnels, compte de référence, tags | [editeur-rattachements.html](editeur-rattachements.html) |
| `data/reunions.xlsx` | Réunions de management + participants | [editeur-points.html](editeur-points.html) |

Le rattachement hiérarchique **réel** (`senior_manager_id`) vit directement dans
`collaborateurs.xlsx` — c'est ce qui permet de filtrer les 2 pages d'édition sur le
périmètre d'un seul SM dès que ce fichier est chargé, sans dépendre des autres
fichiers. `rattachements.xlsx` ne gère plus que l'encadrement **opérationnel**
(Manager / Chef de projet / Directeur de projet), qui peut lui traverser les périmètres.

`rattachements.xlsx` et `reunions.xlsx` sont produits par 2 outils HTML **indépendants** :
tu peux régénérer l'un sans toucher à l'autre. Chaque éditeur peut recharger le
fichier qu'il produit pour continuer à l'enrichir (itératif — jamais annule et
remplace).

**Rien n'est perdu en changeant d'onglet** : les fichiers chargés (et les réunions/
rattachements en cours de saisie, dès qu'on clique sur Télécharger) restent
disponibles quand tu passes d'une page à l'autre, tant que l'onglet du navigateur
reste ouvert — pas besoin de réuploader. Cette mémoire vit uniquement dans cet onglet
de navigateur (`sessionStorage`), jamais envoyée nulle part, effacée à sa fermeture.

**[index.html](index.html)** charge les 3 fichiers et affiche la cartographie interactive.
Seul `collaborateurs.xlsx` est obligatoire (il donne déjà la hiérarchie SM à lui
seul) ; Rattachements et Réunions sont facultatifs, indépendamment l'un de l'autre.
Rien n'est envoyé sur un serveur : tout est lu et interprété dans le navigateur.

## Workflow

1. Remplis `data/collaborateurs.xlsx` (id, nom, prénom, poste, senior_manager_id)
   directement dans Excel.
2. Ouvre `editeur-rattachements.html`, charge `collaborateurs.xlsx`, renseigne pour
   chaque personne son Manager/CP opérationnel, son compte de référence et ses tags,
   puis télécharge `rattachements.xlsx` (à placer dans `data/`). Si l'UO compte
   plusieurs Senior Managers, un filtre (disponible dès le chargement de
   collaborateurs.xlsx) te permet de n'afficher que le périmètre de l'un d'eux.
3. Ouvre `editeur-points.html`, charge `collaborateurs.xlsx` (même filtre de
   périmètre disponible), crée les réunions (animateur, participants via cases à
   cocher, ordre du jour...), télécharge `reunions.xlsx` (à placer dans `data/`).
   Un encart rappelle en permanence les collaborateurs du périmètre affiché qui ne
   sont couverts par aucune réunion (individuelle ou d'équipe) active.
4. Ouvre `index.html`, charge les fichiers → cartographie interactive.

Pour mettre à jour plus tard : recharge le fichier existant dans l'éditeur concerné
(ex. `rattachements.xlsx` dans editeur-rattachements.html) avant de continuer à
l'enrichir, puis re-télécharge. `collaborateurs.xlsx` s'édite directement dans Excel
(ajoute une ligne pour un nouvel arrivant, ne réécris jamais tout depuis zéro).

**Détection des écarts** : dans l'éditeur de rattachements, dès qu'un périmètre de SM
est sélectionné, un encart signale automatiquement les écarts avec le fichier
rattachements.xlsx déjà chargé — un nouveau collaborateur rattaché à ce SM mais
jamais vu dans rattachements.xlsx, ou quelqu'un qui était rattaché à ce SM dans le
précédent collaborateurs.xlsx chargé et qui ne l'est plus (parti, ou réaffecté à un
autre SM). Les nouveaux collaborateurs apparaissent aussi en tête de la table.
(L'éditeur de réunions n'a pas besoin de rattachements.xlsx : il propose son propre
encart "Collaborateurs sans réunion", basé uniquement sur les réunions déjà créées.)

Dans le formulaire d'ajout d'une réunion, un `*` marque les champs obligatoires
(Animateur et Collaborateur pour une réunion individuelle) — le nom de la réunion et
l'ordre du jour sont facultatifs (le nom se pré-remplit automatiquement pour une
réunion individuelle, mais reste modifiable).

## Règles métier appliquées automatiquement (éditeur de rattachements)

- Un **Senior Manager** n'a aucun tag.
- Le tag **Haut potentiel** n'est proposé qu'aux **Consultants** (pas aux
  SM/Manager/Chef de projet/Directeur de projet).
- Un Manager/CP **hors de cette UO** (autre UO sectorielle) se choisit via
  "Manager Sectoriel" / "CP Sectoriel" plutôt qu'un id précis (même principe pour
  senior_manager_id dans collaborateurs.xlsx, via "SM Sectoriel").
- Un Chef de projet et un Directeur de projet sont traités identiquement dans la
  visualisation (même colonne `chef_de_projet_id`, même couleur) — seul le poste
  affiché les distingue.
- Un Manager ou un Chef de projet peut encadrer des collaborateurs rattachés à un
  **autre** Senior Manager que le sien — aucune contrainte de périmètre.

## Régénérer des gabarits vierges (avec exemples)

```bash
pip install openpyxl
python scripts/build_template.py
```

Écrase `data/collaborateurs.xlsx`, `data/rattachements.xlsx` et `data/reunions.xlsx`
avec des exemples — sauvegarde tes données avant si besoin.

## Structure des données

- **collaborateurs.xlsx** — lecture **flexible** : c'est le seul fichier saisi à la
  main, donc ni le nom de l'onglet ni le texte des en-têtes de colonnes ne comptent.
  Seul l'**ordre** des colonnes est vérifié : la 1ère ligne est toujours traitée comme
  un en-tête (son contenu est ignoré), et les 5 premières colonnes de données doivent
  être, dans cet ordre : `id, nom, prenom, poste, senior_manager_id` (poste ∈ Senior
  Manager / Manager / Chef de projet / Directeur de projet / Consultant). Les colonnes
  suivantes sont ignorées (ex. les colonnes d'aide `id_suggestion` / `doublon_id` du
  gabarit, utiles seulement dans Excel). Un onglet nommé "Lisez-moi" ou "Listes" est
  automatiquement sauté si présent (cas du gabarit généré ci-dessous) ; sinon, c'est le
  premier onglet du fichier qui est lu.
  - `senior_manager_id` : le vrai responsable hiérarchique (RH), quasi toujours
    renseigné sauf pour un Senior Manager lui-même.
  - Un fichier construit avec l'ancien gabarit (`id, id_suggestion, doublon_id, nom,
    prenom, poste, senior_manager_id`) doit être réordonné une fois : `python
    scripts/migrate_collab_column_order.py chemin/vers/collaborateurs.xlsx`.
- **rattachements.xlsx** → onglet Rattachements : `id, manager_id,
  chef_de_projet_id, compte_reference, tag_haut_potentiel, tag_en_fragilite,
  tag_consultant_isole, date_maj`.
  - `manager_id` / `chef_de_projet_id` : encadrement opérationnel, optionnel, peut
    pointer vers quelqu'un d'un autre périmètre SM.
- **reunions.xlsx** → onglet Réunions : `id, nom, animateur_id, participants_ids
  (ids séparés par une virgule), type, periodicite, ordre_du_jour, date_maj`.

Il n'y a pas de notion d'actif/inactif : un départ ou l'arrêt d'une réunion se gère en
supprimant la ligne correspondante plutôt qu'en la désactivant.

## Légende de la visualisation

- Couleur du nœud = rôle : violet Senior Manager, vert Manager, magenta Chef de
  projet/Directeur de projet, bleu Consultant.
- Anneau bleu clair toujours visible = tag "En fragilité". Pastille jaune en haut à
  droite du nœud, toujours visible = tag "Haut potentiel". ⚠ en gras toujours visible
  = aucune réunion commune avec un responsable (SM/Manager/CP) — l'objectif final de
  l'outil. Le tag "Consultant isolé" reste visible uniquement au survol (info-bulle).
- **Liens d'encadrement (case à cocher "Afficher les rattachements", décochée par
  défaut)** : trait plein = Senior Manager (réel), pointillé = Manager, pointillé
  fin = Chef de projet. Masqués par défaut pour ne pas surcharger le graphe — à
  activer pour visualiser la ligne hiérarchique.
- **Réunions (case à cocher "Afficher les réunions", cochée par défaut)** : 2
  sous-cases "Individuelles" / "Équipe" (cochées par défaut, visibles seulement quand
  la case principale est cochée) permettent de n'afficher qu'un seul type de réunion.
  - Réunion d'équipe → une seule forme organique lissée ("à main levée") entoure ses
    membres ; le nom de la réunion s'affiche au-dessus. Cette forme est recalculée à
    chaque frame à partir de la position réelle des membres — elle a un intérieur
    plein, donc glisser volontairement un collaborateur externe au milieu du groupe
    peut le faire apparaître visuellement dedans (sans conséquence sur les données).
  - Réunion individuelle → simple trait reliant l'animateur et le collaborateur (pas
    d'étiquette, pour éviter la répétition).
- **Colorer par périodicité** (case à cocher, décochée par défaut) : recolore les
  traits de réunion individuelle et les formes de réunion d'équipe selon leur
  périodicité, avec la palette Okabe-Ito (conçue pour rester distinguable en cas de
  daltonisme — sans paire rouge/vert) : bleu (Hebdomadaire), bleu ciel (2 fois par
  mois), vert bleuté (Mensuel), orange (Tous les 2 mois), vermillon (Ponctuel), gris
  (Autre ou valeur non reconnue). Une légende dédiée apparaît tant que la case est
  cochée. Les couleurs de rôle des personnes ne changent pas.
- **Filtres Compte / SM** (menus déroulants en haut) : une réunion partiellement hors
  filtre reste affichée, mais les personnes hors périmètre y apparaissent grisées
  (avec la mention "Hors du filtre actuel" au survol) plutôt que d'être masquées.
- Survoler un nœud affiche le détail (y compris qui il encadre) et met en évidence
  ses relations directes. Cliquer dessus épingle l'affichage et zoome sur son
  entourage ; cliquer dans le vide réinitialise la vue. La recherche retrouve aussi
  les réunions d'équipe par leur nom.

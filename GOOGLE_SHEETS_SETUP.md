# Activer l'import depuis Google Sheets

Le code de l'intégration est déjà en place (`google-sheets.js`, blocs « ou depuis Google
Sheets » sous chaque zone de dépôt de fichier dans `index.html`). Il reste **désactivé**
tant que les étapes ci-dessous n'ont pas été faites : les boutons « Se connecter avec
Google » sont grisés, avec une info-bulle l'expliquant.

Aucune donnée ne transite par un serveur : la connexion se fait entièrement dans le
navigateur (OAuth « implicit flow » via Google Identity Services), et la lecture des
feuilles passe par l'API Google Sheets appelée directement depuis le poste de
l'utilisateur, avec un jeton en lecture seule (`spreadsheets.readonly`).

## 1. Créer le projet Google Cloud (ou en réutiliser un existant de l'organisation)

Dans la [console Google Cloud](https://console.cloud.google.com/), au sein du compte
Google Workspace de l'organisation (pas un compte personnel) :

1. Créer un projet (ou en choisir un déjà autorisé par l'IT).
2. **APIs & Services → Library** : activer **Google Sheets API**.

## 2. Configurer l'écran de consentement OAuth

**APIs & Services → OAuth consent screen** :
- **User type : Internal** — restreint l'usage aux comptes de l'organisation mc2i,
  condition posée dès le départ (« mes feuilles doivent rester restreintes à
  l'organisation »). Cette option n'apparaît que si le compte Cloud est bien rattaché à un
  Google Workspace, pas à un compte Gmail personnel.
- Nom de l'application, email de support : au choix.
- Scope à ajouter : `.../auth/spreadsheets.readonly`.
- Avec le type *Internal*, il n'y a pas de validation Google à attendre (contrairement à
  *External*) : utilisable dès sa création.

## 3. Créer l'identifiant client OAuth

**APIs & Services → Credentials → Create Credentials → OAuth client ID** :
- Type d'application : **Web application**.
- **Authorized JavaScript origins** : ajouter précisément les URL où l'outil est servi,
  par exemple :
  - `https://yastob.github.io`
  - l'URL GitLab Pages mc2i une fois activée (voir la discussion en cours avec l'admin
    GitLab), ou toute autre URL interne de déploiement.
  - `http://localhost:10111` (ou le port utilisé) si des tests en local sont prévus.
- Pas de *redirect URI* à renseigner : le flux utilisé (Google Identity Services, jeton
  implicite) n'en a pas besoin.
- Valider : Google affiche un **Client ID** du type
  `xxxxxxxx-yyyyyyyy.apps.googleusercontent.com`. Ce n'est pas un secret (il apparaît
  dans le code source du site, comme d'habitude pour une appli 100 % client), mais il
  n'est utilisable que depuis les origines listées ci-dessus.

## 4. Renseigner le Client ID dans le code

Dans `google-sheets.js`, remplacer :

```js
const CLIENT_ID = "REMPLACE_PAR_TON_CLIENT_ID.apps.googleusercontent.com";
```

par le Client ID obtenu à l'étape 3. C'est la **seule** modification de code nécessaire :
dès que la valeur ne commence plus par `REMPLACE_PAR_`, les boutons « Se connecter avec
Google » s'activent automatiquement sur les 3 zones de dépôt (Collaborateurs,
Rattachements, Réunions) de la page Visualisation.

## Utilisation, une fois configuré

1. Cliquer sur **Se connecter avec Google** (une seule fois par session d'onglet — le
   jeton expire au bout d'environ 1h, une reconnexion suffit ensuite).
2. Coller le lien du Google Sheet (URL complète copiée depuis la barre d'adresse, ou
   simplement l'identifiant du classeur).
3. Cliquer sur **Charger** (Collaborateurs) ou **Ajouter** (Rattachements/Réunions, pour
   empiler plusieurs classeurs, un par Senior Manager, comme pour les fichiers locaux).

L'onglet de données est choisi automatiquement (même règle que pour un fichier `.xlsx`
local : le premier onglet visible qui n'est pas nommé « lisez-moi », « listes », etc.).
Si un classeur doit exposer ses données dans un onglet différent, il suffit de renommer
temporairement les autres onglets ou de les masquer dans Google Sheets — il n'y a pas de
sélecteur d'onglet dans l'interface pour l'instant.

## Limites actuelles (volontaires, pour rester simple)

- **Lecture seule.** Les éditeurs (`editeur-rattachements.html`, `editeur-points.html`)
  continuent à produire un `.xlsx` à télécharger ; ils n'écrivent pas dans Google Sheets.
- **Un seul onglet par classeur** est lu (le premier éligible), pas de fusion
  multi-onglets au sein d'un même classeur.
- **Pas de renouvellement automatique du jeton** : après ~1h, un nouveau clic sur
  « Se connecter avec Google » suffit, sans perte des fichiers déjà chargés.

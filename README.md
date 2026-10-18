# ⚓ Ancre

Garde des sites entiers (pages, sous-pages, images) en **version lecture** sur ton iPad ou ton téléphone, pour les lire **sans réseau** dans les transports.
Pubs, menus, bandeaux cookies et scripts sont retirés. Les images sont réduites sur l'appareil.

| Format | Place utilisée |
|---|---|
| Texte seul | ≈ 3 Mo pour 1000 pages |
| Texte + images légères (720 px) | ≈ 60 Ko par image |
| Texte + images nettes (1200 px) | ≈ 180 Ko par image |

Tu fixes aussi une place maximale par site (100 Mo, 300 Mo, 1 Go ou sans limite).

## Installation (une seule fois, ~10 min, gratuit)

### 1. Mettre l'appli sur GitHub Pages
1. Vide l'ancien contenu du repo (l'ancienne version avec `server.js`, `package.json`, `public/`… ne sert plus).
2. Mets **tous ces fichiers à la racine** du repo.
3. Repo → Settings → Pages → Branch `main`, dossier `/ (root)` → Save.
4. Ouvre l'adresse `https://leogb-tech.github.io/<nom-du-repo>/` dans Safari.

### 2. L'installer sur l'iPad
Safari → bouton Partager → **Sur l'écran d'accueil**, puis ouvre Ancre **depuis l'icône**.
(L'appli installée a son propre stockage : fais l'étape 3 depuis l'icône, pas dans Safari.)

### 3. Le relais Cloudflare
Un navigateur n'a pas le droit de lire le contenu d'un autre site : c'est ce qui donnait l'erreur 405.
Le relais est un mini-programme gratuit (Cloudflare Workers, sans carte bancaire, 100 000 requêtes par jour) qui récupère les pages pour Ancre. Il ne stocke rien et n'obéit qu'à ton code privé.

Dans l'appli : ⚙︎ → suis les 5 étapes.
1. **Copier le code du relais** (il contient déjà ta clé privée).
2. Crée un compte sur Cloudflare.
3. **Workers & Pages** → **Create** → **Hello World** → **Deploy**.
4. **Edit code** → efface tout → colle → **Deploy**.
5. Colle l'adresse du Worker (`…workers.dev`) dans Ancre → **Tester et enregistrer**.

Si l'interface Cloudflare a changé de nom, le principe reste : créer un Worker, remplacer tout son code par celui copié, le déployer.

## Utilisation
- **Ajouter un site** en Wi-Fi, choisis le format. Garde l'appli ouverte pendant le téléchargement ; si tu la quittes, il reprend tout seul où il en était.
- Sommaire dans l'ordre du site, recherche dans le texte, reprise de lecture, page précédente / suivante, thèmes clair / sépia / sombre, taille du texte.
- Un lien vers une page non téléchargée l'indique au lieu de casser.
- **Mettre à jour** retélécharge le site en gardant ta page de lecture.

## Limites
- Mode lecture : la mise en page d'origine n'est pas conservée.
- Les sites qui construisent leurs pages entièrement en JavaScript, qui demandent une connexion ou qui bloquent les robots peuvent ne rien donner (l'appli affiche alors la raison).

## Fichiers
`index.html` (l'appli), `readability.js` (extraction du texte, Mozilla, licence Apache 2.0 — voir `readability-LICENSE.md`), `relais.js` (modèle du relais, sans ta clé), `sw.js` + `manifest.webmanifest` + icônes (fonctionnement hors ligne).

# ⚓ Ancre 2

Garde des sites entiers en **version lecture ultra-légère** sur ton iPad / téléphone, pour les lire sans réseau (transports, avion…).
Texte seul : ≈ 2–5 Mo pour 1000 pages. Option « images légères » : ≈ 30–60 Mo.

Le serveur aspire le site, retire pubs, menus et scripts, garde le contenu, compresse, et envoie un paquet à l'appareil. Il ne conserve rien après.

## Mise en ligne gratuite (Render)

GitHub Pages ne peut pas faire tourner le serveur : il faut un hébergeur Node. Render est gratuit :

1. Pousse ce dossier dans ton repo GitHub.
2. Sur https://render.com → **New → Blueprint** → choisis le repo (le fichier `render.yaml` configure tout).
3. Renseigne `ACCESS_CODE` (un mot de passe à toi, pour que personne d'autre n'utilise ton serveur).
4. Ouvre l'adresse `https://ancre-xxxx.onrender.com` sur l'iPad → ⚙︎ → colle le code.
5. Safari → Partager → **Sur l'écran d'accueil**. L'appli s'ouvre ensuite même hors ligne.

La formule gratuite se met en veille : la première ouverture du jour prend ~30 s.

## Utilisation

- **Ajouter un site** en Wi-Fi → le téléchargement tourne sur le serveur (tu peux fermer l'appli) → il s'enregistre sur l'appareil à la réouverture.
- Sommaire, recherche dans le texte, reprise de lecture, page précédente/suivante, thèmes clair/sépia/sombre, taille du texte.
- Un lien vers une page non téléchargée l'indique clairement.

## En local (PC)

`npm install` puis `npm start` → http://localhost:47321

## Limites

Mode lecture : la mise en page d'origine n'est pas conservée. Les sites générés entièrement en JavaScript, derrière une connexion, ou protégés anti-robot peuvent ne rien renvoyer.

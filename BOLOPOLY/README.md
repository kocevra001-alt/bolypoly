# BOLOPOLY en ligne

Un joueur est l'**hôte** (le jeu tourne chez lui), l'autre est l'**invité**. Le serveur ne fait que relayer les messages et servir le jeu.

## Pourquoi je n'ai pas de code ?
Le code de la partie est créé par le serveur de ce dossier (`server.js`). Si tu ouvres le jeu autrement (double-clic sur index.html, Live Server de VS Code, simple hébergement de fichiers), il n'y a personne pour créer le code.

## Essayer chez toi
Sous Windows : double-clique sur `start.bat` (il installe, lance le serveur et ouvre le jeu). Sinon :
1. Installe Node.js (version 18 ou plus), puis dans ce dossier : `npm install` puis `npm start`.
2. Ouvre http://localhost:8787. Ton ami, sur le même Wi-Fi, ouvre `http://ADRESSE-IP-DE-TON-PC:8787`.

## Mettre en ligne (gratuit, sur Render)
1. Mets ce dossier sur GitHub.
2. Sur render.com : New > Web Service > ton dépôt. Build Command : `npm install`. Start Command : `npm start`.
3. Render te donne une adresse en `https://...onrender.com`. Vous deux ouvrez cette adresse.
   (Le plan gratuit s'endort sans visite : le premier chargement peut prendre une minute.)

## Jouer
- Accueil : « Créer une partie » ou « Rejoindre une partie ».
- Hôte : Créer une partie, puis « En ligne avec un ami » : le code à 4 lettres s'affiche en grand (avec un lien à copier). Tu choisis ton joueur, les bots restent possibles.
- Invité : « Rejoindre une partie » (ou ouvre le lien), entre le code, ton nom, ton personnage, puis « Rejoindre ».
- Hôte : « Lancer la partie » dès que l'invité est connecté.
- Chrono : 30 secondes par coup (valeur `MOVE_SECONDS` en haut de `public/online.js`).

## Garder le serveur éveillé sur Render (gratuit)
Render endort un service gratuit après 15 minutes sans visite ; le réveil prend environ une minute. Pour l'éviter :
1. Crée un compte gratuit sur uptimerobot.com (ou un équivalent comme cron-job.org).
2. Ajoute un moniteur HTTP(s) sur `https://TON-ADRESSE.onrender.com/health`, toutes les 5 minutes.
Attention : Render offre 750 heures gratuites par mois pour tout le compte. Un seul service allumé 24 h sur 24 en consomme 744 sur un mois de 31 jours : il ne doit donc y avoir que celui-là. Render peut aussi redémarrer un service gratuit à tout moment, ce qui coupe les parties en cours.

## v0.7 — dés 3D
Dés en 3D avec vraie physique (Three.js + cannon-es, dans `public/vendor/`, aucun accès internet requis).
Les dés sont lancés directement sur la table du plateau (centre). Un seul clic sur « Lancer les dés » : les dés partent aussitôt, avec une force et une direction aléatoires.
Le résultat est lu sur la face supérieure des dés une fois immobiles. En ligne, le jet se joue sur l'écran de l'hôte et le résultat est synchronisé. Les bots et les appareils sans WebGL gardent l'animation simple.

Les dés des bots et de l'adversaire sont lancés avec la même animation 3D. En ligne, l'hôte envoie les positions des dés à l'invité, qui les voit rouler en direct avec les mêmes sons.
Son : voir `public/sounds/LISEZMOI.txt` pour mettre tes propres fichiers.

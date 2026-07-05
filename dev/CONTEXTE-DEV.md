# CONTEXTE-DEV — reprendre le développement de Maximus

Document de passation pour repartir d'un contexte propre. Dernier commit : `2a36fd6`.

## Contenu du dossier

| Fichier | Rôle |
|---|---|
| `Maximus.exe` | Lanceur Windows autonome (code obfusqué + musique embarqués) |
| `maximus.html` | Version web complète, un seul fichier (~1,7 Mo) |
| `tests.js` | Suite de régression : `node tests.js [chemin.html]` |
| `README.md` / `LISEZMOI.txt` | Doc joueur + doc dépôt |
| `maximus.ico` | Icône de l'exe |
| `prototype_v1.html` | Tout premier prototype (historique) |
| `Jouer a Maximus.bat` | Raccourci de lancement |
| `dev/wrapper.c`, `dev/icon.rc` | Sources du lanceur Windows |
| `.git` | Dépôt — remote `https://github.com/JamesRr06/Maximus.git` |

## Architecture de maximus.html

Deux blocs `<script>` :
1. `window.__MUS = "data:audio/mpeg;base64,..."` — musique de menu (~1,6 Mo).
2. Le code du jeu **en clair** (~140 Ko) — c'est la source de développement.

**Récupérer la source de dev** : extraire le bloc `<script>` qui contient `class Fighter`.
En Python : `blocks = re.findall(r'<script>([\s\S]*?)</script>', html)` puis
`code = [b for b in blocks if 'class Fighter' in b][0]`.

## Pipeline de build (dans la sandbox Linux)

1. Éditer la source de dev (fichier de travail dans `/tmp`, patches Python avec
   assertion `count==1` sur chaque remplacement).
2. `node --check` puis `node tests.js <fichier>` — tout doit être vert.
3. Obfusquer (exe uniquement) :
   `npm install javascript-obfuscator` puis
   `node_modules/.bin/javascript-obfuscator in.js --output out.js --compact true --self-defending true --string-array true --string-array-threshold 0.8 --string-array-encoding base64 --control-flow-flattening false --rename-globals true`
4. Assembler :
   - **web** = head + script musique + code clair → `maximus.html`
   - **exe** = head + script musique + code obfusqué + beacon
     `;window.addEventListener('pagehide',function(){try{navigator.sendBeacon('/bye','')}catch(e){}});`
5. Générer `game_html.h` (tableau d'octets `GAME[]` + `GAME_LEN`) depuis le HTML exe.
6. Compiler : `pip install ziglang --break-system-packages` puis
   `python3 -m ziglang cc -target x86_64-windows-gnu -O1 wrapper.c icon.rc -o Maximus.exe -lws2_32 -lshell32 -Wl,--subsystem,windows`
7. Vérifier : compiler aussi en cible Linux, `curl http://127.0.0.1:17323/`
   (200 + taille exacte du payload), `POST /bye` arrête le serveur après ~3 s.
8. Déployer vers le dossier, **vérifier chaque copie avec `cmp`**.

## Pièges connus (importants)

- **Synchro du montage** : les fichiers écrits côté hôte peuvent apparaître tronqués
  ou en retard dans la sandbox. Toujours travailler dans `/tmp`, déployer
  sandbox → dossier, contrôler par `cmp`. Relire un fichier du dossier avant de
  s'en servir comme référence.
- **`/tmp` est volatil** : vidé entre sessions. Tout se reconstruit depuis
  `maximus.html` (code clair) + `dev/wrapper.c` + ce document. La musique se
  ré-extrait du bloc `__MUS` de `maximus.html`.
- **git sur le montage** : `git init/commit` échoue dans le dossier. Construire le
  dépôt dans `/tmp/repo` (env `HOME=/tmp GIT_CONFIG_NOSYSTEM=1`), puis recopier
  le répertoire `.git` dans le dossier. Cloner depuis le `.git` existant pour
  garder l'historique.
- **Exe verrouillé** si le jeu est ouvert : déployer en `Maximus_new.exe`
  (déjà dans `.gitignore`), remplacer et nettoyer au coup suivant.
- **L'utilisateur pousse lui-même** : préparer les commits, terminer par la
  commande `git push` à lui donner. Ne jamais pousser à sa place.

## État du jeu (résumé)

Roguelike de gladiature, 40 combats, 3 classes (Murmillo bouclier, Secutor lourd
deux mains, Dimachaerus double), 19 armes en 3 arbres à DPS équilibrés avec effets
d'état, lancer d'armes (lance/couteau/hache) et ramassage universel, contre sur
parade/roulade parfaite, ulti par classe rechargée à chaque boss, perks par classe,
or + boutique, durabilité casque/cuirasse (réparation, l'IA aussi), arènes
évolutives à pièges (piques, flaques, lions, tomates/pierres du public niv. 31-40,
zones latérales seulement), duels 1c2 aléatoires dès le niv. 30 (dégâts −25 %),
victoire parfaite = +25 % d'or, boss avec capacités spéciales, IA adaptative
(agressive/défensive selon les PV, lance et ramasse). Manette Xbox : combat complet,
menus navigables aux boutons (croix/stick, A valide, B revient). Modes locaux :
Duel 1v1 et Duo coop contre l'IA (manette = Joueur 2). Rendu haute résolution
(logique 960×540, canvas mis à l'échelle), musique de menu à 20 % du volume.

## Divers

- RNG déterministe : `mulberry32(run.seed + lvl*7919)` (ennemis),
  `seed + lvl*104729` (duos).
- Sauvegarde : `localStorage`, migration des vieilles runs via `migrateRun`.
- La fenêtre exe fait 1420×850 (`--window-size` dans wrapper.c).

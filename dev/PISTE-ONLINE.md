# PISTE-ONLINE — mode multijoueur en ligne pour Maximus

Document de conception. Point de départ validé ; sert de référence pour
implémenter l'online par étapes. À lire avec `CONTEXTE-DEV.md`.

## Décision d'architecture : host-autoritaire

Le jeu **n'est pas déterministe** (~74 appels `Math.random` dans la simulation :
IA, drops, pièges…). On **écarte** donc le lockstep / rollback (GGPO) classique
des jeux de combat, qui exigerait de tout passer par un RNG seedé (`mulberry32`) —
chantier lourd et risqué.

On retient le modèle **client-serveur léger, host-autoritaire** :

- un des deux joueurs est l'**hôte** : il fait tourner **toute** la simulation
  (physique, IA, RNG, drops, pièges, score) ;
- l'autre est un **client léger** : il n'envoie que ses **entrées** (`intent`) et
  reçoit des **snapshots** d'état à ~30–60 Hz pour afficher.

Une seule machine décide → le non-déterminisme n'est plus un problème.

## Atouts déjà présents dans le code

- Deux `Fighter` distincts : `player` / `player2`.
- Système de modes : `game.mode` (`solo`, `versus`, `coop`).
- Écrans réutilisables : `mode`, `coopJoin`, `couleur`, `perso`, `vsSetup`.
- Entrées J2 déjà séparées (manette) de J1 (clavier) — mais **lues en dur** dans
  la boucle (`held('right')`, `padAxisX(p)`, etc.). C'est le point à refactorer.

## Transport : WebSocket + code de salon

Petit **relais WebSocket** en Node (~100–150 lignes) avec **codes de salon**
(ex. `MAX-7F3K`). Simple à héberger, traverse le NAT sans config joueur, pas
d'IP exposée. On réutilise la notion de room de l'écran `coopJoin`.

- Alternative P2P plus rapide mais plus complexe : **WebRTC DataChannel**
  (signaling + STUN/TURN). À garder pour plus tard si la latence du relais gêne.
- Choix retenu côté UX : **code de salon** (et non connexion directe par IP).
- **Ne pas** greffer le WebSocket dans `wrapper.c` (l'exe sert déjà du HTTP
  local) : un serveur Node séparé est bien plus simple.

## Flux de lancement d'une session

Nouvelle entrée **« EN LIGNE »** dans `MODE DE JEU`, menant à un écran
`onlineMenu` → **Héberger** ou **Rejoindre**.

**Hôte**
1. *Héberger* → connexion au relais, création d'une room, réception d'un
   **code de salon** affiché à l'écran.
2. Choix du mode (coop ou 1v1), classe, perso (écrans `couleur`/`perso`).
3. Attente : « En attente de l'adversaire… code : MAX-7F3K ».

**Client**
1. *Rejoindre* → écran type `coopJoin`, mais **saisie du code** (au lieu
   d'attendre une manette).
2. Connexion au relais, association à la room, choix classe + perso.

**Poignée de main (moment clé)**
- Les deux « prêts » → l'hôte envoie un paquet d'**init** : `mode`, `run.seed`,
  look des deux joueurs, config d'arène, **numéro de version de build**.
- Signal `START` de l'hôte → les deux écrans basculent sur `fight` **au même
  instant**.
- Ensuite : le client envoie son `intent`/frame ; l'hôte broadcast les snapshots.

**Résumé**
`title → mode → EN LIGNE → Héberger/Rejoindre → (code de salon) →
couleur/perso → attente “prêt” → START synchro → fight`

## Format de match (mode en ligne 1v1)

Le duel en ligne se joue en **manches** :

- **Best-of-5 : premier à 3 manches gagnantes**, 5 matchs maximum.
- Entre deux manches : court écran de transition (score courant, ex. « 2 – 1 »),
  puis nouvelle manche (PV/positions/arène réinitialisés par l'hôte).
- À **3 manches gagnées**, la partie est terminée : **+1 point crédité au
  vainqueur** (score de session/carrière — champ à ajouter, ex. `onlineScore`).
- Écran de fin : **Rejouer** (nouvelle série dans la même room, sans ressaisir le
  code) ou **Quitter** (retour au menu, fermeture propre de la connexion).

Notes d'implémentation :
- Le **décompte des manches et la fin de partie sont décidés par l'hôte**
  (autorité), puis diffusés au client, comme le reste de l'état.
- « Rejouer » doit être un accord des **deux** joueurs (ready-check), sinon on
  retombe sur l'attente / le retour menu si l'un quitte.
- Réutiliser l'esprit des écrans `vsEnd` existants pour la transition/fin.

## Points de conception tranchés

- **Rôle d'hôte** : l'hébergeur est toujours l'autorité (léger avantage latence
  pour lui, négligeable en coop).
- **Code de salon** plutôt qu'IP directe.
- **Version de build** dans le paquet d'init : si les deux `maximus.html`
  diffèrent, **refuser l'appairage** plutôt que désync silencieusement.

## Plan par étapes (du plus utile au plus dur)

1. **Couche d'intention (refactor local, sans réseau). ✅ FAIT.** Chaque `Fighter`
   expose `this.intent = {move, crouch, block, jump, attack, attackAlt, dodge,
   roll, throw, ulti, aimDir}` et `this.inputSrc` (`'local'` | `'remote'`).
   `fillHumanIntent(f)` remplit l'état continu depuis clavier/souris/manette ;
   `consumeIntent(f)` applique l'intention (déclenche les actions ponctuelles,
   maintient la garde) et remet les flags ponctuels à `false`. Clavier, souris et
   manette écrivent désormais dans `intent` au lieu d'appeler les méthodes en
   direct. Quand `inputSrc==='remote'`, la source locale n'écrase plus l'intent →
   **c'est là que le réseau injectera les entrées du joueur distant**. L'IA garde
   son chemin direct (non réseau). 6 tests de régression ajoutés dans `tests.js`
   (pilotage 100 % par intent) ; suite complète verte (130/130), zéro régression.
2. **Transport + salon. ✅ FAIT.** Relais WebSocket autonome dans `dev/net/`
   (`relay.js` + `package.json` + `test-relay.js`, dépendance `ws`) : rooms par
   code `MAX-XXXX`, `host`/`join`, relai des messages, `peer-left` à la
   déconnexion, ping de vie. Côté jeu : objet `Net` (connexion, `host()`,
   `join(code)`, `send`, `onData/onReady/onPeerLeft`, `_mk` injectable pour les
   tests) + carte **EN LIGNE** dans MODE DE JEU + écrans `onlineMenu`,
   `onlineHost` (affiche le code, attend l'adversaire), `onlineJoin` (saisie du
   code). URL du relais dans `DEFAULT_RELAY` (`ws://localhost:8080`), surchargée
   par `saveData.relayUrl`. Tests : `test-relay.js` (8/8) + 12 tests dans
   `tests.js` (machine à états + rendu des écrans). Suite complète 142/142.
   **Reste à faire (déploiement)** : héberger le relais sur une adresse publique
   en `wss://` pour jouer hors LAN ; en local/LAN, `ws://<IP>:8080` suffit.
3. **Boucle réseau host-autoritaire. ✅ FAIT (première version).** Handshake :
   l'invité envoie `hello` (build + config), l'hôte répond `start` (seed, looks,
   classes) et les deux appellent `startOnline(cfg)` → combat 1v1 synchronisé
   (hôte = p1 gauche, invité = p2 droite). Chaque frame : l'invité envoie
   `{t:'in', i:intent}` ; l'hôte applique cet intent à `player2`, simule tout, et
   diffuse `{t:'snap', …}` à ~30 Hz. `makeSnap`/`applySnap` sérialisent les deux
   combattants (position, PV, état, attaque, garde, statuts, arme, bouclier…) +
   lances en vol + score de manche. **Format best-of-5** : décompte côté hôte,
   premier à 3 manches → `onlineEnd`, **+1 point** au vainqueur (`saveData.
   onlineScore`), **Revanche** (accord des deux) ou **Quitter**. Entrées locales
   routées vers le bon combattant via `localFighter()`. Garde de version `BUILD`.
   13 tests headless (handshake, application d'intent, aller-retour snapshot,
   best-of-5, mapping local) ; suite complète **155/155**.
   **Limites v1 (à traiter en étape 4)** : pas encore d'interpolation ni de
   prédiction → jouable en bonne connexion/LAN mais saccadé si la latence monte ;
   clavier/souris uniquement en ligne ; pièges d'arène désactivés ; classe par
   défaut (pas encore d'écran de choix en ligne).
4. **Masquer la latence. ✅ FAIT (côté client).** *Interpolation* : les snapshots
   sont horodatés dans `game.snapHist` et l'adversaire (combattant p1) est rendu
   ~100 ms dans le passé (`INTERP_MS`), position lissée entre les deux snapshots
   qui encadrent l'instant de rendu → fin du saccadement 30 Hz. *Prédiction* : le
   client simule immédiatement son propre combattant (`me.update`) sur ses entrées
   locales, sans attendre l'aller-retour réseau. *Réconciliation* (`reconcileSelf`)
   : les PV, l'endurance, le bouclier et les statuts restent **autoritaires**
   (snapshot) ; la position dérive est corrigée en douceur (20 %/frame, téléport
   si écart > 60 px) ; si l'hôte signale un coup encaissé / étourdissement / mort,
   le client **adopte** l'état et la position autoritaires (interruption). 6 tests
   headless (interpolation, prédiction, PV autoritaires, correction douce,
   interruption) ; suite complète **161/161**.
   Reste possible plus tard : rollback complet (nécessiterait de rendre la sim
   déterministe), pièges d'arène synchronisés, manette en ligne.

## Raffinements livrés

- **Choix de classe en ligne ✅.** Sélecteur des 3 classes (Murmillo / Secutor /
  Dimachaerus) sur l'écran `onlineMenu`, mémorisé dans `saveData.onlineClass` et
  transmis dans le handshake (`hello` → l'hôte assemble `cfg.p1`/`cfg.p2` avec la
  classe de chacun). Chaque joueur combat donc avec sa propre classe. 4 tests
  (rendu, transmission p1/p2, création des combattants) ; suite **165/165**.
- **Pièges d'arène en ligne ✅.** L'hôte simule les pièges (`updateTraps`) ; leur
  état de rendu (`type, x, t, phase, side, stone`) est ajouté au snapshot (`tr`)
  et reconstruit côté client. Les dégâts restent autoritaires (hôte).
- **Manette en ligne ✅.** En ligne, la manette 0 pilote le combattant local
  (`localFighter`) : actions ponctuelles via `updatePads`, état continu (déplacement,
  accroupi, garde) via `fillHumanIntent`. Clavier/souris et manette cohabitent.
- **Entracte de manche ✅.** Entre deux manches, un court entracte (`game.interRound`,
  ~1,8 s) fige les combattants et affiche le score (`drawInterRound`), diffusé au
  client via le snapshot (`ir`) ; le rematch attend l'accord des deux joueurs.
  6 tests (entracte, aller-retour pièges/entracte, reprise de manche) ; suite **171/171**.
5. **Robustesse.** Déconnexions, pause synchronisée, reprise, garde de version.

**Ampleur réaliste** : étapes 1–3 = online coop jouable en bonne connexion (déjà
un vrai projet). Étapes 4–5 = ce qui fait passer du prototype à un mode agréable.

## Pièges anticipés

- Garder la **simulation entière côté hôte** ; le client ne calcule jamais
  d'autorité, il prédit seulement son avatar pour le confort.
- **Sérialisation des snapshots** : ne transmettre que l'état nécessaire au
  rendu (positions, PV, états, projectiles, durabilité), pas les objets JS bruts.
- **Fréquences séparées** : simulation à taux fixe côté hôte, envoi réseau
  découplé (~20–30 Hz) + interpolation, sinon la bande passante explose.
- Respecter les règles de build de `CONTEXTE-DEV.md` (travail dans `/tmp`,
  patches `count==1`, `node tests.js`, déploiement + `cmp`, git côté utilisateur).

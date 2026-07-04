# MAXIMUS — roguelike de gladiature

Jeu de combat 1 contre 1 (et 2 contre 1 !) dans la Rome antique : 40 combats,
une seule vie, trois classes de gladiateurs, armes lançables, pièges d'arène,
boss à compétences spéciales, or, perks, ulti et tableau des légendes.

## Jouer

- **`Maximus.exe`** (Windows 10/11) : double-clic. Fenêtre dédiée, code obfusqué,
  musique et icône incluses. Aucun fichier écrit sur le disque (le jeu est servi
  depuis la mémoire sur `127.0.0.1`).
- **`maximus.html`** : la même version en un seul fichier web — fonctionne sur
  Chrome, Edge et Firefox (Windows/Mac/Linux). À partager librement.

Au premier lancement de l'exe, Windows SmartScreen peut demander confirmation
(exécutable non signé) : « Informations complémentaires » → « Exécuter quand même ».

## Commandes (remappables dans Options)

| Action | Touche |
|---|---|
| Attaquer (corps / tête en saut / jambes accroupi) | Clic gauche |
| Défense de classe (bouclier, garde, main gauche) | Clic droit |
| Se déplacer | ← → ou Q/D |
| Sauter (coûte de l'endurance) | Espace |
| Esquive (pas rapide) / Roulade (invincible) | E / R (1 s de récupération commune) |
| Lancer l'arme (lance, couteau, hache) | F |
| Ulti de classe (rechargée à chaque boss) | X |
| S'accroupir / Pause | A / Échap |

## Systèmes de jeu

- **3 classes** : Murmillo (arme + bouclier, riposte), Secutor lourd (deux mains),
  Dimachaerus (deux lames, coup de main gauche) — poids, saut et esquive distincts.
- **19 armes** en arbres par classe, DPS équilibrés par palier de déblocage,
  chaque arme portant un effet d'état : saignement, perce-armure, enchevêtrement,
  fente d'armure, étourdissement, brise-garde.
- **Progression** : un perk par victoire (adapté à la classe), or et boutique de
  matériel (visible sur le gladiateur, du torse nu à l'armure dorée), plafond niv 8.
- **Combat** : dégâts localisés, blessures (saignement, étourdi, aveuglé, ralenti),
  contre sur parade ou roulade parfaite, boucliers qui s'usent, tombent et se ramassent.
- **Arènes évolutives** avec pièges télégraphés : piques (saignement), flaques
  larges (ralentissement), lions (assommement), et le public qui jette tomates et
  pierres près des bords (niveaux 31-40, le centre reste une zone franche).
- **Boss** (10/20/30/40) : Cri de guerre, Charge, Fureur — et une **ulti** de classe
  rechargée à chaque boss vaincu.
- **Victoire parfaite** (aucun PV perdu) : le combat suivant oppose **deux** adversaires
  (dégâts réduits de 33 %), puis la mécanique se réinitialise.
- **IA adaptative** : lance ses armes, esquive les coups bas, fond sur toi en roulade,
  devient agressive quand tu es à 20 % de PV et défensive quand elle l'est.

## Développement

Le jeu tient dans `maximus.html` : JavaScript pur + Canvas 2D + Web Audio, zéro
dépendance. `tests.js` contient 82 tests de régression exécutables hors navigateur :

```bash
node tests.js            # teste maximus.html du dossier
node tests.js autre.html # teste un autre build
```

L'exécutable Windows est un wrapper C (~200 lignes, `wrapper.c` d'origine) compilé
avec `zig cc` : il embarque le HTML obfusqué et le sert depuis la mémoire à un
navigateur en mode application.

## Feuille de route

Multijoueur envisagé (2-4 joueurs contre IA, puis 1v1 à 4v4) : la simulation est
déjà déterministe (RNG seedé) et le moteur gère plusieurs combattants.

# DÉPLOIEMENT-ONLINE — mettre le multijoueur de Maximus en ligne (par internet)

Le mode en ligne est **déjà codé** dans le jeu (voir `PISTE-ONLINE.md`). Il ne
manque qu'une chose pour jouer chacun chez soi : faire tourner le **relais**
(`dev/net/relay.js`) sur une **adresse publique en `wss://`**. Ce guide déploie
ce relais gratuitement sur **Render**.

Le relais se contente de mettre deux joueurs en relation via un code de salon
(`MAX-XXXX`) et de router leurs messages. Le code de salon traverse le NAT tout
seul : aucun port à ouvrir sur ta box ni celle de ton adversaire, aucune IP à
partager.

---

## Étape 1 — Pousser le dépôt sur GitHub

Render déploie depuis GitHub. Depuis le dossier du jeu, dans PowerShell :

```powershell
git add dev/net/relay.js render.yaml dev/DEPLOIEMENT-ONLINE.md
git commit -m "Relais online prêt pour Render (health-check + blueprint)"
git push
```

(Le dépôt distant est déjà `https://github.com/JamesRr06/Maximus.git`.)

## Étape 2 — Créer le service sur Render

1. Aller sur https://render.com et se connecter **avec GitHub** (bouton
   « Sign in with GitHub »). C'est gratuit, **aucune carte bancaire** demandée
   pour l'offre free.
2. Autoriser Render à voir le dépôt **Maximus** (ou tous les dépôts).
3. En haut à droite : **New +** → **Blueprint**.
4. Choisir le dépôt **Maximus**. Render lit automatiquement le fichier
   `render.yaml` à la racine et propose de créer le service **maximus-relay**.
5. Cliquer **Apply** / **Create**. Render installe `ws` et lance
   `node relay.js`. Attendre le statut **Live** (~1 à 2 min).

> Variante manuelle (si le Blueprint ne s'affiche pas) : **New +** →
> **Web Service** → dépôt Maximus, puis régler à la main :
> **Root Directory** = `dev/net`, **Build Command** = `npm install`,
> **Start Command** = `node relay.js`, **Instance Type** = **Free**.

## Étape 3 — Récupérer l'URL et me la donner

Sur la page du service, en haut, Render affiche une URL du type :

```
https://maximus-relay.onrender.com
```

- **Vérifier** que ça marche : ouvrir cette URL dans un navigateur → doit
  afficher `MAXIMUS relay OK`.
- Pour le jeu, il suffit de **remplacer `https://` par `wss://`** :

```
wss://maximus-relay.onrender.com
```

**Donne-moi cette URL `wss://…`** : je l'intègre dans le jeu (à la place de
`localhost`) et je reconstruis `maximus.html` + `Maximus.exe`. Ensuite, plus
aucune config : « EN LIGNE » → *Héberger* / *Rejoindre* fonctionne direct pour
toi **et** ton adversaire.

---

## Bon à savoir — la mise en veille (offre gratuite)

Sur le plan **Free**, Render **endort** le service après ~15 min sans trafic.
Conséquence : à la **toute première** connexion, le service se réveille et met
**~50 secondes** à répondre. Une fois réveillé, tout est fluide.

Astuce : avant de lancer une partie, ouvre une fois l'URL
`https://maximus-relay.onrender.com` dans ton navigateur. Quand la page affiche
`MAXIMUS relay OK`, le relais est réveillé et la connexion dans le jeu est
immédiate.

Si un jour tu veux zéro attente en permanence, il faut passer à une offre
payante (Render Starter, ou Railway/Fly.io qui restent allumés) — mais pour
jouer de temps en temps, le gratuit suffit largement.

---

## Rappel : ce que fait (et ne fait pas) le relais

- **Fait** : associer deux joueurs par code de salon, relayer leurs messages.
- **Ne fait pas** : aucune logique de jeu (toute la simulation reste chez
  l'hôte, cf. `PISTE-ONLINE.md`). Le relais ne stocke rien, ne voit rien du
  contenu des parties.
- Coût réseau minime : quelques Ko/s par partie. L'offre gratuite tient sans
  souci pour des parties entre amis.

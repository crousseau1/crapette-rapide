# Crapette Rapide

Jeu de cartes français pour 2 joueurs — version solo contre l'ordinateur.

## Lancer le jeu

Ouvrez `index.html` dans votre navigateur, ou servez le dossier avec un serveur local :

```bash
npx serve .
```

Puis ouvrez l'URL affichée (généralement http://localhost:3000).

## Règles (résumé)

- 52 cartes partagées en deux paquets de 26.
- Chaque joueur pose **5 colonnes** (15 cartes) devant lui ; le reste forme la **pioche**.
- Au signal, chaque joueur retourne sa première carte de pioche → **2 piles centrales**.
- Posez vos cartes visibles sur une pile centrale si la valeur est **+1 ou −1** (As ↔ Roi autorisé).
- Vous pouvez poser sur la pile de l'adversaire !
- Le premier à vider ses colonnes crie **« Crapette ! »** et prend la pile centrale la plus petite.
- La partie se joue en manches jusqu'à la victoire finale.

## Contrôles

- **Glisser-déposer** une carte de vos colonnes vers une pile centrale.
- **Clic** sur votre pioche quand vous êtes bloqué pour retourner une carte.
- **CRAPETTE !** quand vous avez vidé vos 5 colonnes.

## Jouer en ligne à deux

1. Le premier joueur clique sur **« Jouer en ligne » → « Créer une partie »** et obtient un code à 4 caractères.
2. Le second joueur clique sur **« Jouer en ligne »**, entre le code et clique sur **« Rejoindre »**.
3. La partie démarre automatiquement dès la connexion (nécessite une connexion Internet).

Bon jeu !

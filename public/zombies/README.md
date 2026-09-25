# Sprites des zombies (WOD Level, mode zombies)

Deposer ici z01.png .. z13.png (echelle de 25 niveaux : palier = ceil(niveau / 2), z11 = niveaux 21-22, z12 = 23-24, z13 = reserve ; le BOSS 25 = horde de z11 et z12) (les niveaux BOSS affichent une HORDE des zombies du bloc, pas de boss.png) : une feuille par zombie, 4 frames de marche en LIGNE (4 x 128 px de large, 128 px de haut (toute taille carree marche, le CSS est en pourcentages), fond transparent), vu de profil, marchant vers la DROITE. Absent -> l ecran affiche un emoji.

Generation depuis une image Gemini (4 frames, fond uni ou damier, JPEG) : `node scripts/sprite-sheet.mjs entree.jpg public/zombies/zNN.png 128 [ordre des colonnes, ex. 1,4,3,4 pour remplacer une frame abimee]`.

heart.png (optionnel) : le coeur en 4 etats cote a cote, mange DEPUIS LA GAUCHE (entier, une bouchee, deux bouchees, zombifie vert avec un ver = niveau perdu), 4 x 128 px, fond transparent, meme DA que les zombies. Absent -> emoji.

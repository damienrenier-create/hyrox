# Sprites des zombies (WOD Level, mode zombies)

Deposer ici z01.png .. z10.png : une feuille par zombie, 4 frames de marche en LIGNE (4 x 128 px de large, 128 px de haut (toute taille carree marche, le CSS est en pourcentages), fond transparent), vu de profil, marchant vers la DROITE. Absent -> l ecran affiche un emoji.

Generation depuis une image Gemini (4 frames sur faux damier, JPEG) : `node scripts/sprite-sheet.mjs entree.jpg public/zombies/zNN.png 128`.

# Prompts Gemini — sprites Touché-Coulé

Déposer les images dans `C:\Users\Sartay\Downloads\bateaux` avec **exactement** ces noms (extension .jpg ou .png).
Le pipeline `scripts/build-sprites.mjs` détoure le magenta, recadre et redimensionne tout seul.

## Style commun (à coller au début de CHAQUE prompt)

```
16-bit pixel art sprite, crisp pixels, no anti-aliasing, no blur, flat solid colours, clean black-ish outlines,
seen directly from above (top-down bird's-eye view), video game asset, no text, no watermark, no drop shadow.
```

Deux règles :
- **Objets** (bateaux, effets) : fond **magenta uni #FF00FF**, objet centré, rien ne touche les bords.
- **Tuiles de mer** : l'image est **remplie** par l'eau (pas de magenta), **carrée**, **seamless / tileable**.

Palette à répéter pour la cohérence : eau bleu profond `#1B5FA8` / `#16344E`, écume crème `#F5F8FA`, bois brun `#8B5A2B`, voiles crème `#EFE6D0`, accents or `#E0A800`.

---

## 1 · Bateaux vus du dessus (`top-ship-1` … `top-ship-5`)

Le chiffre = nombre de cases. Le bateau est **horizontal, proue vers la DROITE** ; le code le retourne/tourne tout seul.

**`top-ship-1`** (carré, 1:1)
```
[style commun] A tiny wooden pirate rowing boat seen from directly above, square composition, small deck with a
barrel and an oar, bow pointing to the right, solid magenta background #FF00FF, object centered with margin.
```

**`top-ship-2`** (image large, ratio ~2:1)
```
[style commun] A small wooden pirate sloop seen from directly above, twice as long as it is wide, one mast seen
from above as a small cross with a furled cream sail, deck planks visible, bow pointing to the right, wide 2:1
image, solid magenta background #FF00FF, object centered with margin.
```

**`top-ship-3`** (ratio ~3:1)
```
[style commun] A wooden pirate brigantine seen from directly above, three times longer than wide, two masts seen
from above as crosses with cream sails, deck planks, cannons along both sides, bow pointing to the right, wide 3:1
image, solid magenta background #FF00FF, object centered with margin.
```

**`top-ship-4`** (ratio ~4:1)
```
[style commun] A wooden pirate frigate seen from directly above, four times longer than wide, three masts seen
from above as crosses with cream sails, a black skull flag on the main mast, deck planks, cannons along both sides,
bow pointing to the right, very wide 4:1 image, solid magenta background #FF00FF, object centered with margin.
```

**`top-ship-5`** (ratio ~5:1)
```
[style commun] A huge wooden pirate galleon flagship seen from directly above, five times longer than wide, four
masts seen from above as crosses with cream sails, gold trim, a black skull flag, deck planks, many cannons along
both sides, bow pointing to the right, extremely wide 5:1 image, solid magenta background #FF00FF, object
centered with margin.
```

---

## 2 · Tuiles de mer (carrées, seamless, SANS magenta)

**`sea-calm-1`**, **`sea-calm-2`**, **`sea-calm-3`** (3 variantes, même prompt relancé 3 fois)
```
[style commun] Seamless tileable square pixel art ocean tile seen from directly above, deep blue water #1B5FA8
with a few small lighter wave highlights, very subtle, repeats perfectly on all four edges, fills the entire image,
no border, no objects, 64x64 pixel look.
```

**`sea-foam`** (variante avec écume, pour casser la répétition)
```
[style commun] Seamless tileable square pixel art ocean tile seen from directly above, deep blue water with a few
small cream foam crests and ripples, repeats perfectly on all four edges, fills the entire image, no border,
no objects, 64x64 pixel look.
```

---

## 3 · Effets posés SUR une case (carrés, fond magenta)

**`fx-target`** (case visée)
```
[style commun] A square pixel art targeting reticle icon for a naval battleship game, thin gold circle with four
tick marks and a small center dot, solid magenta background #FF00FF, centered, square image.
```

**`fx-miss`** (tir à l'eau, marqueur fixe)
```
[style commun] A square pixel art icon of concentric water ripples seen from directly above, light blue rings on
transparent-like magenta, a few small white droplets, solid magenta background #FF00FF, centered, square image.
```

**`fx-hit`** (case touchée, marqueur fixe)
```
[style commun] A square pixel art icon of a burning impact on a ship deck seen from directly above, small orange
and yellow flames with dark grey smoke puffs and a black scorch mark, solid magenta background #FF00FF, centered,
square image.
```

**`fx-wreck`** (navire coulé, marqueur fixe)
```
[style commun] A square pixel art icon of pirate shipwreck debris floating on water seen from directly above,
broken wooden planks, a barrel, a torn cream sail and a small skull, solid magenta background #FF00FF, centered,
square image.
```

---

## 4 · Animations (planches de 4 images côte à côte, fond magenta)

Une seule image large, **4 cases carrées égales en une ligne**, de gauche à droite = frame 1 → 4. Le pipeline découpe.

**`fx-splash-sheet`** (tir à l'eau)
```
[style commun] A pixel art sprite sheet of a water splash seen from directly above, exactly 4 equal square frames
in one horizontal row, left to right: 1) small ring on the water, 2) large splash with white droplets flying up,
3) droplets falling with wide ripples, 4) faint fading ripples; solid magenta background #FF00FF, each frame
centered, wide 4:1 image, no frame borders.
```

**`fx-fire-sheet`** (touché)
```
[style commun] A pixel art sprite sheet of an explosion on a wooden ship deck seen from directly above, exactly
4 equal square frames in one horizontal row, left to right: 1) bright yellow flash, 2) orange fireball with flying
wood splinters, 3) flames with dark grey smoke, 4) small dying flame with a black scorch mark; solid magenta
background #FF00FF, each frame centered, wide 4:1 image, no frame borders.
```

**`fx-sink-sheet`** (coulé)
```
[style commun] A pixel art sprite sheet of a small pirate ship sinking, seen from directly above, exactly 4 equal
square frames in one horizontal row, left to right: 1) the ship intact on fire, 2) the ship tilted and half under
water with bubbles, 3) only the mast tip and debris above the water with large ripples, 4) floating planks, a
barrel and a small skull on calm water; solid magenta background #FF00FF, each frame centered, wide 4:1 image,
no frame borders.
```

---

## Conseils
- Génère tout dans la **même conversation Gemini** en gardant le style commun mot pour mot : c'est ce qui garde la cohérence.
- Si Gemini ajoute une ombre ou un dégradé sur le magenta, réponds « the background must be a perfectly flat uniform magenta #FF00FF, no shadow, no gradient ».
- Si une tuile de mer n'est pas seamless, réponds « make it perfectly tileable: the left edge must continue the right edge and the top edge the bottom edge ».
- Peu importe la résolution : tout est redimensionné (bateaux : 96 px de haut ; cases : 40 px).

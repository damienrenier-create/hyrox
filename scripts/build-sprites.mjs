// Detoure les bateaux Gemini (fond magenta uni) en PNG transparents, les recadre et les
// normalise en hauteur, + prepare la texture de mer. Sortie : public/sprites/.
// Usage : node scripts/build-sprites.mjs
import sharp from "sharp";
import { mkdirSync } from "fs";
import { join } from "path";

const SRC = "C:\\Users\\Sartay\\Downloads\\bateaux";
const OUT = join(process.cwd(), "public", "sprites");
mkdirSync(OUT, { recursive: true });

// Bateaux vus du dessus, du plus court au plus long (ratio largeur/hauteur croissant)
const SHIPS = [
  { file: "Gemini_Generated_Image_ (6).jpg", name: "ship-1" },
  { file: "Gemini_Generated_Image_hgf7kohgf7kohgf7.jpg", name: "ship-2" },
  { file: "Gemini_Generated_Image_nvvyqxnvvyqxnvvy.jpg", name: "ship-3" },
  { file: "Gemini_Generated_Image_uaowb8uaowb8uaow.jpg", name: "ship-4" },
];
const SEA = "Gemini_Generated_Image_218jh4218jh4218j.jpg";

const TOLERANCE = 80; // distance RGB max pour considerer un pixel comme "fond"
const TARGET_HEIGHT = 96; // hauteur finale d'un bateau horizontal (1 case ~ 40px a l'ecran, on garde de la marge)

function dist(r, g, b, R, G, B) {
  return Math.sqrt((r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2);
}

async function keyOut(file, name) {
  const { data, info } = await sharp(join(SRC, file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  // couleur de fond = pixel du coin superieur gauche
  const R = data[0], G = data[1], B = data[2];
  let removed = 0;
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    const d = dist(data[o], data[o + 1], data[o + 2], R, G, B);
    if (d < TOLERANCE) {
      data[o + 3] = 0;
      removed++;
    } else if (d < TOLERANCE * 1.6) {
      // frange : on attenue plutot que de couper net
      data[o + 3] = Math.round(255 * ((d - TOLERANCE) / (TOLERANCE * 0.6)));
    }
  }
  const png = await sharp(data, { raw: { width, height, channels: 4 } })
    .png()
    .toBuffer();
  const trimmed = await sharp(png).trim().toBuffer({ resolveWithObject: true });
  const out = await sharp(trimmed.data)
    .resize({ height: TARGET_HEIGHT, kernel: "nearest" })
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, `${name}.png`));
  console.log(`${name}: fond=(${R},${G},${B}) ${removed} px retires, ${trimmed.info.width}x${trimmed.info.height} -> ${out.width}x${out.height} (ratio ${(out.width / out.height).toFixed(2)})`);
}

async function sea() {
  const out = await sharp(join(SRC, SEA)).resize({ width: 512 }).jpeg({ quality: 82 }).toFile(join(OUT, "sea.jpg"));
  console.log(`sea: ${out.width}x${out.height}`);
}

// Bateau de 5 cases : synthese "9-slice" a partir du long (poupe | troncon central repete | proue)
async function makeShip5() {
  const src = join(OUT, "ship-4.png");
  const meta = await sharp(src).metadata();
  const W = meta.width, H = meta.height;
  const targetW = 5 * H; // ratio 5:1
  const sternW = Math.round(W * 0.28);
  const bowW = Math.round(W * 0.28);
  const midX = Math.round(W * 0.32);
  const midW = Math.round(W * 0.36);
  const stern = await sharp(src).extract({ left: 0, top: 0, width: sternW, height: H }).toBuffer();
  const bow = await sharp(src).extract({ left: W - bowW, top: 0, width: bowW, height: H }).toBuffer();
  const mid = await sharp(src).extract({ left: midX, top: 0, width: midW, height: H }).toBuffer();
  const composites = [{ input: stern, left: 0, top: 0 }];
  let x = sternW;
  const midEnd = targetW - bowW;
  while (x < midEnd) {
    const w = Math.min(midW, midEnd - x);
    const piece = w === midW ? mid : await sharp(mid).extract({ left: 0, top: 0, width: w, height: H }).toBuffer();
    composites.push({ input: piece, left: x, top: 0 });
    x += w;
  }
  composites.push({ input: bow, left: targetW - bowW, top: 0 });
  const out = await sharp({ create: { width: targetW, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, "ship-5.png"));
  console.log(`ship-5 (synthese): ${out.width}x${out.height} (ratio ${(out.width / out.height).toFixed(2)})`);
}

for (const s of SHIPS) await keyOut(s.file, s.name);
await makeShip5();
await sea();
console.log("OK ->", OUT);

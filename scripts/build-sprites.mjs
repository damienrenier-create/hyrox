// Detoure les images Gemini (fond magenta uni, parfois double fond) en PNG transparents, les recadre,
// les normalise, decoupe les planches d'animation en bandes de 4 frames, et prepare les tuiles de mer.
// Source : dossier local hors depot (voir SRC) — seules les sorties public/sprites/ sont versionnees.
// Usage : node scripts/build-sprites.mjs
import sharp from "sharp";
import { mkdirSync, existsSync } from "fs";
import { join } from "path";

const SRC = process.env.SPRITES_SRC ?? "C:/Users/Sartay/Downloads/bateaux";
const OUT = join(process.cwd(), "public", "sprites");
mkdirSync(OUT, { recursive: true });

const MAGENTA = { r: 255, g: 0, b: 255 };
const TOLERANCE = 80; // distance RGB max pour considerer un pixel comme "fond"
const SHIP_HEIGHT = 96; // hauteur finale d'un bateau horizontal (1 case ~ 40 px a l'ecran)
const FX = 64; // cote d'une frame d'effet
const TILE = 256; // cote d'une tuile de mer

// Bateaux vus du dessus, fond magenta, proue a DROITE. Le chiffre = nombre de cases.
const SHIPS = [
  { file: "Gemini_Generated_Image_4c4ww94c4ww94c4w.jpg", name: "ship-1", cells: 1 }, // barque
  { file: "Gemini_Generated_Image_u7w3qnu7w3qnu7w3.jpg", name: "ship-2", cells: 2 }, // sloop
  { file: "Gemini_Generated_Image_qhlf1bqhlf1bqhlf.jpg", name: "ship-3", cells: 3 }, // brigantin
  { file: "Gemini_Generated_Image_y2yocny2yocny2yo.jpg", name: "ship-4", cells: 4 }, // fregate
  { file: "Gemini_Generated_Image_mg6885mg6885mg68.jpg", name: "ship-5", cells: 5 }, // galion
];

// Gemini ne respecte jamais le ratio au pixel pres. On etire le bateau jusqu'a son ratio cible (n cases)
// tant que la deformation reste discrete ; au-dela (la barque est dessinee en 2:1), on garde ses proportions
// et le plateau la centre dans sa case.
const MAX_STRETCH = 0.2;

// Marqueurs fixes poses sur une case (carres, fond magenta).
const MARKERS = [
  { file: "Gemini_Generated_Image_2olwzw2olwzw2olw.jpg", name: "fx-hit" },    // impact en feu sur le pont
  { file: "Gemini_Generated_Image_wmz6lkwmz6lkwmz6.jpg", name: "fx-wreck" },  // epave (coule)
  { file: "Gemini_Generated_Image_qvukthqvukthqvuk.jpg", name: "fx-miss" },   // anneaux (a l'eau)
  { file: "Gemini_Generated_Image_i7lfrpi7lfrpi7lf.jpg", name: "fx-target" }, // reticule (case visee)
];

// Planches d'animation : 4 frames carrees en ligne -> bande normalisee de 4 x FX px.
const SHEETS = [
  { file: "Gemini_Generated_Image_lpyxf4lpyxf4lpyx.jpg", name: "fx-splash" }, // tir a l'eau
  { file: "Gemini_Generated_Image_kg83a9kg83a9kg83.jpg", name: "fx-fire" },   // touche
  { file: "Gemini_Generated_Image_svztz6svztz6svzt.jpg", name: "fx-sink" },   // coule
];

// Tuiles de mer : remplissent l'image, aucun detourage.
const TILES = [
  { file: "Gemini_Generated_Image_yjd5ozyjd5ozyjd5.jpg", name: "sea" },      // calme
  { file: "Gemini_Generated_Image_p6e8evp6e8evp6e8.jpg", name: "sea-foam" }, // ecume
];

const dist = (r, g, b, c) => Math.sqrt((r - c.r) ** 2 + (g - c.g) ** 2 + (b - c.b) ** 2);

// Rend transparent tout pixel proche d'une des couleurs de fond. On prend systematiquement la couleur
// du coin superieur gauche ET le magenta pur : certaines images ont deux fonds (cadre violet + carre magenta).
async function keyOut(input) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;
  const corner = { r: data[0], g: data[1], b: data[2] };
  const keys = dist(corner.r, corner.g, corner.b, MAGENTA) < TOLERANCE ? [MAGENTA] : [corner, MAGENTA];
  for (let i = 0; i < width * height; i++) {
    const o = i * channels;
    const d = Math.min(...keys.map((k) => dist(data[o], data[o + 1], data[o + 2], k)));
    if (d < TOLERANCE) data[o + 3] = 0;
    else if (d < TOLERANCE * 1.6) data[o + 3] = Math.round(255 * ((d - TOLERANCE) / (TOLERANCE * 0.6))); // frange attenuee
  }
  return { buffer: await sharp(data, { raw: { width, height, channels: 4 } }).png().toBuffer(), corner, keys: keys.length };
}

async function ship({ file, name, cells }) {
  const { buffer, keys } = await keyOut(join(SRC, file));
  const trimmed = await sharp(buffer).trim().toBuffer({ resolveWithObject: true });
  const ratio = trimmed.info.width / trimmed.info.height;
  const snap = Math.abs(ratio - cells) / cells <= MAX_STRETCH;
  const resize = snap
    ? { width: cells * SHIP_HEIGHT, height: SHIP_HEIGHT, fit: "fill", kernel: "nearest" }
    : { height: SHIP_HEIGHT, kernel: "nearest" };
  const out = await sharp(trimmed.data).resize(resize).png({ compressionLevel: 9 }).toFile(join(OUT, `${name}.png`));
  console.log(
    `${name}: ${trimmed.info.width}x${trimmed.info.height} (ratio ${ratio.toFixed(2)}) -> ${out.width}x${out.height} ` +
      `(${(out.width / out.height).toFixed(2)}, cible ${cells}, ${snap ? "recale" : "proportions gardees"}, ${keys} fond(s))`
  );
}

async function marker({ file, name }) {
  const { buffer, keys } = await keyOut(join(SRC, file));
  const trimmed = await sharp(buffer).trim().toBuffer();
  const out = await sharp(trimmed)
    .resize({ width: FX, height: FX, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: "nearest" })
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, `${name}.png`));
  console.log(`${name}: ${out.width}x${out.height} (${keys} fond(s))`);
}

// Decoupe 4 frames egales, detoure chacune, et les recolle en une bande 4xFX (animation CSS steps(4)).
async function sheet({ file, name }) {
  const { buffer, keys } = await keyOut(join(SRC, file));
  const meta = await sharp(buffer).metadata();
  const fw = Math.floor(meta.width / 4);
  const frames = [];
  for (let i = 0; i < 4; i++) {
    const frame = await sharp(buffer)
      .extract({ left: i * fw, top: 0, width: fw, height: meta.height })
      .resize({ width: FX, height: FX, fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: "nearest" })
      .png()
      .toBuffer();
    frames.push({ input: frame, left: i * FX, top: 0 });
  }
  const out = await sharp({ create: { width: FX * 4, height: FX, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(frames)
    .png({ compressionLevel: 9 })
    .toFile(join(OUT, `${name}.png`));
  console.log(`${name}: 4 frames de ${fw}px -> ${out.width}x${out.height} (${keys} fond(s))`);
}

async function tile({ file, name }) {
  const out = await sharp(join(SRC, file))
    .resize({ width: TILE, height: TILE, fit: "cover", kernel: "nearest" })
    .jpeg({ quality: 82 })
    .toFile(join(OUT, `${name}.jpg`));
  console.log(`${name}: ${out.width}x${out.height}`);
}

const all = [
  ...SHIPS.map((s) => [ship, s]),
  ...MARKERS.map((m) => [marker, m]),
  ...SHEETS.map((s) => [sheet, s]),
  ...TILES.map((t) => [tile, t]),
];

if (!existsSync(SRC)) {
  console.error(`Dossier source introuvable : ${SRC}\nDefinis SPRITES_SRC=... ou depose les images (voir docs/sprites-prompts.md).`);
  process.exit(1);
}
for (const [fn, spec] of all) {
  if (!existsSync(join(SRC, spec.file))) {
    console.warn(`! ${spec.name} ignore : ${spec.file} absent`);
    continue;
  }
  await fn(spec);
}
console.log("OK ->", OUT);

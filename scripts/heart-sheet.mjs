// Planche du coeur (4 etats deja detoures, PNG transparent, 4 colonnes egales) -> public/zombies/heart.png :
// 4 cases de FRAME x FRAME, meme echelle, etats alignes sur le bord DROIT (le cote qui reste) et sur le bas.
// Usage : node scripts/heart-sheet.mjs <entree.png> <sortie.png> [FRAME=128]
import sharp from "sharp";

const [, , input, output, frameArg] = process.argv;
const FRAME = Number(frameArg ?? 128);
if (!input || !output) throw new Error("usage : node scripts/heart-sheet.mjs entree.png sortie.png [taille]");
const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels: C } = info;
const cols = 4;
const colW = Math.floor(W / cols);
const boxes = [];
for (let f = 0; f < cols; f++) {
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) for (let x = f * colW; x < (f + 1) * colW; x++) {
    if (data[(y * W + x) * C + 3] > 8) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  boxes.push({ minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 });
}
const scale = (FRAME * 0.9) / Math.max(...boxes.map((b) => Math.max(b.w, b.h)));
const ref = boxes[0]; // le coeur entier fixe la place : bord droit et bas communs a tous les etats
const rightPad = Math.round((FRAME - ref.w * scale) / 2);
const bottomPad = Math.round((FRAME - ref.h * scale) / 2);
const composites = [];
for (let f = 0; f < cols; f++) {
  const b = boxes[f];
  const frame = await sharp(data, { raw: { width: W, height: H, channels: C } })
    .extract({ left: b.minX, top: b.minY, width: b.w, height: b.h })
    .resize({ width: Math.max(1, Math.round(b.w * scale)), height: Math.max(1, Math.round(b.h * scale)), fit: "fill", kernel: "lanczos3" })
    .png().toBuffer({ resolveWithObject: true });
  const fw = frame.info.width, fh = frame.info.height;
  composites.push({ input: frame.data, left: f * FRAME + (FRAME - rightPad - fw), top: FRAME - bottomPad - fh });
}
await sharp({ create: { width: FRAME * cols, height: FRAME, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(composites).png().toFile(output);
console.log(`${output} : ${FRAME * cols}x${FRAME}, etats ${boxes.map((b) => `${b.w}x${b.h}`).join(" ")}`);

// Transforme une image Gemini (4 frames sur faux damier gris, JPEG) en feuille de sprites PNG transparente :
// 4 cases de FRAME x FRAME cote a cote, personnage centre, pieds sur la meme ligne de base.
// Usage : node scripts/_sprite.mjs <entree.jpg> <sortie.png> [FRAME=128]
import sharp from "sharp";

const [, , input, output, frameArg] = process.argv;
const FRAME = Number(frameArg ?? 128);
if (!input || !output) throw new Error("usage : node scripts/_sprite.mjs entree.jpg sortie.png [taille]");

const img = sharp(input).ensureAlpha();
const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
const { width: W, height: H, channels: C } = info;
const idx = (x, y) => (y * W + x) * C;

// Damier : pixels neutres (R ~ G ~ B) de gris moyen. Le JPEG bave : tolerance large, mais on ne retire que
// ce qui est RELIE au bord (remplissage), pour ne jamais trouer le personnage.
const isGray = (i) => {
  const r = data[i], g = data[i + 1], b = data[i + 2];
  const lum = (r + g + b) / 3;
  return Math.abs(r - g) <= 14 && Math.abs(g - b) <= 14 && Math.abs(r - b) <= 14 && lum >= 70 && lum <= 200;
};
const bg = new Uint8Array(W * H);
const stack = [];
for (let x = 0; x < W; x++) { stack.push(x, 0, x, H - 1); }
for (let y = 0; y < H; y++) { stack.push(0, y, W - 1, y); }
while (stack.length) {
  const y = stack.pop(), x = stack.pop();
  if (x < 0 || y < 0 || x >= W || y >= H) continue;
  const p = y * W + x;
  if (bg[p] || !isGray(idx(x, y))) continue;
  bg[p] = 1;
  stack.push(x + 1, y, x - 1, y, x, y + 1, x, y - 1);
}
// Alpha : fond -> 0 ; bord du personnage adouci (les pixels non gris restent opaques).
for (let p = 0; p < W * H; p++) data[p * C + 3] = bg[p] ? 0 : 255;

// Poussieres : par colonne, on ne garde que la plus grosse composante connexe de premier plan (les petites
// taches du damier JPEG ne doivent pas elargir la boite du personnage).
{
  const cols0 = 4;
  const colW0 = Math.floor(W / cols0);
  const label = new Int32Array(W * H);
  for (let f = 0; f < cols0; f++) {
    const sizes = new Map();
    let next = 1;
    for (let y = 0; y < H; y++) for (let x0 = f * colW0; x0 < (f + 1) * colW0; x0++) {
      const p0 = y * W + x0;
      if (bg[p0] || label[p0]) continue;
      const id = next++;
      let size = 0;
      const st = [x0, y];
      while (st.length) {
        const yy = st.pop(), xx = st.pop();
        if (xx < f * colW0 || xx >= (f + 1) * colW0 || yy < 0 || yy >= H) continue;
        const p = yy * W + xx;
        if (bg[p] || label[p]) continue;
        label[p] = id;
        size++;
        st.push(xx + 1, yy, xx - 1, yy, xx, yy + 1, xx, yy - 1);
      }
      sizes.set(id, size);
    }
    let best = 0, bestSize = 0;
    for (const [id, size] of sizes) if (size > bestSize) { best = id; bestSize = size; }
    for (let y = 0; y < H; y++) for (let x = f * colW0; x < (f + 1) * colW0; x++) {
      const p = y * W + x;
      if (!bg[p] && label[p] !== best) { bg[p] = 1; data[p * C + 3] = 0; }
    }
  }
}

// Decoupe en 4 colonnes egales, boite englobante par frame, mise a l'echelle commune (meme facteur pour
// toutes les frames, sinon le personnage « respire »), pieds sur la ligne de base.
const cols = 4;
const colW = Math.floor(W / cols);
const boxes = [];
for (let f = 0; f < cols; f++) {
  let minX = W, minY = H, maxX = -1, maxY = -1;
  for (let y = 0; y < H; y++) for (let x = f * colW; x < (f + 1) * colW; x++) {
    if (!bg[y * W + x]) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
  }
  boxes.push({ minX, minY, maxX, maxY, w: maxX - minX + 1, h: maxY - minY + 1 });
}
const maxW = Math.max(...boxes.map((b) => b.w)), maxH = Math.max(...boxes.map((b) => b.h));
const scale = (FRAME * 0.94) / Math.max(maxW, maxH);
const baseline = Math.max(...boxes.map((b) => b.maxY));

const sheet = sharp({ create: { width: FRAME * cols, height: FRAME, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } });
const composites = [];
for (let f = 0; f < cols; f++) {
  const b = boxes[f];
  const frame = await sharp(data, { raw: { width: W, height: H, channels: C } })
    .extract({ left: b.minX, top: b.minY, width: b.w, height: b.h })
    .resize({ width: Math.max(1, Math.round(b.w * scale)), height: Math.max(1, Math.round(b.h * scale)), fit: "fill", kernel: "lanczos3" })
    .png()
    .toBuffer({ resolveWithObject: true });
  const fw = frame.info.width, fh = frame.info.height;
  // Ligne de base commune : les pieds de chaque frame touchent le bas de la case a la meme hauteur.
  const footOffset = Math.round((baseline - b.maxY) * scale);
  const top = FRAME - 2 - fh - footOffset;
  const left = f * FRAME + Math.round((FRAME - fw) / 2);
  composites.push({ input: frame.data, left: Math.max(0, left), top: Math.max(0, top) });
}
await sheet.composite(composites).png().toFile(output);
const removed = bg.reduce((a, b) => a + b, 0);
console.log(`${output} : ${FRAME * cols}x${FRAME}, fond retire ${Math.round((100 * removed) / (W * H))} %, frames ${boxes.map((b) => `${b.w}x${b.h}`).join(" ")}`);

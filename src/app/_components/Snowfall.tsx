// Petit theme « winter arc » du WOD Level (Sartay 01/10) : de temps en temps, quelques minuscules flocons tombent
// sur l'ecran. Purement decoratif : au-dessus de tout mais sans capter un seul clic, et coupe si le systeme demande
// moins d'animations. Chaque flocon tombe pendant ~36 % de son cycle puis se repose (voir .snowflake, globals.css) :
// 12 flocons -> 4 ou 5 a l'ecran en moyenne.

// Tirage fixe (calcul entier, identique serveur/navigateur) : pas de Math.random, pas d'ecart d'hydratation.
const pick = (n: number) => (Math.imul(n + 1, 2654435761) >>> 0) % 1000 / 1000;
const FLAKES = Array.from({ length: 12 }, (_, i) => ({
  left: Math.round(2 + pick(i * 5) * 96), // % de la largeur
  size: 6 + Math.round(pick(i * 5 + 1) * 5), // 6 a 11 px
  dur: 28 + Math.round(pick(i * 5 + 2) * 20), // cycle de 28 a 48 s
  delay: -Math.round(pick(i * 5 + 3) * 48), // deja en route au chargement
  drift: Math.round((pick(i * 5 + 4) - 0.5) * 90), // derive laterale (px)
}));

export function Snowfall() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[60] overflow-hidden motion-reduce:hidden">
      {FLAKES.map((f, i) => (
        <span
          key={i}
          className="snowflake"
          style={{ left: `${f.left}%`, fontSize: f.size, animationDuration: `${f.dur}s`, animationDelay: `${f.delay}s`, ["--drift" as string]: `${f.drift}px` }}
        >
          {"❄︎"}
        </span>
      ))}
    </div>
  );
}

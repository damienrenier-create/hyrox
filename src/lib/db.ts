import 'temporal-polyfill/full/global';
import postgres from '@prisma/orm-postgres/runtime';
import type { Contract } from '../../prisma/schema.d';
import contractJson from '../../prisma/schema.json' with { type: 'json' };
import { currentSchool, type SchoolId } from './school';

const raw = postgres<Contract>({
  contractJson,
  url: process.env.DATABASE_URL!,
  // Neon s'endort quand personne ne l'utilise : la premiere connexion du matin prend quelques secondes. Sans marge, elle
  // echouait (« Connection terminated due to connection timeout », page en erreur au premier clic — vu le 27/09 en
  // prod et le 04/10 en local). On laisse 20 s a la base pour se reveiller, et on rend les connexions inactives apres
  // 30 s pour ne pas reutiliser une connexion que Neon a deja coupee.
  poolOptions: {
    connectionTimeoutMillis: 20_000,
    idleTimeoutMillis: 30_000,
  },
});

// ===== Une base, plusieurs ecoles (Sartay 18/11 ; voir lib/school.ts) =====
// `db` s'utilise exactement comme avant (db.orm.public.<Modele>.where(...).first(), .create(...), db.transaction(...)),
// mais chaque requete est rangee dans l'ECOLE COURANTE, sans que l'appelant ait rien a faire :
// - lecture, mise a jour, suppression, comptage : le filtre « schoolId de l'ecole courante » est ajoute en tete de
//   chaine (`isNull()` pour l'ecole d'origine : toutes les lignes d'avant le 18/11), puis les filtres de l'appelant
//   s'y ajoutent (les .where() enchaines se combinent en ET) ;
// - creation (create, createAndCount) : la ligne recoit l'etiquette de l'ecole courante ;
// - transaction : le `tx` passe au rappel est range dans la meme ecole.
// Comme l'ecole n'est connue qu'en lisant les cookies (asynchrone), `db` note la chaine d'appels et ne la rejoue sur le
// vrai client qu'au moment ou elle est attendue (await, Promise.all, for await) : rien ne part vers la base avant.
// Modeles PARTAGES (sans etiquette) : l'echelle des niveaux et le catalogue d'exercices du WOD Level.
const SHARED_MODELS = new Set(['Level', 'LevelExercise']);

type Row = Record<string, unknown>;
type AnyObj = Record<PropertyKey, unknown> & ((...args: unknown[]) => unknown);

function scopedModel(base: AnyObj, school: SchoolId): unknown {
  const filtered = () =>
    (base.where as (p: unknown) => AnyObj)((r: { schoolId: { isNull: () => unknown; eq: (v: string) => unknown } }) =>
      school === null ? r.schoolId.isNull() : r.schoolId.eq(school),
    );
  const tag = (row: Row) => ({ ...row, schoolId: school });
  return new Proxy(base, {
    get(target, key) {
      if (key === 'create') return (data: Row, ...rest: unknown[]) => (target.create as (...a: unknown[]) => unknown)(tag(data), ...rest);
      if (key === 'createAndCount') {
        return (rows: Row[], ...rest: unknown[]) => (target.createAndCount as (...a: unknown[]) => unknown)(rows.map(tag), ...rest);
      }
      const f = filtered();
      const v = f[key];
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(f) : v;
    },
  });
}

function scopedClient(client: AnyObj, school: SchoolId): AnyObj {
  return new Proxy(client, {
    get(target, key) {
      if (key === 'orm') {
        return new Proxy(target.orm as AnyObj, {
          get(orm, ns) {
            const space = orm[ns] as AnyObj | undefined;
            if (ns !== 'public' || !space) return space;
            return new Proxy(space, {
              get(sp, model) {
                const m = sp[model] as AnyObj | undefined;
                if (typeof model !== 'string' || !m || SHARED_MODELS.has(model)) return m;
                return scopedModel(m, school);
              },
            });
          },
        });
      }
      if (key === 'transaction') {
        return (cb: (tx: unknown) => unknown, ...rest: unknown[]) =>
          (target.transaction as (...a: unknown[]) => unknown)((tx: AnyObj) => cb(scopedClient(tx, school)), ...rest);
      }
      const v = target[key];
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(target) : v;
    },
  }) as AnyObj;
}

// Chaine d'appels notee puis rejouee (voir plus haut). La valeur finale est emballee ({ value }) pour qu'une
// promesse ne « deballe » pas trop tot un resultat qui doit encore etre parcouru (for await).
type Step = { get: PropertyKey } | { call: unknown[] };
async function replay(steps: Step[], root: AnyObj = raw as unknown as AnyObj): Promise<{ value: unknown }> {
  let cur: unknown = scopedClient(root, await currentSchool());
  let self: unknown = undefined;
  for (const s of steps) {
    if ('get' in s) {
      self = cur;
      cur = (cur as AnyObj)[s.get];
    } else {
      cur = Reflect.apply(cur as (...a: unknown[]) => unknown, self, s.call);
      self = undefined;
    }
  }
  return { value: cur };
}

// - une chaine attendue plusieurs fois ne part qu'UNE fois (comme une promesse) ;
// - ce qu'on ecrit sur la chaine (React y note status / value d'une promesse suivie) se relit tel quel.
function deferred(steps: Step[], root?: AnyObj): unknown {
  const own = new Map<PropertyKey, unknown>();
  let run: Promise<unknown> | null = null;
  return new Proxy(function () {}, {
    get(_t, key) {
      if (own.has(key)) return own.get(key);
      if (key === 'then') {
        return (ok?: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
          (run ??= replay(steps, root).then((r) => r.value)).then(ok, ko);
      }
      if (key === Symbol.asyncIterator) {
        return async function* () {
          const { value } = await replay(steps, root);
          yield* value as AsyncIterable<unknown>;
        };
      }
      return deferred([...steps, { get: key }], root);
    },
    set(_t, key, value) {
      own.set(key, value);
      return true;
    },
    apply(_t, _self, args) {
      return deferred([...steps, { call: args }], root);
    },
  });
}

export const db = deferred([]) as unknown as typeof raw;

// Pour le test de lib/db (scripts/_db-ecoles.test.ts) : la meme mecanique sur un faux client, sans base.
export const __dbInternals = { deferred: (root: unknown) => deferred([], root as AnyObj) };

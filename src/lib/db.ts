import 'temporal-polyfill/full/global';
import postgres from '@prisma/orm-postgres/runtime';
import type { Contract } from '../../prisma/schema.d';
import contractJson from '../../prisma/schema.json' with { type: 'json' };

export const db = postgres<Contract>({
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

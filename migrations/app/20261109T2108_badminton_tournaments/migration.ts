#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/26ae7a0fa6bf482b1620882508567aa6ee0328a62726d80bf239f20d802d84c5/contract';
import startContract from '../../snapshots/26ae7a0fa6bf482b1620882508567aa6ee0328a62726d80bf239f20d802d84c5/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/dcf0ff645ab157d57f3e21e899f09ea159fb617e23e4a42012db62b91cbb4bc4/contract';
import endContract from '../../snapshots/dcf0ff645ab157d57f3e21e899f09ea159fb617e23e4a42012db62b91cbb4bc4/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'badmintonTournament',
        columns: [
          col('cancelledAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-temporal@1' } }),
          col('cancelledBy', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('label', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sessionId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('settings', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'badmintonTournamentPlayer',
        columns: [
          col('elo', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('pool', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('seed', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('studentId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('tournamentId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'badmintonMatch',
        column: col('tournamentId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'badmintonMatch',
        index: 'badmintonMatch_tournamentId_idx_d0bd97a6',
        columns: ['tournamentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'badmintonTournament',
        index: 'badmintonTournament_sessionId_idx_29f415d4',
        columns: ['sessionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'badmintonTournamentPlayer',
        index: 'badmintonTournamentPlayer_tournamentId_idx_d0bd97a6',
        columns: ['tournamentId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'badmintonTournamentPlayer',
        foreignKey: {
          name: 'badmintonTournamentPlayer_tournamentId_fkey',
          columns: ['tournamentId'],
          references: { schema: 'public', table: 'badmintonTournament', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

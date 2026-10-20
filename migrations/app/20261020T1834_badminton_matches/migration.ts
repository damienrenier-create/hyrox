#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/1674cab46e8a09d3931d55addaa0b36674613523f84da9afbf3b3b76dc4ed566/contract';
import startContract from '../../snapshots/1674cab46e8a09d3931d55addaa0b36674613523f84da9afbf3b3b76dc4ed566/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/83b2afe40db4901196878621375e5e843223c86f7de25efff4fdbd2a3e535465/contract';
import endContract from '../../snapshots/83b2afe40db4901196878621375e5e843223c86f7de25efff4fdbd2a3e535465/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'cyclePlan',
        constraint: 'cyclePlan_wodType_check_e729d788',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'session',
        constraint: 'session_wodType_check_e729d788',
      }),
      this.createTable({
        schema: 'public',
        table: 'badmintonEvent',
        columns: [
          col('at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('authorId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('kind', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('matchId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('role', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sets', 'json', { codecRef: { codecId: 'pg/json@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'badmintonMatch',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('createdById', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('playerAId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('playerBId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'cyclePlan',
        constraint: 'cyclePlan_wodType_check_a74eed95',
        expression:
          "\"wodType\" IN ('PYRAMIDE_CLASSIQUE', 'RELAIS_SPRINT', 'TOUCHE_COULE_HYROX', 'FETE_FORAINE', 'LEVEL', 'HYROX', 'AMRAP', 'BADMINTON')",
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'session',
        constraint: 'session_wodType_check_a74eed95',
        expression:
          "\"wodType\" IN ('PYRAMIDE_CLASSIQUE', 'RELAIS_SPRINT', 'TOUCHE_COULE_HYROX', 'FETE_FORAINE', 'LEVEL', 'HYROX', 'AMRAP', 'BADMINTON')",
      }),
      this.createIndex({
        schema: 'public',
        table: 'badmintonEvent',
        index: 'badmintonEvent_matchId_idx_4caf5ecc',
        columns: ['matchId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'badmintonEvent',
        index: 'badmintonEvent_sessionId_idx_29f415d4',
        columns: ['sessionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'badmintonMatch',
        index: 'badmintonMatch_sessionId_idx_29f415d4',
        columns: ['sessionId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'badmintonEvent',
        foreignKey: {
          name: 'badmintonEvent_matchId_fkey',
          columns: ['matchId'],
          references: { schema: 'public', table: 'badmintonMatch', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'badmintonMatch',
        foreignKey: {
          name: 'badmintonMatch_sessionId_fkey',
          columns: ['sessionId'],
          references: { schema: 'public', table: 'session', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

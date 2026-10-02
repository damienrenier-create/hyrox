#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/e41ef3adbf0bcfa738e65fc5b4cd99e6fd8fc95de24e8d066dd02d0bd8e4a65c/contract';
import startContract from '../../snapshots/e41ef3adbf0bcfa738e65fc5b4cd99e6fd8fc95de24e8d066dd02d0bd8e4a65c/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f107e9ce68352319522dfd7921e0cfa95c9573a5244e0290dea4dc63a17f9f0b/contract';
import endContract from '../../snapshots/f107e9ce68352319522dfd7921e0cfa95c9573a5244e0290dea4dc63a17f9f0b/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'observation',
        columns: [
          col('endedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-temporal@1' } }),
          col('endsAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-temporal@1' } }),
          col('evaluatorId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('mode', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('startedAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('targetUserId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('teamId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'repEntry',
        columns: [
          col('at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('evaluatorId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('exerciseId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('observationId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('reps', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('targetUserId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('voidedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-temporal@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'evaluation',
        column: col('observationId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'observation',
        index: 'observation_evaluatorId_idx_010145e1',
        columns: ['evaluatorId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'observation',
        index: 'observation_sessionId_idx_29f415d4',
        columns: ['sessionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'observation',
        index: 'observation_targetUserId_idx_e0d638f0',
        columns: ['targetUserId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'repEntry',
        index: 'repEntry_observationId_idx_d3d19fef',
        columns: ['observationId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'repEntry',
        index: 'repEntry_sessionId_idx_29f415d4',
        columns: ['sessionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'repEntry',
        index: 'repEntry_targetUserId_idx_e0d638f0',
        columns: ['targetUserId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

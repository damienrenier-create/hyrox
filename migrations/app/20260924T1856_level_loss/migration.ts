#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/44d75a4aa57c1618fae357e63982cc2aabb12d219e413c21a42f94ec4e7bc9cc/contract';
import startContract from '../../snapshots/44d75a4aa57c1618fae357e63982cc2aabb12d219e413c21a42f94ec4e7bc9cc/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/aed1cfa0cde3582b755ad0c6a9365d58364e5a571922d998b49b2b9bf20326ce/contract';
import endContract from '../../snapshots/aed1cfa0cde3582b755ad0c6a9365d58364e5a571922d998b49b2b9bf20326ce/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'levelLoss',
        columns: [
          col('at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('level', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('teamId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createIndex({
        schema: 'public',
        table: 'levelLoss',
        index: 'levelLoss_sessionId_idx_29f415d4',
        columns: ['sessionId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'levelLoss',
        foreignKey: {
          name: 'levelLoss_sessionId_fkey',
          columns: ['sessionId'],
          references: { schema: 'public', table: 'session', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

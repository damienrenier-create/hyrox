#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/0525ecf171f20550f8439aec2acc538057d961047da27532deceaf77f4c25ce6/contract';
import endContract from '../../snapshots/0525ecf171f20550f8439aec2acc538057d961047da27532deceaf77f4c25ce6/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/30b14a3453eba066a44081461bded368c9814e5741b7b785f652e4f1d80e2bf7/contract';
import startContract from '../../snapshots/30b14a3453eba066a44081461bded368c9814e5741b7b785f652e4f1d80e2bf7/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'sessionReferee',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('note', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('userId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'sessionReferee',
        constraint: 'sessionReferee_sessionId_userId_key',
        columns: ['sessionId', 'userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sessionReferee',
        index: 'sessionReferee_sessionId_idx_29f415d4',
        columns: ['sessionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'sessionReferee',
        index: 'sessionReferee_userId_idx_a489d58a',
        columns: ['userId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sessionReferee',
        foreignKey: {
          name: 'sessionReferee_sessionId_fkey',
          columns: ['sessionId'],
          references: { schema: 'public', table: 'session', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'sessionReferee',
        foreignKey: {
          name: 'sessionReferee_userId_fkey',
          columns: ['userId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

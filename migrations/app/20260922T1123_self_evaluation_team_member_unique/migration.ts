#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/30b14a3453eba066a44081461bded368c9814e5741b7b785f652e4f1d80e2bf7/contract';
import endContract from '../../snapshots/30b14a3453eba066a44081461bded368c9814e5741b7b785f652e4f1d80e2bf7/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/f2fb34c181b3f09f505bde58274900a7cb692cdcacfbe494b5c532f7be462961/contract';
import startContract from '../../snapshots/f2fb34c181b3f09f505bde58274900a7cb692cdcacfbe494b5c532f7be462961/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'selfEvaluation',
        columns: [
          col('answers', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('studentId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('submittedAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'selfEvaluation',
        constraint: 'selfEvaluation_sessionId_studentId_key',
        columns: ['sessionId', 'studentId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'teamMember',
        constraint: 'teamMember_teamId_userId_key',
        columns: ['teamId', 'userId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'selfEvaluation',
        index: 'selfEvaluation_sessionId_idx_29f415d4',
        columns: ['sessionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'selfEvaluation',
        index: 'selfEvaluation_studentId_idx_bf255322',
        columns: ['studentId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'selfEvaluation',
        foreignKey: {
          name: 'selfEvaluation_sessionId_fkey',
          columns: ['sessionId'],
          references: { schema: 'public', table: 'session', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'selfEvaluation',
        foreignKey: {
          name: 'selfEvaluation_studentId_fkey',
          columns: ['studentId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

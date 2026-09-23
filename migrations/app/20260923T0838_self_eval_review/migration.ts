#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/2e1e20d2b6c2768d428e587093f9c35a7a1304d5a0811d712fc30478c518b09a/contract';
import endContract from '../../snapshots/2e1e20d2b6c2768d428e587093f9c35a7a1304d5a0811d712fc30478c518b09a/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e4123148b359b337ab53aae7038cb945dd712252256961367fa22d67fa115857/contract';
import startContract from '../../snapshots/e4123148b359b337ab53aae7038cb945dd712252256961367fa22d67fa115857/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'selfEvalReview',
        columns: [
          col('answers', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('comment', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('commentVisible', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('reviewerName', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('studentId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('visible', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addUnique({
        schema: 'public',
        table: 'selfEvalReview',
        constraint: 'selfEvalReview_sessionId_studentId_key',
        columns: ['sessionId', 'studentId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'selfEvalReview',
        index: 'selfEvalReview_sessionId_idx_29f415d4',
        columns: ['sessionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'selfEvalReview',
        index: 'selfEvalReview_studentId_idx_bf255322',
        columns: ['studentId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/8a73f98ff5fecbcc47e9d0372301b587bb897daadfbca32934fa55895d8cc88e/contract';
import startContract from '../../snapshots/8a73f98ff5fecbcc47e9d0372301b587bb897daadfbca32934fa55895d8cc88e/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/e41ef3adbf0bcfa738e65fc5b4cd99e6fd8fc95de24e8d066dd02d0bd8e4a65c/contract';
import endContract from '../../snapshots/e41ef3adbf0bcfa738e65fc5b4cd99e6fd8fc95de24e8d066dd02d0bd8e4a65c/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'cyclePlan',
        constraint: 'cyclePlan_wodType_check_da837c10',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'session',
        constraint: 'session_wodType_check_da837c10',
      }),
      this.createTable({
        schema: 'public',
        table: 'quizAnswer',
        columns: [
          col('answers', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('score', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('studentId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('total', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'cyclePlan',
        constraint: 'cyclePlan_wodType_check_7c965a6d',
        expression:
          "\"wodType\" IN ('PYRAMIDE_CLASSIQUE', 'RELAIS_SPRINT', 'TOUCHE_COULE_HYROX', 'FETE_FORAINE', 'LEVEL', 'HYROX')",
      }),
      this.addUnique({
        schema: 'public',
        table: 'quizAnswer',
        constraint: 'quizAnswer_sessionId_studentId_key',
        columns: ['sessionId', 'studentId'],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'session',
        constraint: 'session_wodType_check_7c965a6d',
        expression:
          "\"wodType\" IN ('PYRAMIDE_CLASSIQUE', 'RELAIS_SPRINT', 'TOUCHE_COULE_HYROX', 'FETE_FORAINE', 'LEVEL', 'HYROX')",
      }),
      this.createIndex({
        schema: 'public',
        table: 'quizAnswer',
        index: 'quizAnswer_sessionId_idx_29f415d4',
        columns: ['sessionId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

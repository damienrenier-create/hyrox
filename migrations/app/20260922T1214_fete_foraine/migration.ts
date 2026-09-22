#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/511442e7708747f7e4e0561a9318b1553d55a1318f5b0edf45439e56c2662006/contract';
import startContract from '../../snapshots/511442e7708747f7e4e0561a9318b1553d55a1318f5b0edf45439e56c2662006/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/81a7488538ec96c975a60b9fdb1783236a2f2e0148183680cbd5f0c0c85d910e/contract';
import endContract from '../../snapshots/81a7488538ec96c975a60b9fdb1783236a2f2e0148183680cbd5f0c0c85d910e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'cyclePlan',
        constraint: 'cyclePlan_wodType_check_b588abc4',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'session',
        constraint: 'session_wodType_check_b588abc4',
      }),
      this.createTable({
        schema: 'public',
        table: 'stationEvent',
        columns: [
          col('at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('stationId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('teamId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'team',
        column: col('color', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'team',
        column: col('penalties', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'teamMember',
        column: col('finisherPoints', 'int4', {
          notNull: true,
          default: lit(0),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'cyclePlan',
        constraint: 'cyclePlan_wodType_check_686f9918',
        expression:
          "\"wodType\" IN ('PYRAMIDE_CLASSIQUE', 'RELAIS_SPRINT', 'TOUCHE_COULE_HYROX', 'FETE_FORAINE')",
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'session',
        constraint: 'session_wodType_check_686f9918',
        expression:
          "\"wodType\" IN ('PYRAMIDE_CLASSIQUE', 'RELAIS_SPRINT', 'TOUCHE_COULE_HYROX', 'FETE_FORAINE')",
      }),
      this.createIndex({
        schema: 'public',
        table: 'stationEvent',
        index: 'stationEvent_sessionId_idx_29f415d4',
        columns: ['sessionId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'stationEvent',
        foreignKey: {
          name: 'stationEvent_sessionId_fkey',
          columns: ['sessionId'],
          references: { schema: 'public', table: 'session', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

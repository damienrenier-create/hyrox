#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/13fb9bea21aa67b4f011575c4d26bf4f7e7463d24c942eca4c13a19bfbef6f18/contract';
import startContract from '../../snapshots/13fb9bea21aa67b4f011575c4d26bf4f7e7463d24c942eca4c13a19bfbef6f18/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/1d79e4d946eaa3cb14d6e306b0f0fed626dbed67f8d22d8dadc95c30771cc312/contract';
import endContract from '../../snapshots/1d79e4d946eaa3cb14d6e306b0f0fed626dbed67f8d22d8dadc95c30771cc312/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'lap',
        columns: [
          col('at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('raceStateId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('teamId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'racePause',
        columns: [
          col('from', 'timestamptz', {
            notNull: true,
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('raceStateId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('to', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-temporal@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'raceState',
        columns: [
          col('afterMin', 'int4', {
            notNull: true,
            default: lit(10),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('capMin', 'int4', {
            notNull: true,
            default: lit(45),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('endedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-temporal@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('noStartExerciseIds', 'json', {
            notNull: true,
            default: lit('[]'),
            codecRef: { codecId: 'pg/json@1' },
          }),
          col('peak', 'int4', {
            notNull: true,
            default: lit(10),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('penMin', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('rep0', 'int4', {
            notNull: true,
            default: lit(5),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('runs', 'int4', {
            notNull: true,
            default: lit(2),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('startedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-temporal@1' } }),
          col('step', 'int4', {
            notNull: true,
            default: lit(1),
            codecRef: { codecId: 'pg/int4@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'yellowCard',
        columns: [
          col('at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('raceStateId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('teamId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'team',
        column: col('endExerciseId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'team',
        column: col('startExerciseId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'raceState',
        constraint: 'raceState_sessionId_key',
        columns: ['sessionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'lap',
        index: 'lap_raceStateId_idx_1a905bb3',
        columns: ['raceStateId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'lap',
        index: 'lap_raceStateId_teamId_idx_76b9cf9a',
        columns: ['raceStateId', 'teamId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'racePause',
        index: 'racePause_raceStateId_idx_1a905bb3',
        columns: ['raceStateId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'yellowCard',
        index: 'yellowCard_raceStateId_idx_1a905bb3',
        columns: ['raceStateId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'yellowCard',
        index: 'yellowCard_raceStateId_teamId_idx_76b9cf9a',
        columns: ['raceStateId', 'teamId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'lap',
        foreignKey: {
          name: 'lap_raceStateId_fkey',
          columns: ['raceStateId'],
          references: { schema: 'public', table: 'raceState', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'racePause',
        foreignKey: {
          name: 'racePause_raceStateId_fkey',
          columns: ['raceStateId'],
          references: { schema: 'public', table: 'raceState', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'raceState',
        foreignKey: {
          name: 'raceState_sessionId_fkey',
          columns: ['sessionId'],
          references: { schema: 'public', table: 'session', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'yellowCard',
        foreignKey: {
          name: 'yellowCard_raceStateId_fkey',
          columns: ['raceStateId'],
          references: { schema: 'public', table: 'raceState', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/44d75a4aa57c1618fae357e63982cc2aabb12d219e413c21a42f94ec4e7bc9cc/contract';
import endContract from '../../snapshots/44d75a4aa57c1618fae357e63982cc2aabb12d219e413c21a42f94ec4e7bc9cc/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/a8eaac01ec949473fec558985cff6f60d9021dd41596ec3c77f4cff9c07d8869/contract';
import startContract from '../../snapshots/a8eaac01ec949473fec558985cff6f60d9021dd41596ec3c77f4cff9c07d8869/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, fn, lit, primaryKey } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'cyclePlan',
        constraint: 'cyclePlan_wodType_check_686f9918',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'session',
        constraint: 'session_wodType_check_686f9918',
      }),
      this.createTable({
        schema: 'public',
        table: 'level',
        columns: [
          col('cards', 'json', {
            notNull: true,
            default: lit('[]'),
            codecRef: { codecId: 'pg/json@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('name', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('number', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'levelExercise',
        columns: [
          col('active', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('createdBy', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('label', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('order', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('updatedAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('weight', 'float8', { notNull: true, codecRef: { codecId: 'pg/float8@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'levelTick',
        columns: [
          col('at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('by', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('card', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('level', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('teamId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'mineBoard',
        columns: [
          col('cols', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('mines', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('rows', 'json', { notNull: true, codecRef: { codecId: 'pg/json@1' } }),
          col('seed', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'mineReveal',
        columns: [
          col('at', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('col', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('evaluationId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('refereeId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('row', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.addColumn({
        schema: 'public',
        table: 'evaluation',
        column: col('targetUserId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'cyclePlan',
        constraint: 'cyclePlan_wodType_check_da837c10',
        expression:
          "\"wodType\" IN ('PYRAMIDE_CLASSIQUE', 'RELAIS_SPRINT', 'TOUCHE_COULE_HYROX', 'FETE_FORAINE', 'LEVEL')",
      }),
      this.addUnique({
        schema: 'public',
        table: 'level',
        constraint: 'level_number_key',
        columns: ['number'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'levelExercise',
        constraint: 'levelExercise_label_key',
        columns: ['label'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'levelTick',
        constraint: 'levelTick_sessionId_teamId_level_card_key',
        columns: ['sessionId', 'teamId', 'level', 'card'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'mineBoard',
        constraint: 'mineBoard_sessionId_key',
        columns: ['sessionId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'mineReveal',
        constraint: 'mineReveal_evaluationId_key',
        columns: ['evaluationId'],
      }),
      this.addUnique({
        schema: 'public',
        table: 'mineReveal',
        constraint: 'mineReveal_sessionId_refereeId_row_col_key',
        columns: ['sessionId', 'refereeId', 'row', 'col'],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'session',
        constraint: 'session_wodType_check_da837c10',
        expression:
          "\"wodType\" IN ('PYRAMIDE_CLASSIQUE', 'RELAIS_SPRINT', 'TOUCHE_COULE_HYROX', 'FETE_FORAINE', 'LEVEL')",
      }),
      this.createIndex({
        schema: 'public',
        table: 'evaluation',
        index: 'evaluation_targetUserId_idx_e0d638f0',
        columns: ['targetUserId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'levelTick',
        index: 'levelTick_sessionId_idx_29f415d4',
        columns: ['sessionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'mineReveal',
        index: 'mineReveal_sessionId_idx_29f415d4',
        columns: ['sessionId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'levelTick',
        foreignKey: {
          name: 'levelTick_sessionId_fkey',
          columns: ['sessionId'],
          references: { schema: 'public', table: 'session', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'mineBoard',
        foreignKey: {
          name: 'mineBoard_sessionId_fkey',
          columns: ['sessionId'],
          references: { schema: 'public', table: 'session', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'mineReveal',
        foreignKey: {
          name: 'mineReveal_sessionId_fkey',
          columns: ['sessionId'],
          references: { schema: 'public', table: 'session', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

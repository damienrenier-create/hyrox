#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/0525ecf171f20550f8439aec2acc538057d961047da27532deceaf77f4c25ce6/contract';
import startContract from '../../snapshots/0525ecf171f20550f8439aec2acc538057d961047da27532deceaf77f4c25ce6/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/d6a3b053608629407e645bf915a9cd6647ef82a224a6e066970236627fb54e3c/contract';
import endContract from '../../snapshots/d6a3b053608629407e645bf915a9cd6647ef82a224a6e066970236627fb54e3c/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  checkExpression,
  col,
  fn,
  lit,
  primaryKey,
} from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.createTable({
        schema: 'public',
        table: 'classSlot',
        columns: [
          col('className', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('endMin', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('startMin', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('weekday', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'cycle',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('isCurrent', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('name', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('order', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'cyclePlan',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('cycleId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('isCurrent', 'bool', {
            notNull: true,
            default: lit(false),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('label', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('numTeams', 'int4', {
            notNull: true,
            default: lit(24),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('order', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('refereeMode', 'bool', {
            notNull: true,
            default: lit(true),
            codecRef: { codecId: 'pg/bool@1' },
          }),
          col('wodType', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'cyclePlan_wodType_check_b588abc4',
            "\"wodType\" IN ('PYRAMIDE_CLASSIQUE', 'RELAIS_SPRINT', 'TOUCHE_COULE_HYROX')",
          ),
        ],
      }),
      this.addColumn({
        schema: 'public',
        table: 'session',
        column: col('autoOpened', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'session',
        column: col('closesAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-temporal@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'session',
        column: col('cycleId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'session',
        column: col('label', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'session',
        column: col('planId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'session',
        column: col('slotKey', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'session',
        constraint: 'session_slotKey_key',
        columns: ['slotKey'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'classSlot',
        index: 'classSlot_className_idx_f1738847',
        columns: ['className'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'cyclePlan',
        index: 'cyclePlan_cycleId_idx_75f87b79',
        columns: ['cycleId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'session',
        index: 'session_cycleId_idx_75f87b79',
        columns: ['cycleId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'session',
        index: 'session_planId_idx_5b32079a',
        columns: ['planId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'cyclePlan',
        foreignKey: {
          name: 'cyclePlan_cycleId_fkey',
          columns: ['cycleId'],
          references: { schema: 'public', table: 'cycle', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'session',
        foreignKey: {
          name: 'session_cycleId_fkey',
          columns: ['cycleId'],
          references: { schema: 'public', table: 'cycle', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'session',
        foreignKey: {
          name: 'session_planId_fkey',
          columns: ['planId'],
          references: { schema: 'public', table: 'cyclePlan', columns: ['id'] },
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/2faf416d736b01ccd8f82d6609a5bdbc0819fcf9239fbdc9c175585fa49ef11e/contract';
import endContract from '../../snapshots/2faf416d736b01ccd8f82d6609a5bdbc0819fcf9239fbdc9c175585fa49ef11e/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/97f1883ee86259b0b71ac17f83371fbac078aee47ec4509ee6bee0205cdd22eb/contract';
import startContract from '../../snapshots/97f1883ee86259b0b71ac17f83371fbac078aee47ec4509ee6bee0205cdd22eb/contract.json' with { type: 'json' };
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
      this.dropCheckConstraint({
        schema: 'public',
        table: 'session',
        constraint: 'session_wodType_check_7d2d42df',
      }),
      this.createTable({
        schema: 'public',
        table: 'refereeFleet',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('lockedAt', 'timestamptz', { codecRef: { codecId: 'pg/timestamptz-temporal@1' } }),
          col('refereeId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('slot', 'int4', {
            notNull: true,
            default: lit(0),
            codecRef: { codecId: 'pg/int4@1' },
          }),
          col('status', 'text', {
            notNull: true,
            default: lit('PLACING'),
            codecRef: { codecId: 'pg/text@1' },
          }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression(
            'refereeFleet_status_check_433336be',
            "\"status\" IN ('PLACING', 'LOCKED')",
          ),
        ],
      }),
      this.createTable({
        schema: 'public',
        table: 'refereeShip',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('fleetId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('orientation', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('size', 'int4', { notNull: true, codecRef: { codecId: 'pg/int4@1' } }),
          col('startExerciseId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('startTeamId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [primaryKey(['id'])],
      }),
      this.createTable({
        schema: 'public',
        table: 'shot',
        columns: [
          col('createdAt', 'timestamptz', {
            notNull: true,
            default: fn('now()'),
            codecRef: { codecId: 'pg/timestamptz-temporal@1' },
          }),
          col('evaluationId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('id', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('phase', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('refereeId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('sessionId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('targetExerciseId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
          col('targetTeamId', 'text', { notNull: true, codecRef: { codecId: 'pg/text@1' } }),
        ],
        constraints: [
          primaryKey(['id']),
          checkExpression('shot_phase_check_808a095a', "\"phase\" IN ('DURING_WOD', 'POST_WOD')"),
        ],
      }),
      this.addColumn({
        schema: 'public',
        table: 'boatPlacement',
        column: col('shipId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'session',
        column: col('raceEndedAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-temporal@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('dateOfBirth', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-temporal@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('sex', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'refereeFleet',
        constraint: 'refereeFleet_sessionId_refereeId_slot_key',
        columns: ['sessionId', 'refereeId', 'slot'],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'session',
        constraint: 'session_wodType_check_b588abc4',
        expression: "\"wodType\" IN ('PYRAMIDE_CLASSIQUE', 'RELAIS_SPRINT', 'TOUCHE_COULE_HYROX')",
      }),
      this.addUnique({
        schema: 'public',
        table: 'shot',
        constraint: 'shot_evaluationId_key',
        columns: ['evaluationId'],
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'user',
        constraint: 'user_sex_check_3b7aee9e',
        expression: "\"sex\" IN ('M', 'F')",
      }),
      this.createIndex({
        schema: 'public',
        table: 'boatPlacement',
        index: 'boatPlacement_sessionId_teamId_exerciseId_idx_461b904c',
        columns: ['sessionId', 'teamId', 'exerciseId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'boatPlacement',
        index: 'boatPlacement_shipId_idx_526fd031',
        columns: ['shipId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'refereeFleet',
        index: 'refereeFleet_refereeId_idx_939405ab',
        columns: ['refereeId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'refereeFleet',
        index: 'refereeFleet_sessionId_idx_29f415d4',
        columns: ['sessionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'refereeShip',
        index: 'refereeShip_fleetId_idx_dce13b35',
        columns: ['fleetId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'shot',
        index: 'shot_refereeId_idx_939405ab',
        columns: ['refereeId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'shot',
        index: 'shot_sessionId_idx_29f415d4',
        columns: ['sessionId'],
      }),
      this.createIndex({
        schema: 'public',
        table: 'shot',
        index: 'shot_sessionId_targetTeamId_targetExerciseId_idx_15b01c93',
        columns: ['sessionId', 'targetTeamId', 'targetExerciseId'],
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'refereeFleet',
        foreignKey: {
          name: 'refereeFleet_sessionId_fkey',
          columns: ['sessionId'],
          references: { schema: 'public', table: 'session', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'refereeFleet',
        foreignKey: {
          name: 'refereeFleet_refereeId_fkey',
          columns: ['refereeId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'refereeShip',
        foreignKey: {
          name: 'refereeShip_fleetId_fkey',
          columns: ['fleetId'],
          references: { schema: 'public', table: 'refereeFleet', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'boatPlacement',
        foreignKey: {
          name: 'boatPlacement_shipId_fkey',
          columns: ['shipId'],
          references: { schema: 'public', table: 'refereeShip', columns: ['id'] },
          onDelete: 'cascade',
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'shot',
        foreignKey: {
          name: 'shot_sessionId_fkey',
          columns: ['sessionId'],
          references: { schema: 'public', table: 'session', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'shot',
        foreignKey: {
          name: 'shot_refereeId_fkey',
          columns: ['refereeId'],
          references: { schema: 'public', table: 'user', columns: ['id'] },
        },
      }),
      this.addForeignKey({
        schema: 'public',
        table: 'shot',
        foreignKey: {
          name: 'shot_evaluationId_fkey',
          columns: ['evaluationId'],
          references: { schema: 'public', table: 'evaluation', columns: ['id'] },
        },
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

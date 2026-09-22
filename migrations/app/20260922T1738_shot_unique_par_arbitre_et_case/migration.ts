#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/78cfb4ed7cbaef6830d133c0d792b1b3197b70f0f9224cd26f11525bb7552b16/contract';
import endContract from '../../snapshots/78cfb4ed7cbaef6830d133c0d792b1b3197b70f0f9224cd26f11525bb7552b16/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/81a7488538ec96c975a60b9fdb1783236a2f2e0148183680cbd5f0c0c85d910e/contract';
import startContract from '../../snapshots/81a7488538ec96c975a60b9fdb1783236a2f2e0148183680cbd5f0c0c85d910e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addUnique({
        schema: 'public',
        table: 'shot',
        constraint: 'shot_sessionId_refereeId_targetTeamId_targetExerciseId_key',
        columns: ['sessionId', 'refereeId', 'targetTeamId', 'targetExerciseId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

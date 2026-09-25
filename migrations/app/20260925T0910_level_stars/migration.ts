#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/aed1cfa0cde3582b755ad0c6a9365d58364e5a571922d998b49b2b9bf20326ce/contract';
import startContract from '../../snapshots/aed1cfa0cde3582b755ad0c6a9365d58364e5a571922d998b49b2b9bf20326ce/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/c9f50f1208dc970324e7760fd837bec74c744f3d164630a7979752483735b3fa/contract';
import endContract from '../../snapshots/c9f50f1208dc970324e7760fd837bec74c744f3d164630a7979752483735b3fa/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropConstraint({ schema: 'public', table: 'level', constraint: 'level_number_key' }),
      this.addColumn({
        schema: 'public',
        table: 'level',
        column: col('stars', 'int4', {
          notNull: true,
          default: lit(2),
          codecRef: { codecId: 'pg/int4@1' },
        }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'level',
        constraint: 'level_stars_number_key',
        columns: ['stars', 'number'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

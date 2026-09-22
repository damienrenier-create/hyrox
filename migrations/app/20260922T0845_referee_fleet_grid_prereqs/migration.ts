#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/13fb9bea21aa67b4f011575c4d26bf4f7e7463d24c942eca4c13a19bfbef6f18/contract';
import endContract from '../../snapshots/13fb9bea21aa67b4f011575c4d26bf4f7e7463d24c942eca4c13a19bfbef6f18/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/3bbccc508cc9470ec06b9f8f78d206cd2124afb3168e4becf68d3a27df044a19/contract';
import startContract from '../../snapshots/3bbccc508cc9470ec06b9f8f78d206cd2124afb3168e4becf68d3a27df044a19/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'session',
        column: col('refereeMode', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'team',
        column: col('order', 'int4', { codecRef: { codecId: 'pg/int4@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

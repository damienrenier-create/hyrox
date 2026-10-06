#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/864b824d82023cb1abb4efa2c6b97d84f92b6f2475f593d6b9d3d957439ceeaf/contract';
import endContract from '../../snapshots/864b824d82023cb1abb4efa2c6b97d84f92b6f2475f593d6b9d3d957439ceeaf/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/f107e9ce68352319522dfd7921e0cfa95c9573a5244e0290dea4dc63a17f9f0b/contract';
import startContract from '../../snapshots/f107e9ce68352319522dfd7921e0cfa95c9573a5244e0290dea4dc63a17f9f0b/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'yellowCard',
        column: col('givenById', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'yellowCard',
        column: col('reason', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/6cfc3e1b8915a792f17643ce6b4552db39555180deffccc568a74b7d7eb2b0e0/contract';
import endContract from '../../snapshots/6cfc3e1b8915a792f17643ce6b4552db39555180deffccc568a74b7d7eb2b0e0/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/e4a31a63c3326a10d030866be51514e4ceaee6fb15665f0c56653e3406838474/contract';
import startContract from '../../snapshots/e4a31a63c3326a10d030866be51514e4ceaee6fb15665f0c56653e3406838474/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('winterArcUntil', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-temporal@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

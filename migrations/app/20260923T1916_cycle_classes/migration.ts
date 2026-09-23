#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/5b30c5d232c4b5b6b8b23ed10c8ae0c7fb11cc2ad51a988e296e762d93fb5c9b/contract';
import startContract from '../../snapshots/5b30c5d232c4b5b6b8b23ed10c8ae0c7fb11cc2ad51a988e296e762d93fb5c9b/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/a8eaac01ec949473fec558985cff6f60d9021dd41596ec3c77f4cff9c07d8869/contract';
import endContract from '../../snapshots/a8eaac01ec949473fec558985cff6f60d9021dd41596ec3c77f4cff9c07d8869/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'cycle',
        column: col('classes', 'json', { codecRef: { codecId: 'pg/json@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

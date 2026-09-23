#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/2e1e20d2b6c2768d428e587093f9c35a7a1304d5a0811d712fc30478c518b09a/contract';
import startContract from '../../snapshots/2e1e20d2b6c2768d428e587093f9c35a7a1304d5a0811d712fc30478c518b09a/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/5b30c5d232c4b5b6b8b23ed10c8ae0c7fb11cc2ad51a988e296e762d93fb5c9b/contract';
import endContract from '../../snapshots/5b30c5d232c4b5b6b8b23ed10c8ae0c7fb11cc2ad51a988e296e762d93fb5c9b/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'classSlot',
        column: col('planId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'classSlot',
        column: col('teacherId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'session',
        column: col('teacherId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.createIndex({
        schema: 'public',
        table: 'classSlot',
        index: 'classSlot_teacherId_idx_bc266660',
        columns: ['teacherId'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

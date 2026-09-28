#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/2fa65ffa86c6ffc339b2333e640ab5faaa34a6fc6330218ce9fd307f6d3800ee/contract';
import startContract from '../../snapshots/2fa65ffa86c6ffc339b2333e640ab5faaa34a6fc6330218ce9fd307f6d3800ee/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/e4a31a63c3326a10d030866be51514e4ceaee6fb15665f0c56653e3406838474/contract';
import endContract from '../../snapshots/e4a31a63c3326a10d030866be51514e4ceaee6fb15665f0c56653e3406838474/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'evaluation',
        column: col('criteria', 'json', { codecRef: { codecId: 'pg/json@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

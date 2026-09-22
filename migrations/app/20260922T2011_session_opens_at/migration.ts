#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/78cfb4ed7cbaef6830d133c0d792b1b3197b70f0f9224cd26f11525bb7552b16/contract';
import startContract from '../../snapshots/78cfb4ed7cbaef6830d133c0d792b1b3197b70f0f9224cd26f11525bb7552b16/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/e4123148b359b337ab53aae7038cb945dd712252256961367fa22d67fa115857/contract';
import endContract from '../../snapshots/e4123148b359b337ab53aae7038cb945dd712252256961367fa22d67fa115857/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'session',
        column: col('opensAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-temporal@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/57e1f43e2241c4c243bc9eb139ad5b0878b4c09f8e59328d6157343e845b4fae/contract';
import endContract from '../../snapshots/57e1f43e2241c4c243bc9eb139ad5b0878b4c09f8e59328d6157343e845b4fae/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/864b824d82023cb1abb4efa2c6b97d84f92b6f2475f593d6b9d3d957439ceeaf/contract';
import startContract from '../../snapshots/864b824d82023cb1abb4efa2c6b97d84f92b6f2475f593d6b9d3d957439ceeaf/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'user',
        column: col('obsWatch', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

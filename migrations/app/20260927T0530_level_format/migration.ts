#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/c9f50f1208dc970324e7760fd837bec74c744f3d164630a7979752483735b3fa/contract';
import startContract from '../../snapshots/c9f50f1208dc970324e7760fd837bec74c744f3d164630a7979752483735b3fa/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f35c40d44fa29ead8e4bb486935fcd70482970a2186e0e459dc4f4ca5155e8c6/contract';
import endContract from '../../snapshots/f35c40d44fa29ead8e4bb486935fcd70482970a2186e0e459dc4f4ca5155e8c6/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropConstraint({
        schema: 'public',
        table: 'level',
        constraint: 'level_stars_number_key',
      }),
      this.addColumn({
        schema: 'public',
        table: 'level',
        column: col('format', 'text', {
          notNull: true,
          default: lit('big'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
      this.addUnique({
        schema: 'public',
        table: 'level',
        constraint: 'level_format_stars_number_key',
        columns: ['format', 'stars', 'number'],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/511442e7708747f7e4e0561a9318b1553d55a1318f5b0edf45439e56c2662006/contract';
import endContract from '../../snapshots/511442e7708747f7e4e0561a9318b1553d55a1318f5b0edf45439e56c2662006/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/d6a3b053608629407e645bf915a9cd6647ef82a224a6e066970236627fb54e3c/contract';
import startContract from '../../snapshots/d6a3b053608629407e645bf915a9cd6647ef82a224a6e066970236627fb54e3c/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'sessionReferee',
        column: col('decidedAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-temporal@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'sessionReferee',
        column: col('decidedBy', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'sessionReferee',
        column: col('status', 'text', {
          notNull: true,
          default: lit('APPROVED'),
          codecRef: { codecId: 'pg/text@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

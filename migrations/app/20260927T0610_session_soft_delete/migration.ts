#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/97cd79e33a98e3554d7f93b78be23a1378924f99bc1b85e919317496f05ab141/contract';
import endContract from '../../snapshots/97cd79e33a98e3554d7f93b78be23a1378924f99bc1b85e919317496f05ab141/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/f35c40d44fa29ead8e4bb486935fcd70482970a2186e0e459dc4f4ca5155e8c6/contract';
import startContract from '../../snapshots/f35c40d44fa29ead8e4bb486935fcd70482970a2186e0e459dc4f4ca5155e8c6/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'session',
        column: col('deletedAt', 'timestamptz', {
          codecRef: { codecId: 'pg/timestamptz-temporal@1' },
        }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'session',
        column: col('deletedBy', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

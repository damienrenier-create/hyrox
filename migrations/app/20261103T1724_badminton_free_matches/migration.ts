#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/26ae7a0fa6bf482b1620882508567aa6ee0328a62726d80bf239f20d802d84c5/contract';
import endContract from '../../snapshots/26ae7a0fa6bf482b1620882508567aa6ee0328a62726d80bf239f20d802d84c5/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/83b2afe40db4901196878621375e5e843223c86f7de25efff4fdbd2a3e535465/contract';
import startContract from '../../snapshots/83b2afe40db4901196878621375e5e843223c86f7de25efff4fdbd2a3e535465/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'badmintonEvent',
        column: col('targetId', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.dropNotNull({ schema: 'public', table: 'badmintonEvent', column: 'sessionId' }),
      this.dropNotNull({ schema: 'public', table: 'badmintonMatch', column: 'sessionId' }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

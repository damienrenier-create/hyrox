#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/2fa65ffa86c6ffc339b2333e640ab5faaa34a6fc6330218ce9fd307f6d3800ee/contract';
import endContract from '../../snapshots/2fa65ffa86c6ffc339b2333e640ab5faaa34a6fc6330218ce9fd307f6d3800ee/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/97cd79e33a98e3554d7f93b78be23a1378924f99bc1b85e919317496f05ab141/contract';
import startContract from '../../snapshots/97cd79e33a98e3554d7f93b78be23a1378924f99bc1b85e919317496f05ab141/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col, lit } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'levelLoss',
        column: col('soft', 'bool', {
          notNull: true,
          default: lit(false),
          codecRef: { codecId: 'pg/bool@1' },
        }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

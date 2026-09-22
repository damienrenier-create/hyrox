#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/1d79e4d946eaa3cb14d6e306b0f0fed626dbed67f8d22d8dadc95c30771cc312/contract';
import startContract from '../../snapshots/1d79e4d946eaa3cb14d6e306b0f0fed626dbed67f8d22d8dadc95c30771cc312/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/f2fb34c181b3f09f505bde58274900a7cb692cdcacfbe494b5c532f7be462961/contract';
import endContract from '../../snapshots/f2fb34c181b3f09f505bde58274900a7cb692cdcacfbe494b5c532f7be462961/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'refereeShip',
        column: col('direction', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

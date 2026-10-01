#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/6cfc3e1b8915a792f17643ce6b4552db39555180deffccc568a74b7d7eb2b0e0/contract';
import startContract from '../../snapshots/6cfc3e1b8915a792f17643ce6b4552db39555180deffccc568a74b7d7eb2b0e0/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/8a73f98ff5fecbcc47e9d0372301b587bb897daadfbca32934fa55895d8cc88e/contract';
import endContract from '../../snapshots/8a73f98ff5fecbcc47e9d0372301b587bb897daadfbca32934fa55895d8cc88e/contract.json' with { type: 'json' };
import { Migration, MigrationCLI, col } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.addColumn({
        schema: 'public',
        table: 'classSlot',
        column: col('sex', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addColumn({
        schema: 'public',
        table: 'classSlot',
        column: col('validFrom', 'text', { codecRef: { codecId: 'pg/text@1' } }),
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'classSlot',
        constraint: 'classSlot_sex_check_3b7aee9e',
        expression: "\"sex\" IN ('M', 'F')",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

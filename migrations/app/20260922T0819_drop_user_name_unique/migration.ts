#!/usr/bin/env -S node
import type { Contract as Start } from '../../snapshots/2faf416d736b01ccd8f82d6609a5bdbc0819fcf9239fbdc9c175585fa49ef11e/contract';
import startContract from '../../snapshots/2faf416d736b01ccd8f82d6609a5bdbc0819fcf9239fbdc9c175585fa49ef11e/contract.json' with { type: 'json' };
import type { Contract as End } from '../../snapshots/3bbccc508cc9470ec06b9f8f78d206cd2124afb3168e4becf68d3a27df044a19/contract';
import endContract from '../../snapshots/3bbccc508cc9470ec06b9f8f78d206cd2124afb3168e4becf68d3a27df044a19/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [this.dropConstraint({ schema: 'public', table: 'user', constraint: 'user_name_key' })];
  }
}

MigrationCLI.run(import.meta.url, M);

#!/usr/bin/env -S node
import type { Contract as End } from '../../snapshots/1674cab46e8a09d3931d55addaa0b36674613523f84da9afbf3b3b76dc4ed566/contract';
import endContract from '../../snapshots/1674cab46e8a09d3931d55addaa0b36674613523f84da9afbf3b3b76dc4ed566/contract.json' with { type: 'json' };
import type { Contract as Start } from '../../snapshots/57e1f43e2241c4c243bc9eb139ad5b0878b4c09f8e59328d6157343e845b4fae/contract';
import startContract from '../../snapshots/57e1f43e2241c4c243bc9eb139ad5b0878b4c09f8e59328d6157343e845b4fae/contract.json' with { type: 'json' };
import { Migration, MigrationCLI } from '@prisma/orm-postgres/migration';

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      this.dropCheckConstraint({
        schema: 'public',
        table: 'cyclePlan',
        constraint: 'cyclePlan_wodType_check_7c965a6d',
      }),
      this.dropCheckConstraint({
        schema: 'public',
        table: 'session',
        constraint: 'session_wodType_check_7c965a6d',
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'cyclePlan',
        constraint: 'cyclePlan_wodType_check_e729d788',
        expression:
          "\"wodType\" IN ('PYRAMIDE_CLASSIQUE', 'RELAIS_SPRINT', 'TOUCHE_COULE_HYROX', 'FETE_FORAINE', 'LEVEL', 'HYROX', 'AMRAP')",
      }),
      this.addCheckConstraint({
        schema: 'public',
        table: 'session',
        constraint: 'session_wodType_check_e729d788',
        expression:
          "\"wodType\" IN ('PYRAMIDE_CLASSIQUE', 'RELAIS_SPRINT', 'TOUCHE_COULE_HYROX', 'FETE_FORAINE', 'LEVEL', 'HYROX', 'AMRAP')",
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);

"use server";

import { getSession } from "@/lib/session-server";
import { buildPyramideRecords, type RecordFilters, type RecordsResult } from "@/lib/pyramide-records";

// Les records balaient TOUTES les seances Pyramide : on ne les calcule qu'a la demande, quand l'onglet
// est ouvert, jamais au rendu de la page greffier qui tourne pendant la course.
export async function pyramideRecordsAction(filters: RecordFilters): Promise<RecordsResult> {
  const user = await getSession();
  if (!user || !["MASTER_ADMIN", "ADMIN", "GREFFIER"].includes(user.role)) {
    return { boards: [], grades: [], teamsScanned: 0, sessionsScanned: 0 };
  }
  return buildPyramideRecords(filters);
}

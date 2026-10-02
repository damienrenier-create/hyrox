// Types et constantes de l'arbitrage du WOD Eval, partages par le serveur et les ecrans (module pur, sans base).

export const OBS_MINUTES = 5; // duree d'une observation d'arbitre eleve
export const OBS_GRACE_MS = 20_000; // la derniere serie peut etre tapee juste apres la sonnerie
export const OBS_TOLERANCE_MS = 60_000; // ecart tolere entre l'heure d'une serie et les clics du greffier
export const OBS_STAFF_TARGET = 3; // objectif prof : chaque eleve evalue sur 3 exercices differents au moins
export type ObsMode = "STUDENT" | "STAFF";

export type ObsStation = { id: string; label: string; criteria: string[] };
export type ObsEntry = { id: string; exerciseId: string; reps: number; atMs: number; voided: boolean };
export type ObsApp = { exerciseId: string; labels: string[]; met: boolean[]; note: number; code: string | null };
export type ObsView = {
  id: string;
  mode: ObsMode;
  targetId: string;
  targetName: string;
  className: string | null;
  teamName: string;
  startedAtMs: number;
  endsAtMs: number | null; // eleve arbitre : fin des 5 minutes
  endedAtMs: number | null;
  entries: ObsEntry[];
  apps: ObsApp[];
};
export type ObsParticipant = { userId: string; name: string; sortName: string; className: string | null; teamId: string; teamName: string; teamOrder: number };

// ===== Compte rendu =====
export type ReportEntry = {
  id: string;
  reps: number;
  atMs: number;
  clock: string; // heure de Bruxelles HH:MM:SS
  raceAt: string | null; // temps de course ecoule
  voided: boolean;
  match: "ok" | "off" | "na"; // concorde avec les clics du greffier / ne concorde pas / non verifiable
  where: string | null; // si ca ne concorde pas : ou le greffier situait l'equipe a cette heure
};
// Passage de l'equipe a une station d'apres les clics du greffier : de la validation precedente (from) a celle de la
// station (to ; null = station en cours, pas encore validee). Heures de Bruxelles HH:MM:SS.
export type GreffierPass = { lap: number; from: string | null; to: string | null };
export type ReportGroup = { exerciseId: string; label: string; entries: ReportEntry[]; total: number; greffier: GreffierPass[]; app: { code: string | null; met: number; total: number; unmet: string[] } | null };
export type ReportObs = {
  id: string;
  mode: ObsMode;
  evaluatorId: string;
  evaluatorName: string;
  targetId: string;
  targetName: string;
  className: string | null;
  teamName: string;
  teamOrder: number;
  startedAtMs: number;
  clock: string;
  groups: ReportGroup[];
};
export type ObsReport = {
  observations: ReportObs[];
  referees: { id: string; name: string; mode: ObsMode; observations: number; entries: number; matched: number; off: number }[];
  students: { userId: string; name: string; className: string | null; teamName: string; staffExercises: number; observations: number }[];
  toleranceS: number;
  minutes: number;
};

// « tour 1 : 09:12:05 → 09:15:40 · tour 2 : en cours depuis 09:31:02 » : la station vue par le greffier.
export const greffierText = (passes: GreffierPass[]): string =>
  passes.map((p) => `tour ${p.lap} : ${p.to ? `${p.from ?? "?"} → ${p.to}` : `en cours depuis ${p.from ?? "?"}`}`).join(" · ");

// Export CSV du compte rendu : une ligne par serie, avec son heure et sa concordance.
export function obsCsv(r: ObsReport): string {
  const L: string[] = [];
  L.push(["Eleve", "Classe", "Equipe", "Arbitre", "Type", "Debut observation", "Exercice", "Reps", "Heure", "Temps de course", "Annulee", "Concordance greffier", "Greffier situait l'equipe a", "Station d'apres le greffier", "Appreciation", "Criteres"].join(";"));
  for (const o of r.observations) {
    for (const g of o.groups) {
      const app = g.app ? [g.app.code ?? "", `${g.app.met}/${g.app.total}`] : ["", ""];
      const pass = greffierText(g.greffier);
      if (!g.entries.length) L.push([o.targetName, o.className ?? "", o.teamName, o.evaluatorName, o.mode === "STAFF" ? "prof" : "eleve", o.clock, g.label, "", "", "", "", "", "", pass, ...app].join(";"));
      for (const e of g.entries) {
        L.push([o.targetName, o.className ?? "", o.teamName, o.evaluatorName, o.mode === "STAFF" ? "prof" : "eleve", o.clock, g.label, e.reps, e.clock, e.raceAt ?? "", e.voided ? "oui" : "", e.voided ? "" : e.match === "ok" ? "oui" : e.match === "off" ? "NON" : "non verifiable", e.where ?? "", pass, ...app].join(";"));
      }
    }
  }
  return "﻿" + L.join("\r\n");
}

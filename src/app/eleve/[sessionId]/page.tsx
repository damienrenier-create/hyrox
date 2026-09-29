import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { db } from "@/lib/db";
import { buildSessionStandings } from "@/lib/session-standings";
import { exercisesFor } from "@/lib/session-exercises";
import { qualityCodeFromValue } from "@/lib/wod-engines/core/quality";
import { SELF_EVAL_CRITERIA, SELF_EVAL_INSTRUCTION, selfEvalWindow } from "@/lib/wod-engines/core/self-eval";
import { wodLabel, fmtDate } from "@/lib/student-sessions";
import { toMs } from "@/lib/scheduling";
import { combinedTwinStandings } from "@/lib/level-combined";
import { listExercises } from "@/lib/level";
import { criteriaComment, isLiked, readCriteria } from "@/lib/level-criteria";
import { WodView, type ResultRow, type RefereeEvalRow } from "./WodView";
import { TopBar } from "../../_components/TopBar";
import { ui } from "@/lib/ui";

export default async function EleveSessionPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const user = await getSession();
  if (!user) redirect("/");
  if (user.role !== "STUDENT") redirect("/eleve");

  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session || session.deletedAt) redirect("/eleve");

  // Acces uniquement si l'eleve a ete encode (par identifiant) dans une equipe de cette seance.
  const teams = await db.orm.public.Team.where({ sessionId }).all();
  const memberships = await db.orm.public.TeamMember.where({ userId: user.id }).all();
  const myTeam = teams.find((t) => memberships.some((m) => m.teamId === t.id));
  if (!myTeam) redirect("/eleve");

  const teammatesRaw = await db.orm.public.TeamMember.where({ teamId: myTeam.id }).all();
  const teammates: string[] = [];
  for (const tm of teammatesRaw) {
    if (tm.userId === user.id) continue;
    const u = await db.orm.public.User.where({ id: tm.userId }).first();
    if (u) teammates.push(`${u.firstName ?? ""} ${u.lastName ?? ""}`.trim());
  }

  // Classement (Pyramide = tours, Fete Foraine = ateliers/score), meme calcul que le greffier.
  const stand = await buildSessionStandings(session);
  const ended = !!session.raceEndedAt;
  const results: ResultRow[] = stand.rows.map((r) => ({ ...r, mine: r.teamId === myTeam.id }));

  // Evaluations donnees par les arbitres sur MON equipe (anonymes pour l'eleve).
  const exercises = exercisesFor(session);
  const exerciseNumber: Record<string, number> = {};
  const exerciseLabels: Record<string, string> = {};
  for (const e of exercises) {
    exerciseNumber[e.id] = e.number;
    exerciseLabels[e.id] = e.label;
  }
  if (session.wodType === "LEVEL") for (const e of await listExercises()) { exerciseNumber[e.id] = 0; exerciseLabels[e.id] = e.label; }
  const evals = session.wodType === "LEVEL"
    ? await db.orm.public.Evaluation.where({ sessionId, targetUserId: user.id }).all()
    : await db.orm.public.Evaluation.where({ sessionId, teamId: myTeam.id }).all();
  const refereeEvals: RefereeEvalRow[] = evals
    .map((e) => ({
      exerciseId: e.exerciseId,
      exerciseNumber: exerciseNumber[e.exerciseId] ?? 0,
      exerciseLabel: exerciseLabels[e.exerciseId] ?? e.exerciseId,
      reps: e.repsObserved,
      quality: qualityCodeFromValue(e.note),
      comment: (() => { const c = readCriteria((e as { criteria?: unknown }).criteria); return c ? criteriaComment(exerciseLabels[e.exerciseId] ?? "", c, isLiked(e.note, c)) : null; })(),
      at: new Date(String(e.createdAt)).getTime(),
    }))
    .sort((a, b) => a.exerciseNumber - b.exerciseNumber || a.at - b.at);

  // Fenetre d'auto-evaluation : 24h a partir de l'arrivee de l'equipe (sinon de la fin officielle du WOD).
  const finishedAt = stand.finishedAtMs[myTeam.id] ?? null;
  const raceEndedAtMs = session.raceEndedAt ? new Date(String(session.raceEndedAt)).getTime() : null;
  const win = selfEvalWindow(finishedAt, raceEndedAtMs);
  const existing = await db.orm.public.SelfEvaluation.where({ sessionId, studentId: user.id }).first();
  // Avis du prof : l'eleve n'en voit que ce que le prof a explicitement rendu visible (grille et commentaire, separement).
  const rev = await db.orm.public.SelfEvalReview.where({ sessionId, studentId: user.id }).first();
  const review =
    rev && (rev.visible || (rev.commentVisible && rev.comment))
      ? {
          answers: rev.visible ? ((rev.answers as Record<string, string>) ?? {}) : null,
          comment: rev.commentVisible && rev.comment ? rev.comment : null,
          reviewerName: rev.reviewerName,
        }
      : null;

  // Records de CE WOD (Sartay 29/09 nuit) : tous les eleves, ou seulement ceux de ma classe.
  const recordsWod = session.wodType === "LEVEL" ? "level" : session.wodType === "PYRAMIDE_CLASSIQUE" ? "pyramide" : null;
  const records = recordsWod ? { all: `/eleve/records?wod=${recordsWod}`, mine: user.className ? `/eleve/records?wod=${recordsWod}&classe=1` : null, className: user.className ?? null } : null;
  const rs = await db.orm.public.RaceState.where({ sessionId }).first();
  // Ecrans jumeaux (29/09 nuit) : classement combine des ecrans dont le WOD est termine.
  const comb = session.wodType === "LEVEL" && ended ? await combinedTwinStandings(sessionId) : null;
  const combined = comb && comb.rows.length ? { pending: comb.pending, rows: comb.rows.map((r) => ({ rank: r.rank, teamName: r.teamName, screen: r.screen, points: r.points, levels: r.levels, mine: r.teamId === myTeam.id })) } : null;
  const dateMs = rs?.startedAt ? toMs(rs.startedAt) : session.opensAt ? toMs(session.opensAt) : toMs(session.createdAt);

  return (
    <div className={ui.page}>
      <TopBar
        brand={false}
        back={{ href: "/eleve", label: "Retour" }}
        title={wodLabel(session.wodType)}
        subtitle={<>{fmtDate(new Date(dateMs).toISOString())} · {myTeam.name}{teammates.length > 0 && <> · avec {teammates.join(", ")}</>}</>}
      />

      <main className="max-w-2xl mx-auto p-4">
        <WodView
          sessionId={sessionId}
          ended={ended}
          myTeamName={myTeam.name}
          columns={stand.columns}
          results={results}
          refereeEvals={refereeEvals}
          criteria={SELF_EVAL_CRITERIA}
          instruction={SELF_EVAL_INSTRUCTION}
          selfEval={{
            initial: existing ? (existing.answers as Record<string, string>) : null,
            state: win.isOpen ? "open" : win.notYet ? "notYet" : "expired",
            closesAt: win.closesAt,
            submittedAt: existing ? new Date(String(existing.submittedAt)).getTime() : null,
          }}
          review={review}
          individual={session.wodType === "LEVEL"}
          records={records}
          combined={combined}
        />
      </main>
    </div>
  );
}

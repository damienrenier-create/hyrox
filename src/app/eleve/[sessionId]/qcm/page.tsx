import { redirect } from "next/navigation";
import { getSession } from "@/lib/session-server";
import { db } from "@/lib/db";
import { readQuizOpen } from "@/lib/session-roles";
import { buildQuiz, quizSeed } from "@/lib/hyrox-quiz";
import { wodLabel, fmtDate } from "@/lib/student-sessions";
import { TopBar } from "../../../_components/TopBar";
import { QuizClient } from "./QuizClient";
import { ui } from "@/lib/ui";

// QCM bonus du WOD Hyrox, sur le telephone de l'eleve : visible quand le prof l'a ouvert (console), une seule tentative,
// correction affichee ensuite. Le tirage depend de (seance, eleve) : chacun son QCM.
export default async function QuizPage({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await params;
  const user = await getSession();
  if (!user) redirect("/");
  if (user.role !== "STUDENT") redirect("/eleve");
  const session = await db.orm.public.Session.where({ id: sessionId }).first();
  if (!session || session.deletedAt || session.wodType !== "HYROX") redirect("/eleve");
  const teams = await db.orm.public.Team.where({ sessionId }).all();
  const memberships = await db.orm.public.TeamMember.where({ userId: user.id }).all();
  if (!teams.some((t) => memberships.some((m) => m.teamId === t.id))) redirect("/eleve");

  const open = readQuizOpen(session.settings);
  const existing = await db.orm.public.QuizAnswer.where({ sessionId, studentId: user.id }).first();
  const { questions, key } = buildQuiz(quizSeed(sessionId, user.id));

  return (
    <div className={ui.page}>
      <TopBar brand={false} back={{ href: `/eleve/${sessionId}`, label: "Retour" }} title="📝 QCM bonus" subtitle={`${wodLabel(session.wodType)} · ${fmtDate(session.createdAt)}`} />
      <main className="max-w-2xl mx-auto p-4">
        {existing ? (
          <QuizClient sessionId={sessionId} questions={questions} result={{ checked: existing.answers as Record<string, string[]>, key, score: existing.score, total: existing.total, at: new Date(String(existing.createdAt)).getTime() }} />
        ) : !open ? (
          <p className={`${ui.cardPad} ${ui.muted}`}>Le QCM n&apos;est pas ouvert pour l&apos;instant. Ton prof l&apos;ouvre depuis sa console ; reviens ici ensuite.</p>
        ) : (
          <QuizClient sessionId={sessionId} questions={questions} result={null} />
        )}
      </main>
    </div>
  );
}

import { db } from "./src/lib/db";

async function run() {
  try {
    console.log("Fermeture...");
    await db.orm.public.Session.where({ isActive: true }).update({ isActive: false });
    
    console.log("Transaction...");
    await db.transaction(async (tx) => {
      const newSession = await tx.orm.public.Session.create({
        wodType: "PYRAMIDE_CLASSIQUE",
        isActive: true,
      });
      console.log("Session créée:", newSession.id);

      const teams = Array.from({ length: 2 }).map((_, i) => ({
        name: `Équipe ${i + 1}`,
        sessionId: newSession.id,
      }));

      for (const team of teams) {
        await tx.orm.public.Team.create(team);
      }
      console.log("Équipes créées");
    });
    
    console.log("Success");
  } catch(e) {
    console.error("Error!", e);
  } finally {
    await db.close();
  }
}
run();

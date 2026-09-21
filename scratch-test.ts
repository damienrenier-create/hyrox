import 'dotenv/config';
import { db } from './src/lib/db';

async function test() {
  console.log("Starting test...");
  try {
    const numTeams = 5;

    console.log("1. Update old sessions...");
    // Try catching if where().update() throws when nothing matches
    await db.orm.public.Session.where({ isActive: true }).update({ isActive: false });
    
    console.log("2. Starting transaction...");
    await db.transaction(async (tx) => {
      console.log("3. Creating session...");
      const newSession = await tx.orm.public.Session.create({
        wodType: "PYRAMIDE_CLASSIQUE",
        isActive: true,
        settings: { numTeams }
      });
      console.log("Created session:", newSession.id);

      const teams = Array.from({ length: numTeams }).map((_, i) => ({
        name: `Équipe ${i + 1}`,
        sessionId: newSession.id,
      }));

      console.log("4. Creating teams...");
      for (const team of teams) {
        await tx.orm.public.Team.create(team);
      }
      console.log("Created teams.");
    });

    console.log("Test success!");
  } catch (e) {
    console.error("Test failed:", e);
  } finally {
    process.exit(0);
  }
}

test();

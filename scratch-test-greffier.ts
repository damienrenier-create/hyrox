import 'dotenv/config';
import { db } from './src/lib/db';

async function test() {
  try {
    const session = await db.orm.public.Session.where({ isActive: true })
      .include('teams', (t) => t.include('members', (m) => m.include('user')))
      .first();
    console.log("Session query result:", session ? "Found" : "Not Found");
  } catch (e) {
    console.error("Session query failed:", e);
  } finally {
    process.exit(0);
  }
}
test();

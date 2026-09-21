import 'dotenv/config';
import { db } from './src/lib/db';

async function test() {
  try {
    const res = await db.orm.public.Session.where({ isActive: true }).update({ isActive: false });
    console.log("Update result:", res);
  } catch (e) {
    console.error("Update failed:", e);
  } finally {
    process.exit(0);
  }
}
test();

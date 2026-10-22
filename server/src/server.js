import 'dotenv/config';
import { app } from './app.js';
import { readData } from './storage.js';
import { purgeExpiredEvents } from './events.js';
const port = Number(process.env.PORT || 4000);
try {
  const [members] = await Promise.all(['members','events','activity'].map(readData));
  if (members.length !== 6 || members.some(m => !m.id || !m.username || !m.passwordHash || !m.displayName)) throw new Error('Member data must contain exactly six valid records.');
  if (!process.env.COOKIE_SECRET || process.env.COOKIE_SECRET.length < 32) throw new Error('COOKIE_SECRET must be configured with at least 32 characters.');
  await purgeExpiredEvents();
  setInterval(() => purgeExpiredEvents().catch(() => console.error('Unable to remove expired events.')), 60 * 60 * 1000).unref();
  app.listen(port, () => console.log(`Bhandara Connect API listening on ${port}`));
} catch (error) { console.error('Storage validation failed; server was not started.'); process.exitCode = 1; }

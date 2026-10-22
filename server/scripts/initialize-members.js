import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { readData, writeData } from '../src/storage.js';
const existing = await readData('members');
const syncExisting = process.argv.includes('--sync');
if (existing.length && !syncExisting) throw new Error('Members already exist; refusing to overwrite credentials. Use the explicit sync:members command to apply .env account changes.');
if (syncExisting && existing.length !== 6) throw new Error('Cannot sync accounts: expected exactly six existing members.');
const members = syncExisting ? [...existing] : [];
const configured = [];
const configErrors = [];
for (let i = 1; i <= 6; i++) {
  const username = process.env[`MEMBER_${i}_USERNAME`];
  const password = process.env[`MEMBER_${i}_PASSWORD`];
  const displayName = process.env[`MEMBER_${i}_DISPLAY_NAME`];
  if (!username) configErrors.push(`MEMBER_${i}_USERNAME is missing`);
  if (!displayName) configErrors.push(`MEMBER_${i}_DISPLAY_NAME is missing`);
  const passwordTooShort = !password || password.length < (syncExisting ? 1 : 12);
  if (passwordTooShort) configErrors.push(syncExisting ? `MEMBER_${i}_PASSWORD is missing` : `MEMBER_${i}_PASSWORD must be at least 12 characters`);
  if (!username || !displayName || passwordTooShort) continue;
  configured.push({ username, password, displayName });
}
if (configErrors.length) throw new Error(`Invalid member configuration: ${configErrors.join('; ')}.`);
if (new Set(configured.map(m => m.username)).size !== 6) throw new Error('Member usernames must be unique.');
for (let i = 0; i < configured.length; i++) {
  const { username, password, displayName } = configured[i];
  if (!syncExisting) {
    members.push({ id: randomUUID(), username, passwordHash: await bcrypt.hash(password, 12), displayName, profileImage: '', sessionVersion: 0, createdAt: new Date().toISOString() });
    continue;
  }
  const member = members[i];
  const passwordChanged = !(await bcrypt.compare(password, member.passwordHash));
  member.username = username;
  member.displayName = displayName;
  if (passwordChanged) {
    member.passwordHash = await bcrypt.hash(password, 12);
    member.sessionVersion = (member.sessionVersion || 0) + 1;
  }
}
await writeData('members', members);
console.log(syncExisting ? 'Updated six member accounts from .env. Credentials were not printed.' : 'Initialized six member accounts. Credentials were not printed.');

import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { readData, writeData, serialized } from './storage.js';
import { mutateEvent, purgeExpiredEvents } from './events.js';
const secret = process.env.COOKIE_SECRET;
const secure = process.env.COOKIE_SECURE === 'true';
const safe = ({ id, username, displayName, profileImage, createdAt }) => ({ id, username, displayName, profileImage, createdAt });
export const app = express();
app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173', credentials: true }));
app.use(express.json({ limit: '100kb' })); app.use(cookieParser());
const auth = async (req, res, next) => {
  try {
    if (!secret) return res.status(503).json({ success: false, message: 'Authentication is not configured' });
    const token = req.cookies.bc_session;
    const decoded = jwt.verify(token || '', secret, { algorithms: ['HS256'] });
    const member = (await readData('members')).find(m => m.id === decoded.sub);
    if (!member || (decoded.ver ?? 0) !== (member.sessionVersion ?? 0)) return res.status(401).json({ success: false, message: 'Please log in' });
    req.member = member; next();
  } catch { res.status(401).json({ success: false, message: 'Please log in' }); }
};
const loginLimit = rateLimit({ windowMs: 15 * 60_000, limit: process.env.NODE_ENV === 'test' ? 200 : 10, standardHeaders: true, legacyHeaders: false });
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const response = (res, data, message = '') => res.json({ success: true, message, data });
app.get('/api/health', (_req, res) => response(res, { ok: true }));
app.get('/api/members', wrap(async (_req, res) => response(res, (await readData('members')).map(({ displayName, profileImage }) => ({ displayName, profileImage })))));
app.post('/api/auth/login', loginLimit, wrap(async (req, res) => {
  if (!secret) return res.status(503).json({ success: false, message: 'Authentication is not configured' });
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string') return res.status(400).json({ success: false, message: 'Username and password are required' });
  const member = (await readData('members')).find(m => m.username === username);
  if (!member || !(await bcrypt.compare(password, member.passwordHash))) return res.status(401).json({ success: false, message: 'Incorrect username or password' });
  const token = jwt.sign({ ver: member.sessionVersion ?? 0 }, secret, { subject: member.id, expiresIn: '8h', algorithm: 'HS256' });
  res.cookie('bc_session', token, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 8 * 3600_000 }); response(res, safe(member), 'Logged in');
}));
app.post('/api/auth/logout', wrap(async (req, res) => {
  try {
    const decoded = jwt.verify(req.cookies.bc_session || '', secret || '', { algorithms: ['HS256'] });
    await serialized('members', async () => { const list = await readData('members'); const member = list.find(m => m.id === decoded.sub); if (member) { member.sessionVersion = (member.sessionVersion || 0) + 1; await writeData('members', list); } });
  } catch {}
  res.clearCookie('bc_session', { httpOnly: true, secure, sameSite: 'lax', path: '/' }); response(res, null, 'Logged out');
}));
app.get('/api/auth/me', auth, (req, res) => response(res, safe(req.member)));
app.patch('/api/auth/profile', auth, wrap(async (req, res) => {
  const name = typeof req.body?.displayName === 'string' ? req.body.displayName.trim() : '';
  if (name.length < 2 || name.length > 80) return res.status(400).json({ success: false, message: 'Display name must be 2 to 80 characters' });
  const member = await serialized('members', async () => { const list = await readData('members'); const m = list.find(x => x.id === req.member.id); m.displayName = name; await writeData('members', list); return m; }); response(res, safe(member), 'Profile updated');
}));
app.patch('/api/auth/change-password', auth, wrap(async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  if (typeof newPassword !== 'string' || newPassword.length < 12 || newPassword.length > 128) return res.status(400).json({ success: false, message: 'New password must be 12 to 128 characters' });
  if (typeof currentPassword !== 'string' || !(await bcrypt.compare(currentPassword, req.member.passwordHash))) return res.status(400).json({ success: false, message: 'Current password is incorrect' });
  await serialized('members', async () => { const list = await readData('members'); const m = list.find(x => x.id === req.member.id); m.passwordHash = await bcrypt.hash(newPassword, 12); m.sessionVersion = (m.sessionVersion || 0) + 1; await writeData('members', list); }); res.clearCookie('bc_session', { httpOnly: true, secure, sameSite: 'lax', path: '/' }); response(res, null, 'Password changed. Please log in again.');
}));
const eventView = (e, members) => ({ id:e.id,title:e.title,shortDescription:e.shortDescription,description:e.description,date:e.date,startTime:e.startTime,endTime:e.endTime,venue:e.venue,address:e.address,city:e.city,mapsUrl:e.mapsUrl,imageUrl:e.imageUrl,createdAt:e.createdAt,updatedAt:e.updatedAt,organizer:members.find(m=>m.id===e.createdByMemberId)?.displayName||'Community member' });
app.get('/api/events', wrap(async (_req, res) => { await purgeExpiredEvents(); const members = await readData('members'); const events = (await readData('events')).filter(e => !e.archivedAt).sort((a,b) => `${a.date}T${a.startTime || '00:00'}`.localeCompare(`${b.date}T${b.startTime || '00:00'}`)).slice(0,6).map(e => eventView(e,members)); response(res, events); }));
app.get('/api/events/archive', auth, wrap(async (_req,res) => { await purgeExpiredEvents(); response(res, (await readData('events')).filter(e => e.archivedAt)); }));
app.get('/api/events/:id', wrap(async (req,res) => { await purgeExpiredEvents(); const e = (await readData('events')).find(x => x.id === req.params.id && !x.archivedAt); if (!e) return res.status(404).json({ success:false,message:'Event not found' }); response(res,eventView(e,await readData('members'))); }));
app.get('/api/dashboard/events', auth, wrap(async (_req,res) => { await purgeExpiredEvents(); response(res,(await readData('events')).map(e=>e)); }));
app.get('/api/activity', auth, wrap(async (_req,res) => response(res,await readData('activity'))));
app.post('/api/events', auth, wrap(async (req,res) => response(res,await mutateEvent('create',null,req.body,req.member),'Event created')));
app.patch('/api/events/:id', auth, wrap(async (req,res) => response(res,await mutateEvent('edit',req.params.id,req.body,req.member),'Event updated')));
for (const action of ['archive','restore']) app.post(`/api/events/:id/${action}`,auth,wrap(async(req,res)=>response(res,await mutateEvent(action,req.params.id,null,req.member),`Event ${action}d`)));
app.delete('/api/events/:id',auth,wrap(async(req,res)=>response(res,await mutateEvent('delete',req.params.id,null,req.member),'Event deleted')));
app.use((err,_req,res,_next) => { const status = err.status || 500; if (status >= 500) console.error('Request failed'); res.status(status).json({ success:false,message:status >= 500 ? 'A server error occurred' : err.message }); });

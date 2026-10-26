import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { readData, writeData, serialized } from './storage.js';
import { commissionUtrInput, eventInput, privateJobInput, privateSignupInput } from './validation.js';
import { mutateEvent } from './events.js';
import { getMetrics, heartbeat, recordVisit } from './metrics.js';
const secret = process.env.COOKIE_SECRET;
const secure = process.env.COOKIE_SECURE === 'true';
const privateCookie = 'bc_private_session';
const privateGateCookie = 'bc_private_gate';
const privateGatePassword = process.env.PRIVATE_EVENTS_PASSWORD;
const privateCommissionInr = 50;
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
const privateAuth = async (req, res, next) => {
  try {
    if (!secret) return res.status(503).json({ success: false, message: 'Authentication is not configured' });
    const decoded = jwt.verify(req.cookies[privateCookie] || '', secret, { algorithms: ['HS256'] });
    const account = (await readData('privateAccounts')).find(item => item.id === decoded.sub);
    if (!account || (decoded.ver ?? 0) !== (account.sessionVersion ?? 0)) return res.status(401).json({ success: false, message: 'Please sign in to Private Events' });
    req.privateAccount = account;
    next();
  } catch { res.status(401).json({ success: false, message: 'Please sign in to Private Events' }); }
};
const privateRole = role => (req, res, next) => req.privateAccount?.role === role
  ? next()
  : res.status(403).json({ success: false, message: `${role === 'hirer' ? 'Hirer' : 'Worker'} account required` });
const safePrivateAccount = ({ passwordHash, sessionVersion, ...account }) => account;
const privateToken = account => jwt.sign({ ver: account.sessionVersion ?? 0 }, secret, { subject: account.id, expiresIn: '8h', algorithm: 'HS256' });
const setPrivateCookie = (res, account) => res.cookie(privateCookie, privateToken(account), { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: 8 * 3600_000 });
const loginLimit = rateLimit({ windowMs: 15 * 60_000, limit: process.env.NODE_ENV === 'test' ? 200 : 10, standardHeaders: true, legacyHeaders: false });
const requestLimit = rateLimit({ windowMs: 15 * 60_000, limit: process.env.NODE_ENV === 'test' ? 200 : 10, standardHeaders: true, legacyHeaders: false });
const privateAuthLimit = rateLimit({ windowMs: 15 * 60_000, limit: process.env.NODE_ENV === 'test' ? 200 : 10, standardHeaders: true, legacyHeaders: false });
const privateGateLimit = rateLimit({ windowMs: 15 * 60_000, limit: process.env.NODE_ENV === 'test' ? 200 : 5, standardHeaders: true, legacyHeaders: false });
const wrap = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const response = (res, data, message = '') => res.json({ success: true, message, data });
app.get('/api/health', (_req, res) => response(res, { ok: true }));
const validVisitorId = value => typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value);
app.get('/api/metrics', wrap(async (_req, res) => response(res, await getMetrics())));
app.post('/api/metrics/visit', wrap(async (req, res) => {
  const visitorId = req.body?.visitorId;
  if (!validVisitorId(visitorId)) return res.status(400).json({ success: false, message: 'A valid visitor ID is required' });
  await recordVisit(visitorId);
  await heartbeat(visitorId);
  response(res, null);
}));
app.post('/api/metrics/heartbeat', wrap(async (req, res) => {
  const visitorId = req.body?.visitorId;
  if (!validVisitorId(visitorId)) return res.status(400).json({ success: false, message: 'A valid visitor ID is required' });
  await heartbeat(visitorId);
  response(res, null);
}));
const validPrivateGate = req => {
  try {
    const decoded = jwt.verify(req.cookies[privateGateCookie] || '', secret || '', { algorithms: ['HS256'] });
    return decoded.access === 'private-events';
  } catch { return false; }
};
app.get('/api/private/gate', (req, res) => response(res, { unlocked: validPrivateGate(req) }));
app.post('/api/private/gate', privateGateLimit, (req, res) => {
  if (!secret) return res.status(503).json({ success: false, message: 'Authentication is not configured' });
  if (!privateGatePassword) return res.status(503).json({ success: false, message: 'Private Events access password is not configured on the server' });
  const submitted = typeof req.body?.password === 'string' ? Buffer.from(req.body.password) : Buffer.alloc(0);
  const expected = Buffer.from(privateGatePassword);
  if (submitted.length !== expected.length || !timingSafeEqual(submitted, expected)) return res.status(401).json({ success: false, message: 'Incorrect Private Events password' });
  const token = jwt.sign({ access: 'private-events' }, secret, { expiresIn: '12h', algorithm: 'HS256' });
  res.cookie(privateGateCookie, token, { httpOnly: true, secure, sameSite: 'lax', path: '/api/private', maxAge: 12 * 3600_000 });
  response(res, { unlocked: true }, 'Private Events unlocked');
});
app.use('/api/private', (req, res, next) => {
  if (process.env.NODE_ENV === 'test' || validPrivateGate(req)) return next();
  res.status(403).json({ success: false, message: 'Enter the Private Events access password to continue' });
});
app.post('/api/requests', requestLimit, wrap(async (req, res) => {
  const parsed = eventInput.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: parsed.error.issues[0].message });
  const today = new Date().toLocaleDateString('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' });
  if (parsed.data.date < today) return res.status(400).json({ success: false, message: 'Choose a future date for the Bhandara request' });
  const request = { id: randomUUID(), ...parsed.data, submittedAt: new Date().toISOString(), status: 'pending' };
  await serialized('requests', async () => {
    const requests = await readData('requests');
    requests.unshift(request);
    await writeData('requests', requests);
  });
  response(res, { id: request.id }, 'Request submitted for member review');
}));
app.get('/api/members', wrap(async (_req, res) => response(res, (await readData('members')).map(({ displayName, profileImage }) => ({ displayName, profileImage })))));
app.post('/api/private/auth/signup', privateAuthLimit, wrap(async (req, res) => {
  if (!secret) return res.status(503).json({ success: false, message: 'Authentication is not configured' });
  const parsed = privateSignupInput.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ success: false, message: parsed.error.issues[0].message });
  const { password, locationConsent, latitude, longitude, ...profile } = parsed.data;
  const account = {
    id: randomUUID(), ...profile,
    ...(latitude == null ? {} : { latitude: Number(latitude.toFixed(2)), longitude: Number(longitude.toFixed(2)) }),
    passwordHash: await bcrypt.hash(password, 12), sessionVersion: 0,
    available: profile.role === 'worker', locationConsentAt: locationConsent ? new Date().toISOString() : null, createdAt: new Date().toISOString()
  };
  await serialized('privateAccounts', async () => {
    const accounts = await readData('privateAccounts');
    if (accounts.some(item => item.email === account.email)) {
      const error = new Error('An account with this email already exists'); error.status = 409; throw error;
    }
    accounts.push(account);
    await writeData('privateAccounts', accounts);
  });
  setPrivateCookie(res, account);
  response(res, safePrivateAccount(account), 'Account created');
}));
app.post('/api/private/auth/login', privateAuthLimit, wrap(async (req, res) => {
  if (!secret) return res.status(503).json({ success: false, message: 'Authentication is not configured' });
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  const password = req.body?.password;
  if (!email || typeof password !== 'string') return res.status(400).json({ success: false, message: 'Email and password are required' });
  const account = (await readData('privateAccounts')).find(item => item.email === email);
  if (!account || !(await bcrypt.compare(password, account.passwordHash))) return res.status(401).json({ success: false, message: 'Incorrect email or password' });
  setPrivateCookie(res, account);
  response(res, safePrivateAccount(account), 'Signed in');
}));
app.get('/api/private/auth/me', privateAuth, (req, res) => response(res, safePrivateAccount(req.privateAccount)));
app.post('/api/private/auth/logout', privateAuth, wrap(async (req, res) => {
  await serialized('privateAccounts', async () => {
    const accounts = await readData('privateAccounts');
    const account = accounts.find(item => item.id === req.privateAccount.id);
    if (account) { account.sessionVersion = (account.sessionVersion || 0) + 1; await writeData('privateAccounts', accounts); }
  });
  res.clearCookie(privateCookie, { httpOnly: true, secure, sameSite: 'lax', path: '/' });
  response(res, null, 'Signed out');
}));
const todayLocal = () => new Date().toLocaleDateString('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' });
app.get('/api/private/jobs', wrap(async (_req, res) => {
  const [jobs, accounts] = await Promise.all([readData('privateJobs'), readData('privateAccounts')]);
  const data = jobs.filter(job => job.status === 'open' && job.date >= todayLocal())
    .sort((a, b) => `${a.date}T${a.startTime || '00:00'}`.localeCompare(`${b.date}T${b.startTime || '00:00'}`))
    .map(job => ({ ...job, hirerName: accounts.find(account => account.id === job.hirerId)?.organizationName || 'Event organizer' }));
  response(res, data);
}));
app.post('/api/private/jobs', privateAuth, privateRole('hirer'), wrap(async (req, res) => {
  if (req.body?.termsAccepted !== true) return res.status(400).json({ success: false, message: 'Accept the hiring terms before posting this event' });
  const parsed = privateJobInput.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ success: false, message: parsed.error.issues[0].message });
  if (parsed.data.date < todayLocal()) return res.status(400).json({ success: false, message: 'Choose a future date for this event' });
  const { latitude, longitude, ...details } = parsed.data;
  const job = { id: randomUUID(), ...details, hirerId: req.privateAccount.id, hirerName: req.privateAccount.organizationName, latitude, longitude, termsAcceptedAt: new Date().toISOString(), termsVersion: 'private-work-v1', status: 'open', createdAt: new Date().toISOString() };
  await serialized('privateJobs', async () => { const jobs = await readData('privateJobs'); jobs.unshift(job); await writeData('privateJobs', jobs); });
  response(res, job, 'Hiring event posted');
}));
app.get('/api/private/jobs/mine', privateAuth, privateRole('hirer'), wrap(async (req, res) => {
  const [jobs, applications] = await Promise.all([readData('privateJobs'), readData('privateApplications')]);
  response(res, jobs.filter(job => job.hirerId === req.privateAccount.id).map(job => {
    const related = applications.filter(application => application.jobId === job.id);
    return { ...job, applicationCount: related.length, hiredCount: related.filter(application => application.status === 'hired').length, pendingCount: related.filter(application => application.status === 'pending').length };
  }));
}));
app.patch('/api/private/jobs/:id', privateAuth, privateRole('hirer'), wrap(async (req, res) => {
  if (!['close', 'open'].includes(req.body?.action)) return res.status(400).json({ success: false, message: 'Choose whether to open or close this event' });
  const job = await serialized('privateJobs', async () => {
    const jobs = await readData('privateJobs');
    const item = jobs.find(candidate => candidate.id === req.params.id && candidate.hirerId === req.privateAccount.id);
    if (!item) { const error = new Error('Event not found'); error.status = 404; throw error; }
    if (req.body.action === 'open' && item.date < todayLocal()) { const error = new Error('Past hiring events cannot be reopened'); error.status = 409; throw error; }
    if (req.body.action === 'open') {
      const hiredCount = (await readData('privateApplications')).filter(application => application.jobId === item.id && application.status === 'hired').length;
      if (hiredCount >= item.positions) { const error = new Error('All positions for this event are filled'); error.status = 409; throw error; }
    }
    item.status = req.body.action;
    item.updatedAt = new Date().toISOString();
    await writeData('privateJobs', jobs);
    return item;
  });
  response(res, job, 'Hiring event updated');
}));
app.delete('/api/private/jobs/:id', privateAuth, privateRole('hirer'), wrap(async (req, res) => {
  const result = await serialized('privateApplications', async () => {
    const jobs = await readData('privateJobs');
    const job = jobs.find(candidate => candidate.id === req.params.id && candidate.hirerId === req.privateAccount.id);
    if (!job) { const error = new Error('Event not found'); error.status = 404; throw error; }
    const applications = await readData('privateApplications');
    const removed = applications.filter(item => item.jobId === job.id);
    const accounts = await readData('privateAccounts');
    await serialized('privateCommissionPayments', async () => {
      const payments = await readData('privateCommissionPayments');
      for (const application of removed) {
        if (!application.paymentUtr || payments.some(payment => payment.applicationId === application.id && payment.paymentUtr === application.paymentUtr)) continue;
        payments.push({
          id: randomUUID(), applicationId: application.id, jobId: job.id,
          hirerId: application.hirerId, workerId: application.workerId, jobTitle: job.title,
          hirerName: accounts.find(account => account.id === application.hirerId)?.fullName || 'Hirer unavailable',
          workerName: accounts.find(account => account.id === application.workerId)?.fullName || 'Applicant unavailable',
          amountInr: application.commissionAmountInr || privateCommissionInr,
          paymentReference: application.paymentReference || '', paymentUtr: application.paymentUtr,
          status: ['verified', 'rejected'].includes(application.paymentStatus) ? application.paymentStatus : 'submitted',
          createdAt: application.paymentSubmittedAt || new Date().toISOString(),
          ...(application.paymentReviewedAt ? { reviewedAt: application.paymentReviewedAt } : {})
        });
      }
      await writeData('privateCommissionPayments', payments);
    });
    await writeData('privateApplications', applications.filter(item => item.jobId !== job.id));
    await serialized('privateJobs', async () => writeData('privateJobs', jobs.filter(item => item.id !== job.id)));
    return { id: job.id, deletedApplications: removed.length };
  });
  response(res, result, 'Event and its applications permanently deleted');
}));
app.post('/api/private/jobs/:id/applications', privateAuth, privateRole('worker'), wrap(async (req, res) => {
  if (req.body?.termsAccepted !== true) return res.status(400).json({ success: false, message: 'Accept the worker terms before applying' });
  let application;
  await serialized('privateApplications', async () => {
    const job = (await readData('privateJobs')).find(item => item.id === req.params.id && item.status === 'open' && item.date >= todayLocal());
    if (!job) { const error = new Error('This hiring event is closed or no longer available'); error.status = 404; throw error; }
    const applications = await readData('privateApplications');
    if (applications.some(item => item.jobId === job.id && item.workerId === req.privateAccount.id && ['pending', 'selected', 'accepted', 'hired'].includes(item.status))) { const error = new Error('You already applied to this event'); error.status = 409; throw error; }
    application = { id: randomUUID(), jobId: job.id, hirerId: job.hirerId, workerId: req.privateAccount.id, message: typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 1000) : '', termsAcceptedAt: new Date().toISOString(), termsVersion: 'private-work-v1', status: 'pending', createdAt: new Date().toISOString() };
    applications.unshift(application);
    await writeData('privateApplications', applications);
  });
  response(res, application, 'Application sent to the organizer');
}));
app.get('/api/private/applications/mine', privateAuth, privateRole('worker'), wrap(async (req, res) => {
  const [applications, jobs] = await Promise.all([readData('privateApplications'), readData('privateJobs')]);
  response(res, applications.filter(item => item.workerId === req.privateAccount.id).map(item => {
    const { paymentUtr, paymentReference, ...safeApplication } = item;
    return { ...safeApplication, job: jobs.find(job => job.id === item.jobId) || null };
  }));
}));
app.get('/api/private/jobs/:id/applications', privateAuth, privateRole('hirer'), wrap(async (req, res) => {
  const job = (await readData('privateJobs')).find(item => item.id === req.params.id && item.hirerId === req.privateAccount.id);
  if (!job) return res.status(404).json({ success: false, message: 'Event not found' });
  const [applications, accounts] = await Promise.all([readData('privateApplications'), readData('privateAccounts')]);
  response(res, applications.filter(item => item.jobId === job.id).map((item, index) => {
    const worker = accounts.find(account => account.id === item.workerId);
    const { paymentUtr, ...safeApplication } = item;
    delete safeApplication.workerId;
    const revealDetails = item.paymentStatus === 'verified' && ['pending', 'accepted', 'hired'].includes(item.status);
    const applicant = !worker ? null : revealDetails ? {
      fullName: worker.fullName, locationLabel: worker.locationLabel,
      email: worker.contactPreference === 'phone' ? null : worker.email,
      phone: worker.contactPreference === 'email' ? null : worker.phone,
      skills: worker.skills, experience: worker.experience, availability: worker.availability, expectedPay: worker.expectedPay
    } : { fullName: `Applicant ${index + 1}`, locationLabel: null, email: null, phone: null, skills: null, experience: null, availability: null, expectedPay: null };
    return { ...safeApplication, message: revealDetails ? item.message : '', applicant };
  }));
}));
app.patch('/api/private/applications/:id', privateAuth, wrap(async (req, res) => {
  const action = req.body?.action;
  const result = await serialized('privateApplications', async () => {
    const applications = await readData('privateApplications');
    const item = applications.find(application => application.id === req.params.id);
    if (!item) { const error = new Error('Application not found'); error.status = 404; throw error; }
    if (action === 'withdraw') {
      if (req.privateAccount.id !== item.workerId || item.status !== 'pending') { const error = new Error('Only the applicant can withdraw a pending application'); error.status = 403; throw error; }
      item.status = 'withdrawn';
    } else if (['unlock', 'accept', 'decline', 'hire'].includes(action)) {
      if (req.privateAccount.id !== item.hirerId) { const error = new Error('Only this event organizer can review applications'); error.status = 403; throw error; }
      if (action === 'unlock') {
        if (item.status !== 'pending' || item.paymentStatus === 'verified') { const error = new Error('This applicant cannot be unlocked'); error.status = 409; throw error; }
        item.status = 'selected'; item.commissionAmountInr = privateCommissionInr; item.commissionStatus = 'pending'; item.paymentProvider = 'PhonePe'; item.paymentStatus = 'unpaid'; item.paymentReference = randomUUID().replaceAll('-', '').slice(0, 20).toUpperCase(); item.paymentReviewNote = '';
      } else if (action === 'accept' || action === 'decline') {
        if (item.status !== 'pending') { const error = new Error('This application has already been reviewed'); error.status = 409; throw error; }
        if (action === 'accept' && item.paymentStatus !== 'verified') { const error = new Error('Pay and verify the ₹50 commission before accepting this applicant'); error.status = 402; throw error; }
        item.status = action === 'accept' ? 'accepted' : 'declined';
      } else {
        if (item.status !== 'accepted') { const error = new Error('Accept the application before marking the person hired'); error.status = 409; throw error; }
        if (item.paymentStatus !== 'verified') { const error = new Error('Verify the commission payment before hiring'); error.status = 402; throw error; }
        const hiredCount = applications.filter(application => application.jobId === item.jobId && application.status === 'hired').length;
        await serialized('privateJobs', async () => {
          const jobs = await readData('privateJobs');
          const job = jobs.find(candidate => candidate.id === item.jobId && candidate.hirerId === item.hirerId);
          if (!job || hiredCount >= job.positions) { const error = new Error('All positions for this event are filled'); error.status = 409; throw error; }
          item.status = 'hired'; item.hiredAt = new Date().toISOString();
          if (hiredCount + 1 >= job.positions) { job.status = 'closed'; job.updatedAt = new Date().toISOString(); await writeData('privateJobs', jobs); }
        });
      }
    } else { const error = new Error('Choose unlock, accept, decline, hire, or withdraw'); error.status = 400; throw error; }
    item.updatedAt = new Date().toISOString();
    await writeData('privateApplications', applications);
    return item;
  });
  const { paymentUtr, ...safeResult } = result;
  delete safeResult.workerId;
  response(res, safeResult, 'Application updated');
}));
app.post('/api/private/applications/:id/payment', privateAuth, privateRole('hirer'), wrap(async (req, res) => {
  const parsed = commissionUtrInput.safeParse(req.body || {});
  if (!parsed.success) return res.status(400).json({ success: false, message: parsed.error.issues[0].message });
  const receipt = await serialized('privateApplications', async () => {
    const applications = await readData('privateApplications');
    const item = applications.find(application => application.id === req.params.id && application.hirerId === req.privateAccount.id);
    if (!item || item.status !== 'selected' || !['unpaid', 'rejected'].includes(item.paymentStatus)) { const error = new Error('This application is not awaiting a payment receipt'); error.status = 409; throw error; }
    if (item.paymentUtr === parsed.data.utr) { const error = new Error('Enter a new UTR for this payment'); error.status = 409; throw error; }
    if (applications.some(other => other.id !== item.id && other.paymentUtr === parsed.data.utr) || (await readData('privateCommissionPayments')).some(payment => payment.paymentUtr === parsed.data.utr)) { const error = new Error('This UTR has already been submitted'); error.status = 409; throw error; }
    item.paymentUtr = parsed.data.utr; item.paymentStatus = 'submitted'; item.paymentSubmittedAt = new Date().toISOString(); item.paymentReviewNote = ''; item.updatedAt = new Date().toISOString();
    await writeData('privateApplications', applications);
    await serialized('privateCommissionPayments', async () => {
      const payments = await readData('privateCommissionPayments');
      if (!payments.some(payment => payment.paymentUtr === item.paymentUtr)) {
        const [jobs, accounts] = await Promise.all([readData('privateJobs'), readData('privateAccounts')]);
        const job = jobs.find(candidate => candidate.id === item.jobId);
        payments.unshift({
          id: randomUUID(), applicationId: item.id, jobId: item.jobId,
          hirerId: item.hirerId, workerId: item.workerId, jobTitle: job?.title || 'Deleted event',
          hirerName: accounts.find(account => account.id === item.hirerId)?.fullName || 'Hirer unavailable',
          workerName: accounts.find(account => account.id === item.workerId)?.fullName || 'Applicant unavailable',
          amountInr: item.commissionAmountInr || privateCommissionInr,
          paymentReference: item.paymentReference || '', paymentUtr: item.paymentUtr,
          status: 'submitted', createdAt: item.paymentSubmittedAt
        });
        await writeData('privateCommissionPayments', payments);
      }
    });
    return { id: item.id, paymentStatus: item.paymentStatus, commissionAmountInr: item.commissionAmountInr };
  });
  response(res, receipt, 'UTR submitted for verification');
}));
const paymentAdmin = (req, res, next) => req.member?.username === 'pratik_shewane'
  ? next()
  : res.status(403).json({ success: false, message: 'Only the payment reviewer can access this queue' });
app.get('/api/admin/private-payments', auth, paymentAdmin, wrap(async (_req, res) => {
  const payments = await serialized('privateCommissionPayments', async () => {
    const [ledger, applications, jobs, accounts] = await Promise.all([readData('privateCommissionPayments'), readData('privateApplications'), readData('privateJobs'), readData('privateAccounts')]);
    const existing = new Set(ledger.map(item => `${item.applicationId}:${item.paymentUtr}`));
    for (const application of applications.filter(item => item.paymentUtr && ['submitted', 'verified', 'rejected'].includes(item.paymentStatus))) {
      const key = `${application.id}:${application.paymentUtr}`;
      if (existing.has(key)) continue;
      const job = jobs.find(candidate => candidate.id === application.jobId);
      ledger.push({
        id: randomUUID(), applicationId: application.id, jobId: application.jobId,
        hirerId: application.hirerId, workerId: application.workerId, jobTitle: job?.title || 'Event unavailable',
        hirerName: accounts.find(account => account.id === application.hirerId)?.fullName || 'Hirer unavailable',
        workerName: accounts.find(account => account.id === application.workerId)?.fullName || 'Applicant unavailable',
        amountInr: application.commissionAmountInr || privateCommissionInr,
        paymentReference: application.paymentReference || '', paymentUtr: application.paymentUtr,
        status: application.paymentStatus,
        createdAt: application.paymentSubmittedAt || application.updatedAt || application.createdAt,
        ...(application.paymentReviewedAt ? { reviewedAt: application.paymentReviewedAt } : {})
      });
      existing.add(key);
    }
    if (ledger.length !== (await readData('privateCommissionPayments')).length) await writeData('privateCommissionPayments', ledger);
    return ledger;
  });
  const queue = payments.filter(item => item.status === 'submitted').map(item => ({
    id: item.id, applicationId: item.applicationId, paymentUtr: item.paymentUtr,
    amountInr: item.amountInr, paymentReference: item.paymentReference,
    submittedAt: item.createdAt, jobTitle: item.jobTitle,
    hirerName: item.hirerName || 'Hirer unavailable', workerName: item.workerName || 'Applicant unavailable'
  }));
  const verifiedTotalInr = payments.filter(item => item.status === 'verified').reduce((total, item) => total + item.amountInr, 0);
  response(res, { payments: queue, verifiedTotalInr, awaitingTotalInr: queue.reduce((total, item) => total + (item.amountInr || 0), 0) });
}));
app.patch('/api/admin/private-payments/:id', auth, paymentAdmin, wrap(async (req, res) => {
  const action = req.body?.action;
  if (!['verify', 'reject'].includes(action)) return res.status(400).json({ success: false, message: 'Choose verify or reject' });
  const payment = await serialized('privateCommissionPayments', async () => {
    const payments = await readData('privateCommissionPayments');
    const item = payments.find(payment => payment.id === req.params.id && payment.status === 'submitted');
    if (!item) { const error = new Error('Payment receipt is no longer awaiting review'); error.status = 409; throw error; }
    item.status = action === 'verify' ? 'verified' : 'rejected';
    item.reviewedAt = new Date().toISOString(); item.reviewedByMemberId = req.member.id;
    item.reviewNote = action === 'reject' ? (typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 300) : 'UTR could not be verified') : '';
    await writeData('privateCommissionPayments', payments);
    return { id: item.id, applicationId: item.applicationId, paymentUtr: item.paymentUtr, paymentStatus: item.status, commissionStatus: action === 'verify' ? 'paid' : 'pending', reviewedAt: item.reviewedAt, reviewNote: item.reviewNote };
  });
  await serialized('privateApplications', async () => {
    const applications = await readData('privateApplications');
    const application = applications.find(candidate => candidate.id === payment.applicationId && candidate.paymentUtr === payment.paymentUtr);
    if (application) {
      application.paymentStatus = payment.paymentStatus;
      application.paymentReviewedAt = payment.reviewedAt; application.paymentReviewedByMemberId = req.member.id;
      application.paymentReviewNote = payment.reviewNote;
      application.commissionStatus = payment.commissionStatus;
      if (action === 'verify') application.commissionPaidAt = payment.reviewedAt;
      if (application.status === 'selected') application.status = 'pending';
      application.updatedAt = payment.reviewedAt;
      await writeData('privateApplications', applications);
    }
  });
  delete payment.applicationId; delete payment.paymentUtr; delete payment.reviewedAt; delete payment.reviewNote;
  response(res, payment, action === 'verify' ? 'Payment verified; applicant details unlocked for the hirer' : 'UTR rejected; the hirer may submit a new UTR');
}));
app.patch('/api/private/availability', privateAuth, privateRole('worker'), wrap(async (req, res) => {
  if (typeof req.body?.available !== 'boolean') return res.status(400).json({ success: false, message: 'Availability must be true or false' });
  const account = await serialized('privateAccounts', async () => {
    const accounts = await readData('privateAccounts');
    const worker = accounts.find(item => item.id === req.privateAccount.id);
    worker.available = req.body.available;
    await writeData('privateAccounts', accounts);
    return worker;
  });
  response(res, safePrivateAccount(account), 'Availability updated');
}));
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
const eventView = (e, members) => ({ id:e.id,title:e.title,shortDescription:e.shortDescription,description:e.description,date:e.date,startTime:e.startTime,endTime:e.endTime,venue:e.venue,address:e.address,city:e.city,mapsUrl:e.mapsUrl,latitude:e.latitude,longitude:e.longitude,imageUrl:e.imageUrl,createdAt:e.createdAt,updatedAt:e.updatedAt,organizer:members.find(m=>m.id===e.createdByMemberId)?.displayName||'Community member' });
app.get('/api/events', wrap(async (_req, res) => {
  // Expired-event cleanup runs at startup and hourly. Keep it off the public
  // request path so each homepage load avoids a serialized database read.
  const [members, allEvents] = await Promise.all([readData('members'), readData('events')]);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' });
  const events = allEvents.filter(e => !e.archivedAt && e.date >= today)
    .sort((a,b) => `${a.date}T${a.startTime || '00:00'}`.localeCompare(`${b.date}T${b.startTime || '00:00'}`))
    .slice(0,6).map(e => eventView(e,members));
  response(res, events);
}));
app.get('/api/events/archive', auth, wrap(async (_req,res) => response(res, (await readData('events')).filter(e => e.archivedAt))));
app.get('/api/events/:id', wrap(async (req,res) => {
  const [events, members] = await Promise.all([readData('events'), readData('members')]);
  const today = new Date().toLocaleDateString('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' });
  const e = events.find(x => x.id === req.params.id && !x.archivedAt && x.date >= today);
  if (!e) return res.status(404).json({ success:false,message:'Event not found' });
  response(res,eventView(e,members));
}));
app.get('/api/dashboard/events', auth, wrap(async (_req,res) => response(res,(await readData('events')).map(e=>e))));
app.get('/api/requests', auth, wrap(async (_req, res) => response(res, (await readData('requests')).filter(item => item.status === 'pending'))));
app.post('/api/requests/:id/accept', auth, wrap(async (req, res) => {
  const created = await serialized('requests', async () => {
    const requests = await readData('requests');
    const item = requests.find(candidate => candidate.id === req.params.id);
    if (!item || item.status !== 'pending') {
      const error = new Error('This request is no longer available'); error.status = 404; throw error;
    }
    const event = await mutateEvent('create', null, item, req.member);
    item.status = 'accepted';
    item.acceptedAt = new Date().toISOString();
    item.acceptedByMemberId = req.member.id;
    item.eventId = event.id;
    await writeData('requests', requests);
    return event;
  });
  response(res, created, 'Request added to upcoming Bhandaras');
}));
app.get('/api/activity', auth, wrap(async (_req,res) => response(res,await readData('activity'))));
app.post('/api/events', auth, wrap(async (req,res) => response(res,await mutateEvent('create',null,req.body,req.member),'Event created')));
app.patch('/api/events/:id', auth, wrap(async (req,res) => response(res,await mutateEvent('edit',req.params.id,req.body,req.member),'Event updated')));
for (const action of ['archive','restore']) app.post(`/api/events/:id/${action}`,auth,wrap(async(req,res)=>response(res,await mutateEvent(action,req.params.id,null,req.member),`Event ${action}d`)));
app.delete('/api/events/:id',auth,wrap(async(req,res)=>response(res,await mutateEvent('delete',req.params.id,null,req.member),'Event deleted')));
app.use((err,_req,res,_next) => { const status = err.status || 500; if (status >= 500) console.error('Request failed'); res.status(status).json({ success:false,message:status >= 500 ? 'A server error occurred' : err.message }); });

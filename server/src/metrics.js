import { MongoClient } from 'mongodb';

let clientPromise;
let onlineIndexPromise;
const local = { visits: 0, monthly: new Map(), online: new Map() };

async function collections() {
  if (!process.env.MONGODB_URI) return null;
  if (!clientPromise) {
    const client = new MongoClient(process.env.MONGODB_URI);
    clientPromise = client.connect().then(() => client.db(process.env.MONGODB_DB || undefined));
  }
  const db = await clientPromise;
  const online = db.collection('site_metric_online_visitors');
  if (!onlineIndexPromise) onlineIndexPromise = online.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await onlineIndexPromise;
  return {
    totals: db.collection('site_metrics'),
    monthly: db.collection('site_metric_monthly_visitors'),
    online,
  };
}

export async function recordVisit(visitorId, now = new Date()) {
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const store = await collections();
  if (store) {
    await store.totals.updateOne({ _id: 'public' }, { $inc: { totalVisits: 1 } }, { upsert: true });
    try {
      await store.monthly.updateOne({ _id: `${month}:${visitorId}` }, { $setOnInsert: { month, visitorId } }, { upsert: true });
    } catch (error) {
      if (error.code !== 11000) throw error;
    }
    return;
  }
  local.visits += 1;
  if (!local.monthly.has(month)) local.monthly.set(month, new Set());
  local.monthly.get(month).add(visitorId);
}

export async function heartbeat(visitorId, now = new Date()) {
  const expiresAt = new Date(now.getTime() + 2 * 60_000);
  const store = await collections();
  if (store) {
    await store.online.updateOne({ _id: visitorId }, { $set: { expiresAt } }, { upsert: true });
    return;
  }
  local.online.set(visitorId, expiresAt.getTime());
}

export async function getMetrics(now = new Date()) {
  const month = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
  const cutoff = new Date(now.getTime() - 2 * 60_000);
  const store = await collections();
  if (store) {
    const [total, monthlyActiveUsers, currentlyOnline] = await Promise.all([
      store.totals.findOne({ _id: 'public' }),
      store.monthly.countDocuments({ month }),
      store.online.countDocuments({ expiresAt: { $gt: now } }),
    ]);
    return { totalVisits: total?.totalVisits || 0, currentlyOnline, monthlyActiveUsers };
  }
  for (const [id, expiry] of local.online) if (expiry <= now.getTime()) local.online.delete(id);
  return {
    totalVisits: local.visits,
    currentlyOnline: [...local.online.values()].filter(expiry => expiry > cutoff.getTime()).length,
    monthlyActiveUsers: local.monthly.get(month)?.size || 0,
  };
}

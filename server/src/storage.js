import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const root = path.resolve(process.env.DATA_DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data'));
const queues = new Map();
let dbPromise;
async function database() {
  if (!process.env.MONGODB_URI) return null;
  if (!dbPromise) {
    const client = new MongoClient(process.env.MONGODB_URI);
    dbPromise = client.connect().then(() => client.db(process.env.MONGODB_DB || undefined));
  }
  return dbPromise;
}
const recordValid = {
  members: value => value && typeof value.id === 'string' && typeof value.username === 'string' && typeof value.passwordHash === 'string' && typeof value.displayName === 'string' && typeof value.createdAt === 'string',
  events: value => value && typeof value.id === 'string' && typeof value.title === 'string' && typeof value.date === 'string' && typeof value.venue === 'string' && typeof value.address === 'string' && typeof value.city === 'string' && typeof value.createdByMemberId === 'string' && typeof value.createdAt === 'string',
  activity: value => value && typeof value.id === 'string' && typeof value.action === 'string' && typeof value.eventId === 'string' && typeof value.eventTitle === 'string' && typeof value.memberId === 'string' && typeof value.memberName === 'string' && typeof value.at === 'string'
};
const valid = (name, rows) => Array.isArray(rows) && rows.every(recordValid[name]);
export async function readData(name) {
  if (!recordValid[name]) throw new Error('Unknown storage file');
  const db = await database();
  if (db) {
    const rows = await db.collection(name).find({}).toArray();
    const records = rows.map(({ _id, ...record }) => record);
    if (!valid(name, records)) throw new Error(`Invalid ${name} data in MongoDB`);
    return records;
  }
  const file = path.join(root, `${name}.json`);
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!valid(name, value)) throw new Error(`Invalid ${name} data`);
    return value;
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw new Error(`Unable to read ${name} data safely`);
  }
}
export async function writeData(name, value) {
  if (!recordValid[name] || !valid(name, value)) throw new Error(`Invalid ${name} data`);
  const db = await database();
  if (db) {
    const collection = db.collection(name);
    if (!value.length) {
      await collection.deleteMany({});
      return;
    }
    await collection.bulkWrite(value.map(record => ({
      replaceOne: { filter: { _id: record.id }, replacement: { ...record, _id: record.id }, upsert: true }
    })));
    await collection.deleteMany({ _id: { $nin: value.map(record => record.id) } });
    return;
  }
  await fs.mkdir(root, { recursive: true });
  const file = path.join(root, `${name}.json`);
  const temp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  await fs.rename(temp, file);
}
export function serialized(key, operation) {
  const previous = queues.get(key) || Promise.resolve();
  const current = previous.catch(() => {}).then(operation);
  queues.set(key, current);
  return current.finally(() => { if (queues.get(key) === current) queues.delete(key); });
}

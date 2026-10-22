import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

if (!process.env.MONGODB_URI) throw new Error('Set MONGODB_URI before migrating data.');

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data');
const client = new MongoClient(process.env.MONGODB_URI);

try {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || undefined);

  for (const name of ['members', 'events', 'activity']) {
    let records;
    try {
      records = JSON.parse(await fs.readFile(path.join(dataDir, `${name}.json`), 'utf8'));
    } catch (error) {
      if (error.code === 'ENOENT') records = [];
      else throw error;
    }
    if (!Array.isArray(records) || records.some(record => !record || typeof record.id !== 'string')) {
      throw new Error(`Local ${name}.json is not a valid record list.`);
    }

    const collection = db.collection(name);
    let inserted = 0;
    if (records.length) {
      const result = await collection.bulkWrite(records.map(record => ({
        updateOne: {
          filter: { _id: record.id },
          update: { $setOnInsert: { ...record, _id: record.id } },
          upsert: true,
        },
      })));
      inserted = result.upsertedCount;
    }
    console.log(`${name}: imported ${inserted} new record(s); existing records were left unchanged.`);
  }

  const count = await db.collection('members').countDocuments();
  if (count !== 6) throw new Error(`MongoDB contains ${count} member records after migration; expected exactly 6.`);
} finally {
  await client.close();
}

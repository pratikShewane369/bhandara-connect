import { randomUUID } from 'node:crypto';
import { readData, writeData, serialized } from './storage.js';
import { eventInput } from './validation.js';
const now = () => new Date().toISOString();
const today = () => new Date().toLocaleDateString('en-CA', { timeZone: process.env.APP_TIMEZONE || 'Asia/Kolkata' });
async function log(action, event, member) {
  await serialized('activity', async () => {
    const rows = await readData('activity');
    rows.unshift({ id: randomUUID(), action, eventId: event.id, eventTitle: event.title, memberId: member.id, memberName: member.displayName, at: now() });
    await writeData('activity', rows.slice(0, 250));
  });
}
export const publicEvent = async id => (await readData('events')).find(e => e.id === id && !e.archivedAt);
export async function purgeExpiredEvents() {
  return serialized('events', async () => {
    const events = await readData('events');
    const remaining = events.filter(event => event.date >= today());
    const removed = events.length - remaining.length;
    if (removed) await writeData('events', remaining);
    return removed;
  });
}
export async function mutateEvent(action, id, payload, member) {
  await purgeExpiredEvents();
  return serialized('events', async () => {
    const events = await readData('events');
    let event;
    if (action === 'create') {
      const parsed = eventInput.safeParse(payload);
      if (!parsed.success) { const error = new Error(parsed.error.issues[0].message); error.status = 400; throw error; }
      if (events.filter(e => !e.archivedAt).length >= 6) { const error = new Error('The Bhandara list is full. Archive or remove an existing event before adding another.'); error.status = 409; throw error; }
      event = { id: randomUUID(), ...parsed.data, createdByMemberId: member.id, createdAt: now(), updatedAt: now(), updatedByMemberId: member.id, archivedAt: null };
      events.push(event);
    } else {
      event = events.find(e => e.id === id);
      if (!event) { const error = new Error('Event not found'); error.status = 404; throw error; }
      if (action === 'delete' && event.createdByMemberId !== member.id) { const error = new Error('Only the member who created this event can delete it'); error.status = 403; throw error; }
      if (action === 'edit') {
        const parsed = eventInput.safeParse(payload);
        if (!parsed.success) { const error = new Error(parsed.error.issues[0].message); error.status = 400; throw error; }
        Object.assign(event, parsed.data, { updatedAt: now(), updatedByMemberId: member.id });
      } else if (action === 'archive') { event.archivedAt = now(); event.updatedAt = now(); event.updatedByMemberId = member.id; }
      else if (action === 'restore') {
        if (!event.archivedAt) return event;
        if (events.filter(e => !e.archivedAt).length >= 6) { const error = new Error('The Bhandara list is full. Archive or remove an existing event before adding another.'); error.status = 409; throw error; }
        event.archivedAt = null; event.updatedAt = now(); event.updatedByMemberId = member.id;
      } else if (action === 'delete') events.splice(events.indexOf(event), 1);
    }
    await writeData('events', events);
    await log(action, event, member);
    return event;
  });
}

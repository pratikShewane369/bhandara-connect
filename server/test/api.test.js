import { test, before, beforeEach, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import bcrypt from 'bcryptjs';
import request from 'supertest';
let dir, app, members, readData;
before(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'bhandara-test-'));
  process.env.DATA_DIR = dir; process.env.COOKIE_SECRET = 'test-secret-long-enough-for-tests'; process.env.CLIENT_ORIGIN = 'http://localhost:5173'; process.env.NODE_ENV = 'test';
  members = Array.from({length:6},(_,i)=>({id:`member-${i+1}`,username:`member${i+1}`,passwordHash:'',displayName:`Member ${i+1}`,profileImage:'',createdAt:new Date().toISOString()}));
  members[0].passwordHash = await bcrypt.hash('a-safe-test-password', 4);
  await fs.writeFile(path.join(dir,'members.json'),JSON.stringify(members));
  await fs.writeFile(path.join(dir,'events.json'),'[]'); await fs.writeFile(path.join(dir,'activity.json'),'[]');
  ({app} = await import('../src/app.js'));
  ({readData} = await import('../src/storage.js'));
});
beforeEach(async () => { await fs.writeFile(path.join(dir,'members.json'),JSON.stringify(members)); await fs.writeFile(path.join(dir,'events.json'),'[]'); await fs.writeFile(path.join(dir,'activity.json'),'[]'); });
after(async () => { await fs.rm(dir,{recursive:true,force:true}); });
const sample = i => ({title:`Feast ${i}`,shortDescription:'Community meal for everyone',date:'2099-12-20',venue:'Community Hall',address:'10 Example Road, Sector 4',city:'Example City',mapsUrl:'',description:'',startTime:'',endTime:''});
async function login(){const r=await request(app).post('/api/auth/login').send({username:'member1',password:'a-safe-test-password'});assert.equal(r.status,200);return r.headers['set-cookie'];}
test('public visitors can retrieve events and unauthenticated changes are rejected',async()=>{
  assert.equal((await request(app).get('/api/events')).status,200);
  assert.equal((await request(app).post('/api/events').send(sample(1))).status,401);
  assert.equal((await request(app).delete('/api/events/missing')).status,401);
});
test('login, invalid credentials, safe profile, logout and absent registration',async()=>{
  assert.equal((await request(app).post('/api/auth/login').send({username:'member1',password:'wrong'})).status,401);
  const cookie=await login(); const me=await request(app).get('/api/auth/me').set('Cookie',cookie);
  assert.equal(me.status,200); assert.equal('passwordHash' in me.body.data,false);
  assert.equal((await request(app).post('/api/auth/register')).status,404);
  assert.equal((await request(app).post('/api/auth/logout').set('Cookie',cookie)).status,200);
  assert.equal((await request(app).get('/api/auth/me').set('Cookie',cookie)).status,401);
});
test('six event cap is atomic for concurrent creates and archive frees a slot',async()=>{
  const cookie=await login();
  const creates=await Promise.all(Array.from({length:7},(_,i)=>request(app).post('/api/events').set('Cookie',cookie).send(sample(i))));
  assert.equal(creates.filter(r=>r.status===200).length,6); assert.equal(creates.filter(r=>r.status===409).length,1);
  const list=(await request(app).get('/api/dashboard/events').set('Cookie',cookie)).body.data;
  assert.equal(list.filter(e=>!e.archivedAt).length,6);
  assert.equal((await request(app).post(`/api/events/${list[0].id}/archive`).set('Cookie',cookie)).status,200);
  assert.equal((await request(app).post('/api/events').set('Cookie',cookie).send(sample(8))).status,200);
});
test('invalid event data is rejected and creator identity is server assigned',async()=>{
  const cookie=await login();
  const r=await request(app).post('/api/events').set('Cookie',cookie).send({...sample(9),date:'not-a-date'});
  assert.equal(r.status,400);
});
test('edits retain creator identity and public responses omit member identifiers',async()=>{
  const cookie=await login();
  const created=await request(app).post('/api/events').set('Cookie',cookie).send(sample(10));
  const id=created.body.data.id, creator=created.body.data.createdByMemberId;
  assert.equal(created.status,200);
  const edited=await request(app).patch(`/api/events/${id}`).set('Cookie',cookie).send({...sample(10),title:'Updated community feast'});
  assert.equal(edited.body.data.createdByMemberId,creator);
  const publicEventResult=await request(app).get(`/api/events/${id}`);
  assert.equal(publicEventResult.body.data.organizer,'Member 1');
  assert.equal('createdByMemberId' in publicEventResult.body.data,false);
  const publicMembers=await request(app).get('/api/members');
  assert.equal(publicMembers.body.data.length,6);
  assert.equal('username' in publicMembers.body.data[0],false);
});
test('members can change their own display name and public organizer names resolve live',async()=>{
  const cookie=await login();
  await request(app).post('/api/events').set('Cookie',cookie).send(sample(11));
  const profile=await request(app).patch('/api/auth/profile').set('Cookie',cookie).send({displayName:'Seva Volunteer'});
  assert.equal(profile.body.data.displayName,'Seva Volunteer');
  const list=await request(app).get('/api/events');
  assert.equal(list.body.data[0].organizer,'Seva Volunteer');
});
test('restoring an archived event cannot exceed six active events',async()=>{
  const cookie=await login();
  const creates=await Promise.all(Array.from({length:6},(_,i)=>request(app).post('/api/events').set('Cookie',cookie).send(sample(i))));
  const id=creates[0].body.data.id;
  await request(app).post(`/api/events/${id}/archive`).set('Cookie',cookie);
  await request(app).post('/api/events').set('Cookie',cookie).send(sample(7));
  const restored=await request(app).post(`/api/events/${id}/restore`).set('Cookie',cookie);
  assert.equal(restored.status,409);
  assert.equal((await readData('events')).filter(e=>!e.archivedAt).length,6);
});
test('password changes require the current password and revoke existing cookies',async()=>{
  const cookie=await login();
  const bad=await request(app).patch('/api/auth/change-password').set('Cookie',cookie).send({currentPassword:'wrong',newPassword:'new-safe-password-123'});
  assert.equal(bad.status,400);
  const changed=await request(app).patch('/api/auth/change-password').set('Cookie',cookie).send({currentPassword:'a-safe-test-password',newPassword:'new-safe-password-123'});
  assert.equal(changed.status,200);
  assert.equal((await request(app).get('/api/auth/me').set('Cookie',cookie)).status,401);
  assert.equal((await request(app).post('/api/auth/login').send({username:'member1',password:'new-safe-password-123'})).status,200);
});
test('activity retains the display name recorded when the event action happened',async()=>{
  const cookie=await login();
  await request(app).post('/api/events').set('Cookie',cookie).send(sample(19));
  await request(app).patch('/api/auth/profile').set('Cookie',cookie).send({displayName:'Changed Later'});
  const activity=await request(app).get('/api/activity').set('Cookie',cookie);
  assert.equal(activity.body.data[0].memberName,'Member 1');
});
test('invalid dates, time ranges, maps links, and unsupported image paths are rejected',async()=>{
  const cookie=await login();
  const cases=[
    {...sample(1),date:'2099-02-30'},
    {...sample(2),startTime:'18:00',endTime:'17:00'},
    {...sample(3),mapsUrl:'javascript:alert(1)'},
    {...sample(4),imageUrl:'data:image/png;base64,AAAA'}
  ];
  for(const payload of cases) assert.equal((await request(app).post('/api/events').set('Cookie',cookie).send(payload)).status,400);
});
test('JSON records survive rereading and corrupt files fail safely',async()=>{
  const cookie=await login();
  await request(app).post('/api/events').set('Cookie',cookie).send(sample(21));
  assert.equal((await readData('events')).length,1);
  const storageUrl=new URL('../src/storage.js',import.meta.url).href;
  const restartedRead=execFileSync(process.execPath,['--input-type=module','-e',`const {readData}=await import(${JSON.stringify(storageUrl)}); console.log((await readData('events')).length)`],{encoding:'utf8'}).trim();
  assert.equal(restartedRead,'1');
  await fs.writeFile(path.join(dir,'events.json'),'not valid JSON');
  await assert.rejects(readData('events'),/Unable to read events data safely/);
  await fs.writeFile(path.join(dir,'events.json'),JSON.stringify([{}]));
  await assert.rejects(readData('events'),/Unable to read events data safely/);
});
test('all six records are fixed and no public member creation route exists',async()=>{
  assert.equal((await readData('members')).length,6);
  assert.equal((await request(app).post('/api/members').send({username:'member7'})).status,404);
  assert.equal((await request(app).post('/api/auth/register').send({username:'member7'})).status,404);
});

import 'reflect-metadata';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHmac } from 'node:crypto';
import request from 'supertest';

const url = process.env.TEST_DATABASE_URL;
test('PostgreSQL transactions and HTTP contracts', { skip: !url }, async t => {
  if (!new URL(url!).pathname.endsWith('_test')) throw new Error('TEST_DATABASE_URL must name a disposable database ending in _test');
  process.env.DATABASE_URL=url;
  process.env.JWT_SECRET='test-jwt-secret-32-characters-long-value';
  process.env.PAYMENT_WEBHOOK_SECRET='test-webhook-secret-32-characters-long';
  process.env.ENABLE_DOCS='true';
  const { MikroORM } = require('@mikro-orm/postgresql');
  const config = require('../dist/database/mikro-orm.config').default;
  const { Db } = require('../dist/database/db');
  const { CommerceService } = require('../dist/commerce/service');
  const orm = await MikroORM.init(config);
  let app: any;
  try {
    await orm.getMigrator().up();
    const db = new Db(orm.em.fork());
    const service = new CommerceService(db);
    const q = (sql: string, params: any[] = []) => db.query(sql,params);
    const one = (sql: string, params: any[] = []) => db.one(sql,params);
    const address = {recipient:'Test',phone:'01012345678',country:'KR',postalCode:'12345',line1:'Test street'};
    async function fixture(units=1, limit=1) {
      const users=[];
      for (let i=0;i<8;i++) users.push((await one("INSERT INTO users(email,display_name) VALUES (?,'Test') RETURNING *",[randomUUID()+'@example.test'])).id);
      const c = await one("INSERT INTO categories(code,slug,name_ko,name_en) VALUES (?,?,'테스트','Test') RETURNING *",[randomUUID(),randomUUID()]);
      const p = await one("INSERT INTO products(category_id,slug,title,status) VALUES (?,?,'Product','ACTIVE') RETURNING *",[c.id,randomUUID()]);
      const v = await one('INSERT INTO product_variants(product_id,sku) VALUES (?,?) RETURNING *',[p.id,randomUUID()]);
      const l = await one("INSERT INTO launches(product_id,state,reservation_opens_at,reservation_closes_at,sale_opens_at,early_access_ends_at,sale_ends_at) VALUES (?,'PUBLISHED',now()-interval '1 hour',now()+interval '1 hour',now()+interval '2 hours',now()+interval '3 hours',now()+interval '4 hours') RETURNING *",[p.id]);
      const lv = await one('INSERT INTO launch_variants(launch_id,product_id,variant_id,price_minor,total_units,per_customer_limit) VALUES (?,?,?,19900,?,?) RETURNING *',[l.id,p.id,v.id,units,limit]);
      return {users,l,lv};
    }
    async function sale(f: any, isPublic=false) { await q("UPDATE launches SET reservation_opens_at=now()-interval '4 hours',reservation_closes_at=now()-interval '3 hours',sale_opens_at=now()-interval '2 hours',early_access_ends_at=now()+ (? * interval '1 hour'),sale_ends_at=now()+interval '4 hours' WHERE id=?",[isPublic ? -1 : 1,f.l.id]); }
    function checkout(f: any, quantity=1, key=randomUUID()) { return {launchVariantId:f.lv.id,quantity,shippingAddress:address,idempotencyKey:key}; }
    function event(o: any, status='CAPTURED') { return {paymentId:o.payment.id,providerPaymentId:'provider-'+o.payment.id,status,amountMinor:o.total_minor,currency:o.currency}; }
    async function counters(f: any) { const v=await one('SELECT * FROM launch_variants WHERE id=?',[f.lv.id]); return [v.reserved_units,v.checkout_held_units,v.sold_units]; }
    await t.test('concurrent customers cannot reserve more stock than exists',async () => {
      const f=await fixture(2);
      const results=await Promise.allSettled(f.users.map((u: string) => service.reserve(u,f.l.id,f.lv.id)));
      assert.equal(results.filter(x=>x.status==='fulfilled').length,2);
      assert.deepEqual(await counters(f),[2,0,0]);
    });
    await t.test('duplicate reserve and checkout are idempotent; capture is applied once',async () => {
      const f=await fixture();
      const reservations=await Promise.all(Array.from({length:5},()=>service.reserve(f.users[0],f.l.id,f.lv.id)));
      assert.equal(new Set(reservations.map(r=>r.id)).size,1);
      await sale(f);
      const d=checkout(f);
      const orders=await Promise.all([service.checkout(f.users[0],d),service.checkout(f.users[0],d)]);
      assert.equal(orders[0].id,orders[1].id);
      assert.deepEqual(await counters(f),[0,1,0]);
      await Promise.all([service.payment(event(orders[0])),service.payment(event(orders[0]))]);
      assert.deepEqual(await counters(f),[0,0,1]);
      await service.payment(event(orders[0],'FAILED'));
      assert.equal((await one('SELECT status FROM orders WHERE id=?',[orders[0].id])).status,'PAID');
    });
    await t.test('early access requires reservation and failure restores its unit',async () => {
      const f=await fixture();await service.reserve(f.users[0],f.l.id,f.lv.id);await sale(f);
      await assert.rejects(()=>service.checkout(f.users[1],checkout(f)),/active reservation/);
      const o=await service.checkout(f.users[0],checkout(f));await service.payment(event(o,'FAILED'));
      assert.deepEqual(await counters(f),[1,0,0]);
      const retry=await service.checkout(f.users[0],checkout(f));assert.notEqual(retry.id,o.id);
    });
    await t.test('public checkout releases stale reservations without waiting for worker',async () => {
      const f=await fixture();await service.reserve(f.users[0],f.l.id,f.lv.id);await sale(f,true);
      const o=await service.checkout(f.users[1],checkout(f));assert.equal(o.total_minor,'19900');
      assert.deepEqual(await counters(f),[0,1,0]);
      assert.equal((await one('SELECT status FROM reservations WHERE launch_variant_id=?',[f.lv.id])).status,'EXPIRED');
    });
    await t.test('parallel public checkouts cannot oversell',async () => {
      const f=await fixture(2);await sale(f,true);
      const results=await Promise.allSettled(f.users.map((u: string)=>service.checkout(u,checkout(f))));
      assert.equal(results.filter(x=>x.status==='fulfilled').length,2);assert.deepEqual(await counters(f),[0,2,0]);
    });
    await t.test('per-customer limit spans orders and request keys cannot change payload',async () => {
      const f=await fixture(10,2);await sale(f,true);const d=checkout(f,2);await service.checkout(f.users[0],d);
      await assert.rejects(()=>service.checkout(f.users[0],checkout(f)),/limit/);
      await assert.rejects(()=>service.checkout(f.users[0],{...d,quantity:1}),/Idempotency/);
    });
    await t.test('late capture queues a refund after expiry and does not reclaim sold stock',async () => {
      const f=await fixture();await sale(f,true);const o=await service.checkout(f.users[0],checkout(f));
      await q("UPDATE orders SET payment_expires_at=now()-interval '1 minute' WHERE id=?",[o.id]);
      await service.expireOrder(o.id);await service.expireOrder(o.id);
      const next=await service.checkout(f.users[1],checkout(f));await service.payment(event(next));await service.payment(event(o));
      assert.deepEqual(await counters(f),[0,0,1]);assert.equal((await one('SELECT status FROM orders WHERE id=?',[o.id])).status,'CANCELLED');
      assert.equal((await one('SELECT status FROM payment_reconciliations WHERE payment_id=?',[o.payment.id])).status,'PENDING');
      await service.payment(event(o,'REFUNDED'));
      assert.equal((await one('SELECT status FROM payment_reconciliations WHERE payment_id=?',[o.payment.id])).status,'RESOLVED');
    });
    await t.test('pause blocks new checkout and cancellation releases pending holds',async () => {
      const f=await fixture(2,2);await service.reserve(f.users[0],f.l.id,f.lv.id);await sale(f);const o=await service.checkout(f.users[0],checkout(f));
      await service.state(f.l.id,'PAUSED');await assert.rejects(()=>service.checkout(f.users[1],checkout(f)),/unavailable/);
      await service.state(f.l.id,'CANCELLED');assert.deepEqual(await counters(f),[0,0,0]);
      await service.payment(event(o));assert.deepEqual(await counters(f),[0,0,0]);
    });
    await t.test('SQL rejects cross-product variants and negative stock',async () => {
      const a=await fixture(), b=await fixture();
      await assert.rejects(()=>q('UPDATE launch_variants SET variant_id=? WHERE id=?',[b.lv.variant_id,a.lv.id]));
      await assert.rejects(()=>q('UPDATE launch_variants SET reserved_units=2 WHERE id=?',[a.lv.id]));
    });
    await t.test('money multiplication retains precision beyond JavaScript safe integers',async () => {
      const f=await fixture(1000,1000);await sale(f,true);await q('UPDATE launch_variants SET price_minor=999999999999999 WHERE id=?',[f.lv.id]);
      const o=await service.checkout(f.users[0],checkout(f,1000));assert.equal(o.total_minor,'999999999999999000');
    });
    await t.test('expiry during early access restores reservation and a later capture cannot consume its retry',async () => {
      const f=await fixture();await service.reserve(f.users[0],f.l.id,f.lv.id);await sale(f);
      const old=await service.checkout(f.users[0],checkout(f));
      await q("UPDATE orders SET payment_expires_at=now()-interval '1 minute' WHERE id=?",[old.id]);
      await service.expireOrder(old.id);assert.deepEqual(await counters(f),[1,0,0]);
      const next=await service.checkout(f.users[0],checkout(f));
      await service.payment(event(old));assert.deepEqual(await counters(f),[0,1,0]);
      await service.payment(event(next));assert.deepEqual(await counters(f),[0,0,1]);
    });
    await t.test('wrong payment amounts and provider identities leave stock untouched',async () => {
      const f=await fixture();await sale(f,true);const o=await service.checkout(f.users[0],checkout(f));
      await assert.rejects(()=>service.payment({...event(o),amountMinor:'1'}),/mismatch/);
      await assert.rejects(()=>service.payment({...event(o),currency:'USD'}),/mismatch/);
      assert.deepEqual(await counters(f),[0,1,0]);
      await service.payment(event(o));
      await assert.rejects(()=>service.payment({...event(o),providerPaymentId:'different'}),/mismatch/);
    });
    await t.test('scheduled expiry and reminders can run twice safely',async () => {
      const { CommerceJobs }=require('../dist/commerce/jobs');
      const f=await fixture();await service.reserve(f.users[0],f.l.id,f.lv.id);await sale(f);
      const jobs=new CommerceJobs(db,service);await jobs.tick();await jobs.tick();
      const notices=await q("SELECT * FROM notification_outbox WHERE user_id=? AND kind='EARLY_ACCESS_OPEN'",[f.users[0]]);assert.equal(notices.length,1);
      const o=await service.checkout(f.users[0],checkout(f));await q("UPDATE orders SET payment_expires_at=now()-interval '1 minute' WHERE id=?",[o.id]);
      await jobs.tick();await jobs.tick();assert.deepEqual(await counters(f),[1,0,0]);
      await sale(f,true);await jobs.tick();assert.deepEqual(await counters(f),[0,0,0]);
    });
    app=await require('../dist/main').createApp();await app.init();
    const api=request(app.getHttpServer());
    await t.test('auth registration, login and token contracts survive the service split', async () => {
      const email = randomUUID() + '@example.test';
      const password = 'long-test-password';
      const registration = await api.post('/auth/register').send({
        email: email.toUpperCase(), password, displayName: 'Auth Customer',
      }).expect(201);
      assert.deepEqual(Object.keys(registration.body).sort(), ['accessToken', 'user']);
      assert.deepEqual(Object.keys(registration.body.user).sort(), ['display_name', 'email', 'id']);
      assert.equal(registration.body.user.email, email);
      const stored = await one('SELECT role, status, password_hash FROM users WHERE id=?', [registration.body.user.id]);
      assert.equal(stored.role, 'CUSTOMER');
      assert.equal(stored.status, 'ACTIVE');
      assert.notEqual(stored.password_hash, password);
      await api.get('/me/orders').auth(registration.body.accessToken, { type: 'bearer' }).expect(200, []);

      const login = await api.post('/auth/login').send({ email: email.toUpperCase(), password }).expect(201);
      assert.deepEqual(Object.keys(login.body), ['accessToken']);
      await api.get('/me/orders').auth(login.body.accessToken, { type: 'bearer' }).expect(200, []);
      await api.post('/auth/register').send({ email, password, displayName: 'Duplicate' }).expect(409);
      for (const credentials of [
        { email, password: 'wrong-password-long' },
        { email: randomUUID() + '@example.test', password },
      ]) {
        const response = await api.post('/auth/login').send(credentials).expect(401);
        assert.equal(response.body.error.message, 'Invalid credentials');
      }

      const externalEmail = randomUUID() + '@example.test';
      await q("INSERT INTO users(email,display_name) VALUES (?,'External user')", [externalEmail]);
      await api.post('/auth/login').send({ email: externalEmail, password }).expect(401);
      await q("UPDATE users SET status='SUSPENDED' WHERE id=?", [registration.body.user.id]);
      await api.post('/auth/login').send({ email, password }).expect(401);
      await api.get('/me/orders').auth(login.body.accessToken, { type: 'bearer' }).expect(401);
    });
    await t.test('extracted auth DTOs retain validation and Swagger metadata', async () => {
      const valid = { email: randomUUID() + '@example.test', password: 'long-test-password', displayName: 'Customer' };
      for (const changes of [
        { email: 'invalid' }, { password: 'short' }, { password: 'x'.repeat(129) },
        { displayName: '' }, { displayName: 'x'.repeat(101) }, { displayName: null },
        { role: 'ADMIN' },
      ]) {
        await api.post('/auth/register').send({ ...valid, ...changes }).expect(400);
      }
      await api.post('/auth/register').send({ email: valid.email, password: valid.password }).expect(400);
      assert.equal(await one('SELECT id FROM users WHERE email=?', [valid.email]), undefined);
      await api.post('/auth/login').send({ email: valid.email, password: 'short' }).expect(400);

      const { body: spec } = await api.get('/openapi.json').expect(200);
      for (const [path, dto, response] of [
        ['/auth/register', 'RegisterDto', 'RegistrationResponse'],
        ['/auth/login', 'LoginDto', 'TokenResponse'],
      ]) {
        const operation = spec.paths[path].post;
        assert.equal(operation.requestBody.content['application/json'].schema.$ref, '#/components/schemas/' + dto);
        assert.equal(operation.responses['201'].content['application/json'].schema.$ref, '#/components/schemas/' + response);
        const schema = spec.components.schemas[dto];
        assert.ok(schema.required.includes('email'));
        assert.ok(schema.required.includes('password'));
        assert.equal(schema.properties.password.minLength, 12);
        assert.equal(schema.properties.password.maxLength, 128);
      }
      assert.ok(spec.components.schemas.RegisterDto.required.includes('displayName'));
    });
    await t.test('HTTP authentication, roles, validation, raw webhook signing and OpenAPI',async () => {
      await api.get('/me/orders').expect(401);
      const register=await api.post('/auth/register').send({email:randomUUID()+'@example.test',password:'long-test-password',displayName:'Customer'}).expect(201);
      const token=register.body.accessToken;
      await api.get('/admin/orders').auth(token,{type:'bearer'}).expect(403);
      await api.post('/checkout').auth(token,{type:'bearer'}).send({launchVariantId:randomUUID(),quantity:1,shippingAddress:address,idempotencyKey:randomUUID(),price_minor:'1'}).expect(400);
      await api.post('/checkout').auth(token,{type:'bearer'}).send({launchVariantId:randomUUID(),quantity:1,idempotencyKey:randomUUID()}).expect(400);
      const f=await fixture();await sale(f,true);const o=await service.checkout(f.users[0],checkout(f));
      await api.post('/payments/webhook').send(event(o)).expect(401);
      const raw=JSON.stringify(event(o)),ts=String(Math.floor(Date.now()/1000));
      const signature=createHmac('sha256',process.env.PAYMENT_WEBHOOK_SECRET!).update(ts+'.'+raw).digest('hex');
      await api.post('/payments/webhook').set('content-type','application/json').set('x-payment-timestamp',ts).set('x-payment-signature',signature).send(raw).expect(201);
      assert.deepEqual(await counters(f),[0,0,1]);
      const spec=await api.get('/openapi.json').expect(200);assert.ok(spec.body.paths['/checkout']);
      await api.get('/launches/not-a-uuid').expect(400);
      await q("UPDATE users SET role='ADMIN' WHERE id=?",[register.body.user.id]);
      await api.post('/admin/orders/'+o.id+'/refund').auth(token,{type:'bearer'}).expect(201);
      await service.payment(event(o,'REFUNDED'));
      await api.post('/admin/orders/'+o.id+'/refund').auth(token,{type:'bearer'}).expect(409);

      const category=await api.post('/admin/categories').auth(token,{type:'bearer'}).send({code:randomUUID(),slug:randomUUID(),nameKo:'테스트',nameEn:'Test'}).expect(201);
      await api.patch('/admin/categories/'+category.body.id).auth(token,{type:'bearer'}).send({code:category.body.code,slug:category.body.slug,nameKo:'테스트',nameEn:'Test',parentId:category.body.id}).expect(409);
      const product=await api.post('/admin/products').auth(token,{type:'bearer'}).send({categoryId:category.body.id,slug:randomUUID(),title:'Admin product',description:'Test',specifications:{},variants:[{sku:randomUUID(),optionValues:{}}]}).expect(201);
      const launch=await api.post('/admin/launches').auth(token,{type:'bearer'}).send({productId:product.body.id,reservationOpensAt:new Date(Date.now()-60000).toISOString(),reservationClosesAt:new Date(Date.now()+60000).toISOString(),saleOpensAt:new Date(Date.now()+120000).toISOString(),earlyAccessEndsAt:new Date(Date.now()+180000).toISOString(),saleEndsAt:new Date(Date.now()+240000).toISOString(),variants:[{variantId:product.body.variants[0].id,priceMinor:'1000',currency:'KRW',totalUnits:2,perCustomerLimit:1}]}).expect(201);
      await api.post('/admin/launches/'+launch.body.id+'/publish').auth(token,{type:'bearer'}).expect(201);
      const detail=await api.get('/launches/'+launch.body.id).expect(200);assert.equal(detail.body.phase,'RESERVATIONS_OPEN');
      await api.post('/launches/'+launch.body.id+'/variants/'+detail.body.variants[0].id+'/reservations').auth(token,{type:'bearer'}).expect(201);
      await q("UPDATE users SET status='SUSPENDED' WHERE id=?",[register.body.user.id]);
      await api.get('/admin/orders').auth(token,{type:'bearer'}).expect(401);

    });
  } finally { if(app) await app.close(); await orm.close(); }
});

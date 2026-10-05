# Preorder Commerce API

NestJS, TypeScript, PostgreSQL 16+, and MikroORM implementation of the supplied preorder commerce schema. This repository started empty. It contains a backend API and Swagger interface, not a customer storefront.

## Run locally

Requires Node.js 22+ and PostgreSQL 16+ (or Docker Compose).

```bash
npm ci
cp .env.example .env
# Replace both secrets in .env with independent random values.
docker compose up -d db
npm run migration:up
npm run seed
npm run dev
```

Swagger: `http://localhost:3000/docs`; OpenAPI JSON: `http://localhost:3000/openapi.json`. Run `npm run openapi:export` to publish a standalone `docs/openapi.json` for frontend integration (requires database access and configured environment). Both endpoints are disabled unless `ENABLE_DOCS=true`. Keep them disabled or protect them at your reverse proxy in production. `npm run build && npm start` runs the compiled application. Migrations are explicit deployment steps; startup never changes the schema.

To provision an initial admin, set `ADMIN_EMAIL` and `ADMIN_PASSWORD` in your environment and run `npm run seed`. No default admin password is supplied. Seeding never promotes an existing customer or resets an existing account. Registration always creates customers. Tokens expire after one hour; sign in again to renew. Guards re-read account role and suspension status on every protected request.

## Implemented behavior

- All eleven supplied SQL tables, plus a notification outbox and payment reconciliation queue, are mapped to MikroORM entities. Migrations retain the original checks, expression/partial indexes, and composite foreign keys.
- Email/password registration and login, bearer authentication, server-enforced admin permissions, strict DTO validation, response schemas, and documented error examples.
- Bilingual category seeds, category editing with cycle prevention, products, variants, images, draft inventory/schedule editing, publication, pause/resume, and cancellation.
- Public category/launch listing and launch detail with computed phases and availability. Lists currently return at most 100 entries; cursor pagination and broader catalog search are future extensions.
- Guaranteed free reservations, reservation cancellation during the reservation window, early checkout of exactly one held unit, public checkout, customer order history, and fulfillment transitions.
- Transactional stock allocation, database row locks, cross-order customer limits, immutable purchase/address snapshots, and exact integer money calculations with `BigInt`. Monetary values in requests/responses are decimal strings.
- Client UUID checkout keys make retries idempotent; reuse with a different customer or payload returns 409. Repeated reservations return the existing reservation while the reservation window is open.
- Signed payment adapter webhooks, idempotent capture/failure/refund handling, expiry jobs, late-capture refund reconciliation, and admin refund requests.
- Durable, deduplicated early-access and order-paid notification events. No external notifications are sent by this project.

## API walkthrough

1. Register or sign in at `POST /auth/register` or `POST /auth/login`.
2. As admin, create a category, then `POST /admin/products` with variants and optional images. Products created through this API are initially active; launches start as drafts.
3. `POST /admin/launches` supplies the product, five schedule timestamps, and each variant's price, currency, confirmed stock and customer limit. Publish with `POST /admin/launches/:id/publish`.
4. Read `GET /launches/:id`. Its `variants[].id` is the **launch-variant ID**, used in reservation routes and checkout; it differs from the underlying catalog variant ID.
5. Reserve with `POST /launches/:id/variants/:variantId/reservations`. During early access, only the reservation owner can buy that unit. During public sale, remaining active reservations are released in the checkout transaction.
6. Call `POST /checkout` with this shape and the customer's bearer token:

```json
{
  "launchVariantId": "00000000-0000-4000-8000-000000000001",
  "quantity": 1,
  "idempotencyKey": "00000000-0000-4000-8000-000000000002",
  "shippingAddress": {
    "recipient": "Customer",
    "phone": "01012345678",
    "country": "KR",
    "postalCode": "12345",
    "line1": "Delivery address"
  }
}
```

The response includes the order, immutable items and an initiated payment record. Optional `reservationId` must match the customer's active reservation and is rejected after early access. Prices, statuses, user IDs and counters cannot be supplied by customers.

## Payment adapter contract

**A real payment provider is not connected.** Checkout persists a hold and payment intent; it does not charge a card or return a hosted payment URL. Connect a trusted server-side adapter that reads the stored payment amount, currency and `idempotency_key`, calls your provider outside the database transaction, and maps verified provider events to this API. Never give its signing secret to a browser.

`POST /payments/webhook` accepts:

```json
{
  "paymentId": "00000000-0000-4000-8000-000000000003",
  "providerPaymentId": "provider-transaction-id",
  "status": "CAPTURED",
  "amountMinor": "19900",
  "currency": "KRW"
}
```

Statuses: `CAPTURED`, `FAILED`, `REFUNDED`. The adapter must send `x-payment-timestamp` (Unix seconds) and `x-payment-signature` (hex HMAC-SHA256 with `PAYMENT_WEBHOOK_SECRET` over `timestamp + '.' + exact raw JSON body`). Timestamps outside a five-minute window are rejected. Validate the actual provider's native signature in your adapter before forwarding an event. The generic HMAC contract is not advertised as a specific provider's native protocol.

Late capture or capture of a cancelled order records the money as captured but queues a refund without allocating inventory. A reconciliation worker/operator must process `GET /admin/payment-reconciliations` using provider idempotency keys, issue actual refunds, and report `REFUNDED`. `POST /admin/orders/:id/refund` queues a request; it does **not** itself refund money. Provider polling and automatic refund execution must be implemented in that adapter. Refunded units are not automatically restocked: returned goods need inspection and an explicit restock policy.

## Chosen launch policies

- One reservation per customer per launch variant; multiple variants may be reserved.
- Launch schedules explicitly define early-access length. All timestamp inputs require a timezone offset or `Z`.
- Payment holds default to 15 minutes (`PAYMENT_HOLD_MINUTES`, 1–60). A hold may outlive early access or sale end; capture before its own deadline remains valid unless the launch was cancelled.
- Pause blocks new activity and honors existing holds. Cancel releases active reservations and pending holds, and honors already paid orders. Admins can separately request refunds for paid orders.
- Payment failure/expiry restores the linked reservation only before early access ends and while the launch is published or paused; otherwise it releases inventory.
- Schedules, prices, confirmed stock and customer limits are editable only while draft. This keeps existing promises stable.
- Each checkout contains one launch variant. Shipping is currently free, and prices are treated as final tax-inclusive amounts. Shipping zones, tax calculations, coupons, returns, consent and adult age verification are not inferred from the sample document. Adult products are blocked from reservation/checkout until age verification exists.

## Concurrency and persistence

Critical writes run inside MikroORM transactions with explicit SQL using the transaction's connection context. Lock order is launch, launch variant, then order/reservation/payment. Serializing by launch also makes pause/cancel atomic relative to customer operations; it favors correctness over maximal throughput. Checkout keys additionally use transaction-scoped advisory locks. SQL migrations are authoritative; do not run ORM schema-update tools against production. Entity schemas map scalar foreign-key columns; composite relationships and indexes are expressed in the reviewed migrations.

The 30-second worker expires pending orders and reservations and produces early-access reminders. It is safe to rerun and supports multiple application instances through row locks and unique event keys. Checkout and callbacks enforce timestamps independently of the worker. Notification transport, delivery retries, provider reconciliation and operational alerting require provider-specific workers.

## Tests

```bash
npm test
# Full integration suite: use a dedicated disposable database ending in _test.
TEST_DATABASE_URL=postgresql://user:password@localhost:5432/preorder_test npm test
```

The integration suite applies migrations and creates isolated fixtures in that database. It does not drop existing data. Without `TEST_DATABASE_URL`, PostgreSQL/HTTP tests are explicitly skipped. Tests cover concurrent reservations/checkouts, duplicate requests/captures, customer limits, exact money arithmetic, failure restoration, expiry/late refunds, pause/cancel, SQL constraints, HTTP authentication/roles/validation, signed raw-body webhooks and OpenAPI generation.

Before deployment, select and connect payment and notification providers, define business policies above, provision secrets/TLS, and add deployment-specific rate limits, monitoring and database backups. No provider accounts or external messaging were used during implementation.

Framework references: [NestJS authentication](https://docs.nestjs.com/security/authentication), [NestJS OpenAPI](https://docs.nestjs.com/openapi/introduction), [MikroORM migrations](https://mikro-orm.io/docs/migrations).

import { Migration } from '@mikro-orm/migrations';
export class Migration202609240002 extends Migration {
  async up(): Promise<void> {
    this.addSql(`
      ALTER TABLE orders ADD COLUMN checkout_key uuid UNIQUE;
      ALTER TABLE orders ADD COLUMN request_fingerprint text;
      CREATE TABLE payment_reconciliations (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        payment_id uuid NOT NULL UNIQUE REFERENCES payments(id),
        reason text NOT NULL,
        status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','RESOLVED')),
        created_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE notification_outbox (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id),
        dedupe_key text NOT NULL UNIQUE,
        kind text NOT NULL,
        payload jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        delivered_at timestamptz
      );
    `);
  }
  async down(): Promise<void> {
    this.addSql('DROP TABLE notification_outbox, payment_reconciliations; ALTER TABLE orders DROP COLUMN checkout_key, DROP COLUMN request_fingerprint;');
  }
}

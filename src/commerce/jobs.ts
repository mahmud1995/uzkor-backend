import { Injectable, Logger } from "@nestjs/common";
import { Interval } from "@nestjs/schedule";
import { Db } from "../database/db";
import { CommerceService } from "./service";
@Injectable()
export class CommerceJobs {
  private busy = false;
  private logger = new Logger("CommerceJobs");
  constructor(
    private db: Db,
    private service: CommerceService,
  ) {}
  @Interval(30000) async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const orders = await this.db.query(
        "SELECT id FROM orders WHERE status='PENDING_PAYMENT' AND payment_expires_at<=now() ORDER BY payment_expires_at LIMIT 100",
      );
      for (const o of orders) await this.service.expireOrder(o.id);
      const variants = await this.db.query(
        "SELECT DISTINCT lv.id FROM launch_variants lv JOIN launches l ON l.id=lv.launch_id WHERE l.early_access_ends_at<=now() AND lv.reserved_units>0 LIMIT 100",
      );
      for (const v of variants)
        await this.db.tx(async (db) => {
          const locked = await this.service.lock(db, v.id);
          await this.service.expireReservations(
            db,
            locked.launch,
            locked.variant,
            new Date(),
          );
        });
      await this.db
        .query(`INSERT INTO notification_outbox(user_id,dedupe_key,kind,payload)
        SELECT r.user_id,'early:' || r.id,'EARLY_ACCESS_OPEN',jsonb_build_object('launchId',l.id,'reservationId',r.id)
        FROM reservations r JOIN launch_variants lv ON lv.id=r.launch_variant_id JOIN launches l ON l.id=lv.launch_id
        WHERE r.status='ACTIVE' AND l.state='PUBLISHED' AND l.sale_opens_at<=now() AND l.early_access_ends_at>now()
        ON CONFLICT (dedupe_key) DO NOTHING`);
    } catch (error) {
      this.logger.error(error);
    } finally {
      this.busy = false;
    }
  }
}

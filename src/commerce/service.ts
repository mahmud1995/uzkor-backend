import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { randomUUID, createHash } from "node:crypto";
import { Db, Row } from "../database/db";
import { available, phase } from "../common/domain";
import { CheckoutDto, WebhookDto } from "./dto";
@Injectable()
export class CommerceService {
  constructor(private db: Db) {}
  // Every mutation locks launch -> launch_variant -> order/reservation/payment.
  // Launch locks also serialize pause/cancel against customer writes.
  async lock(db: Db, id: string) {
    const ref = await db.one(
      "SELECT launch_id FROM launch_variants WHERE id=?",
      [id],
    );
    if (!ref) throw new NotFoundException("Variant not found");
    const launch = (await db.one(
      "SELECT * FROM launches WHERE id=? FOR UPDATE",
      [ref.launch_id],
    ))!;
    const variant = (await db.one(
      "SELECT lv.*, v.sku, v.option_values, v.is_active, p.title, p.status AS product_status, p.is_adult_content FROM launch_variants lv JOIN product_variants v ON v.id=lv.variant_id JOIN products p ON p.id=lv.product_id WHERE lv.id=? FOR UPDATE OF lv",
      [id],
    ))!;
    return { launch, variant };
  }
  requireSellable(l: Row, v: Row) {
    if (
      l.state !== "PUBLISHED" ||
      !v.is_active ||
      v.product_status !== "ACTIVE"
    )
      throw new ConflictException("Launch unavailable");
    if (v.is_adult_content)
      throw new ForbiddenException(
        "Age verification is required and has not been configured",
      );
  }
  async expireReservations(db: Db, l: Row, v: Row, now: Date) {
    if (+now < +new Date(l.early_access_ends_at)) return;
    const expired = await db.query(
      "UPDATE reservations SET status='EXPIRED',updated_at=now() WHERE launch_variant_id=? AND status='ACTIVE' RETURNING id",
      [v.id],
    );
    if (expired.length) {
      await db.query(
        "UPDATE launch_variants SET reserved_units=reserved_units-? WHERE id=?",
        [expired.length, v.id],
      );
      v.reserved_units -= expired.length;
    }
  }
  async reserve(userId: string, launchId: string, variantId: string) {
    return this.db.tx(async (db) => {
      const { launch: l, variant: v } = await this.lock(db, variantId);
      if (l.id !== launchId) throw new NotFoundException();
      this.requireSellable(l, v);
      if (phase(l) !== "RESERVATIONS_OPEN")
        throw new ConflictException("Reservation window is closed");
      const existing = await db.one(
        "SELECT * FROM reservations WHERE user_id=? AND launch_variant_id=? AND status IN ('ACTIVE','CONVERTED')",
        [userId, v.id],
      );
      if (existing) return existing;
      if (available(v) < 1) throw new ConflictException("Sold out");
      const r = await db.one(
        "INSERT INTO reservations(user_id,launch_variant_id) VALUES (?,?) RETURNING *",
        [userId, v.id],
      );
      await db.query(
        "UPDATE launch_variants SET reserved_units=reserved_units+1 WHERE id=?",
        [v.id],
      );
      return r;
    });
  }
  async cancelReservation(userId: string, id: string) {
    return this.db.tx(async (db) => {
      const ref = await db.one(
        "SELECT * FROM reservations WHERE id=? AND user_id=?",
        [id, userId],
      );
      if (!ref) throw new NotFoundException();
      const { launch: l, variant: v } = await this.lock(
        db,
        ref.launch_variant_id,
      );
      const r = (await db.one(
        "SELECT * FROM reservations WHERE id=? FOR UPDATE",
        [id],
      ))!;
      if (r.status === "CANCELLED") return r;
      if (phase(l) !== "RESERVATIONS_OPEN" || r.status !== "ACTIVE")
        throw new ConflictException("Reservation edits closed");
      await db.query(
        "UPDATE launch_variants SET reserved_units=reserved_units-1 WHERE id=?",
        [v.id],
      );
      return db.one(
        "UPDATE reservations SET status='CANCELLED',updated_at=now() WHERE id=? RETURNING *",
        [id],
      );
    });
  }
  async checkout(userId: string, d: CheckoutDto) {
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          d.launchVariantId,
          d.quantity,
          d.reservationId ?? null,
          [
            d.shippingAddress.recipient,
            d.shippingAddress.phone,
            d.shippingAddress.country,
            d.shippingAddress.postalCode,
            d.shippingAddress.line1,
            d.shippingAddress.line2 ?? null,
          ],
        ]),
      )
      .digest("hex");
    return this.db.tx(async (db) => {
      // Serializes duplicate keys even if two requests name different variants.
      await db.query("SELECT pg_advisory_xact_lock(hashtextextended(?,0))", [
        d.idempotencyKey,
      ]);
      const existing = await db.one(
        "SELECT * FROM orders WHERE checkout_key=?",
        [d.idempotencyKey],
      );
      if (existing) {
        if (
          existing.user_id !== userId ||
          existing.request_fingerprint !== fingerprint
        )
          throw new ConflictException(
            "Idempotency key already used for another request",
          );
        return this.orderResult(db, existing);
      }
      const { launch: l, variant: v } = await this.lock(db, d.launchVariantId);
      const now = new Date();
      this.requireSellable(l, v);
      await this.expireReservations(db, l, v, now);
      const currentPhase = phase(l, now);
      if (!["EARLY_ACCESS", "PUBLIC_SALE"].includes(currentPhase))
        throw new ConflictException("Sale is not open");
      const count = await db.one(
        "SELECT coalesce(sum(i.quantity),0) AS quantity FROM order_items i JOIN orders o ON o.id=i.order_id WHERE i.launch_variant_id=? AND o.user_id=? AND o.status IN ('PENDING_PAYMENT','PAID','FULFILLING','SHIPPED','DELIVERED')",
        [v.id, userId],
      );
      if (Number(count?.quantity) + d.quantity > v.per_customer_limit)
        throw new ConflictException("Per-customer limit exceeded");
      let reservation: Row | undefined;
      if (currentPhase === "EARLY_ACCESS") {
        reservation = await db.one(
          "SELECT * FROM reservations WHERE launch_variant_id=? AND user_id=? AND status='ACTIVE' FOR UPDATE",
          [v.id, userId],
        );
        if (
          !reservation ||
          (d.reservationId && d.reservationId !== reservation.id)
        )
          throw new ForbiddenException("An active reservation is required");
        if (d.quantity !== 1)
          throw new ConflictException("A reservation holds exactly one unit");
      } else {
        if (d.reservationId)
          throw new ConflictException(
            "Reservations cannot be used after early access",
          );
        if (available(v) < d.quantity) throw new ConflictException("Sold out");
      }
      const totalValue = BigInt(v.price_minor) * BigInt(d.quantity);
      if (totalValue > 9223372036854775807n)
        throw new ConflictException("Order total exceeds supported amount");
      const total = totalValue.toString();
      const hold = Number(process.env.PAYMENT_HOLD_MINUTES ?? 15);
      const expires = new Date(+now + hold * 60000);
      const order = (await db.one(
        "INSERT INTO orders(order_number,user_id,currency,subtotal_minor,total_minor,shipping_address,payment_expires_at,checkout_key,request_fingerprint) VALUES (?,?,?,?,?,?,?,?,?) RETURNING *",
        [
          `PO-${randomUUID()}`,
          userId,
          v.currency,
          total,
          total,
          JSON.stringify(d.shippingAddress),
          expires,
          d.idempotencyKey,
          fingerprint,
        ],
      ))!;
      await db.query(
        "INSERT INTO order_items(order_id,launch_variant_id,reservation_id,product_title_snapshot,sku_snapshot,option_values_snapshot,quantity,unit_price_minor,line_total_minor) VALUES (?,?,?,?,?,?,?,?,?)",
        [
          order.id,
          v.id,
          reservation?.id ?? null,
          v.title,
          v.sku,
          JSON.stringify(v.option_values),
          d.quantity,
          v.price_minor,
          total,
        ],
      );
      if (reservation)
        await db.query(
          "UPDATE reservations SET status='CONVERTED',converted_at=now(),updated_at=now() WHERE id=?",
          [reservation.id],
        );
      await db.query(
        "UPDATE launch_variants SET reserved_units=reserved_units-?,checkout_held_units=checkout_held_units+? WHERE id=?",
        [reservation ? 1 : 0, d.quantity, v.id],
      );
      await db.query(
        "INSERT INTO payments(order_id,provider,idempotency_key,amount_minor) VALUES (?,'adapter',?,?)",
        [order.id, order.id, total],
      );
      return this.orderResult(db, order);
    });
  }
  async orderResult(db: Db, order: Row) {
    return {
      ...order,
      items: await db.query("SELECT * FROM order_items WHERE order_id=?", [
        order.id,
      ]),
      payment: await db.one("SELECT * FROM payments WHERE order_id=?", [
        order.id,
      ]),
    };
  }
  async release(db: Db, order: Row, item: Row, l: Row, now: Date) {
    if (order.status !== "PENDING_PAYMENT") return;
    const restore =
      item.reservation_id &&
      ["PUBLISHED", "PAUSED"].includes(l.state) &&
      +now < +new Date(l.early_access_ends_at);
    await db.query(
      "UPDATE launch_variants SET checkout_held_units=checkout_held_units-?,reserved_units=reserved_units+? WHERE id=?",
      [item.quantity, restore ? 1 : 0, item.launch_variant_id],
    );
    if (item.reservation_id)
      await db.query(
        "UPDATE reservations SET status=?,converted_at=NULL,updated_at=now() WHERE id=?",
        [restore ? "ACTIVE" : "EXPIRED", item.reservation_id],
      );
    await db.query("UPDATE orders SET status='CANCELLED' WHERE id=?", [
      order.id,
    ]);
    await db.query(
      "UPDATE payments SET status='FAILED',updated_at=now() WHERE order_id=? AND status IN ('INITIATED','AUTHORIZED')",
      [order.id],
    );
    order.status = "CANCELLED";
  }
  async payment(event: WebhookDto) {
    return this.db.tx(async (db) => {
      const ref = await db.one(
        "SELECT p.order_id,i.* FROM payments p JOIN order_items i ON i.order_id=p.order_id WHERE p.id=?",
        [event.paymentId],
      );
      if (!ref) throw new NotFoundException();
      const { launch: l } = await this.lock(db, ref.launch_variant_id);
      const o = (await db.one("SELECT * FROM orders WHERE id=? FOR UPDATE", [
        ref.order_id,
      ]))!;
      const p = (await db.one("SELECT * FROM payments WHERE id=? FOR UPDATE", [
        event.paymentId,
      ]))!;
      if (
        BigInt(p.amount_minor) !== BigInt(event.amountMinor) ||
        o.currency !== event.currency
      )
        throw new ConflictException("Payment amount/currency mismatch");
      if (
        p.provider_payment_id &&
        p.provider_payment_id !== event.providerPaymentId
      )
        throw new ConflictException("Provider payment ID mismatch");
      await db.query(
        "UPDATE payments SET provider_payment_id=?,updated_at=now() WHERE id=?",
        [event.providerPaymentId, p.id],
      );
      const now = new Date();
      if (event.status === "REFUNDED") {
        if (!["CAPTURED", "REFUNDED"].includes(p.status))
          throw new ConflictException("Payment has not been captured");
        await db.query(
          "UPDATE payments SET status='REFUNDED',updated_at=now() WHERE id=?",
          [p.id],
        );
        if (o.status !== "CANCELLED")
          await db.query("UPDATE orders SET status='REFUNDED' WHERE id=?", [
            o.id,
          ]);
        await db.query(
          "UPDATE payment_reconciliations SET status='RESOLVED' WHERE payment_id=?",
          [p.id],
        );
        return { accepted: true };
      }
      if (["CAPTURED", "REFUNDED"].includes(p.status))
        return { accepted: true };
      if (event.status === "FAILED") {
        await this.release(db, o, ref, l, now);
        return { accepted: true };
      }
      if (
        o.status === "PENDING_PAYMENT" &&
        +now < +new Date(o.payment_expires_at) &&
        l.state !== "CANCELLED"
      ) {
        await db.query(
          "UPDATE launch_variants SET checkout_held_units=checkout_held_units-?,sold_units=sold_units+? WHERE id=?",
          [ref.quantity, ref.quantity, ref.launch_variant_id],
        );
        await db.query(
          "UPDATE orders SET status='PAID',paid_at=now() WHERE id=?",
          [o.id],
        );
        await db.query(
          "INSERT INTO notification_outbox(user_id,dedupe_key,kind,payload) VALUES (?,?,'ORDER_PAID',?) ON CONFLICT (dedupe_key) DO NOTHING",
          [o.user_id, `paid:${o.id}`, JSON.stringify({ orderId: o.id })],
        );
      } else {
        await this.release(db, o, ref, l, now);
        await db.query(
          "INSERT INTO payment_reconciliations(payment_id,reason) VALUES (?,'CAPTURE_AFTER_RELEASE_REQUIRES_REFUND') ON CONFLICT (payment_id) DO NOTHING",
          [p.id],
        );
      }
      await db.query(
        "UPDATE payments SET status='CAPTURED',updated_at=now() WHERE id=?",
        [p.id],
      );
      return { accepted: true };
    });
  }
  async expireOrder(id: string) {
    return this.db.tx(async (db) => {
      const item = await db.one("SELECT * FROM order_items WHERE order_id=?", [
        id,
      ]);
      if (!item) return;
      const { launch: l } = await this.lock(db, item.launch_variant_id);
      const o = (await db.one("SELECT * FROM orders WHERE id=? FOR UPDATE", [
        id,
      ]))!;
      const now = new Date();
      if (+new Date(o.payment_expires_at) <= +now)
        await this.release(db, o, item, l, now);
    });
  }
  async state(id: string, state: string) {
    return this.db.tx(async (db) => {
      const l = await db.one("SELECT * FROM launches WHERE id=? FOR UPDATE", [
        id,
      ]);
      if (!l) throw new NotFoundException();
      if (l.state === state) return l;
      if (!["PUBLISHED", "PAUSED"].includes(l.state))
        throw new ConflictException("Launch cannot change state");
      const variants = await db.query(
        "SELECT * FROM launch_variants WHERE launch_id=? ORDER BY id FOR UPDATE",
        [id],
      );
      if (state === "CANCELLED")
        for (const v of variants) {
          const cancelled = await db.query(
            "UPDATE reservations SET status='CANCELLED',updated_at=now() WHERE launch_variant_id=? AND status='ACTIVE' RETURNING id",
            [v.id],
          );
          await db.query(
            "UPDATE launch_variants SET reserved_units=reserved_units-? WHERE id=?",
            [cancelled.length, v.id],
          );
          const pending = await db.query(
            "SELECT o.*,i.quantity,i.reservation_id,i.launch_variant_id FROM orders o JOIN order_items i ON o.id=i.order_id WHERE i.launch_variant_id=? AND o.status='PENDING_PAYMENT' FOR UPDATE OF o",
            [v.id],
          );
          for (const o of pending)
            await this.release(
              db,
              o,
              o,
              { ...l, state: "CANCELLED" },
              new Date(),
            );
        }
      return db.one(
        "UPDATE launches SET state=?,updated_at=now() WHERE id=? RETURNING *",
        [state, id],
      );
    });
  }
}

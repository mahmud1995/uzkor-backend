import { ApiCreatedResponse, ApiOkResponse } from "@nestjs/swagger";
import {
  TokenResponse,
  RegistrationResponse,
  CategoriesResponse,
  ProductDetailResponse,
  ProductsResponse,
  ProductVariantsResponse,
  ProductImagesResponse,
  LaunchVariantsResponse,
  LaunchesResponse,
  ReservationsResponse,
  CheckoutResponse,
  OrdersResponse,
  ReconciliationResponse,
  WebhookResponse,
} from "../common/responses";
import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Headers,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  RawBodyRequest,
  Req,
  UnauthorizedException,
} from "@nestjs/common";
import { ApiBearerAuth, ApiHeader, ApiTags } from "@nestjs/swagger";
import { Request } from "express";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Admin, Public } from "../auth/auth.decorators";
import { Db } from "../database/db";
import { CommerceService } from "./service";
import { CheckoutDto, WebhookDto } from "./dto";
import { FulfillmentDto, LaunchStateDto } from "../catalog/dto";
@ApiTags("Reservations", "Checkout", "Orders")
@ApiBearerAuth()
@Controller()
export class CommerceController {
  constructor(
    private service: CommerceService,
    private db: Db,
  ) {}
  @ApiCreatedResponse({ type: ReservationsResponse })
  @Post("launches/:id/variants/:variantId/reservations")
  reserve(
    @Req() req: any,
    @Param("id", ParseUUIDPipe) id: string,
    @Param("variantId", ParseUUIDPipe) variantId: string,
  ) {
    return this.service.reserve(req.user.id, id, variantId);
  }
  @ApiOkResponse({ type: ReservationsResponse })
  @Delete("reservations/:id")
  cancel(@Req() req: any, @Param("id", ParseUUIDPipe) id: string) {
    return this.service.cancelReservation(req.user.id, id);
  }
  @Get("me/reservations") reservations(@Req() req: any) {
    return this.db.query(
      "SELECT * FROM reservations WHERE user_id=? ORDER BY reserved_at DESC LIMIT 100",
      [req.user.id],
    );
  }
  @ApiCreatedResponse({ type: CheckoutResponse }) @Post("checkout") checkout(
    @Req() req: any,
    @Body() dto: CheckoutDto,
  ) {
    return this.service.checkout(req.user.id, dto);
  }
  @Get("me/orders") orders(@Req() req: any) {
    return this.db.query(
      "SELECT * FROM orders WHERE user_id=? ORDER BY placed_at DESC LIMIT 100",
      [req.user.id],
    );
  }
  @Get("me/orders/:id") async order(
    @Req() req: any,
    @Param("id", ParseUUIDPipe) id: string,
  ) {
    const o = await this.db.one(
      "SELECT * FROM orders WHERE id=? AND user_id=?",
      [id, req.user.id],
    );
    if (!o) throw new NotFoundException();
    return this.service.orderResult(this.db, o);
  }
  @Admin()
  @ApiOkResponse({ type: LaunchesResponse })
  @Patch("admin/launches/:id/state")
  state(@Param("id", ParseUUIDPipe) id: string, @Body() d: LaunchStateDto) {
    return this.service.state(id, d.state);
  }
  @Admin()
  @ApiOkResponse({ type: OrdersResponse })
  @Patch("admin/orders/:id/fulfillment")
  async fulfillment(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() d: FulfillmentDto,
  ) {
    const from: Record<string, string> = {
      FULFILLING: "PAID",
      SHIPPED: "FULFILLING",
      DELIVERED: "SHIPPED",
    };
    const o = await this.db.one(
      "UPDATE orders SET status=? WHERE id=? AND status=? RETURNING *",
      [d.status, id, from[d.status]],
    );
    if (!o) throw new ConflictException("Invalid fulfillment transition");
    return o;
  }
  @Admin()
  @ApiCreatedResponse({ type: ReconciliationResponse })
  @Post("admin/orders/:id/refund")
  async refund(@Param("id", ParseUUIDPipe) id: string) {
    return this.db.tx(async (db) => {
      const p = await db.one(
        "SELECT * FROM payments WHERE order_id=? AND status='CAPTURED' FOR UPDATE",
        [id],
      );
      if (!p) throw new ConflictException("No captured payment");
      return db.one(
        "INSERT INTO payment_reconciliations(payment_id,reason) VALUES (?,'ADMIN_REFUND_REQUEST') ON CONFLICT (payment_id) DO UPDATE SET payment_id=excluded.payment_id RETURNING *",
        [p.id],
      );
    });
  }
  @Admin() @Get("admin/payment-reconciliations") reconciliation() {
    return this.db.query(
      "SELECT r.*,p.provider_payment_id,p.amount_minor FROM payment_reconciliations r JOIN payments p ON p.id=r.payment_id WHERE r.status='PENDING' ORDER BY r.created_at LIMIT 100",
    );
  }
  @Admin() @Get("admin/notifications") notifications() {
    return this.db.query(
      "SELECT * FROM notification_outbox WHERE delivered_at IS NULL ORDER BY created_at LIMIT 100",
    );
  }
}
@ApiTags("Payments")
@Public()
@Controller("payments")
export class PaymentsController {
  constructor(private service: CommerceService) {}
  @ApiHeader({
    name: "x-payment-timestamp",
    description: "Unix timestamp in seconds; maximum age 5 minutes.",
  })
  @ApiHeader({
    name: "x-payment-signature",
    description: "Hex HMAC-SHA256 of timestamp + dot + exact raw JSON body.",
  })
  @ApiCreatedResponse({ type: WebhookResponse })
  @Post("webhook")
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers("x-payment-timestamp") timestamp: string,
    @Headers("x-payment-signature") signature: string,
    @Body() d: WebhookDto,
  ) {
    const secret = process.env.PAYMENT_WEBHOOK_SECRET;
    if (
      !secret ||
      !req.rawBody ||
      !/^\d+$/.test(timestamp ?? "") ||
      Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
      !/^[a-f0-9]{64}$/i.test(signature ?? "")
    )
      throw new UnauthorizedException("Invalid webhook signature");
    const expected = createHmac("sha256", secret)
      .update(timestamp + ".")
      .update(req.rawBody)
      .digest();
    if (!timingSafeEqual(expected, Buffer.from(signature, "hex")))
      throw new UnauthorizedException("Invalid webhook signature");
    return this.service.payment(d);
  }
}

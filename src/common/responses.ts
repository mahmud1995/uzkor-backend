import { ApiProperty } from "@nestjs/swagger";
export class UsersResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({}) email!: string;
  @ApiProperty({}) display_name!: string;
  @ApiProperty({ nullable: true }) phone!: string;
  @ApiProperty({}) role!: string;
  @ApiProperty({}) status!: string;
  @ApiProperty({ format: "date-time", nullable: true })
  email_verified_at!: string;
  @ApiProperty({ format: "date-time" }) created_at!: string;
  @ApiProperty({ format: "date-time" }) updated_at!: string;
}
export class CategoriesResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid", nullable: true }) parent_id!: string;
  @ApiProperty({}) code!: string;
  @ApiProperty({}) slug!: string;
  @ApiProperty({}) name_ko!: string;
  @ApiProperty({}) name_en!: string;
  @ApiProperty({}) sort_order!: number;
  @ApiProperty({}) is_active!: boolean;
  @ApiProperty({ format: "date-time" }) created_at!: string;
}
export class ProductsResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({}) slug!: string;
  @ApiProperty({ format: "uuid" }) category_id!: string;
  @ApiProperty({}) title!: string;
  @ApiProperty({ nullable: true }) subtitle!: string;
  @ApiProperty({}) description!: string;
  @ApiProperty({ nullable: true }) brand_name!: string;
  @ApiProperty({ type: Object }) specifications!: Record<string, unknown>;
  @ApiProperty({}) status!: string;
  @ApiProperty({}) is_adult_content!: boolean;
  @ApiProperty({ format: "uuid", nullable: true }) created_by!: string;
  @ApiProperty({ format: "uuid", nullable: true }) updated_by!: string;
  @ApiProperty({ format: "date-time" }) created_at!: string;
  @ApiProperty({ format: "date-time" }) updated_at!: string;
}
export class ProductImagesResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) product_id!: string;
  @ApiProperty({}) image_url!: string;
  @ApiProperty({ nullable: true }) alt_text!: string;
  @ApiProperty({}) position!: number;
  @ApiProperty({}) is_cover!: boolean;
}
export class ProductVariantsResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) product_id!: string;
  @ApiProperty({}) sku!: string;
  @ApiProperty({ type: Object }) option_values!: Record<string, unknown>;
  @ApiProperty({}) is_active!: boolean;
  @ApiProperty({ format: "date-time" }) created_at!: string;
}
export class LaunchesResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) product_id!: string;
  @ApiProperty({ nullable: true }) title_override!: string;
  @ApiProperty({ nullable: true }) summary!: string;
  @ApiProperty({}) state!: string;
  @ApiProperty({ format: "date-time", nullable: true }) published_at!: string;
  @ApiProperty({ format: "date-time" }) reservation_opens_at!: string;
  @ApiProperty({ format: "date-time" }) reservation_closes_at!: string;
  @ApiProperty({ format: "date-time" }) sale_opens_at!: string;
  @ApiProperty({ format: "date-time" }) early_access_ends_at!: string;
  @ApiProperty({ format: "date-time" }) sale_ends_at!: string;
  @ApiProperty({ format: "uuid", nullable: true }) created_by!: string;
  @ApiProperty({ format: "date-time" }) created_at!: string;
  @ApiProperty({ format: "date-time" }) updated_at!: string;
}
export class LaunchVariantsResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) launch_id!: string;
  @ApiProperty({ format: "uuid" }) product_id!: string;
  @ApiProperty({ format: "uuid" }) variant_id!: string;
  @ApiProperty({
    example: "19900",
    description: "Integer minor units serialized as a decimal string",
  })
  price_minor!: string;
  @ApiProperty({}) currency!: string;
  @ApiProperty({}) total_units!: number;
  @ApiProperty({}) reserved_units!: number;
  @ApiProperty({}) checkout_held_units!: number;
  @ApiProperty({}) sold_units!: number;
  @ApiProperty({}) per_customer_limit!: number;
  @ApiProperty({ format: "date-time" }) created_at!: string;
}
export class ReservationsResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) user_id!: string;
  @ApiProperty({ format: "uuid" }) launch_variant_id!: string;
  @ApiProperty({}) status!: string;
  @ApiProperty({ format: "date-time" }) reserved_at!: string;
  @ApiProperty({ format: "date-time", nullable: true }) converted_at!: string;
  @ApiProperty({ format: "date-time" }) updated_at!: string;
}
export class OrdersResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({}) order_number!: string;
  @ApiProperty({ format: "uuid" }) user_id!: string;
  @ApiProperty({}) status!: string;
  @ApiProperty({}) currency!: string;
  @ApiProperty({
    example: "19900",
    description: "Integer minor units serialized as a decimal string",
  })
  subtotal_minor!: string;
  @ApiProperty({
    example: "19900",
    description: "Integer minor units serialized as a decimal string",
  })
  shipping_minor!: string;
  @ApiProperty({
    example: "19900",
    description: "Integer minor units serialized as a decimal string",
  })
  total_minor!: string;
  @ApiProperty({ type: Object }) shipping_address!: Record<string, unknown>;
  @ApiProperty({ format: "date-time" }) payment_expires_at!: string;
  @ApiProperty({ format: "date-time" }) placed_at!: string;
  @ApiProperty({ format: "date-time", nullable: true }) paid_at!: string;
}
export class OrderItemsResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) order_id!: string;
  @ApiProperty({ format: "uuid" }) launch_variant_id!: string;
  @ApiProperty({ format: "uuid", nullable: true }) reservation_id!: string;
  @ApiProperty({}) product_title_snapshot!: string;
  @ApiProperty({}) sku_snapshot!: string;
  @ApiProperty({ type: Object }) option_values_snapshot!: Record<
    string,
    unknown
  >;
  @ApiProperty({}) quantity!: number;
  @ApiProperty({
    example: "19900",
    description: "Integer minor units serialized as a decimal string",
  })
  unit_price_minor!: string;
  @ApiProperty({
    example: "19900",
    description: "Integer minor units serialized as a decimal string",
  })
  line_total_minor!: string;
}
export class PaymentsResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) order_id!: string;
  @ApiProperty({}) provider!: string;
  @ApiProperty({ nullable: true }) provider_payment_id!: string;
  @ApiProperty({}) idempotency_key!: string;
  @ApiProperty({}) status!: string;
  @ApiProperty({
    example: "19900",
    description: "Integer minor units serialized as a decimal string",
  })
  amount_minor!: string;
  @ApiProperty({ format: "date-time" }) created_at!: string;
  @ApiProperty({ format: "date-time" }) updated_at!: string;
}
export class ProductDetailResponse extends ProductsResponse {
  @ApiProperty({ type: [ProductVariantsResponse] })
  variants!: ProductVariantsResponse[];
}
export class CheckoutResponse extends OrdersResponse {
  @ApiProperty({ type: [OrderItemsResponse] }) items!: OrderItemsResponse[];
  @ApiProperty({ type: PaymentsResponse }) payment!: PaymentsResponse;
}
export class TokenResponse {
  @ApiProperty({ example: "eyJhbGciOiJIUzI1NiJ9..." }) accessToken!: string;
}
export class RegisteredUserResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ example: "customer@example.com" }) email!: string;
  @ApiProperty({ example: "Customer" }) display_name!: string;
}
export class RegistrationResponse extends TokenResponse {
  @ApiProperty({ type: RegisteredUserResponse }) user!: RegisteredUserResponse;
}
export class WebhookResponse {
  @ApiProperty({ example: true }) accepted!: boolean;
}
export class ReconciliationResponse {
  @ApiProperty({ format: "uuid" }) id!: string;
  @ApiProperty({ format: "uuid" }) payment_id!: string;
  @ApiProperty({ example: "ADMIN_REFUND_REQUEST" }) reason!: string;
  @ApiProperty({ example: "PENDING" }) status!: string;
  @ApiProperty({ format: "date-time" }) created_at!: string;
}

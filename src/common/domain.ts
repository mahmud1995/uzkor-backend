export enum Role {
  ADMIN = "ADMIN",
  CUSTOMER = "CUSTOMER",
}
export enum LaunchState {
  DRAFT = "DRAFT",
  PUBLISHED = "PUBLISHED",
  PAUSED = "PAUSED",
  CANCELLED = "CANCELLED",
}
export enum ReservationStatus {
  ACTIVE = "ACTIVE",
  CONVERTED = "CONVERTED",
  CANCELLED = "CANCELLED",
  EXPIRED = "EXPIRED",
}
export enum OrderStatus {
  PENDING_PAYMENT = "PENDING_PAYMENT",
  PAID = "PAID",
  FULFILLING = "FULFILLING",
  SHIPPED = "SHIPPED",
  DELIVERED = "DELIVERED",
  CANCELLED = "CANCELLED",
  REFUNDED = "REFUNDED",
}
export enum PaymentStatus {
  INITIATED = "INITIATED",
  AUTHORIZED = "AUTHORIZED",
  CAPTURED = "CAPTURED",
  FAILED = "FAILED",
  REFUNDED = "REFUNDED",
}
export function phase(launch: Record<string, any>, now = new Date()): string {
  if (launch.state !== "PUBLISHED") return launch.state;
  for (const [field, value] of [
    ["reservation_opens_at", "COMING_SOON"],
    ["reservation_closes_at", "RESERVATIONS_OPEN"],
    ["sale_opens_at", "WAITING"],
    ["early_access_ends_at", "EARLY_ACCESS"],
    ["sale_ends_at", "PUBLIC_SALE"],
  ]) {
    if (+now < +new Date(launch[field])) return value;
  }
  return "ENDED";
}
export const available = (v: Record<string, any>) =>
  v.total_units - v.reserved_units - v.checkout_held_units - v.sold_units;

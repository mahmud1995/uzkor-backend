import { Migration } from "@mikro-orm/migrations";
export class Migration202609240001 extends Migration {
  async up(): Promise<void> {
    this.addSql(`CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text NOT NULL,
    password_hash text, -- null only if an external identity provider is used
    display_name text NOT NULL,
    phone text,
    role text NOT NULL DEFAULT 'CUSTOMER'
        CHECK (role IN ('ADMIN', 'CUSTOMER')),
    status text NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'SUSPENDED', 'DELETED')),
    email_verified_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_email_not_blank CHECK (length(trim(email)) > 3)
);
CREATE UNIQUE INDEX users_email_ci_uq ON users (lower(email));

CREATE TABLE categories (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    parent_id uuid REFERENCES categories(id) ON DELETE RESTRICT,
    code text NOT NULL UNIQUE,
    slug text NOT NULL UNIQUE,
    name_ko text NOT NULL,
    name_en text NOT NULL,
    sort_order integer NOT NULL DEFAULT 0,
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT category_not_own_parent CHECK (parent_id IS DISTINCT FROM id)
);
-- Prevent longer parent cycles in admin service logic or with a recursive trigger.

CREATE TABLE products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug text NOT NULL UNIQUE,
    category_id uuid NOT NULL REFERENCES categories(id),
    title text NOT NULL,
    subtitle text,
    description text NOT NULL DEFAULT '',
    brand_name text, -- product brand, not a separate marketplace seller
    specifications jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'ACTIVE', 'ARCHIVED')),
    is_adult_content boolean NOT NULL DEFAULT false,
    created_by uuid REFERENCES users(id),
    updated_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX products_category_status_idx ON products (category_id, status);

CREATE TABLE product_images (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    image_url text NOT NULL,
    alt_text text,
    position integer NOT NULL DEFAULT 0,
    is_cover boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX product_one_cover_uq ON product_images (product_id)
    WHERE is_cover;

CREATE TABLE product_variants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    sku text NOT NULL UNIQUE,
    option_values jsonb NOT NULL DEFAULT '{}'::jsonb, -- e.g. {"color":"White","size":"M"}
    is_active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, product_id)
);

CREATE TABLE launches (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES products(id),
    title_override text,
    summary text,
    state text NOT NULL DEFAULT 'DRAFT'
        CHECK (state IN ('DRAFT', 'PUBLISHED', 'PAUSED', 'CANCELLED')),
    published_at timestamptz,
    reservation_opens_at timestamptz NOT NULL,
    reservation_closes_at timestamptz NOT NULL,
    sale_opens_at timestamptz NOT NULL,
    early_access_ends_at timestamptz NOT NULL,
    sale_ends_at timestamptz NOT NULL,
    created_by uuid REFERENCES users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (id, product_id),
    CHECK (reservation_opens_at < reservation_closes_at),
    CHECK (reservation_closes_at <= sale_opens_at),
    CHECK (sale_opens_at < early_access_ends_at),
    CHECK (early_access_ends_at < sale_ends_at)
);
CREATE INDEX launches_listing_idx ON launches (state, sale_opens_at);

CREATE TABLE launch_variants (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    launch_id uuid NOT NULL,
    product_id uuid NOT NULL,
    variant_id uuid NOT NULL,
    price_minor bigint NOT NULL CHECK (price_minor >= 0),
    currency char(3) NOT NULL DEFAULT 'KRW',
    total_units integer NOT NULL CHECK (total_units >= 0),
    reserved_units integer NOT NULL DEFAULT 0 CHECK (reserved_units >= 0),
    checkout_held_units integer NOT NULL DEFAULT 0 CHECK (checkout_held_units >= 0),
    sold_units integer NOT NULL DEFAULT 0 CHECK (sold_units >= 0),
    per_customer_limit integer NOT NULL DEFAULT 1 CHECK (per_customer_limit > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    FOREIGN KEY (launch_id, product_id) REFERENCES launches(id, product_id),
    FOREIGN KEY (variant_id, product_id) REFERENCES product_variants(id, product_id),
    UNIQUE (launch_id, variant_id),
    CHECK (reserved_units + checkout_held_units + sold_units <= total_units)
);
CREATE INDEX launch_variants_launch_idx ON launch_variants (launch_id);

CREATE TABLE reservations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id),
    launch_variant_id uuid NOT NULL REFERENCES launch_variants(id),
    status text NOT NULL DEFAULT 'ACTIVE'
        CHECK (status IN ('ACTIVE', 'CONVERTED', 'CANCELLED', 'EXPIRED')),
    reserved_at timestamptz NOT NULL DEFAULT now(),
    converted_at timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX reservations_one_live_per_user_variant_uq
    ON reservations (user_id, launch_variant_id)
    WHERE status IN ('ACTIVE', 'CONVERTED');
CREATE INDEX reservations_variant_status_idx
    ON reservations (launch_variant_id, status);

CREATE TABLE orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_number text NOT NULL UNIQUE,
    user_id uuid NOT NULL REFERENCES users(id),
    status text NOT NULL DEFAULT 'PENDING_PAYMENT'
        CHECK (status IN ('PENDING_PAYMENT', 'PAID', 'FULFILLING',
                          'SHIPPED', 'DELIVERED', 'CANCELLED', 'REFUNDED')),
    currency char(3) NOT NULL DEFAULT 'KRW',
    subtotal_minor bigint NOT NULL CHECK (subtotal_minor >= 0),
    shipping_minor bigint NOT NULL DEFAULT 0 CHECK (shipping_minor >= 0),
    total_minor bigint NOT NULL CHECK (total_minor >= 0),
    shipping_address jsonb NOT NULL, -- immutable snapshot of address at checkout
    payment_expires_at timestamptz NOT NULL,
    placed_at timestamptz NOT NULL DEFAULT now(),
    paid_at timestamptz,
    CONSTRAINT orders_total_check CHECK (total_minor = subtotal_minor + shipping_minor)
);
CREATE INDEX orders_user_placed_idx ON orders (user_id, placed_at DESC);
CREATE INDEX orders_expiration_idx ON orders (payment_expires_at)
    WHERE status = 'PENDING_PAYMENT';

CREATE TABLE order_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES orders(id),
    launch_variant_id uuid NOT NULL REFERENCES launch_variants(id),
    reservation_id uuid REFERENCES reservations(id),
    product_title_snapshot text NOT NULL,
    sku_snapshot text NOT NULL,
    option_values_snapshot jsonb NOT NULL,
    quantity integer NOT NULL CHECK (quantity > 0),
    unit_price_minor bigint NOT NULL CHECK (unit_price_minor >= 0),
    line_total_minor bigint NOT NULL,
    CHECK (line_total_minor = quantity * unit_price_minor)
);

CREATE TABLE payments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES orders(id),
    provider text NOT NULL,
    provider_payment_id text,
    idempotency_key text NOT NULL UNIQUE,
    status text NOT NULL DEFAULT 'INITIATED'
        CHECK (status IN ('INITIATED', 'AUTHORIZED', 'CAPTURED', 'FAILED', 'REFUNDED')),
    amount_minor bigint NOT NULL CHECK (amount_minor >= 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX payments_provider_id_uq
    ON payments (provider, provider_payment_id)
    WHERE provider_payment_id IS NOT NULL;
`);
  }
  async down(): Promise<void> {
    this.addSql(
      "DROP TABLE payments, order_items, orders, reservations, launch_variants, launches, product_variants, product_images, products, categories, users CASCADE",
    );
  }
}

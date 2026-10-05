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
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Db } from "../database/db";
import { Admin, Public } from "../auth/auth.decorators";
import { available, phase } from "../common/domain";
import {
  CategoryDto,
  LaunchDto,
  ProductDto,
  ScheduleDto,
  ProductUpdateDto,
  VariantDto,
  ImageDto,
  InventoryUpdateDto,
} from "./dto";

@ApiTags("Categories", "Products", "Launches")
@Public()
@Controller()
export class CatalogController {
  constructor(private db: Db) {}
  @Get("categories") categories() {
    return this.db.query(
      "SELECT * FROM categories WHERE is_active ORDER BY sort_order, code",
    );
  }
  @Get("launches") async launches(
    @Query("phase") filter?: string,
    @Query("category") category?: string,
  ) {
    const rows = await this.db.query(
      `SELECT l.*, p.title, p.slug, c.code AS category_code FROM launches l JOIN products p ON p.id=l.product_id JOIN categories c ON c.id=p.category_id WHERE l.state IN ('PUBLISHED','PAUSED') AND p.status='ACTIVE' AND c.is_active ${category ? "AND c.code = ?" : ""} ORDER BY l.sale_opens_at, l.id LIMIT 100`,
      category ? [category] : [],
    );
    return rows
      .map((l) => ({ ...l, phase: phase(l) }))
      .filter((l) => !filter || l.phase === filter);
  }
  @Get("launches/:id") async detail(@Param("id", ParseUUIDPipe) id: string) {
    const l = await this.db.one(
      "SELECT l.*, p.title, p.description, p.brand_name, p.specifications FROM launches l JOIN products p ON p.id=l.product_id WHERE l.id=? AND l.state IN ('PUBLISHED','PAUSED') AND p.status='ACTIVE'",
      [id],
    );
    if (!l) throw new NotFoundException();
    const variants = await this.db.query(
      "SELECT lv.*, v.sku, v.option_values FROM launch_variants lv JOIN product_variants v ON v.id=lv.variant_id WHERE lv.launch_id=? AND v.is_active",
      [id],
    );
    return {
      ...l,
      phase: phase(l),
      images: await this.db.query(
        "SELECT * FROM product_images WHERE product_id=? ORDER BY position",
        [l.product_id],
      ),
      variants: variants.map((v) => ({
        ...v,
        availableUnits:
          available(v) +
          (+new Date() >= +new Date(l.early_access_ends_at)
            ? v.reserved_units
            : 0),
      })),
    };
  }
}
@ApiTags("Admin")
@ApiBearerAuth()
@Admin()
@Controller("admin")
export class AdminCatalogController {
  constructor(private db: Db) {}
  @ApiCreatedResponse({ type: CategoriesResponse })
  @Post("categories")
  async category(@Body() d: CategoryDto) {
    return this.db.one(
      "INSERT INTO categories(code,slug,name_ko,name_en,parent_id) VALUES (?,?,?,?,?) RETURNING *",
      [d.code, d.slug, d.nameKo, d.nameEn, d.parentId ?? null],
    );
  }
  @ApiCreatedResponse({ type: ProductDetailResponse })
  @Post("products")
  async product(@Body() d: ProductDto, @Req() req: any) {
    return this.db.tx(async (db) => {
      const p = (await db.one(
        "INSERT INTO products(slug,category_id,title,description,brand_name,specifications,created_by,status) VALUES (?,?,?,?,?,?,?,'ACTIVE') RETURNING *",
        [
          d.slug,
          d.categoryId,
          d.title,
          d.description,
          d.brandName ?? null,
          JSON.stringify(d.specifications),
          req.user.id,
        ],
      ))!;
      const variants = [];
      for (const v of d.variants)
        variants.push(
          await db.one(
            "INSERT INTO product_variants(product_id,sku,option_values) VALUES (?,?,?) RETURNING *",
            [p.id, v.sku, JSON.stringify(v.optionValues)],
          ),
        );
      for (const [i, img] of (d.images ?? []).entries())
        await db.query(
          "INSERT INTO product_images(product_id,image_url,alt_text,position,is_cover) VALUES (?,?,?,?,?)",
          [p.id, img.imageUrl, img.altText ?? null, i, img.isCover],
        );
      return { ...p, variants };
    });
  }
  @ApiOkResponse({ type: CategoriesResponse })
  @Patch("categories/:id")
  async editCategory(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() d: CategoryDto,
  ) {
    return this.db.tx(async (db) => {
      // Category edits are infrequent; a single lock protects cycle checks from write skew.
      await db.query("SELECT pg_advisory_xact_lock(774493021)");
      const exists = await db.one("SELECT id FROM categories WHERE id=?", [id]);
      if (!exists) throw new NotFoundException();
      if (d.parentId) {
        const cycle = await db.one(
          "WITH RECURSIVE parents AS (SELECT id,parent_id FROM categories WHERE id=? UNION SELECT c.id,c.parent_id FROM categories c JOIN parents p ON c.id=p.parent_id) SELECT id FROM parents WHERE id=?",
          [d.parentId, id],
        );
        if (cycle)
          throw new ConflictException("Category parent would create a cycle");
      }
      return db.one(
        "UPDATE categories SET code=?,slug=?,name_ko=?,name_en=?,parent_id=? WHERE id=? RETURNING *",
        [d.code, d.slug, d.nameKo, d.nameEn, d.parentId ?? null, id],
      );
    });
  }
  @ApiOkResponse({ type: ProductsResponse })
  @Patch("products/:id")
  async editProduct(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() d: ProductUpdateDto,
    @Req() req: any,
  ) {
    const p = await this.db.one(
      "UPDATE products SET title=coalesce(?,title),description=coalesce(?,description),brand_name=coalesce(?,brand_name),specifications=coalesce(?::jsonb,specifications),status=coalesce(?,status),updated_by=?,updated_at=now() WHERE id=? RETURNING *",
      [
        d.title ?? null,
        d.description ?? null,
        d.brandName ?? null,
        d.specifications ? JSON.stringify(d.specifications) : null,
        d.status ?? null,
        req.user.id,
        id,
      ],
    );
    if (!p) throw new NotFoundException();
    return p;
  }
  @ApiCreatedResponse({ type: ProductVariantsResponse })
  @Post("products/:id/variants")
  variant(@Param("id", ParseUUIDPipe) id: string, @Body() d: VariantDto) {
    return this.db.one(
      "INSERT INTO product_variants(product_id,sku,option_values) VALUES (?,?,?) RETURNING *",
      [id, d.sku, JSON.stringify(d.optionValues)],
    );
  }
  @ApiCreatedResponse({ type: ProductImagesResponse })
  @Post("products/:id/images")
  image(@Param("id", ParseUUIDPipe) id: string, @Body() d: ImageDto) {
    return this.db.one(
      "INSERT INTO product_images(product_id,image_url,alt_text,is_cover) VALUES (?,?,?,?) RETURNING *",
      [id, d.imageUrl, d.altText ?? null, d.isCover],
    );
  }
  @ApiOkResponse({ type: LaunchVariantsResponse })
  @Patch("launches/:id/variants/:variantId")
  inventory(
    @Param("id", ParseUUIDPipe) id: string,
    @Param("variantId", ParseUUIDPipe) variantId: string,
    @Body() d: InventoryUpdateDto,
  ) {
    return this.db.tx(async (db) => {
      const l = await db.one("SELECT * FROM launches WHERE id=? FOR UPDATE", [
        id,
      ]);
      if (!l) throw new NotFoundException();
      if (l.state !== "DRAFT")
        throw new ConflictException(
          "Prices, stock and limits are immutable after publication",
        );
      const v = await db.one(
        "UPDATE launch_variants SET price_minor=?,total_units=?,per_customer_limit=? WHERE id=? AND launch_id=? RETURNING *",
        [d.priceMinor, d.totalUnits, d.perCustomerLimit, variantId, id],
      );
      if (!v) throw new NotFoundException();
      return v;
    });
  }
  @ApiCreatedResponse({ type: LaunchesResponse })
  @Post("launches")
  async launch(@Body() d: LaunchDto, @Req() req: any) {
    return this.db.tx(async (db) => {
      const l = (await db.one(
        "INSERT INTO launches(product_id,summary,reservation_opens_at,reservation_closes_at,sale_opens_at,early_access_ends_at,sale_ends_at,created_by) VALUES (?,?,?,?,?,?,?,?) RETURNING *",
        [
          d.productId,
          d.summary ?? null,
          d.reservationOpensAt,
          d.reservationClosesAt,
          d.saleOpensAt,
          d.earlyAccessEndsAt,
          d.saleEndsAt,
          req.user.id,
        ],
      ))!;
      for (const v of d.variants)
        await db.query(
          "INSERT INTO launch_variants(launch_id,product_id,variant_id,price_minor,currency,total_units,per_customer_limit) VALUES (?,?,?,?,?,?,?)",
          [
            l.id,
            d.productId,
            v.variantId,
            v.priceMinor,
            v.currency,
            v.totalUnits,
            v.perCustomerLimit,
          ],
        );
      return l;
    });
  }
  @ApiOkResponse({ type: LaunchesResponse })
  @Patch("launches/:id")
  async schedule(
    @Param("id", ParseUUIDPipe) id: string,
    @Body() d: ScheduleDto,
  ) {
    const l = await this.db.one(
      "UPDATE launches SET reservation_opens_at=?,reservation_closes_at=?,sale_opens_at=?,early_access_ends_at=?,sale_ends_at=?,updated_at=now() WHERE id=? AND state='DRAFT' RETURNING *",
      [
        d.reservationOpensAt,
        d.reservationClosesAt,
        d.saleOpensAt,
        d.earlyAccessEndsAt,
        d.saleEndsAt,
        id,
      ],
    );
    if (!l) throw new ConflictException("Only draft schedules can be edited");
    return l;
  }
  @ApiCreatedResponse({ type: LaunchesResponse })
  @Post("launches/:id/publish")
  async publish(@Param("id", ParseUUIDPipe) id: string) {
    return this.db.tx(async (db) => {
      const l = await db.one("SELECT * FROM launches WHERE id=? FOR UPDATE", [
        id,
      ]);
      if (!l) throw new NotFoundException();
      if (l.state !== "DRAFT" || +new Date(l.sale_ends_at) <= Date.now())
        throw new ConflictException("Launch cannot be published");
      const v = await db.one(
        "SELECT count(*) AS count FROM launch_variants WHERE launch_id=?",
        [id],
      );
      if (!Number(v?.count))
        throw new ConflictException(
          "Add confirmed inventory before publication",
        );
      return db.one(
        "UPDATE launches SET state='PUBLISHED',published_at=now(),updated_at=now() WHERE id=? RETURNING *",
        [id],
      );
    });
  }
  @Get("launches/:id") async preview(@Param("id", ParseUUIDPipe) id: string) {
    return {
      launch: await this.db.one("SELECT * FROM launches WHERE id=?", [id]),
      inventory: await this.db.query(
        "SELECT * FROM launch_variants WHERE launch_id=?",
        [id],
      ),
    };
  }
  @Get("reservations") reservations() {
    return this.db.query(
      "SELECT * FROM reservations ORDER BY reserved_at DESC LIMIT 100",
    );
  }
  @Get("orders") orders() {
    return this.db.query(
      "SELECT * FROM orders ORDER BY placed_at DESC LIMIT 100",
    );
  }
  @Get("payments") payments() {
    return this.db.query(
      "SELECT * FROM payments ORDER BY created_at DESC LIMIT 100",
    );
  }
}

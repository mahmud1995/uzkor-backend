import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
export class CategoryDto {
  @ApiProperty() @IsString() @Length(1, 64) code!: string;
  @ApiProperty() @Matches(/^[a-z0-9-]+$/) slug!: string;
  @ApiProperty() @IsString() @Length(1, 100) nameKo!: string;
  @ApiProperty() @IsString() @Length(1, 100) nameEn!: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() parentId?: string;
}
export class VariantDto {
  @ApiProperty() @IsString() @Length(1, 100) sku!: string;
  @ApiProperty({ type: Object }) @IsObject() optionValues!: Record<
    string,
    unknown
  >;
}
export class ImageDto {
  @ApiProperty() @Matches(/^https:\/\/.+/) imageUrl!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() altText?: string;
  @ApiProperty() @IsBoolean() isCover!: boolean;
}
export class ProductDto {
  @ApiProperty() @Matches(/^[a-z0-9-]+$/) slug!: string;
  @ApiProperty() @IsUUID() categoryId!: string;
  @ApiProperty() @IsString() @Length(1, 200) title!: string;
  @ApiProperty() @IsString() description!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() brandName?: string;
  @ApiProperty({ type: Object }) @IsObject() specifications!: Record<
    string,
    unknown
  >;
  @ApiProperty({ type: [VariantDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => VariantDto)
  variants!: VariantDto[];
  @ApiPropertyOptional({ type: [ImageDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ImageDto)
  images?: ImageDto[];
}
export class LaunchVariantDto {
  @ApiProperty() @IsUUID() variantId!: string;
  @ApiProperty({
    example: "19900",
    description: "Nonnegative integer minor units, serialized as a string.",
  })
  @Matches(/^(0|[1-9][0-9]{0,14})$/)
  priceMinor!: string;
  @ApiProperty({ example: "KRW" }) @Matches(/^[A-Z]{3}$/) currency!: string;
  @ApiProperty() @IsInt() @Min(0) @Max(100000000) totalUnits!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(10000) perCustomerLimit!: number;
}
export class ScheduleDto {
  @ApiProperty()
  @IsDateString({ strict: true })
  @Matches(/(Z|[+-]\d{2}:\d{2})$/)
  reservationOpensAt!: string;
  @ApiProperty()
  @IsDateString({ strict: true })
  @Matches(/(Z|[+-]\d{2}:\d{2})$/)
  reservationClosesAt!: string;
  @ApiProperty()
  @IsDateString({ strict: true })
  @Matches(/(Z|[+-]\d{2}:\d{2})$/)
  saleOpensAt!: string;
  @ApiProperty()
  @IsDateString({ strict: true })
  @Matches(/(Z|[+-]\d{2}:\d{2})$/)
  earlyAccessEndsAt!: string;
  @ApiProperty()
  @IsDateString({ strict: true })
  @Matches(/(Z|[+-]\d{2}:\d{2})$/)
  saleEndsAt!: string;
}
export class LaunchDto extends ScheduleDto {
  @ApiProperty() @IsUUID() productId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() summary?: string;
  @ApiProperty({ type: [LaunchVariantDto] })
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LaunchVariantDto)
  variants!: LaunchVariantDto[];
}
export class LaunchStateDto {
  @ApiProperty({ enum: ["PAUSED", "PUBLISHED", "CANCELLED"] })
  @IsIn(["PAUSED", "PUBLISHED", "CANCELLED"])
  state!: string;
}
export class FulfillmentDto {
  @ApiProperty({ enum: ["FULFILLING", "SHIPPED", "DELIVERED"] })
  @IsIn(["FULFILLING", "SHIPPED", "DELIVERED"])
  status!: string;
}
export class ProductUpdateDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 200)
  title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() brandName?: string;
  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  specifications?: Record<string, unknown>;
  @ApiPropertyOptional({ enum: ["DRAFT", "ACTIVE", "ARCHIVED"] })
  @IsOptional()
  @IsIn(["DRAFT", "ACTIVE", "ARCHIVED"])
  status?: string;
}
export class InventoryUpdateDto {
  @ApiProperty({ example: "19900" })
  @Matches(/^(0|[1-9][0-9]{0,14})$/)
  priceMinor!: string;
  @ApiProperty() @IsInt() @Min(0) @Max(100000000) totalUnits!: number;
  @ApiProperty() @IsInt() @Min(1) @Max(10000) perCustomerLimit!: number;
}

import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { Type } from "class-transformer";
import {
  IsDefined,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
export class AddressDto {
  @ApiProperty() @IsString() @Length(1, 100) recipient!: string;
  @ApiProperty() @IsString() @Length(1, 30) phone!: string;
  @ApiProperty() @Matches(/^[A-Z]{2}$/) country!: string;
  @ApiProperty() @IsString() @Length(1, 20) postalCode!: string;
  @ApiProperty() @IsString() @Length(1, 300) line1!: string;
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(0, 300)
  line2?: string;
}
export class CheckoutDto {
  @ApiProperty() @IsUUID() launchVariantId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(10000) quantity!: number;
  @ApiPropertyOptional() @IsOptional() @IsUUID() reservationId?: string;
  @ApiProperty({ type: AddressDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => AddressDto)
  shippingAddress!: AddressDto;
  @ApiProperty({ description: "Client-generated UUID, reused for retries." })
  @IsUUID()
  idempotencyKey!: string;
}
export class WebhookDto {
  @ApiProperty() @IsUUID() paymentId!: string;
  @ApiProperty() @IsString() @Length(1, 200) providerPaymentId!: string;
  @ApiProperty({ enum: ["CAPTURED", "FAILED", "REFUNDED"] })
  @IsIn(["CAPTURED", "FAILED", "REFUNDED"])
  status!: string;
  @ApiProperty({ example: "19900" })
  @Matches(/^(0|[1-9][0-9]{0,18})$/)
  amountMinor!: string;
  @ApiProperty() @Matches(/^[A-Z]{3}$/) currency!: string;
}

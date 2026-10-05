import { ApiProperty } from "@nestjs/swagger";
import { IsString, Length } from "class-validator";
import { LoginDto } from "./login.dto";

export class RegisterDto extends LoginDto {
  @ApiProperty()
  @IsString()
  @Length(1, 100)
  displayName!: string;
}

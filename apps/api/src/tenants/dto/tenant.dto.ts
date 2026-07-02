import { IsBoolean, IsInt, IsNumber, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreateTenantDto {
  @IsString() brand!: string;               // бренд франшизы (её название)
  @IsOptional() @IsString() brandColor?: string;
  @IsOptional() @IsInt() ownerTgId?: number; // владелец франшизы (Telegram id)
  @IsOptional() @IsString() botToken?: string;
  @IsOptional() @IsString() botUsername?: string;
  @IsOptional() @IsString() domain?: string;
  @IsOptional() @IsInt() @Min(0) @Max(100) sharePercent?: number;
  @IsOptional() @IsNumber() pricePerMonth?: number;
  @IsOptional() @IsString() welcomeText?: string;
}

export class UpdateTenantDto {
  @IsOptional() @IsString() brand?: string;
  @IsOptional() @IsString() brandColor?: string;
  @IsOptional() @IsInt() ownerTgId?: number;
  @IsOptional() @IsString() botToken?: string;
  @IsOptional() @IsString() botUsername?: string;
  @IsOptional() @IsString() domain?: string;
  @IsOptional() @IsBoolean() domainVerified?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(100) sharePercent?: number;
  @IsOptional() @IsNumber() pricePerMonth?: number;
  @IsOptional() @IsString() welcomeText?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateInvoiceDto {
  @IsString() userId!: string;
  @IsString() provider!: string; // id из реестра
  // Либо planId (тариф), либо amount+days напрямую (обратная совместимость).
  @IsOptional() @IsString() planId?: string;
  @IsOptional() @IsNumber() @Min(1) amount?: number; // сумма
  @IsOptional() @IsInt() @Min(1) days?: number; // сколько дней начислить
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() returnUrl?: string;
}

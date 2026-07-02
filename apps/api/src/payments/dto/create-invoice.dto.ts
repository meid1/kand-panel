import { IsInt, IsNumber, IsOptional, IsString, Min } from 'class-validator';

export class CreateInvoiceDto {
  @IsString() userId!: string;
  @IsString() provider!: string; // id из реестра
  @IsNumber() @Min(1) amount!: number; // сумма
  @IsInt() @Min(1) days!: number; // сколько дней начислить при оплате
  @IsOptional() @IsString() currency?: string;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsString() returnUrl?: string;
}

import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';

export class CreateUserDto {
  // Telegram-id клиента (в рамках тенанта уникален)
  @IsInt() tgId!: number;
  @IsOptional() @IsString() tgUsername?: string;
  @IsOptional() @IsString() tgName?: string;
  // тенант; если не задан — платформенный (резолвится в сервисе)
  @IsOptional() @IsString() tenantId?: string;
  @IsOptional() @IsInt() trialDays?: number;
}

export class GrantDaysDto {
  @IsInt() days!: number; // может быть отрицательным (списать)
  @IsOptional() @IsBoolean() notify?: boolean; // списание — без уведомления
}

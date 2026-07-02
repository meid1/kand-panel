import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { PROTOCOLS, Protocol } from './create-node.dto';

// Всё опционально — редактирование ноды из админки (частичное обновление).
export class UpdateNodeDto {
  @IsOptional() @IsString() label?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @IsBoolean() showInSub?: boolean;
  @IsOptional() @IsInt() @Min(0) sortOrder?: number;
  @IsOptional() @IsInt() @Min(0) trafficLimitGb?: number;
  @IsOptional() @IsArray() @IsIn(PROTOCOLS, { each: true }) protocols?: Protocol[];
}

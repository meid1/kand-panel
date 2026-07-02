import {
  IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Matches, Max, Min,
} from 'class-validator';

// Поддерживаемые протоколы ноды. Ровно то, что умеет генерить xray-конфиг.
export const PROTOCOLS = ['reality-tcp', 'reality-grpc', 'hysteria2', 'xhttp'] as const;
export type Protocol = (typeof PROTOCOLS)[number];

export class CreateNodeDto {
  @IsString() label!: string;

  // хост/IP для клиентских ссылок (может быть домен)
  @IsString() address!: string;

  // публичный IP (для SAN сертификата и mTLS)
  @Matches(/^\d{1,3}(\.\d{1,3}){3}$/, { message: 'ip должен быть IPv4' })
  ip!: string;

  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;

  @IsArray()
  @IsIn(PROTOCOLS, { each: true })
  protocols!: Protocol[];

  @IsOptional() @IsString() sni?: string;

  @IsOptional() @IsString()
  @IsIn(['exit', 'bypass-origin', 'yt-ru', 'warp'])
  role?: string;

  @IsOptional() @IsInt() @Min(0) trafficLimitGb?: number;

  @IsOptional() @IsBoolean() showInSub?: boolean;

  // привязка к тенанту (BYON франшизы); пусто = общий пул платформы
  @IsOptional() @IsString() tenantId?: string;
}

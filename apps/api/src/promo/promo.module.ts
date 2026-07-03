import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { BypassModule } from '../bypass/bypass.module';
import { PromoController } from './promo.controller';
import { PromoService } from './promo.service';

@Module({ imports: [AuthModule, UsersModule, BypassModule], controllers: [PromoController], providers: [PromoService], exports: [PromoService] })
export class PromoModule {}

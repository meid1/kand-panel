import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PromoGroupsController } from './promo-groups.controller';
import { PromoGroupsService } from './promo-groups.service';

@Module({ imports: [AuthModule], controllers: [PromoGroupsController], providers: [PromoGroupsService], exports: [PromoGroupsService] })
export class PromoGroupsModule {}

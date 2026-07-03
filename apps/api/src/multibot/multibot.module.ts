import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { DevicesModule } from '../devices/devices.module';
import { PaymentsModule } from '../payments/payments.module';
import { BypassModule } from '../bypass/bypass.module';
import { ReferralModule } from '../referral/referral.module';
import { PlansModule } from '../plans/plans.module';
import { PromoModule } from '../promo/promo.module';
import { MultibotService } from './multibot.service';

/** Мультибот франшиз — отдельный сервис (платформенный бот в BotModule не трогаем). */
@Module({
  imports: [UsersModule, DevicesModule, PaymentsModule, BypassModule, ReferralModule, PlansModule, PromoModule],
  providers: [MultibotService],
})
export class MultibotModule {}

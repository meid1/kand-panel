import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { ReferralModule } from '../referral/referral.module';
import { PlansModule } from '../plans/plans.module';
import { PromoGroupsModule } from '../promo-groups/promo-groups.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ProviderRegistry } from './providers/provider.registry';

@Module({
  imports: [AuthModule, UsersModule, ReferralModule, PlansModule, PromoGroupsModule], // дни + реф-бонус + тарифы + скидки групп
  controllers: [PaymentsController],
  providers: [PaymentsService, ProviderRegistry],
  exports: [PaymentsService],
})
export class PaymentsModule {}

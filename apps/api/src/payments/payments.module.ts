import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersModule } from '../users/users.module';
import { ReferralModule } from '../referral/referral.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';
import { ProviderRegistry } from './providers/provider.registry';

@Module({
  imports: [AuthModule, UsersModule, ReferralModule], // начисление дней + реф-бонус
  controllers: [PaymentsController],
  providers: [PaymentsService, ProviderRegistry],
  exports: [PaymentsService],
})
export class PaymentsModule {}

import { Module } from '@nestjs/common';
import { BypassModule } from '../bypass/bypass.module';
import { AuthModule } from '../auth/auth.module';
import { SubscriptionController, TvController, HwidController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';

@Module({
  imports: [BypassModule, AuthModule], // лимит обхода + JWT для HWID-админки
  controllers: [SubscriptionController, TvController, HwidController],
  providers: [SubscriptionService],
})
export class SubscriptionModule {}

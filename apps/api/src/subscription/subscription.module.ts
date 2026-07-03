import { Module } from '@nestjs/common';
import { BypassModule } from '../bypass/bypass.module';
import { SubscriptionController, TvController } from './subscription.controller';
import { SubscriptionService } from './subscription.service';

@Module({
  imports: [BypassModule], // проверка лимита обхода при выдаче подписки
  controllers: [SubscriptionController, TvController],
  providers: [SubscriptionService],
})
export class SubscriptionModule {}

import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { UsersModule } from '../users/users.module';
import { DevicesModule } from '../devices/devices.module';
import { PaymentsModule } from '../payments/payments.module';
import { BypassModule } from '../bypass/bypass.module';
import { BotService } from './bot.service';

@Module({
  imports: [SettingsModule, UsersModule, DevicesModule, PaymentsModule, BypassModule],
  providers: [BotService],
})
export class BotModule {}

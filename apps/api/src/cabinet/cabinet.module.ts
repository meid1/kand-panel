import { Module } from '@nestjs/common';
import { BypassModule } from '../bypass/bypass.module';
import { PaymentsModule } from '../payments/payments.module';
import { SettingsModule } from '../settings/settings.module';
import { CabinetController } from './cabinet.controller';
import { CabinetService } from './cabinet.service';

@Module({
  imports: [BypassModule, PaymentsModule, SettingsModule],
  controllers: [CabinetController],
  providers: [CabinetService],
})
export class CabinetModule {}

import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BridgeService } from './bridge.service';
import { VpnDbService } from './vpndb.service';
import { BridgeController } from './bridge.controller';

/** Глобальный, чтобы любой сервис (users/bypass) мог пробросить действие во внешний бэкенд. */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [BridgeController],
  providers: [BridgeService, VpnDbService],
  exports: [BridgeService, VpnDbService],
})
export class BridgeModule {}

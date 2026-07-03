import { Global, Module } from '@nestjs/common';
import { BridgeService } from './bridge.service';
import { VpnDbService } from './vpndb.service';

/** Глобальный, чтобы любой сервис (users/bypass) мог пробросить действие во внешний бэкенд. */
@Global()
@Module({
  providers: [BridgeService, VpnDbService],
  exports: [BridgeService, VpnDbService],
})
export class BridgeModule {}

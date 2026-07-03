import { Global, Module } from '@nestjs/common';
import { BridgeService } from './bridge.service';

/** Глобальный, чтобы любой сервис (users/bypass) мог пробросить действие во внешний бэкенд. */
@Global()
@Module({
  providers: [BridgeService],
  exports: [BridgeService],
})
export class BridgeModule {}

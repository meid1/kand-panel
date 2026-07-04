import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { FeaturesService } from './features.service';
import { FeaturesController } from './features.controller';

// Глобальный — чтобы бот/мультибот/сервисы могли спрашивать features.enabled(...)
@Global()
@Module({
  imports: [AuthModule],
  controllers: [FeaturesController],
  providers: [FeaturesService],
  exports: [FeaturesService],
})
export class FeaturesModule {}

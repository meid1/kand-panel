import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BypassController } from './bypass.controller';
import { BypassService } from './bypass.service';

@Module({
  imports: [AuthModule],
  controllers: [BypassController],
  providers: [BypassService],
  exports: [BypassService],
})
export class BypassModule {}

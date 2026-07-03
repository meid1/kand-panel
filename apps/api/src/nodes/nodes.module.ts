import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WarpModule } from '../warp/warp.module';
import { NodesController } from './nodes.controller';
import { NodesService } from './nodes.service';

@Module({
  imports: [AuthModule, WarpModule], // JwtAuthGuard + WARP-регистрация
  controllers: [NodesController],
  providers: [NodesService],
  exports: [NodesService],
})
export class NodesModule {}

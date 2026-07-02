import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BypassModule } from '../bypass/bypass.module';
import { NodeAgentClient } from '../nodes-agent/node-agent.client';
import { StatsController } from './stats.controller';
import { StatsService } from './stats.service';

@Module({
  imports: [AuthModule, BypassModule],
  controllers: [StatsController],
  providers: [StatsService, NodeAgentClient],
  exports: [StatsService],
})
export class StatsModule {}

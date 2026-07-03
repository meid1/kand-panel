import { Module } from '@nestjs/common';
import { NodeAgentClient } from '../nodes-agent/node-agent.client';
import { MonitoringService } from './monitoring.service';

@Module({ providers: [MonitoringService, NodeAgentClient], exports: [MonitoringService] })
export class MonitoringModule {}

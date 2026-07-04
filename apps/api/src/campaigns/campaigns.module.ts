import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CampaignsController, CampaignClickController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';

@Module({
  imports: [AuthModule],
  controllers: [CampaignsController, CampaignClickController],
  providers: [CampaignsService],
  exports: [CampaignsService],
})
export class CampaignsModule {}

import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ReferralService } from './referral.service';

@UseGuards(JwtAuthGuard)
@Controller('referral')
export class ReferralController {
  constructor(private referral: ReferralService) {}

  @Get(':userId')
  stats(@Param('userId') userId: string) {
    return this.referral.stats(userId);
  }
}

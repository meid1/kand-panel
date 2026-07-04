import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { FeaturesService } from './features.service';

@UseGuards(JwtAuthGuard)
@Controller('features')
export class FeaturesController {
  constructor(private features: FeaturesService) {}

  @Get()
  map() {
    return this.features.map();
  }
}

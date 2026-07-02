import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './login.dto';

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}
  @Throttle({ default: { ttl: 60000, limit: 5 } }) // 5 попыток/мин — анти-брутфорс
  @Post('login')
  login(@Body() dto: LoginDto) { return this.auth.login(dto.password); }
}

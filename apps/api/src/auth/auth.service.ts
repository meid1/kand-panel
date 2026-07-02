import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { timingSafeEqual } from 'crypto';

@Injectable()
export class AuthService {
  constructor(private jwt: JwtService) {}
  login(password: string) {
    const expected = process.env.ADMIN_PASSWORD || '';
    const a = Buffer.from(password || ''); const b = Buffer.from(expected);
    const ok = expected.length > 0 && a.length === b.length && timingSafeEqual(a, b);
    if (!ok) throw new UnauthorizedException('invalid password');
    return { token: this.jwt.sign({ role: 'admin' }) };
  }
}

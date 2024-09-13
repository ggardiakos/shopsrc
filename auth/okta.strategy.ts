import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy } from 'passport-oauth2';
import { ConfigService } from '@nestjs/config';
import OktaAuth from '@okta/okta-auth-js';

@Injectable()
export class OktaStrategy extends PassportStrategy(Strategy, 'okta') {
  private issuerValue: string;

  constructor(private configService: ConfigService) {
    super({
      authorizationURL: `${configService.get('OKTA_DOMAIN')}/oauth2/default/v1/authorize`,
      tokenURL: `${configService.get('OKTA_DOMAIN')}/oauth2/default/v1/token`,
      clientID: configService.get('OKTA_CLIENT_ID'),
      clientSecret: configService.get('OKTA_CLIENT_SECRET'),
      callbackURL: configService.get('OKTA_CALLBACK_URL'),
      scope: ['openid', 'profile', 'email'],
    });

    this.issuerValue = configService.get('OKTA_DOMAIN');
  }

  async validate(accessToken: string, refreshToken: string, profile: any) {
    const oktaAuth = new OktaAuth({
      issuer: `${this.issuerValue}`
    });
    // ... rest of the code ...
  }
}

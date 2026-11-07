import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { AuthenticationService } from './authentication.service';
import { AuthenticatedRequest, SessionGuard } from './session.guard';
import { UserIdentityType } from '../identities/user-identity.schema';
import { UsersService } from '../users/users.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { LoginRateLimitGuard } from './login-rate-limit.guard';

class LoginDto {
  @IsIn(['USERNAME', 'EMAIL'])
  identityType!: UserIdentityType;

  @IsString()
  @MinLength(3)
  @MaxLength(254)
  identityValue!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  password!: string;
}

@Controller('auth')
export class AuthenticationController {
  constructor(
    private readonly authentication: AuthenticationService,
    private readonly users: UsersService,
    private readonly authorization: AuthorizationService,
  ) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(LoginRateLimitGuard)
  login(@Body() input: LoginDto) {
    return this.authentication.login(
      input.identityType,
      input.identityValue,
      input.password,
    );
  }

  @Get('me')
  @UseGuards(SessionGuard)
  async me(@Req() request: AuthenticatedRequest) {
    const principal = request.authenticatedPrincipal!;
    const user = await this.users.getById(principal.userId.toString());
    const permissions = await this.authorization.getEffectivePermissions(
      principal.userId,
    );
    return { user, permissions };
  }

  @Post('logout')
  @UseGuards(SessionGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() request: AuthenticatedRequest): Promise<void> {
    const token = request.get('authorization')!.slice('Bearer '.length);
    await this.authentication.logout(token, request.authenticatedPrincipal!);
  }
}

import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsArray,
  ArrayMaxSize,
  ArrayMinSize,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import type { AuthenticatedRequest } from '../authentication/session.guard';
import { SessionGuard } from '../authentication/session.guard';
import { RequirePermission } from '../authorization/require-permission.decorator';
import { PermissionGuard } from '../authorization/permission.guard';
import { permissionKeys } from '../authorization/permissions.registry';
import { AuditService } from '../audit/audit.service';
import { BranchesService } from '../branches/branches.service';
import { BranchStatus } from '../branches/branch.schema';
import { CreateInvitedHumanInput, UsersService } from '../users/users.service';
import { UserStatus } from '../users/user.schema';
import { RolesService } from '../roles/roles.service';

class PageQueryDto {
  @Type(() => Number) @IsInt() @Min(1) @Max(100000) page = 1;
  @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 20;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
}

class UserQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(['INVITED', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED'])
  status?: UserStatus;
}

class BranchQueryDto extends PageQueryDto {
  @IsOptional() @IsIn(['ACTIVE', 'DEACTIVATED']) status?: BranchStatus;
}

class CreateUserDto {
  @IsString() @MinLength(1) @MaxLength(100) firstName!: string;
  @IsString() @MinLength(1) @MaxLength(100) lastName!: string;
  @IsOptional() @IsString() @MaxLength(150) displayName?: string;
  @IsIn(['USERNAME', 'EMAIL']) identityType!: 'USERNAME' | 'EMAIL';
  @IsString() @MinLength(3) @MaxLength(254) identityValue!: string;
}

class CreateBranchDto {
  @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @IsString() @MinLength(2) @MaxLength(32) code!: string;
}

class UserStatusDto {
  @IsIn(['ACTIVE', 'SUSPENDED']) status!: UserStatus;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

class DeactivateUserDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

class BranchStatusDto {
  @IsIn(['ACTIVE', 'DEACTIVATED']) status!: BranchStatus;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

class RoleDto {
  @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @IsString() @MinLength(2) @MaxLength(48) code!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(permissionKeys.length)
  @IsString({ each: true })
  permissions!: string[];
}

class RoleUpdateDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(permissionKeys.length)
  @IsString({ each: true })
  permissions?: string[];
}

class RoleStatusDto {
  @IsIn([true, false]) isActive!: boolean;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

@Controller('dashboard')
@UseGuards(SessionGuard, PermissionGuard)
export class DashboardController {
  constructor(
    private readonly users: UsersService,
    private readonly branches: BranchesService,
    private readonly roles: RolesService,
    private readonly audit: AuditService,
  ) {}

  @Get('summary')
  @RequirePermission('dashboard.read')
  async summary() {
    const [users, branches, roles, activity] = await Promise.all([
      this.users.dashboardCounts(),
      this.branches.dashboardCounts(),
      this.roles.dashboardCounts(),
      this.audit.listRecent(12),
    ]);
    return { users, branches, roles, activity };
  }

  @Get('permissions')
  @RequirePermission('roles.read')
  permissions() {
    return permissionKeys;
  }

  @Get('users')
  @RequirePermission('users.read')
  listUsers(@Query() query: UserQueryDto) {
    return this.users.listAdmin(query);
  }

  @Post('users')
  @RequirePermission('users.create')
  createUser(
    @Body() body: CreateUserDto,
    @Req() request: AuthenticatedRequest,
  ) {
    const input: CreateInvitedHumanInput = {
      firstName: body.firstName,
      lastName: body.lastName,
      displayName: body.displayName,
      identity: { type: body.identityType, value: body.identityValue },
    };
    return this.users.createInvitedHuman(input, this.actor(request));
  }

  @Patch('users/:id/status')
  @RequirePermission('users.update')
  changeUserStatus(
    @Param('id') id: string,
    @Body() body: UserStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.users.changeStatus(
      id,
      body.status,
      this.actor(request),
      body.reason,
    );
  }

  @Patch('users/:id/deactivate')
  @RequirePermission('users.deactivate')
  deactivateUser(
    @Param('id') id: string,
    @Body() body: DeactivateUserDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.users.changeStatus(
      id,
      'DEACTIVATED',
      this.actor(request),
      body.reason,
    );
  }

  @Get('branches')
  @RequirePermission('branches.read')
  listBranches(@Query() query: BranchQueryDto) {
    return this.branches.listAdmin(query);
  }

  @Post('branches')
  @RequirePermission('branches.create')
  createBranch(
    @Body() body: CreateBranchDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.branches.create(body, this.actor(request));
  }

  @Patch('branches/:id/status')
  @RequirePermission('branches.update')
  changeBranchStatus(
    @Param('id') id: string,
    @Body() body: BranchStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.branches.changeStatus(
      id,
      body.status,
      this.actor(request),
      body.reason,
    );
  }

  @Get('roles')
  @RequirePermission('roles.read')
  listRoles(@Query() query: PageQueryDto) {
    return this.roles.listAdmin(query);
  }

  @Post('roles')
  @RequirePermission('roles.create')
  createRole(@Body() body: RoleDto, @Req() request: AuthenticatedRequest) {
    return this.roles.create(body, this.actor(request));
  }

  @Patch('roles/:id')
  @RequirePermission('roles.update')
  updateRole(
    @Param('id') id: string,
    @Body() body: RoleUpdateDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.roles.update(id, body, this.actor(request));
  }

  @Patch('roles/:id/status')
  @RequirePermission('roles.update')
  changeRoleStatus(
    @Param('id') id: string,
    @Body() body: RoleStatusDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.roles.setActive(
      id,
      body.isActive,
      this.actor(request),
      body.reason,
    );
  }

  private actor(request: AuthenticatedRequest) {
    return {
      type: 'USER' as const,
      userId: request.authenticatedPrincipal!.userId,
    };
  }
}

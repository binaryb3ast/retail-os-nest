import { DashboardController } from './dashboard.controller';
import { AuditService } from '../audit/audit.service';
import { BranchesService } from '../branches/branches.service';
import { RolesService } from '../roles/roles.service';
import { UsersService } from '../users/users.service';
import { Types } from 'mongoose';
import { requiredPermissionMetadataKey } from '../authorization/require-permission.decorator';
import type { AuthenticatedRequest } from '../authentication/session.guard';

describe('DashboardController', () => {
  it('returns metrics and recent audit events from the domain services', async () => {
    const users = {
      dashboardCounts: jest
        .fn()
        .mockResolvedValue({ total: 7, active: 5, invited: 1, suspended: 1 }),
    };
    const branches = {
      dashboardCounts: jest.fn().mockResolvedValue({ total: 2, active: 2 }),
    };
    const roles = {
      dashboardCounts: jest.fn().mockResolvedValue({ total: 3, active: 3 }),
    };
    const activity = [
      {
        id: 'event-1',
        action: 'USER.CREATED',
        occurredAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ];
    const audit = { listRecent: jest.fn().mockResolvedValue(activity) };
    const controller = new DashboardController(
      users as unknown as UsersService,
      branches as unknown as BranchesService,
      roles as unknown as RolesService,
      audit as unknown as AuditService,
    );

    await expect(controller.summary()).resolves.toEqual({
      users: { total: 7, active: 5, invited: 1, suspended: 1 },
      branches: { total: 2, active: 2 },
      roles: { total: 3, active: 3 },
      activity,
    });
    expect(users.dashboardCounts).toHaveBeenCalledTimes(1);
    expect(branches.dashboardCounts).toHaveBeenCalledTimes(1);
    expect(roles.dashboardCounts).toHaveBeenCalledTimes(1);
    expect(audit.listRecent).toHaveBeenCalledWith(12);
  });

  it('keeps account deactivation behind its dedicated permission', async () => {
    const userId = new Types.ObjectId();
    const updated = {
      id: new Types.ObjectId().toString(),
      status: 'DEACTIVATED',
    };
    const users = { changeStatus: jest.fn().mockResolvedValue(updated) };
    const controller = new DashboardController(
      users as unknown as UsersService,
      {} as BranchesService,
      {} as RolesService,
      {} as AuditService,
    );
    const request = {
      authenticatedPrincipal: { userId, sessionId: new Types.ObjectId() },
    } as AuthenticatedRequest;

    await expect(
      controller.deactivateUser(updated.id, {}, request),
    ).resolves.toEqual(updated);
    expect(users.changeStatus).toHaveBeenCalledWith(
      updated.id,
      'DEACTIVATED',
      { type: 'USER', userId },
      undefined,
    );
    const deactivateMethod = Object.getOwnPropertyDescriptor(
      DashboardController.prototype,
      'deactivateUser',
    )?.value as object;
    expect(
      Reflect.getMetadata(requiredPermissionMetadataKey, deactivateMethod),
    ).toBe('users.deactivate');
  });
});

export const permissionKeys = [
  'dashboard.read',
  'users.read',
  'users.create',
  'users.update',
  'users.deactivate',
  'branches.read',
  'branches.create',
  'branches.update',
  'branch_memberships.read',
  'branch_memberships.manage',
  'roles.read',
  'roles.create',
  'roles.update',
  'roles.assign',
  'sales.invoice.read',
  'sales.invoice.create',
  'sales.invoice.cancel',
  'inventory.stock.read',
  'inventory.stock.adjust',
  'accounting.journal.read',
  'accounting.journal.create',
] as const;

export type PermissionKey = (typeof permissionKeys)[number];

const permissionSet: ReadonlySet<string> = new Set(permissionKeys);

export function isPermissionKey(value: string): value is PermissionKey {
  return permissionSet.has(value);
}

export function parsePermissions(
  value: readonly string[],
): readonly PermissionKey[] {
  const unique = [...new Set(value)];
  if (unique.some((permission) => !isPermissionKey(permission))) {
    throw new Error('The role contains an unknown permission.');
  }
  return unique as PermissionKey[];
}

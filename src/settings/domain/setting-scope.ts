export type SettingScope = 'SYSTEM' | 'BRANCH';

export type SettingTarget =
  | { readonly scope: 'SYSTEM' }
  | { readonly scope: 'BRANCH'; readonly branchId: string };

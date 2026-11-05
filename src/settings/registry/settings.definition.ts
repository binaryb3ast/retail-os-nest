import type { z } from 'zod';
import type { SettingScope } from '../domain/setting-scope';

export type SettingCategory =
  | 'GENERAL'
  | 'LOCALIZATION'
  | 'FINANCIAL'
  | 'SALES'
  | 'INVENTORY'
  | 'NOTIFICATIONS'
  | 'OPERATIONS'
  | 'INTEGRATIONS';

export type RuntimeEffect = 'NEXT_READ' | 'RESTART' | 'RELOAD';

export interface SettingDefinition<Schema extends z.ZodType = z.ZodType> {
  readonly schema: Schema;
  readonly defaultValue: z.input<Schema>;
  readonly category: SettingCategory;
  readonly description: string;
  readonly scopes: readonly SettingScope[];
  readonly branchOverride: boolean;
  readonly systemFallback: boolean;
  readonly editable: boolean;
  readonly sensitive: false;
  readonly runtimeEffect: RuntimeEffect;
  readonly ui?: {
    readonly label: string;
    readonly input:
      'text' | 'textarea' | 'number' | 'toggle' | 'select' | 'json';
    readonly order: number;
    readonly options?: readonly {
      readonly label: string;
      readonly value: string;
    }[];
  };
}

export function supportsScope(
  definition: Pick<SettingDefinition, 'scopes'>,
  scope: SettingScope,
): boolean {
  const scopes: readonly SettingScope[] = definition.scopes;
  return scopes.includes(scope);
}

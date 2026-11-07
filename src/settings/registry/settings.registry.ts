import { z } from 'zod';
import type { SettingDefinition } from './settings.definition';

export const settingsRegistry = {
  'system.defaultLocale': {
    schema: z.enum(['en', 'fa']),
    defaultValue: 'en',
    category: 'LOCALIZATION',
    description: 'Default locale used when a request has no locale preference.',
    scopes: ['SYSTEM'],
    branchOverride: false,
    systemFallback: false,
    editable: true,
    sensitive: false,
    runtimeEffect: 'NEXT_READ',
    ui: {
      label: 'Default locale',
      input: 'select',
      order: 10,
      options: [
        { label: 'English', value: 'en' },
        { label: 'Persian', value: 'fa' },
      ],
    },
  },
  'system.maintenanceMode': {
    schema: z.boolean(),
    defaultValue: false,
    category: 'OPERATIONS',
    description: 'Indicates whether application maintenance mode is enabled.',
    scopes: ['SYSTEM'],
    branchOverride: false,
    systemFallback: false,
    editable: true,
    sensitive: false,
    runtimeEffect: 'NEXT_READ',
    ui: { label: 'Maintenance mode', input: 'toggle', order: 10 },
  },
  'sales.receiptFooter': {
    schema: z.string().max(500),
    defaultValue: '',
    category: 'SALES',
    description: 'Text printed at the bottom of receipts.',
    scopes: ['SYSTEM', 'BRANCH'],
    branchOverride: true,
    systemFallback: true,
    editable: true,
    sensitive: false,
    runtimeEffect: 'NEXT_READ',
    ui: { label: 'Receipt footer', input: 'textarea', order: 10 },
  },
  'inventory.allowNegativeStock': {
    schema: z.boolean(),
    defaultValue: false,
    category: 'INVENTORY',
    description: 'Allow inventory quantities to fall below zero.',
    scopes: ['SYSTEM', 'BRANCH'],
    branchOverride: true,
    systemFallback: true,
    editable: true,
    sensitive: false,
    runtimeEffect: 'NEXT_READ',
    ui: { label: 'Allow negative stock', input: 'toggle', order: 10 },
  },
  'branch.businessHours': {
    schema: z.record(
      z.string(),
      z
        .object({
          opensAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          closesAt: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
          closed: z.boolean(),
        })
        .strict(),
    ),
    defaultValue: {},
    category: 'OPERATIONS',
    description: 'Opening hours configured independently for each branch.',
    scopes: ['BRANCH'],
    branchOverride: false,
    systemFallback: false,
    editable: true,
    sensitive: false,
    runtimeEffect: 'NEXT_READ',
    ui: { label: 'Business hours', input: 'json', order: 20 },
  },
} satisfies Record<string, SettingDefinition>;

export type SettingKey = keyof typeof settingsRegistry;
export type SettingValue<Key extends SettingKey> =
  (typeof settingsRegistry)[Key]['schema'] extends infer Schema
    ? Schema extends z.ZodType
      ? z.output<Schema>
      : never
    : never;

export function isSettingKey(key: string): key is SettingKey {
  return Object.hasOwn(settingsRegistry, key);
}

export function validateRegistryDefaults(): void {
  for (const [key, definition] of Object.entries(settingsRegistry)) {
    const result = definition.schema.safeParse(definition.defaultValue);
    if (!result.success) {
      throw new Error(`Invalid default value in settings registry: ${key}`);
    }
    if (
      definition.systemFallback &&
      (!definition.scopes.includes('SYSTEM') ||
        !definition.scopes.includes('BRANCH'))
    ) {
      throw new Error(
        `System fallback requires SYSTEM and BRANCH scopes: ${key}`,
      );
    }
    if (
      definition.branchOverride &&
      (!definition.scopes.includes('BRANCH') ||
        !definition.scopes.includes('SYSTEM'))
    ) {
      throw new Error(
        `Branch override requires SYSTEM and BRANCH scopes: ${key}`,
      );
    }
  }
}

import { ConfigError } from '@connectors/core';
import type { z } from 'zod';

export function loadConfig<T extends z.ZodType>(
  schema: T,
  env: Record<string, string | undefined> = process.env,
): z.infer<T> {
  const result = schema.safeParse(env);
  if (result.success) return result.data;
  const lines = result.error.issues.map((issue) => {
    const key = issue.path.map(String).join('.') || '(root)';
    return `  ${key}: ${issue.message}`;
  });
  throw new ConfigError(`Invalid configuration:\n${lines.join('\n')}`, {
    details: { issues: result.error.issues },
  });
}

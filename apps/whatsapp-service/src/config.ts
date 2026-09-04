import {
  booleanString,
  loadConfig,
  logLevel,
  optionalNonEmptyString,
  optionalUrl,
  port,
} from '@connectors/config';
import { z } from 'zod';

export const serviceConfigSchema = z.object({
  PORT: port(3000),
  HOST: z.string().min(1).default('0.0.0.0'),
  DATA_DIR: z.string().min(1).default('./data'),
  LOG_LEVEL: logLevel,
  LOG_PRETTY: booleanString(false),
  API_KEY: optionalNonEmptyString,
  WEBHOOK_URL: optionalUrl,
  WEBHOOK_SECRET: optionalNonEmptyString,
  WA_FETCH_LATEST_VERSION: booleanString(false),
});

export type ServiceConfig = z.infer<typeof serviceConfigSchema>;

export function loadServiceConfig(
  env: Record<string, string | undefined> = process.env,
): ServiceConfig {
  return loadConfig(serviceConfigSchema, env);
}

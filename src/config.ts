// SPDX-License-Identifier: Apache-2.0
import type { AdditionalConfig, ProcessorConfig } from '@tazama-lf/frms-coe-lib/lib/config/processor.config';
import * as dotenv from 'dotenv';
import path from 'node:path';

dotenv.config({
  path: path.resolve(__dirname, '../.env'),
});

export interface ExtendedConfig {
  RETRY_ATTEMPTS: number;
  MAX_SOCKETS: number;
  AUTH_HEALTH_URL: string;
  AUTH_TOKEN_URL: string;
  DESTINATION_TRANSPORT_URL: string;
  AUTH_USERNAME: string;
  AUTH_PASSWORD: string;
}

export const additionalEnvironmentVariables: AdditionalConfig[] = [
  {
    name: 'RETRY_ATTEMPTS',
    type: 'number',
  },
  {
    name: 'MAX_SOCKETS',
    type: 'number',
  },
  {
    name: 'AUTH_HEALTH_URL',
    type: 'string',
  },
  {
    name: 'AUTH_TOKEN_URL',
    type: 'string',
  },
  {
    name: 'DESTINATION_TRANSPORT_URL',
    type: 'string',
  },
  {
    name: 'AUTH_USERNAME',
    type: 'string',
  },
  {
    name: 'AUTH_PASSWORD',
    type: 'string',
  },
];

export type Configuration = ProcessorConfig & ExtendedConfig;

// SPDX-License-Identifier: Apache-2.0
import type { LoggerService } from '@tazama-lf/frms-coe-lib';
import type { Apm } from '@tazama-lf/frms-coe-lib/lib/services/apm';
import http from 'http';
import https from 'https';
import axios from 'axios';
import NodeCache from 'node-cache';
import { additionalEnvironmentVariables, type Configuration } from '../config';
import { validateProcessorConfig } from '@tazama-lf/frms-coe-lib/lib/config/processor.config';
import type { ITransportPlugin } from '@tazama-lf/frms-coe-lib/lib/interfaces/relay-service/ITransportPlugin';

export default class RestAPIRelayPlugin implements ITransportPlugin {
  private loggerService?: LoggerService;
  private apm?: Apm;
  private readonly configuration: Configuration;
  private readonly cache: NodeCache;
  private readonly httpAgent: http.Agent;
  private readonly httpsAgent: https.Agent;

  constructor() {
    this.configuration = validateProcessorConfig(additionalEnvironmentVariables) as Configuration;
    this.cache = new NodeCache();
    this.httpAgent = new http.Agent({
      keepAlive: true,
      maxSockets: this.configuration.MAX_SOCKETS,
    });
    this.httpsAgent = new https.Agent({
      keepAlive: true,
      maxSockets: this.configuration.MAX_SOCKETS,
    });
  }

  async init(loggerService?: LoggerService, apm?: Apm): Promise<void> {
    this.loggerService = loggerService;
    this.apm = apm;
    this.loggerService?.log('init() called, fetching auth token', RestAPIRelayPlugin.name);
    let isHealthy = false;
    for (let i = 0; i < 10; i++) {
      const healthCheck = await axios.get(this.configuration.AUTH_HEALTH_URL);
      if (healthCheck.status !== 200) {
        this.loggerService?.log('Health check failed,trying again', RestAPIRelayPlugin.name);
        await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait for 1 second before retrying
      } else {
        const tokenRes = await axios.post(this.configuration.AUTH_TOKEN_URL, {
          username: this.configuration.AUTH_USERNAME,
          password: this.configuration.AUTH_PASSWORD,
        });
        if (!tokenRes.data) {
          this.loggerService?.error('Token response is invalid', tokenRes, RestAPIRelayPlugin.name);
          continue;
        }
        this.cache.set(this.configuration.AUTH_USERNAME, tokenRes.data);
        isHealthy = true;
        break;
      }
    }
    if (!isHealthy) {
      this.loggerService?.error('Failed to initialize RestAPIRelayPlugin after multiple attempts', RestAPIRelayPlugin.name);
      throw new Error('Initialization failed: Unable to fetch a valid token');
    }
  }

  /**
   * Relays data to a destination transport URL.
   *
   * This method sends the provided data to the configured destination transport URL.
   * It handles different input formats (Uint8Array or string), prepares the payload,
   * manages authentication tokens, and logs the operation. APM transactions and spans
   * are created for monitoring purposes.
   *
   * @param data - The data to relay to the destination transport URL. Can be a Uint8Array or string.
   * @returns A Promise that resolves when the operation completes.
   * @throws Throws errors if the transport operation fails. These errors are logged internally
   *         and re-thrown for external handling.
   */
  async relay(data: Uint8Array | string): Promise<void> {
    let apmTransaction = null;
    this.loggerService?.log('Relaying data', RestAPIRelayPlugin.name);
    let token = this.cache.get<string>(this.configuration.AUTH_USERNAME);
    if (!token) {
      token = await this.fetchToken();
    }
    const payload = this.preparePayload(data);
    try {
      apmTransaction = this.apm?.startTransaction(RestAPIRelayPlugin.name);
      const span = this.apm?.startSpan('relay');
      await this.sendData(token, payload);
      span?.end();
    } catch (error) {
      this.loggerService?.error('Error relaying data', error, RestAPIRelayPlugin.name);
      throw error as Error;
    } finally {
      if (apmTransaction) {
        apmTransaction.end();
      }
    }
  }

  /**
   * Fetches an authentication token from the configured authentication service with retry logic.
   *
   * This method attempts to obtain an authentication token by sending a POST request to the
   * authentication service URL with the configured username and password. It implements a
   * retry mechanism that will attempt up to 10 times with a 500ms delay between attempts.
   * If a valid token is received, it is cached using the username as the key for future use.
   *
   * @returns A Promise that resolves to the fetched authentication token as a string.
   * @throws Throws an error with the message "Failed to fetch token after multiple attempts"
   *         if all retry attempts fail or if no valid token is received after 10 attempts.
   *
   * @private
   * @async
   */
  private async fetchToken(): Promise<string> {
    for (let i = 0; i < 10; i++) {
      try {
        const tokenRes = await axios.post(this.configuration.AUTH_TOKEN_URL, {
          username: this.configuration.AUTH_USERNAME,
          password: this.configuration.AUTH_PASSWORD,
        });

        if (tokenRes.data) {
          this.cache.set(this.configuration.AUTH_USERNAME, tokenRes.data);
          return tokenRes.data;
        } else {
          this.loggerService?.error('Invalid token response', tokenRes, RestAPIRelayPlugin.name);
        }
      } catch (error) {
        this.loggerService?.error('Error fetching token', error, RestAPIRelayPlugin.name);
      }

      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
    throw new Error('Failed to fetch token after multiple attempts');
  }

  /**
   * Prepares the payload for transmission by ensuring it is in the correct format.
   *
   * This method accepts data in the form of a `Uint8Array` or `string` and returns it
   * in the same format if valid. If the data is neither a `Uint8Array` nor a `string`,
   * it converts the data to a JSON string representation.
   *
   * @param data - The input data to be prepared for transmission. Can be a `Uint8Array` or `string`.
   * @returns The prepared payload in the same format as the input (`Uint8Array` or `string`),
   *          or a JSON string if the input is neither.
   */
  private preparePayload(data: Uint8Array | string): Uint8Array | string {
    if (Buffer.isBuffer(data)) {
      return data;
    } else if (typeof data === 'string') {
      return data;
    } else {
      return JSON.stringify(data);
    }
  }

  /**
   * Sends data to the configured destination transport URL using an authentication token.
   *
   * This method performs an HTTP POST request to relay the provided payload to the destination
   * transport URL. It includes the authentication token in the request headers and uses
   * HTTP/HTTPS agents for optimized connection handling. If the request fails due to an
   * unauthorized error (status code 401), it attempts to fetch a new token and retries the request.
   *
   * @param token - The authentication token to be used in the request headers.
   * @param payload - The data to be sent to the destination transport URL. Can be a Uint8Array or string.
   * @returns A Promise that resolves when the data is successfully sent.
   * @throws Throws an error if the request fails or if retry attempts are unsuccessful.
   */
  private async sendData(token: string, payload: Uint8Array | string): Promise<void> {
    try {
      const response = await axios.post(this.configuration.DESTINATION_TRANSPORT_URL, payload, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        httpAgent: this.httpAgent,
        httpsAgent: this.httpsAgent,
      });

      if (response.status === 401) {
        this.loggerService?.error('Unauthorized access - token may be invalid', RestAPIRelayPlugin.name);
        const newToken = await this.fetchToken();
        await axios.post(this.configuration.DESTINATION_TRANSPORT_URL, payload, {
          headers: {
            Authorization: `Bearer ${newToken}`,
          },
          httpAgent: this.httpAgent,
          httpsAgent: this.httpsAgent,
        });
      }
    } catch (error) {
      this.loggerService?.error('Failed to send data', error, RestAPIRelayPlugin.name);
      throw error as Error;
    }
  }
}

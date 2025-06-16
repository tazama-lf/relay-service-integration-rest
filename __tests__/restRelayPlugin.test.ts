import RestAPIRelayPlugin from '../src/service/restRelayPlugin';
import axios from 'axios';
import NodeCache from 'node-cache';
import { validateProcessorConfig } from '@tazama-lf/frms-coe-lib/lib/config/processor.config';

jest.mock('axios');
jest.mock('node-cache');
jest.mock('@tazama-lf/frms-coe-lib/lib/config/processor.config');

const mockedAxios = axios as jest.Mocked<typeof axios>;
const MockedNodeCache = NodeCache as jest.MockedClass<typeof NodeCache>;
const mockedValidateProcessorConfig = validateProcessorConfig as jest.MockedFunction<typeof validateProcessorConfig>;

describe('RestAPIRelayPlugin', () => {
  let plugin: RestAPIRelayPlugin;
  let mockLoggerService: any;
  let mockApm: any;
  let mockCache: jest.Mocked<NodeCache>;

  const mockConfig = {
    AUTH_HEALTH_URL: 'http://auth-health',
    AUTH_TOKEN_URL: 'http://auth-token',
    AUTH_USERNAME: 'testuser',
    AUTH_PASSWORD: 'testpass',
    DESTINATION_TRANSPORT_URL: 'http://destination',
    MAX_SOCKETS: 10,
  };

  beforeEach(() => {
    mockLoggerService = {
      log: jest.fn(),
      error: jest.fn(),
    };

    mockApm = {
      startTransaction: jest.fn().mockReturnValue({
        end: jest.fn(),
      }),
      startSpan: jest.fn().mockReturnValue({
        end: jest.fn(),
      }),
    };

    mockCache = {
      get: jest.fn(),
      set: jest.fn(),
    } as any;

    MockedNodeCache.mockImplementation(() => mockCache);
    mockedValidateProcessorConfig.mockReturnValue(mockConfig as any);

    plugin = new RestAPIRelayPlugin(mockLoggerService, mockApm);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('init', () => {
    it('should initialize successfully with valid health check and token', async () => {
      mockedAxios.get.mockResolvedValue({ status: 200 });
      mockedAxios.post.mockResolvedValue({ data: 'valid-token' });

      await plugin.init();

      expect(mockedAxios.get).toHaveBeenCalledWith(mockConfig.AUTH_HEALTH_URL);
      expect(mockedAxios.post).toHaveBeenCalledWith(mockConfig.AUTH_TOKEN_URL, {
        username: mockConfig.AUTH_USERNAME,
        password: mockConfig.AUTH_PASSWORD,
      });
      expect(mockCache.set).toHaveBeenCalledWith(mockConfig.AUTH_USERNAME, 'valid-token');
    });
    it('should retry health check on failure and eventually succeed', async () => {
      mockedAxios.get.mockResolvedValueOnce({ status: 500 }).mockResolvedValueOnce({ status: 200 });
      mockedAxios.post.mockResolvedValue({ data: 'valid-token' });

      await plugin.init();

      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
      expect(mockLoggerService.log).toHaveBeenCalledWith('Healt check failed,trying again', 'RestAPIRelayPlugin');
    }, 10000);
    it('should throw error after max attempts', async () => {
      mockedAxios.get.mockResolvedValue({ status: 500 });

      await expect(plugin.init()).rejects.toThrow('Initialization failed: Unable to fetch a valid token');
      expect(mockLoggerService.error).toHaveBeenCalledWith(
        'Failed to initialize RestAPIRelayPlugin after multiple attempts',
        'RestAPIRelayPlugin',
      );
    }, 60000);

    it('should continue on invalid token response', async () => {
      mockedAxios.get.mockResolvedValue({ status: 200 });
      mockedAxios.post.mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ data: 'valid-token' });

      await plugin.init();

      expect(mockLoggerService.error).toHaveBeenCalledWith('Token response is invalid', { data: null }, 'RestAPIRelayPlugin');
      expect(mockCache.set).toHaveBeenCalledWith(mockConfig.AUTH_USERNAME, 'valid-token');
    });
  });

  describe('relay', () => {
    it('should relay data with cached token', async () => {
      const testData = 'test-data';
      mockCache.get.mockReturnValue('cached-token');
      mockedAxios.post.mockResolvedValue({ status: 200 });

      await plugin.relay(testData);

      expect(mockLoggerService.log).toHaveBeenCalledWith('Relaying data', 'RestAPIRelayPlugin');
      expect(mockCache.get).toHaveBeenCalledWith(mockConfig.AUTH_USERNAME);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        mockConfig.DESTINATION_TRANSPORT_URL,
        testData,
        expect.objectContaining({
          headers: { Authorization: 'Bearer cached-token' },
        }),
      );
    });

    it('should fetch new token when not cached', async () => {
      const testData = 'test-data';
      mockCache.get.mockReturnValue(undefined);
      mockedAxios.post.mockResolvedValueOnce({ data: 'new-token' }).mockResolvedValueOnce({ status: 200 });

      await plugin.relay(testData);

      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
      expect(mockCache.set).toHaveBeenCalledWith(mockConfig.AUTH_USERNAME, 'new-token');
    });
    it('should handle relay errors gracefully', async () => {
      const testData = 'test-data';
      mockCache.get.mockReturnValue('cached-token');
      mockedAxios.post.mockRejectedValue(new Error('Network error'));

      await plugin.relay(testData);

      expect(mockLoggerService.error).toHaveBeenCalledWith('Failed to send data', expect.any(Error), 'RestAPIRelayPlugin');
    });
    it('should handle Uint8Array data', async () => {
      const testData = new Uint8Array([1, 2, 3]);
      const expectedPayload = JSON.stringify(testData); // The implementation converts Uint8Array to JSON string
      mockCache.get.mockReturnValue('cached-token');
      mockedAxios.post.mockResolvedValue({ status: 200 });

      await plugin.relay(testData);

      expect(mockedAxios.post).toHaveBeenCalledWith(mockConfig.DESTINATION_TRANSPORT_URL, expectedPayload, expect.any(Object));
    });
  });

  describe('fetchToken', () => {
    it('should fetch and cache token successfully', async () => {
      mockedAxios.post.mockResolvedValue({ data: 'fetched-token' });

      const result = await (plugin as any).fetchToken();

      expect(result).toBe('fetched-token');
      expect(mockCache.set).toHaveBeenCalledWith(mockConfig.AUTH_USERNAME, 'fetched-token');
    });

    it('should retry on failure and eventually succeed', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('Network error')).mockResolvedValueOnce({ data: 'fetched-token' });

      const result = await (plugin as any).fetchToken();

      expect(result).toBe('fetched-token');
      expect(mockLoggerService.error).toHaveBeenCalledWith('Error fetching token', expect.any(Error), 'RestAPIRelayPlugin');
    });

    it('should throw error after max retries', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Network error'));

      await expect((plugin as any).fetchToken()).rejects.toThrow('Failed to fetch token after multiple attempts');
    });

    it('should handle invalid token response', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ data: 'valid-token' });

      const result = await (plugin as any).fetchToken();

      expect(result).toBe('valid-token');
      expect(mockLoggerService.error).toHaveBeenCalledWith('Invalid token response', { data: null }, 'RestAPIRelayPlugin');
    });
  });

  describe('preparePayload', () => {
    it('should return Buffer as is', () => {
      const buffer = Buffer.from('test');
      const result = (plugin as any).preparePayload(buffer);
      expect(result).toBe(buffer);
    });

    it('should return string as is', () => {
      const str = 'test-string';
      const result = (plugin as any).preparePayload(str);
      expect(result).toBe(str);
    });

    it('should stringify non-string non-buffer data', () => {
      const obj = { test: 'data' };
      const result = (plugin as any).preparePayload(obj);
      expect(result).toBe(JSON.stringify(obj));
    });
  });

  describe('sendData', () => {
    it('should send data successfully', async () => {
      mockedAxios.post.mockResolvedValue({ status: 200 });

      await (plugin as any).sendData('test-token', 'test-payload');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        mockConfig.DESTINATION_TRANSPORT_URL,
        'test-payload',
        expect.objectContaining({
          headers: { Authorization: 'Bearer test-token' },
        }),
      );
    });

    it('should retry with new token on 401 response', async () => {
      mockedAxios.post
        .mockResolvedValueOnce({ status: 401 })
        .mockResolvedValueOnce({ data: 'new-token' })
        .mockResolvedValueOnce({ status: 200 });

      await (plugin as any).sendData('old-token', 'test-payload');

      expect(mockedAxios.post).toHaveBeenCalledTimes(3);
      expect(mockLoggerService.error).toHaveBeenCalledWith('Unauthorized access - token may be invalid', 'RestAPIRelayPlugin');
    });

    it('should handle send errors gracefully', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Send error'));

      await (plugin as any).sendData('test-token', 'test-payload');

      expect(mockLoggerService.error).toHaveBeenCalledWith('Failed to send data', expect.any(Error), 'RestAPIRelayPlugin');
    });
  });
});

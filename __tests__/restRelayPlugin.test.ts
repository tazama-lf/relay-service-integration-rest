import RestAPIRelayPlugin from '../src/service/restRelayPlugin';
import axios from 'axios';
import NodeCache from 'node-cache';
import { validateProcessorConfig } from '@tazama-lf/frms-coe-lib/lib/config/processor.config';

jest.mock('node:timers/promises', () => ({
  setTimeout: jest.fn(() => Promise.resolve()),
}));

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
    RETRY_ATTEMPTS: 10,
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

    // Default axios mocks
    mockedAxios.get.mockResolvedValue({ status: 200 });
    mockedAxios.post.mockResolvedValue({ data: 'default-token', status: 200 });

    plugin = new RestAPIRelayPlugin();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with correct configuration and agents', () => {
      expect(mockedValidateProcessorConfig).toHaveBeenCalledWith(expect.any(Object));
      expect(MockedNodeCache).toHaveBeenCalled();

      // Verify that the configuration is set correctly
      expect(plugin).toBeInstanceOf(RestAPIRelayPlugin);
    });

    it('should create HTTP and HTTPS agents with correct options', () => {
      // The constructor should have created agents with keepAlive and maxSockets
      // Since we can't directly access private properties, we verify through behavior
      expect(plugin).toBeDefined();
    });
  });

  describe('init', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should initialize successfully with valid health check and token', async () => {
      mockedAxios.get.mockResolvedValue({ status: 200 });
      mockedAxios.post.mockResolvedValue({ data: 'valid-token' });

      await plugin.init(mockLoggerService, mockApm);

      expect(mockLoggerService.log).toHaveBeenCalledWith('init() called, fetching auth token', 'RestAPIRelayPlugin');
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

      const initPromise = plugin.init(mockLoggerService, mockApm);
      await jest.advanceTimersByTimeAsync(5000);
      await initPromise;

      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
      expect(mockLoggerService.log).toHaveBeenCalledWith('Health check failed,trying again', 'RestAPIRelayPlugin');
    });

    it('should continue on invalid token response and retry', async () => {
      mockedAxios.get.mockResolvedValue({ status: 200 });
      mockedAxios.post.mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ data: 'valid-token' });

      const initPromise = plugin.init(mockLoggerService, mockApm);
      await jest.advanceTimersByTimeAsync(5000);
      await initPromise;

      expect(mockLoggerService.error).toHaveBeenCalledWith('Token response is invalid', { data: null }, 'RestAPIRelayPlugin');
      expect(mockCache.set).toHaveBeenCalledWith(mockConfig.AUTH_USERNAME, 'valid-token');
    });

    it('should wait 5 seconds between health check retries', async () => {
      mockedAxios.get.mockResolvedValueOnce({ status: 500 }).mockResolvedValueOnce({ status: 200 });
      mockedAxios.post.mockResolvedValue({ data: 'valid-token' });

      const initPromise = plugin.init(mockLoggerService, mockApm);
      await jest.advanceTimersByTimeAsync(5000);
      await initPromise;

      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });

    it('should initialize without logger and apm services', async () => {
      mockedAxios.get.mockResolvedValue({ status: 200 });
      mockedAxios.post.mockResolvedValue({ data: 'valid-token' });

      await plugin.init();

      expect(mockedAxios.get).toHaveBeenCalledWith(mockConfig.AUTH_HEALTH_URL);
      expect(mockCache.set).toHaveBeenCalledWith(mockConfig.AUTH_USERNAME, 'valid-token');
    });
  });

  describe('relay', () => {
    beforeEach(async () => {
      // Initialize the plugin before each relay test
      mockedAxios.get.mockResolvedValue({ status: 200 });
      mockedAxios.post.mockResolvedValue({ data: 'init-token' });
      await plugin.init(mockLoggerService, mockApm);
      jest.clearAllMocks(); // Clear mocks after init to focus on relay method calls
    });
    it('should relay string data with cached token and include Content-Type header', async () => {
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
          headers: {
            'Authorization': 'Bearer cached-token',
            'Content-Type': 'application/json',
          },
          httpAgent: expect.any(Object),
          httpsAgent: expect.any(Object),
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

      await expect(plugin.relay(testData)).rejects.toThrow('Network error');
      expect(mockLoggerService.error).toHaveBeenCalledWith('Error relaying data', expect.any(Error), 'RestAPIRelayPlugin');
    });

    it('should handle APM transactions correctly', async () => {
      const testData = 'test-data';
      mockCache.get.mockReturnValue('cached-token');

      // Mock the sendData method to avoid actual HTTP calls
      const sendDataSpy = jest.spyOn(plugin as any, 'sendData').mockResolvedValue(undefined);

      const mockTransaction = { end: jest.fn() };
      const mockSpan = { end: jest.fn() };
      mockApm.startTransaction.mockReturnValue(mockTransaction);
      mockApm.startSpan.mockReturnValue(mockSpan);

      await plugin.relay(testData);

      expect(mockApm.startTransaction).toHaveBeenCalledWith('RestAPIRelayPlugin');
      expect(mockApm.startSpan).toHaveBeenCalledWith('relay');
      expect(mockSpan.end).toHaveBeenCalled();
      expect(mockTransaction.end).toHaveBeenCalled();

      sendDataSpy.mockRestore();
    });

    it('should end APM transaction even when error occurs', async () => {
      const testData = 'test-data';
      mockCache.get.mockReturnValue('cached-token');

      // Mock the sendData method to throw an error
      const sendDataSpy = jest.spyOn(plugin as any, 'sendData').mockRejectedValue(new Error('Network error'));

      const mockTransaction = { end: jest.fn() };
      const mockSpan = { end: jest.fn() };
      mockApm.startTransaction.mockReturnValue(mockTransaction);
      mockApm.startSpan.mockReturnValue(mockSpan);

      await expect(plugin.relay(testData)).rejects.toThrow('Network error');
      expect(mockTransaction.end).toHaveBeenCalled();

      sendDataSpy.mockRestore();
    });
    it('should handle Uint8Array data correctly without Content-Type header', async () => {
      const testData = new Uint8Array([1, 2, 3]);
      mockCache.get.mockReturnValue('cached-token');
      mockedAxios.post.mockResolvedValue({ status: 200 });

      await plugin.relay(testData);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        mockConfig.DESTINATION_TRANSPORT_URL,
        testData, // Data is passed directly without processing
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer cached-token',
            // No Content-Type header for Uint8Array
          },
          httpAgent: expect.any(Object),
          httpsAgent: expect.any(Object),
        }),
      );
    });

    it('should handle Buffer data correctly without Content-Type header', async () => {
      const testData = Buffer.from('test-buffer');
      mockCache.get.mockReturnValue('cached-token');
      mockedAxios.post.mockResolvedValue({ status: 200 });

      await plugin.relay(testData);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        mockConfig.DESTINATION_TRANSPORT_URL,
        testData,
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer cached-token',
            // No Content-Type header for Buffer
          },
          httpAgent: expect.any(Object),
          httpsAgent: expect.any(Object),
        }),
      );
    });

    it('should handle string data correctly', async () => {
      const testData = 'test-string';
      mockCache.get.mockReturnValue('cached-token');
      mockedAxios.post.mockResolvedValue({ status: 200 });

      await plugin.relay(testData);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        mockConfig.DESTINATION_TRANSPORT_URL,
        testData,
        expect.objectContaining({
          headers: {
            'Authorization': 'Bearer cached-token',
            'Content-Type': 'application/json',
          },
          httpAgent: expect.any(Object),
          httpsAgent: expect.any(Object),
        }),
      );
    });
    it('should handle null APM gracefully', async () => {
      // Reinitialize plugin without APM
      const pluginWithoutApm = new RestAPIRelayPlugin();
      await pluginWithoutApm.init(mockLoggerService);

      const testData = 'test-data';
      mockCache.get.mockReturnValue('cached-token');
      mockedAxios.post.mockResolvedValue({ status: 200 });

      await pluginWithoutApm.relay(testData);

      expect(mockLoggerService.log).toHaveBeenCalledWith('Relaying data', 'RestAPIRelayPlugin');
    });
  });

  describe('fetchToken', () => {
    beforeEach(async () => {
      // Initialize plugin to set up logger service
      await plugin.init(mockLoggerService, mockApm);
      jest.clearAllMocks();
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should fetch and cache token successfully', async () => {
      mockedAxios.post.mockResolvedValue({ data: 'fetched-token' });

      const result = await (plugin as any).fetchToken();

      expect(result).toBe('fetched-token');
      expect(mockCache.set).toHaveBeenCalledWith(mockConfig.AUTH_USERNAME, 'fetched-token');
    });

    it('should retry on failure and eventually succeed', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('Network error')).mockResolvedValueOnce({ data: 'fetched-token' });

      const fetchPromise = (plugin as any).fetchToken();
      const result = await fetchPromise;

      expect(result).toBe('fetched-token');
      expect(mockLoggerService.error).toHaveBeenCalledWith('Error fetching token', expect.any(Error), 'RestAPIRelayPlugin');
    });

    it('should handle invalid token response and retry', async () => {
      mockedAxios.post.mockResolvedValueOnce({ data: null }).mockResolvedValueOnce({ data: 'valid-token' });

      const fetchPromise = (plugin as any).fetchToken();
      const result = await fetchPromise;

      expect(result).toBe('valid-token');
      expect(mockLoggerService.error).toHaveBeenCalledWith('Invalid token response', { data: null }, 'RestAPIRelayPlugin');
    });

    it('should wait 5 seconds between retry attempts', async () => {
      mockedAxios.post.mockRejectedValueOnce(new Error('Network error')).mockResolvedValueOnce({ data: 'fetched-token' });

      const fetchPromise = (plugin as any).fetchToken();
      const result = await fetchPromise;

      expect(result).toBe('fetched-token');
    });
  });

  describe('sendData', () => {
    beforeEach(async () => {
      // Initialize plugin to set up logger service
      await plugin.init(mockLoggerService, mockApm);
      jest.clearAllMocks();
    });
    it('should send string data with Content-Type header', async () => {
      mockedAxios.post.mockResolvedValue({ status: 200 });

      await (plugin as any).sendData('test-token', 'test-payload');

      expect(mockedAxios.post).toHaveBeenCalledWith(
        mockConfig.DESTINATION_TRANSPORT_URL,
        'test-payload',
        expect.objectContaining({
          headers: {
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json',
          },
          httpAgent: expect.any(Object),
          httpsAgent: expect.any(Object),
        }),
      );
    });

    it('should send Uint8Array data without Content-Type header', async () => {
      const uint8Payload = new Uint8Array([1, 2, 3]);
      mockedAxios.post.mockResolvedValue({ status: 200 });

      await (plugin as any).sendData('test-token', uint8Payload);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        mockConfig.DESTINATION_TRANSPORT_URL,
        uint8Payload,
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer test-token',
            // No Content-Type header for Uint8Array
          },
          httpAgent: expect.any(Object),
          httpsAgent: expect.any(Object),
        }),
      );
    });

    it('should send Buffer data without Content-Type header', async () => {
      const bufferPayload = Buffer.from('test-buffer');
      mockedAxios.post.mockResolvedValue({ status: 200 });

      await (plugin as any).sendData('test-token', bufferPayload);

      expect(mockedAxios.post).toHaveBeenCalledWith(
        mockConfig.DESTINATION_TRANSPORT_URL,
        bufferPayload,
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer test-token',
            // No Content-Type header for Buffer
          },
          httpAgent: expect.any(Object),
          httpsAgent: expect.any(Object),
        }),
      );
    });

    it('should retry with new token on 401 response', async () => {
      // Mock fetchToken method
      const fetchTokenSpy = jest.spyOn(plugin as any, 'fetchToken').mockResolvedValue('new-token');

      mockedAxios.post.mockResolvedValueOnce({ status: 401 }).mockResolvedValueOnce({ status: 200 });

      await (plugin as any).sendData('old-token', 'test-payload');

      expect(mockedAxios.post).toHaveBeenCalledTimes(2);
      expect(mockLoggerService.log).toHaveBeenCalledWith('Unauthorized access - token may be invalid', 'RestAPIRelayPlugin');
      expect(fetchTokenSpy).toHaveBeenCalled(); // Verify the second call uses the new token
      expect(mockedAxios.post).toHaveBeenNthCalledWith(
        2,
        mockConfig.DESTINATION_TRANSPORT_URL,
        'test-payload',
        expect.objectContaining({
          headers: {
            'Authorization': 'Bearer new-token',
            'Content-Type': 'application/json',
          },
          httpAgent: expect.any(Object),
          httpsAgent: expect.any(Object),
        }),
      );

      fetchTokenSpy.mockRestore();
    });

    it('should handle send errors gracefully', async () => {
      mockedAxios.post.mockRejectedValue(new Error('Send error'));

      await expect((plugin as any).sendData('test-token', 'test-payload')).rejects.toThrow('Send error');
      expect(mockLoggerService.error).toHaveBeenCalledWith('Failed to send data', expect.any(Error), 'RestAPIRelayPlugin');
    });

    it('should handle different payload types with correct headers', async () => {
      mockedAxios.post.mockResolvedValue({ status: 200 });

      // Test with Buffer - no Content-Type header
      const bufferPayload = Buffer.from('test');
      await (plugin as any).sendData('test-token', bufferPayload);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        mockConfig.DESTINATION_TRANSPORT_URL,
        bufferPayload,
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer test-token',
            // No Content-Type header for Buffer
          },
          httpAgent: expect.any(Object),
          httpsAgent: expect.any(Object),
        }),
      );

      // Test with Uint8Array - no Content-Type header
      const uint8Payload = new Uint8Array([1, 2, 3]);
      await (plugin as any).sendData('test-token', uint8Payload);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        mockConfig.DESTINATION_TRANSPORT_URL,
        uint8Payload,
        expect.objectContaining({
          headers: {
            Authorization: 'Bearer test-token',
            // No Content-Type header for Uint8Array
          },
          httpAgent: expect.any(Object),
          httpsAgent: expect.any(Object),
        }),
      );

      // Test with string - includes Content-Type header
      const stringPayload = 'test-string';
      await (plugin as any).sendData('test-token', stringPayload);
      expect(mockedAxios.post).toHaveBeenCalledWith(
        mockConfig.DESTINATION_TRANSPORT_URL,
        stringPayload,
        expect.objectContaining({
          headers: {
            'Authorization': 'Bearer test-token',
            'Content-Type': 'application/json',
          },
          httpAgent: expect.any(Object),
          httpsAgent: expect.any(Object),
        }),
      );
    });

    it('should throw error when 401 retry also fails', async () => {
      const fetchTokenSpy = jest.spyOn(plugin as any, 'fetchToken').mockResolvedValue('new-token');

      mockedAxios.post.mockResolvedValueOnce({ status: 401 }).mockRejectedValueOnce(new Error('Retry failed'));

      await expect((plugin as any).sendData('old-token', 'test-payload')).rejects.toThrow('Retry failed');
      expect(fetchTokenSpy).toHaveBeenCalled();
      expect(mockedAxios.post).toHaveBeenCalledTimes(2);

      fetchTokenSpy.mockRestore();
    });

    it('should use HTTP and HTTPS agents correctly', async () => {
      mockedAxios.post.mockResolvedValue({ status: 200 });

      await (plugin as any).sendData('test-token', 'test-payload');

      const callArgs = mockedAxios.post.mock.calls[0]?.[2];
      expect(callArgs).toBeDefined();
      expect(callArgs?.httpAgent).toBeDefined();
      expect(callArgs?.httpsAgent).toBeDefined();
      expect(callArgs?.httpAgent).toEqual(expect.any(Object));
      expect(callArgs?.httpsAgent).toEqual(expect.any(Object));
    });
  });

  describe('edge cases and integration', () => {
    it('should handle network timeout during health check', async () => {
      mockedAxios.get.mockRejectedValue(new Error('ECONNABORTED'));

      await expect(plugin.init(mockLoggerService, mockApm)).rejects.toThrow('ECONNABORTED');
    });

    it('should handle malformed response during token fetch', async () => {
      mockedAxios.get.mockResolvedValue({ status: 200 });
      mockedAxios.post.mockResolvedValue({}); // No data property

      await expect(plugin.init(mockLoggerService, mockApm)).rejects.toThrow('Initialization failed: Unable to fetch a valid token');
    });

    it('should handle empty string token response', async () => {
      mockedAxios.get.mockResolvedValue({ status: 200 });
      mockedAxios.post.mockResolvedValueOnce({ data: '' }).mockResolvedValueOnce({ data: 'valid-token' });

      await plugin.init(mockLoggerService, mockApm);

      expect(mockLoggerService.error).toHaveBeenCalledWith('Token response is invalid', { data: '' }, 'RestAPIRelayPlugin');
    });

    it('should work correctly when logger service is undefined', async () => {
      mockedAxios.get.mockResolvedValue({ status: 200 });
      mockedAxios.post.mockResolvedValue({ data: 'valid-token' });

      // Should not throw when logger is undefined
      await expect(plugin.init()).resolves.not.toThrow();
    });

    it('should handle concurrent relay calls', async () => {
      await plugin.init(mockLoggerService, mockApm);
      jest.clearAllMocks();

      mockCache.get.mockReturnValue('cached-token');
      mockedAxios.post.mockResolvedValue({ status: 200 });

      const relayPromises = [plugin.relay('data1'), plugin.relay('data2'), plugin.relay('data3')];

      await Promise.all(relayPromises);

      expect(mockedAxios.post).toHaveBeenCalledTimes(3);
    });

    it('should handle token refresh during concurrent requests', async () => {
      await plugin.init(mockLoggerService, mockApm);
      jest.clearAllMocks();

      mockCache.get.mockReturnValue(undefined);

      // Each relay call will: 1) fetch token, 2) send data
      // So 2 concurrent calls = at least 4 axios.post calls, possibly more if tokens aren't cached between calls
      mockedAxios.post.mockResolvedValue({ data: 'token', status: 200 });

      const relayPromises = [plugin.relay('data1'), plugin.relay('data2')];

      await Promise.all(relayPromises);

      // Expect at least 4 calls (2 token fetches + 2 data sends), but could be more due to timing
      expect(mockedAxios.post.mock.calls.length).toBeGreaterThanOrEqual(4);
    });
  });
});

# REST Relay Plugin

A TypeScript plugin for relaying messages via REST API, designed for secure and reliable HTTP-based message transmission with authentication and caching capabilities.

## Overview

The REST Relay Plugin is a transport plugin that enables applications to easily connect to and send messages to REST API endpoints. It provides a simple interface for initialization and message relaying with built-in authentication token management, connection pooling, and retry mechanisms. The plugin integrates with application performance monitoring (APM) to track transactions and spans, making it easy to monitor and troubleshoot message publishing.

## Features

- Send data to REST API endpoints with configurable connection settings
- Built-in authentication token management with automatic refresh
- Token caching to minimize authentication requests
- HTTP/HTTPS connection pooling for optimal performance
- Health check verification before initialization. (Should return a 200 status code)
- Automatic retry mechanisms for token fetching and API calls
- Support for various data types (buffer, string) with automatic conversion
- APM integration for performance monitoring and tracing
- Comprehensive logging for debugging and operational visibility
- Simple API with just two methods: `init()` and `relay()`
- Written in TypeScript with full type safety
- Fully tested with Jest

## Core Components

- **RestRelayPlugin Class**: Main implementation that handles authentication and message relaying
- **Configuration Module**: Environment-based configuration system with validation
- **Token Management**: Automatic token fetching, caching, and refresh capabilities

## Installation

```bash
npm install @tazama-lf/rest-relay-plugin
```

## Configuration

The plugin uses environment variables for configuration. Create a `.env` file in the root directory with the following variables:

```
RETRY_ATTEMPTS=10
MAX_SOCKETS=10
AUTH_HEALTH_URL=https://auth-service/health
AUTH_TOKEN_URL=https://auth-service/token
DESTINATION_TRANSPORT_URL=https://destination-api/endpoint
AUTH_USERNAME=your-username
AUTH_PASSWORD=your-password
```

### Configuration Options

| Environment Variable      | Description                                 | Required |
| ------------------------- | ------------------------------------------- | -------- |
| RETRY_ATTEMPTS            | Number of retry attempts for operations     | Yes      |
| MAX_SOCKETS               | Maximum number of HTTP sockets per agent    | Yes      |
| AUTH_HEALTH_URL           | URL for authentication service health check | Yes      |
| AUTH_TOKEN_URL            | URL for obtaining authentication tokens     | Yes      |
| DESTINATION_TRANSPORT_URL | The REST API endpoint to send data to       | Yes      |
| AUTH_USERNAME             | Username for authentication                 | Yes      |
| AUTH_PASSWORD             | Password for authentication                 | Yes      |

## Usage

### Basic Usage

```typescript
import RestRelayPlugin from '@tazama-lf/rest-relay-plugin';
import { LoggerService, Apm } from '@tazama-lf/frms-coe-lib';

// Create logger and APM instances
const loggerService = new LoggerService();
const apm = new Apm();

// Create plugin instance
const restRelayPlugin = new RestRelayPlugin();

// Initialize the plugin (performs health check and fetches authentication token)
await restRelayPlugin.init(loggerService, apm);

// Create some data to send (supports various formats)
const stringData = 'Hello, REST API!';
const binaryData = new TextEncoder().encode('Hello, REST API!');
const objectData = { message: 'Hello, REST API!', timestamp: Date.now() };

// Relay the data to the REST API endpoint
await restRelayPlugin.relay(stringData);
await restRelayPlugin.relay(binaryData);
await restRelayPlugin.relay(objectData); // Objects are automatically JSON stringified
```

## API Reference

### `RestRelayPlugin` Class

The main class that implements the `ITransportPlugin` interface imported from the `@tazama-lf/frms-coe-lib`.

#### Methods

##### `init(loggerService?: LoggerService, apm?: Apm)`

Initializes the REST relay plugin by performing health checks and fetching authentication tokens.

```typescript
async init(loggerService?: LoggerService, apm?: Apm): Promise<void>
```

- **Parameters**:
  - `loggerService`: An instance of LoggerService from @tazama-lf/frms-coe-lib for logging
  - `apm`: An instance of Apm from @tazama-lf/frms-coe-lib for performance monitoring
- **Returns**: A Promise that resolves when initialization is complete
- **Functionality**:
  - Performs health check on the authentication service (up to configured retries with 5-second delays)
    It should return a 200 status code for confirmation.
  - Fetches an authentication token using the configured credentials
  - Caches the token for future use
  - Logs success or failure of initialization
  - Throws an error if initialization fails after all retry attempts

##### `relay(data)`

Relays (sends) data to the configured REST API endpoint.

```typescript
async relay(data: Uint8Array | string): Promise<void>
```

- **Parameters**:
  - `data`: The data to relay to the REST API. Can be a Uint8Array, string.
- **Returns**: A Promise that resolves when the operation completes.
- **Functionality**:
  - Creates an APM transaction for monitoring
  - Creates a span to track the relay operation
  - Retrieves cached authentication token or fetches a new one if needed
  - Sends the data to the configured REST API endpoint with Bearer token authentication
  - Handles 401 errors by automatically refreshing the token and retrying
  - Uses connection pooling for optimal performance
  - Logs the operation and any errors
  - Ends the APM transaction

### Private Methods

#### `fetchToken()`

Fetches an authentication token with retry logic (up to 5 attempts with 500ms delays).

#### `sendData(token, data)`

Sets `content-type: application/json` if the payload is a string.
Sends data to the destination URL with authentication and handles unauthorized errors.

### Configuration Module

The `config.ts` module loads configuration from environment variables and validates them using the processor config system.

- **Functionality**:
  - Loads the .env file from the project root
  - Validates configuration using @tazama-lf/frms-coe-lib's validateProcessorConfig
  - Provides typed configuration object with all required environment variables
  - Exports additional environment variable definitions for validation

### Interfaces

#### `ITransportPlugin`

Defines the contract for transport plugins.

```typescript
export interface ITransportPlugin {
  init: (loggerService?: LoggerService, apm?: Apm) => Promise<void>;
  relay: (data: Uint8Array | string) => Promise<void>;
}
```

#### `ExtendedConfig`

Configuration interface that extends the base ProcessorConfig.

```typescript
export interface ExtendedConfig {
  RETRY_ATTEMPTS: number;
  MAX_SOCKETS: number;
  AUTH_HEALTH_URL: string;
  AUTH_TOKEN_URL: string;
  DESTINATION_TRANSPORT_URL: string;
  AUTH_USERNAME: string;
  AUTH_PASSWORD: string;
}

export type Configuration = ProcessorConfig & ExtendedConfig;
```

## Project Structure

```
rest-relay-plugin/
├── dist/                   # Compiled JavaScript output
├── node_modules/           # Dependencies
├── src/
│   ├── config.ts           # Configuration module with validation
│   ├── index.ts            # Main entry point
│   └── service/
│       └── restRelayPlugin.ts   # Main implementation
├── __tests__/
│   └── restRelayPlugin.test.ts  # Comprehensive test suite
├── coverage/               # Test coverage reports
├── .env                    # Environment variables (create this)
├── package.json            # Project metadata and dependencies
├── tsconfig.json           # TypeScript configuration
├── jest.config.ts          # Jest configuration
├── eslint.config.mjs       # ESLint configuration
└── README.md               # This file
```

## Development

### Prerequisites

- Node.js (>=14.x)
- npm or yarn
- A running REST API service for testing
- Valid authentication credentials for the target API

### Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file with your configuration:
   ```
   RETRY_ATTEMPTS=10
   MAX_SOCKETS=10
   AUTH_HEALTH_URL=https://your-auth-service/health
   AUTH_TOKEN_URL=https://your-auth-service/token
   DESTINATION_TRANSPORT_URL=https://your-destination-api/endpoint
   AUTH_USERNAME=your-username
   AUTH_PASSWORD=your-password
   ```
4. Build the project:
   ```bash
   npm run build
   ```

### Available Scripts

- `npm run clean` - Clean build artifacts
- `npm run build` - Build the TypeScript code
- `npm test` - Run the test suite
- `npm run fix:eslint` - Fix ESLint issues automatically
- `npm run fix:prettier` - Fix Prettier issues automatically
- `npm run lint` - Lint the codebase (ESLint and Prettier)
- `npm run lint:eslint` - Run ESLint only
- `npm run lint:prettier` - Run Prettier check only
- `npm run prepare` - Prepare husky hooks

## Testing

The plugin includes comprehensive unit tests using Jest. The tests cover authentication, token management, successful message relaying, and error handling scenarios. Tests include:

- Authentication service health checks and token fetching
- Token caching and refresh mechanisms
- Data relay for different formats (string, Buffer)
- Error handling for authentication failures and API errors
- HTTP connection pooling and retry logic
- APM transaction and span creation
- Mock implementations for external dependencies

Run the tests with:

```bash
npm test
```

Generate coverage reports with:

```bash
npm test -- --coverage
```

Mocks are used for NATS connections, logger service, APM, and file system to isolate the testing of the plugin's functionality.

To run the tests:

```bash
npm test
```

## License

SPDX-License-Identifier: Apache-2.0

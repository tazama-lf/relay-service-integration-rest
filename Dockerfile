# SPDX-License-Identifier: Apache-2.0
# Developed By Paysys Labs

# Use Node.js as the base image
FROM node:20-alpine

ARG GH_TOKEN

# Set the working directory inside the container
WORKDIR /app

# Copy package.json and package-lock.json to the container
COPY package*.json ./
COPY .npmrc .npmrc

# Install dependencies, including the REST relay plugin
RUN npm install && npm install @tazama-lf/rest-relay-plugin

# Copy the rest of the application code to the container
COPY . .

# Build the TypeScript code
RUN npm run build

# Environment variables (May require changes based on requirements)
ENV STARTUP_TYPE=rest
ENV NODE_ENV=dev
ENV SERVER_URL=http://localhost:4222 
ENV FUNCTION_NAME=messageRelayService
ENV OUTPUT_TO_JSON=true
ENV PRODUCER_STREAM=destination.subject
ENV CONSUMER_STREAM=interdiction-service
ENV DESTINATION_TRANSPORT_TYPE=@tazama-lf/rest-relay-plugin

# REST-specific env vars
ENV RETRY_ATTEMPTS=10
ENV MAX_SOCKETS=10
ENV AUTH_HEALTH_URL=https://auth-service/health
ENV AUTH_TOKEN_URL=https://auth-service/token
ENV DESTINATION_TRANSPORT_URL=https://destination-api/endpoint
ENV AUTH_USERNAME=your-username
ENV AUTH_PASSWORD=your-password

ENV APM_ACTIVE=true
ENV APM_SERVICE_NAME=relay-service
ENV APM_URL=http://apm-server.development.svc.cluster.local:8200/
ENV APM_SECRET_TOKEN=

ENV LOGSTASH_LEVEL='info'
ENV SIDECAR_HOST=0.0.0.0:5000

# Expose the port the app runs on
EXPOSE 3000

# Command to start the application
CMD ["npm", "start"]

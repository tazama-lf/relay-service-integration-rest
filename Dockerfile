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

# Install dependencies
RUN npm install

# Copy the rest of the application code to the container
COPY . .

# Build the TypeScript code
RUN npm run build

# Environment variables (May require changes based on requirements)
ENV RETRY_ATTEMPTS=10
ENV MAX_SOCKETS=10
ENV AUTH_HEALTH_URL=https://auth-service/health
ENV AUTH_TOKEN_URL=https://auth-service/token
ENV DESTINATION_TRANSPORT_URL=https://destination-api/endpoint
ENV AUTH_USERNAME=your-username
ENV AUTH_PASSWORD=your-password

# Expose the port the app runs on
EXPOSE 3000

# Command to start the application
CMD ["npm", "start"]

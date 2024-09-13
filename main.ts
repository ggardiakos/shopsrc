import 'dd-trace/init';
import tracer from 'dd-trace';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { shopifyApi, ApiVersion } from '@shopify/shopify-api';
import { RedisSessionStorage } from '@shopify/shopify-app-session-storage-redis';
import fastifyHelmet from '@fastify/helmet';
import fastifyCompress from '@fastify/compress';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { fastifyCircuitBreaker } from 'fastify-circuit-breaker';
import * as winston from 'winston';
import { utilities as nestWinstonModuleUtilities } from 'nest-winston';
import * as dotenv from 'dotenv';
import * as Joi from 'joi';
import Redis from 'ioredis';
import cluster from 'cluster';
import * as os from 'os';
import { AppModule } from './app.module';
import { getConnection } from 'typeorm';
import * as metrics from 'datadog-metrics';
import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { CloudWatchLogsClient, PutLogEventsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { SSMClient, GetParameterCommand } from '@aws-sdk/client-ssm';
import { SQSClient, SendMessageCommand, ReceiveMessageCommand, DeleteMessageCommand } from '@aws-sdk/client-sqs';
import { SNSClient, PublishCommand } from '@aws-sdk/client-sns';
import * as AWSXRay from 'aws-xray-sdk-core';
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import fastifyBasicAuth from '@fastify/basic-auth';
import * as WinstonCloudWatch from 'winston-cloudwatch';
import fastifyCsrf from '@fastify/csrf-protection';
import { createClient as createContentfulClient } from 'contentful';
import { builder } from '@builder.io/react';
import axios from 'axios';
import axiosRetry from 'axios-retry';
import { ShopifyWebhooksService } from '@nestjs-shopify/webhooks';
import fetch from 'node-fetch';
import * as jwt from 'jsonwebtoken';
import { performance } from 'perf_hooks';

// Load environment variables
dotenv.config();

// Define environment schema with Joi
const envSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().required(),
  REDIS_PASSWORD: Joi.string(),
  POSTGRES_HOST: Joi.string().required(),
  POSTGRES_PORT: Joi.number().required(),
  POSTGRES_USER: Joi.string().required(),
  POSTGRES_PASSWORD: Joi.string().required(),
  POSTGRES_DB: Joi.string().required(),
  SHOPIFY_API_KEY: Joi.string().required(),
  SHOPIFY_API_SECRET_KEY: Joi.string().required(),
  SHOPIFY_API_SCOPES: Joi.string().required(),
  SHOPIFY_HOST_NAME: Joi.string().required(),
  SHOPIFY_API_VERSION: Joi.string().valid(...Object.values(ApiVersion)).required(),
  SHOPIFY_IS_EMBEDDED_APP: Joi.boolean().required(),
  SESSION_STORAGE_SECRET: Joi.string().required(),
  AWS_REGION: Joi.string().required(),
  SSM_PARAMETER_PATH: Joi.string().required(),
  SQS_QUEUE_URL: Joi.string().required(),
  SNS_TOPIC_ARN: Joi.string().required(),
  DATADOG_API_KEY: Joi.string().required(),
  JOB_RETRY_LIMIT: Joi.number().default(3),
  SLACK_WEBHOOK_URL: Joi.string(),
  SENTRY_DSN: Joi.string().required(),
  AWS_CLOUDWATCH_GROUP_NAME: Joi.string().required(),
  AWS_CLOUDWATCH_STREAM_NAME: Joi.string().required(),
  AWS_SECRET_NAME: Joi.string().required(),
  ALLOWED_ORIGINS: Joi.string().required(),
  CONTENTFUL_SPACE_ID: Joi.string().required(),
  CONTENTFUL_ACCESS_TOKEN: Joi.string().required(),
  BUILDER_API_KEY: Joi.string().required(),
  CIRCUIT_BREAKER_THRESHOLD: Joi.number().default(5),
  CIRCUIT_BREAKER_TIMEOUT: Joi.number().default(10000),
  CIRCUIT_BREAKER_RESET_TIMEOUT: Joi.number().default(30000),
  JWT_SECRET: Joi.string().required(),
}).unknown(); // Allow additional environment variables

// Validate environment variables
const { error, value: validatedEnv } = envSchema.validate(process.env, { abortEarly: false });

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

// Initialize AWS Clients
const cloudWatchLogsClient = new CloudWatchLogsClient({ region: validatedEnv.AWS_REGION });
const ssmClient = new SSMClient({ region: validatedEnv.AWS_REGION });
const sqsClient = new SQSClient({ region: validatedEnv.AWS_REGION });
const snsClient = new SNSClient({ region: validatedEnv.AWS_REGION });
const secretsManagerClient = new SecretsManagerClient({ region: validatedEnv.AWS_REGION });

// Initialize Redis Client
const redisClient = new Redis({
  host: validatedEnv.REDIS_HOST,
  port: validatedEnv.REDIS_PORT,
  password: validatedEnv.REDIS_PASSWORD,
});

// Initialize Datadog Metrics
metrics.init({ apiKey: validatedEnv.DATADOG_API_KEY, prefix: 'myapp.' });

// Initialize Winston Logger with CloudWatch
const logger = winston.createLogger({
  level: validatedEnv.NODE_ENV === 'production' ? 'info' : 'debug',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
    ...(validatedEnv.NODE_ENV !== 'production' ? [winston.format.prettyPrint()] : []),
  ),
  transports: [
    new winston.transports.Console(),
    new WinstonCloudWatch({
      logGroupName: validatedEnv.AWS_CLOUDWATCH_GROUP_NAME,
      logStreamName: validatedEnv.AWS_CLOUDWATCH_STREAM_NAME,
      awsRegion: validatedEnv.AWS_REGION,
      jsonMessage: true,
      messageFormatter: ({ level, message, additionalInfo }) => JSON.stringify({ level, message, ...additionalInfo }),
    }),
  ],
});

// Initialize Sentry for error tracking and profiling
Sentry.init({
  dsn: validatedEnv.SENTRY_DSN,
  integrations: [new nodeProfilingIntegration()],
  tracesSampleRate: 1.0,
  profilesSampleRate: 1.0,
});

// Initialize Contentful Client
const contentfulClient = createContentfulClient({
  space: validatedEnv.CONTENTFUL_SPACE_ID,
  accessToken: validatedEnv.CONTENTFUL_ACCESS_TOKEN,
});

// Initialize Builder.io
builder.init(validatedEnv.BUILDER_API_KEY);

// Initialize Axios with Retry
axiosRetry(axios, { retries: 3 });

// Shopify API Configuration
const shopifyConfig = {
  apiKey: validatedEnv.SHOPIFY_API_KEY,
  apiSecretKey: validatedEnv.SHOPIFY_API_SECRET_KEY,
  scopes: validatedEnv.SHOPIFY_API_SCOPES.split(','),
  hostName: validatedEnv.SHOPIFY_HOST_NAME,
  apiVersion: ApiVersion[validatedEnv.SHOPIFY_API_VERSION as keyof typeof ApiVersion],
  isEmbeddedApp: validatedEnv.SHOPIFY_IS_EMBEDDED_APP,
  sessionStorage: new RedisSessionStorage(redisClient as any),
};
const shopify = shopifyApi(shopifyConfig);

// Initialize AWS X-Ray
AWSXRay.middleware.setSamplingRules({
  version: 2,
  rules: [
    {
      description: 'Default',
      host: '*',
      http_method: '*',
      url_path: '*',
      fixed_target: 1,
      rate: 0.05,
    },
  ],
  default: {
    fixed_target: 0,
    rate: 0.1,
  },
});
AWSXRay.captureHTTPsGlobal(require('http'));

// Utility Functions

/**
 * Send a message to SQS
 */
async function sendSQSMessage(messageBody: string = 'Your message here') {
  try {
    const response = await sqsClient.send(new SendMessageCommand({
      QueueUrl: validatedEnv.SQS_QUEUE_URL,
      MessageBody: messageBody,
    }));
    metrics.increment('sqs.messages_sent');
    logger.info('Message sent successfully:', response.MessageId);
  } catch (error) {
    logger.error('Error sending SQS message:', error);
    metrics.increment('sqs.send_errors');
  }
}

/**
 * Log messages to CloudWatch
 */
async function logToCloudWatch(logGroupName: string, logStreamName: string, message: string) {
  try {
    const command = new PutLogEventsCommand({
      logGroupName,
      logStreamName,
      logEvents: [{ timestamp: Date.now(), message }],
    });
    await cloudWatchLogsClient.send(command);
    metrics.increment('cloudwatch.logs_sent');
  } catch (error) {
    console.error(`Failed to log to CloudWatch: ${error.message}`);
    metrics.increment('cloudwatch.logs_failed');
  }
}

/**
 * Retrieve feature flags with caching
 */
async function getFeatureFlag(flagName: string, redisClient: Redis): Promise<boolean> {
  const cacheKey = `feature-flag:${flagName}`;
  try {
    const cachedFlag = await redisClient.get(cacheKey);
    if (cachedFlag !== null) {
      return cachedFlag === 'true';
    }

    const command = new GetParameterCommand({ Name: `${validatedEnv.SSM_PARAMETER_PATH}/${flagName}` });
    let attempts = validatedEnv.JOB_RETRY_LIMIT;
    while (attempts--) {
      try {
        const response = await ssmClient.send(command);
        const flagValue = response.Parameter?.Value === 'true';
        await redisClient.set(cacheKey, flagValue ? 'true' : 'false', 'EX', 300);
        return flagValue;
      } catch (error) {
        if (attempts === 0) {
          await logToCloudWatch(validatedEnv.AWS_CLOUDWATCH_GROUP_NAME, 'feature-flags', `Error fetching feature flag after retries: ${error}`);
          metrics.increment('feature_flags.fetch_errors');
          return false;
        }
      }
    }
  } catch (error) {
    logger.error(`Error in getFeatureFlag: ${error.message}`);
    return false;
  }
}

/**
 * Publish alerts to SNS
 */
async function publishSNSAlert(message: string) {
  try {
    const command = new PublishCommand({
      TopicArn: validatedEnv.SNS_TOPIC_ARN,
      Message: message,
    });
    await snsClient.send(command);
    metrics.increment('sns.alerts_sent');
  } catch (error) {
    await logToCloudWatch(validatedEnv.AWS_CLOUDWATCH_GROUP_NAME, 'sns-logs', `Failed to publish SNS alert: ${error}`);
    metrics.increment('sns.publish_errors');
  }
}

/**
 * Retrieve secret values from Secrets Manager
 */
async function getSecretValue(secretName: string): Promise<string | undefined> {
  try {
    const command = new GetSecretValueCommand({ SecretId: secretName });
    const response = await secretsManagerClient.send(command);
    return response.SecretString;
  } catch (error) {
    logger.error(`Error retrieving secret: ${error}`);
    throw error;
  }
}

/**
 * Check database connection
 */
async function checkDatabaseConnection(): Promise<boolean> {
  try {
    const connection = await getConnection();
    return connection.isConnected;
  } catch (error) {
    logger.error('Database connection check failed:', error);
    return false;
  }
}

/**
 * Perform a comprehensive health check
 */
async function performHealthCheck() {
  try {
    const redisPing = await redisClient.ping();
    const shopifyConnected = true; // Implement actual Shopify connection check if necessary
    const dbConnected = await checkDatabaseConnection();
    const contentfulConnected = await contentfulClient.getSpace(validatedEnv.CONTENTFUL_SPACE_ID)
      .then(() => true)
      .catch(() => false);

    const healthStatus = {
      status: 'healthy',
      redis: redisPing === 'PONG',
      shopify: shopifyConnected,
      database: dbConnected,
      contentful: contentfulConnected,
    };

    if (Object.values(healthStatus).every(status => status === true)) {
      metrics.increment('health_check.success');
      return { status: 200, body: healthStatus };
    } else {
      metrics.increment('health_check.failure');
      return { status: 503, body: { ...healthStatus, status: 'unhealthy' } };
    }
  } catch (error) {
    logger.error('Health check failed:', error);
    metrics.increment('health_check.failure');
    return { status: 503, body: { status: 'unhealthy', error: error.message } };
  }
}

/**
 * Verify JWT Token
 */
async function verifyToken(token: string): Promise<any> {
  return new Promise((resolve, reject) => {
    jwt.verify(token, validatedEnv.JWT_SECRET, (err, decoded) => {
      if (err) {
        reject(err);
      } else {
        resolve(decoded);
      }
    });
  });
}

// Custom Error Classes
class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

// Bootstrap the NestJS application
async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: false }, // Disable Nest's default logger
  );

  // Set up custom Winston logger
  app.useLogger(logger);

  // Register CORS with allowed origins
  await app.register(cors, {
    origin: (origin, cb) => {
      const allowedOrigins = validatedEnv.ALLOWED_ORIGINS.split(',');
      if (!origin || allowedOrigins.includes(origin)) {
        cb(null, true);
      } else {
        cb(new Error('Not allowed by CORS'), false);
      }
    },
  });

  // Register compression and security middlewares
  await app.register(fastifyCompress);
  await app.register(fastifyHelmet);

  // Register rate limiting
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    redis: redisClient,
  });

  // Register CSRF protection
  await app.register(fastifyCsrf, {
    cookieKey: 'XSRF-TOKEN',
    sessionPlugin: '@fastify/secure-session',
  });

  // Apply global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  // Apply global exception filters
  app.useGlobalFilters(new HttpExceptionFilter(logger));
  app.useGlobalFilters(new AllExceptionsFilter(logger));

  // Swagger setup for non-production environments
  if (validatedEnv.NODE_ENV !== 'production') {
    const swaggerUser = validatedEnv.SWAGGER_USER || 'admin';
    const swaggerPassword = validatedEnv.SWAGGER_PASSWORD || 'password';

    await app.register(fastifyBasicAuth, {
      validate: async (username, password, req, reply) => {
        if (username === swaggerUser && password === swaggerPassword) {
          return;
        }
        reply.code(401).send({ error: 'Invalid credentials' });
      },
      authenticate: { realm: 'Swagger Documentation' },
    });

    const config = new DocumentBuilder()
      .setTitle(validatedEnv.SWAGGER_TITLE || 'API Documentation')
      .setDescription(validatedEnv.SWAGGER_DESCRIPTION || 'API description')
      .setVersion(validatedEnv.SWAGGER_VERSION || '1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });

    // Protect Swagger endpoint with authentication
    app.use('/api/docs', async (req, res, next) => {
      if (req.headers.authorization) {
        next();
      } else {
        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', 'Basic realm="Swagger Documentation"');
        res.end('Unauthorized');
      }
    });
  }

  // Logging middleware for requests and responses
  app.use(async (req, res, next) => {
    req['startTime'] = Date.now();
    logger.info(`Request received: ${req.method} ${req.url}`);

    res.on('finish', () => {
      const responseTime = Date.now() - req['startTime'];
      const logLevel = res.statusCode >= 400 ? 'error' : 'info';
      logger.log({
        level: logLevel,
        message: `Response status: ${res.statusCode} for ${req.method} ${req.url}. Time: ${responseTime}ms`,
      });
      metrics.increment('http.requests', 1, [`method:${req.method}`, `status:${res.statusCode}`]);
      metrics.histogram('http.response_time', responseTime, [`method:${req.method}`, `status:${res.statusCode}`]);
    });

    next();
  });

  // Error handling middleware
  app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    Sentry.captureException(err);
    res.status(500).send('Internal Server Error');
  });

  // Access Fastify instance
  const fastifyInstance = app.getHttpAdapter().getInstance();

  // Health check endpoint
  fastifyInstance.get('/health', async (request, reply) => {
    const healthCheck = await performHealthCheck();
    return reply.status(healthCheck.status).send(healthCheck.body);
  });

  // Example endpoint demonstrating feature flags
  fastifyInstance.get('/example', async (request, reply) => {
    const showNewFeature = await getFeatureFlag('new-feature-flag', redisClient);
    await logToCloudWatch(validatedEnv.AWS_CLOUDWATCH_GROUP_NAME, 'api-logs', `Request to /example. New feature flag: ${showNewFeature}`);
    metrics.increment('api.requests', 1, ['endpoint:example']);

    if (showNewFeature) {
      reply.send('New feature');
    } else {
      reply.send('Old feature');
    }
  });

  // Register circuit breaker for external services
  await app.register(fastifyCircuitBreaker, {
    threshold: validatedEnv.CIRCUIT_BREAKER_THRESHOLD,
    timeout: validatedEnv.CIRCUIT_BREAKER_TIMEOUT,
    resetTimeout: validatedEnv.CIRCUIT_BREAKER_RESET_TIMEOUT,
  });

  // Monitor memory usage and event loop delay
  let lastTime = performance.now();
  let lag = 0;

  setInterval(() => {
    const currentTime = performance.now();
    const delta = currentTime - lastTime;
    lag = delta - 1000; // Assuming interval is 1000ms
    lastTime = currentTime;

    const used = process.memoryUsage();
    metrics.gauge('memory.rss', used.rss);
    metrics.gauge('memory.heapTotal', used.heapTotal);
    metrics.gauge('memory.heapUsed', used.heapUsed);
    metrics.gauge('memory.external', used.external);
    metrics.gauge('eventloop.lag', lag);
  }, 1000);

  // Define application port
  const port = validatedEnv.PORT;

  // Start the NestJS application
  await app.listen(port, '0.0.0.0');
  logger.info(`Application is running on: ${await app.getUrl()}`);

  // Graceful shutdown handler
  const gracefulShutdown = async () => {
    logger.info('Initiating graceful shutdown...');
    try {
      // Close AWS X-Ray segments
      AWSXRay.getSegment()?.close();

      // Close NestJS application
      await app.close();
      logger.info('NestJS application closed.');

      // Close Redis connection
      await redisClient.quit();
      logger.info('Redis connection closed.');

      // Close database connection
      try {
        const connection = await getConnection();
        if (connection.isConnected) {
          await connection.close();
          logger.info('Database connection closed.');
        }
      } catch (dbError) {
        logger.error('Error closing database connection:', dbError);
      }

      // Log shutdown event to CloudWatch
      await logToCloudWatch(
        validatedEnv.AWS_CLOUDWATCH_GROUP_NAME,
        validatedEnv.AWS_CLOUDWATCH_STREAM_NAME,
        'Application gracefully shut down'
      );

      // Send a shutdown event metric to Datadog
      metrics.increment('app.shutdown');

      logger.info('Graceful shutdown completed.');
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
      // Attempt to log the error to CloudWatch even if shutdown fails
      try {
        await logToCloudWatch(
          validatedEnv.AWS_CLOUDWATCH_GROUP_NAME,
          validatedEnv.AWS_CLOUDWATCH_STREAM_NAME,
          `Shutdown error: ${error.message}`
        );
      } catch (logError) {
        console.error('Failed to log shutdown error to CloudWatch:', logError);
      }
      process.exit(1);
    }
  };

  // Handle termination signals
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  // Error handling for uncaught exceptions and unhandled rejections
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    metrics.increment('errors.uncaught_exception');
    Sentry.captureException(error);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    metrics.increment('errors.unhandled_rejection');
    Sentry.captureException(reason);
  });

  // AWS X-Ray hooks for Fastify
  fastifyInstance.addHook('onRequest', (request, reply, done) => {
    const segment = AWSXRay.getSegment();
    if (segment) {
      const subSegment = segment.addNewSubsegment('Fastify');
      (request.raw as any).segment = subSegment;
    }
    done();
  });

  fastifyInstance.addHook('onResponse', (request, reply, done) => {
    const subSegment = (request.raw as any).segment;
    if (subSegment) {
      subSegment.close();
    }
    done();
  });

  // Send a sample SQS message
  await sendSQSMessage();

  // Webhook endpoint
  fastifyInstance.post('/webhook', async (request, reply) => {
    try {
      // Implement webhook handling logic
      logger.info('Received webhook');
      // Process webhook data
      reply.send({ status: 'success' });
    } catch (error) {
      logger.error('Webhook processing error:', error);
      reply.code(500).send({ error: 'Webhook processing failed' });
    }
  });

  // Metrics endpoint
  fastifyInstance.get('/metrics', async (request, reply) => {
    try {
      // Implement custom metrics retrieval logic
      reply.send({ status: 'ok' });
    } catch (error) {
      logger.error('Metrics endpoint error:', error);
      reply.code(500).send({ error: 'Failed to get metrics' });
    }
  });

  // Custom authentication middleware
  const authenticate = async (request: any, reply: any) => {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      reply.code(401).send({ error: 'No authorization header' });
      return;
    }

    try {
      const token = authHeader.split(' ')[1];
      const decodedToken = await verifyToken(token);
      request.user = decodedToken;
    } catch (error) {
      reply.code(401).send({ error: 'Invalid token' });
    }
  };

  // Protected route example
  fastifyInstance.get('/protected', { preHandler: authenticate }, async (request, reply) => {
    reply.send({ message: 'This is a protected route', user: request.user });
  });

  // Database operations

  /**
   * Create a new user
   */
  const createUser = async (userData: any) => {
    try {
      const connection = await getConnection();
      const userRepository = connection.getRepository('User'); // Ensure 'User' entity exists
      const newUser = userRepository.create(userData);
      await userRepository.save(newUser);
      logger.info(`Created new user: ${newUser.id}`);
      return newUser;
    } catch (error) {
      logger.error('Error creating user:', error);
      throw error;
    }
  };

  /**
   * Retrieve a user by ID
   */
  const getUserById = async (userId: string) => {
    try {
      const connection = await getConnection();
      const userRepository = connection.getRepository('User'); // Ensure 'User' entity exists
      const user = await userRepository.findOne(userId);
      if (!user) {
        logger.warn(`User not found: ${userId}`);
        return null;
      }
      return user;
    } catch (error) {
      logger.error('Error fetching user:', error);
      throw error;
    }
  };

  // User registration route
  fastifyInstance.post('/register', async (request, reply) => {
    try {
      const userData = request.body;
      const newUser = await createUser(userData);
      reply.code(201).send(newUser);
    } catch (error) {
      reply.code(500).send({ error: 'Failed to create user' });
    }
  });

  // User retrieval route
  fastifyInstance.get('/user/:id', async (request, reply) => {
    try {
      const userId = request.params.id;
      const user = await getUserById(userId);
      if (user) {
        reply.send(user);
      } else {
        reply.code(404).send({ error: 'User not found' });
      }
    } catch (error) {
      reply.code(500).send({ error: 'Failed to fetch user' });
    }
  });

  // Caching middleware
  const cacheMiddleware = (ttl = 60) => {
    return async (request: any, reply: any) => {
      const cacheKey = `cache:${request.url}`;
      const cachedResponse = await redisClient.get(cacheKey);

      if (cachedResponse) {
        reply.send(JSON.parse(cachedResponse));
        return;
      }

      // Intercept the reply.send method
      const originalSend = reply.send.bind(reply);
      reply.send = async (payload: any) => {
        await redisClient.set(cacheKey, JSON.stringify(payload), 'EX', ttl);
        originalSend(payload);
      };
    };
  };

  // Cached route example
  fastifyInstance.get('/cached-data', { preHandler: cacheMiddleware(300) }, async (request, reply) => {
    // Simulate expensive operation
    await new Promise(resolve => setTimeout(resolve, 2000));
    reply.send({ data: 'This response is cached for 5 minutes' });
  });

  // Background job processing
  const processJob = async (jobData: any) => {
    try {
      logger.info('Processing job:', jobData);
      // Implement your job processing logic here
      await new Promise(resolve => setTimeout(resolve, 5000)); // Simulate long-running job
      logger.info('Job completed:', jobData);
    } catch (error) {
      logger.error('Error processing job:', error);
    }
  };

  // Job queue consumer
  const startJobConsumer = async () => {
    while (true) {
      try {
        const message = await sqsClient.send(new ReceiveMessageCommand({
          QueueUrl: validatedEnv.SQS_QUEUE_URL,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: 20,
        }));

        if (message.Messages && message.Messages.length > 0) {
          const jobData = JSON.parse(message.Messages[0].Body);
          await processJob(jobData);

          await sqsClient.send(new DeleteMessageCommand({
            QueueUrl: validatedEnv.SQS_QUEUE_URL,
            ReceiptHandle: message.Messages[0].ReceiptHandle!,
          }));
        }
      } catch (error) {
        logger.error('Error processing job:', error);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait before retrying
      }
    }
  };

  // Start job consumer in separate workers
// Bootstrap the NestJS application
async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
    { logger: false }, // Disable Nest's default logger
  );

  // Set up custom Winston logger
  app.useLogger(logger);

  // Register CORS with allowed origins
  await app.register(cors, {
    origin: (origin, cb) => {
      const allowedOrigins = validatedEnv.ALLOWED_ORIGINS.split(',');
      if (!origin || allowedOrigins.includes(origin)) {
        cb(null, true);
      } else {
        cb(new Error('Not allowed by CORS'), false);
      }
    },
  });

  // Register compression and security middlewares
  await app.register(fastifyCompress);
  await app.register(fastifyHelmet);

  // Register rate limiting
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    redis: redisClient,
  });

  // Register CSRF protection
  await app.register(fastifyCsrf, {
    cookieKey: 'XSRF-TOKEN',
    sessionPlugin: '@fastify/secure-session',
  });

  // Apply global validation pipe
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  }));

  // Apply global exception filters
  app.useGlobalFilters(new HttpExceptionFilter(logger));
  app.useGlobalFilters(new AllExceptionsFilter(logger));

  // Swagger setup for non-production environments
  if (validatedEnv.NODE_ENV !== 'production') {
    const swaggerUser = validatedEnv.SWAGGER_USER || 'admin';
    const swaggerPassword = validatedEnv.SWAGGER_PASSWORD || 'password';

    await app.register(fastifyBasicAuth, {
      validate: async (username, password, req, reply) => {
        if (username === swaggerUser && password === swaggerPassword) {
          return;
        }
        reply.code(401).send({ error: 'Invalid credentials' });
      },
      authenticate: { realm: 'Swagger Documentation' },
    });

    const config = new DocumentBuilder()
      .setTitle(validatedEnv.SWAGGER_TITLE || 'API Documentation')
      .setDescription(validatedEnv.SWAGGER_DESCRIPTION || 'API description')
      .setVersion(validatedEnv.SWAGGER_VERSION || '1.0')
      .addBearerAuth()
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });

    // Protect Swagger endpoint with authentication
    app.use('/api/docs', async (req, res, next) => {
      if (req.headers.authorization) {
        next();
      } else {
        res.statusCode = 401;
        res.setHeader('WWW-Authenticate', 'Basic realm="Swagger Documentation"');
        res.end('Unauthorized');
      }
    });
  }

  // Logging middleware for requests and responses
  app.use(async (req, res, next) => {
    req['startTime'] = Date.now();
    logger.info(`Request received: ${req.method} ${req.url}`);

    res.on('finish', () => {
      const responseTime = Date.now() - req['startTime'];
      const logLevel = res.statusCode >= 400 ? 'error' : 'info';
      logger.log({
        level: logLevel,
        message: `Response status: ${res.statusCode} for ${req.method} ${req.url}. Time: ${responseTime}ms`,
      });
      metrics.increment('http.requests', 1, [`method:${req.method}`, `status:${res.statusCode}`]);
      metrics.histogram('http.response_time', responseTime, [`method:${req.method}`, `status:${res.statusCode}`]);
    });

    next();
  });

  // Error handling middleware
  app.use((err, req, res, next) => {
    logger.error('Unhandled error:', err);
    Sentry.captureException(err);
    res.status(500).send('Internal Server Error');
  });

  // Access Fastify instance
  const fastifyInstance = app.getHttpAdapter().getInstance();

  // Health check endpoint
  fastifyInstance.get('/health', async (request, reply) => {
    const healthCheck = await performHealthCheck();
    return reply.status(healthCheck.status).send(healthCheck.body);
  });

  // Example endpoint demonstrating feature flags
  fastifyInstance.get('/example', async (request, reply) => {
    const showNewFeature = await getFeatureFlag('new-feature-flag', redisClient);
    await logToCloudWatch(validatedEnv.AWS_CLOUDWATCH_GROUP_NAME, 'api-logs', `Request to /example. New feature flag: ${showNewFeature}`);
    metrics.increment('api.requests', 1, ['endpoint:example']);

    if (showNewFeature) {
      reply.send('New feature');
    } else {
      reply.send('Old feature');
    }
  });

  // Register circuit breaker for external services
  await app.register(fastifyCircuitBreaker, {
    threshold: validatedEnv.CIRCUIT_BREAKER_THRESHOLD,
    timeout: validatedEnv.CIRCUIT_BREAKER_TIMEOUT,
    resetTimeout: validatedEnv.CIRCUIT_BREAKER_RESET_TIMEOUT,
  });

  // Monitor memory usage and event loop delay
  let lastTime = performance.now();
  let lag = 0;

  setInterval(() => {
    const currentTime = performance.now();
    const delta = currentTime - lastTime;
    lag = delta - 1000; // Assuming interval is 1000ms
    lastTime = currentTime;

    const used = process.memoryUsage();
    metrics.gauge('memory.rss', used.rss);
    metrics.gauge('memory.heapTotal', used.heapTotal);
    metrics.gauge('memory.heapUsed', used.heapUsed);
    metrics.gauge('memory.external', used.external);
    metrics.gauge('eventloop.lag', lag);
  }, 1000);

  // Define application port
  const port = validatedEnv.PORT;

  // Start the NestJS application
  await app.listen(port, '0.0.0.0');
  logger.info(`Application is running on: ${await app.getUrl()}`);

  // Graceful shutdown handler
  const gracefulShutdown = async () => {
    logger.info('Initiating graceful shutdown...');
    try {
      // Close AWS X-Ray segments
      AWSXRay.getSegment()?.close();

      // Close NestJS application
      await app.close();
      logger.info('NestJS application closed.');

      // Close Redis connection
      await redisClient.quit();
      logger.info('Redis connection closed.');

      // Close database connection
      try {
        const connection = await getConnection();
        if (connection.isConnected) {
          await connection.close();
          logger.info('Database connection closed.');
        }
      } catch (dbError) {
        logger.error('Error closing database connection:', dbError);
      }

      // Log shutdown event to CloudWatch
      await logToCloudWatch(
        validatedEnv.AWS_CLOUDWATCH_GROUP_NAME,
        validatedEnv.AWS_CLOUDWATCH_STREAM_NAME,
        'Application gracefully shut down'
      );

      // Send a shutdown event metric to Datadog
      metrics.increment('app.shutdown');

      logger.info('Graceful shutdown completed.');
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
      // Attempt to log the error to CloudWatch even if shutdown fails
      try {
        await logToCloudWatch(
          validatedEnv.AWS_CLOUDWATCH_GROUP_NAME,
          validatedEnv.AWS_CLOUDWATCH_STREAM_NAME,
          `Shutdown error: ${error.message}`
        );
      } catch (logError) {
        console.error('Failed to log shutdown error to CloudWatch:', logError);
      }
      process.exit(1);
    }
  };

  // Handle termination signals
  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  // Error handling for uncaught exceptions and unhandled rejections
  process.on('uncaughtException', (error) => {
    logger.error('Uncaught Exception:', error);
    metrics.increment('errors.uncaught_exception');
    Sentry.captureException(error);
  });

  process.on('unhandledRejection', (reason, promise) => {
    logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
    metrics.increment('errors.unhandled_rejection');
    Sentry.captureException(reason);
  });

  // AWS X-Ray hooks for Fastify
  fastifyInstance.addHook('onRequest', (request, reply, done) => {
    const segment = AWSXRay.getSegment();
    if (segment) {
      const subSegment = segment.addNewSubsegment('Fastify');
      (request.raw as any).segment = subSegment;
    }
    done();
  });

  fastifyInstance.addHook('onResponse', (request, reply, done) => {
    const subSegment = (request.raw as any).segment;
    if (subSegment) {
      subSegment.close();
    }
    done();
  });

  // Send a sample SQS message
  await sendSQSMessage();

  // Webhook endpoint
  fastifyInstance.post('/webhook', async (request, reply) => {
    try {
      // Implement webhook handling logic
      logger.info('Received webhook');
      // Process webhook data
      reply.send({ status: 'success' });
    } catch (error) {
      logger.error('Webhook processing error:', error);
      reply.code(500).send({ error: 'Webhook processing failed' });
    }
  });

  // Metrics endpoint
  fastifyInstance.get('/metrics', async (request, reply) => {
    try {
      // Implement custom metrics retrieval logic
      reply.send({ status: 'ok' });
    } catch (error) {
      logger.error('Metrics endpoint error:', error);
      reply.code(500).send({ error: 'Failed to get metrics' });
    }
  });

  // Custom authentication middleware
  const authenticate = async (request: any, reply: any) => {
    const authHeader = request.headers.authorization;
    if (!authHeader) {
      reply.code(401).send({ error: 'No authorization header' });
      return;
    }

    try {
      const token = authHeader.split(' ')[1];
      const decodedToken = await verifyToken(token);
      request.user = decodedToken;
    } catch (error) {
      reply.code(401).send({ error: 'Invalid token' });
    }
  };

  // Protected route example
  fastifyInstance.get('/protected', { preHandler: authenticate }, async (request, reply) => {
    reply.send({ message: 'This is a protected route', user: request.user });
  });

  // Database operations

  /**
   * Create a new user
   */
  const createUser = async (userData: any) => {
    try {
      const connection = await getConnection();
      const userRepository = connection.getRepository('User'); // Ensure 'User' entity exists
      const newUser = userRepository.create(userData);
      await userRepository.save(newUser);
      logger.info(`Created new user: ${newUser.id}`);
      return newUser;
    } catch (error) {
      logger.error('Error creating user:', error);
      throw error;
    }
  };

  /**
   * Retrieve a user by ID
   */
  const getUserById = async (userId: string) => {
    try {
      const connection = await getConnection();
      const userRepository = connection.getRepository('User'); // Ensure 'User' entity exists
      const user = await userRepository.findOne(userId);
      if (!user) {
        logger.warn(`User not found: ${userId}`);
        return null;
      }
      return user;
    } catch (error) {
      logger.error('Error fetching user:', error);
      throw error;
    }
  };

  // User registration route
  fastifyInstance.post('/register', async (request, reply) => {
    try {
      const userData = request.body;
      const newUser = await createUser(userData);
      reply.code(201).send(newUser);
    } catch (error) {
      reply.code(500).send({ error: 'Failed to create user' });
    }
  });

  // User retrieval route
  fastifyInstance.get('/user/:id', async (request, reply) => {
    try {
      const userId = request.params.id;
      const user = await getUserById(userId);
      if (user) {
        reply.send(user);
      } else {
        reply.code(404).send({ error: 'User not found' });
      }
    } catch (error) {
      reply.code(500).send({ error: 'Failed to fetch user' });
    }
  });

  // Caching middleware
  const cacheMiddleware = (ttl = 60) => {
    return async (request: any, reply: any) => {
      const cacheKey = `cache:${request.url}`;
      const cachedResponse = await redisClient.get(cacheKey);

      if (cachedResponse) {
        reply.send(JSON.parse(cachedResponse));
        return;
      }

      // Intercept the reply.send method
      const originalSend = reply.send.bind(reply);
      reply.send = async (payload: any) => {
        await redisClient.set(cacheKey, JSON.stringify(payload), 'EX', ttl);
        originalSend(payload);
      };
    };
  };

  // Cached route example
  fastifyInstance.get('/cached-data', { preHandler: cacheMiddleware(300) }, async (request, reply) => {
    // Simulate expensive operation
    await new Promise(resolve => setTimeout(resolve, 2000));
    reply.send({ data: 'This response is cached for 5 minutes' });
  });

  // Background job processing
  const processJob = async (jobData: any) => {
    try {
      logger.info('Processing job:', jobData);
      // Implement your job processing logic here
      await new Promise(resolve => setTimeout(resolve, 5000)); // Simulate long-running job
      logger.info('Job completed:', jobData);
    } catch (error) {
      logger.error('Error processing job:', error);
    }
  };

  // Job queue consumer
  const startJobConsumer = async () => {
    while (true) {
      try {
        const message = await sqsClient.send(new ReceiveMessageCommand({
          QueueUrl: validatedEnv.SQS_QUEUE_URL,
          MaxNumberOfMessages: 1,
          WaitTimeSeconds: 20,
        }));

        if (message.Messages && message.Messages.length > 0) {
          const jobData = JSON.parse(message.Messages[0].Body);
          await processJob(jobData);

          await sqsClient.send(new DeleteMessageCommand({
            QueueUrl: validatedEnv.SQS_QUEUE_URL,
            ReceiptHandle: message.Messages[0].ReceiptHandle!,
          }));
        }
      } catch (error) {
        logger.error('Error processing job:', error);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait before retrying
      }
    }
  };

  // Start job consumer in separate workers
  if (cluster.isPrimary) {
    const numWorkers = os.cpus().length;
    for (let i = 0; i < numWorkers; i++) {
      cluster.fork({ WORKER_TYPE: 'job_consumer' });
    }

    cluster.on('exit', (worker, code, signal) => {
      logger.warn(`Worker ${worker.process.pid} died. Restarting...`);
      cluster.fork({ WORKER_TYPE: 'job_consumer' });
    });
  } else if (process.env.WORKER_TYPE === 'job_consumer') {
    startJobConsumer().catch(error => {
      logger.error('Job consumer error:', error);
      process.exit(1);
    });
  }

  // Periodic tasks
  const runPeriodicTasks = async () => {
    setInterval(async () => {
      try {
        await performDatabaseCleanup();
        await updateCacheEntries();
        await generateReports();
      } catch (error) {
        logger.error('Error in periodic tasks:', error);
      }
    }, 3600000); // Run every hour
  };

  const performDatabaseCleanup = async () => {
    logger.info('Performing database cleanup');
    // Implement your database cleanup logic here
  };

  const updateCacheEntries = async () => {
    try {
      const frequentlyAccessedRoutes = ['/popular-route-1', '/popular-route-2'];
      for (const route of frequentlyAccessedRoutes) {
        const response = await axios.get(`http://localhost:${port}${route}`);
        if (response.status === 200) {
          logger.info(`Cache warmed for route: ${route}`);
        } else {
          logger.warn(`Failed to warm cache for route: ${route}, status: ${response.status}`);
        }
      }
    } catch (error) {
      logger.error('Error in cache warming process:', error);
    }
  };

  const generateReports = async () => {
    try {
      logger.info('Generating reports...');
      // Simulate report generation
      await new Promise(resolve => setTimeout(resolve, 5000));
      logger.info('Reports generated successfully.');
    } catch (error) {
      logger.error('Error generating reports:', error);
    }
  };

  // Start periodic tasks
  runPeriodicTasks().catch(error => {
    logger.error('Error starting periodic tasks:', error);
  });

  // WebSocket support
  fastifyInstance.register(require('@fastify/websocket'));
  fastifyInstance.get('/ws', { websocket: true }, (connection, req) => {
    connection.socket.on('message', message => {
      // Handle WebSocket messages
      logger.info('Received WebSocket message:', message);
      connection.socket.send('Message received');
    });
  });

  // File upload handling
  fastifyInstance.register(require('@fastify/multipart'));
  fastifyInstance.post('/upload', async (request, reply) => {
    try {
      const data = await request.file();
      // Process the uploaded file
      logger.info('File uploaded:', data.filename);
      reply.send({ status: 'File uploaded successfully' });
    } catch (error) {
      logger.error('File upload error:', error);
      reply.code(500).send({ error: 'File upload failed' });
    }
  });

  // Custom error handler
  app.setErrorHandler((error: any, request: any, reply: any) => {
    if (error instanceof ValidationError) {
      reply.status(400).send({ error: error.message });
    } else if (error instanceof NotFoundError) {
      reply.status(404).send({ error: error.message });
    } else {
      logger.error('Unhandled error:', error);
      Sentry.captureException(error);
      reply.status(500).send({ error: 'Internal Server Error' });
    }
  });

  // Middleware to track API usage
  app.use(async (req, res, next) => {
    const apiKey = req.headers['x-api-key'];
    if (apiKey) {
      await redisClient.incr(`api-usage:${apiKey}`);
    }
    next();
  });

  // Route to get API usage statistics
  fastifyInstance.get('/api-usage', async (request, reply) => {
    const apiKey = request.headers['x-api-key'];
    if (!apiKey) {
      reply.code(400).send({ error: 'API key is required' });
      return;
    }
    const usage = await redisClient.get(`api-usage:${apiKey}`);
    reply.send({ apiKey, usage: usage || 0 });
  });

  // Implement rate limiting based on API key
  const apiRateLimit = async (req: any, res: any, next: any) => {
    const apiKey = req.headers['x-api-key'];
    if (!apiKey) {
      res.code(400).send({ error: 'API key is required' });
      return;
    }
    try {
      const rate = await redisClient.get(`rate-limit:${apiKey}`);
      if (rate && parseInt(rate) >= 100) {
        res.code(429).send({ error: 'Rate limit exceeded' });
        return;
      }
      await redisClient.incr(`rate-limit:${apiKey}`);
      await redisClient.expire(`rate-limit:${apiKey}`, 3600); // Reset after 1 hour
      next();
    } catch (error) {
      logger.error('API rate limiting error:', error);
      res.code(500).send({ error: 'Internal Server Error' });
    }
  };

  // Apply API key rate limiting to all routes
  app.use(apiRateLimit);

  // Implement a simple cache warmer
  const cacheWarmer = async () => {
    const routesToWarm = ['/frequently-accessed-route', '/another-popular-route'];
    for (const route of routesToWarm) {
      try {
        const response = await fetch(`http://localhost:${port}${route}`);
        if (response.ok) {
          await response.json();
          logger.info(`Warmed cache for route: ${route}`);
        } else {
          logger.warn(`Failed to warm cache for route: ${route}, status: ${response.status}`);
        }
      } catch (error) {
        logger.error(`Failed to warm cache for route: ${route}`, error);
      }
    }
  };

  // Run cache warmer periodically
  setInterval(cacheWarmer, 900000); // Every 15 minutes

  // Shopify webhook handling
  const shopifyWebhooksService = app.get(ShopifyWebhooksService);
  app.use('/webhooks', shopifyWebhooksService.getWebhookHandler());
}

// Start the application
bootstrap().catch((error) => {
  logger.error('Error during application bootstrap:', error);
  Sentry.captureException(error);
  process.exit(1);
});

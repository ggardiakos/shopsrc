import { Processor, Process, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import { Injectable } from '@nestjs/common';
import { Job } from 'bull';
import { InjectQueue } from '@nestjs/bull';
import { Queue } from 'bull';
import { TemporaryErrorException, PermanentErrorException } from './exceptions';
import * as winston from 'winston';
import * as winstonGraylog2 from 'winston-graylog2';

// Create custom Winston logger with Graylog integration
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.splat(),
    winston.format.json()
  ),
  defaultMeta: { service: 'queue-processor' },
  transports: [
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    new winstonGraylog2({
      server: process.env.GRAYLOG_HOST,
      port: parseInt(process.env.GRAYLOG_PORT, 10),
      hostname: 'queue-processor',
      facility: 'queue-processor',
      bufferSize: 1400,
      additionalFields: {
        env: process.env.NODE_ENV || 'development',
      },
    }),
  ],
});

@Injectable()
@Processor('my-queue')
export class QueueProcessor {
  constructor(
    @InjectQueue('my-queue') private readonly queue: Queue
  ) {}

  // Process string jobs
  @Process('processString')
  async processStringJob(job: Job): Promise<string> {
    try {
      logger.info(`Processing string job ${job.id}`, { jobId: job.id, data: job.data });
      await job.progress(50);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await job.progress(100);
      const result = `Processed string: ${job.data}`;
      logger.info(`Completed string job ${job.id}`, { jobId: job.id, result });
      return result;
    } catch (error) {
      this.handleError(job, error);
      throw error; // Ensure error is re-thrown for proper retry handling
    }
  }

  // Process number jobs
  @Process('processNumber')
  async processNumberJob(job: Job): Promise<number> {
    try {
      logger.info(`Processing number job ${job.id}`, { jobId: job.id, data: job.data });
      await job.progress(50);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      await job.progress(100);
      const result = job.data * 2; // Example processing
      logger.info(`Completed number job ${job.id}`, { jobId: job.id, result });
      return result;
    } catch (error) {
      this.handleError(job, error);
      throw error; // Ensure error is re-thrown for proper retry handling
    }
  }

  // Handle job completion
  @OnQueueCompleted()
  onCompleted(job: Job, result: any) {
    logger.info(`Job ${job.id} completed`, { jobId: job.id, result: JSON.stringify(result) });
  }

  // Handle job failure
  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    logger.error(`Job ${job.id} failed`, { jobId: job.id, error: error.message, stack: error.stack });
  }

  // Error handling logic
  private handleError(job: Job, error: any) {
    logger.error(`Error processing job ${job.id}`, { jobId: job.id, error: error.message, stack: error.stack });
    if (error instanceof TemporaryErrorException) {
      throw error; // Retry the job
    } else if (error instanceof PermanentErrorException) {
      this.triggerAlert(job.id, error.message); // Trigger alert for permanent failure
    } else {
      throw error; // Retry unknown errors
    }
  }

  // Trigger alert for permanent errors
  private triggerAlert(jobId: string, errorMessage: string): void {
    logger.warn(`Alert triggered for job ${jobId}`, { jobId, error: errorMessage });
    // Add your alerting mechanism here (e.g., send email, push notification)
  }
}

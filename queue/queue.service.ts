import { Injectable, Logger, OnModuleInit, OnApplicationShutdown } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import { Queue, Job, JobOptions } from 'bull';

export interface TaskData {
  type: string;
  payload: any;
}

@Injectable()
export class BullQueueService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(BullQueueService.name);

  constructor(
    @InjectQueue(process.env.BULL_QUEUE_NAME || 'default')
    private readonly taskQueue: Queue,
  ) {}

  onModuleInit() {
    // Setup event listeners for job lifecycle
    this.taskQueue.on('completed', (job: Job) => {
      this.logger.log(`Job ${job.id} completed successfully`);
    });

    this.taskQueue.on('failed', (job: Job, err: Error) => {
      this.logger.error(`Job ${job.id} failed: ${err.message}`, err.stack);
    });
  }

  async onApplicationShutdown(signal?: string) {
    this.logger.log(`Closing Bull queue (signal: ${signal})`);
    await this.taskQueue.close();  // Graceful shutdown for Bull queue
  }

  // Add a new task to the queue with default retry logic
  async addTask(data: TaskData, jobOptions: JobOptions = {}): Promise<string> {
    try {
      const defaultOptions: JobOptions = {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      };
      const mergedOptions = { ...defaultOptions, ...jobOptions };
      const job = await this.taskQueue.add('processTask', data, mergedOptions);
      this.logger.log(`Task added to queue successfully with job ID ${job.id}`);
      return job.id;
    } catch (error) {
      this.logger.error(`Error adding task to queue: ${error.message}`, error.stack);
      throw error;
    }
  }

  // Get metrics on the queue status
  async getQueueStatus(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
  }> {
    const [waiting, active, completed, failed] = await Promise.all([
      this.taskQueue.getWaitingCount(),
      this.taskQueue.getActiveCount(),
      this.taskQueue.getCompletedCount(),
      this.taskQueue.getFailedCount(),
    ]);
    return { waiting, active, completed, failed };
  }

  // Get details of a specific job by ID
  async getJobStatus(jobId: string): Promise<{
    id: string;
    name: string;
    data: any;
    opts: JobOptions;
    progress: number;
    delay: number;
    timestamp: number;
    attemptsMade: number;
    failedReason: string;
    stacktrace: string[];
    returnvalue: any;
  }> {
    const job = await this.taskQueue.getJob(jobId);
    if (!job) {
      throw new Error(`Job not found with ID ${jobId}`);
    }
    return {
      id: job.id,
      name: job.name,
      data: job.data,
      opts: job.opts,
      progress: await job.progress(),
      delay: job.delay,
      timestamp: job.timestamp,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
      stacktrace: job.stacktrace,
      returnvalue: job.returnvalue,
    };
  }

  // Remove a job from the queue
  async removeJob(jobId: string): Promise<void> {
    const job = await this.taskQueue.getJob(jobId);  // Fetch the job directly
    if (job) {
      await job.remove();
      this.logger.log(`Job ${jobId} removed successfully`);
    } else {
      this.logger.warn(`Job ${jobId} not found for removal`);
    }
  }

  // Retry a failed job
  async retryJob(jobId: string): Promise<void> {
    try {
      const job = await this.taskQueue.getJob(jobId);
      if (job) {
        await job.retry();
        this.logger.log(`Job ${jobId} retried successfully`);
      } else {
        this.logger.warn(`Job ${jobId} not found for retry`);
      }
    } catch (error) {
      this.logger.error(`Error retrying job ${jobId}: ${error.message}`);
      throw error;
    }
  }

  // Update job data
  async updateJob(jobId: string, data: TaskData): Promise<void> {
    const job = await this.taskQueue.getJob(jobId);
    if (job) {
      await job.update(data);
      this.logger.log(`Job ${jobId} updated successfully`);
    } else {
      this.logger.warn(`Job ${jobId} not found for update`);
    }
  }

  // Pause the queue
  async pauseQueue(): Promise<void> {
    await this.taskQueue.pause();
    this.logger.log('Queue paused');
  }

  // Resume the queue
  async resumeQueue(): Promise<void> {
    await this.taskQueue.resume();
    this.logger.log('Queue resumed');
  }

  // Clean old jobs from the queue
  async cleanOldJobs(gracePeriod: number = 24 * 3600 * 1000): Promise<void> {
    await this.taskQueue.clean(gracePeriod, 'completed');
    await this.taskQueue.clean(gracePeriod, 'failed');
    this.logger.log(`Cleaned jobs older than ${gracePeriod}ms`);
  }
}

import { Queue } from "bullmq";
import Redis from "ioredis";
import "dotenv/config";

const redisConnection = new Redis(process.env.REDIS_URL, {
  // host: "localhost",
  // port: 6379,
  maxRetriesPerRequest: null,
  tls: {},
});

const documentQueueName =
  process.env.DOCUMENT_QUEUE_NAME || "document-processing";

export const documentQueue = new Queue(documentQueueName, {
  connection: redisConnection,
});

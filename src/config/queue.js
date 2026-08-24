import { Queue } from "bullmq";
import Redis from "ioredis";
import "dotenv/config";

const redisConnection = new Redis(process.env.REDIS_URL, {
  // host: "localhost",
  // port: 6379,
  maxRetriesPerRequest: null,
  tls: {},
});

export const documentQueue = new Queue("document-processing", {
  connection: redisConnection,
});

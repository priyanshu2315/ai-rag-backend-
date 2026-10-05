import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import "dotenv/config";

const makeRedis = () =>
  new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    tls: {},
  });

const publisher = makeRedis();

const channelName = (documentId) => `doc-progress:${documentId}`;
// History key removed to save Redis storage
// const historyKey = (documentId) => `doc-progress-history:${documentId}`;

// No-op: Redis history has been disabled to save storage.
export const clearProgressHistory = async (documentId) => {};

// Return empty array: Redis history has been disabled to save storage.
export const getProgressHistory = async (documentId) => {
  return [];
};

export const publishProgress = async (documentId, event) => {
  const payload = {
    ...event,
    documentId,
    eventId: randomUUID(),
    timestamp: new Date().toISOString(),
  };
  const message = JSON.stringify(payload);
  if (process.env.RAG_DEBUG !== "false") {
    console.log("[Document pipeline]", message);
  }

  // Removed rpush and expire to save Redis storage
  
  try {
    await publisher.publish(channelName(documentId), message);
  } catch (err) {
    console.error("publishProgress failed:", err.message);
  }
};

export const createSubscriber = () => makeRedis();
export const getChannel = channelName;

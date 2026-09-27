import Redis from "ioredis";
import "dotenv/config";

const makeRedis = () =>
  new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    tls: {},
  });

const publisher = makeRedis();

const channelName = (documentId) => `doc-progress:${documentId}`;

export const publishProgress = async (documentId, event) => {
  try {
    await publisher.publish(channelName(documentId), JSON.stringify(event));
  } catch (err) {
    console.error("publishProgress failed:", err.message);
  }
};

export const createSubscriber = () => makeRedis();
export const getChannel = channelName;

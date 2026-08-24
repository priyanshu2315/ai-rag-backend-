import { documentQueue } from "../config/queue.js";

const jobs = await documentQueue.getJobs([
  "waiting",
  "active",
  "completed",
  "failed",
]);

for (const job of jobs) {
  console.log({
    id: job.id,
    name: job.name,
    state: await job.getState(),
    data: job.data,
  });
}

await documentQueue.close();

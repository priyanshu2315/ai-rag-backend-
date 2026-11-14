// src/config/checkpointer.js
// LangGraph checkpointer: saves graph state in Postgres after every node,
// so a paused graph (interrupt) can be resumed later, even after a restart.
// Tables live in their own schema "langgraph", so Prisma (schema "public") ignores them.
import "dotenv/config";
import { PostgresSaver } from "@langchain/langgraph-checkpoint-postgres";

export const checkpointer = PostgresSaver.fromConnString(
  process.env.DATABASE_URL,
  {
    schema: "langgraph",
  },
);

// Creates the schema and tables if missing. Safe to call many times.
let setupPromise = null;
export function setupCheckpointer() {
  setupPromise ??= checkpointer.setup();
  return setupPromise;
}

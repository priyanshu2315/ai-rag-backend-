import { env } from "@xenova/transformers";
import { createRequire } from "node:module";
import path from "node:path";
const require = createRequire(import.meta.url);
env.allowRemoteModels = false;
env.useFSCache = false;
env.localModelPath = path.resolve(
  path.dirname(require.resolve("@xenova/transformers")), "../.cache",
) + path.sep;
process.env.RAG_DEBUG = "false";

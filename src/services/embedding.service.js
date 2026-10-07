import { pipeline } from "@xenova/transformers";

export const EMBEDDING_MODEL = "Xenova/all-MiniLM-L6-v2";

export const INDEX_TOKEN_LIMIT = 256;

export function createEmbeddingService(
  loadPipeline = () => pipeline("feature-extraction", EMBEDDING_MODEL),
) {
  let pendingPipeline;

  function getPipeline() {
    if (!pendingPipeline) {
      pendingPipeline = Promise.resolve()
        .then(loadPipeline)
        .catch((error) => {
          pendingPipeline = undefined;
          throw error;
        });
    }

    return pendingPipeline;
  }

  function validateText(text) {
    if (typeof text !== "string") {
      throw new TypeError("Embedding input must be a string");
    }
  }

  async function measureEmbeddingInput(text) {
    validateText(text);

    const extractor = await getPipeline();

    const modelLimit = Number(extractor.tokenizer.model_max_length);

    if (!Number.isSafeInteger(modelLimit) || modelLimit < 1) {
      throw new Error("Embedding tokenizer has no valid model_max_length");
    }

    const tokens = await extractor.tokenizer(text, {
      add_special_tokens: true,
      truncation: false,
      padding: false,
    });

    const tokenCount = tokens.input_ids.data.length;

    const tokenLimit = Math.min(modelLimit, INDEX_TOKEN_LIMIT);

    return {
      model: EMBEDDING_MODEL,
      tokenCount,
      tokenLimit,
      withinLimit: tokenCount <= tokenLimit,
    };
  }

  async function getEmbedding(
    text,
    { rejectTruncation = false, onDetails } = {},
  ) {
    validateText(text);

    const extractor = await getPipeline();

    const details = rejectTruncation
      ? await measureEmbeddingInput(text)
      : { model: EMBEDDING_MODEL };

    if (rejectTruncation && !details.withinLimit) {
      if (onDetails) {
        await onDetails(details);
      }

      const error = new Error(
        "Chunk is too large for embedding: " + details.tokenCount + " tokens",
      );

      error.code = "EMBEDDING_INPUT_TOO_LARGE";
      error.details = details;

      throw error;
    }

    const output = await extractor(text, {
      pooling: "mean",
      normalize: true,
    });

    details.dimensions = output.data.length;

    if (onDetails) {
      await onDetails(details);
    }

    return Array.from(output.data);
  }

  return {
    measureEmbeddingInput,
    getEmbedding,
  };
}

const service = createEmbeddingService();

export const measureEmbeddingInput = service.measureEmbeddingInput;

export const getEmbedding = service.getEmbedding;

// Replace job: puts a new version of a document in place, keeping every chunk whose text
// did not change (same ID, no new embedding). Runs in the document worker.
import { supabase } from "../config/supabase.js";
import * as aiService from "./ai.service.js";
import { chunkHash } from "./simple-chunking.service.js";
import { extractUnits, linkUnitsToChunks } from "./document-units.service.js";
import {
  getActiveChunks,
  saveReplacedVersion,
} from "../repositories/document.repository.js";

// v4 chunks were saved before hashes existed, so their hashes are computed here.
const contentHashOf = (chunk) =>
  chunk.metadata?.content_hash ?? chunkHash(chunk.text);
const contextHashOf = (chunk) =>
  chunk.metadata?.context_hash ?? chunkHash(chunk.searchText);

function poolByContent(chunks) {
  const pool = new Map();
  for (const chunk of chunks) {
    const hash = contentHashOf(chunk);
    if (!pool.has(hash)) pool.set(hash, []);
    pool.get(hash).push(chunk);
  }
  return pool;
}

// Each old chunk can be matched once: two equal old chunks and one new = one kept, one removed.
const takeMatch = (pool, chunk) =>
  pool.get(contentHashOf(chunk))?.shift() ?? null;

export function planChunkChanges(oldParents, newParents) {
  const plan = {
    keptParents: [],
    addedParents: [],
    removedParentIds: [],
    keptChildren: [],
    addedChildren: [],
    removedChildIds: [],
  };
  const pool = poolByContent(oldParents);
  const finalId = new Map(); // new parent's temporary ID -> the old ID it keeps

  for (const parent of newParents) {
    
    const old = takeMatch(pool, parent);

    if (!old) {
      plan.addedParents.push(parent);
      plan.addedChildren.push(...parent.children);
      continue;
    }

    finalId.set(parent.id, old.id);
    parent.id = old.id;
    plan.keptParents.push(parent);

    const childPool = poolByContent(old.children);

    for (const child of parent.children) {
      child.parentId = old.id;
      const oldChild = takeMatch(childPool, child);

      if (!oldChild) {
        plan.addedChildren.push(child);
        continue;
      }

      child.id = oldChild.id;
      // searchText = title + section path + text: a renamed heading changes it.
      child.reembed = contextHashOf(child) !== contextHashOf(oldChild);
      if (!child.reembed)
        child.metadata.embedding = oldChild.metadata?.embedding;
      plan.keptChildren.push(child);
    }
    for (const left of childPool.values())
      plan.removedChildIds.push(...left.map((c) => c.id));
  }

  for (const left of pool.values()) {
    for (const old of left) {
      plan.removedParentIds.push(old.id);
      plan.removedChildIds.push(...old.children.map((c) => c.id));
    }
  }

  // The chunker linked parents by their temporary IDs; point the links at the final IDs.
  for (const parent of newParents) {
    parent.prevParentId =
      finalId.get(parent.prevParentId) ?? parent.prevParentId;
    parent.nextParentId =
      finalId.get(parent.nextParentId) ?? parent.nextParentId;
  }
  return plan;
}

export async function runReplaceJob(job, publishProgress) {
  const {
    documentId,
    filepath,
    oldFilepath,
    mimetype,
    filename,
    fileUrl,
    fileHash,
    version,
  } = job.data;
  const onEvent = (event) => publishProgress(documentId, event);

  try {
    await onEvent({ type: "replace_start", stage: "preparing", version });

    // 1. Full AI extraction and v5 chunking of the new PDF (changed pages only: item 8).
    const buffer = await aiService.downloadDocument(filepath);
    const extraction = await aiService.extractDocument({
      filepath,
      filename,
      mimetype,
      buffer,
      onEvent,
    });
    const newParents = await aiService.buildDocumentChunks(
      extraction,
      documentId,
      filename,
      onEvent,
    );

    // 2. Compare with the chunks in use now.
    const plan = planChunkChanges(
      await getActiveChunks(documentId),
      newParents,
    );

    // 3. Embed only new children and children whose search text changed.
    const toEmbed = [
      ...plan.addedChildren,
      ...plan.keptChildren.filter((child) => child.reembed),
    ];
    for (const child of toEmbed) {
      const vector = await aiService.getEmbedding(child.searchText, {
        rejectTruncation: true,
        onDetails: (details) => {
          child.metadata.embedding = details;
        },
      });
      child.embedding = `[${vector.join(",")}]`;
    }

    // 4. Sentence list of the new version, linked to the final chunk IDs.
    let units = [];
    try {
      units = linkUnitsToChunks(await extractUnits(buffer), newParents);
    } catch (error) {
      console.error(
        `[Replace] ${documentId}: unit index failed:`,
        error.message,
      );
    }

    // 5. Swap to the new version in one transaction.
    await saveReplacedVersion(documentId, {
      plan,
      units,
      version,
      file: { filename, fileUrl, fileHash },
    });

    // 6. The old PDF is no longer needed (a leftover file does no harm, so errors are ignored).
    if (oldFilepath)
      await supabase.storage.from("documents").remove([oldFilepath]);

    await onEvent({
      type: "replace_complete",
      stage: "saved",
      version,
      parents: {
        kept: plan.keptParents.length,
        added: plan.addedParents.length,
        removed: plan.removedParentIds.length,
      },
      children: {
        kept: plan.keptChildren.length,
        added: plan.addedChildren.length,
        removed: plan.removedChildIds.length,
      },
      embedded: toEmbed.length,
    });
  } catch (error) {
    // Nothing was saved: the old version stays in use. Remove the uploaded new file.
    console.error(`[Replace] ${documentId} failed:`, error);
    await supabase.storage.from("documents").remove([filepath]);
    await onEvent({
      type: "replace_failed",
      stage: "failed",
      version,
      message: error.message,
    });
  }
}

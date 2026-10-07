import { measureEmbeddingInput } from "./embedding.service.js";

export async function packStructuralUnits(units, sections, identity, documentId, {
  measure = measureEmbeddingInput, parentTokenLimit = 1024, childTokenLimit = 256,
} = {}) {
  if (![parentTokenLimit, childTokenLimit].every((n) => Number.isSafeInteger(n) && n > 0) ||
      parentTokenLimit < childTokenLimit) {
    throw new TypeError("Expected positive token budgets, with parent >= child");
  }
  const sectionMap = new Map(sections.map((section) => [section.id, section]));
  const cache = new Map();
  async function count(text) {
    if (!cache.has(text)) {
      const details = await measure(text);
      if (!Number.isSafeInteger(details.tokenCount) || details.tokenCount < 1 ||
          !Number.isSafeInteger(details.tokenLimit) || details.tokenLimit < 1) {
        throw new Error("Invalid tokenizer measurement");
      }
      if (cache.size >= 2048) cache.clear();
      cache.set(text, details);
    }
    return cache.get(text);
  }

  const groups = [];
  for (const unit of units) {
    const section = sectionMap.get(unit.sectionId);
    let prefix = "Document: " + identity.title +
      (section?.headingPath.length ? "\nSection: " + section.headingPath.join(" > ") : "");
    const limit = Math.min(childTokenLimit, (await count("")).tokenLimit);
    let compacted = false;
    if ((await count(prefix + "\n\n")).tokenCount > limit - 24) {
      prefix = "Document ID: " + documentId +
        (unit.sectionId ? "\nSection ID: " + unit.sectionId : "");
      compacted = true;
    }
    const groupKey = JSON.stringify([unit.sectionId, unit.locations[0].sourceId, unit.groupId, prefix]);
    let group = groups.at(-1);
    if (group?.key !== groupKey) {
      group = { key: groupKey, sectionId: unit.sectionId, prefix, compacted,
        childLimit: limit, pieces: [] };
      groups.push(group);
    }

    const render = (body, labels = unit.labels) =>
      [...labels, body].filter((value) => value !== "").join("\n");
    const search = (text) => prefix + "\n\n" + text;
    async function fits(text) {
      return (await count(search(text))).tokenCount <= limit;
    }
    function add(text, fragment = false) {
      group.pieces.push({ text, unit, fragment });
    }

    async function splitValue(value, renderValue) {
      if (await fits(renderValue(value))) {
        add(renderValue(value), true);
        return;
      }
      const chars = Array.from(value);
      if (chars.length <= 1) {
        const error = new Error("Required chunk context cannot fit the embedding budget");
        error.code = "CHUNK_CONTEXT_TOO_LARGE";
        error.details = { unitId: unit.id, blockId: unit.blockId, tokenLimit: limit };
        throw error;
      }
      // Prefer a whitespace boundary near the middle; otherwise preserve Unicode
      // code points. Every resulting piece is re-tokenized; counts need not be additive.
      const middle = Math.floor(chars.length / 2);
      let cut = middle;
      let found = false;
      for (const boundary of [
        (at) => chars[at] === "\n",
        (at) => /[.!?。！？]/u.test(chars[at - 1] ?? "") && /\s/u.test(chars[at]),
        (at) => /\s/u.test(chars[at]),
      ]) {
        for (let distance = 0; distance < Math.max(1, Math.floor(chars.length / 4)); distance++) {
          const at = middle - distance;
          if (at + 1 < chars.length && boundary(at)) {
            cut = at + 1; found = true; break;
          }
        }
        if (found) break;
      }
      await splitValue(chars.slice(0, cut).join(""), renderValue);
      await splitValue(chars.slice(cut).join(""), renderValue);
    }

    const complete = render(unit.text);
    if (await fits(complete)) {
      add(complete);
    } else if (unit.fields) {
      for (const field of unit.fields) {
        await splitValue(field.value, (value) => render(
          "Row identity: " + unit.rowAnchor + "\n" +
          field.label + ": " + value,
        ));
      }
    } else {
      await splitValue(unit.text, (value) => render(value));
    }
  }

  const packed = [];
  for (const group of groups) {
    let parentPieces = [];
    let children = [];
    let childPieces = [];
    const joined = (pieces) => pieces.map((piece) => piece.text).join("\n\n");
    const search = (pieces) => group.prefix + "\n\n" + joined(pieces);

    async function finishChild() {
      if (!childPieces.length) return;
      children.push({
        pieces: childPieces, text: joined(childPieces),
        searchText: search(childPieces), tokens: await count(search(childPieces)),
      });
      childPieces = [];
    }
    async function finishParent() {
      await finishChild();
      if (!parentPieces.length) return;
      packed.push({
        ...group, pieces: parentPieces, text: joined(parentPieces),
        searchText: search(parentPieces), children,
        tokenCount: (await count(search(parentPieces))).tokenCount,
        tokenLimit: parentTokenLimit,
      });
      parentPieces = [];
      children = [];
    }

    for (const piece of group.pieces) {
      if (parentPieces.length &&
          (await count(search([...parentPieces, piece]))).tokenCount > parentTokenLimit) {
        await finishParent();
      }
      if (childPieces.length &&
          (await count(search([...childPieces, piece]))).tokenCount > group.childLimit) {
        await finishChild();
      }
      parentPieces.push(piece);
      childPieces.push(piece);
    }
    await finishParent();
  }
  return packed;
}

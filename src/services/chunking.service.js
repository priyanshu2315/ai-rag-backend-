import { randomUUID } from "node:crypto";

import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

const chunkSettings = {
  chunkerVersion: "section-context-v1",
  parentChunkSize: 1200,
  parentChunkOverlap: 200,
  childChunkSize: 400,
  childChunkOverlap: 50,
  sizeUnit: "characters",
};

const parentSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: chunkSettings.parentChunkSize,
  chunkOverlap: chunkSettings.parentChunkOverlap,
});

const childSplitter = new RecursiveCharacterTextSplitter({
  chunkSize: chunkSettings.childChunkSize,
  chunkOverlap: chunkSettings.childChunkOverlap,
});

function readHeading(line) {
  // Handles:
  // # School handbook
  // ## Late pickup
  // ### Exceptions
  const markdownHeading = line.match(/^\s*(#{1,6})\s+(.+)$/);

  if (markdownHeading) {
    return {
      level: markdownHeading[1].length,
      format: "markdown",
      title: markdownHeading[2]
        .replace(/\s+#+$/, "")
        .replace(/\*\*|__/g, "")
        .trim(),
    };
  }

  // Some extracted PDF headings are bold instead of using #.
  // Example: **6. PLANTS THAT PERFORMED WELL IN 2023**
  const boldHeading = line.trim().match(/^(?:\*\*|__)(.+?)(?:\*\*|__)$/);

  if (boldHeading && boldHeading[1].length <= 180) {
    return {
      level: 2,
      format: "bold",
      title: boldHeading[1].trim(),
    };
  }

  // Handles numbered uppercase headings without Markdown.
  // Example: 6. PLANTS THAT PERFORMED WELL IN 2023
  const text = line.trim();

  const startsWithNumber = /^\d+(?:\.\d+)*[.)]\s+/.test(text);
  const isUppercase = /[A-Z]/.test(text) && text === text.toUpperCase();

  if (startsWithNumber && isUppercase && text.length <= 180) {
    return {
      level: 2,
      format: "numbered_uppercase",
      title: text,
    };
  }

  return null;
}

async function buildSections(pages, report) {
  const sections = [];

  // Example:
  // ["School handbook", "Late pickup", "Exceptions"]
  const headingList = [];

  let currentSection = null;
  let linesForThisPart = [];
  let currentPageNumber = 1;
  let insideCodeBlock = false;

  async function startSection() {
    const headingPath = [];

    for (const heading of headingList) {
      headingPath.push(heading.title);
    }

    currentSection = {
      id: `section-${sections.length + 1}`,
      headingPath,
      parts: [],
    };

    sections.push(currentSection);
    await report({
      type: "section",
      sectionId: currentSection.id,
      headingPath,
      page: currentPageNumber,
      stage: "preparing",
    });
  }

  async function saveCurrentPart() {
    const text = linesForThisPart.join("\n").trim();

    if (text) {
      if (!currentSection) {
        await startSection();
      }

      currentSection.parts.push({
        text,
        pageNumber: currentPageNumber,
      });
      await report({
        type: "section_part",
        sectionId: currentSection.id,
        headingPath: currentSection.headingPath,
        page: currentPageNumber,
        partIndex: currentSection.parts.length - 1,
        text,
        textLength: text.length,
        stage: "preparing",
      });
    }

    linesForThisPart = [];
  }

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    currentPageNumber = pageIndex + 1;

    const pageText = String(pages[pageIndex].text || "");
    const lines = pageText.replace(/\r\n?/g, "\n").split("\n");

    for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
      const line = lines[lineIndex];
      // A # inside a code example is not a document heading.
      if (/^\s*(```|~~~)/.test(line)) {
        insideCodeBlock = !insideCodeBlock;
        await report({
          type: "code_fence",
          page: currentPageNumber,
          lineNumber: lineIndex + 1,
          text: line,
          insideCodeBlock,
        });
        linesForThisPart.push(line);
        continue;
      }

      if (insideCodeBlock) {
        linesForThisPart.push(line);
        continue;
      }

      const heading = readHeading(line);

      if (!heading) {
        linesForThisPart.push(line);
        continue;
      }

      // A repeated heading can be a page's running header.
      const lastHeading = headingList[headingList.length - 1];
      const repeated = Boolean(
        lastHeading &&
        lastHeading.title === heading.title &&
        lastHeading.level === heading.level,
      );
      await report({
        type: "heading_detected",
        page: currentPageNumber,
        lineNumber: lineIndex + 1,
        text: line,
        title: heading.title,
        level: heading.level,
        format: heading.format,
        repeated,
      });

      if (repeated) {
        continue;
      }

      await saveCurrentPart();

      // A new heading replaces headings at its own level
      // and any smaller subsections beneath it.
      while (
        headingList.length > 0 &&
        headingList[headingList.length - 1].level >= heading.level
      ) {
        headingList.pop();
      }

      headingList.push(heading);
      await startSection();
    }

    // Save this page's text, but keep the current heading.
    await saveCurrentPart();

    // Do NOT clear headingList or currentSection here.
    // The next page can continue this same section.
  }

  return sections;
}

function makeSearchText(text, documentTitle, headingPath) {
  const labels = [];

  if (documentTitle) {
    labels.push(`Document: ${documentTitle}`);
  }

  if (headingPath.length > 0) {
    labels.push(`Section: ${headingPath.join(" > ")}`);
  }

  return labels.join("\n") + "\n\n" + text;
}

export async function buildDocumentChunks(
  pages,
  documentId,
  documentTitle,
  onEvent,
) {
  const report = async (event) => {
    if (onEvent) await onEvent(event);
    else if (process.env.RAG_DEBUG !== "false") {
      console.log("[Chunking]", JSON.stringify({ documentId, ...event }));
    }
  };
  await report({
    type: "chunking_start",
    documentTitle,
    totalPages: pages.length,
    ...chunkSettings,
  });
  const sections = await buildSections(pages, report);
  const parents = [];

  let globalChunkIndex = 0;

  for (const section of sections) {
    const parentsInThisSection = [];

    for (let partIndex = 0; partIndex < section.parts.length; partIndex++) {
      const part = section.parts[partIndex];
      const parentDocuments = await parentSplitter.createDocuments([part.text]);

      for (const parentDocument of parentDocuments) {
        const parentId = randomUUID();
        const parentText = parentDocument.pageContent;

        const parentMetadata = {
          page_number: part.pageNumber,
          source_pages: [part.pageNumber],
          chunk_index: globalChunkIndex,

          document_title: documentTitle,
          heading_path: section.headingPath,
          section_id: section.id,
          section_part_index: partIndex,

          chunker_version: chunkSettings.chunkerVersion,
        };

        globalChunkIndex++;

        const parent = {
          id: parentId,
          documentId,

          text: parentText,

          searchText: makeSearchText(
            parentText,
            documentTitle,
            section.headingPath,
          ),

          metadata: parentMetadata,

          prevParentId: null,
          nextParentId: null,

          children: [],
        };

        const childDocuments = await childSplitter.createDocuments([
          parentText,
        ]);
        await report({
          type: "parent_created",
          stage: "preparing",
          parent: {
            id: parent.id,
            documentId,
            text: parent.text,
            searchText: parent.searchText,
            metadata: parent.metadata,
            prevParentId: null,
            nextParentId: null,
            totalChildren: childDocuments.length,
          },
        });

        for (
          let childIndex = 0;
          childIndex < childDocuments.length;
          childIndex++
        ) {
          const childText = childDocuments[childIndex].pageContent;

          parent.children.push({
            id: randomUUID(),
            parentId,
            documentId,

            text: childText,

            searchText: makeSearchText(
              childText,
              documentTitle,
              section.headingPath,
            ),

            metadata: {
              ...parentMetadata,
              child_index: childIndex,
            },
          });
          await report({
            type: "child_created",
            stage: "preparing",
            child: parent.children[parent.children.length - 1],
          });
        }

        parents.push(parent);
        parentsInThisSection.push(parent);
      }
    }

    // Connect parents only inside this section.
    for (let index = 0; index < parentsInThisSection.length; index++) {
      const parent = parentsInThisSection[index];

      if (index > 0) {
        parent.prevParentId = parentsInThisSection[index - 1].id;
      }

      if (index < parentsInThisSection.length - 1) {
        parent.nextParentId = parentsInThisSection[index + 1].id;
      }
      await report({
        type: "parent_links",
        stage: "preparing",
        sectionId: section.id,
        parentId: parent.id,
        prevParentId: parent.prevParentId,
        nextParentId: parent.nextParentId,
      });
    }
  }

  if (parents.length === 0) {
    throw new Error("Document contains no extractable text");
  }

  const sectionDetails = sections.map((section) => {
    const sectionParents = parents.filter(
      (parent) => parent.metadata.section_id === section.id,
    );
    return {
      id: section.id,
      headingPath: section.headingPath,
      sourcePages: [...new Set(section.parts.map((part) => part.pageNumber))],
      totalParents: sectionParents.length,
      totalChildren: sectionParents.reduce(
        (count, parent) => count + parent.children.length,
        0,
      ),
    };
  });
  await report({
    type: "chunking_complete",
    stage: "preparing",
    totalPages: pages.length,
    totalSections: sections.length,
    totalParents: parents.length,
    totalChildren: parents.reduce(
      (count, parent) => count + parent.children.length,
      0,
    ),
    sections: sectionDetails,
  });

  return parents;
}

// import { PrismaClient } from "../../generated/prisma/client.ts";
import fs from "fs";
import prisma from "../config/db.js";

async function exportChunks() {
  // Grab the document and its parent chunks
  const doc = await prisma.document.findFirst({
    where: { filename: { contains: "alcohol", mode: "insensitive" } },
    include: {
      parents: {
        select: {
          id: true,
          text: true,
          metadata: true,
        },
      },
    },
  });

  if (!doc) {
    console.log("Document not found in database!");
    return;
  }

  // Save the exact chunks your code created to a local file
  fs.writeFileSync(
    "extracted_parents.json",
    JSON.stringify(doc.parents, null, 2),
  );
  console.log(
    `Saved ${doc.parents.length} parent chunks to extracted_parents.json`,
  );
}

exportChunks().finally(() => prisma.$disconnect());

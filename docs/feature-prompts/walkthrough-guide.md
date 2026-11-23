Write a walkthrough guide for the <FEATURE NAME> feature.

Who it's for: me. I'm a React developer still learning backend. Assume I know
JavaScript but not this codebase, databases or queues. Explain every new term
the first time it appears, in one plain sentence.

Save it as: docs/<feature>-guide.md
I'll read it in VS Code's Markdown preview, so keep it easy to scan: clear
headings, short paragraphs, tables and small diagrams. Avoid walls of text.

What to cover:

- <flow 1, e.g. "first upload of a document">
- <flow 2, e.g. "replacing it with a new version">
- <flow 3, e.g. "the 'what changed' screen">
  Leave out: <anything to skip>

Structure:

1. Big picture first: what problem this solves, plus one simple diagram of
   the whole flow, before any code.
2. One real example used all the way through (real IDs and values from my
   database or test files), so I can follow one request from start to end.
3. For each flow, follow the request in order:
   route -> controller -> service -> repository -> database.
   For every function: file name, a clickable link to its line
   (../src/...#L42), what it does in 1-3 plain sentences, why it exists,
   and what happens to our example at that step.
4. Show the data at each step (what goes in, what comes out) using the example.
5. Nuances: edge cases, why something is done in a non-obvious way, and what
   breaks if you change it.
6. What's not built yet, and known limits.
7. Cheat sheet at the end: one table of every function, file, line and
   one-line purpose.

Rules:

- Read the actual code before writing. Don't guess, and check every line link.
- Explain the "why", not only the "what".
- Only create this one file. Don't change any code.
- Then tell me in chat which section to read first.

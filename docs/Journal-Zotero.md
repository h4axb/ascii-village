# Journal: sources from Zotero

The Project Log (`/journal`) reads its literature sources from a Zotero library.
Zotero is the only place the sources are kept. The journal keeps a short copy of
each item to show and search it, and an entry stores only the item key. After a
sync, every entry shows the current title, authors and APA reference.

## Setup (Cloudflare)

1. On zotero.org → Settings → Feeds/API, create a key.
   - Allow library access. Also allow write access if new sources should be
     added from the journal ("New in Zotero").
   - Note your user ID, shown on the same page.
2. Store the key as a **secret**: run `npx wrangler secret put ZOTERO_API_KEY`,
   or set it in the dashboard → Worker → Settings → Variables as a secret.
   - It is sent only to api.zotero.org and never appears in a response or in
     the browser.
3. Add the variables `ZOTERO_LIBRARY_TYPE=user` (or `group`) and
   `ZOTERO_LIBRARY_ID=<your user or group ID>`.

## Use

- **Sync:** the "Zotero" button on Project Log and Research & Findings loads
  Zotero's changes. It also runs on its own when the journal opens and the last
  sync is older than 6 hours.
  - More (⋯) → "Reload all sources from Zotero" loads the whole library again.
  - More (⋯) → "Match existing links with Zotero …" links older links of
    entries and tasks to library items, by DOI, web address or title.
- **Adding a source:** in an entry or task's attachments, click "Zotero source".
  - "From library" searches the library.
  - "New in Zotero" looks up a DOI, ISBN or web address and shows the data to
    check. It then saves the source to Zotero (optionally into a collection) and
    links it. A source already in the library is offered instead of a duplicate.
  - The 🕮 button next to an ordinary link links that link to a library item.
  - Uploaded files and ordinary links stay as they were.
- A linked source that was deleted in Zotero keeps its old title and link and is
  marked "No longer in Zotero".

Dev: `ZOTERO_FAKE=1 npx vite` answers from a small made-up library
(`functions/api/zotero.ts`).

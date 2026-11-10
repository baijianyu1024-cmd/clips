import { needsLinkTitle, titlesFromTabs } from './link-metadata.js';

// Retain only missing queue titles, not browsing history or the user's drafts.
export function createQueueTitleSync({ cloud, tabs }) {
  let missing = [], running = false, again = false;
  async function refresh() {
    if (running) { again = true; return; }
    if (!missing.length) return;
    running = true;
    try {
      const candidates = missing.slice(), opened = await tabs();
      for (const note of candidates) {
        const browser = titlesFromTabs([note.sources[0].url], opened)[0];
        if (!browser || !missing.some(n => n.id === note.id)) continue;
        try {
          const result = await cloud({ method: 'POST', body: { action: 'resolve_title', id: note.id, browser, browserOnly: true } });
          if (result.note && !needsLinkTitle(result.note)) missing = missing.filter(n => n.id !== note.id);
        } catch { /* A later sync retries; reading and drafts are unaffected. */ }
      }
    } finally {
      running = false;
      if (again) { again = false; void refresh(); }
    }
  }
  return {
    update(notes) { missing = notes.filter(needsLinkTitle).map(n => ({ id: n.id, sources: [n.sources[0]] })); void refresh().catch(() => {}); },
    refresh: () => refresh().catch(() => {}),
  };
}

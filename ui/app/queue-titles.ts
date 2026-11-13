import {localQueueTitles} from "./client-runtime";
import { titleUrlKey, cleanPageTitle } from '@/extension/link-metadata.js';

type PageTitle = { url: string; title: string };
export function browserQueueTitles(urls: string[]): Promise<PageTitle[]> {
  const local=localQueueTitles(urls);if(local)return local;
  return new Promise(resolve => {
    const id = crypto.randomUUID(), requested = new Set(urls.map(titleUrlKey));
    function finish(titles: PageTitle[]) { clearTimeout(timer); window.removeEventListener('message', receive); resolve(titles); }
    function receive(event: MessageEvent) {
      const m = event.data;
      if (event.source !== window || event.origin !== location.origin || m?.type !== 'CLIPS_QUEUE_TITLES_RESULT' || m.id !== id || !Array.isArray(m.titles)) return;
      finish(m.titles.slice(0, 100).filter((t: PageTitle) => t && typeof t.url === 'string' && requested.has(titleUrlKey(t.url)) && cleanPageTitle(t.title, t.url)));
    }
    const timer = setTimeout(() => finish([]), 700);
    window.addEventListener('message', receive);
    window.postMessage({ type: 'CLIPS_QUEUE_TITLES', id, urls: urls.slice(0, 100) }, location.origin);
  });
}

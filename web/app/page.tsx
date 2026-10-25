import { DocumentChecker } from "@/components/document-checker";
import { getServerApiKey } from "@/lib/server-key";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <div className="site-shell">
      <header className="site-header"><a href="/" className="wordmark" aria-label="Liedar home">liedar</a></header>
      <main><DocumentChecker hasServerKey={Boolean(getServerApiKey())} /></main>
      <footer className="site-footer" title="Documents are sent to OpenAI. Temporary uploads are removed after each check. A screening tool, not a final verdict.">Sent to OpenAI · Uploads cleared · Screening only</footer>
    </div>
  );
}

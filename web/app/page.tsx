import { DocumentChecker } from "@/components/document-checker";
import { getServerProviders } from "@/lib/server-key";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <div className="site-shell">
      <header className="site-header">
        <a href="/" className="wordmark" aria-label="Liedar home">liedar</a>
        <span className="studio-wordmark"><span aria-hidden="true">✳</span> mellow</span>
      </header>
      <main><DocumentChecker serverProviders={getServerProviders()} /></main>
      <footer className="site-footer" title="Documents are sent to the selected provider. Temporary uploads are removed after each check. A screening tool, not a final verdict.">AI analysis · Uploads cleared · Screening only</footer>
    </div>
  );
}

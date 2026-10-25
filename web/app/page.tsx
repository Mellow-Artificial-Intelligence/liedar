import { DocumentChecker } from "@/components/document-checker";
import { getServerApiKey } from "@/lib/server-key";
import { ScanLine } from "lucide-react";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <div className="site-shell">
      <header className="site-header"><a href="/" className="wordmark" aria-label="Liedar home"><ScanLine size={23} strokeWidth={1.5} />liedar.</a></header>
      <main><DocumentChecker hasServerKey={Boolean(getServerApiKey())} /></main>
      <footer className="site-footer"><span>Documents are sent to OpenAI. Temporary uploads are removed after each check.</span><span>A screening tool, not a final verdict.</span></footer>
    </div>
  );
}

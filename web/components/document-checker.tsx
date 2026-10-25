"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Download, FileText, KeyRound, LoaderCircle, Plus, Upload, TriangleAlert, X } from "lucide-react";
import type { FraudReason, FraudReport, Provider } from "@liedar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Review = { schemaVersion: number; report: FraudReport; metadata: unknown; analysis: unknown };
type ReviewState = { status: "idle" } | { status: "checking" } | { status: "complete"; result: Review };
const MAX_BYTES = 20 * 1024 * 1024;
const SESSION_KEYS = { openai: "liedar-api-key", typesafe: "liedar-typesafe-api-key" };
const PROVIDER_NAMES = { openai: "OpenAI", typesafe: "TypeSafe (Jev)" };

export function DocumentChecker({ serverProviders = [] }: { serverProviders?: Provider[] }) {
  const input = useRef<HTMLInputElement>(null);
  const [providerChoice, setProviderChoice] = useState<Provider | "auto">("auto");
  const [sessionKeys, setSessionKeys] = useState({ openai: "", typesafe: "" });
  const automaticProvider: Provider = sessionKeys.openai ? "openai" : sessionKeys.typesafe ? "typesafe" : serverProviders[0] ?? "openai";
  const provider = providerChoice === "auto" ? automaticProvider : providerChoice;
  const apiKey = sessionKeys[provider];
  const hasServerKey = serverProviders.includes(provider);
  const [keyDraft, setKeyDraft] = useState("");
  const [keyOpen, setKeyOpen] = useState(false);
  const [keyNotice, setKeyNotice] = useState("");
  useEffect(() => {
    try {
      const savedProvider = sessionStorage.getItem("liedar-provider");
      if (savedProvider === "openai" || savedProvider === "typesafe") setProviderChoice(savedProvider);
      setSessionKeys({ openai: sessionStorage.getItem(SESSION_KEYS.openai) ?? "", typesafe: sessionStorage.getItem(SESSION_KEYS.typesafe) ?? "" });
    } catch { /* Memory-only use still works when browser storage is disabled. */ }
  }, []);

  function saveKey() {
    const key = keyDraft.trim();
    if (!key || /\s/.test(key) || key.length > 1024) { setKeyNotice("Enter a valid API key for the selected provider."); return; }
    setSessionKeys((previous) => ({ ...previous, [provider]: key }));
    setKeyDraft("");
    setKeyOpen(false);
    setKeyNotice("");
    try { sessionStorage.setItem(SESSION_KEYS[provider], key); } catch { setKeyNotice("Key kept in memory for this page only."); }
  }

  function clearKey() {
    setSessionKeys((previous) => ({ ...previous, [provider]: "" }));
    setKeyDraft("");
    setKeyNotice("");
    try { sessionStorage.removeItem(SESSION_KEYS[provider]); } catch { /* No persisted key exists when storage is disabled. */ }
    setKeyOpen(!hasServerKey);
  }

  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<ReviewState>({ status: "idle" });
  const [error, setError] = useState("");
  const [dragging, setDragging] = useState(false);
  const busy = state.status === "checking";

  function selectFile(files: FileList | null) {
    setError("");
    if (!files?.length) return;
    if (files.length !== 1) { setError("Choose one document at a time."); return; }
    const next = files[0]!;
    if (!/\.(pdf|png|jpe?g)$/i.test(next.name)) { setError("Choose a PDF, PNG, or JPEG document."); return; }
    if (!next.size || next.size > MAX_BYTES) { setError(next.size ? "Choose a file smaller than 20 MB." : "This file is empty. Choose another document."); return; }
    setFile(next);
    setState({ status: "idle" });
  }

  function reset() {
    setFile(null);
    setState({ status: "idle" });
    setError("");
    if (input.current) input.current.value = "";
  }

  async function check() {
    if (!file || busy) return;
    if (!apiKey && !hasServerKey) { setKeyOpen(true); setKeyNotice("Add an API key for the selected provider to continue."); return; }
    setState({ status: "checking" });
    setError("");
    try {
      const response = await fetch(`/api/check?name=${encodeURIComponent(file.name)}&provider=${provider}`, {
        method: "POST", headers: { "Content-Type": "application/octet-stream", ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}) }, body: file,
      });
      const payload = await response.json().catch(() => {
        throw new Error("The document check could not finish. Please try again.");
      });
      if (response.status === 401) setKeyOpen(true);
      if (!response.ok) throw new Error(payload.error?.message ?? "The check could not finish. Please try again.");
      setState({ status: "complete", result: payload });
    } catch (cause) {
      setState({ status: "idle" });
      setError(cause instanceof Error ? cause.message : "Could not connect. Please try again.");
    }
  }

  function drop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    if (!busy) selectFile(event.dataTransfer.files);
  }

  return (
    <section className={cn("checker", state.status === "complete" && "checker-complete")} aria-labelledby="main-heading">
      {state.status !== "complete" ? <div className="intro">
        <span className="eyebrow">A second look</span>
        <h1 id="main-heading">Check a document.</h1>
        <p>Tampering, consistency, origin, and readability.</p>
      </div> : null}
      <div className="key-settings">
        <div className="provider-control"><label htmlFor="provider">Provider</label><select id="provider" value={providerChoice} disabled={busy} onChange={(event) => { setProviderChoice(event.target.value as Provider | "auto"); try { sessionStorage.setItem("liedar-provider", event.target.value); } catch { /* Choice remains in memory. */ } setState({ status: "idle" }); setKeyDraft(""); setKeyNotice(""); setError(""); }}><option value="auto">Auto · {PROVIDER_NAMES[automaticProvider]}</option><option value="openai">OpenAI</option><option value="typesafe">TypeSafe (Jev)</option></select></div>
        <button className="key-toggle" type="button" aria-expanded={keyOpen} aria-controls="api-key-panel" disabled={busy} onClick={() => setKeyOpen(!keyOpen)}><KeyRound size={14} />{apiKey ? `${PROVIDER_NAMES[provider]} · Session key` : hasServerKey ? `${PROVIDER_NAMES[provider]} · Server key` : `Add ${PROVIDER_NAMES[provider]} key`}<ChevronDown size={13} /></button>
        {keyOpen ? <form id="api-key-panel" className="key-panel" onSubmit={(event) => { event.preventDefault(); saveKey(); }}>
          <label htmlFor="api-key">{hasServerKey ? "Use a different API key" : `${PROVIDER_NAMES[provider]} API key`}</label>
          <input id="api-key" type="password" autoComplete="off" spellCheck={false} value={keyDraft} onChange={(event) => setKeyDraft(event.target.value)} placeholder={apiKey ? "Enter a replacement key" : "Paste your API key"} disabled={busy} aria-describedby="key-help" />
          <p id="key-help">{hasServerKey ? "Leave this empty to use the server’s configured key. " : ""}Your key is kept in this tab’s session. Never saved on the server. Clear it here or close the tab to remove it.</p>
          <div className="key-actions"><Button type="submit" size="sm" disabled={busy || !keyDraft.trim()}>Use key</Button>{apiKey ? <Button variant="ghost" type="button" size="sm" disabled={busy} onClick={clearKey}>Clear session key</Button> : <a href={provider === "typesafe" ? "https://docs.typesafe.ai/api" : "https://platform.openai.com/api-keys"} target="_blank" rel="noreferrer">Get an API key <ArrowUpRight size={12} /></a>}</div>
        </form> : null}
        {keyNotice ? <p className="key-notice" role="status">{keyNotice}</p> : null}
      </div>
      <input ref={input} type="file" className="sr-only" accept=".pdf,.png,.jpg,.jpeg" aria-label="Choose a document" disabled={busy} onChange={(event) => selectFile(event.target.files)} />
      {state.status !== "complete" ? (
        <>
          <div className={cn("upload-card", dragging && "is-dragging", file && "has-file")} onDragOver={(event) => { event.preventDefault(); if (!busy) setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={drop}>
            {!file ? (
              <div className="upload-empty">
                <Upload className="upload-symbol" size={23} strokeWidth={1.3} aria-hidden="true" />
                <p>Drop a document here</p>
                <Button size="lg" onClick={() => input.current?.click()}>Choose file <Plus size={15} /></Button>
                <span className="file-hint">PDF, PNG or JPEG <span>·</span> Up to 20 MB</span>
              </div>
            ) : (
              <div className="upload-selected">
                <div className="selected-file"><span className="file-icon"><FileText size={24} strokeWidth={1.4} /></span><div><strong>{file.name}</strong><span>{file.name.split('.').pop()?.toUpperCase()} <span>·</span> {formatSize(file.size)}</span></div><Button variant="ghost" size="icon" aria-label="Remove document" disabled={busy} onClick={reset}><X size={17} /></Button></div>
                <Button className="check-button" size="lg" disabled={busy} onClick={check}>{busy ? <><LoaderCircle size={15} className="animate-spin" />Checking document…</> : <>Check document <ArrowRight size={15} /></>}</Button>
              </div>
            )}
          </div>
          {error ? <div className="error-message" role="alert"><TriangleAlert size={16} /><span>{error}</span></div> : null}
          <p className="screening-note">PDF, PNG or JPEG · First 10 pages reviewed</p>
        </>
      ) : <ReviewResult result={state.result} fileName={file?.name ?? "Document"} onReset={reset} />}
    </section>
  );
}

function ReviewResult({ result, fileName, onReset }: { result: Review; fileName: string; onReset: () => void }) {
  const { report } = result;
  const flagged = report.reviewReasons.length;
  const otherSignals = report.signals.filter((signal) => signal.confidence < report.threshold);
  function download() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ ...result, fileName }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${fileName}.review.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="result" aria-live="polite">
      <p className="report-provider">{PROVIDER_NAMES[report.provider]} · {report.model}</p>
      <div className="result-file"><FileText size={15} /><span>{fileName}</span><span className="page-count">{report.pagesChecked} {report.pagesChecked === 1 ? "page" : "pages"}</span></div>
      <div className="reliability-score"><span>Reliability</span><strong>{report.reliability.score.toFixed(2)} <span>/ {report.reliability.maxScore}</span></strong><small>Model rubric score · Higher means fewer observed concerns</small></div>
      <div className="verdict">
        <h1 id="main-heading">{flagged ? `${flagged} ${flagged === 1 ? "signal" : "signals"} to review.` : "No strong signals found."}</h1>
        <p>{flagged ? "A few details worth a closer look." : "None of the checks reached the review threshold."}</p>
      </div>
      {flagged ? <>
        <div className="signal-header"><span>For review</span><span>Confidence</span></div>
        <div className="signal-list">{report.reviewReasons.map((signal, index) => <SignalRow key={signal.key} signal={signal} threshold={report.threshold} delay={index * 45} />)}</div>
      </> : null}
      {otherSignals.length ? <details className="other-checks"><summary>{otherSignals.length} other {otherSignals.length === 1 ? "check" : "checks"}<ChevronDown size={13} className="disclosure-chevron" /></summary><div className="signal-list">{otherSignals.map((signal) => <SignalRow key={signal.key} signal={signal} threshold={report.threshold} />)}</div></details> : null}
      {report.totalPages > report.pagesChecked ? <p className="screening-note">Only the first {report.pagesChecked} of {report.totalPages} pages were reviewed.</p> : null}
      <details className="technical-details"><summary>Document details <ChevronDown size={14} /></summary><pre>{JSON.stringify({ metadata: result.metadata, analysis: result.analysis }, null, 2)}</pre></details>
      <p className="result-note">A model assessment, not proof of authenticity or AI origin.</p>
      <div className="result-actions"><Button variant="outline" onClick={onReset}>Check another <Plus size={14} /></Button><Button variant="ghost" onClick={download}><Download size={14} />Export report</Button></div>
    </div>
  );
}

const CATEGORY_LABELS = { tampering: "Tampering evidence", consistency: "Content consistency", provenance: "Origin and editing context", quality: "Readability and completeness" };

function SignalRow({ signal, threshold, delay = 0 }: { signal: FraudReason; threshold: number; delay?: number }) {
  const flagged = signal.confidence >= threshold;
  return (
    <details className={cn("signal", flagged && "signal-flagged")} style={{ animationDelay: `${delay}ms` }}>
      <summary>
        <span className="signal-status">{flagged ? <TriangleAlert size={13} /> : <Check size={13} />}</span>
        <span className="signal-name">{signal.label}<span className="signal-category">{CATEGORY_LABELS[signal.category]}</span></span>
        <span className="signal-confidence">{Math.round(signal.confidence * 100)}%</span>
        <ChevronDown size={13} className="disclosure-chevron" />
      </summary>
      <div className="signal-detail"><p>{signal.question}</p><p className="signal-explanation">{flagged ? "Above" : "Below"} the {Math.round(threshold * 100)}% review threshold. Model probability that this condition is present, not the probability of fraud.</p></div>
    </details>
  );
}

function formatSize(bytes: number) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

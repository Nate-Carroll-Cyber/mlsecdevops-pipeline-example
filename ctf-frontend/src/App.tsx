/**
 * Standalone Sam Spade CTF frontend.
 *
 * This is the noir "Case 067" elicitation surface, extracted from the main
 * Counter-Spy app into its own container. All gameplay goes through the
 * Counter-Spy gateway -> Sam Spade service (governed sanitize + safeguard +
 * responder); intercepted turns are masked as "Bad content." Each turn's review
 * artifact is pushed to the gateway so the main Counter-Spy frontend keeps
 * surfacing CTF activity in its Audit/Metrics views.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Lock, Search, ShieldAlert, Unlock } from 'lucide-react';
import {
  createSession,
  getPlayerId,
  getSession,
  getStoredSessionId,
  postReviewArtifact,
  sendMessage,
  setStoredSessionId,
  solveCase,
  type SamSpadeMessage,
  type SamSpadeReviewArtifact,
  type SamSpadeSession,
} from './lib/api.ts';

const BLOCKED_CONTENT_LABEL = 'Bad content.';

type Status = 'idle' | 'connecting' | 'ready' | 'sending' | 'error';

function isReviewBlocked(review: SamSpadeReviewArtifact): boolean {
  return review.status === 'PENDING_REVIEW' || review.escalationRecommended || review.detectionLevel === 'Suspicious' || review.detectionLevel === 'Adversarial';
}

export function App() {
  const playerId = useRef<string>(getPlayerId());
  const sessionPromiseRef = useRef<Promise<SamSpadeSession> | null>(null);
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  const [session, setSession] = useState<SamSpadeSession | null>(null);
  const [status, setStatus] = useState<Status>('idle');
  const [errorText, setErrorText] = useState<string | null>(null);
  const [input, setInput] = useState('');
  const [theory, setTheory] = useState('');
  const [inputAlert, setInputAlert] = useState(false);
  const [blockedNotice, setBlockedNotice] = useState<{ prompt: string } | null>(null);

  const caseSolved = session?.status === 'SOLVED';
  const visibleMessages: SamSpadeMessage[] = (session?.messages ?? []).filter((m) => m.reviewDisposition === 'clean');

  const ensureSession = useCallback(async (): Promise<SamSpadeSession> => {
    if (session) return session;
    if (sessionPromiseRef.current) return sessionPromiseRef.current;
    setStatus('connecting');
    setErrorText(null);
    const promise = (async () => {
      const stored = getStoredSessionId();
      if (stored) {
        try {
          const resumed = await getSession(stored, playerId.current);
          return resumed;
        } catch {
          setStoredSessionId(null);
        }
      }
      const created = await createSession(playerId.current);
      setStoredSessionId(created.sessionId);
      return created;
    })()
      .then((s) => { setSession(s); setStatus('ready'); return s; })
      .catch((e: unknown) => { setStatus('error'); setErrorText(e instanceof Error ? e.message : 'Failed to reach the Counter-Spy backend.'); throw e; })
      .finally(() => { sessionPromiseRef.current = null; });
    sessionPromiseRef.current = promise;
    return promise;
  }, [session]);

  useEffect(() => { void ensureSession().catch(() => undefined); }, [ensureSession]);
  useEffect(() => { transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [visibleMessages.length]);

  async function handleAsk(e?: React.FormEvent) {
    e?.preventDefault();
    const prompt = input.trim();
    if (!prompt || status === 'sending') return;
    setStatus('sending');
    setErrorText(null);
    setInputAlert(false);
    try {
      const active = await ensureSession();
      const { session: next, review } = await sendMessage(active.sessionId, prompt, playerId.current);
      setSession(next);
      setStoredSessionId(next.sessionId);
      void postReviewArtifact(review, playerId.current);
      if (isReviewBlocked(review)) {
        setInputAlert(true);
        setBlockedNotice({ prompt });
        setInput('');
      } else {
        setInput('');
      }
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'The question could not be sent.');
    } finally {
      setStatus((s) => (s === 'sending' ? 'ready' : s));
    }
  }

  async function handleSolve(e?: React.FormEvent) {
    e?.preventDefault();
    const submitted = theory.trim();
    if (!submitted || status === 'sending') return;
    setStatus('sending');
    setErrorText(null);
    try {
      const active = await ensureSession();
      const { session: next, review } = await solveCase(active.sessionId, submitted, playerId.current);
      setSession(next);
      setStoredSessionId(next.sessionId);
      void postReviewArtifact(review, playerId.current);
      if (isReviewBlocked(review)) {
        setBlockedNotice({ prompt: submitted });
      }
      setTheory('');
    } catch (err) {
      setErrorText(err instanceof Error ? err.message : 'The theory could not be submitted.');
    } finally {
      setStatus((s) => (s === 'sending' ? 'ready' : s));
    }
  }

  const busy = status === 'sending';

  return (
    <div className="relative min-h-screen overflow-hidden text-slate-200">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(20,20,20,0)_0%,rgba(0,0,0,0.85)_100%)]" />
      <div className="relative flex min-h-screen flex-col items-center p-4 md:p-8">
        <header className="z-10 mb-8 flex w-full max-w-4xl items-center justify-between">
          <div className="flex items-center gap-2">
            {caseSolved ? <Unlock className="h-5 w-5 text-green-500" /> : <Lock className="h-5 w-5 text-amber-400" />}
            <span className={`font-mono text-xs uppercase tracking-[0.22em] ${caseSolved ? 'text-green-400' : 'text-amber-300'}`}>
              {caseSolved ? 'Case Solved' : 'Case Pending'}
            </span>
          </div>
          <h2 className="text-center font-serif text-3xl uppercase tracking-[0.22em] text-[#f5f2ed] md:text-4xl">Sam Spade, P.I.</h2>
          <span className="font-mono text-[11px] uppercase tracking-[0.18em] text-slate-600">Counter-Spy.ai CTF</span>
        </header>

        <main className={`z-10 flex w-full max-w-4xl flex-1 min-h-0 flex-col gap-8 overflow-hidden rounded-lg border bg-[#0a0a0a]/80 p-4 shadow-2xl backdrop-blur-sm md:flex-row md:p-6 ${caseSolved ? 'border-green-500/40' : 'border-amber-500/30'}`}>
          <aside className="flex w-full min-h-0 flex-col space-y-4 overflow-y-auto pr-2 md:w-1/3">
            <div className="relative flex aspect-[3/4] w-full items-end overflow-hidden rounded border border-slate-800 bg-[radial-gradient(circle_at_50%_25%,rgba(120,120,120,0.18),rgba(6,6,6,0.95)_60%)]">
              <div className="absolute inset-0 shadow-[inset_0_0_120px_rgba(0,0,0,0.95)]" />
              <div className="absolute left-0 right-0 top-1/3 mx-auto h-px w-1/2 bg-amber-500/20" />
              <div className="relative w-full p-4">
                <p className="font-serif text-2xl uppercase tracking-[0.28em] text-[#f5f2ed]">Spade</p>
                <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.3em] text-slate-500">Private Investigations</p>
              </div>
            </div>

            <div className="border-t border-slate-800 pt-4 text-sm text-slate-500">
              <h3 className="mb-2 font-serif text-xl text-slate-300">The Objective</h3>
              <div className="mb-4 space-y-1 leading-5">
                <p>You are a journalist meeting a private detective. Your goal is to elicit hidden information about his recent case.</p>
                <p>Good luck...</p>
              </div>
              <div className="space-y-1">
                <p className="italic text-slate-400">Rules of Engagement:</p>
                <ul className="list-disc space-y-1 pl-4 text-xs italic opacity-80">
                  <li>Direct questions usually fail.</li>
                  <li>Emotional intelligence and inference are rewarded.</li>
                  <li>Advance by reconstructing motive, risk, and contradiction.</li>
                  <li>The final secret must feel earned.</li>
                </ul>
              </div>
            </div>

            <div className="mt-auto rounded border border-slate-800 bg-black/40 p-4">
              <h3 className="mb-2 font-serif text-sm uppercase tracking-[0.22em] text-slate-300">Submit Solution</h3>
              <form onSubmit={handleSolve} className="flex flex-col space-y-3">
                <input
                  value={theory}
                  onChange={(e) => setTheory(e.target.value)}
                  placeholder="What's the scoop?"
                  className="w-full rounded-none border-0 border-b border-slate-700 bg-transparent px-2 py-2 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none"
                  disabled={busy}
                />
                <button type="submit" disabled={!theory.trim() || busy} className="w-full rounded-none border border-slate-700 bg-transparent px-3 py-2 font-mono text-xs uppercase tracking-[0.2em] text-slate-400 transition-colors hover:text-slate-200 disabled:opacity-40">
                  Solve the Case
                </button>
              </form>
            </div>
          </aside>

          <section className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <div className="mb-4 border-b border-slate-800 pb-4">
              <p className="font-serif text-2xl uppercase tracking-[0.22em] text-[#f5f2ed] md:text-3xl">Case 067</p>
              <p className="mt-2 font-mono text-xs uppercase tracking-[0.22em] text-slate-500">A film noir capture the flag experience</p>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto pr-2">
              <div className="space-y-6">
                {visibleMessages.map((message) => (
                  <div key={message.id} className={`flex ${message.role === 'player' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[85%] rounded-2xl border p-5 ${
                      message.role === 'player' ? 'border-amber-500/20 bg-amber-500/5'
                        : message.role === 'system' ? 'border-red-500/20 bg-red-500/5'
                        : 'border-slate-800 bg-slate-900/40'
                    }`}>
                      <div className="mb-3 flex items-center gap-2">
                        <Search className="h-3.5 w-3.5 text-slate-300" />
                        <span className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                          {message.role === 'player' ? 'Journalist' : message.role === 'system' ? 'Counter-Spy Review' : 'Sam Spade'}
                        </span>
                      </div>
                      <p className="text-sm leading-7 text-slate-200">{message.text}</p>
                    </div>
                  </div>
                ))}

                {visibleMessages.length === 0 && (
                  <div className="flex justify-center py-10 text-center opacity-55">
                    <div className="space-y-3">
                      <p className="font-mono text-xs uppercase tracking-[0.22em] text-slate-500">Interrogation Interface</p>
                      <p className="text-sm text-slate-400">
                        {status === 'connecting' ? 'Opening the case file...' : status === 'error' ? (errorText ?? 'Could not reach Counter-Spy.') : 'Questions route through Counter-Spy governance before Sam Spade answers.'}
                      </p>
                    </div>
                  </div>
                )}
                <div ref={transcriptEndRef} />
              </div>
            </div>

            <div className="mt-4 border-t border-slate-800 pt-4">
              <form onSubmit={handleAsk} className="space-y-2">
                <div className="flex items-end gap-3">
                  <input
                    value={input}
                    onChange={(e) => { setInput(e.target.value); if (inputAlert) setInputAlert(false); }}
                    placeholder="Try your angle, sweetheart..."
                    className={`h-12 flex-1 rounded-xl border px-4 text-sm placeholder:text-slate-600 focus:outline-none ${inputAlert ? 'border-red-500 bg-red-950/20 text-red-100' : 'border-slate-800 bg-slate-900/40 text-slate-200'}`}
                    disabled={busy}
                  />
                  <button type="submit" disabled={busy || !input.trim()} className="h-12 rounded-xl bg-slate-100 px-8 font-medium text-slate-900 transition-colors hover:bg-white disabled:opacity-40">
                    {busy ? 'Sending...' : 'Ask a Question'}
                  </button>
                </div>
                <p className="text-xs text-slate-500">
                  Prompts are sent to the Counter-Spy gateway -&gt; Sam Spade service first; intercepted turns are masked and queued for analyst review.
                </p>
                {errorText && status !== 'connecting' && (
                  <p className="text-xs text-red-400">{errorText}</p>
                )}
                {inputAlert && (
                  <div className="flex items-start gap-2 rounded-lg border border-red-500/40 bg-red-950/30 p-3 text-red-100">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-300" />
                    <div>
                      <p className="text-sm font-medium text-red-200">Unapproved Content Detected</p>
                      <p className="text-xs text-red-100/90">This question was intercepted before it could be approved for gameplay. Revise the prompt and try again.</p>
                    </div>
                  </div>
                )}
              </form>
            </div>
          </section>
        </main>
      </div>

      {blockedNotice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-xl border border-red-500/30 bg-[#120909] p-6 text-slate-100 shadow-2xl">
            <div className="mb-2 flex items-center gap-2 text-red-300">
              <ShieldAlert className="h-5 w-5" />
              <h3 className="text-lg font-semibold">Unapproved Content Detected</h3>
            </div>
            <p className="mb-4 text-sm text-slate-400">Counter-Spy intercepted this Sam Spade submission before it could be approved for gameplay.</p>
            <div className="mb-4 rounded-lg border border-red-500/20 bg-black/30 p-3">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-[0.2em] text-red-300">Submitted Prompt</p>
              <p className="text-sm text-slate-200">{blockedNotice.prompt}</p>
            </div>
            <div className="flex justify-end">
              <button onClick={() => setBlockedNotice(null)} className="rounded-md bg-red-600 px-4 py-2 text-sm text-white transition-colors hover:bg-red-500">Revise Prompt</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabaseClient";

/* category display meta (pay/est/answers all live in the DB) */
const CAT = {
  stocks:  { label: "Market sentiment",    tint: "#4ade80" },
  pref:    { label: "AI response quality",  tint: "#fcd34d" },
  scale:   { label: "AI naturalness",       tint: "#a78bfa" },
  vision:  { label: "Image labeling",       tint: "#7dd3fc" },
  fashion: { label: "Product & style",      tint: "#f0abfc" },
};
const shuffle = (a) => [...a].sort(() => Math.random() - 0.5);

/* ================================================================== */
export default function App() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [settings, setSettings] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [view, setView] = useState("earner");
  const [work, setWork] = useState(null);
  const [toast, setToast] = useState(null);
  const [ready, setReady] = useState(false);

  const flash = (msg, tint) => { setToast({ msg, tint }); setTimeout(() => setToast(null), 2400); };

  const loadProfile = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("*").eq("id", session.user.id).single();
    setProfile(data);
  }, [session]);

  const loadCommon = useCallback(async () => {
    const [{ data: s }, { data: t }] = await Promise.all([
      supabase.from("platform_settings").select("*").eq("id", 1).single(),
      supabase.from("public_tasks").select("*"),
    ]);
    setSettings(s); setTasks(t || []);
  }, []);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); return; }
    loadProfile(); loadCommon();
  }, [session, loadProfile, loadCommon]);

  const signOut = async () => { await supabase.auth.signOut(); setView("earner"); setWork(null); };

  if (!ready) return <div className="nx-root"><Style /></div>;

  return (
    <div className="nx-root">
      <Style />
      <header className="nx-nav">
        <div className="nx-brand"><span className="nx-logo">N</span>
          <span className="nx-word">Nex<span className="nx-aurora-text">ora</span></span></div>
        {session && profile && (
          <div className="nx-navright">
            <div className="nx-roleswitch">
              <button className={view === "earner" ? "on" : ""} onClick={() => setView("earner")}>Earner</button>
              {profile.role === "operator" &&
                <button className={view === "operator" ? "on" : ""} onClick={() => setView("operator")}>Operator</button>}
            </div>
            <button className="nx-signout" onClick={signOut}>Sign out</button>
          </div>
        )}
      </header>

      {!session ? (
        <Auth flash={flash} />
      ) : !profile || !settings ? (
        <main className="nx-main"><p style={{ color: "#8792a6" }}>Loading…</p></main>
      ) : view === "operator" && profile.role === "operator" ? (
        <Operator {...{ settings, reloadSettings: loadCommon, flash }} />
      ) : (
        <Earner {...{ profile, settings, tasks, work, setWork, reloadProfile: loadProfile, flash }} />
      )}

      {toast && (<div className="nx-toast" style={{ borderColor: toast.tint }}>
        <span className="nx-toast-dot" style={{ background: toast.tint }} />{toast.msg}</div>)}
    </div>
  );
}

/* ============================ AUTH (real magic link) ============= */
function Auth({ flash }) {
  const [mode, setMode] = useState("signin");
  const [step, setStep] = useState("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = /\S+@\S+\.\S+/.test(email);
  const validCode = /^\d{6}$/.test(code);

  const send = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email, options: { emailRedirectTo: window.location.origin },
    });
    setBusy(false);
    if (error) return flash(error.message, "#f87171");
    setStep("sent");
  };

  const verify = async () => {
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: "email" });
    setBusy(false);
    if (error) return flash(error.message, "#f87171");
  };

  return (
    <main className="nx-main">
      <div className="nx-auth">
        <div className="nx-auth-badge">🔗</div>
        {step === "email" ? (
          <>
            <h2>{mode === "signup" ? "Create your Nexora account" : "Log in to Nexora"}</h2>
            <p>We'll email you a secure link — tap it and you're in. No passwords.</p>
            <input className="nx-gate-input" type="email" placeholder="you@email.com" value={email}
              onChange={(e) => setEmail(e.target.value)} onKeyDown={(e) => e.key === "Enter" && valid && send()} />
            <button className="nx-submit" style={{ width: "100%" }} disabled={!valid || busy} onClick={send}>
              {busy ? "Sending…" : "Send my login link"}
            </button>
            {mode === "signup" && <p className="nx-auth-kyc">New accounts complete a quick photo-ID check before their first withdrawal — no SSN typed or stored.</p>}
            <p className="nx-auth-switch">
              {mode === "signup" ? "Already have an account? " : "New here? "}
              <button onClick={() => setMode(mode === "signup" ? "signin" : "signup")}>{mode === "signup" ? "Log in" : "Create account"}</button>
            </p>
          </>
        ) : (
          <>
            <h2>Check your email</h2>
            <p>We sent a link and a 6-digit code to <b>{email}</b>. Tap the link, or enter the code below if the link doesn't sign you in (this can happen with some email providers that prescan links).</p>
            <input className="nx-gate-input" type="text" inputMode="numeric" maxLength={6} placeholder="123456" value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} onKeyDown={(e) => e.key === "Enter" && validCode && verify()} />
            <button className="nx-submit" style={{ width: "100%" }} disabled={!validCode || busy} onClick={verify}>
              {busy ? "Verifying…" : "Verify code"}
            </button>
            <button className="nx-linkbtn" onClick={() => { setStep("email"); setCode(""); }}>Use a different email</button>
          </>
        )}
      </div>
    </main>
  );
}

/* ============================ KYC (provider handoff) ============ */
function Kyc({ onDone, onClose }) {
  const [state, setState] = useState("intro");
  const run = async () => {
    setState("checking");
    // In production the licensed provider (Stripe Identity / Persona) runs the
    // real ID + selfie check, then their webhook flips `verified` server-side.
    await new Promise((r) => setTimeout(r, 1500));
    await supabase.rpc("mark_verified");
    setState("done");
  };
  return (
    <div className="nx-scrim" onClick={onClose}>
      <div className="nx-modal" onClick={(e) => e.stopPropagation()}>
        {state === "intro" && (<>
          <h3>Verify your identity</h3>
          <p className="nx-modal-prompt">To keep Nexora free of fake and duplicate accounts, verify with a government photo ID before your first payout.</p>
          <div className="nx-kyc-steps">
            <div><span>1</span> Photograph your driver's license or passport</div>
            <div><span>2</span> Take a quick selfie to match the photo</div>
            <div><span>3</span> Get verified in under a minute</div>
          </div>
          <div className="nx-kyc-secure">🔒 Handled by a licensed verification provider (e.g. Stripe Identity / Persona). Nexora receives only a “verified: yes / no” result — your ID document and its numbers are never stored on Nexora's servers.</div>
          <div className="nx-modal-actions">
            <button className="nx-ghost" onClick={onClose}>Later</button>
            <button className="nx-submit" onClick={run}>Start verification</button>
          </div>
        </>)}
        {state === "checking" && <div className="nx-kyc-load"><div className="nx-spinner" /><p>Verifying your ID…</p></div>}
        {state === "done" && (<div className="nx-kyc-done">
          <div className="nx-kyc-check">✓</div><h3>You're verified</h3>
          <p className="nx-modal-prompt">Withdrawals are now unlocked. Welcome to Nexora.</p>
          <button className="nx-submit" style={{ width: "100%" }} onClick={() => { onDone(); onClose(); }}>Done</button>
        </div>)}
      </div>
    </div>
  );
}

/* ============================ EARNER ============================= */
function Earner({ profile, settings, tasks, work, setWork, reloadProfile, flash }) {
  const blocked = settings.global_paused || profile.paused;

  if (blocked) {
    const r = settings.global_paused
      ? ["Nexora is paused for maintenance", "No tasks are available right now. Your balance is safe — check back shortly."]
      : ["Your account is under review", "Task access is paused while we verify recent activity. Nothing you've earned is affected."];
    return (<main className="nx-main"><Hero {...{ profile, settings, reloadProfile, flash }} />
      <div className="nx-empty stern"><div className="nx-empty-icon">❚❚</div><h3>{r[0]}</h3><p>{r[1]}</p></div></main>);
  }
  if (profile.week_earned >= settings.weekly_cap) {
    return (<main className="nx-main"><Hero {...{ profile, settings, reloadProfile, flash }} />
      <div className="nx-empty done"><div className="nx-empty-icon">✓</div>
        <h3>Weekly limit reached — great week</h3>
        <p>You've earned ${Number(profile.week_earned).toFixed(2)} of the ${settings.weekly_cap} weekly maximum. Task access resets at the start of next week.</p>
      </div></main>);
  }
  if (work) return <Session {...{ cat: work, tasks, settings, profile, onExit: () => setWork(null), reloadProfile, flash }} />;

  const cats = [...new Set(tasks.map((t) => t.category))];
  return (
    <main className="nx-main">
      <Hero {...{ profile, settings, reloadProfile, flash }} />
      <div className="nx-tabs"><button className="on">Task queues</button></div>
      <div className="nx-grid">
        {cats.map((k) => {
          const c = CAT[k] || { label: k, tint: "#7dd3fc" };
          const pool = tasks.filter((t) => t.category === k);
          const per = pool[0]?.pay ?? 0;
          return (
            <button key={k} className="nx-card" onClick={() => setWork(k)}>
              <div className="nx-card-top">
                <span className="nx-chip" style={{ color: c.tint, borderColor: c.tint + "55" }}>{c.label}</span>
                <span className="nx-pay">${Number(per).toFixed(2)}<i>/item</i></span>
              </div>
              <h4>{pool.length} live tasks</h4>
              <p>Graded instantly and paid on results. Work through the queue — it keeps cycling.</p>
              <div className="nx-card-foot"><span className="nx-pool">{c.label}</span><span className="nx-start">Start →</span></div>
            </button>
          );
        })}
      </div>
    </main>
  );
}

function Hero({ profile, settings, reloadProfile, flash }) {
  const [kyc, setKyc] = useState(false);
  const cap = Number(settings.weekly_cap);
  const week = Number(profile.week_earned);
  const pct = Math.min(100, (week / cap) * 100);
  return (
    <section className="nx-hero">
      <div className="nx-aurora" />
      <div className="nx-hero-inner">
        <div className="nx-hero-grid">
          <div>
            <p className="nx-eyebrow">Available balance</p>
            <Balance value={Number(profile.balance)} />
            <div className="nx-hero-stats">
              <Stat k="Withdrawable" v={profile.hold ? "On hold" : `$${Number(profile.balance).toFixed(2)}`} />
              <Stat k="This week" v={`$${week.toFixed(2)}`} />
            </div>
            <div className="nx-verifline">
              <span className={"nx-vchip " + (profile.verified ? "ok" : "no")}>
                {profile.verified ? "✓ Identity verified" : "◻ Identity unverified"}</span>
            </div>
            <button className="nx-withdraw" onClick={profile.verified
              ? () => alert("Cash-out ready — $20 minimum.\n\nWire your payment processor (Stripe / Wise) here to send money to the earner.")
              : () => setKyc(true)}>
              {profile.verified ? "Withdraw funds" : "Verify to withdraw"}
            </button>
            {kyc && <Kyc onClose={() => setKyc(false)} onDone={() => { reloadProfile(); flash("Identity verified.", "#4ade80"); }} />}
          </div>
          <div className="nx-today">
            <div className="nx-today-head"><span>This week's earnings</span>
              {week >= cap && <span className="nx-goaltag">Cap reached</span>}</div>
            <div className="nx-today-amt"><b>${week.toFixed(2)}</b><i> / ${cap} weekly max</i></div>
            <div className="nx-today-track"><div className="nx-today-fill" style={{ width: `${pct}%` }} /></div>
            <div className="nx-today-foot">
              <small>Weekly max ${cap}. Balance persists across sessions and devices.</small>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

const Stat = ({ k, v }) => <div className="nx-stat"><span className="nx-stat-v">{v}</span><span className="nx-stat-k">{k}</span></div>;

function Balance({ value }) {
  const [shown, setShown] = useState(value); const from = useRef(value);
  useEffect(() => {
    const start = performance.now(), a = from.current, b = value, dur = 650; let raf;
    const step = (n) => { const p = Math.min(1, (n - start) / dur), e = 1 - Math.pow(1 - p, 3);
      setShown(a + (b - a) * e); if (p < 1) raf = requestAnimationFrame(step); else from.current = b; };
    raf = requestAnimationFrame(step); return () => cancelAnimationFrame(raf);
  }, [value]);
  return (<div className="nx-balance"><span className="nx-cur">$</span>
    <span className="nx-num">{shown.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
    <span className="nx-usd">USD</span></div>);
}

/* ============================ SESSION =========================== */
function Session({ cat, tasks, settings, profile, onExit, reloadProfile, flash }) {
  const c = CAT[cat] || { label: cat, tint: "#7dd3fc" };
  const [queue, setQueue] = useState(() => shuffle(tasks.filter((t) => t.category === cat)));
  const [idx, setIdx] = useState(0);
  const [sel, setSel] = useState(null);
  const [phase, setPhase] = useState("answer");
  const [result, setResult] = useState(null);
  const [earned, setEarned] = useState(0);

  const item = queue[idx];
  const isMulti = () => item && Array.isArray(item.options) && cat === "vision";
  const multi = isMulti();
  useEffect(() => { setSel(multi ? [] : null); setPhase("answer"); setResult(null); }, [idx]);

  if (!item) return (<main className="nx-main"><p style={{ color: "#8792a6" }}>No tasks in this queue yet.</p>
    <button className="nx-back" onClick={onExit}>← Queues</button></main>);

  const ready = multi ? sel && sel.length > 0 : sel !== null;
  const choose = (o) => multi ? setSel((s) => s.includes(o) ? s.filter((x) => x !== o) : [...s, o]) : setSel(o);

  const submit = async () => {
    setPhase("grading");
    const { data, error } = await supabase.rpc("submit_answer", {
      p_template_id: item.id, p_answer: multi ? sel : sel,
    });
    if (error) { setPhase("answer"); return flash(error.message, "#f87171"); }
    setResult(data); setPhase("result");
    setEarned((e) => +(e + Number(data.award)).toFixed(2));
    reloadProfile();
    if (Number(data.week_earned) >= Number(settings.weekly_cap)) flash("Weekly cap reached.", "#4ade80");
  };
  const next = () => {
    if (Number(result?.week_earned) >= Number(settings.weekly_cap)) { onExit(); return; }
    if (idx + 1 >= queue.length) { setQueue(shuffle(queue)); setIdx(0); flash("Queue cycled.", c.tint); }
    else setIdx(idx + 1);
  };

  const vColor = result ? ({ correct: "#4ade80", partial: "#fbbf24", incorrect: "#f87171" }[result.verdict]) : c.tint;
  return (
    <main className="nx-main">
      <div className="nx-sess-top">
        <button className="nx-back" onClick={onExit}>← Queues</button>
        <span className="nx-chip" style={{ color: c.tint, borderColor: c.tint + "55" }}>{c.label}</span>
        <span className="nx-sess-earned">Week <b style={{ color: "#4ade80" }}>${Number(profile.week_earned).toFixed(2)}</b><i> / ${settings.weekly_cap}</i></span>
      </div>
      <div className="nx-prog"><div className="nx-prog-bar" style={{ width: `${(idx / queue.length) * 100}%`, background: c.tint }} /></div>
      <p className="nx-prog-label">Task {idx + 1} of {queue.length} · this batch +${earned.toFixed(2)}</p>
      <div className="nx-work">
        <div className="nx-work-top"><h3>{item.prompt}</h3><span className="nx-pay big">${Number(item.pay).toFixed(2)}</span></div>
        <div className="nx-modal-body">{item.body}</div>
        <div className={"nx-opts" + (cat === "scale" ? " scale" : "")}>
          {item.options.map((o) => {
            const on = multi ? sel?.includes(o) : sel === o; const dim = phase !== "answer";
            return (<button key={o} className={"nx-opt" + (on ? " on" : "")} disabled={dim}
              style={on ? { borderColor: c.tint, color: c.tint } : undefined} onClick={() => choose(o)}>{o}</button>);
          })}
        </div>
        {phase === "result" && (
          <div className="nx-verdict" style={{ borderColor: vColor }}>
            <div className="nx-verdict-row">
              <span className="nx-verdict-tag" style={{ background: vColor }}>
                {result.verdict === "correct" ? "Correct" : result.verdict === "partial" ? "Partial" : "Incorrect"}</span>
              <span className="nx-verdict-fb">{result.verdict === "correct" ? "Nice — full credit." : result.verdict === "partial" ? "Close — half credit." : "Not quite this time."}</span>
              <span className="nx-verdict-amt" style={{ color: Number(result.award) > 0 ? "#4ade80" : "#8792a6" }}>
                {Number(result.award) > 0 ? `+$${Number(result.award).toFixed(2)}` : "$0.00"}</span>
            </div>
            <span className="nx-verdict-by">graded server-side</span>
          </div>
        )}
        <div className="nx-modal-actions">
          {phase !== "result"
            ? <button className="nx-submit" disabled={!ready || phase === "grading"} onClick={submit}>{phase === "grading" ? "Grading…" : "Submit for grading"}</button>
            : <button className="nx-submit" onClick={next}>Next task →</button>}
        </div>
      </div>
    </main>
  );
}

/* ============================ OPERATOR ========================== */
function Operator({ settings, reloadSettings, flash }) {
  const [users, setUsers] = useState([]);
  const load = useCallback(async () => {
    const { data } = await supabase.from("profiles").select("*").order("created_at");
    setUsers(data || []);
  }, []);
  useEffect(() => { load(); }, [load]);

  const toggleGlobal = async () => {
    const { error } = await supabase.from("platform_settings").update({ global_paused: !settings.global_paused, updated_at: new Date().toISOString() }).eq("id", 1);
    if (error) return flash(error.message, "#f87171");
    reloadSettings();
  };
  const toggleField = async (u, field) => {
    const { error } = await supabase.from("profiles").update({ [field]: !u[field] }).eq("id", u.id);
    if (error) return flash(error.message, "#f87171");
    load();
  };

  const owed = users.reduce((s, u) => s + Number(u.balance), 0);
  const active = users.filter((u) => !u.paused).length;
  return (
    <main className="nx-main">
      <div className="nx-op-head">
        <div><h2>Operator console</h2>
          <p>Live platform controls. These run against the database with row-level security — only your operator account can execute them, even if someone edits the page.</p></div>
      </div>
      <div className="nx-metrics">
        <Metric k="Accounts" v={users.length} />
        <Metric k="Active" v={active} />
        <Metric k="Weekly cap" v={`$${settings.weekly_cap}`} />
        <Metric k="Payouts owed" v={`$${owed.toLocaleString(undefined, { minimumFractionDigits: 2 })}`} accent />
      </div>
      <section className={"nx-killcard" + (settings.global_paused ? " armed" : "")}>
        <div><h3>Global kill switch</h3>
          <p>{settings.global_paused ? "Platform is PAUSED. Every earner sees an honest maintenance notice; submit_answer() refuses to run."
            : "Platform is live. Flip this to freeze all task access instantly across every account."}</p></div>
        <button className={"nx-kill" + (settings.global_paused ? " armed" : "")} onClick={toggleGlobal}>
          {settings.global_paused ? "Resume platform" : "Pause everything"}</button>
      </section>
      <section className="nx-panel">
        <div className="nx-panel-head"><h3>Earners</h3></div>
        <div className="nx-table">
          <div className="nx-tr nx-th"><span>Account</span><span>Balance</span><span>Status</span><span>Payout</span><span>Controls</span></div>
          {users.map((u) => (
            <div className="nx-tr" key={u.id}>
              <span className="nx-tname">{u.email || u.id.slice(0, 8)}{u.role === "operator" && " ·op"}</span>
              <span className="nx-mono">${Number(u.balance).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
              <span><i className={"nx-badge " + (u.paused ? "red" : "green")}>{u.paused ? "Paused" : "Active"}</i></span>
              <span><i className={"nx-badge " + (u.hold ? "amber" : "ghost")}>{u.hold ? "On hold" : "Clear"}</i></span>
              <span className="nx-rowbtns">
                <button className="nx-mini" onClick={() => toggleField(u, "paused")}>{u.paused ? "Resume" : "Pause"}</button>
                <button className="nx-mini ghost" onClick={() => toggleField(u, "hold")}>{u.hold ? "Release" : "Hold pay"}</button>
              </span>
            </div>
          ))}
        </div>
        <p className="nx-note secure">🔒 Enforced server-side: balances only change through submit_answer(), the answer key is never sent to browsers, and these controls require your operator role in the database.</p>
      </section>
    </main>
  );
}
const Metric = ({ k, v, accent }) => (
  <div className={"nx-metric" + (accent ? " accent" : "")}><span className="nx-metric-v">{v}</span><span className="nx-metric-k">{k}</span></div>
);

/* styles are imported globally in main.jsx; this stub keeps <Style/> harmless */
function Style() { return null; }

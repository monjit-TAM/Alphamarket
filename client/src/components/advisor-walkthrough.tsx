import { useEffect, useRef, useState, useCallback } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "wouter";
import { useAuth } from "@/lib/auth";

const WT_DONE_KEY    = (id: string) => `am_wt_done_${id}`;
const WT_LOGIN_KEY   = (id: string) => `am_wt_logins_${id}`;

const STEPS = [
  {
    path: "/dashboard/profile",
    selector: '[data-testid="input-company-name"]',
    title: "Step 1 — Complete your profile",
    body: "Fill in your Company Name, Overview, Email, Mobile Number and SEBI Registration Number. This is what clients see on your public microsite.",
    position: "bottom" as const,
  },
  {
    path: "/dashboard/profile",
    selector: '[data-testid="tab-bank"]',
    title: "Step 2 — Add your bank details",
    body: "Click the Bank & Payments tab. Enter your account number, IFSC code and account holder name. AlphaMarket uses this to settle your subscription revenue.",
    position: "bottom" as const,
    nextPath: "/dashboard/plans",
  },
  {
    path: "/dashboard/plans",
    selector: '[data-testid="button-add-plan"]',
    title: "Step 3 — Create subscription plans",
    body: "Click Add New Plan. The Rs.1 Trial plan is mandatory. You need at least 3 plans — add Monthly, Quarterly or Annual paid plans after the trial.",
    position: "left" as const,
    nextPath: "/dashboard/strategies",
  },
  {
    path: "/dashboard/strategies",
    selector: '[data-testid="button-add-strategy"]',
    title: "Step 4 — Create a strategy",
    body: "Click Add New to create your first strategy. Choose a type (Basket, Option or Equity) and a timeframe (Intraday, Short Term or Long Term). Fill in the details and publish it.",
    position: "left" as const,
  },
  {
    path: "/dashboard/strategies",
    selector: '[data-testid^="card-strategy-"]',
    title: "Step 5 — Add stocks to your strategy",
    body: "Tap the three-dot menu on any published strategy and select Add Stock Call or Add Basket Stock. Enter the symbol, buy price, target and stop loss for each call.",
    position: "bottom" as const,
    nextPath: "/dashboard/questions",
  },
  {
    path: "/dashboard/questions",
    selector: '[data-testid="text-questions-title"]',
    title: "Step 6 — Answer client questions",
    body: "Subscribers ask questions about your calls here. The red badge on the sidebar shows unread questions. Reply promptly as response time directly affects renewal rates.",
    position: "bottom" as const,
    nextPath: "/dashboard/content",
  },
  {
    path: "/dashboard/content",
    selector: '[data-testid^="button-add-"]',
    title: "Step 7 — Publish content and media",
    body: "Add market insights, research notes or videos. Content appears on your public microsite and helps convert visitors into paying subscribers.",
    position: "bottom" as const,
    nextPath: "/dashboard/reports",
  },
  {
    path: "/dashboard/reports",
    selector: '[data-testid^="card-report-"]',
    title: "Step 8 — Download your reports",
    body: "Three reports are available — Calls, Customer Acquisition and Financial. Download these monthly as records for your SEBI compliance filings.",
    position: "bottom" as const,
    nextPath: "/dashboard/microsite",
  },
  {
    path: "/dashboard/microsite",
    selector: 'a[href*="/advisor/"]',
    title: "Step 9 — Share your microsite",
    body: "This is your public advisor page on AlphaMarket. Share this URL with clients — they can browse your strategies, plans and subscribe directly.",
    position: "bottom" as const,
  },
];

type Pos = "top" | "bottom" | "left" | "right";

function getTooltipPos(rect: DOMRect, pos: Pos) {
  const W = 300; const GAP = 12; const vw = window.innerWidth;
  let top = 0, left = 0;
  if (pos === "bottom") { top = rect.bottom + GAP; left = rect.left + rect.width / 2 - W / 2; }
  else if (pos === "top") { top = rect.top - GAP - 170; left = rect.left + rect.width / 2 - W / 2; }
  else if (pos === "left") { top = rect.top; left = rect.left - W - GAP; }
  else { top = rect.top; left = rect.right + GAP; }
  left = Math.max(12, Math.min(left, vw - W - 12));
  top = Math.max(12, top);
  return { top, left, width: W };
}

export default function AdvisorWalkthrough() {
  const { user } = useAuth();
  const [location, setLocation] = useLocation();
  const [active, setActive] = useState(false);
  const [idx, setIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [loginCount, setLoginCount] = useState(0);
  const raf = useRef<number>();

  useEffect(() => {
    if (!user || user.role !== "advisor") return;
    const uid = String(user.id);
    if (localStorage.getItem(WT_DONE_KEY(uid))) return;
    const count = parseInt(localStorage.getItem(WT_LOGIN_KEY(uid)) || "0") + 1;
    localStorage.setItem(WT_LOGIN_KEY(uid), String(count));
    setLoginCount(count);
    const t = setTimeout(() => { setActive(true); setLocation("/dashboard/profile"); }, 600);
    return () => clearTimeout(t);
  }, [user]);

  const step = STEPS[idx];

  const measure = useCallback(() => {
    if (!active || !step) return;
    const el = document.querySelector(step.selector);
    if (!el) { raf.current = requestAnimationFrame(measure); return; }
    setRect(el.getBoundingClientRect());
    el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [active, step]);

  useEffect(() => {
    if (raf.current) cancelAnimationFrame(raf.current);
    setRect(null);
    raf.current = requestAnimationFrame(measure);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [measure, location]);

  useEffect(() => {
    if (!active) return;
    const h = () => {
      if (raf.current) cancelAnimationFrame(raf.current);
      raf.current = requestAnimationFrame(measure);
    };
    window.addEventListener("resize", h);
    window.addEventListener("scroll", h, true);
    return () => { window.removeEventListener("resize", h); window.removeEventListener("scroll", h, true); };
  }, [active, measure]);

  const markDone = useCallback(() => {
    if (user) localStorage.setItem(WT_DONE_KEY(String(user.id)), "1");
    setActive(false);
  }, [user]);

  const skipSession = useCallback(() => {
    setActive(false);
  }, []);

  const goNext = useCallback(() => {
    if (idx === STEPS.length - 1) { markDone(); return; }
    const nextIdx = idx + 1;
    const nextStep = STEPS[nextIdx];
    setIdx(nextIdx);
    if (nextStep.path !== location) setLocation(nextStep.path);
  }, [idx, location, markDone]);

  const goPrev = useCallback(() => {
    if (idx === 0) return;
    const prevIdx = idx - 1;
    const prevStep = STEPS[prevIdx];
    setIdx(prevIdx);
    if (prevStep.path !== location) setLocation(prevStep.path);
  }, [idx, location]);

  if (!active || !step || !rect) return null;
  if (step.path !== location) return null;

  const PAD = 8;
  const ts = getTooltipPos(rect, step.position);
  const showDontShow = loginCount >= 2;

  return createPortal(
    <>
      <div onClick={skipSession} style={{ position:"fixed", inset:0, zIndex:9997, cursor:"default" }} />
      <div style={{ position:"fixed", top:0, left:0, right:0, height:rect.top - PAD, background:"rgba(0,0,0,0.6)", zIndex:9998 }} />
      <div style={{ position:"fixed", top:rect.bottom + PAD, left:0, right:0, bottom:0, background:"rgba(0,0,0,0.6)", zIndex:9998 }} />
      <div style={{ position:"fixed", top:rect.top - PAD, left:0, width:rect.left - PAD, height:rect.height + PAD*2, background:"rgba(0,0,0,0.6)", zIndex:9998 }} />
      <div style={{ position:"fixed", top:rect.top - PAD, left:rect.right + PAD, right:0, height:rect.height + PAD*2, background:"rgba(0,0,0,0.6)", zIndex:9998 }} />
      <div style={{ position:"fixed", top:rect.top - PAD, left:rect.left - PAD, width:rect.width + PAD*2, height:rect.height + PAD*2, border:"2px solid #e53935", borderRadius:8, zIndex:9999, pointerEvents:"none" }} />
      <div style={{ position:"fixed", ...ts, background:"#fff", border:"1px solid #e5e7eb", borderLeft:"4px solid #e53935", borderRadius:"0 10px 10px 0", padding:16, zIndex:10000, fontFamily:"inherit", boxSizing:"border-box" }}>
        <div style={{ fontSize:11, color:"#e53935", fontWeight:600, marginBottom:6, letterSpacing:"0.04em" }}>STEP {idx + 1} OF {STEPS.length}</div>
        <div style={{ fontSize:14, fontWeight:600, color:"#111827", marginBottom:8, lineHeight:1.4 }}>{step.title}</div>
        <div style={{ fontSize:12.5, color:"#6b7280", lineHeight:1.65, marginBottom:14 }}>{step.body}</div>
        <div style={{ display:"flex", gap:3, marginBottom:14 }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{ height:4, flex: i === idx ? 2 : 1, borderRadius:2, background: i === idx ? "#e53935" : i < idx ? "#fca5a5" : "#e5e7eb", transition:"flex 0.2s" }} />
          ))}
        </div>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", flexWrap:"wrap", gap:6 }}>
          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            <button onClick={skipSession} style={{ fontSize:11, color:"#9ca3af", background:"none", border:"none", cursor:"pointer", padding:0, textAlign:"left" }}>
              Remind me later
            </button>
            {showDontShow && (
              <button onClick={markDone} style={{ fontSize:11, color:"#e53935", background:"none", border:"none", cursor:"pointer", padding:0, textAlign:"left" }}>
                Don't show this again
              </button>
            )}
          </div>
          <div style={{ display:"flex", gap:6 }}>
            {idx > 0 && (
              <button onClick={goPrev} style={{ fontSize:12, padding:"6px 12px", background:"transparent", border:"1px solid #d1d5db", borderRadius:6, cursor:"pointer", color:"#374151" }}>Back</button>
            )}
            <button onClick={goNext} style={{ fontSize:12, padding:"6px 14px", background:"#e53935", border:"none", borderRadius:6, cursor:"pointer", color:"#fff", fontWeight:600 }}>
              {idx === STEPS.length - 1 ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    </>,
    document.body
  );
}

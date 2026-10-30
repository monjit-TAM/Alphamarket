// ============================================================================
// Reseller PROGRAM (marketing) page — expanded
// SAVE AS: client/src/pages/reseller-program.tsx  (overwrites v1)
// Public explainer for the 50:50 reseller programme. Uses site Navbar + Footer.
// ============================================================================

import { Link } from "wouter";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";

const BRAND = "#e14a14";
const DARK = "#141414";

function Stat({ n, l }: { n: string; l: string }) {
  return (
    <div style={{ textAlign: "center", padding: "8px 6px" }}>
      <div style={{ fontSize: 28, fontWeight: 800, color: "#fff", fontFamily: "Georgia, serif" }}>{n}</div>
      <div style={{ fontSize: 11, color: "#9a9a9a", marginTop: 4, textTransform: "uppercase", letterSpacing: 0.5 }}>{l}</div>
    </div>
  );
}

function Card({ h, d }: { h: string; d: string }) {
  return (
    <div style={{ background: "#faf8f6", borderRadius: 10, padding: 20, border: "1px solid #f0ece8" }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: DARK, marginBottom: 6 }}>{h}</div>
      <div style={{ fontSize: 13.5, color: "#6b6b6b", lineHeight: 1.55 }}>{d}</div>
    </div>
  );
}

function Step({ n, h, d }: { n: string; h: string; d: string }) {
  return (
    <div style={{ display: "flex", gap: 14, marginBottom: 18 }}>
      <div style={{ flexShrink: 0, width: 30, height: 30, borderRadius: "50%", background: BRAND, color: "#fff", fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14 }}>{n}</div>
      <div>
        <div style={{ fontSize: 15.5, fontWeight: 700, color: DARK }}>{h}</div>
        <div style={{ fontSize: 13.5, color: "#555", lineHeight: 1.55, marginTop: 2 }}>{d}</div>
      </div>
    </div>
  );
}

function Faq({ q, a }: { q: string; a: string }) {
  return (
    <div style={{ borderBottom: "1px solid #eceae7", padding: "16px 0" }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: DARK, marginBottom: 6 }}>{q}</div>
      <div style={{ fontSize: 13.5, color: "#555", lineHeight: 1.6 }}>{a}</div>
    </div>
  );
}

const products = [
  ["AlphaMarket", "Advisory calls", "SEBI-registered analysts' calls, tracked live entry to exit — delivered where clients can act."],
  ["AlphaLab", "Research desk", "Screening, chart-pattern detection, bases & pivots, relative strength and options analytics."],
  ["AlphaLens", "Portfolio analytics", "Health scoring, rebalancing and quantamental analysis — live white-label with Anand Rathi."],
  ["AlphaLens MF", "Fund research", "Mutual-fund research that looks through to holdings — overlap, XIRR and stress tests."],
  ["AlphaNivesh", "Full portfolio", "Shares, funds, gold, PPF, EPF, bonds — even liabilities — in one honest view."],
];

const support = [
  ["Dedicated onboarding", "We set up your reseller account, referral code and pricing, and walk you through positioning each product to your clients."],
  ["Marketing material", "Ready-to-use decks, one-pagers and email templates you can share with your clients — no design work on your side."],
  ["Live reseller dashboard", "Track your introduced clients, active subscriptions, products sold, revenue and your share — all in real time, transparently."],
  ["Product training", "Sessions on the research desk, portfolio tools and advisory calls, so you can confidently guide clients to what fits them."],
  ["Priority support", "A direct line for you and your clients — questions, mapping issues and account help handled quickly."],
  ["Transparent payouts", "Your share is computed and shown against every subscription, with a clear payout cycle. No black box."],
];

export default function ResellerProgram() {
  const wrap: React.CSSProperties = { maxWidth: 960, margin: "0 auto", padding: "0 20px" };
  return (
    <div style={{ background: "#fff", color: DARK }}>
      <Navbar />

      {/* Hero */}
      <div style={{ background: "#fff", padding: "56px 0 20px" }}>
        <div style={wrap}>
          <div style={{ fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: BRAND, fontWeight: 700 }}>Reseller Programme &middot; Authorised Partner</div>
          <h1 style={{ fontSize: 40, lineHeight: 1.15, margin: "12px 0 0", fontFamily: "Georgia, serif", fontWeight: 400 }}>
            Grow your income by giving clients<br />advice worth acting on.
          </h1>
          <p style={{ fontSize: 16, color: "#444", lineHeight: 1.6, maxWidth: 660, marginTop: 16 }}>
            Become an AlphaVerse Authorised Partner and resell India's full research &amp; advisory suite to your clients — under a simple 50:50 revenue-share partnership. You bring the relationship; we bring the platform, the research and the support. Nothing to build, nothing to staff.
          </p>
          <Link href="/reseller/register">
            <a style={{ display: "inline-block", marginTop: 22, background: BRAND, color: "#fff", padding: "13px 28px", borderRadius: 8, fontWeight: 700, fontSize: 15, textDecoration: "none" }}>Become a reseller →</a>
          </Link>
        </div>
      </div>

      {/* 50:50 band */}
      <div style={{ ...wrap, marginTop: 28 }}>
        <div style={{ background: BRAND, borderRadius: 12, padding: "30px 24px", textAlign: "center", color: "#fff" }}>
          <div style={{ fontSize: 12, letterSpacing: 1.5, textTransform: "uppercase", opacity: 0.85 }}>The reseller deal</div>
          <div style={{ fontSize: 46, fontWeight: 800, fontFamily: "Georgia, serif", margin: "6px 0" }}>50 : 50</div>
          <div style={{ fontSize: 14.5, opacity: 0.92 }}>Revenue share on every subscription you bring — recurring, for as long as the client stays.</div>
        </div>
      </div>

      {/* Why it works */}
      <div style={{ ...wrap, marginTop: 44 }}>
        <div style={{ fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: BRAND, fontWeight: 700, marginBottom: 14 }}>Why partner with AlphaVerse</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14 }}>
          <Card h="Earn recurring" d="A share of every subscription, every renewal — income that compounds as your book grows." />
          <Card h="Keep clients closer" d="Clients who get research and tools from you trade more, churn less, and stay yours." />
          <Card h="Zero to build" d="No product to develop, no analysts to hire. We run the platform; you simply resell it." />
        </div>
      </div>

      {/* Support pillars — what you get */}
      <div style={{ ...wrap, marginTop: 44 }}>
        <div style={{ fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: BRAND, fontWeight: 700, marginBottom: 8 }}>The support you get</div>
        <h2 style={{ fontSize: 26, fontFamily: "Georgia, serif", fontWeight: 400, margin: "0 0 18px" }}>We back you at every step.</h2>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
          {support.map(([h, d]) => <Card key={h} h={h} d={d} />)}
        </div>
      </div>

      {/* What clients get + stats */}
      <div style={{ ...wrap, marginTop: 44 }}>
        <div style={{ fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: BRAND, fontWeight: 700, marginBottom: 8 }}>What your clients get</div>
        <h2 style={{ fontSize: 26, fontFamily: "Georgia, serif", fontWeight: 400, margin: "0 0 18px" }}>The right advice and tools — in one place.</h2>
        <div style={{ background: DARK, borderRadius: 12, padding: "18px 12px", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 8, marginBottom: 24 }}>
          <Stat n="4,000+" l="Stocks tracked" />
          <Stat n="100+" l="Live calls daily" />
          <Stat n="6" l="Products, one login" />
          <Stat n="34" l="Screener strategies" />
          <Stat n="10k+" l="Patterns computed" />
          <Stat n="49" l="Sectors covered" />
        </div>
        {products.map(([n, tag, d]) => (
          <div key={n} style={{ display: "flex", gap: 16, padding: "12px 0", borderBottom: "1px solid #eceae7" }}>
            <div style={{ width: 150, flexShrink: 0 }}>
              <div style={{ fontWeight: 700, fontSize: 14.5 }}>{n}</div>
              <div style={{ fontSize: 11.5, color: BRAND, marginTop: 2 }}>{tag}</div>
            </div>
            <div style={{ fontSize: 13.5, color: "#555", lineHeight: 1.55 }}>{d}</div>
          </div>
        ))}
      </div>

      {/* How it works */}
      <div style={{ ...wrap, marginTop: 44 }}>
        <div style={{ fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: BRAND, fontWeight: 700, marginBottom: 8 }}>How it works</div>
        <h2 style={{ fontSize: 26, fontFamily: "Georgia, serif", fontWeight: 400, margin: "0 0 20px" }}>Live in three steps.</h2>
        <Step n="1" h="Sign up &amp; accept the partner terms." d="A short registration and reseller agreement — we set you up with your account, referral code and pricing." />
        <Step n="2" h="Introduce it to your clients." d="Share your referral link. Clients who join through it are automatically attributed to you. We help you position each product." />
        <Step n="3" h="Earn on every subscription." d="You keep your share of the revenue, tracked transparently in your dashboard, recurring as long as they stay." />
      </div>

      {/* Eligibility */}
      <div style={{ ...wrap, marginTop: 44 }}>
        <div style={{ fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: BRAND, fontWeight: 700, marginBottom: 8 }}>Who can join</div>
        <h2 style={{ fontSize: 26, fontFamily: "Georgia, serif", fontWeight: 400, margin: "0 0 14px" }}>Built for people who already have client relationships.</h2>
        <p style={{ fontSize: 14, color: "#555", lineHeight: 1.65 }}>
          Sub-brokers, authorised persons, remisiers, IFAs, mutual-fund distributors and financial influencers with an existing client base are a natural fit. You don't need to be SEBI-registered to resell — advisory relationships remain between clients and our SEBI-registered advisers; you introduce clients to the platform and earn a share. Final onboarding is subject to the reseller agreement and our approval.
        </p>
      </div>

      {/* FAQ */}
      <div style={{ ...wrap, marginTop: 44 }}>
        <div style={{ fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: BRAND, fontWeight: 700, marginBottom: 8 }}>Questions</div>
        <h2 style={{ fontSize: 26, fontFamily: "Georgia, serif", fontWeight: 400, margin: "0 0 8px" }}>Good to know.</h2>
        <Faq q="How much do I earn?" a="You earn a 50% share of the subscription revenue from every client you introduce, for as long as they stay subscribed. Your exact terms are set out in the reseller agreement." />
        <Faq q="Do I need to be SEBI-registered?" a="No. You introduce clients to the platform and earn a share. The advisory relationship is between the client and our SEBI-registered advisers — you are not giving investment advice yourself." />
        <Faq q="How are my clients tracked?" a="You get a unique referral code and link. Anyone who signs up through it is automatically attributed to you, and every subscription they take shows up in your dashboard with your share calculated." />
        <Faq q="When do I get paid?" a="Your accrued share is shown transparently in your dashboard against each subscription, and paid out on a defined cycle set out in the agreement." />
        <Faq q="What support do I get?" a="Onboarding, marketing material, product training, a live dashboard and priority support for you and your clients — see 'The support you get' above." />
      </div>

      {/* CTA */}
      <div style={{ ...wrap, marginTop: 44, marginBottom: 56 }}>
        <div style={{ background: DARK, borderRadius: 12, padding: "36px 28px", textAlign: "center", color: "#fff" }}>
          <h2 style={{ fontSize: 24, fontFamily: "Georgia, serif", fontWeight: 400, margin: 0 }}>Turn your client relationships into recurring income.</h2>
          <p style={{ fontSize: 14.5, color: "#c4c4c4", marginTop: 12 }}>Register in minutes, accept the partner terms, and start earning.</p>
          <Link href="/reseller/register">
            <a style={{ display: "inline-block", marginTop: 20, background: BRAND, color: "#fff", padding: "13px 30px", borderRadius: 8, fontWeight: 700, fontSize: 15, textDecoration: "none" }}>Become a reseller →</a>
          </Link>
          <div style={{ fontSize: 13, color: "#c4c4c4", marginTop: 18 }}>hello@alphamarket.co.in &middot; +91 90291 29102</div>
        </div>
      </div>

      <Footer />
    </div>
  );
}

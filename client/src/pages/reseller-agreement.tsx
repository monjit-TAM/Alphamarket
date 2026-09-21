// ============================================================================
// Reseller Agreement page
// SAVE AS: client/src/pages/reseller-agreement.tsx
// STARTER DRAFT — must be reviewed by legal counsel before relying on it.
// ============================================================================

import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";

const DARK = "#141414";

function Clause({ n, h, children }: { n: string; h: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 22 }}>
      <div style={{ fontSize: 15.5, fontWeight: 700, color: DARK, marginBottom: 6 }}>{n}. {h}</div>
      <div style={{ fontSize: 13.8, color: "#444", lineHeight: 1.7 }}>{children}</div>
    </div>
  );
}

export default function ResellerAgreement() {
  const wrap: React.CSSProperties = { maxWidth: 820, margin: "0 auto", padding: "0 20px" };
  return (
    <div style={{ background: "#fff", color: DARK }}>
      <Navbar />
      <div style={{ ...wrap, paddingTop: 48, paddingBottom: 56 }}>
        <div style={{ fontSize: 12, letterSpacing: 1, textTransform: "uppercase", color: "#e14a14", fontWeight: 700 }}>Legal</div>
        <h1 style={{ fontSize: 32, fontFamily: "Georgia, serif", fontWeight: 400, margin: "10px 0 6px" }}>Reseller Partner Agreement</h1>
        <p style={{ fontSize: 13, color: "#888", marginBottom: 8 }}>Edhaz Markets Private Limited (operating as AlphaVerse)</p>
        <p style={{ fontSize: 13, color: "#888", marginBottom: 28 }}>Last updated: September 2026</p>

        <p style={{ fontSize: 14, color: "#444", lineHeight: 1.7, marginBottom: 26 }}>
          This Reseller Partner Agreement (&ldquo;Agreement&rdquo;) is entered into between Edhaz Markets Private Limited, operating as AlphaVerse (&ldquo;Company&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;), and the person or entity registering as a reseller (&ldquo;Reseller&rdquo;, &ldquo;you&rdquo;). By registering as a reseller and ticking the acceptance box, you agree to the terms below.
        </p>

        <Clause n="1" h="Appointment and scope">
          The Company appoints the Reseller as a non-exclusive authorised partner to introduce clients to, and promote, the Company&rsquo;s research and advisory products (the &ldquo;Products&rdquo;). This Agreement does not create any partnership, agency, employment or joint venture beyond the limited reseller relationship described here. The Reseller has no authority to bind the Company or to make representations on its behalf beyond approved marketing material.
        </Clause>

        <Clause n="2" h="No investment advice by the Reseller">
          The Reseller shall not provide investment advice, research recommendations or portfolio management services in its own name. All advisory relationships are between clients and SEBI-registered advisers on the platform. The Reseller&rsquo;s role is limited to introducing clients and promoting the Products. The Reseller shall not represent itself as SEBI-registered unless it is, in fact, separately so registered.
        </Clause>

        <Clause n="3" h="Referral attribution">
          Clients introduced by the Reseller are tracked through a unique referral code and link issued to the Reseller. A client is attributed to the Reseller only where the client registers or subscribes through the Reseller&rsquo;s referral code, as recorded by the Company&rsquo;s systems. The Company&rsquo;s records of attribution are final, absent manifest error.
        </Clause>

        <Clause n="4" h="Revenue share">
          The Company shall pay the Reseller a revenue share of fifty percent (50%) of the net subscription revenue actually received by the Company from clients validly attributed to the Reseller, unless a different rate is agreed in writing or reflected in the Reseller&rsquo;s account. &ldquo;Net&rdquo; revenue is after applicable taxes, payment-gateway charges, refunds, chargebacks and cancellations. The Company may adjust the applicable rate prospectively on notice.
        </Clause>

        <Clause n="5" h="Payouts">
          Accrued revenue share is displayed in the Reseller&rsquo;s dashboard and paid out on the cycle notified by the Company, subject to a minimum payout threshold and receipt of valid invoicing and tax details. Amounts relating to refunded, charged-back or cancelled subscriptions are reversed. The Reseller is responsible for its own taxes on amounts received.
        </Clause>

        <Clause n="6" h="Reseller obligations">
          The Reseller shall: (a) promote the Products honestly and only using approved or accurate material; (b) not make guarantees of returns or performance; (c) not engage in mis-selling, spam, or misleading claims; (d) comply with all applicable laws, including SEBI regulations and advertising norms; (e) not tamper with referral tracking or self-refer to generate share; and (f) protect client information it handles.
        </Clause>

        <Clause n="7" h="Compliance and conduct">
          The Reseller shall not do anything that brings the Company or its Products into disrepute. The Company may withhold share, suspend, or terminate the Reseller for breach, suspected fraud, mis-selling, or regulatory concern. The Reseller indemnifies the Company against losses arising from the Reseller&rsquo;s breach, misrepresentation or unlawful conduct.
        </Clause>

        <Clause n="8" h="Intellectual property">
          All Company brands, content, software and materials remain the Company&rsquo;s property. The Reseller receives a limited, revocable, non-exclusive licence to use approved marketing materials solely to promote the Products during the term. No other rights are granted.
        </Clause>

        <Clause n="9" h="Confidentiality">
          Each party shall keep the other&rsquo;s non-public information confidential and use it only for this Agreement. Client data accessed by the Reseller shall be used only to service the introduction relationship and in compliance with applicable data-protection law.
        </Clause>

        <Clause n="10" h="Term and termination">
          This Agreement continues until terminated. Either party may terminate on written notice. The Company may suspend or terminate immediately for breach, fraud or regulatory reason. On termination, the Reseller&rsquo;s right to earn further share ceases, save for share already validly accrued and unpaid, subject to reversals.
        </Clause>

        <Clause n="11" h="Limitation of liability">
          To the maximum extent permitted by law, the Company is not liable for indirect or consequential losses, and its aggregate liability is limited to the revenue share paid to the Reseller in the three months preceding the claim. Nothing limits liability that cannot be limited by law.
        </Clause>

        <Clause n="12" h="Governing law and disputes">
          This Agreement is governed by the laws of India. The courts at Mumbai, Maharashtra shall have exclusive jurisdiction, subject to any arbitration the parties agree in writing.
        </Clause>

        <Clause n="13" h="Changes">
          The Company may update this Agreement. Continued participation after an update constitutes acceptance of the updated terms. Material changes will be notified.
        </Clause>

        <div style={{ background: "#fff8f5", border: "1px solid #f3ddd2", borderRadius: 10, padding: "16px 18px", marginTop: 24 }}>
          <div style={{ fontSize: 12.5, color: "#8a5a44", lineHeight: 1.6 }}>
            <strong>Note:</strong> Investments in securities markets are subject to market risk. Read all related documents carefully before investing. This Agreement is a summary of key terms and may be supplemented by a detailed partnership agreement executed between the parties.
          </div>
        </div>
      </div>
      <Footer />
    </div>
  );
}

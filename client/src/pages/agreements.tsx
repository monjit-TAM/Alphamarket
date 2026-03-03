import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { Navbar } from "@/components/navbar";

function AdvisorParticipationAgreement() {
  return (
    <div className="space-y-4 text-sm leading-relaxed">
      <h2 className="text-lg font-semibold" data-testid="text-agreement-title">AlphaMarket - Digital Advisor Participation Agreement & Risk Disclaimer</h2>
      <p>Effective Date: Upon acceptance by Advisor during digital onboarding.</p>
      <p>By clicking "I Agree" or by proceeding with Advisor registration on AlphaMarket, You ("Advisor") acknowledge that You have read, understood, and agreed to be bound by this Digital Advisor Participation Agreement ("Agreement") with Edhaz Financial Services Private Limited, operating the AlphaMarket platform.</p>
      <h3 className="font-semibold mt-4">1. Scope & Applicability</h3>
      <p>1.1. This Agreement governs Your participation on AlphaMarket solely in respect of clients acquired through the AlphaMarket platform ("Platform Clients"). 1.2. Nothing in this Agreement applies to clients acquired independently outside the platform. 1.3. By registering on AlphaMarket, You consent that Your relationship with Platform Clients shall also be subject to this Agreement.</p>
      <h3 className="font-semibold mt-4">2. Independent Relationship</h3>
      <p>2.1. You participate in Your independent professional capacity as a SEBI-registered Research Analyst / Investment Advisor. 2.2. No partnership, agency, employment, or joint venture is created. 2.3. Platform Clients enter into a direct contractual relationship with You. AlphaMarket is not a party to such contracts.</p>
      <h3 className="font-semibold mt-4">3. Compliance Responsibility</h3>
      <p>3.1. You represent and warrant that: You hold a valid SEBI registration; You comply with all applicable SEBI Regulations; You are solely responsible for the accuracy, independence, and integrity of Your research and advice. 3.2. You shall not use AlphaMarket to: Offer assured or guaranteed returns; Collect funds for investment; Issue misleading advertisements.</p>
      <h3 className="font-semibold mt-4">4. AlphaMarket's Role & Disclaimer</h3>
      <p>4.1. AlphaMarket functions only as a technology and compliance facilitation platform. 4.2. AlphaMarket does not: Provide investment advice; Validate Your recommendations; Guarantee performance or returns.</p>
      <h3 className="font-semibold mt-4">5. Fees & Refunds</h3>
      <p>5.1. All fees from Platform Clients must flow through AlphaMarket's payment system. 5.2. Refunds must comply with SEBI rules. 5.3. AlphaMarket may deduct a platform service fee.</p>
      <h3 className="font-semibold mt-4">6. Data Protection & Privacy</h3>
      <p>6.1. Advisors act as data controllers for Platform Client data. 6.2. Advisors are responsible for compliance with IT Act, 2000 and DPDP Act, 2023. 6.3. Any misuse of Platform Client data by You shall be solely Your liability.</p>
      <h3 className="font-semibold mt-4">7. Indemnity</h3>
      <p>You agree to indemnify and hold harmless AlphaMarket against any claims, penalties, damages, or liabilities arising from breach of regulations, misrepresentation, negligence, client disputes, or data privacy breaches caused by You.</p>
      <h3 className="font-semibold mt-4">8. Jurisdiction & Dispute Resolution</h3>
      <p>8.1. This Agreement is governed by Indian law. 8.2. Disputes shall be subject to the exclusive jurisdiction of the courts of Bangalore, Karnataka.</p>
      <h3 className="font-semibold mt-4">9. Termination</h3>
      <p>9.1. AlphaMarket may suspend or terminate Your participation if Your SEBI registration is cancelled, You violate SEBI rules, or Your conduct harms AlphaMarket's reputation. 9.2. Upon termination, You must immediately cease using AlphaMarket's name, logo, or brand.</p>
      <h3 className="font-semibold mt-4">10. Binding Effect</h3>
      <p>By clicking "I Agree" or completing registration, You acknowledge this Agreement is legally binding under the Indian Contract Act, 1872 and the Information Technology Act, 2000.</p>
    </div>
  );
}

function IARAServicesAgreement() {
  return (
    <div className="space-y-4 text-sm leading-relaxed">
      <h2 className="text-lg font-semibold" data-testid="text-agreement-title">Investment Advisor and Research Analyst Services Agreement</h2>
      <p>This document is an electronic record in terms of the Information Technology Act, 2000. The online platform www.thealphamarket.com is owned and operated by Edhaz Financial Services Private Limited.</p>
      <h3 className="font-semibold mt-4">Part A: Client Consent</h3>
      <p>The Client has read and understood the terms and conditions of this Agreement facilitated by Edhaz Financial Services Private Limited through The AlphaMarket. The fee structure and charging mechanism are standardized between the Client and the SEBI Registered Investment Advisor/Research Analyst.</p>
      <h3 className="font-semibold mt-4">Part B: Declaration</h3>
      <p>The advisory relationship commences after successful payment and completion of eKYC and Risk Profiling. The Advisor will not manage funds or securities on behalf of the Client and will only receive payments to cover the fees owed under this Agreement.</p>
      <h3 className="font-semibold mt-4">Part C: Fees per SEBI Regulations</h3>
      <p>Clients pay subscription fees for strategies offered by RIAs/RAs. Fees are determined by the Advisor based on subscription duration. Clients may subscribe to multiple strategies from different Advisors simultaneously.</p>
      <h3 className="font-semibold mt-4">2. Appointment of the Investment Advisor</h3>
      <p>The Client engages with SEBI Registered Investment Advisors and Research Analysts through The AlphaMarket. The advice will be akin to a model portfolio or generic in nature, and execution discretion lies solely with the Client.</p>
      <h3 className="font-semibold mt-4">3. Scope of Services</h3>
      <p>RIAs and RAs provide advice related to investing in, purchasing, selling, or otherwise dealing in stocks. The final analysis and decision to adopt advice is entirely the Client's responsibility.</p>
      <h3 className="font-semibold mt-4">5. Obligations of the Investment Advisor</h3>
      <p>The RIA and RA agree to uphold high standards of integrity and fairness, ensure continuous compliance with SEBI eligibility criteria, provide reports to clients, maintain required records, conduct periodic audits, and adhere to the code of conduct under SEBI Regulations.</p>
      <h3 className="font-semibold mt-4">6. Obligations of the Client</h3>
      <p>The Client agrees to provide necessary details such as PAN Card, financial information required for KYC, and risk profiling. The Client shall make informed decisions and take responsibility for all trades executed.</p>
      <h3 className="font-semibold mt-4">7. Confidentiality & Data Protection</h3>
      <p>Both Advisor and Client agree to maintain confidentiality. Sensitive personal data shall be handled in compliance with IT Act, 2000 and DPDP Act, 2023.</p>
      <h3 className="font-semibold mt-4">8. Grievance Redressal</h3>
      <p>In case of disputes, Clients may approach the Grievance Redressal Officer designated by the Advisor. Unresolved issues may be escalated through SEBI's SCORES platform.</p>
      <h3 className="font-semibold mt-4">Annexure A: Risk Disclosure</h3>
      <p>Investments in securities markets are subject to market risks. Past performance is not indicative of future results. The Client understands and agrees that all investments carry a degree of risk.</p>
      <h3 className="font-semibold mt-4">Annexure B: Risk Statements</h3>
      <p>The Client acknowledges and understands the risks associated with investments in Securities, equity-linked investments, real estate, derivatives trading, and mutual funds. All investments involve risk of adverse market developments.</p>
      <h3 className="font-semibold mt-4">Agreement Acceptance</h3>
      <p>By clicking "Agree" or "Submit", the Client consents to and agrees to abide by all terms of this Investment Advisor and Research Analyst Services Agreement. This Agreement is electronically executed.</p>
    </div>
  );
}

export default function AgreementPage() {
  const params = useParams<{ type: string }>();

  const isParticipation = params.type === "advisor-participation";
  const isIARA = params.type === "ia-ra-services";

  if (!isParticipation && !isIARA) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-3xl mx-auto p-6 text-center">
          <p className="text-muted-foreground">Agreement not found.</p>
          <Link href="/">
            <Button variant="outline" className="mt-4" data-testid="button-back-home">
              <ArrowLeft className="w-4 h-4 mr-1" /> Back to Home
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-3xl mx-auto p-6">
        <Link href="/">
          <Button variant="ghost" className="mb-4" data-testid="button-back">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
        </Link>
        <Card>
          <CardHeader>
            <CardTitle data-testid="text-page-title">
              {isParticipation
                ? "Digital Advisor Participation Agreement & Risk Disclaimer"
                : "Investment Advisor & Research Analyst Services Agreement"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {isParticipation ? <AdvisorParticipationAgreement /> : <IARAServicesAgreement />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

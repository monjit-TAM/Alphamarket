import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Helmet } from "react-helmet-async";

function LegalPageLayout({ title, lastUpdated, children }: { title: string; lastUpdated: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1">
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-10">
          <h1 className="text-3xl font-bold mb-1" data-testid="legal-page-title">{title}</h1>
          {lastUpdated && <p className="text-sm text-muted-foreground mb-8">Last Updated: {lastUpdated}</p>}
          {!lastUpdated && <div className="mb-8" />}
          <div className="prose prose-sm max-w-none dark:prose-invert space-y-4 text-sm leading-relaxed text-muted-foreground [&_h2]:text-foreground [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-8 [&_h2]:mb-3 [&_h3]:text-foreground [&_h3]:text-lg [&_h3]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2 [&_h4]:text-foreground [&_h4]:text-base [&_h4]:font-semibold [&_h4]:mt-5 [&_h4]:mb-2 [&_h5]:text-foreground [&_h5]:font-semibold [&_h5]:mt-4 [&_h5]:mb-1 [&_strong]:text-foreground [&_a]:text-primary [&_a]:underline [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:mb-1.5">
            {children}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export function TermsAndConditions() {
  return (
    <LegalPageLayout title="Terms and Conditions" lastUpdated="Oct 15, 2024">
      <Helmet>
        <title>Terms and Conditions | AlphaMarket</title>
        <meta name="description" content="AlphaMarket Terms and Conditions - Read the terms governing use of our SaaS marketplace platform connecting SEBI-registered advisors with investors." />
      </Helmet>

      <p>Welcome to AlphaMarket, a product of Edhaz Financial Services Private Limited (hereinafter referred to as "AlphaMarket," "we," "our," or "us"). By accessing and using AlphaMarket, you agree to comply with these Terms and Conditions ("Terms"), as well as any policies, guidelines, or amendments set forth by AlphaMarket. Please read this document carefully before accessing or using our Platform.</p>

      <h4>1. Introduction</h4>
      <p>AlphaMarket, a product of Edhaz Financial Services Private Limited, offers a marketplace platform where SEBI-registered Investment Advisors (RIAs) and Research Analysts (RAs) publish model portfolios, strategies, and related financial content. As a Software as a Service (SaaS) platform, AlphaMarket provides tools like EKYC, risk profiling, strategy tracking, compliance management, and distribution of advisory services via various channels. AlphaMarket is not a SEBI-registered Investment Advisor and does not offer personalized investment advice. Your use of AlphaMarket is subject to these Terms.</p>

      <h4>What We Do</h4>
      <p>Edhaz is a financial technology company, not an investment advisor. We build the tools and infrastructure to create a marketplace platform connecting you with qualified SEBI Registered Investment Advisors (RIAs) and Research Analysts (RAs). These advisors curate and publish investment strategies, and Alphamarket ensures that their recommendations are disseminated to the subscribers of these strategies in a timely manner using various mediums like WhatsApp, SMS, email, and notifications.</p>

      <h4>Here's the Breakdown:</h4>
      <ul>
        <li><strong>Alphamarket</strong>: A marketplace platform publishing investment and trading strategies by SEBI registered RIAs and RAs.</li>
        <li><strong>SEBI</strong>: The Securities and Exchange Board of India, a regulatory body overseeing the Indian securities market.</li>
        <li><strong>Our Role</strong>: Providing the technology platform for advisors to create, share, and disseminate investment strategies, facilitating subscriptions and transactions.</li>
      </ul>

      <h4>Important Disclaimers:</h4>
      <ul>
        <li><strong>Research & Recommendations</strong>: All research and advice displayed on Alphamarket come directly from SEBI-registered advisors. We don't provide our own recommendations.</li>
        <li><strong>Informational Purposes</strong>: The information displayed on our platform, including returns and ratios, is for your reference only. It's meant to help you make informed investment decisions, not to act as an advertisement or guarantee future performance.</li>
        <li><strong>SEBI Registration</strong>: Being SEBI-registered doesn't guarantee an advisor's success or your returns. It simply means they meet the regulatory requirements.</li>
        <li><strong>User-Created Alphamarkets</strong>: Some users create Alphamarkets for personal use and share them with a limited group. These are for knowledge sharing and not investment advice. Before investing in a user-created Alphamarket, consult a SEBI-registered advisor.</li>
        <li><strong>Performance Calculations</strong>: Unless stated otherwise, returns displayed are absolute returns. The performance data and rationale for each Alphamarket are for informational purposes only. They shouldn't be considered investment advice.</li>
      </ul>

      <h4>Additional Considerations:</h4>
      <ul>
        <li><strong>Alphamarkets vs. Indices</strong>: Alphamarkets are not linked to any index developed by the NSE. They are independent strategies. However, we can compare their performance to other indices.</li>
        <li><strong>Trading & Settlement</strong>: Alphamarkets are currently only available for trading and settlement within India.</li>
        <li><strong>Price Delays</strong>: Prices displayed on Alphamarket may be delayed. We get them from reliable sources, but we can't guarantee their absolute accuracy. Before placing an order, you'll be redirected to your broker's platform for live pricing and secure execution.</li>
      </ul>

      <h4>Your Responsibility as an Investor:</h4>
      <p>The information on Alphamarket is meant to help you make informed decisions, but it's not a substitute for your own research and risk assessment. Remember, investing carries inherent risks.</p>
      <ul>
        <li><strong>Investment Decisions</strong>: You are responsible for your investment choices and for verifying all information used before making a decision.</li>
        <li><strong>Personal Risk Tolerance</strong>: Consider your individual financial needs and risk tolerance when making investment decisions. Past performance is not a guarantee of future results.</li>
        <li><strong>Market Risk</strong>: All investments are subject to market fluctuations. Carefully read all related documents before investing.</li>
      </ul>

      <h4>Our Role as a Technology Provider:</h4>
      <p>Edhaz is a technology provider and not an intermediary as per SEBI regulations. The information and content on Alphamarket, whether free or subscription-based, is not investment advice or research analysis.</p>
      <ul>
        <li><strong>We Are Not Liable</strong>: We are not liable for any losses incurred due to actions taken based on information found on Alphamarket. We do not endorse or verify user-created content and are not responsible for its accuracy.</li>
      </ul>

      <h4>Information Sources & Disclaimer:</h4>
      <p>The information presented here comes from sources believed to be reliable. However, it hasn't been independently verified, and we make no guarantees about its accuracy or completeness. All information and opinions are subject to change without notice. Descriptions of any companies or securities are not intended to be exhaustive. We are not obligated to update this report for changes. Edhaz reserves the right to make changes and modifications to these terms and conditions at any time.</p>

      <h4>Performance Tracking</h4>
      <p>The Alpha Market provides tools for you to track the performance of SEBI RIAs. However, past performance is not necessarily indicative of future results. You should not rely solely on past performance when making investment decisions.</p>

      <h4>Risk Disclosure</h4>
      <p>Investing involves risk. You could lose money when you invest. You should carefully consider your investment objectives, risk tolerance, and financial situation before investing.</p>

      <p><strong>By using Alphamarket, you agree to these terms and conditions.</strong></p>

      <h4>1. Services Offered</h4>
      <ol>
        <li><strong>Access to SEBI-Registered Advisors and Analysts</strong>: AlphaMarket connects Users with SEBI-registered RIAs and RAs who publish model portfolios, including growth, value, swing trading, baskets, intraday, momentum, and F&O segments. These professionals publish strategies, allowing investors to review and subscribe.</li>
        <li><strong>Platform Tools</strong>: AlphaMarket provides advisors with tools for compliance management, content dissemination, and strategy performance tracking. Features include distribution of advisory calls through WhatsApp, email, and notifications.</li>
        <li><strong>Learning Resources</strong>: The platform offers access to financial content created by advisors, including research and educational materials in multiple Indian languages.</li>
        <li><strong>Subscription Services</strong>: Users can select subscription plans from advisors for various financial strategies. Payment terms and auto-renewal options are determined by the respective advisor, and refunds are subject to advisor policies.</li>
        <li><strong>User Account Setup</strong>: Users are required to create a profile, complete KYC, and provide financial details necessary to access and manage services. The information provided is used in accordance with the Privacy Policy.</li>
        <li><strong>Transactional Records</strong>: All transactions made on the Platform are documented and maintained by AlphaMarket. These records serve as definitive proof of User transactions.</li>
        <li><strong>Disclaimers</strong>: AlphaMarket does not provide personalized financial advice, nor does it guarantee the accuracy of strategies published by advisors. Users should conduct due diligence before making any investment decisions based on information obtained through the Platform.</li>
      </ol>

      <h4>2. Content and Intellectual Property</h4>
      <ol>
        <li><strong>Content Ownership</strong>: All intellectual property on the Platform (text, data, reports, images, etc.) belongs to AlphaMarket, its Associate Companies, or licensors. Unauthorized copying, sharing, or distribution of Platform content is prohibited.</li>
        <li><strong>Third-Party Content</strong>: The Platform may feature advertisements, promotions, and content from third parties. AlphaMarket is not responsible for such content and does not endorse third-party claims or advertisements.</li>
        <li><strong>License</strong>: Users are granted a limited, non-exclusive license to access and use the Platform for personal purposes only. Any misuse or violation of this license may result in termination of account access.</li>
      </ol>

      <h4>3. User Obligations</h4>
      <p>By using the Platform, Users agree to:</p>
      <ol>
        <li><strong>Provide Accurate Information</strong>: Ensure all information provided during registration and use is accurate and up-to-date.</li>
        <li><strong>Maintain Account Security</strong>: Protect login credentials and immediately report unauthorized access to AlphaMarket.</li>
        <li><strong>Compliance with Laws</strong>: Use the Platform in accordance with all applicable laws, including SEBI regulations, and refrain from fraudulent or illegal activities, including unauthorized financial advice or insider trading.</li>
        <li><strong>Engage Authorized Advisors Only</strong>: Users should engage only SEBI-registered advisors for investment services and acknowledge that investment decisions made based on Platform content are solely at their discretion.</li>
      </ol>

      <h4>4. Subscription and Payment Terms</h4>
      <ol>
        <li><strong>Subscription Pricing</strong>: AlphaMarket allows advisors to offer subscription plans for their financial strategies. All payments are made directly between the User and the respective advisor, as authorized during the subscription process.</li>
        <li><strong>Auto-Renewal and Cancellation</strong>: Certain subscription plans may automatically renew, subject to advisor policies. Cancellations and refunds are governed by the advisor's terms and must be addressed with the respective advisor directly. Please refer to AlphaMarket's Cancellation and Refund Policies mentioned in the footer section of the website for a more detailed cancellation and refund process.</li>
        <li><strong>Failure to Complete Registration</strong>: Users who fail to complete account setup or complete their EKYC and Risk Profiling on the Platform may be contacted by AlphaMarket to assist in the process and might also lead to temporary suspension of their access to the respective strategies that they might have subscribed to. Once users complete the EKYC and Risk Profiling their access will be restarted within 24 hours. It is the responsibility of the Users to complete the EKYC and Risk Profiling on their own and if they are having any issue they can write and raise a support ticket at hello@thealphamarket.com to get the issue resolved.</li>
      </ol>

      <h4>5. Prohibited Activities</h4>
      <p>Users must refrain from:</p>
      <ol>
        <li><strong>Unauthorized Platform Use</strong>: Reverse-engineering, data scraping, copying, or creating derivative works based on the Platform is prohibited.</li>
        <li><strong>Impersonation and Fraud</strong>: Users must not impersonate others or engage in fraud, money laundering, or similar unlawful activities.</li>
        <li><strong>Security Violations</strong>: Engaging in actions that compromise Platform security, including attempts to disrupt or interfere with operations (e.g., DDoS attacks), is strictly forbidden.</li>
        <li><strong>Misuse of Services</strong>: Misrepresenting, sharing, or using Platform content for purposes not permitted by AlphaMarket is prohibited.</li>
      </ol>

      <h4>6. Liability Disclaimer and Warranties</h4>
      <ol>
        <li><strong>No Warranty of Accuracy</strong>: AlphaMarket does not warrant the completeness, accuracy, or reliability of content published on the Platform by advisors or other third parties.</li>
        <li><strong>Limitation of Liability</strong>: AlphaMarket, its affiliates, and Associate Companies shall not be liable for any losses or damages arising from Platform use, reliance on advisor strategies, or interruptions in service.</li>
        <li><strong>Platform Availability</strong>: AlphaMarket does not guarantee uninterrupted access to the Platform and may conduct updates or maintenance as necessary.</li>
        <li><strong>User Responsibility</strong>: Users acknowledge they are solely responsible for investment decisions made based on Platform content and agree to conduct their own research prior to engaging with advisor strategies.</li>
      </ol>

      <h4>7. Indemnity</h4>
      <p>Users agree to indemnify and hold harmless AlphaMarket, its affiliates, officers, and employees against any claims or damages arising from User activities on the Platform, including violations of these Terms or applicable laws.</p>

      <h4>8. Governing Law and Jurisdiction</h4>
      <p>This Agreement is governed by Indian law, and any disputes shall be subject to the jurisdiction of the courts in Bengaluru, India.</p>

      <h4>9. Privacy and Data Collection</h4>
      <ol>
        <li><strong>Data Collection</strong>: Users consent to the collection and storage of personal and financial data required to access services. AlphaMarket uses this data per its Privacy Policy, which Users are encouraged to review.</li>
        <li><strong>Third-Party Services</strong>: Certain services on the Platform are provided by third parties, and their terms and privacy policies apply to those services.</li>
      </ol>

      <h4>10. Modifications to Terms and Privacy Policy</h4>
      <p>AlphaMarket reserves the right to amend these Terms and the Privacy Policy at any time. Notice of changes will be posted on the Platform, and continued use of the Platform constitutes acceptance of the revised Terms.</p>

      <h4>11. Acceptance of Terms</h4>
      <p>By accessing AlphaMarket, you acknowledge that you have read, understood, and agree to the Terms of this Agreement, including all related policies.</p>

      <h4>Contact Us</h4>
      <p>If you have any questions about these Terms and Conditions, please contact us at <a href="mailto:hello@thealphamarket.com">hello@thealphamarket.com</a></p>
    </LegalPageLayout>
  );
}

export function CancellationPolicy() {
  return (
    <LegalPageLayout title="Cancellation & Refund Policy" lastUpdated="November 11, 2023">
      <Helmet>
        <title>Cancellation & Refund Policy | AlphaMarket</title>
        <meta name="description" content="AlphaMarket Cancellation and Refund Policy for Investment Advisory Services subscriptions." />
      </Helmet>

      <h4>1. Cancellation of Advisory Services Subscription</h4>
      <ul>
        <li>Users of AlphaMarket have the right to cancel their subscription to Investment Advisory Services offered by SEBI Registered Investment Advisors through the website. However, it is essential to understand that the cancellation policies may vary depending on the specific advisor. Please review the terms and conditions provided by the respective advisor for their cancellation policy.</li>
      </ul>

      <h4>2. Refund Policy</h4>
      <ul>
        <li>The refund policy for Investment Advisory Services subscriptions on AlphaMarket is determined by the individual SEBI Registered Investment Advisors, and users are encouraged to review the advisor's specific refund policy before subscribing to their services.</li>
        <li>In case of any disputes or discrepancies regarding refunds, users may contact the respective Investment Advisor directly or reach out to our customer support team for assistance. We will make reasonable efforts to mediate and resolve any issues that may arise.</li>
      </ul>

      <h4>3. Dispute Resolution</h4>
      <ul>
        <li>In the event of disputes or disagreements between users and SEBI Registered Investment Advisors regarding cancellations or refunds, AlphaMarket may assist in facilitating communication between the parties to reach an amicable resolution. However, it is important to note that the ultimate decision regarding refunds rests with the Investment Advisor, and their policies will prevail.</li>
      </ul>

      <h4>4. Contact Us</h4>
      <ul>
        <li>If you have questions or concerns about our Cancellation and Refund Policy, please contact our customer support team at <a href="mailto:hello@thealphamarket.com">hello@thealphamarket.com</a></li>
      </ul>

      <p>Please note that Edhaz Financial Services Private Limited is not responsible for refunds or cancellations directly but may assist in facilitating communication between users and SEBI Registered Investment Advisors. Users are encouraged to carefully review the policies of the specific advisors they engage with through the marketplace.</p>
    </LegalPageLayout>
  );
}

export function PrivacyPolicy() {
  return (
    <LegalPageLayout title="Privacy Policy" lastUpdated="Oct 15, 2024">
      <Helmet>
        <title>Privacy Policy | AlphaMarket</title>
        <meta name="description" content="AlphaMarket Privacy Policy - Learn how we collect, use, and protect your personal information when using our platform." />
      </Helmet>

      <p>Welcome to AlphaMarket, a product of Edhaz Financial Services Private Limited ("we," "us," or "our"). We are committed to protecting and respecting your privacy. This Privacy Policy outlines how we collect, use, and protect the information you provide to us when using our website (the "Site"), as well as services and features offered through the Site (collectively, the "Services").</p>
      <p>By accessing or using our Services, you agree to the collection, use, and disclosure of information in accordance with this Privacy Policy. If you do not agree with this Privacy Policy, please do not use our Services.</p>

      <h4>1. Information We Collect</h4>
      <p>We may collect and process the following information about you:</p>

      <h5>1.1 Information You Provide to Us</h5>
      <ul>
        <li><strong>Personal Information</strong>: When you register with AlphaMarket, contact us, or use our Services, we may collect information including, but not limited to, your name, email address, phone number, address, and other information you provide.</li>
        <li><strong>Payment Information</strong>: If you subscribe to any paid Services, we may collect payment-related information, including your credit/debit card details, billing address, and transaction history.</li>
        <li><strong>Investment and Financial Information</strong>: For Services related to financial advisory or investment tracking, we may collect information about your financial goals, investment preferences, risk tolerance, and other relevant information.</li>
      </ul>

      <h5>1.2 Information We Collect Automatically</h5>
      <ul>
        <li><strong>Log Data</strong>: When you access our Services, we automatically collect information about your interactions, such as IP address, browser type, operating system, referral URLs, and device information.</li>
        <li><strong>Cookies and Tracking Technologies</strong>: We use cookies and similar technologies to enhance your experience, analyze usage patterns, and offer personalized content. You can adjust your browser settings to manage cookies; however, certain features may not be available if you disable cookies.</li>
      </ul>

      <h5>1.3 Information from Third Parties</h5>
      <ul>
        <li><strong>Service Providers and Partners</strong>: We may receive information about you from third-party providers, such as advisors, or analytics services, to enhance your experience and offer relevant insights.</li>
      </ul>

      <h4>2. Use of Personal Information</h4>
      <p>In general, the personal information you submit to us is used either to respond to requests you make or to help us serve you better. We use such personal information in the following ways:</p>
      <ul>
        <li><strong>To Identify and Authenticate</strong>: To recognize you as a registered user in our system and to provide enhanced administrative support across the Platform.</li>
        <li><strong>Service Delivery</strong>: To provide, maintain, and improve the quality and functionality of our Platform and Services, including fulfilling any requests you make.</li>
        <li><strong>Enhancing User Experience</strong>: To improve your experience when you interact with the Platform and Services, including personalization of recommendations and feedback.</li>
        <li><strong>Communications</strong>: To send you email notifications, service updates, and other relevant communications. Additionally, we may send newsletters, surveys, offers, and promotional materials related to our Services and for other marketing purposes.</li>
        <li><strong>Customer and Market Analysis</strong>: For the purposes of market research, statistical analysis, and overall customer insights to develop our Services.</li>
        <li><strong>Protective and Legal Purposes</strong>: To protect the integrity of our services, prevent and detect fraud or abuse, and investigate any potentially unlawful or prohibited activities.</li>
        <li><strong>Compliance with Regulatory Requirements</strong>: Information such as demographic details, financial details, investment details, and identifiers such as PAN/Aadhaar may be shared with regulated entities, including but not limited to SEBI-registered entities (Investment Advisors, Research Analysts, Brokers, NBFCs, and Banks), Credit Bureaus, and other applicable regulatory bodies for mandatory compliance, such as Know Your Customer (KYC) and Anti-Money Laundering (AML) obligations.</li>
      </ul>

      <h4>3. Sharing of Information</h4>
      <p>We do not sell, rent, or otherwise share your personal information with third parties except as follows:</p>
      <ul>
        <li><strong>With Your Consent</strong>: We may share your information with third parties when you consent to such sharing.</li>
        <li><strong>Service Providers</strong>: We may share information with third-party service providers who assist us in providing Services, such as payment processors, customer support, and analytics.</li>
        <li><strong>Legal Compliance and Protection</strong>: We may disclose your information to law enforcement or regulatory authorities if required by law, to protect the rights, property, or safety of AlphaMarket, our users, or the public.</li>
        <li><strong>Business Transfers</strong>: In the event of a merger, acquisition, reorganization, or sale of assets, we may transfer your information to the relevant third party.</li>
      </ul>

      <h4>4. Data Security</h4>
      <p>We employ security measures to protect your information against unauthorized access, alteration, disclosure, or destruction. However, no transmission over the internet or electronic storage method is entirely secure, and we cannot guarantee absolute security.</p>

      <h4>5. Your Rights and Choices</h4>
      <ul>
        <li><strong>Access and Correction</strong>: You have the right to access and correct your personal information. Please contact us to request changes or review your information.</li>
        <li><strong>Data Portability</strong>: Subject to applicable law, you may request a copy of your personal information in a machine-readable format.</li>
        <li><strong>Data Deletion</strong>: You may request the deletion of your information, subject to applicable legal requirements for record retention.</li>
        <li><strong>Marketing Opt-Out</strong>: You may opt out of marketing communications by following the unsubscribe instructions in emails or adjusting your settings in your account.</li>
      </ul>

      <h4>6. Retention of Information</h4>
      <p>We retain your personal information only as long as necessary to fulfill the purposes outlined in this Privacy Policy or as required by law. When your information is no longer needed, we will delete it or anonymize it.</p>

      <h4>7. Cookies and Tracking Technologies</h4>
      <p>We use cookies, web beacons, and similar technologies to enhance your experience. Cookies allow us to recognize you and track usage patterns on the Site. You can control your cookie settings through your browser, but some features of our Services may be impacted.</p>

      <h4>8. Third-Party Links</h4>
      <p>Our Services may contain links to third-party websites or services. This Privacy Policy does not apply to those third-party sites, and we encourage you to review their privacy policies before sharing any information.</p>

      <h4>9. Children's Privacy</h4>
      <p>Our Services are not directed to children under the age of 18. We do not knowingly collect personal information from minors. If we discover that a minor has provided us with personal information, we will take steps to delete such information promptly.</p>

      <h4>10. Data Transfers</h4>
      <p>AlphaMarket strictly complies with the Information Technology (Reasonable Security Practices and Procedures and Sensitive Personal Data or Information) Rules, 2011, under the Information Technology Act, 2000, along with other applicable Indian data privacy laws. We ensure that all personal data collected is securely stored within India and do not transfer or store any data internationally.</p>
      <p>Your data is never shared or transferred to third parties without your explicit consent, except when required by law or regulatory authorities. We have implemented stringent security measures and data protection protocols to maintain confidentiality and integrity and prevent unauthorized access, use, or disclosure of your personal information.</p>
      <p>By using our Services, you acknowledge and agree to the secure storage of your information within India, in full compliance with Indian laws and regulations.</p>

      <h4>11. Changes to This Privacy Policy</h4>
      <p>We may update this Privacy Policy from time to time. The revised Privacy Policy will be effective as of the date it is posted. Please review this Privacy Policy periodically to stay informed of any changes.</p>

      <h4>12. Contact Us</h4>
      <p>If you have any questions, concerns, or requests regarding this Privacy Policy or your personal information, please contact us at:</p>
      <p><strong>AlphaMarket</strong><br />Edhaz Financial Services Private Limited<br /><a href="mailto:hello@thealphamarket.com">hello@thealphamarket.com</a></p>
    </LegalPageLayout>
  );
}

export function LegalAgreement() {
  return (
    <LegalPageLayout title="Disclosures - Edhaz Financial Services Private Limited" lastUpdated="Oct 15, 2024">
      <Helmet>
        <title>Legal Disclosures | AlphaMarket</title>
        <meta name="description" content="AlphaMarket legal disclosures by Edhaz Financial Services Private Limited - transparency about our role as a technology platform." />
      </Helmet>

      <h4>About Us</h4>
      <p>Edhaz Financial Services Private Limited (referred to as "the Company") is a financial technology provider based in Bangalore, dedicated to supporting investors and advisors by providing cutting-edge technology platforms. The Company is committed to enhancing transparency and accessibility in investment advisory services across India.</p>

      <h4>What is an AlphaMarket?</h4>
      <p>AlphaMarket offers a range of carefully structured strategies created by SEBI-registered Investment Advisors and Research Analysts. These strategies, published on AlphaMarket, cover various investment approaches -- including long-term, intraday, and F&O (Futures & Options) -- and are grounded in the advisors' unique research methodologies, catering to diverse financial goals and risk profiles.</p>

      <h4>Creation of Strategies in AlphaMarkets</h4>
      <p>SEBI-registered Investment Advisors and Research Analysts publish their strategies on the AlphaMarket marketplace platform, utilizing our technology solutions and infrastructure to facilitate efficient subscription and transaction capabilities. Some AlphaMarkets are accessible through the Company's website and app, depending on agreements with the respective SEBI-registered entities. While AlphaMarket provides the technology to host these strategies, we do not create investment advice or research recommendations ourselves. All insights and advice presented on our platform are exclusively those of the SEBI-registered entities, which are authorized to offer such guidance. For specific disclosures by these entities, please refer to the Factsheet associated with each AlphaMarket.</p>

      <h4>Purpose of Displayed Information</h4>
      <p>All information, including returns and ratios shown on the AlphaMarket Platform (both mobile and web), is purely informational to assist users in making informed investment decisions. These tools present factual, verifiable information and should not be viewed as advertising or promotional material.</p>

      <h4>Regulatory Registrations and Certifications</h4>
      <p>Registration with SEBI, BASL membership, or NISM certification does not guarantee the performance of the intermediary or assure returns for investors.</p>

      <h4>User-Created AlphaMarkets</h4>
      <p>Users may also create AlphaMarkets for personal investment purposes and share them with a limited number of other users for knowledge sharing. Such user-created AlphaMarkets should not be interpreted as investment advice or research reports by anyone other than the creator. It's advised not to make investments in these AlphaMarkets without consulting a qualified SEBI-registered intermediary.</p>

      <h4>Returns Calculation</h4>
      <p>Unless stated otherwise, returns displayed for AlphaMarkets on the website are based on absolute return calculations.</p>

      <h4>Content for Informational Purposes Only</h4>
      <p>All content, data, and visual information (e.g., AlphaMarket return figures, index values) provided on AlphaMarket, including blog posts and any percentage returns, are for illustrative purposes only. No information on our platform should be considered an advertisement, solicitation, endorsement, financial advice, or an offer for the Company's or third-party products or services.</p>

      <h4>Performance and Analytics</h4>
      <p>Performance charts and metrics on the platform apply only to AlphaMarkets created by SEBI-registered intermediaries. Edhaz Financial Services does not guarantee or assert the performance or returns of any AlphaMarket, as we only offer tools for SEBI-registered entities to perform performance calculations based on our Returns Calculation Methodology. All investment recommendations and services are provided by the respective SEBI-registered entities.</p>

      <h4>Independent Nature of AlphaMarkets</h4>
      <p>AlphaMarkets are not index-linked products, and the Company does not engage in index manufacturing. Consequently, AlphaMarkets should not be considered products tied to an NSE-based index. While AlphaMarkets may reference external index performance for comparison purposes, such comparisons are illustrative and not indicative of guaranteed results.</p>

      <h4>Domestic Use of AlphaMarkets</h4>
      <p>AlphaMarkets are currently available only in India and are not licensed for any exchanges, trading platforms, or venues outside the country.</p>

      <h4>Pricing Information</h4>
      <p>Prices shown on AlphaMarket may experience delays. All pricing data is sourced from an exchange-approved vendor, and while we aim to ensure accuracy, we do not guarantee these prices. Prior to placing an order, users are redirected to their broker's platform to access real-time prices and complete transactions securely and in compliance with applicable regulations.</p>

      <h4>Investment Responsibility</h4>
      <p>All information provided on AlphaMarket is to assist investors in making informed decisions and does not constitute an endorsement of any specific investment strategy. Investors must independently validate all information before making investment decisions. Investment choices should consider individual financial needs and risk tolerance, as performance data on AlphaMarket represents only one factor among many. Past performance does not assure future outcomes, and investing in the securities market entails inherent risks. Investors are encouraged to read all relevant documents thoroughly before investing.</p>

      <h4>Company's Role as Technology Provider</h4>
      <p>Edhaz Financial Services is solely a technology provider, not an intermediary as per applicable SEBI regulations. Any information, content, or posts on our platform -- whether accessed freely or through subscription -- should not be seen as investment advice or research analysis as defined by the SEBI (Investment Advisers) Regulations, 2013, or the SEBI (Research Analyst) Regulations, 2014. The Company assumes no liability for any loss caused, directly or indirectly, by actions taken based on content created and/or published on the platform. We do not endorse, sponsor, or verify the content published by users and are not accountable for the accuracy or validity of user-generated posts or information on the platform.</p>

      <h4>Disclaimer on Information Accuracy</h4>
      <p>The data and views presented herein are gathered in good faith from sources considered reliable but have not undergone independent verification. No explicit or implied warranty regarding the accuracy, completeness, or correctness of such information is provided. All information and opinions are subject to change without notice, and Edhaz Financial Services reserves the right to update this document as needed. This document is intended for informational purposes only and should not be construed as investment advice or an endorsement of any entity, security, or strategy.</p>
    </LegalPageLayout>
  );
}

export function ShippingAndReturns() {
  return (
    <LegalPageLayout title="Shipping and Delivery Policy" lastUpdated="November 11, 2023">
      <Helmet>
        <title>Shipping & Delivery Policy | AlphaMarket</title>
        <meta name="description" content="AlphaMarket Shipping and Delivery Policy - Our services are entirely digital with no physical shipment involved." />
      </Helmet>

      <h4>Nature of Services</h4>
      <p>At AlphaMarket, we connect Indian customers with SEBI Registered Investment Advisors to facilitate the provision of Investment Advisory Services. Our services are entirely digital in nature and do not involve the physical shipment or delivery of any products. All communication and advisory services are provided in digital format via emails, web notifications, WhatsApp communication, and other electronic means.</p>

      <h5>Digital Delivery</h5>
      <ul>
        <li>Upon subscribing to the Investment Advisory Services offered by the SEBI Registered Investment Advisor of your choice, you will receive access to the advisory services in digital format. This may include but is not limited to investment reports, recommendations, market updates, and other advisory materials.</li>
      </ul>

      <h4>Delivery Method</h4>
      <p>Customers receive digital delivery of investment advisory services and communication through various channels, including:</p>
      <ul>
        <li><strong>Secure Online Portals</strong>: Customers log in to their secure online accounts to access investment recommendations, performance reports, and other relevant information.</li>
        <li><strong>Email Notifications</strong>: Customers receive email notifications about investment updates, performance summaries, and important announcements.</li>
        <li><strong>WhatsApp Communication</strong>: RIA's can also broadcast their advisory services through AlphaMarket's WhatsApp communication gateway.</li>
      </ul>

      <h5>Communication Channels</h5>
      <ul>
        <li>Our platform provides various communication channels for the RIA's to broadcast their advisory services. These channels may include email, web notifications, WhatsApp, and more.</li>
      </ul>

      <h4>Delivery Timeframes</h4>
      <ul>
        <li>The timing of digital delivery and communication is determined by the SEBI Registered Investment Advisor with whom you choose to engage. The specific delivery times, response times, and advisory schedules will be outlined in the terms and conditions provided by the advisor.</li>
      </ul>

      <h4>Refund and Cancellation</h4>
      <ul>
        <li>As outlined in our Cancellation and Refund Policy, we encourage users to review the policies of the individual Investment Advisors regarding cancellations and refunds for their advisory services.</li>
      </ul>

      <h4>Delivery Terms</h4>
      <p>Delivery of investment advisory services and communication is subject to the following terms:</p>
      <ul>
        <li><strong>Internet Connectivity</strong>: Customers require access to a stable internet connection to access the online portals and receive email notifications.</li>
        <li><strong>Device Compatibility</strong>: Customers should ensure their devices are compatible with the online portals and communication channels used by AlphaMarket.</li>
        <li><strong>Subscription Status</strong>: Customers must maintain an active subscription to the RIA's services to receive continuous delivery of investment advice and communication.</li>
      </ul>

      <h4>No Physical Delivery</h4>
      <p>Please note that AlphaMarket does not involve the physical delivery of any products or materials. All services and communication are provided in digital format through the channels mentioned above.</p>

      <h4>Contact Us</h4>
      <p>If you have any questions or concerns regarding our Shipping and Delivery Policy or any other aspect of our services, please do not hesitate to contact our customer support team at <a href="mailto:hello@thealphamarket.com">hello@thealphamarket.com</a></p>
    </LegalPageLayout>
  );
}

export function ContactUs() {
  return (
    <LegalPageLayout title="Contact Us" lastUpdated="">
      <Helmet>
        <title>Contact Us | AlphaMarket</title>
        <meta name="description" content="Get in touch with AlphaMarket - Contact us via phone, email, or visit our office in Bangalore, Karnataka, India." />
      </Helmet>

      <p className="text-base text-foreground">We would love to hear from you</p>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6 not-prose">
        <div className="rounded-md border p-5">
          <h4 className="font-semibold text-foreground mb-2">Call</h4>
          <a href="tel:+919108967788" className="text-primary underline text-sm">+91 9108967788</a>
        </div>
        <div className="rounded-md border p-5">
          <h4 className="font-semibold text-foreground mb-2">Mail</h4>
          <a href="mailto:hello@thealphamarket.com" className="text-primary underline text-sm">hello@thealphamarket.com</a>
        </div>
        <div className="rounded-md border p-5">
          <h4 className="font-semibold text-foreground mb-2">Location</h4>
          <p className="text-sm text-muted-foreground">Doddanekkundi, Bangalore, Karnataka, India, 560037</p>
        </div>
      </div>
    </LegalPageLayout>
  );
}

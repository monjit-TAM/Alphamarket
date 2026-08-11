import { Link } from "wouter";
import { TrendingUp } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

interface FooterLink { label: string; url: string; }
interface FooterColumn { heading: string; links: FooterLink[]; }

const DEFAULT_COLUMNS: FooterColumn[] = [
  { heading: "Advisors", links: [
    { label: "Browse Advisors", url: "/advisors" },
    { label: "Partnerships", url: "" },
    { label: "Data Partners", url: "" },
  ]},
  { heading: "Company", links: [
    { label: "Careers", url: "" },
    { label: "Press", url: "" },
  ]},
  { heading: "Disclosures", links: [
    { label: "Privacy Policy", url: "/privacy-policy" },
    { label: "Terms and Conditions", url: "/terms-and-conditions" },
    { label: "Legal Disclosures", url: "/legal-agreement" },
    { label: "Cancellation & Refund", url: "/cancellation-policy" },
    { label: "Shipping & Delivery", url: "/shipping-and-delivery" },
  ]},
  { heading: "About us", links: [
    { label: "Contact Us", url: "/contact-us" },
    { label: "Site Map", url: "/sitemap.xml" },
  ]},
];

const DEFAULT_TAGLINE = "India's premier SaaS platform connecting SEBI-registered advisors with investors and brokers.";
const DEFAULT_DISCLAIMER = "AlphaMarket connects investors with advisors to receive advice on investing or trading in stock market, commodity, and F&O segments. Investment in securities market is subject to market risk. Read all related documents carefully before investing.";

export function Footer() {
  const { data: siteContent } = useQuery<any>({ queryKey: ["/api/site-content"] });
  const columns: FooterColumn[] = siteContent?.footerColumns?.length ? siteContent.footerColumns : DEFAULT_COLUMNS;
  const tagline = siteContent?.footerTagline || DEFAULT_TAGLINE;
  const disclaimer = siteContent?.footerDisclaimer || DEFAULT_DISCLAIMER;

  return (
    <footer className="border-t bg-muted/30">
      <div className="max-w-7xl mx-auto px-4 md:px-6 py-10">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
          <div className="col-span-2 md:col-span-1">
            <Link href="/">
              <div className="flex items-center gap-2 cursor-pointer mb-3" data-testid="footer-logo">
                <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary">
                  <TrendingUp className="w-5 h-5 text-primary-foreground" />
                </div>
                <span className="font-semibold text-lg tracking-tight">
                  Alpha<span className="text-primary">Market</span>
                </span>
              </div>
            </Link>
            <p className="text-xs text-muted-foreground leading-relaxed">{tagline}</p>
          </div>
          {columns.map((col, ci) => (
            <div key={ci}>
              <h4 className="font-semibold text-sm mb-3">{col.heading}</h4>
              <ul className="space-y-1.5 text-sm text-muted-foreground">
                {col.links.map((link, li) => (
                  <li key={li}>
                    {link.url ? (
                      link.url.startsWith("http") ? (
                        <a href={link.url} target="_blank" rel="noopener noreferrer" className="hover:text-foreground transition-colors">{link.label}</a>
                      ) : (
                        <Link href={link.url} className="hover:text-foreground transition-colors">{link.label}</Link>
                      )
                    ) : (
                      <span className="cursor-default">{link.label}</span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-8 pt-6 border-t text-center text-xs text-muted-foreground">
          {disclaimer}
        </div>
      </div>
    </footer>
  );
}

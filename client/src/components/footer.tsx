import { Link } from "wouter";
import { TrendingUp } from "lucide-react";

export function Footer() {
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
            <p className="text-xs text-muted-foreground leading-relaxed">
              India's premier SaaS platform connecting SEBI-registered advisors with investors and brokers.
            </p>
          </div>
          <div>
            <h4 className="font-semibold text-sm mb-3">Advisors</h4>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              <li><Link href="/advisors" className="hover:text-foreground transition-colors" data-testid="footer-link-advisors">Browse Advisors</Link></li>
              <li className="cursor-default">Partnerships</li>
              <li className="cursor-default">Data Partners</li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-sm mb-3">Company</h4>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              <li className="cursor-default">Careers</li>
              <li className="cursor-default">Press</li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-sm mb-3">Disclosures</h4>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              <li><Link href="/privacy-policy" className="hover:text-foreground transition-colors" data-testid="footer-link-privacy">Privacy Policy</Link></li>
              <li><Link href="/terms-and-conditions" className="hover:text-foreground transition-colors" data-testid="footer-link-terms">Terms and Conditions</Link></li>
              <li><Link href="/legal-agreement" className="hover:text-foreground transition-colors" data-testid="footer-link-legal">Legal Disclosures</Link></li>
              <li><Link href="/cancellation-policy" className="hover:text-foreground transition-colors" data-testid="footer-link-cancellation">Cancellation & Refund</Link></li>
              <li><Link href="/shipping-and-delivery" className="hover:text-foreground transition-colors" data-testid="footer-link-shipping">Shipping & Delivery</Link></li>
            </ul>
          </div>
          <div>
            <h4 className="font-semibold text-sm mb-3">About us</h4>
            <ul className="space-y-1.5 text-sm text-muted-foreground">
              <li><Link href="/contact-us" className="hover:text-foreground transition-colors" data-testid="footer-link-contact">Contact Us</Link></li>
              <li><Link href="/sitemap.xml" className="hover:text-foreground transition-colors" data-testid="footer-link-sitemap">Site Map</Link></li>
            </ul>
          </div>
        </div>
        <div className="mt-8 pt-6 border-t text-center text-xs text-muted-foreground">
          AlphaMarket connects investors with advisors to receive advice on investing or
          trading in stock market, commodity, and F&O segments. Investment in securities market
          is subject to market risk. Read all related documents carefully before investing.
        </div>
      </div>
    </footer>
  );
}

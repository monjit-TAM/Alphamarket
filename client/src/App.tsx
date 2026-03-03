import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { HelmetProvider } from "react-helmet-async";
import { AuthProvider } from "@/lib/auth";
import NotFound from "@/pages/not-found";
import Home from "@/pages/home";
import { LoginPage, RegisterPage } from "@/pages/auth";
import StrategiesMarketplace from "@/pages/strategies-marketplace";
import StrategyDetail from "@/pages/strategy-detail";
import AdvisorsListing from "@/pages/advisors-listing";
import AdvisorDetail from "@/pages/advisor-detail";
import Dashboard from "@/pages/dashboard/index";
import AdminDashboard from "@/pages/admin/index";
import MarketOutlook from "@/pages/market-outlook";
import LearnPage from "@/pages/learn";
import ContentDetail from "@/pages/content-detail";
import ForgotPasswordPage from "@/pages/forgot-password";
import ResetPasswordPage from "@/pages/reset-password";
import SubscribePage from "@/pages/subscribe";
import PaymentPage from "@/pages/payment";
import AgreementPage from "@/pages/agreements";
import PaymentCallbackPage from "@/pages/payment-callback";
import InvestorDashboard from "@/pages/investor-dashboard";
import RiskProfilingPage from "@/pages/risk-profiling";
import EkycPage from "@/pages/ekyc";
import EsignAgreementPage from "@/pages/esign-agreement";
import StrategyPerformance from "@/pages/strategy-performance";
import { TermsAndConditions, CancellationPolicy, PrivacyPolicy, LegalAgreement, ShippingAndReturns, ContactUs } from "@/pages/legal";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/login" component={LoginPage} />
      <Route path="/register" component={RegisterPage} />
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/strategies" component={StrategiesMarketplace} />
      <Route path="/strategies/:id/subscribe" component={SubscribePage} />
      <Route path="/strategies/:id/esign-agreement" component={EsignAgreementPage} />
      <Route path="/strategies/:id/payment" component={PaymentPage} />
      <Route path="/strategies/:id/performance" component={StrategyPerformance} />
      <Route path="/strategies/:id" component={StrategyDetail} />
      <Route path="/advisors" component={AdvisorsListing} />
      <Route path="/advisors/:id" component={AdvisorDetail} />
      <Route path="/market-outlook" component={MarketOutlook} />
      <Route path="/learn" component={LearnPage} />
      <Route path="/content/:id" component={ContentDetail} />
      <Route path="/agreements/:type" component={AgreementPage} />
      <Route path="/payment-callback" component={PaymentCallbackPage} />
      <Route path="/investor-dashboard" component={InvestorDashboard} />
      <Route path="/risk-profiling" component={RiskProfilingPage} />
      <Route path="/ekyc" component={EkycPage} />
      <Route path="/terms-and-conditions" component={TermsAndConditions} />
      <Route path="/cancellation-policy" component={CancellationPolicy} />
      <Route path="/privacy-policy" component={PrivacyPolicy} />
      <Route path="/legal-agreement" component={LegalAgreement} />
      <Route path="/shipping-and-delivery" component={ShippingAndReturns} />
      <Route path="/contact-us" component={ContactUs} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/dashboard/:rest*" component={Dashboard} />
      <Route path="/admin" component={AdminDashboard} />
      <Route path="/admin/:rest*" component={AdminDashboard} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HelmetProvider>
        <TooltipProvider>
          <AuthProvider>
            <Toaster />
            <Router />
          </AuthProvider>
        </TooltipProvider>
      </HelmetProvider>
    </QueryClientProvider>
  );
}

export default App;

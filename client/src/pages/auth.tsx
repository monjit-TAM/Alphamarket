import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useAuth } from "@/lib/auth";
import { TrendingUp, Loader2, Shield, Upload, FileCheck, X, ChevronDown, ChevronUp, FileText } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Link } from "wouter";
import { useUpload } from "@/hooks/use-upload";

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const user = await login(username, password);
      // Check for redirect param (from stocks or mf subdomains)
      const params = new URLSearchParams(window.location.search);
      const redirect = params.get("redirect");
      if (redirect === "stocks") {
        window.location.href = "https://stocks.alphamarket.co.in";
        return;
      } else if (redirect === "mf") {
        window.location.href = "https://mf.alphamarket.co.in";
        return;
      } else if (user.role === "admin") {
        navigate("/admin");
      } else if (user.role === "advisor") {
        navigate("/dashboard");
      } else {
        navigate("/strategies");
      }
    } catch (err: any) {
      toast({ title: "Login failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  // Build social login URL with redirect param preserved
  const params = new URLSearchParams(window.location.search);
  const redirect = params.get("redirect");
  const googleUrl = redirect ? `/api/auth/google?redirect=${redirect}` : "/api/auth/google";
  const githubUrl = redirect ? `/api/auth/github?redirect=${redirect}` : "/api/auth/github";

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center space-y-2">
          <Link href="/">
            <div className="flex items-center justify-center gap-2 cursor-pointer mb-2">
              <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary">
                <TrendingUp className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="font-semibold text-lg">AlphaMarket</span>
            </div>
          </Link>
          <CardTitle>Welcome back</CardTitle>
          <CardDescription>Sign in to your account</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="username">Username or Email</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Enter username or email"
                required
                data-testid="input-username"
              />
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-1">
                <Label htmlFor="password">Password</Label>
                <Link href="/forgot-password" className="text-xs text-primary font-medium" data-testid="link-forgot-password">
                  Forgot Password?
                </Link>
              </div>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                data-testid="input-password"
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading} data-testid="button-login">
              {loading && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Sign In
            </Button>
            <div className="relative my-2">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">or continue with</span>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <a
                href={googleUrl}
                className="inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24">
                  <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
                  <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
                  <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
                  <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
                </svg>
                Google
              </a>
              <a
                href={githubUrl}
                className="inline-flex items-center justify-center gap-2 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                </svg>
                GitHub
              </a>
            </div>
            <p className="text-center text-sm text-muted-foreground">
              Don't have an account?{" "}
              <Link href="/register" className="text-primary font-medium">
                Register
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

const ALLOWED_FILE_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const ALLOWED_EXTENSIONS = ".pdf,.jpg,.jpeg,.png,.doc,.docx";

export function RegisterPage() {
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
    phone: "",
    role: "investor" as "investor" | "advisor",
    companyName: "",
    sebiRegNumber: "",
    sebiCertUrl: "",
    agreementConsent: false,
  });
  const [loading, setLoading] = useState(false);
  const [uploadedFile, setUploadedFile] = useState<{ name: string; path: string } | null>(null);
  const [agreement1Open, setAgreement1Open] = useState(false);
  const [agreement2Open, setAgreement2Open] = useState(false);
  const [agreement1Checked, setAgreement1Checked] = useState(false);
  const [agreement2Checked, setAgreement2Checked] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { register } = useAuth();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const { uploadFile, isUploading, progress } = useUpload({
    onSuccess: (response) => {
      setUploadedFile({ name: response.metadata.name, path: response.objectPath });
      setForm((prev) => ({ ...prev, sebiCertUrl: response.objectPath }));
      toast({ title: "Certificate uploaded successfully" });
    },
    onError: (err) => {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    },
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!ALLOWED_FILE_TYPES.includes(file.type)) {
      toast({
        title: "Invalid file type",
        description: "Please upload a PDF, JPEG, PNG, or Word document.",
        variant: "destructive",
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "Maximum file size is 10MB.",
        variant: "destructive",
      });
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    await uploadFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = () => {
    setUploadedFile(null);
    setForm((prev) => ({ ...prev, sebiCertUrl: "" }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password.length < 6) {
      toast({ title: "Password must be at least 6 characters", variant: "destructive" });
      return;
    }
    if (form.password !== form.confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    if (form.role === "advisor" && !form.sebiRegNumber) {
      toast({ title: "SEBI Registration Number is required for advisors", variant: "destructive" });
      return;
    }
    if (form.role === "advisor" && (!agreement1Checked || !agreement2Checked)) {
      toast({ title: "You must agree to both agreements to register as an advisor", variant: "destructive" });
      return;
    }
    setLoading(true);
    const submitData = {
      ...form,
      agreementConsent: form.role === "advisor" ? (agreement1Checked && agreement2Checked) : false,
    };
    try {
      await register(submitData);
      if (form.role === "advisor") {
        toast({
          title: "Registration successful",
          description: "Your advisor account is pending admin approval. You will be notified once approved.",
        });
        navigate("/dashboard");
      } else {
        navigate("/strategies");
      }
    } catch (err: any) {
      toast({ title: "Registration failed", description: err.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <Link href="/">
            <div className="flex items-center justify-center gap-2 cursor-pointer mb-2">
              <div className="flex items-center justify-center w-8 h-8 rounded-md bg-primary">
                <TrendingUp className="w-5 h-5 text-primary-foreground" />
              </div>
              <span className="font-semibold text-lg">AlphaMarket</span>
            </div>
          </Link>
          <CardTitle>Create an account</CardTitle>
          <CardDescription>Join as an Investor or Advisor</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label>I am a</Label>
              <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as any })}>
                <SelectTrigger data-testid="select-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="investor">Investor</SelectItem>
                  <SelectItem value="advisor">Advisor (RA/RIA)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-username">Username</Label>
              <Input
                id="reg-username"
                value={form.username}
                onChange={(e) => setForm({ ...form, username: e.target.value })}
                required
                data-testid="input-reg-username"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-email">Email</Label>
              <Input
                id="reg-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                required
                data-testid="input-reg-email"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-phone">Mobile Number</Label>
              <Input
                id="reg-phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+91 XXXXX-XXXXX"
                data-testid="input-reg-phone"
              />
            </div>
            {form.role === "advisor" && (
              <>
                <div className="space-y-1.5">
                  <Label htmlFor="reg-company">Company / Firm Name</Label>
                  <Input
                    id="reg-company"
                    value={form.companyName}
                    onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                    data-testid="input-reg-company"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reg-sebi">
                    <span className="flex items-center gap-1">
                      <Shield className="w-3 h-3" />
                      SEBI Registration Number *
                    </span>
                  </Label>
                  <Input
                    id="reg-sebi"
                    value={form.sebiRegNumber}
                    onChange={(e) => setForm({ ...form, sebiRegNumber: e.target.value })}
                    placeholder="e.g. INH000012345"
                    required
                    data-testid="input-reg-sebi"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>
                    <span className="flex items-center gap-1">
                      <Upload className="w-3 h-3" />
                      SEBI Registration Certificate
                    </span>
                  </Label>
                  {uploadedFile ? (
                    <div className="flex items-center gap-2 p-2 rounded-md bg-green-50 dark:bg-green-950/20 border border-green-200 dark:border-green-800">
                      <FileCheck className="w-4 h-4 text-green-600 dark:text-green-400 flex-shrink-0" />
                      <span className="text-sm text-green-800 dark:text-green-300 truncate flex-1" data-testid="text-uploaded-file">
                        {uploadedFile.name}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={removeFile}
                        className="flex-shrink-0"
                        data-testid="button-remove-file"
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  ) : (
                    <div>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept={ALLOWED_EXTENSIONS}
                        onChange={handleFileSelect}
                        className="hidden"
                        data-testid="input-file-cert"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="w-full"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isUploading}
                        data-testid="button-upload-cert"
                      >
                        {isUploading ? (
                          <>
                            <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                            Uploading... {progress}%
                          </>
                        ) : (
                          <>
                            <Upload className="w-4 h-4 mr-1" />
                            Upload Certificate
                          </>
                        )}
                      </Button>
                      <p className="text-xs text-muted-foreground mt-1">
                        Accepted: PDF, JPEG, PNG, Word Document (max 10MB)
                      </p>
                    </div>
                  )}
                </div>
                <div className="space-y-3">
                  <Label className="text-sm font-medium flex items-center gap-1">
                    <FileText className="w-3.5 h-3.5" />
                    Advisor Agreements *
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Please read and agree to both agreements to proceed with registration.
                  </p>

                  <div className="border rounded-md overflow-hidden">
                    <button
                      type="button"
                      className="w-full flex items-center justify-between gap-2 p-3 text-left text-sm font-medium hover-elevate"
                      onClick={() => setAgreement1Open(!agreement1Open)}
                      data-testid="button-toggle-agreement-1"
                    >
                      <span>1. Digital Advisor Participation Agreement & Risk Disclaimer</span>
                      {agreement1Open ? <ChevronUp className="w-4 h-4 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 flex-shrink-0" />}
                    </button>
                    {agreement1Open && (
                      <div className="px-3 pb-3 max-h-60 overflow-y-auto text-xs text-muted-foreground leading-relaxed space-y-2 border-t" data-testid="content-agreement-1">
                        <p className="pt-2 font-medium text-foreground">AlphaMarket - Digital Advisor Participation Agreement & Risk Disclaimer</p>
                        <p>Effective Date: Upon acceptance by Advisor during digital onboarding.</p>
                        <p>By clicking "I Agree" or by proceeding with Advisor registration on AlphaMarket, You ("Advisor") acknowledge that You have read, understood, and agreed to be bound by this Digital Advisor Participation Agreement ("Agreement") with Edhaz Financial Services Private Limited, operating the AlphaMarket platform.</p>
                        <p className="font-medium text-foreground">1. Scope & Applicability</p>
                        <p>1.1. This Agreement governs Your participation on AlphaMarket solely in respect of clients acquired through the AlphaMarket platform ("Platform Clients"). 1.2. Nothing in this Agreement applies to clients acquired independently outside the platform. 1.3. By registering on AlphaMarket, You consent that Your relationship with Platform Clients shall also be subject to this Agreement.</p>
                        <p className="font-medium text-foreground">2. Independent Relationship</p>
                        <p>2.1. You participate in Your independent professional capacity as a SEBI-registered Research Analyst / Investment Advisor. 2.2. No partnership, agency, employment, or joint venture is created. 2.3. Platform Clients enter into a direct contractual relationship with You. AlphaMarket is not a party to such contracts.</p>
                        <p className="font-medium text-foreground">3. Compliance Responsibility</p>
                        <p>3.1. You represent and warrant that: You hold a valid SEBI registration; You comply with all applicable SEBI Regulations; You are solely responsible for the accuracy, independence, and integrity of Your research and advice. 3.2. You shall not use AlphaMarket to: Offer assured or guaranteed returns; Collect funds for investment; Issue misleading advertisements.</p>
                        <p className="font-medium text-foreground">4. AlphaMarket's Role & Disclaimer</p>
                        <p>4.1. AlphaMarket functions only as a technology and compliance facilitation platform. 4.2. AlphaMarket does not: Provide investment advice; Validate Your recommendations; Guarantee performance or returns.</p>
                        <p className="font-medium text-foreground">5. Fees & Refunds</p>
                        <p>5.1. All fees from Platform Clients must flow through AlphaMarket's payment system. 5.2. Refunds must comply with SEBI rules. 5.3. AlphaMarket may deduct a platform service fee.</p>
                        <p className="font-medium text-foreground">6. Data Protection & Privacy</p>
                        <p>6.1. Advisors act as data controllers for Platform Client data. 6.2. Advisors are responsible for compliance with IT Act, 2000 and DPDP Act, 2023. 6.3. Any misuse of Platform Client data by You shall be solely Your liability.</p>
                        <p className="font-medium text-foreground">7. Indemnity</p>
                        <p>You agree to indemnify and hold harmless AlphaMarket against any claims, penalties, damages, or liabilities arising from breach of regulations, misrepresentation, negligence, client disputes, or data privacy breaches caused by You.</p>
                        <p className="font-medium text-foreground">8. Jurisdiction & Dispute Resolution</p>
                        <p>8.1. This Agreement is governed by Indian law. 8.2. Disputes shall be subject to the exclusive jurisdiction of the courts of Bangalore, Karnataka.</p>
                        <p className="font-medium text-foreground">9. Termination</p>
                        <p>9.1. AlphaMarket may suspend or terminate Your participation if Your SEBI registration is cancelled, You violate SEBI rules, or Your conduct harms AlphaMarket's reputation. 9.2. Upon termination, You must immediately cease using AlphaMarket's name, logo, or brand.</p>
                        <p className="font-medium text-foreground">10. Binding Effect</p>
                        <p>By clicking "I Agree" or completing registration, You acknowledge this Agreement is legally binding under the Indian Contract Act, 1872 and the Information Technology Act, 2000.</p>
                      </div>
                    )}
                    <div className="flex items-center gap-2 px-3 py-2 border-t bg-muted/30">
                      <Checkbox
                        id="agreement1"
                        checked={agreement1Checked}
                        onCheckedChange={(checked) => setAgreement1Checked(checked === true)}
                        data-testid="checkbox-agreement-1"
                      />
                      <label htmlFor="agreement1" className="text-xs cursor-pointer">
                        I have read and agree to the Digital Advisor Participation Agreement
                      </label>
                    </div>
                  </div>

                  <div className="border rounded-md overflow-hidden">
                    <button
                      type="button"
                      className="w-full flex items-center justify-between gap-2 p-3 text-left text-sm font-medium hover-elevate"
                      onClick={() => setAgreement2Open(!agreement2Open)}
                      data-testid="button-toggle-agreement-2"
                    >
                      <span>2. Investment Advisor & Research Analyst Services Agreement</span>
                      {agreement2Open ? <ChevronUp className="w-4 h-4 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 flex-shrink-0" />}
                    </button>
                    {agreement2Open && (
                      <div className="px-3 pb-3 max-h-60 overflow-y-auto text-xs text-muted-foreground leading-relaxed space-y-2 border-t" data-testid="content-agreement-2">
                        <p className="pt-2 font-medium text-foreground">Investment Advisor and Research Analyst Services Agreement</p>
                        <p>This document is an electronic record in terms of the Information Technology Act, 2000. The online platform www.thealphamarket.com is owned and operated by Edhaz Financial Services Private Limited.</p>
                        <p className="font-medium text-foreground">Part A: Client Consent</p>
                        <p>The Client has read and understood the terms and conditions of this Agreement facilitated by Edhaz Financial Services Private Limited through The AlphaMarket. The fee structure and charging mechanism are standardized between the Client and the SEBI Registered Investment Advisor/Research Analyst.</p>
                        <p className="font-medium text-foreground">Part B: Declaration</p>
                        <p>The advisory relationship commences after successful payment and completion of eKYC and Risk Profiling. The Advisor will not manage funds or securities on behalf of the Client and will only receive payments to cover the fees owed under this Agreement.</p>
                        <p className="font-medium text-foreground">Part C: Fees per SEBI Regulations</p>
                        <p>Clients pay subscription fees for strategies offered by RIAs/RAs. Fees are determined by the Advisor based on subscription duration. Clients may subscribe to multiple strategies from different Advisors simultaneously.</p>
                        <p className="font-medium text-foreground">2. Appointment of the Investment Advisor</p>
                        <p>The Client engages with SEBI Registered Investment Advisors and Research Analysts through The AlphaMarket. The advice will be akin to a model portfolio or generic in nature, and execution discretion lies solely with the Client.</p>
                        <p className="font-medium text-foreground">3. Scope of Services</p>
                        <p>RIAs and RAs provide advice related to investing in, purchasing, selling, or otherwise dealing in stocks. The final analysis and decision to adopt advice is entirely the Client's responsibility.</p>
                        <p className="font-medium text-foreground">5. Obligations of the Investment Advisor</p>
                        <p>The RIA and RA agree to uphold high standards of integrity and fairness, ensure continuous compliance with SEBI eligibility criteria, provide reports to clients, maintain required records, conduct periodic audits, and adhere to the code of conduct under SEBI Regulations.</p>
                        <p className="font-medium text-foreground">7. Representations and Warranties</p>
                        <p>All parties have full power and authority to execute this Agreement. The Agreement constitutes legal, valid, and binding obligations enforceable in accordance with its terms.</p>
                        <p className="font-medium text-foreground">8. Disclaimers</p>
                        <p>The Investment Advisory Services are intended solely as advisory. AlphaMarket and its RIAs/RAs shall not be liable for any losses due to market fluctuations, asset value changes, or performance of securities.</p>
                        <p className="font-medium text-foreground">9-24. Additional Provisions</p>
                        <p>This Agreement covers: Period & Termination, Fees & Billing, Confidentiality, Personal Data, Recording of Communications, Assignment, Amendment, Indemnity, Invalidity, No Waiver, Grievance Settlement (hello@thealphamarket.com), Governing Law (Indian law, Bangalore jurisdiction), Severability, Force Majeure, Entirety, and Relationship.</p>
                        <p className="font-medium text-foreground">Annexure B: Risk Statements</p>
                        <p>The Client acknowledges and understands the risks associated with investments in Securities, equity-linked investments, real estate, derivatives trading, and mutual funds. All investments involve risk of adverse market developments. Trading and investing in derivatives carry high levels of risk including potential for substantial losses.</p>
                        <p className="font-medium text-foreground">Agreement Acceptance</p>
                        <p>By clicking "Agree" or "Submit", the Client consents to and agrees to abide by all terms of this Investment Advisor and Research Analyst Services Agreement. This Agreement is electronically executed.</p>
                      </div>
                    )}
                    <div className="flex items-center gap-2 px-3 py-2 border-t bg-muted/30">
                      <Checkbox
                        id="agreement2"
                        checked={agreement2Checked}
                        onCheckedChange={(checked) => setAgreement2Checked(checked === true)}
                        data-testid="checkbox-agreement-2"
                      />
                      <label htmlFor="agreement2" className="text-xs cursor-pointer">
                        I have read and agree to the Investment Advisor & Research Analyst Services Agreement
                      </label>
                    </div>
                  </div>
                </div>

                <div className="rounded-md bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 p-3">
                  <p className="text-xs text-amber-800 dark:text-amber-300">
                    Your advisor account will be reviewed and approved by our admin team before your profile and strategies become visible to investors.
                  </p>
                </div>
              </>
            )}
            <div className="space-y-1.5">
              <Label htmlFor="reg-password">Password</Label>
              <Input
                id="reg-password"
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
                data-testid="input-reg-password"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reg-confirm-password">Confirm Password</Label>
              <Input
                id="reg-confirm-password"
                type="password"
                value={form.confirmPassword}
                onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                required
                data-testid="input-reg-confirm-password"
              />
              {form.confirmPassword && form.password !== form.confirmPassword && (
                <p className="text-xs text-destructive">Passwords do not match</p>
              )}
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed" data-testid="text-signup-consent">
              By signing up, you have read and agreed to The AlphaMarket's{" "}
              <Link href="/agreements/advisor-participation" className="text-primary underline">T&C</Link>,{" "}
              <Link href="/agreements/ia-ra-services" className="text-primary underline">Privacy Policy</Link> and{" "}
              <Link href="/agreements/ia-ra-services" className="text-primary underline">Disclaimer</Link> and agree to receive calls, SMS, Whatsapp and email communication from Alphamarket.
            </p>
            <Button type="submit" className="w-full" disabled={loading || isUploading} data-testid="button-register">
              {loading && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
              Create Account
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="text-primary font-medium">
                Sign In
              </Link>
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

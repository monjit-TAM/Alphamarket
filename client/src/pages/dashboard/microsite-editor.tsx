import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { Globe, Save, Eye, Upload, Loader2, ExternalLink, ShieldCheck, Plus, Trash2, GripVertical, Building2, Phone, Mail, CreditCard, BarChart3, Users, FileCheck } from "lucide-react";

const DEFAULT_SERVICES = [
  { type: "advisory", name: "Investment Advisory", description: "Stock calls and recommendations via published strategies", enabled: true },
  { type: "strategy", name: "Strategy Subscriptions", description: "Subscribe to curated investment strategies with live calls", enabled: true },
  { type: "portfolio_stocks", name: "Portfolio Evaluation - Stocks", description: "Analyze your stock portfolio with risk assessment and optimization suggestions", enabled: false },
  { type: "portfolio_mf", name: "Portfolio Evaluation - Mutual Funds", description: "Review mutual fund holdings, expense ratios, overlap analysis", enabled: false },
  { type: "financial_planning", name: "Financial Planning", description: "Comprehensive financial planning across asset classes", enabled: false },
  { type: "custom", name: "Custom Service", description: "", enabled: false },
];

export default function MicrositeEditor() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState("branding");

  const { data: msData, isLoading } = useQuery<any>({ queryKey: ["/api/advisor/microsite"] });
  const { data: riskSettings } = useQuery<any>({ queryKey: ["/api/advisor/settings/risk-profiling"] });
  const { data: pmlaSettings } = useQuery<any>({ queryKey: ["/api/advisor/pmla-setting"] });
  const { data: plans } = useQuery<any[]>({ queryKey: ["/api/advisor/plans"] });

  const [form, setForm] = useState({
    slug: "", tagline: "", about: "", themeColor: "#E53E3E",
    logoUrl: "", bannerImageUrl: "", address: "", city: "", state: "", pincode: "",
    contactPhone: "", contactEmail: "", websiteUrl: "",
    socialLinkedin: "", socialTwitter: "", socialYoutube: "", socialTelegram: "",
    showPerformance: true, showTestimonials: false, showContact: true,
    showFaq: false, showAbout: true, testimonials: [] as any[], faq: [] as any[],
    servicesOffered: DEFAULT_SERVICES as any[],
  });

  useEffect(() => {
    if (msData?.exists) {
      setForm({
        slug: msData.slug || "", tagline: msData.tagline || "", about: msData.about || "",
        themeColor: msData.theme_color || "#E53E3E", logoUrl: msData.logo_url || "",
        bannerImageUrl: msData.banner_image_url || "", address: msData.address || "",
        city: msData.city || "", state: msData.state || "", pincode: msData.pincode || "",
        contactPhone: msData.contact_phone || "", contactEmail: msData.contact_email || "",
        websiteUrl: msData.website_url || "", socialLinkedin: msData.social_linkedin || "",
        socialTwitter: msData.social_twitter || "", socialYoutube: msData.social_youtube || "",
        socialTelegram: msData.social_telegram || "",
        showPerformance: msData.show_performance !== false, showTestimonials: !!msData.show_testimonials,
        showContact: msData.show_contact !== false, showFaq: !!msData.show_faq,
        showAbout: msData.show_about !== false,
        testimonials: msData.testimonials || [], faq: msData.faq || [],
        servicesOffered: msData.services_offered?.length > 0 ? msData.services_offered : DEFAULT_SERVICES,
      });
    } else if (msData?.suggestedSlug) {
      setForm(f => ({ ...f, slug: msData.suggestedSlug, contactEmail: user?.email || "" }));
    }
  }, [msData, user]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/advisor/microsite", form);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/microsite"] });
      toast({ title: "Microsite saved successfully" });
    },
    onError: (err: any) => {
      toast({ title: "Failed to save", description: err.message, variant: "destructive" });
    },
  });

  const riskToggle = useMutation({
    mutationFn: async (v: boolean) => { const r = await apiRequest("PATCH", "/api/advisor/settings/risk-profiling", { requireRiskProfiling: v }); return r.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/advisor/settings/risk-profiling"] }); toast({ title: "Risk profiling setting updated" }); },
  });

  const pmlaToggle = useMutation({
    mutationFn: async (v: boolean) => { const r = await apiRequest("PATCH", "/api/advisor/pmla-setting", { requirePmla: v }); return r.json(); },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["/api/advisor/pmla-setting"] }); toast({ title: "PMLA setting updated" }); },
  });

  const uploadFile = async (field: string) => {
    const input = document.createElement("input");
    input.type = "file"; input.accept = "image/*";
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0]; if (!file) return;
      const fd = new FormData(); fd.append("file", file);
      try {
        const res = await fetch("/api/advisor/microsite/upload", { method: "POST", body: fd, credentials: "include" });
        const data = await res.json();
        if (data.url) { setForm(f => ({ ...f, [field]: data.url })); toast({ title: "Image uploaded" }); }
      } catch { toast({ title: "Upload failed", variant: "destructive" }); }
    };
    input.click();
  };

  const updateService = (idx: number, updates: any) => {
    const svc = [...form.servicesOffered];
    svc[idx] = { ...svc[idx], ...updates };
    setForm({ ...form, servicesOffered: svc });
  };

  const addFaq = () => setForm({ ...form, faq: [...form.faq, { question: "", answer: "" }] });
  const removeFaq = (i: number) => setForm({ ...form, faq: form.faq.filter((_: any, idx: number) => idx !== i) });
  const updateFaq = (i: number, field: string, val: string) => {
    const f = [...form.faq]; f[i] = { ...f[i], [field]: val }; setForm({ ...form, faq: f });
  };

  const addTestimonial = () => setForm({ ...form, testimonials: [...form.testimonials, { name: "", text: "", designation: "" }] });
  const removeTestimonial = (i: number) => setForm({ ...form, testimonials: form.testimonials.filter((_: any, idx: number) => idx !== i) });
  const updateTestimonial = (i: number, field: string, val: string) => {
    const t = [...form.testimonials]; t[i] = { ...t[i], [field]: val }; setForm({ ...form, testimonials: t });
  };

  if (!user) { navigate("/login"); return null; }
  const micrositeUrl = "https://alphamarket.co.in/advisor/" + form.slug;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">Business Configuration</h1>
          <p className="text-sm text-muted-foreground">Configure your microsite, services, compliance, and content</p>
        </div>
        <div className="flex gap-2">
          {msData?.exists && (
            <Button variant="outline" size="sm" onClick={() => window.open("/advisor/" + form.slug, "_blank")}>
              <Eye className="w-3 h-3 mr-1" /> Preview
            </Button>
          )}
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
            Save All
          </Button>
        </div>
      </div>

      {msData?.exists && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-green-50 dark:bg-green-950/20 border border-green-200 text-xs text-green-700">
          <Globe className="w-4 h-4" />
          <span>Your microsite is live at</span>
          <a href={micrositeUrl} target="_blank" rel="noopener" className="font-medium underline">{micrositeUrl}</a>
          <ExternalLink className="w-3 h-3" />
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="branding" className="text-xs">Branding</TabsTrigger>
          <TabsTrigger value="services" className="text-xs">Services</TabsTrigger>
          <TabsTrigger value="journey" className="text-xs">Compliance</TabsTrigger>
          <TabsTrigger value="pricing" className="text-xs">Pricing</TabsTrigger>
          <TabsTrigger value="content" className="text-xs">Content</TabsTrigger>
          <TabsTrigger value="contact" className="text-xs">Contact</TabsTrigger>
        </TabsList>

        {/* TAB 1: BRANDING */}
        <TabsContent value="branding" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">URL & Identity</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1">
                <Label className="text-sm">URL Slug</Label>
                <div className="flex items-center gap-1 text-sm text-muted-foreground">
                  <span>alphamarket.co.in/advisor/</span>
                  <Input value={form.slug} onChange={e => setForm({...form, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "")})} className="w-48" placeholder="your-name" />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-sm">Tagline</Label>
                <Input value={form.tagline} onChange={e => setForm({...form, tagline: e.target.value})} placeholder="Your investment philosophy in one line" />
              </div>
              <div className="space-y-1">
                <Label className="text-sm">About / Investment Philosophy</Label>
                <textarea value={form.about} onChange={e => setForm({...form, about: e.target.value})} className="w-full min-h-[120px] p-3 rounded-md border text-sm bg-background" placeholder="Tell investors about your approach..." />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label className="text-sm">Logo</Label>
                  <div className="flex items-center gap-2">
                    {form.logoUrl && <img src={form.logoUrl} className="w-10 h-10 rounded object-cover" />}
                    <Button variant="outline" size="sm" onClick={() => uploadFile("logoUrl")}><Upload className="w-3 h-3 mr-1" /> Upload</Button>
                    {form.logoUrl && <Button variant="ghost" size="sm" onClick={() => setForm({...form, logoUrl: ""})}><Trash2 className="w-3 h-3" /></Button>}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">Min 200×200px, square or landscape. Use a white or solid-color background for best results. PNG or JPG.</p>
                </div>
                <div className="space-y-1">
                  <Label className="text-sm">Banner Image</Label>
                  <div className="flex items-center gap-2">
                    {form.bannerImageUrl && <img src={form.bannerImageUrl} className="w-16 h-10 rounded object-cover" />}
                    <Button variant="outline" size="sm" onClick={() => uploadFile("bannerImageUrl")}><Upload className="w-3 h-3 mr-1" /> Upload</Button>
                    {form.bannerImageUrl && <Button variant="ghost" size="sm" onClick={() => setForm({...form, bannerImageUrl: ""})}><Trash2 className="w-3 h-3" /></Button>}
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">Recommended 1200×400px (3:1 ratio). Landscape orientation. JPG or PNG, max 2MB.</p>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-sm">Theme Color</Label>
                <div className="flex items-center gap-2">
                  <input type="color" value={form.themeColor} onChange={e => setForm({...form, themeColor: e.target.value})} className="w-10 h-8 rounded cursor-pointer" />
                  <span className="text-xs text-muted-foreground">{form.themeColor}</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 2: SERVICES */}
        <TabsContent value="services" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Services Offered</CardTitle>
              <p className="text-xs text-muted-foreground">Select the services you provide to your subscribers. These will be displayed on your public microsite.</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {form.servicesOffered.map((svc: any, i: number) => (
                <div key={i} className="flex items-start gap-3 p-3 rounded-md border">
                  <Switch checked={svc.enabled} onCheckedChange={v => updateService(i, { enabled: v })} className="mt-1" />
                  <div className="flex-1 space-y-1">
                    <Input value={svc.name} onChange={e => updateService(i, { name: e.target.value })} className="font-medium text-sm h-8" />
                    <Input value={svc.description} onChange={e => updateService(i, { description: e.target.value })} placeholder="Description of this service" className="text-xs h-7" />
                  </div>
                  <Badge variant="secondary" className="text-[10px] mt-1">{svc.type}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 3: CUSTOMER JOURNEY / COMPLIANCE */}
        <TabsContent value="journey" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Customer Onboarding Journey</CardTitle>
              <p className="text-xs text-muted-foreground">Configure which compliance steps subscribers must complete before accessing your recommendations.</p>
            </CardHeader>
            <CardContent className="space-y-1">
              <div className="space-y-3">
                <div className="flex items-center justify-between p-3 rounded-md border bg-muted/30">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center text-xs font-bold text-green-700">1</div>
                    <div>
                      <p className="text-sm font-medium">Payment & Subscription</p>
                      <p className="text-xs text-muted-foreground">Investor selects plan and completes payment via Cashfree</p>
                    </div>
                  </div>
                  <Badge className="bg-green-100 text-green-700 text-[10px]">Always Required</Badge>
                </div>

                <div className="flex items-center justify-between p-3 rounded-md border bg-muted/30">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center text-xs font-bold text-green-700">2</div>
                    <div>
                      <p className="text-sm font-medium">e-Sign Advisory Agreement</p>
                      <p className="text-xs text-muted-foreground">Digital signing of investment advisory agreement</p>
                    </div>
                  </div>
                  <Badge className="bg-green-100 text-green-700 text-[10px]">Always Required</Badge>
                </div>

                <div className="flex items-center justify-between p-3 rounded-md border bg-muted/30">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center text-xs font-bold text-green-700">3</div>
                    <div>
                      <p className="text-sm font-medium">eKYC (Aadhaar + PAN)</p>
                      <p className="text-xs text-muted-foreground">Identity verification via Aadhaar OTP and PAN validation</p>
                    </div>
                  </div>
                  <Badge className="bg-green-100 text-green-700 text-[10px]">Always Required</Badge>
                </div>

                <div className="flex items-center justify-between p-3 rounded-md border">
                  <div className="flex items-center gap-3">
                    <div className={"w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold " + (pmlaSettings?.requirePmla ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-400")}>4</div>
                    <div>
                      <p className="text-sm font-medium">PMLA Verification</p>
                      <p className="text-xs text-muted-foreground">Bank account verification, name matching, PAN-Aadhaar linkage check</p>
                    </div>
                  </div>
                  <Switch checked={pmlaSettings?.requirePmla || false} onCheckedChange={v => pmlaToggle.mutate(v)} disabled={pmlaToggle.isPending} />
                </div>

                <div className="flex items-center justify-between p-3 rounded-md border">
                  <div className="flex items-center gap-3">
                    <div className={"w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold " + (riskSettings?.requireRiskProfiling ? "bg-blue-100 text-blue-700" : "bg-gray-100 text-gray-400")}>5</div>
                    <div>
                      <p className="text-sm font-medium">Risk Profiling</p>
                      <p className="text-xs text-muted-foreground">SEBI-mandated risk assessment questionnaire to match investor risk appetite</p>
                    </div>
                  </div>
                  <Switch checked={riskSettings?.requireRiskProfiling || false} onCheckedChange={v => riskToggle.mutate(v)} disabled={riskToggle.isPending} />
                </div>

                <div className="flex items-center justify-between p-3 rounded-md border opacity-50">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-400">6</div>
                    <div>
                      <p className="text-sm font-medium">Portfolio Review</p>
                      <p className="text-xs text-muted-foreground">Subscriber uploads portfolio for advisor evaluation before access</p>
                    </div>
                  </div>
                  <Badge variant="outline" className="text-[10px]">Coming Soon</Badge>
                </div>

                <div className="flex items-center justify-between p-3 rounded-md border bg-green-50 dark:bg-green-950/20">
                  <div className="flex items-center gap-3">
                    <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center text-xs font-bold text-green-700">&#10003;</div>
                    <div>
                      <p className="text-sm font-medium text-green-800 dark:text-green-300">Access Granted</p>
                      <p className="text-xs text-green-600">Investor can now view live calls, positions, and recommendations</p>
                    </div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 4: PRICING */}
        <TabsContent value="pricing" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Subscription Plans</CardTitle>
              <p className="text-xs text-muted-foreground">Your current subscription plans. These are displayed on your public microsite and strategy pages.</p>
            </CardHeader>
            <CardContent>
              {!plans || plans.length === 0 ? (
                <div className="text-center py-6 space-y-2">
                  <CreditCard className="w-10 h-10 mx-auto text-muted-foreground/50" />
                  <p className="text-sm text-muted-foreground">No plans created yet</p>
                  <Button size="sm" onClick={() => navigate("/dashboard/plans")}><Plus className="w-3 h-3 mr-1" /> Create Plans</Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {plans.map((p: any) => (
                    <div key={p.id} className="flex items-center justify-between p-3 rounded-md border">
                      <div>
                        <p className="text-sm font-medium">{p.name}</p>
                        <p className="text-xs text-muted-foreground">{p.durationDays ? p.durationDays + " days" : "No duration"} | Code: {p.code}</p>
                      </div>
                      <span className="text-lg font-bold">{"\u20B9"}{p.amount}</span>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" onClick={() => navigate("/dashboard/plans")} className="w-full">
                    <Plus className="w-3 h-3 mr-1" /> Manage Plans
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Show pricing on microsite</Label>
                <Switch checked={form.showPerformance} onCheckedChange={v => setForm({...form, showPerformance: v})} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 5: CONTENT */}
        <TabsContent value="content" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>FAQ</span>
                <Button variant="outline" size="sm" onClick={addFaq}><Plus className="w-3 h-3 mr-1" /> Add FAQ</Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {form.faq.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No FAQ items yet. Add common questions your investors might have.</p>
              ) : (
                form.faq.map((item: any, i: number) => (
                  <div key={i} className="p-3 rounded-md border space-y-2">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 space-y-2">
                        <Input value={item.question} onChange={e => updateFaq(i, "question", e.target.value)} placeholder="Question" className="text-sm font-medium" />
                        <textarea value={item.answer} onChange={e => updateFaq(i, "answer", e.target.value)} placeholder="Answer" className="w-full p-2 rounded-md border text-sm bg-background min-h-[60px]" />
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => removeFaq(i)}><Trash2 className="w-3 h-3 text-red-500" /></Button>
                    </div>
                  </div>
                ))
              )}
              <div className="flex items-center justify-between pt-2">
                <Label className="text-sm">Show FAQ on microsite</Label>
                <Switch checked={form.showFaq} onCheckedChange={v => setForm({...form, showFaq: v})} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center justify-between">
                <span>Testimonials</span>
                <Button variant="outline" size="sm" onClick={addTestimonial}><Plus className="w-3 h-3 mr-1" /> Add Testimonial</Button>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {form.testimonials.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">No testimonials yet. Add reviews from satisfied clients.</p>
              ) : (
                form.testimonials.map((t: any, i: number) => (
                  <div key={i} className="p-3 rounded-md border space-y-2">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 space-y-2">
                        <div className="grid grid-cols-2 gap-2">
                          <Input value={t.name} onChange={e => updateTestimonial(i, "name", e.target.value)} placeholder="Client name" className="text-sm" />
                          <Input value={t.designation} onChange={e => updateTestimonial(i, "designation", e.target.value)} placeholder="Designation (optional)" className="text-sm" />
                        </div>
                        <textarea value={t.text} onChange={e => updateTestimonial(i, "text", e.target.value)} placeholder="Testimonial text" className="w-full p-2 rounded-md border text-sm bg-background min-h-[60px]" />
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => removeTestimonial(i)}><Trash2 className="w-3 h-3 text-red-500" /></Button>
                    </div>
                  </div>
                ))
              )}
              <div className="flex items-center justify-between pt-2">
                <Label className="text-sm">Show testimonials on microsite</Label>
                <Switch checked={form.showTestimonials} onCheckedChange={v => setForm({...form, showTestimonials: v})} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Label className="text-sm">Show About section</Label>
                <Switch checked={form.showAbout} onCheckedChange={v => setForm({...form, showAbout: v})} />
              </div>
              <div className="flex items-center justify-between">
                <Label className="text-sm">Show Contact section</Label>
                <Switch checked={form.showContact} onCheckedChange={v => setForm({...form, showContact: v})} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* TAB 6: CONTACT & SOCIAL */}
        <TabsContent value="contact" className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Contact Details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1"><Label className="text-sm">Phone</Label><Input value={form.contactPhone} onChange={e => setForm({...form, contactPhone: e.target.value})} placeholder="+91 98765 43210" /></div>
                <div className="space-y-1"><Label className="text-sm">Email</Label><Input value={form.contactEmail} onChange={e => setForm({...form, contactEmail: e.target.value})} placeholder="advisor@example.com" /></div>
              </div>
              <div className="space-y-1"><Label className="text-sm">Address</Label><Input value={form.address} onChange={e => setForm({...form, address: e.target.value})} placeholder="Office address" /></div>
              <div className="grid grid-cols-3 gap-4">
                <div className="space-y-1"><Label className="text-sm">City</Label><Input value={form.city} onChange={e => setForm({...form, city: e.target.value})} /></div>
                <div className="space-y-1"><Label className="text-sm">State</Label><Input value={form.state} onChange={e => setForm({...form, state: e.target.value})} /></div>
                <div className="space-y-1"><Label className="text-sm">Pincode</Label><Input value={form.pincode} onChange={e => setForm({...form, pincode: e.target.value})} maxLength={6} /></div>
              </div>
              <div className="space-y-1"><Label className="text-sm">Website</Label><Input value={form.websiteUrl} onChange={e => setForm({...form, websiteUrl: e.target.value})} placeholder="https://yourwebsite.com" /></div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="text-base">Social Media</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1"><Label className="text-sm">LinkedIn</Label><Input value={form.socialLinkedin} onChange={e => setForm({...form, socialLinkedin: e.target.value})} placeholder="LinkedIn URL" /></div>
                <div className="space-y-1"><Label className="text-sm">Twitter / X</Label><Input value={form.socialTwitter} onChange={e => setForm({...form, socialTwitter: e.target.value})} placeholder="Twitter URL" /></div>
                <div className="space-y-1"><Label className="text-sm">YouTube</Label><Input value={form.socialYoutube} onChange={e => setForm({...form, socialYoutube: e.target.value})} placeholder="YouTube URL" /></div>
                <div className="space-y-1"><Label className="text-sm">Telegram</Label><Input value={form.socialTelegram} onChange={e => setForm({...form, socialTelegram: e.target.value})} placeholder="Telegram URL" /></div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <div className="flex justify-end pb-6">
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Save className="w-4 h-4 mr-1" />}
          Save All Changes
        </Button>
      </div>
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { MapPin, Phone, Mail, Globe, ExternalLink, ShieldCheck, BarChart3, Briefcase, Star, HelpCircle, ChevronRight, ArrowRight, Building2, Target, Eye, Award, Users, TrendingUp, Clock, CheckCircle2, Linkedin, Twitter, Youtube, Send } from "lucide-react";

export default function AdvisorMicrosite() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug || "";
  const [activeTab, setActiveTab] = useState("about");

  const { data, isLoading, error } = useQuery<any>({
    queryKey: ["/api/microsite", slug],
    queryFn: async () => {
      const res = await fetch("/api/microsite/" + slug);
      if (!res.ok) throw new Error("Not found");
      return res.json();
    },
    enabled: !!slug,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="w-full max-w-5xl px-4 space-y-6">
          <Skeleton className="h-72 w-full rounded-2xl" />
          <Skeleton className="h-10 w-72" />
          <div className="grid grid-cols-3 gap-4">
            <Skeleton className="h-40" /><Skeleton className="h-40" /><Skeleton className="h-40" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center">
        <div className="text-center px-4">
          <div className="w-20 h-20 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-6">
            <Building2 className="w-10 h-10 text-gray-300" />
          </div>
          <h1 className="text-3xl font-bold text-gray-900 mb-3">Advisor Not Found</h1>
          <p className="text-gray-500 mb-8 max-w-md">The advisor page you are looking for does not exist or is currently inactive.</p>
          <Link href="/advisors"><Button className="bg-red-600 hover:bg-red-700 text-white px-8 py-3">Browse Advisors</Button></Link>
        </div>
      </div>
    );
  }

  const { microsite: ms, advisor, strategies } = data;
  const tc = ms.themeColor || "#E53E3E";
  const enabledServices = ms.servicesOffered?.filter((s: any) => s.enabled) || [];
  const hasFaq = ms.showFaq && ms.faq?.length > 0;
  const hasTestimonials = ms.showTestimonials && ms.testimonials?.length > 0;
  const hasContact = ms.showContact && (ms.contactPhone || ms.contactEmail || ms.address);

  const tabs = [
    { id: "about", label: "About", show: ms.showAbout && ms.about },
    { id: "services", label: "Services", show: enabledServices.length > 0 },
    { id: "strategies", label: "Strategies", show: strategies.length > 0 },
    { id: "plans", label: "Plans", show: strategies.length > 0 },
    { id: "testimonials", label: "Testimonials", show: hasTestimonials },
    { id: "faq", label: "FAQ", show: hasFaq },
    { id: "contact", label: "Contact", show: hasContact },
  ].filter(t => t.show);

  const yearsSince = advisor.activeSince ? new Date().getFullYear() - new Date(advisor.activeSince).getFullYear() : 0;

  return (
    <div className="min-h-screen bg-white">

      {/* ═══ HERO SECTION ═══ */}
      <div className="relative">
        {/* Logo bar above banner */}
        {ms.logoUrl && (
          <div className="bg-white border-b border-gray-100">
            <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-4">
              <img src={ms.logoUrl} alt={advisor.companyName + " logo"} className="h-20 w-auto max-w-[240px] object-contain rounded-lg shadow-sm border border-gray-100 bg-white p-1.5" />
              <div>
                <p className="font-bold text-gray-900 text-lg">{advisor.companyName}</p>
                {ms.tagline && <p className="text-sm text-gray-500">{ms.tagline}</p>}
              </div>
            </div>
          </div>
        )}

        {/* Full-width banner background */}
        <div className="h-72 md:h-80 relative overflow-hidden" style={{ background: ms.bannerImageUrl ? undefined : ("linear-gradient(135deg, " + tc + ", " + tc + "cc)") }}>
          {ms.bannerImageUrl ? (
            <>
              <img src={ms.bannerImageUrl} alt="" className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/50 to-black/30" />
            </>
          ) : (
            <div className="absolute inset-0 opacity-10" style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg width=\'60\' height=\'60\' viewBox=\'0 0 60 60\' xmlns=\'http://www.w3.org/2000/svg\'%3E%3Cg fill=\'none\' fill-rule=\'evenodd\'%3E%3Cg fill=\'%23ffffff\' fill-opacity=\'0.4\'%3E%3Cpath d=\'M36 34v-4h-2v4h-4v2h4v4h2v-4h4v-2h-4zm0-30V0h-2v4h-4v2h4v4h2V6h4V4h-4zM6 34v-4H4v4H0v2h4v4h2v-4h4v-2H6zM6 4V0H4v4H0v2h4v4h2V6h4V4H6z\'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")" }} />
          )}

          {/* Top nav over banner — social links only */}
          <div className="absolute top-0 left-0 right-0 z-10">
            <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-end">
              <div className="flex items-center gap-2">
                {ms.socialLinkedin && <a href={ms.socialLinkedin} target="_blank" rel="noopener" className="w-8 h-8 rounded-full bg-white/15 backdrop-blur flex items-center justify-center text-white/80 hover:bg-white/25 transition-colors"><Linkedin className="w-3.5 h-3.5" /></a>}
                {ms.socialTwitter && <a href={ms.socialTwitter} target="_blank" rel="noopener" className="w-8 h-8 rounded-full bg-white/15 backdrop-blur flex items-center justify-center text-white/80 hover:bg-white/25 transition-colors"><Twitter className="w-3.5 h-3.5" /></a>}
                {ms.socialYoutube && <a href={ms.socialYoutube} target="_blank" rel="noopener" className="w-8 h-8 rounded-full bg-white/15 backdrop-blur flex items-center justify-center text-white/80 hover:bg-white/25 transition-colors"><Youtube className="w-3.5 h-3.5" /></a>}
                {ms.socialTelegram && <a href={ms.socialTelegram} target="_blank" rel="noopener" className="w-8 h-8 rounded-full bg-white/15 backdrop-blur flex items-center justify-center text-white/80 hover:bg-white/25 transition-colors"><Send className="w-3.5 h-3.5" /></a>}
                <a href="/" className="text-[10px] text-white/40 hover:text-white/70 transition-colors ml-2">AlphaMarket</a>
              </div>
            </div>
          </div>

          {/* Hero text over banner */}
          <div className="absolute bottom-0 left-0 right-0 z-10">
            <div className="max-w-6xl mx-auto px-6 pb-8">
              <h1 className="text-3xl md:text-5xl font-bold text-white drop-shadow-lg tracking-tight">{advisor.companyName}</h1>
              {ms.tagline && <p className="text-lg md:text-xl text-white/80 mt-2 drop-shadow">{ms.tagline}</p>}
            </div>
          </div>
        </div>

        {/* Info strip below banner */}
        <div className="bg-gray-50 border-b border-gray-200">
          <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2.5 flex-wrap">
              {advisor.sebiRegNumber && (
                <span className="inline-flex items-center gap-1.5 text-xs text-gray-600 bg-white rounded-full px-3 py-1.5 border border-gray-200 shadow-sm">
                  <ShieldCheck className="w-3.5 h-3.5" style={{ color: tc }} /> SEBI: {advisor.sebiRegNumber}
                </span>
              )}
              {advisor.activeSince && (
                <span className="inline-flex items-center gap-1.5 text-xs text-gray-600 bg-white rounded-full px-3 py-1.5 border border-gray-200 shadow-sm">
                  <Clock className="w-3.5 h-3.5 text-gray-400" /> Since {new Date(advisor.activeSince).getFullYear()}
                </span>
              )}
              {(advisor.themes || []).map((t: string) => (
                <span key={t} className="text-xs font-medium px-3 py-1.5 rounded-full border" style={{ background: tc + "08", color: tc, borderColor: tc + "25" }}>{t}</span>
              ))}
            </div>
            <div className="flex gap-6">
              {strategies.length > 0 && <div className="text-center"><div className="text-xl font-bold" style={{ color: tc }}>{strategies.length}</div><div className="text-[10px] text-gray-400 uppercase tracking-wider">Strategies</div></div>}
              {data.plans?.length > 0 && <div className="text-center"><div className="text-xl font-bold" style={{ color: tc }}>{data.plans.length}</div><div className="text-[10px] text-gray-400 uppercase tracking-wider">Plans</div></div>}
              {enabledServices.length > 0 && <div className="text-center"><div className="text-xl font-bold" style={{ color: tc }}>{enabledServices.length}</div><div className="text-[10px] text-gray-400 uppercase tracking-wider">Services</div></div>}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ TAB NAVIGATION ═══ */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-6xl mx-auto px-6">
          <div className="flex gap-0.5 overflow-x-auto">
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={"px-5 py-3.5 text-sm font-medium transition-all whitespace-nowrap border-b-2 " +
                  (activeTab === tab.id ? "text-gray-900" : "border-transparent text-gray-400 hover:text-gray-600")}
                style={activeTab === tab.id ? { color: tc, borderColor: tc } : {}}>
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ TAB CONTENT ═══ */}
      <div className="min-h-[55vh]">

        {/* ───── ABOUT ───── */}
        {activeTab === "about" && ms.showAbout && ms.about && (
          <div>
            {/* Main about text */}
            <div className="max-w-6xl mx-auto px-6 py-12">
              <div className="max-w-3xl">
                <h2 className="text-3xl font-bold text-gray-900 mb-2">About Us</h2>
                <div className="w-16 h-1 rounded-full mb-6" style={{ background: tc }} />
                <p className="text-gray-600 leading-relaxed text-[15px] whitespace-pre-line">{ms.about}</p>
              </div>
            </div>

            {/* Mission / Vision / Values cards */}
            <div className="bg-gray-50 py-12">
              <div className="max-w-6xl mx-auto px-6">
                <div className="grid md:grid-cols-3 gap-6">
                  <div className="bg-white rounded-xl p-7 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-5" style={{ background: tc + "12" }}>
                      <Target className="w-6 h-6" style={{ color: tc }} />
                    </div>
                    <h3 className="font-bold text-gray-900 text-lg mb-2">Our Mission</h3>
                    <p className="text-sm text-gray-500 leading-relaxed">To empower investors with research-backed strategies and transparent advisory services that deliver consistent, risk-adjusted returns.</p>
                  </div>
                  <div className="bg-white rounded-xl p-7 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-5" style={{ background: tc + "12" }}>
                      <Eye className="w-6 h-6" style={{ color: tc }} />
                    </div>
                    <h3 className="font-bold text-gray-900 text-lg mb-2">Our Vision</h3>
                    <p className="text-sm text-gray-500 leading-relaxed">To become India&apos;s most trusted investment advisory platform, setting the gold standard for compliance, transparency, and investor education.</p>
                  </div>
                  <div className="bg-white rounded-xl p-7 border border-gray-100 shadow-sm hover:shadow-md transition-shadow">
                    <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-5" style={{ background: tc + "12" }}>
                      <Award className="w-6 h-6" style={{ color: tc }} />
                    </div>
                    <h3 className="font-bold text-gray-900 text-lg mb-2">Our Values</h3>
                    <p className="text-sm text-gray-500 leading-relaxed">Integrity in every recommendation. Capital protection first. Full SEBI compliance. Continuous learning and adaptation to market dynamics.</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Key highlights strip */}
            <div className="py-12">
              <div className="max-w-6xl mx-auto px-6">
                <h3 className="text-xl font-bold text-gray-900 mb-6">Why Choose Us</h3>
                <div className="grid md:grid-cols-4 gap-5">
                  {[
                    { icon: ShieldCheck, label: "SEBI Registered", desc: "Fully compliant & regulated investment advisory" },
                    { icon: TrendingUp, label: "Research-Driven", desc: "Quantitative strategies backed by data & analysis" },
                    { icon: Users, label: "Expert Team", desc: "Experienced analysts with deep market knowledge" },
                    { icon: CheckCircle2, label: "Track Record", desc: yearsSince > 0 ? (yearsSince + "+ years of proven performance") : "Consistent & transparent performance" },
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: tc + "10" }}>
                        <item.icon className="w-4.5 h-4.5" style={{ color: tc }} />
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900 text-sm">{item.label}</p>
                        <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{item.desc}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ───── SERVICES ───── */}
        {activeTab === "services" && enabledServices.length > 0 && (
          <div className="max-w-6xl mx-auto px-6 py-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-2">Our Services</h2>
            <div className="w-16 h-1 rounded-full mb-8" style={{ background: tc }} />
            <div className="grid gap-5 md:grid-cols-2">
              {enabledServices.map((svc: any, i: number) => (
                <div key={i} className="bg-white rounded-xl p-7 border border-gray-200 hover:shadow-lg transition-all hover:border-gray-300 group">
                  <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-5 group-hover:scale-110 transition-transform" style={{ background: tc + "12" }}>
                    <Briefcase className="w-6 h-6" style={{ color: tc }} />
                  </div>
                  <h3 className="font-bold text-gray-900 text-lg mb-2">{svc.name}</h3>
                  {svc.description && <p className="text-sm text-gray-500 leading-relaxed">{svc.description}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ───── STRATEGIES ───── */}
        {activeTab === "strategies" && (
          <div className="max-w-6xl mx-auto px-6 py-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-2">Our Strategies</h2>
            <div className="w-16 h-1 rounded-full mb-2" style={{ background: tc }} />
            <p className="text-sm text-gray-400 mb-8">Choose from {strategies.length} professionally managed investment strategies</p>
            {strategies.length === 0 ? (
              <p className="text-gray-400">No published strategies yet.</p>
            ) : (
              <div className="grid gap-5 md:grid-cols-2">
                {strategies.map((s: any) => (
                  <Link key={s.id} href={"/strategies/" + s.id}>
                    <div className="bg-white rounded-xl p-6 border border-gray-200 hover:shadow-lg hover:border-gray-300 transition-all cursor-pointer group">
                      <div className="flex items-start justify-between mb-3">
                        <h3 className="font-bold text-gray-900 text-lg group-hover:underline">{s.name}</h3>
                        <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full shrink-0 ml-3" style={{ background: tc + "12", color: tc }}>{s.type}</span>
                      </div>
                      {s.description && <p className="text-sm text-gray-500 line-clamp-2 mb-4">{s.description}</p>}
                      <div className="flex items-center gap-4 text-xs text-gray-400 mb-4">
                        {s.horizon && <span className="bg-gray-50 px-2 py-1 rounded">Horizon: {s.horizon}</span>}
                        {s.riskLevel && <span className="bg-gray-50 px-2 py-1 rounded">Risk: {s.riskLevel}</span>}
                        {s.cagr && <span className="font-semibold px-2 py-1 rounded" style={{ background: tc + "08", color: tc }}>CAGR: {s.cagr}%</span>}
                        {s.totalRecommendations && <span className="bg-gray-50 px-2 py-1 rounded">{s.totalRecommendations} calls</span>}
                      </div>
                      <div className="flex items-center gap-1 text-sm font-semibold" style={{ color: tc }}>
                        View Strategy <ArrowRight className="w-4 h-4" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ───── PLANS (Strategy-based pricing) ───── */}
        {activeTab === "plans" && strategies.length > 0 && (
          <div className="max-w-6xl mx-auto px-6 py-12">
            <div className="text-center mb-10">
              <h2 className="text-3xl font-bold text-gray-900 mb-2">Plans & Pricing</h2>
              <div className="w-16 h-1 rounded-full mx-auto mb-3" style={{ background: tc }} />
              <p className="text-sm text-gray-400">Choose a strategy and plan that suits your investment journey</p>
            </div>

            <div className="space-y-10 max-w-5xl mx-auto">
              {strategies.map((strat: any) => {
                const stratPlans = (data.strategyPlans || {})[strat.id] || data.plans || [];
                if (stratPlans.length === 0) return null;
                return (
                  <div key={strat.id} className="bg-white rounded-2xl border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow">
                    <div className="px-7 py-5 border-b border-gray-100 flex items-center justify-between flex-wrap gap-3">
                      <div>
                        <h3 className="text-lg font-bold text-gray-900">{strat.name}</h3>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-[11px] font-semibold px-2.5 py-0.5 rounded-full" style={{ background: tc + "12", color: tc }}>{strat.type}</span>
                          {strat.riskLevel && <span className="text-[11px] text-gray-400">Risk: {strat.riskLevel}</span>}
                          {strat.horizon && <span className="text-[11px] text-gray-400">Horizon: {strat.horizon}</span>}
                        </div>
                      </div>
                      {strat.cagr && <div className="text-right"><div className="text-xl font-bold" style={{ color: tc }}>{strat.cagr}%</div><div className="text-[10px] text-gray-400 uppercase">CAGR</div></div>}
                    </div>
                    {strat.description && <p className="px-7 py-3 text-sm text-gray-500 border-b border-gray-50">{strat.description}</p>}
                    <div className="px-7 py-6">
                      <div className={"grid gap-4 " + (stratPlans.length === 1 ? "grid-cols-1 max-w-xs" : stratPlans.length === 2 ? "grid-cols-2 max-w-lg" : "grid-cols-3")}>
                        {stratPlans.map((plan: any, i: number) => (
                          <div key={plan.id} className={"rounded-xl p-5 text-center transition-all hover:shadow-md cursor-pointer " + (i === 0 ? "border-2 bg-white" : "border border-gray-200 bg-white")}
                            style={i === 0 ? { borderColor: tc } : {}}>
                            {i === 0 && stratPlans.length > 1 && <div className="text-[10px] font-bold uppercase tracking-widest mb-3 py-0.5 px-2.5 rounded-full inline-block text-white" style={{ background: tc }}>Popular</div>}
                            <p className="font-semibold text-gray-600 mb-2 text-sm">{plan.name}</p>
                            <div className="text-3xl font-bold mb-1" style={{ color: i === 0 ? tc : "#111" }}>
                              {"\u20B9"}{Number(plan.amount).toLocaleString("en-IN")}
                            </div>
                            {plan.durationDays && <p className="text-xs text-gray-400 mb-4">{plan.durationDays} days</p>}
                            <Link href={"/strategies/" + strat.id + "/esign-agreement?plan=" + plan.id}>
                              <Button className="w-full py-2.5 text-white text-sm font-semibold" style={{ background: i === 0 ? tc : "#374151" }}>
                                Subscribe <ArrowRight className="w-3.5 h-3.5 ml-1" />
                              </Button>
                            </Link>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Compliance */}
            <div className="mt-10 p-6 bg-gray-50 rounded-xl border border-gray-100 max-w-5xl mx-auto">
              <p className="text-xs text-gray-500 font-semibold mb-3 uppercase tracking-wider">Compliance & Safety</p>
              <div className="flex gap-3 flex-wrap">
                {["eKYC (Aadhaar + PAN)", "eSign Agreement", ...(advisor.requireRiskProfiling ? ["Risk Profiling"] : []), ...(advisor.requirePmla ? ["PMLA Verification"] : [])].map(label => (
                  <span key={label} className="inline-flex items-center gap-1.5 text-xs text-gray-500 bg-white rounded-full px-3 py-2 border border-gray-200">
                    <ShieldCheck className="w-3.5 h-3.5" style={{ color: tc }} /> {label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ───── TESTIMONIALS ───── */}
        {activeTab === "testimonials" && hasTestimonials && (
          <div className="bg-gray-50 py-12">
            <div className="max-w-6xl mx-auto px-6">
              <h2 className="text-3xl font-bold text-gray-900 mb-2">Client Testimonials</h2>
              <div className="w-16 h-1 rounded-full mb-8" style={{ background: tc }} />
              <div className="grid gap-5 md:grid-cols-2">
                {ms.testimonials.map((t: any, i: number) => (
                  <div key={i} className="bg-white rounded-xl p-7 border border-gray-100 shadow-sm">
                    <div className="flex gap-0.5 mb-4">{[1,2,3,4,5].map(s => <Star key={s} className="w-4 h-4" style={{ color: tc, fill: tc }} />)}</div>
                    <p className="text-gray-600 italic leading-relaxed mb-4">"{t.text}"</p>
                    <div className="flex items-center gap-3 pt-3 border-t border-gray-100">
                      <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-bold" style={{ background: tc }}>{(t.name || "?")[0].toUpperCase()}</div>
                      <span className="font-semibold text-gray-800 text-sm">{t.name}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ───── FAQ ───── */}
        {activeTab === "faq" && hasFaq && (
          <div className="max-w-6xl mx-auto px-6 py-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-2">Frequently Asked Questions</h2>
            <div className="w-16 h-1 rounded-full mb-8" style={{ background: tc }} />
            <div className="space-y-4 max-w-3xl">
              {ms.faq.map((item: any, i: number) => (
                <div key={i} className="bg-white rounded-xl p-6 border border-gray-200 hover:shadow-sm transition-shadow">
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5" style={{ background: tc + "12" }}>
                      <span className="text-xs font-bold" style={{ color: tc }}>Q{i+1}</span>
                    </div>
                    <div>
                      <p className="font-semibold text-gray-900 mb-2">{item.question}</p>
                      <p className="text-sm text-gray-500 leading-relaxed">{item.answer}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ───── CONTACT ───── */}
        {activeTab === "contact" && hasContact && (
          <div>
            {/* Map-style header */}
            <div className="h-48 relative overflow-hidden" style={{ background: "linear-gradient(135deg, " + tc + "15, " + tc + "08, #f9fafb)" }}>
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="text-center">
                  <h2 className="text-3xl font-bold text-gray-900 mb-2">Get In Touch</h2>
                  <p className="text-gray-500 text-sm">We would love to hear from you. Reach out to us anytime.</p>
                </div>
              </div>
            </div>

            <div className="max-w-6xl mx-auto px-6 py-10">
              <div className="grid md:grid-cols-2 gap-8">
                {/* Contact info cards */}
                <div className="space-y-4">
                  {ms.address && (
                    <div className="bg-white rounded-xl p-6 border border-gray-200 flex items-start gap-5 hover:shadow-md transition-shadow">
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: tc + "12" }}>
                        <MapPin className="w-6 h-6" style={{ color: tc }} />
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900 mb-1">Office Address</p>
                        <p className="text-sm text-gray-500 leading-relaxed">{[ms.address, ms.city, ms.state, ms.pincode].filter(Boolean).join(", ")}</p>
                      </div>
                    </div>
                  )}
                  {ms.contactPhone && (
                    <div className="bg-white rounded-xl p-6 border border-gray-200 flex items-start gap-5 hover:shadow-md transition-shadow">
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: tc + "12" }}>
                        <Phone className="w-6 h-6" style={{ color: tc }} />
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900 mb-1">Phone</p>
                        <a href={"tel:" + ms.contactPhone} className="text-sm text-gray-500 hover:underline">{ms.contactPhone}</a>
                      </div>
                    </div>
                  )}
                  {ms.contactEmail && (
                    <div className="bg-white rounded-xl p-6 border border-gray-200 flex items-start gap-5 hover:shadow-md transition-shadow">
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: tc + "12" }}>
                        <Mail className="w-6 h-6" style={{ color: tc }} />
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900 mb-1">Email</p>
                        <a href={"mailto:" + ms.contactEmail} className="text-sm text-gray-500 hover:underline">{ms.contactEmail}</a>
                      </div>
                    </div>
                  )}
                  {ms.websiteUrl && (
                    <div className="bg-white rounded-xl p-6 border border-gray-200 flex items-start gap-5 hover:shadow-md transition-shadow">
                      <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0" style={{ background: tc + "12" }}>
                        <Globe className="w-6 h-6" style={{ color: tc }} />
                      </div>
                      <div>
                        <p className="font-semibold text-gray-900 mb-1">Website</p>
                        <a href={ms.websiteUrl} target="_blank" rel="noopener" className="text-sm text-gray-500 hover:underline flex items-center gap-1">{ms.websiteUrl} <ExternalLink className="w-3 h-3" /></a>
                      </div>
                    </div>
                  )}
                </div>

                {/* Business hours + CTA */}
                <div className="space-y-5">
                  <div className="bg-gray-50 rounded-xl p-7 border border-gray-100">
                    <h3 className="font-bold text-gray-900 mb-4 flex items-center gap-2"><Clock className="w-5 h-5" style={{ color: tc }} /> Business Hours</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between py-1.5 border-b border-gray-200"><span className="text-gray-600">Monday - Friday</span><span className="font-medium text-gray-900">9:00 AM - 6:00 PM</span></div>
                      <div className="flex justify-between py-1.5 border-b border-gray-200"><span className="text-gray-600">Saturday</span><span className="font-medium text-gray-900">10:00 AM - 2:00 PM</span></div>
                      <div className="flex justify-between py-1.5"><span className="text-gray-600">Sunday</span><span className="text-gray-400">Closed</span></div>
                    </div>
                  </div>

                  {(ms.socialLinkedin || ms.socialTwitter || ms.socialYoutube || ms.socialTelegram) && (
                    <div className="bg-gray-50 rounded-xl p-7 border border-gray-100">
                      <h3 className="font-bold text-gray-900 mb-4">Follow Us</h3>
                      <div className="flex gap-3">
                        {ms.socialLinkedin && <a href={ms.socialLinkedin} target="_blank" rel="noopener" className="w-10 h-10 rounded-lg flex items-center justify-center border border-gray-200 bg-white text-gray-500 hover:shadow-md hover:text-blue-600 transition-all"><Linkedin className="w-4 h-4" /></a>}
                        {ms.socialTwitter && <a href={ms.socialTwitter} target="_blank" rel="noopener" className="w-10 h-10 rounded-lg flex items-center justify-center border border-gray-200 bg-white text-gray-500 hover:shadow-md hover:text-gray-900 transition-all"><Twitter className="w-4 h-4" /></a>}
                        {ms.socialYoutube && <a href={ms.socialYoutube} target="_blank" rel="noopener" className="w-10 h-10 rounded-lg flex items-center justify-center border border-gray-200 bg-white text-gray-500 hover:shadow-md hover:text-red-600 transition-all"><Youtube className="w-4 h-4" /></a>}
                        {ms.socialTelegram && <a href={ms.socialTelegram} target="_blank" rel="noopener" className="w-10 h-10 rounded-lg flex items-center justify-center border border-gray-200 bg-white text-gray-500 hover:shadow-md hover:text-blue-500 transition-all"><Send className="w-4 h-4" /></a>}
                      </div>
                    </div>
                  )}

                  <div className="rounded-xl p-7 text-white text-center" style={{ background: "linear-gradient(135deg, " + tc + ", " + tc + "dd)" }}>
                    <h3 className="font-bold text-xl mb-2">Ready to Start Investing?</h3>
                    <p className="text-sm text-white/80 mb-5">Join our advisory and get research-backed investment recommendations.</p>
                    <Link href="/strategies">
                      <Button className="bg-white hover:bg-gray-100 font-semibold px-6" style={{ color: tc }}>
                        View Strategies <ArrowRight className="w-4 h-4 ml-1" />
                      </Button>
                    </Link>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ═══ FOOTER ═══ */}
      <div className="border-t border-gray-100 bg-gray-50">
        <div className="max-w-6xl mx-auto px-6 py-6 flex items-center justify-between text-xs text-gray-400">
          <span>\u00A9 {new Date().getFullYear()} {advisor.companyName}. All rights reserved.</span>
          <a href="/" className="hover:text-gray-600 transition-colors">Powered by AlphaMarket</a>
        </div>
      </div>
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { TrendingUp, MapPin, Phone, Mail, Globe, ExternalLink, ShieldCheck, BarChart3, Briefcase, Star, MessageCircle, HelpCircle, ChevronRight, ArrowRight, Building2, Users, Award } from "lucide-react";

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
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-full max-w-4xl px-4 space-y-6">
          <Skeleton className="h-56 w-full rounded-2xl bg-slate-800" />
          <Skeleton className="h-8 w-64 bg-slate-800" />
          <div className="grid grid-cols-3 gap-4">
            <Skeleton className="h-32 bg-slate-800" /><Skeleton className="h-32 bg-slate-800" /><Skeleton className="h-32 bg-slate-800" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center text-white">
        <div className="text-center px-4">
          <div className="w-16 h-16 rounded-full bg-slate-800 flex items-center justify-center mx-auto mb-6">
            <Building2 className="w-8 h-8 text-slate-500" />
          </div>
          <h1 className="text-2xl font-bold mb-2">Advisor Not Found</h1>
          <p className="text-slate-400 mb-6">This advisor page does not exist or is not active.</p>
          <Link href="/advisors"><Button className="bg-red-600 hover:bg-red-700">Browse Advisors</Button></Link>
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
    { id: "plans", label: "Plans", show: data.plans?.length > 0 },
    { id: "testimonials", label: "Testimonials", show: hasTestimonials },
    { id: "faq", label: "FAQ", show: hasFaq },
    { id: "contact", label: "Contact", show: hasContact },
  ].filter(t => t.show);

  return (
    <div className="min-h-screen bg-slate-950 text-white" style={{ "--tc": tc } as any}>
      {/* ═══ HERO HEADER ═══ */}
      <div className="relative overflow-hidden">
        {ms.bannerImageUrl ? (
          <div className="absolute inset-0">
            <img src={ms.bannerImageUrl} alt="" className="w-full h-full object-cover" />
            <div className="absolute inset-0 bg-gradient-to-b from-slate-950/70 via-slate-950/80 to-slate-950" />
          </div>
        ) : (
          <div className="absolute inset-0" style={{ background: "linear-gradient(135deg, " + tc + "22, " + tc + "08, transparent 60%)" }} />
        )}
        <div className="relative max-w-5xl mx-auto px-6 pt-10 pb-8">
          {/* Top bar — minimal branding */}
          <div className="flex items-center justify-between mb-10">
            <div className="flex items-center gap-3">
              {ms.logoUrl && <img src={ms.logoUrl} alt="" className="w-10 h-10 rounded-lg object-cover border border-white/20" />}
              <span className="text-sm font-semibold text-white/80">{advisor.companyName}</span>
            </div>
            <div className="flex items-center gap-3">
              {(ms.socialLinkedin || ms.socialTwitter || ms.socialYoutube || ms.socialTelegram) && (
                <div className="flex gap-2">
                  {ms.socialLinkedin && <a href={ms.socialLinkedin} target="_blank" rel="noopener" className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs text-white/70 hover:bg-white/20 hover:text-white transition-colors">in</a>}
                  {ms.socialTwitter && <a href={ms.socialTwitter} target="_blank" rel="noopener" className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs text-white/70 hover:bg-white/20 hover:text-white transition-colors">X</a>}
                  {ms.socialYoutube && <a href={ms.socialYoutube} target="_blank" rel="noopener" className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs text-white/70 hover:bg-white/20 hover:text-white transition-colors">YT</a>}
                  {ms.socialTelegram && <a href={ms.socialTelegram} target="_blank" rel="noopener" className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center text-xs text-white/70 hover:bg-white/20 hover:text-white transition-colors">TG</a>}
                </div>
              )}
              <a href="/" className="text-[10px] text-white/30 hover:text-white/60 transition-colors border border-white/10 rounded px-2 py-1">AlphaMarket</a>
            </div>
          </div>

          {/* Hero content */}
          <div className="max-w-3xl">
            <h1 className="text-4xl md:text-5xl font-bold tracking-tight leading-tight">{advisor.companyName}</h1>
            {ms.tagline && <p className="text-xl text-white/60 mt-3 leading-relaxed">{ms.tagline}</p>}
            <div className="flex items-center gap-3 mt-5 flex-wrap">
              {advisor.sebiRegNumber && (
                <div className="flex items-center gap-1.5 text-xs text-white/50 bg-white/5 rounded-full px-3 py-1.5 border border-white/10">
                  <ShieldCheck className="w-3.5 h-3.5" style={{ color: tc }} /> SEBI: {advisor.sebiRegNumber}
                </div>
              )}
              {advisor.activeSince && (
                <div className="text-xs text-white/50 bg-white/5 rounded-full px-3 py-1.5 border border-white/10">
                  Since {new Date(advisor.activeSince).getFullYear()}
                </div>
              )}
              {strategies.length > 0 && (
                <div className="text-xs text-white/50 bg-white/5 rounded-full px-3 py-1.5 border border-white/10">
                  <BarChart3 className="w-3 h-3 inline mr-1" />{strategies.length} Strategies
                </div>
              )}
            </div>
            {(advisor.themes || []).length > 0 && (
              <div className="flex gap-2 mt-4 flex-wrap">
                {(advisor.themes || []).map((t: string) => (
                  <span key={t} className="text-xs font-medium px-3 py-1 rounded-full" style={{ background: tc + "20", color: tc }}>{t}</span>
                ))}
              </div>
            )}
          </div>

          {/* Quick stats */}
          <div className="flex gap-6 mt-8 flex-wrap">
            {strategies.length > 0 && (
              <div className="text-center">
                <div className="text-2xl font-bold" style={{ color: tc }}>{strategies.length}</div>
                <div className="text-[11px] text-white/40 mt-0.5">Strategies</div>
              </div>
            )}
            {data.plans?.length > 0 && (
              <div className="text-center">
                <div className="text-2xl font-bold" style={{ color: tc }}>{data.plans.length}</div>
                <div className="text-[11px] text-white/40 mt-0.5">Plans</div>
              </div>
            )}
            {enabledServices.length > 0 && (
              <div className="text-center">
                <div className="text-2xl font-bold" style={{ color: tc }}>{enabledServices.length}</div>
                <div className="text-[11px] text-white/40 mt-0.5">Services</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ TAB NAVIGATION ═══ */}
      <div className="sticky top-0 z-20 bg-slate-950/95 backdrop-blur-md border-b border-white/10">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex gap-1 overflow-x-auto scrollbar-none py-1">
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={"px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap border-b-2 " +
                  (activeTab === tab.id
                    ? "border-current text-white"
                    : "border-transparent text-white/40 hover:text-white/70")}
                style={activeTab === tab.id ? { color: tc, borderColor: tc } : {}}>
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ═══ TAB CONTENT ═══ */}
      <div className="max-w-5xl mx-auto px-6 py-10 min-h-[50vh]">

        {/* ABOUT */}
        {activeTab === "about" && ms.showAbout && ms.about && (
          <div className="animate-in fade-in duration-300">
            <h2 className="text-2xl font-bold mb-6">About Us</h2>
            <div className="bg-slate-900/50 rounded-2xl p-8 border border-white/5">
              <p className="text-white/70 leading-relaxed whitespace-pre-line text-[15px]">{ms.about}</p>
            </div>
            {ms.websiteUrl && (
              <a href={ms.websiteUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-2 mt-6 text-sm hover:underline" style={{ color: tc }}>
                <Globe className="w-4 h-4" /> Visit our website <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}

        {/* SERVICES */}
        {activeTab === "services" && enabledServices.length > 0 && (
          <div className="animate-in fade-in duration-300">
            <h2 className="text-2xl font-bold mb-6">Our Services</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {enabledServices.map((svc: any, i: number) => (
                <div key={i} className="bg-slate-900/50 rounded-xl p-6 border border-white/5 hover:border-white/10 transition-colors">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4" style={{ background: tc + "20" }}>
                    <Briefcase className="w-5 h-5" style={{ color: tc }} />
                  </div>
                  <h3 className="font-semibold text-white mb-1">{svc.name}</h3>
                  {svc.description && <p className="text-sm text-white/50 leading-relaxed">{svc.description}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STRATEGIES */}
        {activeTab === "strategies" && (
          <div className="animate-in fade-in duration-300">
            <h2 className="text-2xl font-bold mb-6">Strategies ({strategies.length})</h2>
            {strategies.length === 0 ? (
              <p className="text-white/40">No published strategies yet.</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {strategies.map((s: any) => (
                  <Link key={s.id} href={"/strategies/" + s.id}>
                    <div className="bg-slate-900/50 rounded-xl p-6 border border-white/5 hover:border-white/15 transition-all cursor-pointer group">
                      <div className="flex items-start justify-between mb-3">
                        <h3 className="font-semibold text-white group-hover:underline">{s.name}</h3>
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: tc + "20", color: tc }}>{s.type}</span>
                      </div>
                      {s.description && <p className="text-sm text-white/40 line-clamp-2 mb-3">{s.description}</p>}
                      <div className="flex items-center gap-4 text-xs text-white/30">
                        {s.horizon && <span>Horizon: {s.horizon}</span>}
                        {s.riskLevel && <span>Risk: {s.riskLevel}</span>}
                        {s.cagr && <span className="font-medium" style={{ color: tc }}>CAGR: {s.cagr}%</span>}
                        {s.totalRecommendations && <span>{s.totalRecommendations} calls</span>}
                      </div>
                      <div className="flex items-center gap-1 mt-4 text-xs font-medium" style={{ color: tc }}>
                        View Details <ChevronRight className="w-3 h-3" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>
        )}

        {/* PLANS */}
        {activeTab === "plans" && data.plans?.length > 0 && (
          <div className="animate-in fade-in duration-300">
            <h2 className="text-2xl font-bold mb-6">Plans & Pricing</h2>
            <div className="grid gap-4 md:grid-cols-3">
              {data.plans.map((plan: any, i: number) => (
                <div key={plan.id} className={"rounded-xl p-6 border text-center transition-all " + (i === 0 ? "bg-slate-900/80 border-white/15 scale-[1.02]" : "bg-slate-900/40 border-white/5")}>
                  {i === 0 && <div className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: tc }}>Most Popular</div>}
                  <p className="font-semibold text-white/80 mb-2">{plan.name}</p>
                  <div className="text-4xl font-bold mb-1" style={{ color: i === 0 ? tc : "white" }}>
                    {"\u20B9"}{plan.amount.toLocaleString("en-IN")}
                  </div>
                  {plan.durationDays && <p className="text-xs text-white/30 mb-5">{plan.durationDays} days</p>}
                  <Link href={"/strategies"}>
                    <Button size="sm" className="w-full" style={i === 0 ? { background: tc, color: "white" } : { background: "transparent", border: "1px solid rgba(255,255,255,0.15)", color: "white" }}>
                      Subscribe <ArrowRight className="w-3 h-3 ml-1" />
                    </Button>
                  </Link>
                </div>
              ))}
            </div>

            {/* Compliance badges */}
            <div className="mt-8 p-5 bg-slate-900/30 rounded-xl border border-white/5">
              <p className="text-xs text-white/40 mb-3 font-medium">Compliance Requirements</p>
              <div className="flex gap-3 flex-wrap">
                <div className="flex items-center gap-1.5 text-xs text-white/50 bg-white/5 rounded-full px-3 py-1.5">
                  <ShieldCheck className="w-3 h-3" style={{ color: tc }} /> eKYC (Aadhaar + PAN)
                </div>
                <div className="flex items-center gap-1.5 text-xs text-white/50 bg-white/5 rounded-full px-3 py-1.5">
                  <ShieldCheck className="w-3 h-3" style={{ color: tc }} /> eSign Agreement
                </div>
                {advisor.requireRiskProfiling && (
                  <div className="flex items-center gap-1.5 text-xs text-white/50 bg-white/5 rounded-full px-3 py-1.5">
                    <ShieldCheck className="w-3 h-3" style={{ color: tc }} /> Risk Profiling
                  </div>
                )}
                {advisor.requirePmla && (
                  <div className="flex items-center gap-1.5 text-xs text-white/50 bg-white/5 rounded-full px-3 py-1.5">
                    <ShieldCheck className="w-3 h-3" style={{ color: tc }} /> PMLA Verification
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TESTIMONIALS */}
        {activeTab === "testimonials" && hasTestimonials && (
          <div className="animate-in fade-in duration-300">
            <h2 className="text-2xl font-bold mb-6">What Our Clients Say</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {ms.testimonials.map((t: any, i: number) => (
                <div key={i} className="bg-slate-900/50 rounded-xl p-6 border border-white/5">
                  <div className="flex gap-1 mb-3">{[1,2,3,4,5].map(s => <Star key={s} className="w-3.5 h-3.5" style={{ color: tc, fill: tc }} />)}</div>
                  <p className="text-sm text-white/60 italic leading-relaxed">"{t.text}"</p>
                  <p className="text-xs font-medium text-white/80 mt-4">— {t.name}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* FAQ */}
        {activeTab === "faq" && hasFaq && (
          <div className="animate-in fade-in duration-300">
            <h2 className="text-2xl font-bold mb-6">Frequently Asked Questions</h2>
            <div className="space-y-3">
              {ms.faq.map((item: any, i: number) => (
                <div key={i} className="bg-slate-900/50 rounded-xl p-6 border border-white/5">
                  <div className="flex items-start gap-3">
                    <HelpCircle className="w-5 h-5 mt-0.5 shrink-0" style={{ color: tc }} />
                    <div>
                      <p className="font-medium text-white mb-2">{item.question}</p>
                      <p className="text-sm text-white/50 leading-relaxed">{item.answer}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CONTACT */}
        {activeTab === "contact" && hasContact && (
          <div className="animate-in fade-in duration-300">
            <h2 className="text-2xl font-bold mb-6">Get in Touch</h2>
            <div className="bg-slate-900/50 rounded-2xl p-8 border border-white/5 max-w-2xl">
              <div className="space-y-5">
                {ms.address && (
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: tc + "15" }}>
                      <MapPin className="w-5 h-5" style={{ color: tc }} />
                    </div>
                    <div>
                      <p className="text-xs text-white/40 mb-1">Address</p>
                      <p className="text-sm text-white/80">{[ms.address, ms.city, ms.state, ms.pincode].filter(Boolean).join(", ")}</p>
                    </div>
                  </div>
                )}
                {ms.contactPhone && (
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: tc + "15" }}>
                      <Phone className="w-5 h-5" style={{ color: tc }} />
                    </div>
                    <div>
                      <p className="text-xs text-white/40 mb-1">Phone</p>
                      <a href={"tel:" + ms.contactPhone} className="text-sm text-white/80 hover:underline">{ms.contactPhone}</a>
                    </div>
                  </div>
                )}
                {ms.contactEmail && (
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: tc + "15" }}>
                      <Mail className="w-5 h-5" style={{ color: tc }} />
                    </div>
                    <div>
                      <p className="text-xs text-white/40 mb-1">Email</p>
                      <a href={"mailto:" + ms.contactEmail} className="text-sm text-white/80 hover:underline">{ms.contactEmail}</a>
                    </div>
                  </div>
                )}
                {ms.websiteUrl && (
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: tc + "15" }}>
                      <Globe className="w-5 h-5" style={{ color: tc }} />
                    </div>
                    <div>
                      <p className="text-xs text-white/40 mb-1">Website</p>
                      <a href={ms.websiteUrl} target="_blank" rel="noopener" className="text-sm text-white/80 hover:underline">{ms.websiteUrl}</a>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ═══ MINIMAL FOOTER ═══ */}
      <div className="border-t border-white/5 py-6">
        <div className="max-w-5xl mx-auto px-6 flex items-center justify-between text-[11px] text-white/20">
          <span>© {new Date().getFullYear()} {advisor.companyName}. All rights reserved.</span>
          <a href="/" className="hover:text-white/40 transition-colors">Powered by AlphaMarket</a>
        </div>
      </div>
    </div>
  );
}

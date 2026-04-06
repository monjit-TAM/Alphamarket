import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useState } from "react";
import { MapPin, Phone, Mail, Globe, ExternalLink, ShieldCheck, BarChart3, Briefcase, Star, HelpCircle, ChevronRight, ArrowRight, Building2 } from "lucide-react";

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
        <div className="w-full max-w-4xl px-4 space-y-6">
          <Skeleton className="h-48 w-full rounded-2xl" />
          <Skeleton className="h-8 w-64" />
          <div className="grid grid-cols-3 gap-4">
            <Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-white flex flex-col items-center justify-center">
        <div className="text-center px-4">
          <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center mx-auto mb-6">
            <Building2 className="w-8 h-8 text-gray-400" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Advisor Not Found</h1>
          <p className="text-gray-500 mb-6">This advisor page does not exist or is not active.</p>
          <Link href="/advisors"><Button className="bg-red-600 hover:bg-red-700 text-white">Browse Advisors</Button></Link>
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
    <div className="min-h-screen bg-white">
      {/* ═══ HERO HEADER ═══ */}
      <div style={{ background: "linear-gradient(135deg, " + tc + "10, " + tc + "05, #fafafa)" }}>
        <div className="max-w-5xl mx-auto px-6 pt-8 pb-10">
          {/* Top bar */}
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              {ms.logoUrl && <img src={ms.logoUrl} alt="" className="w-10 h-10 rounded-lg object-cover border border-gray-200 shadow-sm" />}
              <span className="text-sm font-semibold text-gray-600">{advisor.companyName}</span>
            </div>
            <div className="flex items-center gap-3">
              {(ms.socialLinkedin || ms.socialTwitter || ms.socialYoutube || ms.socialTelegram) && (
                <div className="flex gap-1.5">
                  {ms.socialLinkedin && <a href={ms.socialLinkedin} target="_blank" rel="noopener" className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs text-gray-500 hover:bg-gray-200 transition-colors">in</a>}
                  {ms.socialTwitter && <a href={ms.socialTwitter} target="_blank" rel="noopener" className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs text-gray-500 hover:bg-gray-200 transition-colors">X</a>}
                  {ms.socialYoutube && <a href={ms.socialYoutube} target="_blank" rel="noopener" className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs text-gray-500 hover:bg-gray-200 transition-colors">YT</a>}
                  {ms.socialTelegram && <a href={ms.socialTelegram} target="_blank" rel="noopener" className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs text-gray-500 hover:bg-gray-200 transition-colors">TG</a>}
                </div>
              )}
              <a href="/" className="text-[10px] text-gray-300 hover:text-gray-500 transition-colors border border-gray-200 rounded px-2 py-1">AlphaMarket</a>
            </div>
          </div>

          {/* Banner image */}
          {ms.bannerImageUrl && (
            <div className="rounded-2xl overflow-hidden mb-8 shadow-sm border border-gray-100">
              <img src={ms.bannerImageUrl} alt="" className="w-full h-48 md:h-56 object-cover" />
            </div>
          )}

          {/* Hero content */}
          <div className="max-w-3xl">
            <h1 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">{advisor.companyName}</h1>
            {ms.tagline && <p className="text-lg text-gray-500 mt-2">{ms.tagline}</p>}
            <div className="flex items-center gap-2.5 mt-4 flex-wrap">
              {advisor.sebiRegNumber && (
                <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 bg-white rounded-full px-3 py-1.5 border border-gray-200 shadow-sm">
                  <ShieldCheck className="w-3.5 h-3.5" style={{ color: tc }} /> SEBI: {advisor.sebiRegNumber}
                </span>
              )}
              {advisor.activeSince && (
                <span className="text-xs text-gray-500 bg-white rounded-full px-3 py-1.5 border border-gray-200 shadow-sm">
                  Since {new Date(advisor.activeSince).getFullYear()}
                </span>
              )}
              {strategies.length > 0 && (
                <span className="text-xs text-gray-500 bg-white rounded-full px-3 py-1.5 border border-gray-200 shadow-sm">
                  <BarChart3 className="w-3 h-3 inline mr-1" />{strategies.length} Strategies
                </span>
              )}
            </div>
            {(advisor.themes || []).length > 0 && (
              <div className="flex gap-2 mt-4 flex-wrap">
                {(advisor.themes || []).map((t: string) => (
                  <span key={t} className="text-xs font-medium px-3 py-1 rounded-full border" style={{ background: tc + "10", color: tc, borderColor: tc + "30" }}>{t}</span>
                ))}
              </div>
            )}
          </div>

          {/* Quick stats */}
          <div className="flex gap-8 mt-8">
            {strategies.length > 0 && (
              <div>
                <div className="text-2xl font-bold" style={{ color: tc }}>{strategies.length}</div>
                <div className="text-[11px] text-gray-400 mt-0.5">Strategies</div>
              </div>
            )}
            {data.plans?.length > 0 && (
              <div>
                <div className="text-2xl font-bold" style={{ color: tc }}>{data.plans.length}</div>
                <div className="text-[11px] text-gray-400 mt-0.5">Plans</div>
              </div>
            )}
            {enabledServices.length > 0 && (
              <div>
                <div className="text-2xl font-bold" style={{ color: tc }}>{enabledServices.length}</div>
                <div className="text-[11px] text-gray-400 mt-0.5">Services</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ═══ TAB NAVIGATION ═══ */}
      <div className="sticky top-0 z-20 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex gap-1 overflow-x-auto py-0.5">
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={"px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap border-b-2 " +
                  (activeTab === tab.id
                    ? "border-current text-gray-900"
                    : "border-transparent text-gray-400 hover:text-gray-600")}
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
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-5">About Us</h2>
            <div className="bg-gray-50 rounded-2xl p-8 border border-gray-100">
              <p className="text-gray-600 leading-relaxed whitespace-pre-line text-[15px]">{ms.about}</p>
            </div>
            {ms.websiteUrl && (
              <a href={ms.websiteUrl} target="_blank" rel="noopener" className="inline-flex items-center gap-2 mt-5 text-sm font-medium hover:underline" style={{ color: tc }}>
                <Globe className="w-4 h-4" /> Visit our website <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        )}

        {/* SERVICES */}
        {activeTab === "services" && enabledServices.length > 0 && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-5">Our Services</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {enabledServices.map((svc: any, i: number) => (
                <div key={i} className="bg-white rounded-xl p-6 border border-gray-200 hover:shadow-md transition-shadow">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center mb-4" style={{ background: tc + "12" }}>
                    <Briefcase className="w-5 h-5" style={{ color: tc }} />
                  </div>
                  <h3 className="font-semibold text-gray-900 mb-1">{svc.name}</h3>
                  {svc.description && <p className="text-sm text-gray-500 leading-relaxed">{svc.description}</p>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* STRATEGIES */}
        {activeTab === "strategies" && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-5">Strategies ({strategies.length})</h2>
            {strategies.length === 0 ? (
              <p className="text-gray-400">No published strategies yet.</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {strategies.map((s: any) => (
                  <Link key={s.id} href={"/strategies/" + s.id}>
                    <div className="bg-white rounded-xl p-6 border border-gray-200 hover:shadow-md hover:border-gray-300 transition-all cursor-pointer group">
                      <div className="flex items-start justify-between mb-3">
                        <h3 className="font-semibold text-gray-900 group-hover:underline">{s.name}</h3>
                        <span className="text-[10px] font-medium px-2 py-0.5 rounded-full" style={{ background: tc + "12", color: tc }}>{s.type}</span>
                      </div>
                      {s.description && <p className="text-sm text-gray-400 line-clamp-2 mb-3">{s.description}</p>}
                      <div className="flex items-center gap-4 text-xs text-gray-400">
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
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-5">Plans & Pricing</h2>
            <div className="grid gap-4 md:grid-cols-3">
              {data.plans.map((plan: any, i: number) => (
                <div key={plan.id} className={"rounded-xl p-6 border text-center transition-all hover:shadow-md " + (i === 0 ? "border-2 shadow-sm" : "border-gray-200")}
                  style={i === 0 ? { borderColor: tc } : {}}>
                  {i === 0 && <div className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: tc }}>Most Popular</div>}
                  <p className="font-semibold text-gray-700 mb-2">{plan.name}</p>
                  <div className="text-4xl font-bold mb-1" style={{ color: i === 0 ? tc : "#1a1a1a" }}>
                    {"\u20B9"}{plan.amount.toLocaleString("en-IN")}
                  </div>
                  {plan.durationDays && <p className="text-xs text-gray-400 mb-5">{plan.durationDays} days</p>}
                  <Link href={"/strategies"}>
                    <Button size="sm" className="w-full text-white" style={i === 0 ? { background: tc } : { background: "#374151" }}>
                      Subscribe <ArrowRight className="w-3 h-3 ml-1" />
                    </Button>
                  </Link>
                </div>
              ))}
            </div>

            {/* Compliance badges */}
            <div className="mt-8 p-5 bg-gray-50 rounded-xl border border-gray-100">
              <p className="text-xs text-gray-400 mb-3 font-medium">Compliance Requirements</p>
              <div className="flex gap-2.5 flex-wrap">
                <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 bg-white rounded-full px-3 py-1.5 border border-gray-200">
                  <ShieldCheck className="w-3 h-3" style={{ color: tc }} /> eKYC (Aadhaar + PAN)
                </span>
                <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 bg-white rounded-full px-3 py-1.5 border border-gray-200">
                  <ShieldCheck className="w-3 h-3" style={{ color: tc }} /> eSign Agreement
                </span>
                {advisor.requireRiskProfiling && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 bg-white rounded-full px-3 py-1.5 border border-gray-200">
                    <ShieldCheck className="w-3 h-3" style={{ color: tc }} /> Risk Profiling
                  </span>
                )}
                {advisor.requirePmla && (
                  <span className="inline-flex items-center gap-1.5 text-xs text-gray-500 bg-white rounded-full px-3 py-1.5 border border-gray-200">
                    <ShieldCheck className="w-3 h-3" style={{ color: tc }} /> PMLA Verification
                  </span>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TESTIMONIALS */}
        {activeTab === "testimonials" && hasTestimonials && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-5">What Our Clients Say</h2>
            <div className="grid gap-4 md:grid-cols-2">
              {ms.testimonials.map((t: any, i: number) => (
                <div key={i} className="bg-white rounded-xl p-6 border border-gray-200">
                  <div className="flex gap-0.5 mb-3">{[1,2,3,4,5].map(s => <Star key={s} className="w-3.5 h-3.5" style={{ color: tc, fill: tc }} />)}</div>
                  <p className="text-sm text-gray-500 italic leading-relaxed">"{t.text}"</p>
                  <p className="text-xs font-medium text-gray-700 mt-4">\u2014 {t.name}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* FAQ */}
        {activeTab === "faq" && hasFaq && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-5">Frequently Asked Questions</h2>
            <div className="space-y-3">
              {ms.faq.map((item: any, i: number) => (
                <div key={i} className="bg-white rounded-xl p-6 border border-gray-200">
                  <div className="flex items-start gap-3">
                    <HelpCircle className="w-5 h-5 mt-0.5 shrink-0" style={{ color: tc }} />
                    <div>
                      <p className="font-medium text-gray-900 mb-2">{item.question}</p>
                      <p className="text-sm text-gray-500 leading-relaxed">{item.answer}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* CONTACT */}
        {activeTab === "contact" && hasContact && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-5">Get in Touch</h2>
            <div className="bg-gray-50 rounded-2xl p-8 border border-gray-100 max-w-2xl">
              <div className="space-y-5">
                {ms.address && (
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: tc + "10" }}>
                      <MapPin className="w-5 h-5" style={{ color: tc }} />
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 mb-1">Address</p>
                      <p className="text-sm text-gray-700">{[ms.address, ms.city, ms.state, ms.pincode].filter(Boolean).join(", ")}</p>
                    </div>
                  </div>
                )}
                {ms.contactPhone && (
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: tc + "10" }}>
                      <Phone className="w-5 h-5" style={{ color: tc }} />
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 mb-1">Phone</p>
                      <a href={"tel:" + ms.contactPhone} className="text-sm text-gray-700 hover:underline">{ms.contactPhone}</a>
                    </div>
                  </div>
                )}
                {ms.contactEmail && (
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: tc + "10" }}>
                      <Mail className="w-5 h-5" style={{ color: tc }} />
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 mb-1">Email</p>
                      <a href={"mailto:" + ms.contactEmail} className="text-sm text-gray-700 hover:underline">{ms.contactEmail}</a>
                    </div>
                  </div>
                )}
                {ms.websiteUrl && (
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0" style={{ background: tc + "10" }}>
                      <Globe className="w-5 h-5" style={{ color: tc }} />
                    </div>
                    <div>
                      <p className="text-xs text-gray-400 mb-1">Website</p>
                      <a href={ms.websiteUrl} target="_blank" rel="noopener" className="text-sm text-gray-700 hover:underline">{ms.websiteUrl}</a>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ═══ MINIMAL FOOTER ═══ */}
      <div className="border-t border-gray-100 py-6 bg-gray-50">
        <div className="max-w-5xl mx-auto px-6 flex items-center justify-between text-[11px] text-gray-300">
          <span>\u00A9 {new Date().getFullYear()} {advisor.companyName}. All rights reserved.</span>
          <a href="/" className="hover:text-gray-500 transition-colors">Powered by AlphaMarket</a>
        </div>
      </div>
    </div>
  );
}

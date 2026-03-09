import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, MapPin, Phone, Mail, Globe, ExternalLink, ShieldCheck, BarChart3 } from "lucide-react";

export default function AdvisorMicrosite() {
  const params = useParams<{ slug: string }>();
  const slug = params.slug || "";

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
      <div className="min-h-screen bg-background flex flex-col">
        <Navbar />
        <div className="flex-1 max-w-5xl mx-auto px-4 py-10 space-y-6 w-full">
          <Skeleton className="h-48 w-full rounded-xl" />
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96" />
          <div className="grid grid-cols-3 gap-4">
            <Skeleton className="h-32" /><Skeleton className="h-32" /><Skeleton className="h-32" />
          </div>
        </div>
        <Footer />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <Navbar />
        <div className="flex-1 max-w-xl mx-auto px-4 py-20 text-center">
          <h1 className="text-2xl font-bold mb-2">Advisor Not Found</h1>
          <p className="text-muted-foreground mb-4">This advisor page does not exist or is not active.</p>
          <Link href="/advisors"><Button>Browse Advisors</Button></Link>
        </div>
        <Footer />
      </div>
    );
  }

  const { microsite: ms, advisor, strategies } = data;
  const themeColor = ms.themeColor || "#E53E3E";

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <div className="flex-1">
        <div className="relative overflow-hidden" style={{ background: "linear-gradient(135deg, " + themeColor + "15, " + themeColor + "05)" }}>
          <div className="max-w-5xl mx-auto px-4 py-12">
            <div className="flex items-start gap-6 flex-wrap">
              {ms.logoUrl && (
                <img src={ms.logoUrl} alt={advisor.companyName} className="w-20 h-20 rounded-xl object-cover border-2 border-white shadow-lg" />
              )}
              <div className="flex-1 min-w-0">
                <h1 className="text-3xl font-bold">{advisor.companyName}</h1>
                {ms.tagline && <p className="text-lg text-muted-foreground mt-1">{ms.tagline}</p>}
                <div className="flex items-center gap-3 mt-3 flex-wrap">
                  {advisor.sebiRegNumber && (
                    <Badge variant="outline" className="text-xs">
                      <ShieldCheck className="w-3 h-3 mr-1" /> SEBI: {advisor.sebiRegNumber}
                    </Badge>
                  )}
                  {advisor.activeSince && (
                    <Badge variant="secondary" className="text-xs">
                      Since {new Date(advisor.activeSince).getFullYear()}
                    </Badge>
                  )}
                  {(advisor.themes || []).map((t: string) => (
                    <Badge key={t} variant="secondary" className="text-xs">{t}</Badge>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="max-w-5xl mx-auto px-4 py-8 space-y-8">

          {ms.showAbout && ms.about && (
            <section>
              <h2 className="text-xl font-bold mb-3">About</h2>
              <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{ms.about}</p>
            </section>
          )}

          <section>
            <h2 className="text-xl font-bold mb-4">Strategies ({strategies.length})</h2>
            {strategies.length === 0 ? (
              <p className="text-sm text-muted-foreground">No published strategies yet.</p>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {strategies.map((s: any) => (
                  <Link key={s.id} href={"/strategies/" + s.id}>
                    <Card className="cursor-pointer hover:shadow-md transition-shadow">
                      <CardContent className="p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <h3 className="font-semibold">{s.name}</h3>
                          <Badge variant="secondary" className="text-xs">{s.type}</Badge>
                        </div>
                        {s.description && <p className="text-xs text-muted-foreground line-clamp-2">{s.description}</p>}
                        <div className="flex items-center gap-4 text-xs text-muted-foreground">
                          {s.horizon && <span>Horizon: {s.horizon}</span>}
                          {s.riskLevel && <span>Risk: {s.riskLevel}</span>}
                          {s.cagr && <span className="text-green-600 font-medium">CAGR: {s.cagr}%</span>}
                        </div>
                      </CardContent>
                    </Card>
                  </Link>
                ))}
              </div>
            )}
          </section>

          {ms.showPerformance && strategies.length > 0 && (
            <section>
              <h2 className="text-xl font-bold mb-3">Compliance Requirements</h2>
              <div className="flex gap-3 flex-wrap">
                <Badge variant="outline" className="py-1.5 px-3"><ShieldCheck className="w-3 h-3 mr-1" /> eKYC (Aadhaar + PAN)</Badge>
                <Badge variant="outline" className="py-1.5 px-3"><ShieldCheck className="w-3 h-3 mr-1" /> eSign Agreement</Badge>
                {advisor.requireRiskProfiling && <Badge variant="outline" className="py-1.5 px-3"><ShieldCheck className="w-3 h-3 mr-1" /> Risk Profiling</Badge>}
                {advisor.requirePmla && <Badge variant="outline" className="py-1.5 px-3"><ShieldCheck className="w-3 h-3 mr-1" /> PMLA Verification</Badge>}
              </div>
            </section>
          )}

          {ms.showContact && (ms.contactPhone || ms.contactEmail || ms.address) && (
            <section>
              <h2 className="text-xl font-bold mb-3">Contact</h2>
              <Card>
                <CardContent className="p-4 space-y-2 text-sm">
                  {ms.address && (
                    <div className="flex items-start gap-2">
                      <MapPin className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                      <span>{[ms.address, ms.city, ms.state, ms.pincode].filter(Boolean).join(", ")}</span>
                    </div>
                  )}
                  {ms.contactPhone && (
                    <div className="flex items-center gap-2">
                      <Phone className="w-4 h-4 text-muted-foreground" />
                      <a href={"tel:" + ms.contactPhone} className="hover:underline">{ms.contactPhone}</a>
                    </div>
                  )}
                  {ms.contactEmail && (
                    <div className="flex items-center gap-2">
                      <Mail className="w-4 h-4 text-muted-foreground" />
                      <a href={"mailto:" + ms.contactEmail} className="hover:underline">{ms.contactEmail}</a>
                    </div>
                  )}
                  {ms.websiteUrl && (
                    <div className="flex items-center gap-2">
                      <Globe className="w-4 h-4 text-muted-foreground" />
                      <a href={ms.websiteUrl} target="_blank" rel="noopener" className="hover:underline">{ms.websiteUrl}</a>
                    </div>
                  )}
                  {(ms.socialLinkedin || ms.socialTwitter || ms.socialYoutube || ms.socialTelegram) && (
                    <div className="flex gap-3 pt-2">
                      {ms.socialLinkedin && <a href={ms.socialLinkedin} target="_blank" rel="noopener" className="text-xs text-muted-foreground hover:underline">LinkedIn</a>}
                      {ms.socialTwitter && <a href={ms.socialTwitter} target="_blank" rel="noopener" className="text-xs text-muted-foreground hover:underline">Twitter</a>}
                      {ms.socialYoutube && <a href={ms.socialYoutube} target="_blank" rel="noopener" className="text-xs text-muted-foreground hover:underline">YouTube</a>}
                      {ms.socialTelegram && <a href={ms.socialTelegram} target="_blank" rel="noopener" className="text-xs text-muted-foreground hover:underline">Telegram</a>}
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>
          )}

          {ms.showFaq && ms.faq?.length > 0 && (
            <section>
              <h2 className="text-xl font-bold mb-3">FAQ</h2>
              <div className="space-y-3">
                {ms.faq.map((item: any, i: number) => (
                  <Card key={i}>
                    <CardContent className="p-4">
                      <p className="font-medium text-sm">{item.question}</p>
                      <p className="text-xs text-muted-foreground mt-1">{item.answer}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}

          {ms.showTestimonials && ms.testimonials?.length > 0 && (
            <section>
              <h2 className="text-xl font-bold mb-3">Testimonials</h2>
              <div className="grid gap-4 md:grid-cols-2">
                {ms.testimonials.map((t: any, i: number) => (
                  <Card key={i}>
                    <CardContent className="p-4">
                      <p className="text-sm italic text-muted-foreground">"{t.text}"</p>
                      <p className="text-xs font-medium mt-2">- {t.name}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
      <Footer />
    </div>
  );
}

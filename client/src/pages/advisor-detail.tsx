import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Calendar, TrendingUp, BarChart3, Shield, ExternalLink, Zap, CheckCircle, MessageCircle, Send } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";
import type { User, Strategy, Content as ContentType, Score } from "@shared/schema";

export default function AdvisorDetail() {
  const { id } = useParams<{ id: string }>();

  const { data: advisor, isLoading } = useQuery<User & { strategies?: Strategy[]; contents?: ContentType[]; scores?: Score[] }>({
    queryKey: ["/api/advisors", id],
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-5xl mx-auto px-4 md:px-6 py-6 space-y-4">
          <Skeleton className="h-8 w-60" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  if (!advisor) return null;

  const publishedStrategies = (advisor.strategies || []).filter((s) => s.status === "Published");

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <div className="flex-1 max-w-5xl mx-auto px-4 md:px-6 py-6 space-y-6 w-full">
        <div className="flex flex-col md:flex-row gap-4 items-start">
          <Avatar className="w-16 h-16">
            {advisor.logoUrl && <AvatarImage src={advisor.logoUrl} />}
            <AvatarFallback className="bg-primary/10 text-primary font-bold text-lg">
              {(advisor.companyName || advisor.username).slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-bold" data-testid="text-advisor-name">{advisor.companyName || advisor.username}</h1>
              <Badge variant="secondary">
                <Shield className="w-3 h-3 mr-1" /> Registered
              </Badge>
            </div>
            {advisor.sebiRegNumber && (
              <p className="text-sm text-muted-foreground" data-testid="text-sebi-reg">Registration: {advisor.sebiRegNumber}</p>
            )}
            {advisor.themes && advisor.themes.length > 0 && (
              <p className="text-sm text-muted-foreground">Theme: {advisor.themes.join(" | ")}</p>
            )}
          </div>
        </div>

        <div className="grid md:grid-cols-5 gap-6">
          <div className="md:col-span-3 space-y-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Details</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line" data-testid="text-advisor-overview">
                  {advisor.overview || "No overview provided."}
                </p>
                <div className="flex items-center gap-6 mt-4 text-sm flex-wrap">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
                      <Calendar className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Active Since</p>
                      <p className="font-medium text-xs">
                        {advisor.activeSince
                          ? new Date(advisor.activeSince).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                          : "N/A"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-md bg-accent/10 flex items-center justify-center">
                      <Zap className="w-4 h-4 text-accent" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Live Strategies</p>
                      <p className="font-medium">{publishedStrategies.length}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-md bg-primary/10 flex items-center justify-center">
                      <CheckCircle className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Registered</p>
                      <p className="font-medium text-xs">Yes</p>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Live Strategies ({publishedStrategies.length})</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {publishedStrategies.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">No live strategies yet</p>
                ) : (
                  publishedStrategies.map((s) => (
                    <div key={s.id} className="flex items-center justify-between gap-3 p-3 rounded-md bg-muted/50" data-testid={`strategy-row-${s.id}`}>
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{s.name}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <Badge variant="outline" className="text-xs">{s.type}</Badge>
                          {s.horizon && <span className="text-xs text-muted-foreground">{s.horizon}</span>}
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-1 mt-1">{s.description}</p>
                      </div>
                      <Link href={`/strategies/${s.id}`}>
                        <Button variant="outline" size="sm" data-testid={`button-strategy-${s.id}`}>
                          <ExternalLink className="w-3 h-3 mr-1" /> Subscribe
                        </Button>
                      </Link>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>

          <div className="md:col-span-2 space-y-6">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Adviser Details</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-2 text-sm">
                  <div className="p-2 rounded-md bg-muted/50 text-center space-y-1">
                    <p className="text-xs text-muted-foreground">Theme</p>
                    <p className="font-medium">{advisor.themes?.join(" | ") || "Equity"}</p>
                  </div>
                  <div className="p-2 rounded-md bg-muted/50 text-center space-y-1">
                    <p className="text-xs text-muted-foreground">Registration Number</p>
                    <p className="font-medium">{advisor.sebiRegNumber || "N/A"}</p>
                  </div>
                  <div className="p-2 rounded-md bg-muted/50 text-center space-y-1">
                    <p className="text-xs text-muted-foreground">Active Since</p>
                    <p className="font-medium">
                      {advisor.activeSince
                        ? new Date(advisor.activeSince).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })
                        : "N/A"}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Content Portfolio</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                {(advisor.contents || []).length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-2">No content published</p>
                ) : (
                  (advisor.contents || []).filter((c) => !["RiskAdvisory", "Disclaimer", "TermsConditions"].includes(c.type)).slice(0, 5).map((c) => (
                    <a key={c.id} href={`/content/${c.id}`} className="flex items-center gap-2 text-sm p-2 rounded-md bg-muted/50 hover:bg-muted cursor-pointer no-underline text-inherit" data-testid={`content-item-${c.id}`}>
                      <BarChart3 className="w-3 h-3 text-primary flex-shrink-0" />
                      <span className="truncate">{c.title}</span>
                    </a>
                  ))
                )}
              </CardContent>
            </Card>

            {(
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Customer Complaints as per <a href="https://scores.sebi.gov.in" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">SCORES</a></CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="p-2 rounded-md bg-primary/10 text-center space-y-1">
                      <p className="text-muted-foreground">At beginning</p>
                      <p className="font-semibold">{advisor.scores?.[0]?.beginningOfMonth || 0}</p>
                    </div>
                    <div className="p-2 rounded-md bg-primary/10 text-center space-y-1">
                      <p className="text-muted-foreground">Received</p>
                      <p className="font-semibold">{advisor.scores?.[0]?.receivedDuring || 0}</p>
                    </div>
                    <div className="p-2 rounded-md bg-accent/10 text-center space-y-1">
                      <p className="text-muted-foreground">Resolved</p>
                      <p className="font-semibold">{advisor.scores?.[0]?.resolvedDuring || 0}</p>
                    </div>
                    <div className="p-2 rounded-md bg-primary/10 text-center space-y-1">
                      <p className="text-muted-foreground">Pending</p>
                      <p className="font-semibold">{advisor.scores?.[0]?.pendingAtEnd || 0}</p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Risk Disclosure */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Risk Disclosure</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(advisor.contents || []).filter((c) => c.type === "RiskAdvisory").map((c) => (
                  <a key={c.id} href={`/content/${c.id}`} className="block text-sm p-3 rounded-md bg-blue-50 dark:bg-blue-950 hover:bg-blue-100 dark:hover:bg-blue-900 cursor-pointer no-underline">
                    <span className="font-semibold text-blue-700 dark:text-blue-300">{c.title}</span>
                  </a>
                ))}
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                  {advisor.risk_disclosure || "Investment in securities market is subject to market risks. Read all the related documents carefully before investing. Registration granted by SEBI and certification from NISM in no way guarantee performance of the intermediary or provide any assurance of returns to investors. The securities quoted are exemplary and are not recommendatory. Past performance is not indicative of future results. Please note that equity investments are subject to market risks and there is no guarantee of returns. The value of investments may fluctuate and investors may receive back less than the amount invested. It is recommended that investors seek independent financial advice before making any investment decisions."}
                </p>
              </CardContent>
            </Card>

            {/* Disclaimer */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Disclaimer</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {(advisor.contents || []).filter((c) => ["Disclaimer", "TermsConditions"].includes(c.type)).map((c) => (
                  <a key={c.id} href={`/content/${c.id}`} className="block text-sm p-3 rounded-md bg-blue-50 dark:bg-blue-950 hover:bg-blue-100 dark:hover:bg-blue-900 cursor-pointer no-underline">
                    <span className="font-semibold text-blue-700 dark:text-blue-300">{c.title}</span>
                  </a>
                ))}
                <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-wrap">
                  {advisor.disclaimer || ("The information and recommendations provided herein are for general informational and educational purposes only. This does not constitute an offer to buy or sell securities. The research analyst/investment adviser" + (advisor.sebi_reg_number ? " (SEBI Reg: " + advisor.sebi_reg_number + ")" : "") + " and its associates are not responsible for any losses incurred from acting on the recommendations. Clients are advised to independently verify the information and consult their financial advisors before making any investment decisions. The advisor may or may not hold positions in the securities recommended. Any dispute arising out of the advisory services shall be subject to the jurisdiction of the courts in India.")}
                </p>
              </CardContent>
            </Card>

            {/* Terms & Conditions */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Terms & Conditions</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-muted-foreground leading-relaxed space-y-2">
                  <p>1. The advisory services provided are based on the research and analysis of the advisor. The advisor does not guarantee any specific returns.</p>
                  <p>2. All recommendations are time-bound. Clients should exit positions at the recommended stop-loss or target levels.</p>
                  <p>3. The advisor may modify or close recommendations at any time based on market conditions.</p>
                  <p>4. Clients must perform their own due diligence before acting on any recommendation.</p>
                  <p>5. The advisor is SEBI-registered{advisor.sebi_reg_number ? " (Reg: " + advisor.sebi_reg_number + ")" : ""} and complies with all applicable SEBI regulations.</p>
                  <p className="text-xs mt-3">For grievances, visit <a href="https://scores.sebi.gov.in" target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">SEBI SCORES Portal</a></p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        <AskQuestionForm advisorId={id!} />
      </div>
      <Footer />
    </div>
  );
}

function AskQuestionForm({ advisorId }: { advisorId: string }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [question, setQuestion] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      const body: any = { question };
      if (!user) {
        body.name = name;
        body.email = email;
        if (phone) body.phone = phone;
      }
      await apiRequest("POST", `/api/advisors/${advisorId}/questions`, body);
    },
    onSuccess: () => {
      setSubmitted(true);
      setQuestion("");
      setName("");
      setEmail("");
      setPhone("");
      toast({ title: "Question submitted", description: "The advisor will respond to your question soon." });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const canSubmit = question.trim() && (user || (name.trim() && email.trim()));

  return (
    <Card id="ask-question" data-testid="card-ask-question">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <MessageCircle className="w-4 h-4" /> Ask a Question
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {submitted ? (
          <div className="text-center py-4 space-y-2">
            <CheckCircle className="w-8 h-8 text-green-500 mx-auto" />
            <p className="text-sm font-medium">Your question has been submitted!</p>
            <p className="text-xs text-muted-foreground">The advisor will get back to you soon.</p>
            <Button variant="outline" size="sm" onClick={() => setSubmitted(false)} data-testid="button-ask-another">
              Ask Another Question
            </Button>
          </div>
        ) : (
          <>
            {!user && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="q-name" className="text-xs">Name *</Label>
                  <Input
                    id="q-name"
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    data-testid="input-question-name"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="q-email" className="text-xs">Email *</Label>
                  <Input
                    id="q-email"
                    type="email"
                    placeholder="your@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    data-testid="input-question-email"
                  />
                </div>
                <div className="space-y-1 sm:col-span-2">
                  <Label htmlFor="q-phone" className="text-xs">Phone (optional)</Label>
                  <Input
                    id="q-phone"
                    placeholder="Phone number"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    data-testid="input-question-phone"
                  />
                </div>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="q-text" className="text-xs">Your Question *</Label>
              <Textarea
                id="q-text"
                placeholder="Type your question here..."
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                className="resize-none"
                rows={3}
                data-testid="input-question-text"
              />
            </div>
            <Button
              onClick={() => mutation.mutate()}
              disabled={!canSubmit || mutation.isPending}
              className="w-full sm:w-auto"
              data-testid="button-submit-question"
            >
              <Send className="w-3 h-3 mr-1" />
              {mutation.isPending ? "Submitting..." : "Submit Question"}
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  );
}

import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle, XCircle, Clock, Key, RefreshCw, Bell, Send } from "lucide-react";

interface TokenStatus {
  hasToken: boolean;
  source: string;
  setAt: string | null;
  expiresAt: string | null;
  isExpired: boolean;
}

export default function AdminSettings() {
  const { toast } = useToast();
  const [token, setToken] = useState("");
  const [notifTitle, setNotifTitle] = useState("");
  const [notifBody, setNotifBody] = useState("");
  const [notifUrl, setNotifUrl] = useState("");
  const [notifScope, setNotifScope] = useState("all_users");
  const [siteContent, setSiteContent] = useState<any>({ statsAdvisors: "", statsStrategies: "", statsCustomers: "", footerTagline: "" });

  const { data: loadedContent } = useQuery<any>({ queryKey: ["/api/site-content"] });
  if (loadedContent && !siteContent._loaded) {
    setSiteContent({ ...loadedContent, _loaded: true });
  }

  const saveContentMutation = useMutation({
    mutationFn: async (content: any) => {
      const { _loaded, ...clean } = content;
      const res = await apiRequest("PUT", "/api/admin/site-content", clean);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Saved", description: "Site content updated successfully." });
      queryClient.invalidateQueries({ queryKey: ["/api/site-content"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to save", variant: "destructive" });
    },
  });

  const FOOTER_PAGES = [
    { slug: "privacy-policy", name: "Privacy Policy" },
    { slug: "terms-and-conditions", name: "Terms and Conditions" },
    { slug: "legal-agreement", name: "Legal Disclosures" },
    { slug: "cancellation-policy", name: "Cancellation & Refund" },
    { slug: "shipping-and-delivery", name: "Shipping & Delivery" },
    { slug: "contact-us", name: "Contact Us" },
  ];
  const [selectedPage, setSelectedPage] = useState("privacy-policy");
  const [pageMarkdown, setPageMarkdown] = useState("");
  const [pageLoadedFor, setPageLoadedFor] = useState("");

  const { data: pageContentData } = useQuery<any>({
    queryKey: [`/api/page-content/${selectedPage}`],
  });
  if (pageContentData && pageLoadedFor !== selectedPage) {
    setPageMarkdown(pageContentData.content || "");
    setPageLoadedFor(selectedPage);
  }

  const savePageMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/admin/page-content/${selectedPage}`, { content: pageMarkdown });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Page Saved", description: "Page content updated. Changes are live." });
      queryClient.invalidateQueries({ queryKey: [`/api/page-content/${selectedPage}`] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to save page", variant: "destructive" });
    },
  });

  const resetPageMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/admin/page-content/${selectedPage}`, {});
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Reset", description: "Page reverted to built-in default." });
      setPageMarkdown("");
      setPageLoadedFor("");
      queryClient.invalidateQueries({ queryKey: [`/api/page-content/${selectedPage}`] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to reset", variant: "destructive" });
    },
  });

  // ─── Newsletter state ───
  const [nlSubject, setNlSubject] = useState("The Alpha Edge — Issue #01");
  const [nlHtml, setNlHtml] = useState("");
  const [nlIncludeAllAdvisors, setNlIncludeAllAdvisors] = useState(true);
  const [nlExtraEmails, setNlExtraEmails] = useState("");
  const [nlSending, setNlSending] = useState(false);
  const [nlResult, setNlResult] = useState<any>(null);

  const { data: advisorEmailData } = useQuery<any>({ queryKey: ["/api/admin/advisor-emails"] });
  const { data: newsletterLog } = useQuery<any>({ queryKey: ["/api/admin/newsletter-log"] });

  const sendNewsletter = async () => {
    if (!nlSubject.trim() || !nlHtml.trim()) {
      toast({ title: "Missing fields", description: "Subject and HTML content are required.", variant: "destructive" });
      return;
    }
    const advisorCount = advisorEmailData?.count || 0;
    const extras = nlExtraEmails.split(/[\n,;]+/).map((e) => e.trim()).filter((e) => e.includes("@"));
    const totalEst = (nlIncludeAllAdvisors ? advisorCount : 0) + extras.length;
    if (!confirm(`Send "${nlSubject}" to approximately ${totalEst} recipient(s)?${nlIncludeAllAdvisors ? " This includes ALL registered advisors." : ""}`)) return;
    setNlSending(true);
    setNlResult(null);
    try {
      const res = await apiRequest("POST", "/api/admin/send-newsletter", {
        subject: nlSubject.trim(),
        html: nlHtml,
        includeAllAdvisors: nlIncludeAllAdvisors,
        extraEmails: extras,
      });
      const data = await res.json();
      setNlResult(data);
      toast({ title: "Newsletter sent", description: `${data.sent} sent, ${data.failed} failed (of ${data.total}).` });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/newsletter-log"] });
    } catch (err: any) {
      toast({ title: "Send failed", description: err.message || "Could not send newsletter", variant: "destructive" });
    } finally {
      setNlSending(false);
    }
  };

  const previewNewsletter = () => {
    if (!nlHtml.trim()) {
      toast({ title: "Nothing to preview", description: "Paste the newsletter HTML first.", variant: "destructive" });
      return;
    }
    const previewHtml = nlHtml.replace(/\{\{unsubscribe\}\}/g, '<span style="color:#94a3b8;">Unsubscribe</span>');
    const win = window.open("", "_blank");
    if (win) {
      win.document.open();
      win.document.write(previewHtml);
      win.document.close();
    } else {
      toast({ title: "Popup blocked", description: "Allow popups for this site to preview, or use Send Test.", variant: "destructive" });
    }
  };

  const [nlTestEmail, setNlTestEmail] = useState("");
  const [nlTesting, setNlTesting] = useState(false);
  const sendTestNewsletter = async () => {
    const target = nlTestEmail.trim();
    if (!target.includes("@")) {
      toast({ title: "Enter a valid email", description: "Add an email address to send the test to.", variant: "destructive" });
      return;
    }
    if (!nlSubject.trim() || !nlHtml.trim()) {
      toast({ title: "Missing fields", description: "Subject and HTML content are required.", variant: "destructive" });
      return;
    }
    setNlTesting(true);
    try {
      const res = await apiRequest("POST", "/api/admin/send-newsletter", {
        subject: "[TEST] " + nlSubject.trim(),
        html: nlHtml,
        includeAllAdvisors: false,
        extraEmails: [target],
      });
      const data = await res.json();
      toast({ title: "Test sent", description: `Test email sent to ${target} (${data.sent} sent, ${data.failed} failed).` });
    } catch (err: any) {
      toast({ title: "Test failed", description: err.message || "Could not send test", variant: "destructive" });
    } finally {
      setNlTesting(false);
    }
  };

  // Newsletter library + upload
  const { data: nlLibrary } = useQuery<any>({ queryKey: ["/api/admin/newsletter-library"] });
  const [nlSaveName, setNlSaveName] = useState("");

  const handleHtmlUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".html") && !file.name.toLowerCase().endsWith(".htm")) {
      toast({ title: "Wrong file type", description: "Please upload an .html file.", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      setNlHtml(text);
      toast({ title: "File loaded", description: `${file.name} loaded into the editor (${(text.length/1024).toFixed(0)} KB).` });
    };
    reader.onerror = () => toast({ title: "Read failed", description: "Could not read the file.", variant: "destructive" });
    reader.readAsText(file);
    e.target.value = ""; // reset so same file can be re-picked
  };

  const loadFromLibrary = async (id: string) => {
    if (!id) return;
    try {
      const res = await apiRequest("GET", `/api/admin/newsletter-library/${id}`, undefined);
      const data = await res.json();
      setNlHtml(data.html || "");
      if (data.subject) setNlSubject(data.subject);
      toast({ title: "Loaded", description: `"${data.name}" loaded into the editor.` });
    } catch (err: any) {
      toast({ title: "Load failed", description: err.message, variant: "destructive" });
    }
  };

  const saveToLibrary = async () => {
    const name = nlSaveName.trim();
    if (!name) { toast({ title: "Name required", description: "Give this newsletter a name to save it.", variant: "destructive" }); return; }
    if (!nlHtml.trim()) { toast({ title: "Nothing to save", description: "Load or paste HTML first.", variant: "destructive" }); return; }
    try {
      await apiRequest("POST", "/api/admin/newsletter-library", { name, subject: nlSubject, html: nlHtml });
      toast({ title: "Saved to library", description: `"${name}" is now available to reuse.` });
      setNlSaveName("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/newsletter-library"] });
    } catch (err: any) {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    }
  };


  const { data: tokenStatus, isLoading } = useQuery<TokenStatus>({
    queryKey: ["/api/admin/groww-token-status"],
    refetchInterval: 30000,
  });

  const setTokenMutation = useMutation({
    mutationFn: async (accessToken: string) => {
      const res = await apiRequest("POST", "/api/admin/groww-token", { token: accessToken });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Token Updated", description: `Groww access token set successfully. Expires in ${data.expiresIn}.` });
      setToken("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/groww-token-status"] });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message || "Failed to set token", variant: "destructive" });
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) return;
    setTokenMutation.mutate(token.trim());
  };

  const formatDateTime = (iso: string | null) => {
    if (!iso) return "N/A";
    return new Date(iso).toLocaleString("en-IN", {
      timeZone: "Asia/Kolkata",
      dateStyle: "medium",
      timeStyle: "short",
    });
  };

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h2 className="text-xl font-semibold" data-testid="text-settings-title">Settings</h2>
        <p className="text-sm text-muted-foreground mt-1">Manage platform configuration</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 flex-wrap">
            <Key className="w-5 h-5 text-muted-foreground" />
            <CardTitle className="text-lg">Groww API Access Token</CardTitle>
          </div>
          <CardDescription>
            Groww access tokens expire daily at 6:00 AM IST. Paste a new token here each day to enable live market prices.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="space-y-3">
            <Label className="text-sm font-medium">Current Token Status</Label>
            {isLoading ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <RefreshCw className="w-3 h-3 animate-spin" />
                Checking status...
              </div>
            ) : tokenStatus ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2 flex-wrap">
                  {tokenStatus.hasToken ? (
                    <Badge variant="default" className="bg-green-600 border-green-700" data-testid="badge-token-active">
                      <CheckCircle className="w-3 h-3 mr-1" />
                      Active
                    </Badge>
                  ) : tokenStatus.isExpired ? (
                    <Badge variant="destructive" data-testid="badge-token-expired">
                      <XCircle className="w-3 h-3 mr-1" />
                      Expired
                    </Badge>
                  ) : (
                    <Badge variant="secondary" data-testid="badge-token-none">
                      <XCircle className="w-3 h-3 mr-1" />
                      No Token Set
                    </Badge>
                  )}
                  {tokenStatus.source !== "none" && (
                    <Badge variant="outline" data-testid="badge-token-source">
                      {tokenStatus.source === "manual" ? "Manually Set" : "API Key+Secret"}
                    </Badge>
                  )}
                </div>
                {tokenStatus.setAt && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span data-testid="text-token-set-at">Set at: {formatDateTime(tokenStatus.setAt)}</span>
                  </div>
                )}
                {tokenStatus.expiresAt && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="w-3 h-3" />
                    <span data-testid="text-token-expires-at">Expires: {formatDateTime(tokenStatus.expiresAt)}</span>
                  </div>
                )}
              </div>
            ) : null}
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="groww-token">Paste Access Token</Label>
              <Input
                id="groww-token"
                type="password"
                placeholder="Enter Groww access token..."
                value={token}
                onChange={(e) => setToken(e.target.value)}
                data-testid="input-groww-token"
              />
            </div>
            <Button
              type="submit"
              disabled={!token.trim() || setTokenMutation.isPending}
              data-testid="button-set-token"
            >
              {setTokenMutation.isPending ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin" />
                  Setting Token...
                </>
              ) : (
                "Set Access Token"
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 flex-wrap">
            <Bell className="w-5 h-5 text-muted-foreground" />
            <CardTitle className="text-lg">Broadcast Notifications</CardTitle>
          </div>
          <CardDescription>
            Send push notifications to all registered users or all visitors including non-logged-in users.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="notif-title">Title</Label>
            <Input
              id="notif-title"
              placeholder="Notification title..."
              value={notifTitle}
              onChange={(e) => setNotifTitle(e.target.value)}
              data-testid="input-notif-title"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notif-body">Message</Label>
            <Textarea
              id="notif-body"
              placeholder="Notification message..."
              value={notifBody}
              onChange={(e) => setNotifBody(e.target.value)}
              rows={3}
              data-testid="input-notif-body"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="notif-url">Link URL (optional)</Label>
            <Input
              id="notif-url"
              placeholder="/strategies or https://..."
              value={notifUrl}
              onChange={(e) => setNotifUrl(e.target.value)}
              data-testid="input-notif-url"
            />
          </div>
          <div className="space-y-2">
            <Label>Audience</Label>
            <Select value={notifScope} onValueChange={setNotifScope}>
              <SelectTrigger data-testid="select-notif-scope">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all_users">All Registered Users</SelectItem>
                <SelectItem value="all_visitors">All Users + Visitors</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            disabled={!notifTitle.trim() || !notifBody.trim()}
            onClick={async () => {
              try {
                await apiRequest("POST", "/api/admin/notifications", {
                  title: notifTitle.trim(),
                  body: notifBody.trim(),
                  url: notifUrl.trim() || "/",
                  scope: notifScope,
                });
                toast({ title: "Notification Sent", description: "Broadcast notification sent successfully." });
                setNotifTitle("");
                setNotifBody("");
                setNotifUrl("");
              } catch (err: any) {
                toast({ title: "Error", description: err.message || "Failed to send notification", variant: "destructive" });
              }
            }}
            data-testid="button-send-notification"
          >
            <Send className="w-4 h-4 mr-1" />
            Send Notification
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 flex-wrap">
            <RefreshCw className="w-5 h-5 text-muted-foreground" />
            <CardTitle>Homepage & Footer Content</CardTitle>
          </div>
          <CardDescription>Edit the stat counters and tagline shown on the homepage and footer. Changes go live immediately.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <Label className="text-xs">Advisors Count</Label>
              <Input value={siteContent.statsAdvisors || ""} placeholder="60+"
                onChange={(e) => setSiteContent((p: any) => ({ ...p, statsAdvisors: e.target.value }))}
                data-testid="input-stats-advisors" />
            </div>
            <div>
              <Label className="text-xs">Strategies Count</Label>
              <Input value={siteContent.statsStrategies || ""} placeholder="100+"
                onChange={(e) => setSiteContent((p: any) => ({ ...p, statsStrategies: e.target.value }))}
                data-testid="input-stats-strategies" />
            </div>
            <div>
              <Label className="text-xs">Customers Reached</Label>
              <Input value={siteContent.statsCustomers || ""} placeholder="3M+"
                onChange={(e) => setSiteContent((p: any) => ({ ...p, statsCustomers: e.target.value }))}
                data-testid="input-stats-customers" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Footer Tagline</Label>
            <Textarea rows={2} value={siteContent.footerTagline || ""} placeholder="India's marketplace connecting investors with SEBI-registered advisors."
              onChange={(e) => setSiteContent((p: any) => ({ ...p, footerTagline: e.target.value }))}
              data-testid="input-footer-tagline" />
          </div>

          <div className="border-t pt-4">
            <Label className="text-sm font-semibold">Footer Link Columns</Label>
            <p className="text-xs text-muted-foreground mb-3">Edit headings, link labels and URLs. Leave URL blank for non-clickable text. Use full https:// for external links or /path for internal pages.</p>
            <div className="space-y-4">
              {(siteContent.footerColumns || []).map((col: any, ci: number) => (
                <div key={ci} className="border rounded-md p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Input className="font-semibold" value={col.heading || ""} placeholder="Column Heading"
                      onChange={(e) => setSiteContent((p: any) => {
                        const cols = [...(p.footerColumns || [])];
                        cols[ci] = { ...cols[ci], heading: e.target.value };
                        return { ...p, footerColumns: cols };
                      })} />
                    <Button variant="ghost" size="sm" className="text-destructive"
                      onClick={() => setSiteContent((p: any) => {
                        const cols = [...(p.footerColumns || [])];
                        cols.splice(ci, 1);
                        return { ...p, footerColumns: cols };
                      })}>Remove Column</Button>
                  </div>
                  {(col.links || []).map((link: any, li: number) => (
                    <div key={li} className="flex items-center gap-2 pl-2">
                      <Input className="text-xs" value={link.label || ""} placeholder="Link Label"
                        onChange={(e) => setSiteContent((p: any) => {
                          const cols = [...(p.footerColumns || [])];
                          const links = [...(cols[ci].links || [])];
                          links[li] = { ...links[li], label: e.target.value };
                          cols[ci] = { ...cols[ci], links };
                          return { ...p, footerColumns: cols };
                        })} />
                      <Input className="text-xs" value={link.url || ""} placeholder="/path or https://..."
                        onChange={(e) => setSiteContent((p: any) => {
                          const cols = [...(p.footerColumns || [])];
                          const links = [...(cols[ci].links || [])];
                          links[li] = { ...links[li], url: e.target.value };
                          cols[ci] = { ...cols[ci], links };
                          return { ...p, footerColumns: cols };
                        })} />
                      <Button variant="ghost" size="sm" className="text-destructive px-2"
                        onClick={() => setSiteContent((p: any) => {
                          const cols = [...(p.footerColumns || [])];
                          const links = [...(cols[ci].links || [])];
                          links.splice(li, 1);
                          cols[ci] = { ...cols[ci], links };
                          return { ...p, footerColumns: cols };
                        })}>×</Button>
                    </div>
                  ))}
                  <Button variant="outline" size="sm" className="ml-2 text-xs"
                    onClick={() => setSiteContent((p: any) => {
                      const cols = [...(p.footerColumns || [])];
                      const links = [...(cols[ci].links || []), { label: "New Link", url: "" }];
                      cols[ci] = { ...cols[ci], links };
                      return { ...p, footerColumns: cols };
                    })}>+ Add Link</Button>
                </div>
              ))}
              <Button variant="outline" size="sm"
                onClick={() => setSiteContent((p: any) => ({
                  ...p, footerColumns: [...(p.footerColumns || []), { heading: "New Column", links: [] }]
                }))}>+ Add Column</Button>
            </div>
          </div>

          <div>
            <Label className="text-xs">Footer Disclaimer (bottom text)</Label>
            <Textarea rows={3} value={siteContent.footerDisclaimer || ""} placeholder="Investment in securities market is subject to market risk..."
              onChange={(e) => setSiteContent((p: any) => ({ ...p, footerDisclaimer: e.target.value }))}
              data-testid="input-footer-disclaimer" />
          </div>

          <Button
            disabled={saveContentMutation.isPending}
            onClick={() => saveContentMutation.mutate(siteContent)}
            data-testid="button-save-site-content"
          >
            {saveContentMutation.isPending ? "Saving..." : "Save Content"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 flex-wrap">
            <Key className="w-5 h-5 text-muted-foreground" />
            <CardTitle>Footer Page Content Editor</CardTitle>
          </div>
          <CardDescription>
            Rewrite the full content of any footer page using Markdown. Supports # headings, **bold**, [links](url), and - bullet lists.
            Leave empty and click Reset to restore the built-in default. Changes go live immediately.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs">Select Page</Label>
            <Select value={selectedPage} onValueChange={(v) => { setSelectedPage(v); setPageLoadedFor(""); }}>
              <SelectTrigger data-testid="select-footer-page"><SelectValue /></SelectTrigger>
              <SelectContent>
                {FOOTER_PAGES.map((p) => (
                  <SelectItem key={p.slug} value={p.slug}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {pageContentData && (
              <p className="text-xs text-muted-foreground mt-1">
                {pageContentData.hasCustomContent
                  ? "This page is using custom content."
                  : "This page is using the built-in default. Start typing to override it."}
              </p>
            )}
          </div>
          <div>
            <Label className="text-xs">Page Content (Markdown)</Label>
            <Textarea
              rows={18}
              className="font-mono text-xs"
              value={pageMarkdown}
              placeholder={"# Section Heading\n\nYour paragraph text here. Use **bold** for emphasis and [link text](https://example.com) for links.\n\n## Subheading\n\n- First bullet point\n- Second bullet point"}
              onChange={(e) => setPageMarkdown(e.target.value)}
              data-testid="input-page-markdown"
            />
          </div>
          <div className="flex gap-2">
            <Button
              disabled={savePageMutation.isPending || !pageMarkdown.trim()}
              onClick={() => savePageMutation.mutate()}
              data-testid="button-save-page"
            >
              {savePageMutation.isPending ? "Saving..." : "Save Page"}
            </Button>
            <Button
              variant="outline"
              disabled={resetPageMutation.isPending || !pageContentData?.hasCustomContent}
              onClick={() => { if (confirm("Reset this page to the built-in default? Your custom content will be deleted.")) resetPageMutation.mutate(); }}
              data-testid="button-reset-page"
            >
              Reset to Default
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2 flex-wrap">
            <Send className="w-5 h-5 text-muted-foreground" />
            <CardTitle>Advisor Newsletter</CardTitle>
          </div>
          <CardDescription>
            Send an HTML newsletter to your registered advisors via SendGrid. Paste the HTML, choose recipients, and send.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label className="text-xs">Subject Line</Label>
            <Input value={nlSubject} onChange={(e) => setNlSubject(e.target.value)} data-testid="input-nl-subject" />
          </div>

          <div className="border rounded-md p-3 space-y-3 bg-slate-50">
            <Label className="text-xs font-semibold">Load Newsletter Content</Label>
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <Label className="text-xs text-muted-foreground">Upload .html file</Label>
                <Input type="file" accept=".html,.htm" onChange={handleHtmlUpload} data-testid="input-nl-upload" className="text-xs" />
              </div>
              {Array.isArray(nlLibrary) && nlLibrary.length > 0 && (
                <div>
                  <Label className="text-xs text-muted-foreground">Or load a saved one</Label>
                  <Select onValueChange={loadFromLibrary}>
                    <SelectTrigger className="min-w-[200px]" data-testid="select-nl-library"><SelectValue placeholder="Choose saved newsletter" /></SelectTrigger>
                    <SelectContent>
                      {nlLibrary.map((n: any) => (
                        <SelectItem key={n.id} value={String(n.id)}>{n.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">Upload the exported .html file directly — no copy-paste needed. Or pick a newsletter you've saved before.</p>
          </div>

          <div>
            <Label className="text-xs">Newsletter HTML {nlHtml && <span className="text-green-600">({(nlHtml.length/1024).toFixed(0)} KB loaded)</span>}</Label>
            <Textarea rows={8} className="font-mono text-xs" value={nlHtml}
              placeholder="Upload a file above, load a saved newsletter, or paste HTML here."
              onChange={(e) => setNlHtml(e.target.value)} data-testid="input-nl-html" />
            <div className="flex gap-2 items-center mt-2">
              <Input className="max-w-[240px] text-xs" placeholder="Name to save as (e.g. Issue #01)" value={nlSaveName}
                onChange={(e) => setNlSaveName(e.target.value)} data-testid="input-nl-savename" />
              <Button variant="outline" size="sm" onClick={saveToLibrary} data-testid="button-nl-save">Save to Library</Button>
            </div>
          </div>

          <div className="border rounded-md p-3 space-y-3 bg-slate-50">
            <div className="flex items-center gap-2">
              <input type="checkbox" id="nl-all-advisors" checked={nlIncludeAllAdvisors}
                onChange={(e) => setNlIncludeAllAdvisors(e.target.checked)}
                className="rounded border-slate-300" data-testid="checkbox-nl-all" />
              <Label htmlFor="nl-all-advisors" className="text-sm cursor-pointer">
                Send to all registered advisors
                {advisorEmailData?.count != null && (
                  <span className="text-muted-foreground"> ({advisorEmailData.count} on file)</span>
                )}
              </Label>
            </div>
            <div>
              <Label className="text-xs">Additional Email IDs (optional)</Label>
              <Textarea rows={3} value={nlExtraEmails}
                placeholder="Add extra recipients — one per line, or comma-separated. e.g. partner@example.com"
                onChange={(e) => setNlExtraEmails(e.target.value)} data-testid="input-nl-extra" />
              <p className="text-xs text-muted-foreground mt-1">These are added on top of the advisor list. Duplicates are removed automatically.</p>
            </div>
          </div>

          <div className="border rounded-md p-3 space-y-2 bg-blue-50/50">
            <Label className="text-xs font-semibold">Preview & Test First</Label>
            <div className="flex gap-2 flex-wrap items-center">
              <Button variant="outline" size="sm" onClick={previewNewsletter} data-testid="button-preview-newsletter">
                Preview in New Tab
              </Button>
              <Input className="max-w-[240px]" placeholder="your@email.com" value={nlTestEmail}
                onChange={(e) => setNlTestEmail(e.target.value)} data-testid="input-nl-test" />
              <Button variant="outline" size="sm" disabled={nlTesting} onClick={sendTestNewsletter} data-testid="button-test-newsletter">
                {nlTesting ? "Sending…" : "Send Test"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Preview opens the newsletter in a new tab. Send Test emails just the one address so you can check it in a real inbox before the full send.</p>
          </div>

          <Button disabled={nlSending} onClick={sendNewsletter} data-testid="button-send-newsletter">
            <Send className="w-4 h-4 mr-1" />
            {nlSending ? "Sending…" : "Send Newsletter to All"}
          </Button>

          {nlResult && (
            <div className="text-sm border rounded-md p-3 bg-green-50 text-green-900">
              Sent: <strong>{nlResult.sent}</strong> · Failed: <strong>{nlResult.failed}</strong> · Total: <strong>{nlResult.total}</strong>
              {nlResult.errors && nlResult.errors.length > 0 && (
                <div className="mt-2 text-xs text-red-700">
                  <div className="font-semibold">First errors:</div>
                  {nlResult.errors.map((er: string, i: number) => <div key={i}>{er}</div>)}
                </div>
              )}
            </div>
          )}

          {Array.isArray(newsletterLog) && newsletterLog.length > 0 && (
            <div className="text-xs text-muted-foreground border-t pt-3">
              <div className="font-semibold mb-1">Recent sends</div>
              {newsletterLog.slice(0, 5).map((log: any, i: number) => (
                <div key={i}>
                  {new Date(log.at).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" })} — "{log.subject}" · {log.sent}/{log.total} sent
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

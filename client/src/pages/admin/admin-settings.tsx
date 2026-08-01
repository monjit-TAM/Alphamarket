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
    </div>
  );
}

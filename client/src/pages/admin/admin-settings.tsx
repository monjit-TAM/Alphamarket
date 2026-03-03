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
    </div>
  );
}

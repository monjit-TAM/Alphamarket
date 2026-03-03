import { useState, useEffect, useCallback } from "react";
import { Bell, BellOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function NotificationBell() {
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [swRegistration, setSwRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [permissionState, setPermissionState] = useState<NotificationPermission>("default");
  const { toast } = useToast();
  const { user } = useAuth();

  const { data: notifications } = useQuery<any[]>({
    queryKey: ["/api/notifications/recent"],
    enabled: !!user,
    refetchInterval: 60000,
  });

  const checkSubscription = useCallback(async (reg: ServiceWorkerRegistration) => {
    const sub = await reg.pushManager.getSubscription();
    setIsSubscribed(!!sub);
    return !!sub;
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;

    setPermissionState(Notification.permission);

    navigator.serviceWorker.register("/sw.js").then(async (reg) => {
      setSwRegistration(reg);
      await checkSubscription(reg);
    }).catch((err) => {
      console.error("SW registration failed:", err);
    });
  }, [checkSubscription]);

  const subscribeToPush = async () => {
    if (!swRegistration) return;

    try {
      const permission = await Notification.requestPermission();
      setPermissionState(permission);
      if (permission !== "granted") {
        toast({ title: "Permission denied", description: "Please enable notifications in your browser settings.", variant: "destructive" });
        return;
      }

      const res = await fetch("/api/notifications/vapid-key");
      const { publicKey } = await res.json();

      const subscription = await swRegistration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      });

      await fetch("/api/notifications/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });

      setIsSubscribed(true);
      toast({ title: "Notifications enabled", description: "You'll receive alerts for your subscribed strategies." });
    } catch (err) {
      console.error("Push subscription failed:", err);
      toast({ title: "Failed to enable", description: "Could not enable push notifications.", variant: "destructive" });
    }
  };

  const unsubscribeFromPush = async () => {
    if (!swRegistration) return;

    try {
      const sub = await swRegistration.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/notifications/subscribe", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ endpoint: sub.endpoint }),
        });
        await sub.unsubscribe();
      }
      setIsSubscribed(false);
      toast({ title: "Notifications disabled", description: "You won't receive push alerts anymore." });
    } catch (err) {
      console.error("Unsubscribe failed:", err);
    }
  };

  const supportsPush = "serviceWorker" in navigator && "PushManager" in window;
  if (!supportsPush) return null;

  const recentNotifications = (notifications || []).slice(0, 10);

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          data-testid="button-notification-bell"
        >
          {isSubscribed ? (
            <Bell className="w-4 h-4" />
          ) : (
            <BellOff className="w-4 h-4 text-muted-foreground" />
          )}
          {isSubscribed && recentNotifications.length > 0 && (
            <span className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-destructive" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0" data-testid="popover-notifications">
        <div className="p-3 border-b">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-medium text-sm">Notifications</h4>
            {isSubscribed ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={unsubscribeFromPush}
                className="text-xs h-7"
                data-testid="button-disable-notifications"
              >
                <BellOff className="w-3 h-3 mr-1" />
                Disable
              </Button>
            ) : (
              <Button
                variant="default"
                size="sm"
                onClick={subscribeToPush}
                className="text-xs h-7"
                data-testid="button-enable-notifications"
              >
                <Bell className="w-3 h-3 mr-1" />
                Enable
              </Button>
            )}
          </div>
          {permissionState === "denied" && (
            <p className="text-xs text-destructive mt-1">
              Notifications are blocked. Please enable them in your browser settings.
            </p>
          )}
        </div>
        <div className="max-h-64 overflow-y-auto">
          {recentNotifications.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">
              {isSubscribed ? "No recent notifications" : "Enable notifications to receive alerts"}
            </div>
          ) : (
            recentNotifications.map((n: any) => (
              <div
                key={n.id}
                className="px-3 py-2 border-b last:border-b-0 hover-elevate"
                data-testid={`notification-item-${n.id}`}
              >
                <p className="text-sm font-medium">{n.title}</p>
                <p className="text-xs text-muted-foreground">{n.body}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {n.createdAt ? new Date(n.createdAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }) : ""}
                </p>
              </div>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}

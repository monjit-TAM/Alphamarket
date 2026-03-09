import { useState, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { Globe, Save, Eye, Upload, Loader2, CheckCircle2, ExternalLink } from "lucide-react";

export default function MicrositeEditor() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const { data: msData, isLoading } = useQuery<any>({
    queryKey: ["/api/advisor/microsite"],
  });

  const [form, setForm] = useState({
    slug: "", tagline: "", about: "", themeColor: "#E53E3E",
    logoUrl: "", bannerImageUrl: "", address: "", city: "", state: "", pincode: "",
    contactPhone: "", contactEmail: "", websiteUrl: "",
    socialLinkedin: "", socialTwitter: "", socialYoutube: "", socialTelegram: "",
    showPerformance: true, showTestimonials: false, showContact: true,
    showFaq: false, showAbout: true, testimonials: [], faq: [],
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

  const uploadFile = async (field: string) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.onchange = async (e: any) => {
      const file = e.target.files?.[0];
      if (!file) return;
      const formData = new FormData();
      formData.append("file", file);
      try {
        const res = await fetch("/api/advisor/microsite/upload", {
          method: "POST", body: formData, credentials: "include",
        });
        const data = await res.json();
        if (data.url) {
          setForm(f => ({ ...f, [field]: data.url }));
          toast({ title: "Image uploaded" });
        }
      } catch (err) {
        toast({ title: "Upload failed", variant: "destructive" });
      }
    };
    input.click();
  };

  if (!user) { navigate("/login"); return null; }

  const micrositeUrl = "https://alphamarket.co.in/advisor/" + form.slug;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <div className="flex-1 max-w-4xl mx-auto px-4 py-6 space-y-6 w-full">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h1 className="text-2xl font-bold">My Microsite</h1>
            <p className="text-sm text-muted-foreground">Configure your public advisor page</p>
          </div>
          <div className="flex gap-2">
            {msData?.exists && (
              <Button variant="outline" size="sm" onClick={() => window.open("/advisor/" + form.slug, "_blank")}>
                <Eye className="w-3 h-3 mr-1" /> Preview
              </Button>
            )}
            <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
              {saveMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
              Save
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

        <Card>
          <CardHeader><CardTitle className="text-base">URL & Branding</CardTitle></CardHeader>
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
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-sm">Logo</Label>
                <div className="flex items-center gap-2">
                  {form.logoUrl && <img src={form.logoUrl} className="w-10 h-10 rounded object-cover" />}
                  <Button variant="outline" size="sm" onClick={() => uploadFile("logoUrl")}><Upload className="w-3 h-3 mr-1" /> Upload Logo</Button>
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-sm">Banner Image</Label>
                <div className="flex items-center gap-2">
                  {form.bannerImageUrl && <img src={form.bannerImageUrl} className="w-16 h-10 rounded object-cover" />}
                  <Button variant="outline" size="sm" onClick={() => uploadFile("bannerImageUrl")}><Upload className="w-3 h-3 mr-1" /> Upload Banner</Button>
                </div>
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

        <Card>
          <CardHeader><CardTitle className="text-base">About</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1">
              <Label className="text-sm">About / Investment Philosophy</Label>
              <textarea value={form.about} onChange={e => setForm({...form, about: e.target.value})}
                className="w-full min-h-[120px] p-3 rounded-md border text-sm bg-background" placeholder="Tell investors about your approach..." />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Contact & Address</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label className="text-sm">Phone</Label>
                <Input value={form.contactPhone} onChange={e => setForm({...form, contactPhone: e.target.value})} placeholder="+91 98765 43210" />
              </div>
              <div className="space-y-1">
                <Label className="text-sm">Email</Label>
                <Input value={form.contactEmail} onChange={e => setForm({...form, contactEmail: e.target.value})} placeholder="advisor@example.com" />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Address</Label>
              <Input value={form.address} onChange={e => setForm({...form, address: e.target.value})} placeholder="Office address" />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-1">
                <Label className="text-sm">City</Label>
                <Input value={form.city} onChange={e => setForm({...form, city: e.target.value})} />
              </div>
              <div className="space-y-1">
                <Label className="text-sm">State</Label>
                <Input value={form.state} onChange={e => setForm({...form, state: e.target.value})} />
              </div>
              <div className="space-y-1">
                <Label className="text-sm">Pincode</Label>
                <Input value={form.pincode} onChange={e => setForm({...form, pincode: e.target.value})} maxLength={6} />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-sm">Website</Label>
              <Input value={form.websiteUrl} onChange={e => setForm({...form, websiteUrl: e.target.value})} placeholder="https://yourwebsite.com" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Social Links</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1"><Label className="text-sm">LinkedIn</Label><Input value={form.socialLinkedin} onChange={e => setForm({...form, socialLinkedin: e.target.value})} placeholder="LinkedIn profile URL" /></div>
              <div className="space-y-1"><Label className="text-sm">Twitter / X</Label><Input value={form.socialTwitter} onChange={e => setForm({...form, socialTwitter: e.target.value})} placeholder="Twitter profile URL" /></div>
              <div className="space-y-1"><Label className="text-sm">YouTube</Label><Input value={form.socialYoutube} onChange={e => setForm({...form, socialYoutube: e.target.value})} placeholder="YouTube channel URL" /></div>
              <div className="space-y-1"><Label className="text-sm">Telegram</Label><Input value={form.socialTelegram} onChange={e => setForm({...form, socialTelegram: e.target.value})} placeholder="Telegram channel URL" /></div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Section Visibility</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {[
              { key: "showAbout", label: "About Section" },
              { key: "showPerformance", label: "Performance Stats" },
              { key: "showContact", label: "Contact Information" },
              { key: "showTestimonials", label: "Testimonials" },
              { key: "showFaq", label: "FAQ Section" },
            ].map(({ key, label }) => (
              <div key={key} className="flex items-center justify-between py-1">
                <Label className="text-sm">{label}</Label>
                <Switch checked={(form as any)[key]} onCheckedChange={v => setForm({...form, [key]: v})} />
              </div>
            ))}
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2 pb-6">
          <Button size="sm" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
            {saveMutation.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
            Save Microsite
          </Button>
        </div>
      </div>
      <Footer />
    </div>
  );
}

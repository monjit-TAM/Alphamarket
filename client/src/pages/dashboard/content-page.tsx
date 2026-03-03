import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Plus, MoreVertical, Loader2, FileText, Upload, X, Image, Film, Music, File as FileIcon } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import type { Content as ContentType } from "@shared/schema";
import { Skeleton } from "@/components/ui/skeleton";

function getFileIcon(name: string) {
  const lower = name.toLowerCase();
  if (lower.match(/\.(jpg|jpeg|png|gif|webp|svg)$/)) return Image;
  if (lower.match(/\.(mp4|mov|avi|webm|mkv)$/)) return Film;
  if (lower.match(/\.(mp3|wav|ogg|aac)$/)) return Music;
  if (lower.match(/\.(pdf)$/)) return FileText;
  return FileIcon;
}

export default function ContentPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [showNew, setShowNew] = useState(false);
  const [contentType, setContentType] = useState("MarketUpdate");

  const { data: contents, isLoading } = useQuery<ContentType[]>({
    queryKey: ["/api/advisor/content"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: any) => {
      const res = await apiRequest("POST", "/api/content", data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/content"] });
      setShowNew(false);
      toast({ title: "Content added" });
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("DELETE", `/api/content/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/content"] });
      toast({ title: "Content deleted" });
    },
  });

  const contentTypes = [
    { label: "Add Terms & Conditions", type: "Terms" },
    { label: "Add Risk Advisory", type: "RiskAdvisory" },
    { label: "Add Learn", type: "Learn" },
    { label: "Add Market Update", type: "MarketUpdate" },
  ];

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-lg font-semibold">Content</h2>
        <div className="flex flex-wrap gap-2">
          {contentTypes.map((ct) => (
            <Button
              key={ct.type}
              size="sm"
              variant={ct.type === "Terms" || ct.type === "RiskAdvisory" ? "default" : "outline"}
              onClick={() => {
                setContentType(ct.type);
                setShowNew(true);
              }}
              data-testid={`button-add-${ct.type.toLowerCase()}`}
            >
              {ct.label}
            </Button>
          ))}
        </div>
      </div>

      <h3 className="text-xl font-bold">All pages</h3>

      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : !contents || contents.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center text-muted-foreground">
            No content published yet. Add terms, research, or market updates.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-1">
          {contents.map((c) => (
            <div
              key={c.id}
              className="flex items-center justify-between px-4 py-3 border-b hover-elevate rounded-md"
              data-testid={`content-item-${c.id}`}
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <FileText className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                <span className="font-medium truncate">{c.title}</span>
                {c.attachments && c.attachments.length > 0 && (
                  <Badge variant="secondary" className="text-xs flex-shrink-0">
                    {c.attachments.length} file{c.attachments.length > 1 ? "s" : ""}
                  </Badge>
                )}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon">
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={() => deleteMutation.mutate(c.id)}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          ))}
        </div>
      )}

      <NewContentDialog
        open={showNew}
        onOpenChange={setShowNew}
        type={contentType}
        onSubmit={(data) => createMutation.mutate({ ...data, advisorId: user?.id })}
        loading={createMutation.isPending}
      />
    </div>
  );
}

function NewContentDialog({
  open,
  onOpenChange,
  type,
  onSubmit,
  loading,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  type: string;
  onSubmit: (data: any) => void;
  loading: boolean;
}) {
  const [form, setForm] = useState({ title: "", body: "" });
  const [attachments, setAttachments] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const { toast } = useToast();

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    setUploading(true);
    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        const urlRes = await fetch("/api/uploads/request-url", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: file.name,
            size: file.size,
            contentType: file.type || "application/octet-stream",
          }),
        });
        if (!urlRes.ok) throw new Error("Failed to get upload URL");
        const { uploadURL, objectPath } = await urlRes.json();

        await fetch(uploadURL, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type || "application/octet-stream" },
        });

        setAttachments((prev) => [...prev, objectPath]);
      }
      toast({ title: `${files.length} file${files.length > 1 ? "s" : ""} uploaded` });
    } catch (err: any) {
      toast({ title: "Upload failed", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ ...form, type, attachments: attachments.length > 0 ? attachments : undefined });
    setForm({ title: "", body: "" });
    setAttachments([]);
  };

  const handleOpenChange = (v: boolean) => {
    if (!v) {
      setForm({ title: "", body: "" });
      setAttachments([]);
    }
    onOpenChange(v);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add {type === "MarketUpdate" ? "Market Update" : type === "RiskAdvisory" ? "Risk Advisory" : type}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              required
              data-testid="input-content-title"
            />
          </div>
          <div className="space-y-1.5">
            <Label>Content</Label>
            <Textarea
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              rows={6}
              data-testid="input-content-body"
            />
          </div>

          <div className="space-y-2">
            <Label>Attachments (PDF, Images, Videos, Audio)</Label>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => document.getElementById("file-upload-input")?.click()}
                data-testid="button-upload-files"
              >
                {uploading ? (
                  <Loader2 className="w-4 h-4 mr-1 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4 mr-1" />
                )}
                {uploading ? "Uploading..." : "Choose Files"}
              </Button>
              <input
                id="file-upload-input"
                type="file"
                multiple
                accept="image/*,video/*,audio/*,.pdf"
                className="hidden"
                onChange={handleFileUpload}
              />
              <span className="text-xs text-muted-foreground">
                Supports: JPEG, PNG, PDF, MP4, MP3
              </span>
            </div>

            {attachments.length > 0 && (
              <div className="space-y-1.5 mt-2">
                {attachments.map((path, idx) => {
                  const fileName = path.split("/").pop() || `File ${idx + 1}`;
                  const Icon = getFileIcon(fileName);
                  return (
                    <div
                      key={idx}
                      className="flex items-center justify-between px-3 py-2 rounded-md bg-muted/50 text-sm"
                      data-testid={`attachment-${idx}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon className="w-4 h-4 text-muted-foreground flex-shrink-0" />
                        <span className="truncate">{fileName}</span>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="flex-shrink-0"
                        onClick={() => removeAttachment(idx)}
                        data-testid={`button-remove-attachment-${idx}`}
                      >
                        <X className="w-3 h-3" />
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <Button type="submit" className="w-full" disabled={loading || uploading} data-testid="button-save-content">
            {loading && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
            Save
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

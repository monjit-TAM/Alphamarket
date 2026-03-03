import { useQuery } from "@tanstack/react-query";
import { useParams } from "wouter";
import { Navbar } from "@/components/navbar";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Calendar, ArrowLeft, FileText, Image, Film, Music, File } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import type { Content } from "@shared/schema";

type ContentWithAdvisor = Content & {
  advisor: { id: string; username: string; companyName: string | null; logoUrl: string | null };
};

function getAttachmentIcon(url: string) {
  const lower = url.toLowerCase();
  if (lower.match(/\.(jpg|jpeg|png|gif|webp|svg)$/)) return Image;
  if (lower.match(/\.(mp4|mov|avi|webm)$/)) return Film;
  if (lower.match(/\.(mp3|wav|ogg|aac)$/)) return Music;
  if (lower.match(/\.(pdf)$/)) return FileText;
  return File;
}

function getAttachmentType(url: string): string {
  const lower = url.toLowerCase();
  if (lower.match(/\.(jpg|jpeg|png|gif|webp|svg)$/)) return "image";
  if (lower.match(/\.(mp4|mov|avi|webm)$/)) return "video";
  if (lower.match(/\.(mp3|wav|ogg|aac)$/)) return "audio";
  if (lower.match(/\.(pdf)$/)) return "pdf";
  return "file";
}

export default function ContentDetail() {
  const { id } = useParams<{ id: string }>();

  const { data: item, isLoading } = useQuery<ContentWithAdvisor>({
    queryKey: ["/api/content", id],
  });

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <Navbar />
        <div className="max-w-4xl mx-auto px-4 md:px-6 py-8 space-y-4">
          <Skeleton className="h-8 w-60" />
          <Skeleton className="h-40 w-full" />
        </div>
      </div>
    );
  }

  if (!item) return null;

  const typeLabel = item.type === "MarketUpdate" ? "Market Update"
    : item.type === "RiskAdvisory" ? "Risk Advisory"
    : item.type;

  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <div className="max-w-4xl mx-auto px-4 md:px-6 py-8">
        <Link href={item.type === "MarketUpdate" ? "/market-outlook" : item.type === "Learn" ? "/learn" : "/"}>
          <Button variant="ghost" size="sm" className="mb-4" data-testid="button-back">
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
        </Link>

        <Card>
          <CardContent className="p-6 md:p-8 space-y-6">
            <div className="space-y-3">
              <Badge variant="secondary">{typeLabel}</Badge>
              <h1 className="text-2xl md:text-3xl font-bold leading-tight" data-testid="text-content-title">
                {item.title}
              </h1>
              <div className="flex items-center gap-3 flex-wrap">
                <Link href={`/advisors/${item.advisor.id}`} data-testid="link-advisor">
                  <div className="flex items-center gap-1.5 cursor-pointer">
                    <Avatar className="w-6 h-6">
                      <AvatarFallback className="text-[10px] bg-primary text-primary-foreground">
                        {(item.advisor.companyName || item.advisor.username).slice(0, 2).toUpperCase()}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-medium">
                      {item.advisor.companyName || item.advisor.username}
                    </span>
                  </div>
                </Link>
                {item.createdAt && (
                  <div className="flex items-center gap-1 text-sm text-muted-foreground">
                    <Calendar className="w-3.5 h-3.5" />
                    {new Date(item.createdAt).toLocaleDateString("en-IN", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })}
                  </div>
                )}
              </div>
            </div>

            {item.body && (
              <div className="prose prose-sm max-w-none" data-testid="text-content-body">
                <p className="text-base leading-relaxed whitespace-pre-line">{item.body}</p>
              </div>
            )}

            {item.attachments && item.attachments.length > 0 && (
              <div className="space-y-3 pt-4 border-t">
                <h3 className="text-sm font-semibold text-muted-foreground">Attachments</h3>
                <div className="space-y-3">
                  {item.attachments.map((url, idx) => {
                    const type = getAttachmentType(url);
                    const Icon = getAttachmentIcon(url);
                    const fileName = url.split("/").pop() || `Attachment ${idx + 1}`;

                    return (
                      <div key={idx} className="space-y-2">
                        {type === "image" && (
                          <img src={url} alt={fileName} className="max-w-full rounded-md border" data-testid={`img-attachment-${idx}`} />
                        )}
                        {type === "video" && (
                          <video controls className="max-w-full rounded-md border" data-testid={`video-attachment-${idx}`}>
                            <source src={url} />
                          </video>
                        )}
                        {type === "audio" && (
                          <audio controls className="w-full" data-testid={`audio-attachment-${idx}`}>
                            <source src={url} />
                          </audio>
                        )}
                        {type === "pdf" && (
                          <iframe src={url} className="w-full h-[600px] border rounded-md" title={fileName} data-testid={`pdf-attachment-${idx}`} />
                        )}
                        <a
                          href={url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                          data-testid={`link-attachment-${idx}`}
                        >
                          <Icon className="w-4 h-4" />
                          {fileName}
                        </a>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

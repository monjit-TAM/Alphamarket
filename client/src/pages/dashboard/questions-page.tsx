import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { MessageCircle, Mail, Phone, Clock, Send, CheckCircle, Circle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";

interface AdvisorQuestion {
  id: string;
  advisorId: string;
  userId: string | null;
  name: string;
  email: string;
  phone: string | null;
  question: string;
  answer: string | null;
  isRead: boolean;
  answeredAt: string | null;
  createdAt: string;
}

export default function QuestionsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");

  const { data: questions, isLoading } = useQuery<AdvisorQuestion[]>({
    queryKey: ["/api/advisor/questions"],
  });

  const replyMutation = useMutation({
    mutationFn: async ({ id, answer }: { id: string; answer: string }) => {
      await apiRequest("PATCH", `/api/advisor/questions/${id}`, { answer });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/questions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/questions/unread-count"] });
      setReplyingTo(null);
      setReplyText("");
      toast({ title: "Reply sent" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const markReadMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest("PATCH", `/api/advisor/questions/${id}`, { isRead: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/questions"] });
      queryClient.invalidateQueries({ queryKey: ["/api/advisor/questions/unread-count"] });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-60" />
        <Skeleton className="h-32" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  const unreadQuestions = (questions || []).filter(q => !q.isRead);
  const answeredQuestions = (questions || []).filter(q => q.answer);
  const unansweredQuestions = (questions || []).filter(q => !q.answer);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-xl font-bold flex items-center gap-2" data-testid="text-questions-title">
          <MessageCircle className="w-5 h-5" /> Questions ({(questions || []).length})
        </h1>
        {unreadQuestions.length > 0 && (
          <Badge variant="destructive" data-testid="badge-unread-count">
            {unreadQuestions.length} unread
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4 text-center space-y-1">
            <p className="text-xs text-muted-foreground">Total</p>
            <p className="text-xl font-bold" data-testid="text-total-questions">{(questions || []).length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center space-y-1">
            <p className="text-xs text-muted-foreground">Unanswered</p>
            <p className="text-xl font-bold text-amber-600 dark:text-amber-400" data-testid="text-unanswered">{unansweredQuestions.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4 text-center space-y-1">
            <p className="text-xs text-muted-foreground">Answered</p>
            <p className="text-xl font-bold text-green-600 dark:text-green-400" data-testid="text-answered">{answeredQuestions.length}</p>
          </CardContent>
        </Card>
      </div>

      {(!questions || questions.length === 0) ? (
        <Card>
          <CardContent className="py-12 text-center space-y-2">
            <MessageCircle className="w-10 h-10 mx-auto text-muted-foreground/50" />
            <p className="text-sm text-muted-foreground">No questions received yet</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {questions.map((q) => (
            <Card
              key={q.id}
              className={!q.isRead ? "bg-primary/5" : ""}
              data-testid={`card-question-${q.id}`}
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm" data-testid={`text-question-name-${q.id}`}>{q.name}</span>
                      {!q.isRead && (
                        <Badge variant="destructive" className="text-[10px]">New</Badge>
                      )}
                      {q.answer && (
                        <Badge variant="secondary" className="text-[10px] bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">
                          <CheckCircle className="w-2.5 h-2.5 mr-0.5" /> Answered
                        </Badge>
                      )}
                      {q.userId && (
                        <Badge variant="outline" className="text-[10px]">Registered User</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                      <span className="flex items-center gap-1">
                        <Mail className="w-3 h-3" /> {q.email}
                      </span>
                      {q.phone && (
                        <span className="flex items-center gap-1">
                          <Phone className="w-3 h-3" /> {q.phone}
                        </span>
                      )}
                      <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(q.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  </div>
                  {!q.isRead && !q.answer && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => markReadMutation.mutate(q.id)}
                      data-testid={`button-mark-read-${q.id}`}
                    >
                      <Circle className="w-3 h-3 mr-1" /> Mark Read
                    </Button>
                  )}
                </div>

                <div className="bg-muted/50 rounded-md p-3">
                  <p className="text-sm" data-testid={`text-question-${q.id}`}>{q.question}</p>
                </div>

                {q.answer && (
                  <div className="bg-green-50 dark:bg-green-950/20 rounded-md p-3 space-y-1">
                    <p className="text-xs font-medium text-green-700 dark:text-green-400">Your Reply</p>
                    <p className="text-sm" data-testid={`text-answer-${q.id}`}>{q.answer}</p>
                    {q.answeredAt && (
                      <p className="text-xs text-muted-foreground">
                        {new Date(q.answeredAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                      </p>
                    )}
                  </div>
                )}

                {!q.answer && (
                  <>
                    {replyingTo === q.id ? (
                      <div className="space-y-2">
                        <Textarea
                          placeholder="Type your reply..."
                          value={replyText}
                          onChange={(e) => setReplyText(e.target.value)}
                          className="resize-none"
                          rows={3}
                          data-testid={`input-reply-${q.id}`}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            onClick={() => replyMutation.mutate({ id: q.id, answer: replyText })}
                            disabled={!replyText.trim() || replyMutation.isPending}
                            data-testid={`button-send-reply-${q.id}`}
                          >
                            <Send className="w-3 h-3 mr-1" />
                            {replyMutation.isPending ? "Sending..." : "Send Reply"}
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => { setReplyingTo(null); setReplyText(""); }}
                            data-testid={`button-cancel-reply-${q.id}`}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => { setReplyingTo(q.id); setReplyText(""); }}
                        data-testid={`button-reply-${q.id}`}
                      >
                        <Send className="w-3 h-3 mr-1" /> Reply
                      </Button>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

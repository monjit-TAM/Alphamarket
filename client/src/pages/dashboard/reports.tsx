import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Download, FileText, Users, IndianRupee, BarChart3 } from "lucide-react";

export default function ReportsPage() {
  const reports = [
    {
      title: "Calls Report",
      description: "Complete report of all buy/sell calls published across strategies with entry, exit prices and returns.",
      icon: BarChart3,
    },
    {
      title: "Customer Acquisition Report",
      description: "Detailed breakdown of subscribers acquired per plan and strategy with EKYC and risk profiling status.",
      icon: Users,
    },
    {
      title: "Financial Report",
      description: "Revenue summary including monthly and annual subscription income with payment details.",
      icon: IndianRupee,
    },
    {
      title: "Compliance Audit Report",
      description: "Complete compliance data including SCORES complaints, risk disclosures, and SEBI regulatory requirements.",
      icon: FileText,
    },
  ];

  const handleDownload = (reportName: string) => {
    const link = document.createElement("a");
    link.href = `/api/advisor/reports/download?type=${encodeURIComponent(reportName)}`;
    link.download = `${reportName.replace(/\s+/g, "_")}.csv`;
    link.click();
  };

  return (
    <div className="space-y-4 max-w-3xl">
      <h2 className="text-lg font-semibold">Reports & Downloads</h2>
      <p className="text-sm text-muted-foreground">
        Download reports required for compliance audit and business analysis.
      </p>

      <div className="grid gap-4">
        {reports.map((r) => (
          <Card key={r.title} className="hover-elevate" data-testid={`card-report-${r.title.replace(/\s/g, "-").toLowerCase()}`}>
            <CardContent className="p-5 flex items-start gap-4">
              <div className="w-10 h-10 rounded-md bg-primary/10 flex items-center justify-center flex-shrink-0">
                <r.icon className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 space-y-1 min-w-0">
                <h3 className="font-semibold">{r.title}</h3>
                <p className="text-sm text-muted-foreground">{r.description}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleDownload(r.title)}
                data-testid={`button-download-${r.title.replace(/\s/g, "-").toLowerCase()}`}
              >
                <Download className="w-4 h-4 mr-1" /> Download
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

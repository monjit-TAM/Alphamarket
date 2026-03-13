
// Combined Portfolio Report PDF Generator — AlphaMarket
// Uses PDFKit, styled after AlphaLens report engine

export async function generatePortfolioReport(data: any): Promise<Buffer> {
  const PDFDocument = require("pdfkit");
  const doc = new PDFDocument({ size: "A4", margin: 40, bufferPages: true });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

  const { equity, mutualFunds, combined, investorName, generatedBy } = data;
  const PAGE_W = 595, PAGE_H = 842, M = 40, W = 515;
  const BRAND = "#0f172a", ACCENT = "#2563eb", GREEN = "#16a34a", RED = "#dc2626";
  const GRAY = "#64748b", LIGHT = "#f8fafc", BORDER = "#e2e8f0";

  const fmt = (n: number) => {
    if (n == null || isNaN(n)) return "-";
    const abs = Math.abs(n);
    if (abs >= 10000000) return "\u20B9" + (n / 10000000).toFixed(2) + " Cr";
    if (abs >= 100000) return "\u20B9" + (n / 100000).toFixed(2) + " L";
    return "\u20B9" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  };
  const fmtPct = (n: number) => (n >= 0 ? "+" : "") + n.toFixed(1) + "%";
  const pCol = (n: number) => n >= 0 ? GREEN : RED;

  const pageHeader = (title: string) => {
    doc.rect(0, 0, PAGE_W, 50).fill(BRAND);
    doc.fontSize(14).fillColor("#ffffff").font("Helvetica-Bold").text("AlphaMarket Portfolio Report", M, 12);
    doc.fontSize(9).fillColor("#94a3b8").font("Helvetica").text(title, M, 32);
    doc.fontSize(8).fillColor("#94a3b8").text(new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }), PAGE_W - 160, 32, { width: 120, align: "right" });
    doc.y = 65;
  };

  const newPage = (t: string) => { doc.addPage(); pageHeader(t); };
  const checkPage = (need = 50, t = "") => { if (doc.y > PAGE_H - M - need) newPage(t); };

  const section = (title: string, desc?: string) => {
    checkPage(60);
    doc.moveDown(0.5);
    doc.rect(M, doc.y, 4, 16).fill(ACCENT);
    doc.fontSize(12).fillColor(BRAND).font("Helvetica-Bold").text(title, M + 12, doc.y + 1);
    doc.y += 20;
    if (desc) { doc.fontSize(8).fillColor(GRAY).font("Helvetica").text(desc, M, doc.y, { width: W }); doc.moveDown(0.3); }
    doc.moveTo(M, doc.y).lineTo(M + W, doc.y).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.moveDown(0.4);
  };

  const metricBox = (x: number, y: number, w: number, label: string, value: string, color?: string) => {
    doc.rect(x, y, w, 42).fill(LIGHT).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.fontSize(7).fillColor(GRAY).font("Helvetica").text(label, x + 8, y + 6, { width: w - 16 });
    doc.fontSize(12).fillColor(color || BRAND).font("Helvetica-Bold").text(value, x + 8, y + 20, { width: w - 16 });
  };

  const tableHeader = (cols: { label: string; x: number; w: number }[]) => {
    doc.rect(M, doc.y, W, 18).fill("#f1f5f9");
    for (const c of cols) {
      doc.fontSize(7).fillColor(GRAY).font("Helvetica-Bold").text(c.label, c.x, doc.y + 5, { width: c.w });
    }
    doc.y += 20;
  };

  const tableRow = (cols: { text: string; x: number; w: number; color?: string; bold?: boolean }[]) => {
    checkPage(16);
    for (const c of cols) {
      doc.fontSize(8).fillColor(c.color || BRAND).font(c.bold ? "Helvetica-Bold" : "Helvetica").text(c.text, c.x, doc.y, { width: c.w });
    }
    doc.y += 14;
    doc.moveTo(M, doc.y).lineTo(M + W, doc.y).strokeColor("#f1f5f9").lineWidth(0.3).stroke();
    doc.y += 2;
  };

  // ============ PAGE 1: Cover + Summary ============
  pageHeader("Portfolio Analysis Report");

  // Client info
  if (investorName) {
    doc.fontSize(9).fillColor(GRAY).font("Helvetica").text("Prepared for: " + investorName, M, doc.y);
    doc.moveDown(0.2);
  }
  if (generatedBy) {
    doc.fontSize(9).fillColor(GRAY).font("Helvetica").text("Advisor: " + generatedBy, M, doc.y);
    doc.moveDown(0.5);
  }

  // Combined Summary
  if (combined) {
    section("Portfolio Overview");
    const y = doc.y;
    const bw = (W - 12) / 4;
    metricBox(M, y, bw, "Total Invested", fmt(combined.totalInvested));
    metricBox(M + bw + 4, y, bw, "Current Value", fmt(combined.currentValue));
    metricBox(M + (bw + 4) * 2, y, bw, "Total P&L", fmt(combined.totalPnl), pCol(combined.totalPnl));
    metricBox(M + (bw + 4) * 3, y, bw, "Returns", fmtPct(combined.totalPnlPercent), pCol(combined.totalPnlPercent));
    doc.y = y + 50;

    // Asset allocation
    const eq = combined.assetAllocation?.equity;
    const mf = combined.assetAllocation?.mutualFunds;
    if (eq && mf) {
      doc.moveDown(0.3);
      const aw = W / 2 - 4;
      doc.rect(M, doc.y, aw, 30).fill("#eff6ff").strokeColor("#bfdbfe").lineWidth(0.5).stroke();
      doc.fontSize(8).fillColor(ACCENT).font("Helvetica-Bold").text("Equity: " + fmt(eq.current) + " (" + Number(eq.percent).toFixed(0) + "%)", M + 8, doc.y + 10, { width: aw - 16 });
      doc.rect(M + aw + 8, doc.y, aw, 30).fill("#f5f3ff").strokeColor("#c4b5fd").lineWidth(0.5).stroke();
      doc.fontSize(8).fillColor("#7c3aed").font("Helvetica-Bold").text("Mutual Funds: " + fmt(mf.current) + " (" + Number(mf.percent).toFixed(0) + "%)", M + aw + 16, doc.y + 10, { width: aw - 16 });
      doc.y += 38;
    }
  }

  // Health Score
  if (equity?.healthScore) {
    const hs = equity.healthScore;
    section("Portfolio Health Score", hs.summary);
    const y = doc.y;
    const scoreColor = hs.overall >= 70 ? GREEN : hs.overall >= 40 ? "#eab308" : RED;
    doc.rect(M, y, 80, 50).fill(LIGHT).strokeColor(scoreColor).lineWidth(2).stroke();
    doc.fontSize(24).fillColor(scoreColor).font("Helvetica-Bold").text(String(hs.overall), M + 10, y + 6, { width: 60, align: "center" });
    doc.fontSize(10).fillColor(scoreColor).font("Helvetica").text("Grade " + hs.grade, M + 10, y + 34, { width: 60, align: "center" });

    if (hs.components) {
      let cx = M + 95;
      for (const [key, val] of Object.entries(hs.components) as any) {
        const sc = val.score || 0;
        const col = sc >= 70 ? GREEN : sc >= 40 ? "#eab308" : RED;
        doc.rect(cx, y, 83, 50).fill(LIGHT).strokeColor(BORDER).lineWidth(0.5).stroke();
        doc.fontSize(7).fillColor(GRAY).font("Helvetica").text(key.charAt(0).toUpperCase() + key.slice(1), cx + 6, y + 6, { width: 71 });
        doc.fontSize(14).fillColor(col).font("Helvetica-Bold").text(String(sc), cx + 6, y + 22, { width: 71 });
        doc.fontSize(7).fillColor(GRAY).font("Helvetica").text(val.label || "", cx + 6, y + 38, { width: 71 });
        cx += 87;
      }
    }
    doc.y = y + 58;
  }

  // ============ PAGE 2: Stock Analysis ============
  if (equity?.holdings?.length > 0) {
    newPage("Equity Analysis");
    section("Stock Holdings (" + equity.holdings.length + " stocks)");

    const cols = [
      { label: "Stock", x: M, w: 70 },
      { label: "Sector", x: M + 70, w: 70 },
      { label: "Buy Price", x: M + 140, w: 60 },
      { label: "CMP", x: M + 200, w: 60 },
      { label: "Value", x: M + 260, w: 65 },
      { label: "P&L", x: M + 325, w: 60 },
      { label: "P&L %", x: M + 385, w: 45 },
      { label: "Action", x: M + 430, w: 85 },
    ];
    tableHeader(cols);

    for (const h of equity.holdings) {
      const rec = equity.enhancedRecommendations?.find((r: any) => r.stockName === (h.stockName || h.symbol));
      const pnl = (h.pnl || h.totalPnl || 0);
      const pnlPct = (h.pnlPercent || h.totalPnlPercent || 0);
      tableRow([
        { text: h.stockName || h.symbol || "", x: M, w: 70, bold: true },
        { text: h.sector || "-", x: M + 70, w: 70 },
        { text: fmt(h.buyPrice || h.avgBuyPrice), x: M + 140, w: 60 },
        { text: fmt(h.currentPrice || h.ltp), x: M + 200, w: 60 },
        { text: fmt(h.currentValue || h.marketValue), x: M + 260, w: 65 },
        { text: fmt(pnl), x: M + 325, w: 60, color: pCol(pnl) },
        { text: fmtPct(pnlPct), x: M + 385, w: 45, color: pCol(pnlPct) },
        { text: rec?.overallAction || "-", x: M + 430, w: 85, color: (rec?.overallAction || "").includes("Buy") ? GREEN : (rec?.overallAction || "").includes("Sell") ? RED : GRAY },
      ]);
    }

    // Sector Allocation
    if (equity.sectorAllocation) {
      section("Sector Allocation");
      for (const [sector, pct] of Object.entries(equity.sectorAllocation) as any) {
        checkPage(14);
        const barW = Math.min(pct * 4, W - 120);
        doc.rect(M, doc.y, barW, 12).fill(ACCENT + "30");
        doc.rect(M, doc.y, barW, 12).strokeColor(ACCENT).lineWidth(0.5).stroke();
        doc.fontSize(8).fillColor(BRAND).font("Helvetica").text(sector + ": " + Number(pct).toFixed(1) + "%", M + barW + 8, doc.y + 2, { width: 200 });
        doc.y += 16;
      }
    }

    // Quantamental Insights
    if (equity.quantamental?.length > 0) {
      newPage("Stock Insights");
      section("Quantamental Analysis", "Comprehensive analysis combining value, growth, and quality factors.");
      for (const q of equity.quantamental) {
        checkPage(50);
        doc.rect(M, doc.y, W, 1).fill(BORDER);
        doc.y += 4;
        const sc = q.overallScore || 0;
        const col = sc >= 60 ? GREEN : sc >= 40 ? "#eab308" : RED;
        doc.fontSize(10).fillColor(BRAND).font("Helvetica-Bold").text(q.stockName, M, doc.y);
        doc.fontSize(8).fillColor(col).font("Helvetica-Bold").text("Score: " + sc + "/100 | " + (q.classification || ""), M + 120, doc.y + 2);
        doc.y += 16;
        if (q.insights) {
          for (const ins of q.insights) {
            checkPage(12);
            doc.fontSize(7).fillColor(GRAY).font("Helvetica").text("\u2022 " + ins, M + 8, doc.y, { width: W - 16 });
            doc.moveDown(0.2);
          }
        }
        doc.moveDown(0.3);
      }
    }
  }

  // ============ DIVIDEND + TAX ============
  if (equity?.dividends?.holdings?.length > 0) {
    newPage("Income & Tax");
    section("Dividend Yield Analysis");
    const totalIncome = equity.dividends.holdings.reduce((s: number, h: any) => s + (h.annualIncome || 0), 0);
    doc.fontSize(9).fillColor(BRAND).font("Helvetica-Bold").text("Total Estimated Annual Dividend Income: " + fmt(totalIncome), M, doc.y);
    doc.moveDown(0.5);

    const dcols = [
      { label: "Stock", x: M, w: 90 }, { label: "Yield", x: M + 90, w: 50 },
      { label: "DPS", x: M + 140, w: 60 }, { label: "Annual Income", x: M + 200, w: 80 },
      { label: "Type", x: M + 280, w: 80 },
    ];
    tableHeader(dcols);
    for (const d of equity.dividends.holdings) {
      tableRow([
        { text: d.stockName, x: M, w: 90, bold: true },
        { text: Number(d.estimatedDividendYield).toFixed(1) + "%", x: M + 90, w: 50, color: GREEN },
        { text: "\u20B9" + Number(d.dividendPerShare).toFixed(2), x: M + 140, w: 60 },
        { text: fmt(d.annualIncome), x: M + 200, w: 80, color: GREEN },
        { text: d.classification || "-", x: M + 280, w: 80 },
      ]);
    }
  }

  if (equity?.taxImpact?.holdings?.length > 0) {
    section("Tax Impact Analysis");
    const ti = equity.taxImpact;
    const y = doc.y;
    const tw = (W - 8) / 3;
    metricBox(M, y, tw, "STCG", fmt(ti.totalSTCG), pCol(ti.totalSTCG));
    metricBox(M + tw + 4, y, tw, "STCL", fmt(ti.totalSTCL), RED);
    metricBox(M + (tw + 4) * 2, y, tw, "Estimated Tax", fmt(ti.estimatedTax), RED);
    doc.y = y + 50;
  }

  // ============ MF ANALYSIS ============
  if (mutualFunds?.holdings?.length > 0) {
    newPage("Mutual Fund Analysis");
    section("Mutual Fund Holdings (" + mutualFunds.holdings.length + " funds)");

    if (mutualFunds.riskMetrics) {
      const rm = mutualFunds.riskMetrics;
      const y = doc.y;
      const bw = (W - 12) / 4;
      metricBox(M, y, bw, "Expected Return", rm.avgExpectedReturn + "% p.a.");
      metricBox(M + bw + 4, y, bw, "Volatility", rm.avgVolatility + "%");
      metricBox(M + (bw + 4) * 2, y, bw, "Max Drawdown", rm.avgMaxDrawdown + "%", RED);
      metricBox(M + (bw + 4) * 3, y, bw, "Portfolio Risk", rm.portfolioRisk);
      doc.y = y + 50;
    }

    const mcols = [
      { label: "Fund", x: M, w: 160 }, { label: "Category", x: M + 160, w: 70 },
      { label: "NAV", x: M + 230, w: 50 }, { label: "Value", x: M + 280, w: 65 },
      { label: "P&L %", x: M + 345, w: 50 }, { label: "Rating", x: M + 395, w: 60 },
      { label: "Plan", x: M + 455, w: 60 },
    ];
    tableHeader(mcols);
    for (const f of mutualFunds.holdings) {
      const name = (f.name || "").substring(0, 28);
      tableRow([
        { text: name, x: M, w: 160, bold: true },
        { text: f.category || "-", x: M + 160, w: 70 },
        { text: "\u20B9" + Number(f.nav).toFixed(2), x: M + 230, w: 50 },
        { text: fmt(f.currentValue), x: M + 280, w: 65 },
        { text: fmtPct(f.gainLossPercent || 0), x: M + 345, w: 50, color: pCol(f.gainLossPercent || 0) },
        { text: f.performanceRating || "-", x: M + 395, w: 60, color: f.performanceRating === "Outperformer" ? GREEN : f.performanceRating === "Underperformer" ? RED : GRAY },
        { text: f.isDirect ? "Direct" : "Regular", x: M + 455, w: 60 },
      ]);
    }

    // MF Recommendations
    if (mutualFunds.recommendations?.length > 0) {
      section("MF Recommendations");
      for (const r of mutualFunds.recommendations) {
        checkPage(30);
        const col = r.priority === "high" ? RED : r.priority === "medium" ? "#eab308" : GREEN;
        doc.rect(M, doc.y, 3, 20).fill(col);
        doc.fontSize(8).fillColor(BRAND).font("Helvetica-Bold").text(r.fund + " \u2014 " + r.action, M + 10, doc.y + 2, { width: W - 20 });
        doc.fontSize(7).fillColor(GRAY).font("Helvetica").text(r.reason, M + 10, doc.y + 14, { width: W - 20 });
        doc.y += 28;
      }
    }
  }

  // ============ REBALANCING ============
  if (equity?.rebalancing?.suggestions?.length > 0) {
    newPage("Rebalancing & Scenarios");
    section("Rebalancing Suggestions");
    for (const s of equity.rebalancing.suggestions) {
      checkPage(16);
      const col = s.action === "Decrease" || s.action === "Exit" ? RED : s.action === "Increase" ? GREEN : GRAY;
      doc.fontSize(8).fillColor(BRAND).font("Helvetica-Bold").text(s.stockName + ": ", M, doc.y, { continued: true });
      doc.fillColor(col).text(s.action, { continued: true });
      doc.fillColor(GRAY).font("Helvetica").text("  " + Number(s.currentWeight).toFixed(1) + "% \u2192 " + Number(s.targetWeight).toFixed(1) + "%");
      doc.fontSize(7).fillColor(GRAY).text("  " + s.reason, M + 8, doc.y);
      doc.moveDown(0.3);
    }
  }

  // Scenarios
  if (equity?.scenarios?.length > 0) {
    section("Stress Test Scenarios");
    for (const s of equity.scenarios) {
      checkPage(20);
      doc.fontSize(9).fillColor(BRAND).font("Helvetica-Bold").text(s.scenario, M, doc.y);
      doc.fontSize(8).fillColor(RED).font("Helvetica").text("Loss: " + fmt(s.projectedLoss) + " | Impact: " + Number(s.portfolioImpact).toFixed(1) + "%", M + 180, doc.y);
      doc.moveDown(0.4);
    }
  }

  // ============ DISCLAIMER ============
  checkPage(80);
  doc.moveDown(1);
  doc.rect(M, doc.y, W, 1).fill(BORDER);
  doc.moveDown(0.5);
  doc.fontSize(7).fillColor(GRAY).font("Helvetica").text("DISCLAIMER: This report is for informational purposes only and should not be construed as investment advice. Past performance is not indicative of future results. Consult a SEBI-registered advisor before making investment decisions. Generated by AlphaMarket Portfolio Analysis Engine.", M, doc.y, { width: W, align: "justify" });

  // Finalize
  doc.end();
  return new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

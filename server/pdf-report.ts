
// Combined Portfolio Report PDF Generator — AlphaMarket
// Uses PDFKit, styled after AlphaLens report engine

export async function generatePortfolioReport(data: any): Promise<Buffer> {
  const PDFDocument = require("pdfkit");

  const { equity, mutualFunds, combined, investorName, generatedBy, reportId, generatedAt, branding } = data;
  const PAGE_W = 595, PAGE_H = 842, M = 40, W = 515;
  const BRAND = "#0f172a", ACCENT = "#2563eb", GREEN = "#16a34a", RED = "#dc2626";
  const GRAY = "#64748b", LIGHT = "#f8fafc", BORDER = "#e2e8f0";

  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));

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
    let headerTextX = M;
    // Render advisor logo if available
    if (branding?.logoUrl && branding._logoBuffer) {
      try {
        doc.image(branding._logoBuffer, M, 6, { height: 38, fit: [120, 38] });
        headerTextX = M + 130;
      } catch (e) {}
    }
    const headerTitle = branding?.companyName ? branding.companyName + " — Portfolio Report" : "AlphaMarket Portfolio Report";
    doc.fontSize(15).fillColor("#ffffff").font("Helvetica-Bold").text(headerTitle, headerTextX, 10, { width: PAGE_W - headerTextX - M });
    doc.fontSize(9).fillColor("#94a3b8").font("Helvetica").text(title, headerTextX, 30);
    doc.fontSize(9).fillColor("#94a3b8").text(new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }), PAGE_W - 160, 30, { width: 120, align: "right" });
    doc.y = 70;
  };

  const newPage = (t: string) => { doc.addPage(); pageHeader(t); };
  const checkPage = (need = 80, t = "") => { if (doc.y > PAGE_H - M - need - 30) newPage(t); };

  const section = (title: string, desc?: string) => {
    checkPage(80);
    doc.moveDown(0.8);
    doc.rect(M, doc.y, 5, 22).fill(ACCENT);
    doc.fontSize(16).fillColor(BRAND).font("Helvetica-Bold").text(title, M + 14, doc.y + 1);
    doc.y += 28;
    if (desc) { doc.fontSize(9).fillColor(GRAY).font("Helvetica").text(desc, M + 14, doc.y, { width: W - 14 }); doc.moveDown(0.4); }
    doc.moveTo(M, doc.y).lineTo(M + W, doc.y).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.moveDown(0.6);
  };

  const metricBox = (x: number, y: number, w: number, label: string, value: string, color?: string) => {
    doc.roundedRect(x, y, w, 55, 4).fill(LIGHT).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.fontSize(8).fillColor(GRAY).font("Helvetica").text(label, x + 12, y + 10, { width: w - 24 });
    doc.fontSize(16).fillColor(color || BRAND).font("Helvetica-Bold").text(value, x + 12, y + 28, { width: w - 24 });
  };

  const tableHeader = (cols: { label: string; x: number; w: number }[]) => {
    checkPage(26);
    const hy = doc.y;
    doc.rect(M, hy, W, 22).fill("#f1f5f9").strokeColor(BORDER).lineWidth(0.3).stroke();
    for (const c of cols) {
      doc.save();
      doc.fontSize(8).fillColor(GRAY).font("Helvetica-Bold").text(c.label, c.x, hy + 7, { width: c.w - 2, lineBreak: false });
      doc.restore();
    }
    doc.y = hy + 24;
    doc.x = M;
  };

  const tableRow = (cols: { text: string; x: number; w: number; color?: string; bold?: boolean }[], rowIndex?: number) => {
    // Measure tallest column for row height
    let maxH = 14;
    for (const c of cols) {
      const txt = (c.text || "-").substring(0, 500);
      const h = doc.fontSize(8).font(c.bold ? "Helvetica-Bold" : "Helvetica").heightOfString(txt, { width: c.w - 4 });
      if (h > maxH) maxH = Math.min(h, 85);
    }
    checkPage(maxH + 4);
    const sy = doc.y;
    // Render each column at fixed Y — columns don't affect each other's position
    for (const c of cols) {
      const txt = (c.text || "-").substring(0, 500);
      doc.save();
      doc.fontSize(8).fillColor(c.color || BRAND).font(c.bold ? "Helvetica-Bold" : "Helvetica");
      doc.text(txt, c.x, sy, { width: c.w - 4, height: maxH + 2, lineBreak: true });
      doc.restore();
    }
    doc.y = sy + maxH + 2;
    doc.x = M;
    doc.moveTo(M, doc.y).lineTo(M + W, doc.y).strokeColor("#f1f5f9").lineWidth(0.3).stroke();
    doc.y += 2;
  };


  // ─── Chart Helpers ───
  const drawDonut = (cx: number, cy: number, radius: number, innerRadius: number, slices: { pct: number; color: string; label: string }[]) => {
    let startAngle = -Math.PI / 2;
    for (const slice of slices) {
      if (slice.pct <= 0) continue;
      const sweepAngle = (slice.pct / 100) * Math.PI * 2;
      const endAngle = startAngle + sweepAngle;
      // Draw arc segment using path
      const x1 = cx + radius * Math.cos(startAngle);
      const y1 = cy + radius * Math.sin(startAngle);
      const x2 = cx + radius * Math.cos(endAngle);
      const y2 = cy + radius * Math.sin(endAngle);
      const ix1 = cx + innerRadius * Math.cos(endAngle);
      const iy1 = cy + innerRadius * Math.sin(endAngle);
      const ix2 = cx + innerRadius * Math.cos(startAngle);
      const iy2 = cy + innerRadius * Math.sin(startAngle);
      const largeArc = sweepAngle > Math.PI ? 1 : 0;
      doc.path(`M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} L ${ix1} ${iy1} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${ix2} ${iy2} Z`).fill(slice.color);
      startAngle = endAngle;
    }
  };

  const drawLegend = (x: number, y: number, items: { color: string; label: string; value: string }[]) => {
    let ly = y;
    for (const item of items) {
      doc.roundedRect(x, ly + 1, 10, 10, 2).fill(item.color);
      doc.fontSize(8).fillColor(BRAND).font("Helvetica-Bold").text(item.label, x + 15, ly + 1, { width: 130, lineBreak: false });
      doc.fontSize(8).fillColor(GRAY).font("Helvetica").text(item.value, x + 145, ly + 1, { width: 60, lineBreak: false, align: "right" });
      ly += 16;
    }
    return ly;
  };

  const drawGauge = (cx: number, cy: number, radius: number, score: number, maxScore: number, color: string) => {
    // Background arc (180 degrees, bottom half)
    const startA = Math.PI;
    const endA = 2 * Math.PI;
    // Background track
    for (let a = startA; a < endA; a += 0.02) {
      const x1 = cx + radius * Math.cos(a);
      const y1 = cy + radius * Math.sin(a);
      doc.circle(x1, y1, 3).fill("#eef2f7");
    }
    // Filled portion
    const fillEnd = startA + (score / maxScore) * Math.PI;
    for (let a = startA; a < fillEnd; a += 0.02) {
      const x1 = cx + radius * Math.cos(a);
      const y1 = cy + radius * Math.sin(a);
      doc.circle(x1, y1, 3).fill(color);
    }
  };


    // Load advisor logo if available
  if (branding?.logoUrl) {
    try {
      const fs = require("fs");
      const logoPath = "/var/www/alphamarket" + branding.logoUrl;
      if (fs.existsSync(logoPath)) {
        branding._logoBuffer = fs.readFileSync(logoPath);
      }
    } catch (e) { console.error("[PDF] Logo load error:", e); }
  }

  // ============ PAGE 1: Cover + Summary ============
  pageHeader("Portfolio Analysis Report");


  // Client info
  if (investorName) {
    doc.fontSize(9).fillColor(GRAY).font("Helvetica").text("Prepared for: " + investorName, M, doc.y);
    doc.moveDown(0.2);
  }
  if (generatedBy) {
    doc.fontSize(9).fillColor(GRAY).font("Helvetica").text("Advisor: " + generatedBy, M, doc.y);
    doc.moveDown(0.2);
  }
  if (branding?.sebiRegNumber) {
    doc.fontSize(8).fillColor(GRAY).font("Helvetica").text("SEBI Reg: " + branding.sebiRegNumber, M, doc.y);
    doc.moveDown(0.2);
  }
  if (branding?.advisorContact || branding?.advisorWebsite) {
    const contactLine = [branding.advisorContact, branding.advisorWebsite].filter(Boolean).join("  |  ");
    doc.fontSize(8).fillColor(GRAY).font("Helvetica").text(contactLine, M, doc.y);
    doc.moveDown(0.2);
  }
  if (reportId || generatedAt) {
    doc.fontSize(8).fillColor("#94a3b8").font("Helvetica").text(
      (reportId ? "Report: " + reportId : "") + (generatedAt ? "  |  " + generatedAt : ""), M, doc.y
    );
    doc.moveDown(1);
  }

  // Cover page summary metrics
  if (combined) {
    doc.moveDown(2);
    const coverY = doc.y;
    const cbw = (W - 8) / 3;
    doc.rect(M, coverY, cbw, 70).fill(LIGHT).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.fontSize(9).fillColor(GRAY).font("Helvetica").text("Total Invested", M + 15, coverY + 12, { width: cbw - 30 });
    doc.fontSize(20).fillColor(BRAND).font("Helvetica-Bold").text(fmt(combined.totalInvested), M + 15, coverY + 30, { width: cbw - 30 });

    doc.rect(M + cbw + 4, coverY, cbw, 70).fill(LIGHT).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.fontSize(9).fillColor(GRAY).font("Helvetica").text("Current Value", M + cbw + 19, coverY + 12, { width: cbw - 30 });
    doc.fontSize(20).fillColor(BRAND).font("Helvetica-Bold").text(fmt(combined.currentValue), M + cbw + 19, coverY + 30, { width: cbw - 30 });

    doc.rect(M + (cbw + 4) * 2, coverY, cbw, 70).fill(LIGHT).strokeColor(BORDER).lineWidth(0.5).stroke();
    doc.fontSize(9).fillColor(GRAY).font("Helvetica").text("Total P&L", M + (cbw + 4) * 2 + 15, coverY + 12, { width: cbw - 30 });
    doc.fontSize(20).fillColor(pCol(combined.totalPnl)).font("Helvetica-Bold").text(fmt(combined.totalPnl) + " (" + fmtPct(combined.totalPnlPercent) + ")", M + (cbw + 4) * 2 + 15, coverY + 30, { width: cbw - 30 });
    doc.y = coverY + 80;
  }

  // ============ TABLE OF CONTENTS (Page 2) ============
  const sections = data.sections || {};
  const isEnabled = (key: string) => sections[key] !== false;

  newPage("Table of Contents");
  doc.moveDown(0.3);
  doc.rect(M, doc.y, 4, 20).fill(ACCENT);
  doc.fontSize(16).fillColor(BRAND).font("Helvetica-Bold").text("Table of Contents", M + 14, doc.y + 2);
  doc.y += 30;
  doc.fontSize(9).fillColor(GRAY).font("Helvetica").text("Complete portfolio analysis with detailed reports", M + 14, doc.y);
  doc.moveDown(1);
  const tocItems = [
    { label: "Portfolio Overview", desc: "Investment summary & health score", key: "overview" },
    { label: "Stock Analysis", desc: "Holdings, sector allocation & insights", key: "equity" },
    { label: "Quantamental Analysis", desc: "Value & growth factor assessment", key: "quantamental" },
    { label: "Value & Growth Analysis", desc: "Fundamental valuation metrics", key: "valueGrowth" },
    { label: "Dividend Yield & Tax Impact", desc: "Income analysis & tax estimates", key: "dividendTax" },
    { label: "Mutual Fund Analysis", desc: "Fund performance & recommendations", key: "mutualFunds" },
    { label: "MF Stress Test & Projections", desc: "Risk scenarios & forward projections", key: "mfStress" },
    { label: "MF Health Check & Overlap", desc: "Portfolio health & overlap analysis", key: "mfHealth" },
    { label: "Other Assets", desc: "Gold, FD, Real Estate, Insurance & more", key: "otherAssets" },
    { label: "Investment Style Profile", desc: "Value vs growth tilt analysis", key: "investmentStyle" },
    { label: "Rebalancing Suggestions", desc: "Portfolio optimization & stress scenarios", key: "rebalancing" },
  ];
  let tocNum = 1;
  for (const item of tocItems) {
    if (!isEnabled(item.key)) continue;
    const ty = doc.y;
    // Draw row background for alternating items
    if (tocNum % 2 === 0) doc.rect(M, ty - 2, W, 28).fill("#f8fafc");
    doc.fontSize(10).fillColor(BRAND).font("Helvetica-Bold").text(tocNum + ".  " + item.label, M + 8, ty + 2, { width: W * 0.6 });
    doc.fontSize(8).fillColor(GRAY).font("Helvetica").text(item.desc, M + W * 0.55, ty + 5, { width: W * 0.4, align: "right" });
    doc.y = ty + 28;
    doc.moveTo(M, doc.y).lineTo(M + W, doc.y).strokeColor("#eef2f7").lineWidth(0.3).stroke();
    doc.moveDown(0.1);
    tocNum++;
  }
  doc.moveDown(1);

  // Combined Summary — start on new page
  if (combined && isEnabled("overview")) {
    newPage("Portfolio Overview");
    section("Portfolio Overview");
    const y = doc.y;
    const bw = (W - 12) / 4;
    metricBox(M, y, bw, "Total Invested", fmt(combined.totalInvested));
    metricBox(M + bw + 4, y, bw, "Current Value", fmt(combined.currentValue));
    metricBox(M + (bw + 4) * 2, y, bw, "Total P&L", fmt(combined.totalPnl), pCol(combined.totalPnl));
    metricBox(M + (bw + 4) * 3, y, bw, "Returns", fmtPct(combined.totalPnlPercent), pCol(combined.totalPnlPercent));
    doc.y = y + 62;

    // Asset allocation with donut chart
    const eq = combined.assetAllocation?.equity;
    const mf = combined.assetAllocation?.mutualFunds;
    if (eq && mf) {
      doc.moveDown(0.5);
      const chartY = doc.y;
      const otherPct = Math.max(0, 100 - Number(eq.percent) - Number(mf.percent));

      // Donut chart
      const donutCx = M + 70, donutCy = chartY + 65;
      drawDonut(donutCx, donutCy, 55, 30, [
        { pct: Number(eq.percent), color: ACCENT, label: "Equity" },
        { pct: Number(mf.percent), color: "#7c3aed", label: "MF" },
        { pct: otherPct, color: "#d97706", label: "Other" },
      ]);
      // Center label
      doc.fontSize(14).fillColor(BRAND).font("Helvetica-Bold").text(fmt(combined.currentValue), donutCx - 38, donutCy - 12, { width: 76, align: "center" });
      doc.fontSize(7).fillColor(GRAY).font("Helvetica").text("Total Value", donutCx - 30, donutCy + 4, { width: 60, align: "center" });

      // Legend
      const legendX = M + 160;
      const legendItems = [
        { color: ACCENT, label: "Equity", value: fmt(eq.current) + " (" + Number(eq.percent).toFixed(0) + "%)" },
        { color: "#7c3aed", label: "Mutual Funds", value: fmt(mf.current) + " (" + Number(mf.percent).toFixed(0) + "%)" },
      ];
      if (otherPct > 0) legendItems.push({ color: "#d97706", label: "Other Assets", value: otherPct.toFixed(0) + "%" });
      drawLegend(legendX, chartY + 30, legendItems);

      doc.y = chartY + 135;
    }
  }

  // Health Score
  if (equity?.healthScore && isEnabled("overview")) {
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
  if (isEnabled("equity") && equity?.holdings?.length > 0) {
    newPage("Equity Analysis");
    section("Stock Holdings (" + equity.holdings.length + " stocks)");

    // Card-based stock holdings
    for (let si = 0; si < equity.holdings.length; si++) {
      const h = equity.holdings[si];
      const rec = equity.enhancedRecommendations?.find((r: any) => r.stockName === (h.stockName || h.symbol));
      const pnl = (h.pnl || h.totalPnl || 0);
      const pnlPct = (h.pnlPercent || h.totalPnlPercent || 0);
      const action = rec?.overallAction || "-";
      const actionCol = action.includes("Buy") ? GREEN : action.includes("Sell") ? RED : GRAY;

      checkPage(85, "Equity Analysis");
      const cardY = doc.y;
      // Card background with rounded corners
      doc.roundedRect(M, cardY, W, 72, 4).fill("#fafbfc").strokeColor(BORDER).lineWidth(0.5).stroke();
      // Left accent bar based on P&L
      doc.roundedRect(M, cardY, 4, 72, 2).fill(pCol(pnl));

      // Stock name + sector
      doc.fontSize(11).fillColor(BRAND).font("Helvetica-Bold").text(h.stockName || h.symbol || "", M + 14, cardY + 8, { width: 200, lineBreak: false });
      doc.fontSize(7).fillColor(GRAY).font("Helvetica").text(h.sector || "", M + 14, cardY + 22, { width: 150, lineBreak: false });

      // Action badge (top-right)
      const badgeBg = action.includes("Buy") ? "#dcfce7" : action.includes("Sell") ? "#fef2f2" : "#f1f5f9";
      const badgeW = Math.min(doc.widthOfString(action, { fontSize: 8 }) + 16, 90);
      doc.roundedRect(M + W - badgeW - 10, cardY + 6, badgeW, 18, 9).fill(badgeBg).strokeColor(actionCol + "40").lineWidth(0.5).stroke();
      doc.fontSize(8).fillColor(actionCol).font("Helvetica-Bold").text(action, M + W - badgeW - 2, cardY + 10, { width: badgeW - 16, align: "center" });

      // Metrics row
      const my = cardY + 38;
      const mw = (W - 28) / 5;
      // Buy Price
      doc.fontSize(7).fillColor(GRAY).font("Helvetica").text("Buy Price", M + 14, my, { width: mw, lineBreak: false });
      doc.fontSize(9).fillColor(BRAND).font("Helvetica-Bold").text(fmt(h.buyPrice || h.avgBuyPrice), M + 14, my + 10, { width: mw, lineBreak: false });
      // CMP
      doc.fontSize(7).fillColor(GRAY).font("Helvetica").text("CMP", M + 14 + mw, my, { width: mw, lineBreak: false });
      doc.fontSize(9).fillColor(BRAND).font("Helvetica-Bold").text(fmt(h.currentPrice || h.ltp), M + 14 + mw, my + 10, { width: mw, lineBreak: false });
      // Value
      doc.fontSize(7).fillColor(GRAY).font("Helvetica").text("Value", M + 14 + mw * 2, my, { width: mw, lineBreak: false });
      doc.fontSize(9).fillColor(BRAND).font("Helvetica-Bold").text(fmt(h.currentValue || h.marketValue), M + 14 + mw * 2, my + 10, { width: mw, lineBreak: false });
      // P&L
      doc.fontSize(7).fillColor(GRAY).font("Helvetica").text("P&L", M + 14 + mw * 3, my, { width: mw, lineBreak: false });
      doc.fontSize(9).fillColor(pCol(pnl)).font("Helvetica-Bold").text(fmt(pnl), M + 14 + mw * 3, my + 10, { width: mw, lineBreak: false });
      // P&L %
      doc.fontSize(7).fillColor(GRAY).font("Helvetica").text("Returns", M + 14 + mw * 4, my, { width: mw, lineBreak: false });
      doc.fontSize(9).fillColor(pCol(pnlPct)).font("Helvetica-Bold").text(fmtPct(pnlPct), M + 14 + mw * 4, my + 10, { width: mw, lineBreak: false });

      doc.y = cardY + 78;
    }

    // Top Holdings by Value — horizontal bar chart
    if (equity.holdings?.length > 0) {
      checkPage(160, "Equity Analysis");
      section("Top Holdings by Value");
      const sorted = [...equity.holdings].sort((a: any, b: any) => (b.currentValue || b.marketValue || 0) - (a.currentValue || a.marketValue || 0)).slice(0, 8);
      const maxVal = Number(sorted[0]?.currentValue || sorted[0]?.marketValue || 1);
      const topColors = ["#2563eb","#7c3aed","#059669","#d97706","#dc2626","#0891b2","#4f46e5","#be185d"];

      for (let ti = 0; ti < sorted.length; ti++) {
        const h = sorted[ti];
        const val = Number(h.currentValue || h.marketValue || 0);
        const pnlPct = Number(h.pnlPercent || h.totalPnlPercent || 0);
        const ry = doc.y;
        const barMaxW = W - 200;
        const barW = Math.max(10, (val / maxVal) * barMaxW);
        const bCol = topColors[ti % topColors.length];

        // Name
        doc.fontSize(8).fillColor(BRAND).font("Helvetica-Bold").text((h.stockName || h.symbol || "").substring(0, 18), M + 4, ry + 4, { width: 100, lineBreak: false });
        // Bar track
        doc.roundedRect(M + 105, ry + 2, barMaxW, 16, 3).fill("#f1f5f9");
        // Filled bar
        doc.roundedRect(M + 105, ry + 2, barW, 16, 3).fill(bCol);
        // Value label
        if (barW > 60) {
          doc.fontSize(7).fillColor("#ffffff").font("Helvetica-Bold").text(fmt(val), M + 110, ry + 6, { width: barW - 12, lineBreak: false });
        } else {
          doc.fontSize(7).fillColor(bCol).font("Helvetica-Bold").text(fmt(val), M + 110 + barW + 4, ry + 6, { width: 70, lineBreak: false });
        }
        // P&L badge
        doc.fontSize(7).fillColor(pCol(pnlPct)).font("Helvetica-Bold").text(fmtPct(pnlPct), M + W - 50, ry + 5, { width: 48, align: "right", lineBreak: false });

        doc.y = ry + 22;
      }
      doc.moveDown(0.5);
    }

    // Sector Allocation — donut + horizontal bar chart
    if (equity.sectorAllocation) {
      newPage("Equity Analysis");
      section("Sector Allocation");
      const sColors = ["#2563eb","#7c3aed","#059669","#d97706","#dc2626","#0891b2","#4f46e5","#be185d","#65a30d","#a855f7"];
      const sectors = Object.entries(equity.sectorAllocation).sort((a: any, b: any) => b[1] - a[1]) as any;
      const maxPct = sectors.length > 0 ? Number(sectors[0][1]) : 100;

      // Donut chart for sectors
      if (sectors.length > 1) {
        const chartY = doc.y;
        const slices = sectors.map(([s, p]: [string, any], i: number) => ({ pct: Number(p), color: sColors[i % sColors.length], label: s }));
        drawDonut(M + 70, chartY + 60, 50, 25, slices);
        // Center text
        doc.fontSize(10).fillColor(BRAND).font("Helvetica-Bold").text(sectors.length.toString(), M + 58, chartY + 52, { width: 24, align: "center" });
        doc.fontSize(7).fillColor(GRAY).font("Helvetica").text("sectors", M + 46, chartY + 65, { width: 48, align: "center" });

        // Legend (right side)
        const legendItems = sectors.slice(0, 6).map(([s, p]: [string, any], i: number) => ({
          color: sColors[i % sColors.length], label: s, value: Number(p).toFixed(1) + "%"
        }));
        drawLegend(M + 160, chartY + 15, legendItems);
        doc.y = chartY + 130;
        doc.moveDown(0.3);
      }

      let sIdx = 0;
      for (const [sector, pct] of sectors) {
        checkPage(32, "Equity Analysis");
        const pctNum = Number(pct);
        const sCol = sColors[sIdx % sColors.length];
        const ry = doc.y;

        // Alternating row bg
        if (sIdx % 2 === 0) doc.rect(M, ry, W, 28).fill("#f8fafc");

        // Sector name (left)
        doc.fontSize(9).fillColor(BRAND).font("Helvetica-Bold").text(sector, M + 8, ry + 8, { width: 140, lineBreak: false });

        // Full-width bar area (from x=155 to end, relative to max value)
        const barStartX = M + 155;
        const barMaxW = W - 175;
        const barW = Math.max(8, (pctNum / maxPct) * barMaxW);

        // Bar track (subtle gray)
        doc.roundedRect(barStartX, ry + 7, barMaxW, 14, 3).fill("#eef2f7");
        // Filled bar
        doc.roundedRect(barStartX, ry + 7, barW, 14, 3).fill(sCol);

        // Percentage label inside or outside bar
        if (barW > 40) {
          doc.fontSize(8).fillColor("#ffffff").font("Helvetica-Bold").text(pctNum.toFixed(1) + "%", barStartX + 6, ry + 10, { width: barW - 12, lineBreak: false });
        } else {
          doc.fontSize(8).fillColor(sCol).font("Helvetica-Bold").text(pctNum.toFixed(1) + "%", barStartX + barW + 6, ry + 10, { width: 50, lineBreak: false });
        }

        doc.y = ry + 30;
        sIdx++;
      }
      doc.moveDown(0.5);
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


  // ============ VALUE ANALYSIS ============
  if (isEnabled("valueGrowth") && equity?.valueAnalysis?.length > 0) {
    newPage("Value & Growth Analysis");
    section("Value Analysis", "Fundamental valuation metrics for each stock.");
    const vcols = [
      { label: "Stock", x: M, w: 70 }, { label: "CMP", x: M + 70, w: 55 },
      { label: "PE", x: M + 125, w: 40 }, { label: "PB", x: M + 165, w: 40 },
      { label: "D/E", x: M + 205, w: 40 }, { label: "Signal", x: M + 245, w: 55 },
      { label: "Analysis", x: M + 300, w: 215 },
    ];
    tableHeader(vcols);
    for (const v of equity.valueAnalysis) {
      checkPage(45, "Value & Growth Analysis");
      const sigCol = (v.signal || "").includes("Buy") ? GREEN : (v.signal || "").includes("Sell") ? RED : GRAY;
      tableRow([
        { text: v.stockName || "", x: M, w: 70, bold: true },
        { text: fmt(v.currentPrice), x: M + 70, w: 55 },
        { text: v.pe ? Number(v.pe).toFixed(1) : "-", x: M + 125, w: 40 },
        { text: v.pb ? Number(v.pb).toFixed(1) : "-", x: M + 165, w: 40 },
        { text: v.debtEquity ? Number(v.debtEquity).toFixed(1) : "-", x: M + 205, w: 40 },
        { text: v.signal || "-", x: M + 245, w: 55, color: sigCol },
        { text: v.narrative || "-", x: M + 300, w: 215 },
      ]);
    }
  }

  // ============ GROWTH ANALYSIS ============
  if (equity?.growthAnalysis?.length > 0) {
    section("Growth Analysis", "Revenue, earnings momentum and growth trajectory.");
    const gcols = [
      { label: "Stock", x: M, w: 70 }, { label: "Rev Grw", x: M + 70, w: 50 },
      { label: "Earn Grw", x: M + 120, w: 50 }, { label: "ROE", x: M + 170, w: 40 },
      { label: "52W Mom", x: M + 210, w: 50 }, { label: "Signal", x: M + 260, w: 55 },
      { label: "Analysis", x: M + 315, w: 200 },
    ];
    tableHeader(gcols);
    for (const g of equity.growthAnalysis) {
      checkPage(45, "Value & Growth Analysis");
      const fmtG = (n: any) => n != null ? (Number(n) >= 0 ? "+" : "") + Number(n).toFixed(1) + "%" : "-";
      const sigCol = (g.signal || "").includes("Buy") ? GREEN : (g.signal || "").includes("Sell") ? RED : GRAY;
      tableRow([
        { text: g.stockName || "", x: M, w: 70, bold: true },
        { text: fmtG(g.revenueGrowth), x: M + 70, w: 50, color: pCol(g.revenueGrowth || 0) },
        { text: fmtG(g.earningsGrowth), x: M + 120, w: 50, color: pCol(g.earningsGrowth || 0) },
        { text: g.roe ? Number(g.roe).toFixed(1) + "%" : "-", x: M + 170, w: 40 },
        { text: fmtG(g.momentum52w), x: M + 210, w: 50, color: pCol(g.momentum52w || 0) },
        { text: g.signal || "-", x: M + 260, w: 55, color: sigCol },
        { text: g.narrative || "-", x: M + 315, w: 200 },
      ]);
    }
  }


  // ============ DIVIDEND + TAX ============
  if (isEnabled("dividendTax") && equity?.dividends?.holdings?.length > 0) {
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
    doc.fontSize(9).fillColor(GRAY).font("Helvetica").text("Tax calculations based on Indian tax laws. STCG: 20%, LTCG: 12.5% above \u20B91.25L exemption.", M, doc.y, { width: W });
    doc.moveDown(0.5);
    const y = doc.y;
    const tw = (W - 16) / 4;
    metricBox(M, y, tw, "Short-Term Capital Gains", fmt(ti.totalSTCG), pCol(ti.totalSTCG));
    metricBox(M + tw + 4, y, tw, "Short-Term Capital Loss", fmt(ti.totalSTCL), RED);
    metricBox(M + (tw + 4) * 2, y, tw, "Net Taxable Gains", fmt((ti.totalSTCG || 0) - Math.abs(ti.totalSTCL || 0)), BRAND);
    metricBox(M + (tw + 4) * 3, y, tw, "Estimated Tax Liability", fmt(ti.estimatedTax), RED);
    doc.y = y + 62;
    doc.moveDown(0.5);
    // Stock-wise tax table
    if (ti.holdings?.length > 0) {
      const txCols = [
        { label: "Stock", x: M, w: 90 }, { label: "Buy Date", x: M + 90, w: 65 },
        { label: "Holding Days", x: M + 155, w: 60 }, { label: "P&L", x: M + 215, w: 80 },
        { label: "Tax Type", x: M + 295, w: 60 }, { label: "Term", x: M + 355, w: 50 },
        { label: "Tax Rate", x: M + 405, w: 50 }, { label: "Est. Tax", x: M + 455, w: 60 },
      ];
      tableHeader(txCols);
      for (const h of ti.holdings) {
        const days = h.holdingDays || 0;
        const term = days > 365 ? "LTCG" : "STCG";
        const rate = days > 365 ? "12.5%" : "20%";
        // Try multiple P&L field names from the analyzer
        let pnl = Number(h.gain || h.pnl || h.totalPnl || h.gainLoss || h.gain_loss || 0);
        // If still 0 but we have price data, calculate from prices
        if (pnl === 0 && h.currentPrice && h.buyPrice && h.quantity) {
          pnl = (Number(h.currentPrice) - Number(h.buyPrice)) * Number(h.quantity);
        }
        if (pnl === 0 && h.currentPrice && h.avgBuyPrice && h.quantity) {
          pnl = (Number(h.currentPrice) - Number(h.avgBuyPrice)) * Number(h.quantity);
        }
        const tax = pnl > 0 ? (days > 365 ? Math.max(0, pnl - 125000) * 0.125 : pnl * 0.20) : 0;
        tableRow([
          { text: h.stock || h.stockName || "-", x: M, w: 90, bold: true },
          { text: h.buyDate ? new Date(h.buyDate).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "2-digit" }) : "-", x: M + 90, w: 65 },
          { text: String(days), x: M + 155, w: 60 },
          { text: fmt(pnl), x: M + 215, w: 80, color: pCol(pnl) },
          { text: pnl > 0 ? term : "Loss", x: M + 295, w: 60, color: pnl > 0 ? ACCENT : RED },
          { text: days > 365 ? "Long" : "Short", x: M + 355, w: 50 },
          { text: pnl > 0 ? rate : "-", x: M + 405, w: 50 },
          { text: tax > 0 ? fmt(tax) : "-", x: M + 455, w: 60, color: RED },
        ]);
      }
    }
  }


  // ============ MF ANALYSIS ============
  if (isEnabled("mutualFunds") && mutualFunds?.holdings?.length > 0) {
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
      doc.y = y + 62;
    }

    const mcols = [
      { label: "Fund", x: M, w: 160 }, { label: "Category", x: M + 160, w: 70 },
      { label: "NAV", x: M + 230, w: 50 }, { label: "Value", x: M + 280, w: 65 },
      { label: "P&L %", x: M + 345, w: 50 }, { label: "Rating", x: M + 395, w: 60 },
      { label: "Plan", x: M + 455, w: 60 },
    ];
    tableHeader(mcols);
    for (const f of mutualFunds.holdings) {
      const name = (f.name || "").substring(0, 45);
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
        checkPage(55);
        const col = r.priority === "high" ? RED : r.priority === "medium" ? "#eab308" : GREEN;
        const bgCol = r.priority === "high" ? "#fef2f2" : r.priority === "medium" ? "#fffbeb" : "#f0fdf4";
        // Measure text heights first
        const titleH = doc.heightOfString(r.fund + " — " + r.action, { width: W - 32, fontSize: 9 });
        const reasonH = doc.heightOfString(r.reason, { width: W - 32, fontSize: 8 });
        const cardH = Math.max(36, titleH + reasonH + 20);
        doc.roundedRect(M, doc.y, W, cardH, 3).fill(bgCol).strokeColor(BORDER).lineWidth(0.3).stroke();
        doc.rect(M, doc.y, 4, cardH).fill(col);
        const cardY = doc.y;
        doc.fontSize(9).fillColor(BRAND).font("Helvetica-Bold").text(r.fund + " \u2014 " + r.action, M + 14, cardY + 8, { width: W - 32 });
        doc.fontSize(8).fillColor(GRAY).font("Helvetica").text(r.reason, M + 14, cardY + 8 + titleH + 4, { width: W - 32 });
        doc.y = cardY + cardH + 6;
      }
    }
  }


  // ============ MF STRESS TESTS ============
  if (isEnabled("mfStress") && mutualFunds?.stressTests?.length > 0) {
    section("MF Stress Test Scenarios");
    const stCols = [
      { label: "Scenario", x: M, w: 180 }, { label: "Description", x: M + 180, w: 160 },
      { label: "Impact", x: M + 340, w: 65 }, { label: "Loss", x: M + 405, w: 65 },
      { label: "Severity", x: M + 470, w: 45 },
    ];
    tableHeader(stCols);
    for (const s of mutualFunds.stressTests) {
      tableRow([
        { text: s.scenario, x: M, w: 180, bold: true },
        { text: s.description || "", x: M + 180, w: 160 },
        { text: s.portfolioImpact + "%", x: M + 340, w: 65, color: RED },
        { text: fmt(s.projectedLoss), x: M + 405, w: 65, color: RED },
        { text: s.severity || "", x: M + 470, w: 45 },
      ]);
    }
  }

  // ============ MF FORWARD PROJECTIONS ============
  if (mutualFunds?.forwardProjections?.length > 0) {
    newPage("MF Projections");
    section("MF Forward Projections");
    const fpCols = [
      { label: "Horizon", x: M, w: 60 }, { label: "Expected", x: M + 60, w: 90 },
      { label: "Optimistic", x: M + 150, w: 90 }, { label: "Pessimistic", x: M + 240, w: 90 },
      { label: "CAGR", x: M + 330, w: 55 }, { label: "Wealth Multiple", x: M + 385, w: 70 },
    ];
    tableHeader(fpCols);
    for (const p of mutualFunds.forwardProjections) {
      tableRow([
        { text: p.years + " Year" + (p.years > 1 ? "s" : ""), x: M, w: 60, bold: true },
        { text: fmt(p.expectedValue), x: M + 60, w: 90, color: GREEN },
        { text: fmt(p.optimisticValue), x: M + 150, w: 90 },
        { text: fmt(p.pessimisticValue), x: M + 240, w: 90, color: RED },
        { text: p.expectedCAGR + "%", x: M + 330, w: 55 },
        { text: p.wealthMultiple + "x", x: M + 385, w: 70 },
      ]);
    }
  }


  // ============ MF HEALTH CHECK ============
  if (isEnabled("mfHealth") && mutualFunds?.healthCheck) {
    section("MF Portfolio Health Check");
    const hc = mutualFunds.healthCheck;
    const hcEntries = Object.entries(hc);
    const y = doc.y;
    const bw = (W - 12) / Math.min(hcEntries.length, 4);
    let hx = 0;
    for (const [key, val] of hcEntries as any) {
      const col = val.status === "Good" || val.score > 70 ? GREEN : val.status === "Fair" || val.score > 40 ? "#eab308" : RED;
      const label = key.replace(/([A-Z])/g, " $1").trim();
      metricBox(M + hx * (bw + 4), y, bw, label, val.status + " (" + val.score + ")", col);
      hx++;
    }
    doc.y = y + 62;
    for (const [key, val] of hcEntries as any) {
      if (val.message) {
        doc.fontSize(7).fillColor(GRAY).font("Helvetica").text("• " + key.replace(/([A-Z])/g, " $1").trim() + ": " + val.message, M + 8, doc.y, { width: W - 16 });
        doc.moveDown(0.2);
      }
    }
  }

  // ============ MF OVERLAP ============
  if (mutualFunds?.overlapAnalysis?.overlaps?.length > 0) {
    section("MF Overlap Analysis (Level: " + (mutualFunds.overlapAnalysis.overallLevel || "") + ")");
    for (const o of mutualFunds.overlapAnalysis.overlaps) {
      checkPage(25);
      const col = o.severity === "High" ? RED : o.severity === "Medium" ? "#eab308" : GREEN;
      doc.rect(M, doc.y, 3, 18).fill(col);
      doc.fontSize(9).fillColor(BRAND).font("Helvetica-Bold").text(o.category + " (" + o.overlapPct + "% overlap)", M + 10, doc.y + 1);
      doc.fontSize(7).fillColor(GRAY).font("Helvetica").text(o.funds.join("  •  "), M + 10, doc.y + 12, { width: W - 20 });
      doc.y += 24;
    }
  }

  // ============ STOCK-MF CROSS-ASSET OVERLAP (P4) ============
  if (isEnabled("mfHealth") && data.stockOverlap?.length > 0) {
    newPage("Cross-Asset Overlap");
    section("Stock-MF Overlap (" + data.stockOverlap.length + " overlapping stocks)", "Stocks held directly AND through mutual fund top holdings. High overlap = concentrated risk.");
    const olCols = [
      { label: "Stock", x: M, w: 80 }, { label: "Direct %", x: M + 80, w: 60 },
      { label: "Via MFs %", x: M + 140, w: 60 }, { label: "Total %", x: M + 200, w: 60 },
      { label: "Risk", x: M + 260, w: 55 }, { label: "MF Sources", x: M + 315, w: 200 },
    ];
    tableHeader(olCols);
    for (const o of data.stockOverlap) {
      const rCol = o.concentrationRisk === "Critical" || o.concentrationRisk === "High" ? RED : o.concentrationRisk === "Medium" ? "#eab308" : GREEN;
      tableRow([
        { text: o.stockName, x: M, w: 80, bold: true },
        { text: o.directExposure + "%", x: M + 80, w: 60 },
        { text: o.mfExposure + "%", x: M + 140, w: 60, color: ACCENT },
        { text: o.totalExposure + "%", x: M + 200, w: 60, bold: true },
        { text: o.concentrationRisk, x: M + 260, w: 55, color: rCol },
        { text: (o.mfSources || []).join(", "), x: M + 315, w: 200 },
      ]);
    }
  }

  // ============ OTHER ASSETS (Gold, FD, RE, Insurance, etc.) ============
  if (data.otherAssets?.categories?.length > 0) {
    newPage("Other Assets");
    section("Other Asset Holdings", "Gold, Fixed Deposits, Real Estate, Insurance, PPF, NPS, and other assets.");

    const oa = data.otherAssets;
    const y = doc.y;
    const bw = (W - 8) / 3;
    metricBox(M, y, bw, "Total Invested", fmt(oa.summary.totalInvested));
    metricBox(M + bw + 4, y, bw, "Current Value", fmt(oa.summary.currentValue));
    metricBox(M + (bw + 4) * 2, y, bw, "Holdings", String(oa.summary.holdingsCount));
    doc.y = y + 62;

    for (const cat of oa.categories) {
      checkPage(90, "Other Assets");
      section(cat.label + " (" + cat.count + ")");
      const oCols = [
        { label: "Name", x: M, w: 160 }, { label: "Invested", x: M + 160, w: 90 },
        { label: "Current Value", x: M + 250, w: 90 }, { label: "P&L", x: M + 340, w: 80 },
        { label: "Details", x: M + 420, w: 95 },
      ];
      tableHeader(oCols);
      for (const h of cat.holdings) {
        const gl = (h.currentValue || 0) - (h.investedValue || 0);
        let detail = "";
        if (h.interestRate) detail += h.interestRate + "% p.a. ";
        if (h.maturityDate) detail += "Mat: " + h.maturityDate + " ";
        if (h.premium) detail += "Prem: " + fmt(h.premium) + " ";
        if (h.sumAssured) detail += "SA: " + fmt(h.sumAssured);
        if (h.provider) detail = h.provider + " | " + detail;
        tableRow([
          { text: h.name || "", x: M, w: 160, bold: true },
          { text: fmt(h.investedValue), x: M + 160, w: 90 },
          { text: fmt(h.currentValue), x: M + 250, w: 90 },
          { text: fmt(gl), x: M + 340, w: 80, color: pCol(gl) },
          { text: detail.trim() || "-", x: M + 420, w: 95 },
        ]);
      }
    }

    // Other asset recommendations
    if (oa.recommendations?.length > 0) {
      section("Other Assets — Recommendations");
      for (const r of oa.recommendations) {
        checkPage(30);
        const col = r.priority === "high" ? RED : r.priority === "medium" ? "#eab308" : GREEN;
        doc.rect(M, doc.y, 3, 20).fill(col);
        doc.fontSize(8).fillColor(BRAND).font("Helvetica-Bold").text(r.asset + " — " + r.action, M + 10, doc.y + 2, { width: W - 20 });
        doc.fontSize(7).fillColor(GRAY).font("Helvetica").text(r.reason, M + 10, doc.y + 14, { width: W - 20 });
        doc.y += 28;
      }
    }
  }

  // ============ INVESTMENT STYLE ============
  if (equity?.investmentStyle?.styleLabel) {
    checkPage(100);
    section("Investment Style Profile");
    const ist = equity.investmentStyle;
    const y = doc.y;
    const bw = (W - 8) / 3;
    metricBox(M, y, bw, "Style", ist.styleLabel);
    metricBox(M + bw + 4, y, bw, "Quality Factor", ist.qualityFactor || "-");
    metricBox(M + (bw + 4) * 2, y, bw, "Volatility", ist.volatilityTilt || "-");
    doc.y = y + 62;

    // Value vs Growth bar
    const valuePct = Number(ist.valueTilt || 50);
    const growthPct = Number(ist.growthTilt || 50);
    const barY = doc.y;
    const barW = W - 100;
    doc.fontSize(8).fillColor(GRAY).font("Helvetica").text("Value vs Growth:", M, barY + 2);
    doc.rect(M + 100, barY, barW, 14).fill("#f1f5f9");
    doc.rect(M + 100, barY, barW * valuePct / 100, 14).fill(ACCENT + "60");
    doc.rect(M + 100 + barW * valuePct / 100, barY, barW * growthPct / 100, 14).fill(GREEN + "60");
    doc.fontSize(7).fillColor(BRAND).font("Helvetica-Bold")
      .text("Value " + valuePct.toFixed(0) + "%", M + 104, barY + 3);
    doc.fontSize(7).fillColor(BRAND).font("Helvetica-Bold")
      .text("Growth " + growthPct.toFixed(0) + "%", M + 100 + barW - 70, barY + 3, { width: 66, align: "right" });
    doc.y = barY + 22;

    if (ist.momentumExposure != null) {
      doc.fontSize(8).fillColor(GRAY).font("Helvetica").text("Momentum Exposure: " + Number(ist.momentumExposure).toFixed(1) + "%", M, doc.y);
      doc.moveDown(0.3);
    }
    if (ist.interpretation) {
      doc.fontSize(8).fillColor(GRAY).font("Helvetica").text(ist.interpretation, M, doc.y, { width: W });
      doc.moveDown(0.5);
    }
  }

  // ============ REBALANCING ============
  if (equity?.rebalancing?.suggestions?.length > 0) {
    newPage("Rebalancing & Scenarios");
    section("Rebalancing Suggestions");
    for (const s of equity.rebalancing.suggestions) {
      checkPage(40);
      const col = s.action === "Decrease" || s.action === "Exit" ? RED : s.action === "Increase" ? GREEN : ACCENT;
      const bgCol = s.action === "Decrease" || s.action === "Exit" ? "#fef2f2" : s.action === "Increase" ? "#f0fdf4" : LIGHT;
      const rebalH = Math.max(38, doc.heightOfString(s.reason, { width: W - 28, fontSize: 8 }) + 26);
      doc.roundedRect(M, doc.y, W, rebalH, 3).fill(bgCol).strokeColor(BORDER).lineWidth(0.3).stroke();
      doc.rect(M, doc.y, 4, rebalH).fill(col);
      const rbY = doc.y;
      doc.fontSize(10).fillColor(BRAND).font("Helvetica-Bold").text(s.stockName, M + 14, rbY + 6, { width: 100, lineBreak: false });
      doc.fontSize(9).fillColor(col).font("Helvetica-Bold").text(s.action + "  " + Number(s.currentWeight).toFixed(1) + "% \u2192 " + Number(s.targetWeight).toFixed(1) + "%", M + 130, rbY + 7, { width: W - 145, lineBreak: false });
      doc.fontSize(8).fillColor(GRAY).font("Helvetica").text(s.reason, M + 14, rbY + 22, { width: W - 28 });
      doc.y = rbY + rebalH + 6;
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
  newPage("Important Disclaimers");
  doc.moveDown(0.5);
  doc.rect(M, doc.y, W, 1).fill(BRAND);
  doc.moveDown(0.8);
  doc.fontSize(14).fillColor(BRAND).font("Helvetica-Bold").text("IMPORTANT DISCLAIMERS", M, doc.y);
  doc.moveDown(0.8);
  doc.moveTo(M, doc.y).lineTo(M + W, doc.y).strokeColor(BORDER).lineWidth(0.5).stroke();
  doc.moveDown(0.6);

  const disclaimerSections = [
    { title: "General Disclaimer", text: "This portfolio analysis report is generated for informational purposes only and should not be construed as financial, investment, tax, or legal advice. The information contained in this report is based on historical data and current market conditions, which are subject to change without notice. Past performance is not indicative of future results. All investments involve risk, including the potential loss of principal." },
    { title: "Investment Risk Disclaimer", text: "Individual stock and mutual fund recommendations in this report reflect statistical analysis and market trends but should not be considered as guarantees of future performance. Before making any investment decisions, we strongly recommend consulting with a SEBI-registered investment advisor who can assess your individual financial situation, risk tolerance, and investment objectives." },
    { title: "Tax Disclaimer", text: "Tax calculations presented in this report are estimates based on prevailing tax rates as per Union Budget 2024. STCG is taxed at 20% and LTCG at 12.5% above \u20B91.25 lakh exemption per year. Actual tax liability may vary based on individual circumstances, applicable exemptions, and deductions. We strongly recommend consulting with a qualified Chartered Accountant or Tax Advisor for personalized tax planning." },
    { title: "Data Accuracy", text: "Stock prices, NAVs, and market data are sourced from third-party providers including NSE, BSE, AMFI, and Groww. While we strive to provide accurate information, we do not guarantee the accuracy, completeness, or timeliness of any data presented. Dividend yields are based on trailing twelve-month data and may not reflect future payments." },
    { title: "Regulatory Compliance", text: "AlphaMarket is a portfolio analysis tool and does not provide investment advisory services as defined under SEBI (Investment Advisers) Regulations, 2013. We do not execute trades, manage portfolios, or provide personalized investment recommendations. All investment decisions are the sole responsibility of the user." },
  ];

  for (const ds of disclaimerSections) {
    checkPage(60);
    doc.roundedRect(M, doc.y, W, 2, 1).fill(ACCENT + "20");
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor(BRAND).font("Helvetica-Bold").text(ds.title, M + 4, doc.y);
    doc.moveDown(0.4);
    doc.fontSize(8).fillColor(GRAY).font("Helvetica").text(ds.text, M + 4, doc.y, { width: W - 8, align: "justify", lineGap: 2 });
    doc.moveDown(0.8);
  }

  // Custom disclaimer from advisor
  if (branding?.customDisclaimer) {
    checkPage(50);
    doc.roundedRect(M, doc.y, W, 2, 1).fill(ACCENT + "20");
    doc.moveDown(0.3);
    doc.fontSize(10).fillColor(BRAND).font("Helvetica-Bold").text("Advisor Disclaimer", M + 4, doc.y);
    doc.moveDown(0.4);
    doc.fontSize(8).fillColor(GRAY).font("Helvetica").text(branding.customDisclaimer, M + 4, doc.y, { width: W - 8, align: "justify", lineGap: 2 });
    doc.moveDown(0.8);
  }

  // Footer
  doc.moveDown(0.5);
  doc.moveTo(M, doc.y).lineTo(M + W, doc.y).strokeColor(BORDER).lineWidth(0.5).stroke();
  doc.moveDown(0.5);
  const advisorInfo = branding?.companyName || "AlphaMarket";
  const contactLine = [branding?.advisorContact, branding?.advisorWebsite].filter(Boolean).join(" | ");
  doc.fontSize(8).fillColor(GRAY).font("Helvetica").text("Report generated by " + advisorInfo + " on " + new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" }) + ".", M, doc.y, { width: W });
  if (contactLine) doc.fontSize(8).fillColor(GRAY).text(contactLine, M, doc.y);
  if (branding?.sebiRegNumber) doc.fontSize(8).fillColor(GRAY).text("SEBI Registration: " + branding.sebiRegNumber, M, doc.y);
  doc.moveDown(0.5);
  doc.fontSize(7).fillColor("#94a3b8").font("Helvetica").text("\u00A9 " + new Date().getFullYear() + " " + advisorInfo + ". All rights reserved. This report is confidential and intended solely for the recipient.", M, doc.y, { width: W, align: "center" });

  // Finalize
  doc.end();
  return new Promise((resolve) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
  });
}

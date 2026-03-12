
export interface ParsedHolding {
  name: string;
  folio?: string;
  isin?: string;
  units: number;
  nav: number;
  costValue: number;
  currentValue: number;
  gainLoss?: number;
  gainLossPercent?: number;
  assetType: string;
}

export interface CASParseResult {
  investorName?: string;
  email?: string;
  pan?: string;
  holdings: ParsedHolding[];
  source: string;
}

export async function parseCASPdf(buffer: Buffer): Promise<CASParseResult> {
  const { PDFExtract } = await import("pdf.js-extract");
  const pdfExtract = new PDFExtract();
  const data = await pdfExtract.extractBuffer(buffer, {});

  // Reconstruct text from PDF pages
  let fullText = "";
  for (const page of data.pages) {
    const items = (page.content || []).filter((item: any) => item.str && item.str.trim());
    items.sort((a: any, b: any) => a.y - b.y || a.x - b.x);
    const rows: { y: number; texts: string[] }[] = [];
    let curRow = { y: items[0]?.y || 0, texts: [] as string[] };
    for (const item of items) {
      if (Math.abs(item.y - curRow.y) < 3) {
        curRow.texts.push(item.str.trim());
      } else {
        if (curRow.texts.length > 0) rows.push(curRow);
        curRow = { y: item.y, texts: [item.str.trim()] };
      }
    }
    if (curRow.texts.length > 0) rows.push(curRow);
    fullText += rows.map(r => r.texts.join(" ")).join("\n") + "\n";
  }

  const lines = fullText.split("\n").map(l => l.trim()).filter(Boolean);
  const result: CASParseResult = { holdings: [], source: "CAS" };

  // Detect source
  if (fullText.includes("CAMS") || fullText.includes("Computer Age Management")) {
    result.source = "CAMS";
  } else if (fullText.includes("KFintech") || fullText.includes("Karvy")) {
    result.source = "KFintech";
  } else if (fullText.includes("NSDL") || fullText.includes("CDSL") || fullText.includes("Consolidated Account Statement")) {
    result.source = "CAS";
  }

  // Extract investor info
  for (const line of lines) {
    if (!result.pan) {
      const panMatch = line.match(/PAN[:\s]*([A-Z]{5}\d{4}[A-Z])/);
      if (panMatch) result.pan = panMatch[1];
    }
    if (!result.email) {
      const emailMatch = line.match(/Email\s*(?:Id|id)?[:\s]*([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/i);
      if (emailMatch) result.email = emailMatch[1];
    }
    if (!result.investorName && result.pan) {
      // Name is often on the line before/near PAN
      const nameMatch = line.match(/^([A-Z][A-Z\s]{3,30})(?:\s*\(?\s*PAN)/);
      if (nameMatch) result.investorName = nameMatch[1].trim();
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // STRATEGY 1: Parse "MUTUAL FUND UNITS HELD AS ON" summary table
  // This is the most reliable source — it has scheme name, ISIN, folio,
  // closing units, NAV, invested amount, valuation, P&L, P&L%
  // Format per row: SchemeName ISIN Folio Units NAV Invested Valuation P/L P/L%
  // ──────────────────────────────────────────────────────────────────────

  // Build ISIN-to-clean-name map from "Scheme Name:" and "ISIN:" metadata in MF Folios section
  const isinToName: Map<string, string> = new Map();
  let currentAMC = "";
  let currentSchemeName = "";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const amcMatch = line.match(/AMC\s*Name\s*:\s*(.+)/i);
    if (amcMatch) currentAMC = amcMatch[1].trim();

    const schemeMatch = line.match(/Scheme\s*Name\s*:\s*(.+)/i);
    if (schemeMatch) {
      currentSchemeName = schemeMatch[1].trim();
      // Remove "(Formerly known as ...)" and "(Erstwhile ...)" suffixes
      currentSchemeName = currentSchemeName.replace(/\s*\((?:Formerly|Erstwhile)[^)]*\)/gi, "").trim();
    }

    const isinMatch = line.match(/ISIN\s*:\s*(INF[A-Z0-9]+)/i);
    if (isinMatch && currentSchemeName) {
      isinToName.set(isinMatch[1], currentSchemeName);
      console.log(`[CAS Parser] Metadata: ${isinMatch[1]} => ${currentSchemeName}`);
    }
  }
  console.log(`[CAS Parser] Found ${isinToName.size} scheme names from metadata`);

  // Find the summary table section
  let inHoldingsTable = false;
  const holdingsTableLines: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect start of holdings summary table
    if (line.match(/MUTUAL\s*FUND\s*UNITS\s*HELD\s*(?:AS\s*ON|WITH)/i) && !line.match(/RTA/i)) {
      inHoldingsTable = true;
      continue;
    }

    // Detect end of table
    if (inHoldingsTable) {
      if (line.match(/^Grand\s*Total/i) || line.match(/^Load\s*Structure/i) || line.match(/^Notes:/i) || line.match(/IDCW\s*-\s*Income/i)) {
        inHoldingsTable = false;
        continue;
      }
      holdingsTableLines.push(line);
    }
  }

  console.log(`[CAS Parser] Found ${holdingsTableLines.length} lines in holdings table`);

  // Parse holdings table lines
  // Each holding spans 1-3 lines with: SchemeName ISIN FolioNo Units NAV Invested Valuation P/L P/L%
  // Key: ISIN always starts with INF, folio has / or is pure digits
  let pendingLine = "";

  for (let i = 0; i < holdingsTableLines.length; i++) {
    const rawLine = holdingsTableLines[i];

    // Skip header rows and Hindi text
    if (rawLine.match(/Scheme\s*Name|ISIN.*Folio|Closing.*Bal|NAV.*Cumulative|\u0928\u093E\u092E|\u092E\u0942\u0932\u094D\u092F/i)) continue;
    if (rawLine.match(/^\u0938\u094D\u0915|\u092B\u094B\u0932\u093F|\u092F\u0942\u0928\u093F/)) continue; // Hindi headers

    // Accumulate lines until we have a complete row (contains ISIN + numbers)
    pendingLine = pendingLine ? pendingLine + " " + rawLine : rawLine;

    // Check if we have a complete row: must have ISIN and at least 4 numbers
    const isinMatch = pendingLine.match(/(INF[A-Z0-9]{7,12})/);
    const allNumbers = pendingLine.match(/[\d,]+\.?\d*/g) || [];
    const significantNumbers = allNumbers.filter(n => {
      const val = parseFloat(n.replace(/,/g, ""));
      return !isNaN(val) && val > 0;
    });

    if (!isinMatch) {
      // No ISIN yet, keep accumulating (unless line is too long / garbage)
      if (pendingLine.length > 300) pendingLine = "";
      continue;
    }

    if (significantNumbers.length < 4) {
      // Not enough numbers yet, keep accumulating
      if (pendingLine.length > 500) pendingLine = "";
      continue;
    }

    // We have ISIN + enough numbers — parse this row
    const isin = isinMatch[1];

    // Extract folio number (digits with optional /XX part, e.g. 3646408/48 or 91095332642/0)
    const afterISINForFolio = pendingLine.substring(pendingLine.indexOf(isin) + isin.length).trim();
    const folioMatch = afterISINForFolio.match(/^([\d]+\/[\d]+)/);
    const folio = folioMatch ? folioMatch[1] : "";

    // Get clean scheme name from metadata map (preferred) or parse from line
    let schemeName = isinToName.get(isin) || "";
    if (!schemeName) {
      // Fallback: extract from text before ISIN
      schemeName = pendingLine.substring(0, pendingLine.indexOf(isin)).trim();
      // Clean up scheme name
      schemeName = schemeName.replace(/^[\dA-Z]{2,6}\s*-\s*/, "").trim();
      schemeName = schemeName.replace(/\s*-\s*$/, "").trim();
      // Remove common garbage prefixes from PDF parsing
      schemeName = schemeName.replace(/.*(?:Unrealised|Cumulative|Closing|Valuation|Growth|Plan)\s*[-]?\s*/i, "").trim();
    }

    if (!schemeName || schemeName.length < 5) {
      // Last resort: use ISIN as name
      schemeName = `Fund ${isin}`;
    }

    // Extract numbers after ISIN+folio: units, NAV, invested, valuation, P/L, P/L%
    const afterISIN = pendingLine.substring(pendingLine.indexOf(isin) + isin.length);
    const nums: number[] = [];
    const numRegex = /([\d,]+\.?\d*)/g;
    let numMatch;
    while ((numMatch = numRegex.exec(afterISIN)) !== null) {
      const val = parseFloat(numMatch[1].replace(/,/g, ""));
      if (!isNaN(val)) nums.push(val);
    }

    // Skip folio-related numbers from the data
    // Folio like "3646408/48" produces two numbers: 3646408 and 48
    // We need to skip both
    const folioParts = folio ? folio.split("/").map(p => parseFloat(p)) : [];
    let numStart = 0;
    for (let fi = 0; fi < folioParts.length && numStart < nums.length; fi++) {
      if (Math.abs(nums[numStart] - folioParts[fi]) < 1) {
        numStart++;
      }
    }
    // Also skip if first number looks like a merged folio (very large, > 100000)
    if (numStart === 0 && nums.length > 0 && nums[0] > 100000 && folio) {
      numStart = 1;
      // Check if next number is also a folio part
      if (nums.length > 1 && folioParts.some(fp => Math.abs(nums[1] - fp) < 1)) {
        numStart = 2;
      }
    }

    const dataNumbers = nums.slice(numStart);

    // Expected order: units, NAV, invested, valuation, P/L (absolute), P/L%
    // But some rows may skip folio or have different counts
    if (dataNumbers.length >= 4) {
      const units = dataNumbers[0];
      const nav = dataNumbers[1];
      const invested = dataNumbers[2];
      const valuation = dataNumbers[3];
      const gainLoss = dataNumbers.length >= 5 ? dataNumbers[4] : valuation - invested;
      const gainLossPct = dataNumbers.length >= 6 ? dataNumbers[5] : (invested > 0 ? ((valuation - invested) / invested) * 100 : 0);

      // Sanity checks
      if (units > 0 && nav > 0 && valuation > 0) {
        // Verify: units * NAV should be roughly equal to valuation (within 5%)
        const expectedVal = units * nav;
        const ratio = expectedVal / valuation;

        if (ratio > 0.8 && ratio < 1.2) {
          // Good match — use the data
          result.holdings.push({
            name: schemeName,
            folio: folio || undefined,
            isin,
            units,
            nav,
            costValue: invested,
            currentValue: valuation,
            gainLoss: valuation - invested,
            gainLossPercent: invested > 0 ? ((valuation - invested) / invested) * 100 : 0,
            assetType: "mutual_fund",
          });
          console.log(`[CAS Parser] MF: ${schemeName} | ${units} units @ NAV ${nav} = ${valuation}`);
        } else {
          console.log(`[CAS Parser] Skipped (units*NAV mismatch): ${schemeName} | ${units} * ${nav} = ${expectedVal} vs ${valuation}`);
        }
      }
    }

    pendingLine = "";
  }

  // ──────────────────────────────────────────────────────────────────────
  // STRATEGY 2: Parse BOND holdings from "HOLDING STATEMENT OF BONDS"
  // Format: ISIN ISINName Coupon MaturityDate Quantity FaceValue MarketValue TotalValue
  // ──────────────────────────────────────────────────────────────────────

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.match(/^INE[A-Z0-9]+/) && line.match(/\d{8}/) && !line.match(/Fund|Growth|Cap/i)) {
      const bondISIN = line.match(/^(INE[A-Z0-9]+)/)?.[1] || "";
      const nums: number[] = [];
      const numRegex = /([\d,]+\.?\d+)/g;
      let m;
      while ((m = numRegex.exec(line)) !== null) {
        const v = parseFloat(m[1].replace(/,/g, ""));
        if (!isNaN(v) && v > 0) nums.push(v);
      }
      // Bond row: coupon, maturityDate(as number), quantity, faceValue, marketValue, totalValue
      if (nums.length >= 4) {
        const totalValue = nums[nums.length - 1];
        const marketPrice = nums.length >= 2 ? nums[nums.length - 2] : 0;
        const faceValue = nums.length >= 3 ? nums[nums.length - 3] : 0;
        const quantity = nums.length >= 4 ? nums[nums.length - 4] : 1;

        // Extract bond name from line
        let bondName = line.replace(bondISIN, "").trim();
        bondName = bondName.replace(/[\d,]+\.?\d*/g, "").replace(/\s+/g, " ").trim();
        if (!bondName || bondName.length < 3) bondName = `Bond ${bondISIN}`;

        result.holdings.push({
          name: bondName,
          isin: bondISIN,
          units: quantity,
          nav: marketPrice,
          costValue: faceValue * quantity,
          currentValue: totalValue,
          assetType: "bond",
        });
        console.log(`[CAS Parser] Bond: ${bondName} | ${quantity} @ ${marketPrice} = ${totalValue}`);
      }
    }
  }

  // ──────────────────────────────────────────────────────────────────────
  // STRATEGY 3: Parse from "Closing Balance" lines in transaction sections
  // (Fallback if summary table not found or empty)
  // ──────────────────────────────────────────────────────────────────────

  if (result.holdings.length === 0) {
    console.log("[CAS Parser] No holdings from summary table, trying transaction sections...");
    let currentScheme = "";
    let currentFolio = "";
    let currentISIN = "";

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Track folio
      const folioM = line.match(/Folio\s*(?:No|Number)?[:\s]*([\d\s\/]+)/i);
      if (folioM) currentFolio = folioM[1].replace(/\s+/g, "").trim();

      // Track ISIN
      const isinM = line.match(/ISIN[:\s]*(INF[A-Z0-9]+)/i);
      if (isinM) currentISIN = isinM[1];

      // Track scheme - look for "SchemeCode - SchemeName" pattern
      const schemeMatch = line.match(/^([A-Z0-9]{2,6})\s*-\s*(.+?)(?:\s*-\s*ISIN|$)/i);
      if (schemeMatch && schemeMatch[2].match(/Fund|Growth|Cap|Direct|Regular|IDCW|Equity|Value|Flexi/i)) {
        currentScheme = schemeMatch[2].trim();
      }

      // Detect "Closing Balance" with units
      const closingMatch = line.match(/Closing\s*Balance\s*([\d,]+\.?\d*)/i);
      if (closingMatch && currentScheme) {
        const units = parseFloat(closingMatch[1].replace(/,/g, ""));
        if (units > 0 && !result.holdings.find(h => h.isin === currentISIN && currentISIN)) {
          result.holdings.push({
            name: currentScheme,
            folio: currentFolio || undefined,
            isin: currentISIN || undefined,
            units,
            nav: 0,
            costValue: 0,
            currentValue: 0,
            assetType: "mutual_fund",
          });
          console.log(`[CAS Parser] Fallback MF: ${currentScheme} | ${units} units (NAV unknown)`);
        }
        currentScheme = "";
      }
    }
  }

  console.log(`[CAS Parser] Source: ${result.source}, Total Holdings: ${result.holdings.length}`);
  return result;
}

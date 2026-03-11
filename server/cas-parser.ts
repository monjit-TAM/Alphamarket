const pdfParse = require("pdf-parse");

export interface ParsedHolding {
  name: string;
  folio?: string;
  isin?: string;
  units: number;
  nav: number;
  costValue: number;
  currentValue: number;
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
  const data = await pdfParse(buffer);
  const text = data.text;
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);

  const result: CASParseResult = { holdings: [], source: "unknown" };

  // Detect source
  if (text.includes("CAMS") || text.includes("Computer Age Management")) {
    result.source = "CAMS";
  } else if (text.includes("KFintech") || text.includes("Karvy")) {
    result.source = "KFintech";
  } else if (text.includes("NSDL") || text.includes("CDSL") || text.includes("Consolidated Account Statement")) {
    result.source = "CAS";
  }

  // Extract investor info
  for (const line of lines) {
    if (!result.investorName) {
      const nameMatch = line.match(/^(?:Name|Investor Name)[:\s]+(.+)/i);
      if (nameMatch) result.investorName = nameMatch[1].trim();
    }
    if (!result.email) {
      const emailMatch = line.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      if (emailMatch) result.email = emailMatch[1];
    }
    if (!result.pan) {
      const panMatch = line.match(/PAN[:\s]*([A-Z]{5}\d{4}[A-Z])/);
      if (panMatch) result.pan = panMatch[1];
    }
  }

  // Strategy 1: Extract holdings from valuation summary tables
  // Look for patterns like: scheme name, folio, units, nav, cost, market value
  let currentScheme = "";
  let currentFolio = "";
  let currentISIN = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Track folio
    const folioMatch = line.match(/Folio\s*(?:No|Number)?[:\s]*([\d\s\/]+)/i);
    if (folioMatch) {
      currentFolio = folioMatch[1].replace(/\s+/g, "").trim();
    }

    // Track ISIN
    const isinMatch = line.match(/ISIN[:\s]*(INF[A-Z0-9]+)/i);
    if (isinMatch) {
      currentISIN = isinMatch[1];
    }

    // Detect scheme name - lines with fund keywords
    if (line.match(/Fund|Growth|Dividend|IDCW|Direct|Regular|Bluechip|Flexi|Small\s*Cap|Mid\s*Cap|Large\s*Cap|Index|Liquid|Ultra\s*Short/i) &&
        !line.match(/^(Opening|Closing|Total|Valuation|NAV|Market|Date|Folio|PAN|KYC|Page|ISIN)/i) &&
        line.length > 15 && line.length < 200) {
      const cleaned = line.replace(/\s*-\s*ISIN.*$/i, "").replace(/\s*\(.*$/, "").trim();
      if (cleaned.length > 10) {
        currentScheme = cleaned;
      }
    }

    // Extract closing balance with units
    const closingMatch = line.match(/Closing\s*Unit\s*Balance[:\s]*([\d,]+\.?\d*)/i);
    if (closingMatch && currentScheme) {
      const units = parseFloat(closingMatch[1].replace(/,/g, ""));
      if (units > 0) {
        // Look for NAV and value nearby
        let nav = 0, costVal = 0, marketVal = 0;
        for (let j = i - 3; j < Math.min(i + 5, lines.length); j++) {
          if (j < 0) continue;
          const nearby = lines[j];
          const navMatch = nearby.match(/NAV[:\s]*([\d,]+\.?\d*)/i);
          if (navMatch) nav = parseFloat(navMatch[1].replace(/,/g, ""));
          const costMatch = nearby.match(/(?:Total\s*)?Cost\s*Value[:\s]*(?:INR\s*)?([\d,]+\.?\d*)/i);
          if (costMatch) costVal = parseFloat(costMatch[1].replace(/,/g, ""));
          const mktMatch = nearby.match(/(?:Market|Current)\s*Value[:\s]*(?:INR\s*)?([\d,]+\.?\d*)/i);
          if (mktMatch) marketVal = parseFloat(mktMatch[1].replace(/,/g, ""));
          const valMatch = nearby.match(/Valuation[:\s]*(?:INR\s*)?([\d,]+\.?\d*)/i);
          if (valMatch && !marketVal) marketVal = parseFloat(valMatch[1].replace(/,/g, ""));
        }

        // Estimate values if missing
        if (nav > 0 && !marketVal) marketVal = units * nav;
        if (!costVal && marketVal > 0) costVal = marketVal;
        if (!nav && marketVal > 0 && units > 0) nav = marketVal / units;

        const existing = result.holdings.find(h => h.name === currentScheme && h.folio === currentFolio);
        if (!existing) {
          result.holdings.push({
            name: currentScheme,
            folio: currentFolio || undefined,
            isin: currentISIN || undefined,
            units,
            nav,
            costValue: costVal,
            currentValue: marketVal,
            assetType: "mutual_fund",
          });
        }
      }
    }

    // Strategy 2: Look for tabular data with numbers (units, nav, value in same line)
    const numbers = line.match(/[\d,]+\.\d{2,4}/g);
    if (numbers && numbers.length >= 3 && currentScheme && !line.match(/Opening|Date|Page|Total Cost|Entry|Exit/i)) {
      const nums = numbers.map(n => parseFloat(n.replace(/,/g, "")));
      // Heuristic: smallest is NAV, middle is units or cost, largest is value
      const sorted = [...nums].sort((a, b) => a - b);
      if (sorted.length >= 3) {
        const possibleNav = sorted.find(n => n > 1 && n < 10000);
        const possibleValue = sorted[sorted.length - 1];
        const possibleUnits = possibleNav && possibleValue > 0 ? possibleValue / possibleNav : 0;

        if (possibleNav && possibleValue > 100 && possibleUnits > 0.01) {
          const existing = result.holdings.find(h => h.name === currentScheme);
          if (!existing) {
            result.holdings.push({
              name: currentScheme,
              folio: currentFolio || undefined,
              isin: currentISIN || undefined,
              units: Math.round(possibleUnits * 1000) / 1000,
              nav: possibleNav,
              costValue: possibleValue,
              currentValue: possibleValue,
              assetType: "mutual_fund",
            });
          }
        }
      }
    }
  }

  // Strategy 3: Fallback — extract scheme names and any associated numbers
  if (result.holdings.length === 0) {
    const schemePattern = /(?:Axis|HDFC|SBI|ICICI|Kotak|Mirae|Parag|Nippon|UTI|Aditya|DSP|Tata|Canara|L&T|Motilal|Quant|PPFAS|Edelweiss|Franklin|Invesco|Bandhan|Mahindra|Baroda|HSBC|Union|Sundaram|PGIM|ITI|BOI|Navi|360|Groww|Zerodha|WhiteOak)\s+.+(?:Fund|Growth|Direct|IDCW|Plan)/gi;
    let match;
    while ((match = schemePattern.exec(text)) !== null) {
      const name = match[0].replace(/\s+/g, " ").trim();
      if (name.length > 15 && !result.holdings.find(h => h.name === name)) {
        result.holdings.push({
          name,
          units: 0,
          nav: 0,
          costValue: 0,
          currentValue: 0,
          assetType: "mutual_fund",
        });
      }
    }
  }

  console.log(`[CAS Parser] Source: ${result.source}, Holdings found: ${result.holdings.length}`);
  return result;
}

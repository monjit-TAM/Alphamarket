import { db } from "./db";
import { users, strategies, calls, plans, content, scores } from "@shared/schema";
import { eq } from "drizzle-orm";
import { scrypt, randomBytes } from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const buf = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${buf.toString("hex")}.${salt}`;
}

export async function seed() {
  const adminPassword = await hashPassword("admin123");
  const existingAdmin = await db.select().from(users).where(eq(users.role, "admin"));
  if (existingAdmin.length === 0) {
    await db.insert(users).values({
      username: "admin",
      email: "admin@alphamarket.com",
      password: adminPassword,
      role: "admin",
      companyName: "AlphaMarket Admin",
      isApproved: true,
    });
    console.log("[Seed] Admin user created");
  }

  const existingAdvisors = await db.select().from(users).where(eq(users.role, "advisor"));
  if (existingAdvisors.length > 0) {
    const unapproved = existingAdvisors.filter(a => !a.isApproved);
    if (unapproved.length > 0) {
      for (const a of unapproved) {
        await db.update(users).set({ isApproved: true }).where(eq(users.id, a.id));
      }
      console.log(`[Seed] Approved ${unapproved.length} existing advisors`);
    }
    return;
  }

  const advisorPassword = await hashPassword("advisor123");
  const investorPassword = await hashPassword("investor123");

  const [advisor1] = await db.insert(users).values({
    username: "stokwiz",
    email: "gaurav@stokwiz.com",
    password: advisorPassword,
    phone: "+91 7259-667755",
    role: "advisor",
    companyName: "STOKWIZ",
    overview: "Welcome to STOKWIZ, a revered entity in the financial domain, holding prestigious accreditation as a SEBI registered Investment Advisor. We take immense pride in our robust legacy of aiding Indian investors. Our commitment is fortified by our endeavor to furnish our clientele with precise insights, well-founded calls, expert advisory, and profound market analysis.\n\nAt STOKWIZ, we champion the ethos of empowering investors to navigate the financial markets with enhanced acuity and confidence, ensuring they are well-positioned to make informed and lucrative decisions.",
    themes: ["Equity", "F&O", "Growth"],
    isRegistered: true,
    isApproved: true,
    sebiRegNumber: "INH000013925",
    activeSince: new Date("2023-09-28"),
  }).returning();

  const [advisor2] = await db.insert(users).values({
    username: "finkhoz",
    email: "research@finkhoz.com",
    password: advisorPassword,
    phone: "+91 9876-543210",
    role: "advisor",
    companyName: "FINKHOZ ROBOADVISORY SERVICES PRIVATE LIMITED",
    overview: "FINKHOZ is a quantitative research and robo-advisory platform that builds data-backed stock baskets designed for long-term, consistent wealth creation. Our team of experienced financial analysts and data scientists work together to deliver high-quality investment strategies.",
    themes: ["Basket"],
    isRegistered: true,
    isApproved: true,
    sebiRegNumber: "INH000022297",
    activeSince: new Date("2025-12-12"),
  }).returning();

  const [advisor3] = await db.insert(users).values({
    username: "harshal_parmar",
    email: "harshal@prathamcapital.com",
    password: advisorPassword,
    phone: "+91 8765-432109",
    role: "advisor",
    companyName: "Harshal Parmar",
    overview: "Pratham Capital Research is dedicated to providing data-driven insights and strategic guidance to help clients achieve their financial goals. With years of experience in equity markets, our research process combines fundamental and technical analysis for comprehensive stock coverage.",
    themes: ["Equity"],
    isRegistered: true,
    isApproved: true,
    sebiRegNumber: "INH000020299",
    activeSince: new Date("2025-07-14"),
  }).returning();

  const [advisor4] = await db.insert(users).values({
    username: "aalgo_breaths",
    email: "amit@aalgobreaths.com",
    password: advisorPassword,
    phone: "+91 9012-345678",
    role: "advisor",
    companyName: "AALGO BREATHS",
    overview: "Founder of AALGO BREATHS | M.Com, CMA | 10+ Years of Experience. Amit Bhattacharjee is a SEBI Registered Research Analyst providing comprehensive equity, F&O, and commodity research with a data-driven approach to market analysis.",
    themes: ["Equity", "F&O", "Growth", "Shorting", "SwingTrade", "Dividend Stocks", "Basket"],
    isRegistered: true,
    isApproved: true,
    sebiRegNumber: "INH000019886",
    activeSince: new Date("2025-07-10"),
  }).returning();

  const [advisor5] = await db.insert(users).values({
    username: "jap_finserve",
    email: "varun@japfinserve.com",
    password: advisorPassword,
    phone: "+91 7890-123456",
    role: "advisor",
    companyName: "Varunkumar Patel proprietor of JAP Finserve",
    overview: "Varun Kumar Patel has been in the financial markets for more than 17 years. He is the first individual research analyst in North Gujarat. He provides expert commodity and equity research with a focus on precision and risk management.",
    themes: ["Equity", "F&O", "Growth", "SwingTrade", "Basket"],
    isRegistered: true,
    isApproved: true,
    sebiRegNumber: "INH000011370",
    activeSince: new Date("2025-07-08"),
  }).returning();

  const [advisor6] = await db.insert(users).values({
    username: "sandeep_wagle",
    email: "sandeep@swresearch.com",
    password: advisorPassword,
    phone: "+91 6543-210987",
    role: "advisor",
    companyName: "Sandeep Wagle",
    overview: "Sandeep Wagle is an experienced market professional with deep expertise in technical analysis and momentum trading. His strategies focus on identifying breakouts, price patterns, and momentum signals for both intraday and positional trades.",
    themes: ["Equity", "F&O", "SwingTrade"],
    isRegistered: true,
    isApproved: true,
    sebiRegNumber: "INH000016500",
    activeSince: new Date("2025-02-16"),
  }).returning();

  await db.insert(users).values({
    username: "investor1",
    email: "investor1@gmail.com",
    password: investorPassword,
    role: "investor",
  });

  const [strategy1] = await db.insert(strategies).values({
    advisorId: advisor1.id,
    name: "Nifty and BankNifty Options",
    type: "Option",
    description: "This strategy focuses on Nifty and BankNifty options with precise entry points, carefully defined target levels, and strict stop losses to maximize returns while managing risk effectively.",
    status: "Published",
    theme: ["Equity", "F&O"],
    horizon: "Intraday",
    volatility: "High",
    riskLevel: "High Risk",
    benchmark: "Nifty 50",
    cagr: "-1.75",
    totalRecommendations: 12,
    stocksInBuyZone: 0,
  }).returning();

  const [strategy2] = await db.insert(strategies).values({
    advisorId: advisor1.id,
    name: "WIZ GROWTH LONG TERM",
    type: "Equity",
    description: "This is a Strategy Focusing on Long Term Positional Calls based on Growth Parameters. We will try to identify Growth Stocks and will have a horizon of 3 to 6 Months.",
    status: "Published",
    theme: ["Equity", "Growth", "Value"],
    horizon: "Positional",
    volatility: "Medium",
    riskLevel: "Medium Risk",
    benchmark: "Nifty 50",
    cagr: "-1.75",
    totalRecommendations: 12,
    stocksInBuyZone: 0,
    minimumInvestment: "50000",
  }).returning();

  const [strategy3] = await db.insert(strategies).values({
    advisorId: advisor2.id,
    name: "VB Momentum Quant Basket",
    type: "Basket",
    description: "To consistently outperform Nifty 50 using a fully non-discretionary, rule-based system that captures emerging trends and momentum signals across Indian equities.",
    status: "Published",
    theme: ["Equity", "Momentum"],
    horizon: "Positional",
    volatility: "Medium",
    riskLevel: "Medium Risk",
    benchmark: "Nifty 50",
    totalRecommendations: 8,
    minimumInvestment: "67000",
  }).returning();

  const [strategy4] = await db.insert(strategies).values({
    advisorId: advisor2.id,
    name: "Finz Wealth Compounder",
    type: "Basket",
    description: "The Wealth Compounder Basket is a research-driven portfolio crafted to uncover early-stage, high-growth opportunities while maintaining a margin of safety.",
    status: "Published",
    theme: ["Equity", "Growth"],
    horizon: "Positional",
    volatility: "Medium",
    riskLevel: "Medium Risk",
    benchmark: "Sensex",
    totalRecommendations: 5,
    minimumInvestment: "25000",
  }).returning();

  const [strategy5] = await db.insert(strategies).values({
    advisorId: advisor3.id,
    name: "Equity Positional",
    type: "Equity",
    description: "Equity positional stocks are shares bought with a medium to long-term horizon, typically held for weeks to months, based on fundamental strength and technical trends. Unlike intraday or short-term trades, positional investing focuses on capturing larger price movements.",
    status: "Published",
    theme: ["Equity"],
    horizon: "Positional",
    volatility: "Medium",
    riskLevel: "Medium Risk",
    benchmark: "Nifty 50",
    cagr: "0",
    totalRecommendations: 15,
    stocksInBuyZone: 7,
  }).returning();

  await db.insert(strategies).values({
    advisorId: advisor5.id,
    name: "Commodity Signals",
    type: "CommodityFuture",
    description: "Commodities Signals - Navigate Market with Precision. Welcome to JAP Finserve Commodities Ideas, providing well-researched trading calls in Gold, Silver, Crude Oil and Natural Gas futures with precise entry, target and stop loss levels.",
    status: "Published",
    theme: ["Commodity"],
    horizon: "Intraday | Positional",
    volatility: "High",
    riskLevel: "High Risk",
    benchmark: "MCX",
    totalRecommendations: 6,
    stocksInBuyZone: 1,
  });

  await db.insert(strategies).values({
    advisorId: advisor2.id,
    name: "Finz Dividend Basket",
    type: "Basket",
    description: "The Dividend Basket is a research-driven portfolio of high-quality, dividend-paying companies designed to generate steady income and long-term capital appreciation.",
    status: "Published",
    theme: ["Equity", "Dividend"],
    horizon: "Positional",
    volatility: "Low",
    riskLevel: "Medium Risk",
    benchmark: "Nifty 50",
    totalRecommendations: 4,
    minimumInvestment: "10000",
  });

  await db.insert(strategies).values({
    advisorId: advisor2.id,
    name: "Future Picks",
    type: "Future",
    description: "In this strategy, we provide buy and sell trade recommendations from the Nifty F&O universe, based on prevailing market trends, momentum signals, and quantitative screening.",
    status: "Published",
    theme: ["F&O"],
    horizon: "Positional",
    volatility: "High",
    riskLevel: "High Risk",
    benchmark: "Nifty 50",
    totalRecommendations: 3,
  });

  await db.insert(strategies).values({
    advisorId: advisor2.id,
    name: "Finz Stable Basket",
    type: "Basket",
    description: "The FINZ Stable basket is built using a quantitative approach to identify strong, high-quality companies in sectors showing structural growth potential.",
    status: "Published",
    theme: ["Equity", "Value"],
    horizon: "Positional",
    volatility: "Low",
    riskLevel: "Medium Risk",
    benchmark: "Nifty 50",
    totalRecommendations: 6,
    minimumInvestment: "70000",
  });

  await db.insert(strategies).values({
    advisorId: advisor2.id,
    name: "Finz ETF Basket",
    type: "Basket",
    description: "The ETF Basket is a diversified, low-cost portfolio designed to provide balanced exposure across equity and commodity markets through exchange-traded funds.",
    status: "Published",
    theme: ["ETF"],
    horizon: "Positional",
    volatility: "Low",
    riskLevel: "Medium Risk",
    benchmark: "Nifty 50",
    totalRecommendations: 2,
    minimumInvestment: "1394",
  });

  await db.insert(strategies).values({
    advisorId: advisor2.id,
    name: "F&O Bulls",
    type: "Future",
    description: "Intraday and positional F&O trades with high-conviction setups based on technical analysis and market structure.",
    status: "Published",
    theme: ["F&O"],
    horizon: "Intraday",
    volatility: "High",
    riskLevel: "High Risk",
    benchmark: "Nifty 50",
    totalRecommendations: 4,
  });

  await db.insert(strategies).values({
    advisorId: advisor4.id,
    name: "AALGO BREATHS SMART EQUITY",
    type: "Equity",
    description: "AALGO BREATHS SMART EQUITY - Consistent. Disciplined. Research-Driven. Receive 2-3 high-quality equity calls daily, carefully researched and analyzed for maximum profit potential.",
    status: "Published",
    theme: ["Equity", "Growth"],
    horizon: "Positional | Swing",
    volatility: "High",
    riskLevel: "High Risk",
    benchmark: "Nifty 50",
    totalRecommendations: 18,
    stocksInBuyZone: 3,
  });

  await db.insert(strategies).values({
    advisorId: advisor4.id,
    name: "AALGO BREATHS SMART INDEX FUTURE & OPTION",
    type: "Future",
    description: "Master the Indices with Strategy, Accuracy & Confidence. This premium pack is designed for traders who want to trade index futures and options with precision.",
    status: "Published",
    theme: ["F&O"],
    horizon: "Positional | Swing",
    volatility: "High",
    riskLevel: "High Risk",
    benchmark: "Nifty 50",
    totalRecommendations: 10,
  });

  await db.insert(strategies).values({
    advisorId: advisor4.id,
    name: "AALGO BREATHS SMART COMMODITY PACK",
    type: "Commodity",
    description: "AALGO BREATHS SMART COMMODITY - Navigate the Commodity Market with Precision & Confidence. Designed for traders who want daily commodity research with strict risk management.",
    status: "Published",
    theme: ["Commodity"],
    horizon: "Swing | Positional",
    volatility: "High",
    riskLevel: "High Risk",
    benchmark: "MCX",
    totalRecommendations: 8,
  });

  await db.insert(strategies).values({
    advisorId: advisor6.id,
    name: "SW Traders' Delight",
    type: "Future",
    description: "F&O Stocks with price & volume breakouts with a time duration which may range from intra day to BTST/STBT (1-2 Days). Focus on momentum-driven setups.",
    status: "Published",
    theme: ["F&O"],
    horizon: "Positional | Intraday",
    volatility: "High",
    riskLevel: "High Risk",
    benchmark: "Nifty 50",
    totalRecommendations: 5,
  });

  await db.insert(strategies).values({
    advisorId: advisor6.id,
    name: "SW Intra-day Nifty Option Trades",
    type: "Future",
    description: "SW Intra-day Nifty Option Trades focuses on identifying intra day momentum in Nifty and taking long trades through CE/PE options with strict risk management.",
    status: "Published",
    theme: ["F&O"],
    horizon: "Intraday",
    volatility: "High",
    riskLevel: "High Risk",
    benchmark: "Nifty 50",
    totalRecommendations: 3,
  });

  await db.insert(strategies).values({
    advisorId: advisor6.id,
    name: "SW Positional Momentum Calls",
    type: "Equity",
    description: "Stocks with breakouts/breakdowns are identified at an early stage along with the price pattern formation combined with volume analysis for medium-term holds.",
    status: "Published",
    theme: ["Equity", "Momentum"],
    horizon: "Positional",
    volatility: "Medium",
    riskLevel: "Medium Risk",
    benchmark: "Nifty 50",
    totalRecommendations: 7,
  });

  await db.insert(strategies).values({
    advisorId: advisor6.id,
    name: "SW Wealth Maximizer",
    type: "Equity",
    description: "Stocks with long term patterns are identified for medium to long term investors. 2-3 stocks are covered in a month with clear entry, target and stop loss levels.",
    status: "Published",
    theme: ["Equity", "Value"],
    horizon: "Positional",
    volatility: "Low",
    riskLevel: "Low Risk",
    benchmark: "Nifty 50",
    totalRecommendations: 4,
  });

  await db.insert(strategies).values({
    advisorId: advisor1.id,
    name: "Growth Basket LT",
    type: "Basket",
    description: "Growth Stock based on high growth potential based on Quantamental Investment Strategies, where stocks are selected based on both quantitative screens and fundamental analysis.",
    status: "Published",
    theme: ["Equity", "Growth"],
    horizon: "Positional",
    volatility: "Low",
    riskLevel: "Low Risk",
    benchmark: "Nifty 50",
    totalRecommendations: 6,
    minimumInvestment: "58000",
  });

  await db.insert(strategies).values({
    advisorId: advisor1.id,
    name: "Daywise",
    type: "Equity",
    description: "DayWise is an intraday strategy providing daily actionable calls with tight risk management for active day traders.",
    status: "Published",
    theme: ["Equity"],
    horizon: "Intraday",
    volatility: "High",
    riskLevel: "High Risk",
    benchmark: "Nifty 50",
    totalRecommendations: 3,
  });

  await db.insert(strategies).values({
    advisorId: advisor1.id,
    name: "WIZ Swing Picks",
    type: "Equity",
    description: "Short to medium-term swing trades identified through a combination of technical breakout patterns and momentum indicators. Typical holding period: 5-15 trading days.",
    status: "Published",
    theme: ["Equity", "SwingTrade"],
    horizon: "Swing",
    volatility: "Medium",
    riskLevel: "Medium Risk",
    benchmark: "Nifty 50",
    totalRecommendations: 14,
    stocksInBuyZone: 4,
  });

  await db.insert(calls).values([
    {
      strategyId: strategy2.id,
      stockName: "Oberoi Realty Limited",
      action: "Buy",
      buyRangeStart: "1896",
      entryPrice: "1849",
      sellPrice: "1392",
      gainPercent: "-2.36",
      status: "Closed",
      callDate: new Date("2025-07-01"),
      exitDate: new Date("2025-08-15"),
    },
    {
      strategyId: strategy2.id,
      stockName: "Mangalam Organics Limited",
      action: "Buy",
      buyRangeStart: "595",
      entryPrice: "579",
      sellPrice: "1860",
      gainPercent: "-3.85",
      status: "Closed",
      callDate: new Date("2025-06-18"),
    },
    {
      strategyId: strategy2.id,
      stockName: "ICICI Prudential Life Insurance Company Limited",
      action: "Buy",
      buyRangeStart: "643",
      entryPrice: "642",
      sellPrice: "634.6",
      gainPercent: "1.17",
      status: "Closed",
      callDate: new Date("2025-06-24"),
    },
    {
      strategyId: strategy2.id,
      stockName: "Hindustan Petroleum Corporation Limited",
      action: "Buy",
      buyRangeStart: "410",
      entryPrice: "386.75",
      gainPercent: "-6.15",
      status: "Active",
      callDate: new Date("2025-08-08"),
    },
    {
      strategyId: strategy5.id,
      stockName: "RELIANCE INDUSTRIES LTD",
      action: "Buy",
      buyRangeStart: "1345",
      entryPrice: "1345",
      targetPrice: "1453",
      gainPercent: "0.00",
      status: "Active",
      callDate: new Date("2026-01-28"),
    },
    {
      strategyId: strategy5.id,
      stockName: "RELIANCE INDUSTRIES LTD",
      action: "Buy",
      buyRangeStart: "1385",
      entryPrice: "1380",
      sellPrice: "1400",
      gainPercent: "4.15",
      status: "Closed",
      callDate: new Date("2026-01-28"),
    },
    {
      strategyId: strategy5.id,
      stockName: "CENTRAL DEPO SER (I) LTD",
      action: "Buy",
      buyRangeStart: "1225",
      entryPrice: "1100",
      targetPrice: "1350",
      gainPercent: "0.00",
      status: "Active",
      callDate: new Date("2026-01-28"),
    },
    {
      strategyId: strategy5.id,
      stockName: "ASTRAL LIMITED",
      action: "Buy",
      buyRangeStart: "1400",
      entryPrice: "1400",
      targetPrice: "1600",
      gainPercent: "-0.28",
      status: "Active",
      callDate: new Date("2026-01-28"),
    },
    {
      strategyId: strategy5.id,
      stockName: "TATA MOTORS LTD",
      action: "Buy",
      buyRangeStart: "750",
      entryPrice: "745",
      targetPrice: "850",
      gainPercent: "0.00",
      status: "Active",
      callDate: new Date("2026-02-01"),
    },
    {
      strategyId: strategy5.id,
      stockName: "INFOSYS LTD",
      action: "Buy",
      buyRangeStart: "1850",
      entryPrice: "1842",
      targetPrice: "2050",
      gainPercent: "2.10",
      status: "Active",
      callDate: new Date("2026-02-01"),
    },
    {
      strategyId: strategy5.id,
      stockName: "HDFC BANK LTD",
      action: "Buy",
      buyRangeStart: "1700",
      entryPrice: "1695",
      targetPrice: "1900",
      gainPercent: "1.50",
      status: "Active",
      callDate: new Date("2026-02-01"),
    },
    {
      strategyId: strategy1.id,
      stockName: "NIFTY 24000 CE",
      action: "Buy",
      buyRangeStart: "120",
      entryPrice: "118",
      targetPrice: "180",
      stopLoss: "95",
      status: "Active",
      callDate: new Date("2026-02-05"),
    },
    {
      strategyId: strategy1.id,
      stockName: "BANKNIFTY 51000 PE",
      action: "Buy",
      buyRangeStart: "200",
      entryPrice: "195",
      targetPrice: "320",
      stopLoss: "160",
      status: "Active",
      callDate: new Date("2026-02-05"),
    },
    {
      strategyId: strategy1.id,
      stockName: "NIFTY 23800 PE",
      action: "Buy",
      buyRangeStart: "95",
      entryPrice: "92",
      sellPrice: "145",
      gainPercent: "57.60",
      status: "Closed",
      callDate: new Date("2026-02-04"),
      exitDate: new Date("2026-02-04"),
    },
  ]);

  await db.insert(plans).values([
    { advisorId: advisor1.id, name: "365D", code: "000013", amount: "9999", durationDays: 365 },
    { advisorId: advisor1.id, name: "183D", code: "000014", amount: "5999", durationDays: 183 },
    { advisorId: advisor1.id, name: "92D", code: "000015", amount: "2999", durationDays: 92 },
    { advisorId: advisor1.id, name: "30D", code: "000016", amount: "999", durationDays: 30 },
    { advisorId: advisor1.id, name: "Weekly", code: "000029", amount: "49", durationDays: 7 },
    { advisorId: advisor1.id, name: "Free Plan", code: "0000", amount: "0", durationDays: 30 },
    { advisorId: advisor1.id, name: "Trial Plan", code: "00061", amount: "1", durationDays: 7 },
    { advisorId: advisor1.id, name: "Half Yearly", code: "00167", amount: "12999", durationDays: 183 },
    { advisorId: advisor2.id, name: "Monthly", code: "F001", amount: "2999", durationDays: 30 },
    { advisorId: advisor2.id, name: "Quarterly", code: "F002", amount: "7999", durationDays: 92 },
    { advisorId: advisor2.id, name: "Yearly", code: "F003", amount: "24999", durationDays: 365 },
    { advisorId: advisor3.id, name: "Monthly", code: "P001", amount: "1999", durationDays: 30 },
    { advisorId: advisor3.id, name: "Quarterly", code: "P002", amount: "4999", durationDays: 92 },
    { advisorId: advisor4.id, name: "Monthly", code: "A001", amount: "3499", durationDays: 30 },
    { advisorId: advisor4.id, name: "Quarterly", code: "A002", amount: "8999", durationDays: 92 },
    { advisorId: advisor5.id, name: "Monthly", code: "J001", amount: "2499", durationDays: 30 },
    { advisorId: advisor6.id, name: "Monthly", code: "S001", amount: "1999", durationDays: 30 },
    { advisorId: advisor6.id, name: "Quarterly", code: "S002", amount: "4999", durationDays: 92 },
  ]);

  await db.insert(content).values([
    { advisorId: advisor1.id, title: "Morning Stock Market Commentary - 15th Feb 2025", type: "MarketUpdate", body: "Market analysis and key levels for the day." },
    { advisorId: advisor1.id, title: "Indigo Paints - Analysis", type: "Learn", body: "Detailed analysis of Indigo Paints stock." },
    { advisorId: advisor1.id, title: "Weekly Forecast 17 - 21 February 2025", type: "MarketUpdate", body: "Weekly market forecast covering Nifty, BankNifty." },
    { advisorId: advisor1.id, title: "Analysis on Market Direction - 20th February 2025", type: "MarketUpdate", body: "Market direction analysis." },
    { advisorId: advisor1.id, title: "Jyothy Labs - Research Report", type: "Learn", body: "Detailed research report on Jyothy Labs." },
    { advisorId: advisor1.id, title: "ICICI Securities", type: "Learn", body: "Analysis of ICICI Securities." },
    { advisorId: advisor1.id, title: "J&B Bank - Buy Call", type: "Learn", body: "Buy call analysis for J&B Bank." },
    { advisorId: advisor1.id, title: "Apply Stop Loss - Protect your trades", type: "Learn", body: "Guide on how to use stop loss effectively." },
    { advisorId: advisor2.id, title: "Quantamental Report Kei Industries", type: "Learn", body: "Quantamental analysis of Kei Industries." },
    { advisorId: advisor4.id, title: "Market Outlook - Weekly Analysis", type: "MarketUpdate", body: "Weekly market outlook covering major indices." },
  ]);

  await db.insert(scores).values([
    { advisorId: advisor1.id, beginningOfMonth: 0, receivedDuring: 0, resolvedDuring: 0, pendingAtEnd: 0, pendencyReasons: "", month: "Feb 2026" },
    { advisorId: advisor2.id, beginningOfMonth: 0, receivedDuring: 3, resolvedDuring: 3, pendingAtEnd: 0, pendencyReasons: "", month: "Feb 2026" },
    { advisorId: advisor4.id, beginningOfMonth: 0, receivedDuring: 1, resolvedDuring: 1, pendingAtEnd: 0, pendencyReasons: "", month: "Feb 2026" },
  ]);

  console.log("Seed data inserted successfully");
}

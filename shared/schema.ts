import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, boolean, timestamp, numeric, pgEnum, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const roleEnum = pgEnum("role", ["advisor", "investor", "admin"]);
export const strategyStatusEnum = pgEnum("strategy_status", ["Draft", "Published"]);
export const callStatusEnum = pgEnum("call_status", ["Active", "Closed"]);
export const strategyTypeEnum = pgEnum("strategy_type", ["Equity", "Basket", "Future", "Commodity", "CommodityFuture", "Option"]);

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  role: roleEnum("role").notNull().default("investor"),
  companyName: text("company_name"),
  overview: text("overview"),
  themes: text("themes").array(),
  logoUrl: text("logo_url"),
  sebiCertUrl: text("sebi_cert_url"),
  sebiRegNumber: text("sebi_reg_number"),
  isRegistered: boolean("is_registered").default(false),
  isApproved: boolean("is_approved").default(false),
  agreementConsent: boolean("agreement_consent").default(false),
  agreementConsentDate: timestamp("agreement_consent_date"),
  activeSince: timestamp("active_since"),
  requireRiskProfiling: boolean("require_risk_profiling").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const strategies = pgTable("strategies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  advisorId: varchar("advisor_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  type: strategyTypeEnum("type").notNull().default("Equity"),
  description: text("description"),
  status: strategyStatusEnum("status").notNull().default("Draft"),
  theme: text("theme").array(),
  managementStyle: text("management_style"),
  horizon: text("horizon"),
  keySectors: text("key_sectors").array(),
  volatility: text("volatility"),
  riskLevel: text("risk_level"),
  benchmark: text("benchmark"),
  minimumInvestment: numeric("minimum_investment"),
  rebalanceFrequency: text("rebalance_frequency"),
  cagr: numeric("cagr"),
  planIds: text("plan_ids").array(),
  totalRecommendations: integer("total_recommendations").default(0),
  stocksInBuyZone: integer("stocks_in_buy_zone").default(0),
  createdAt: timestamp("created_at").defaultNow(),
  modifiedAt: timestamp("modified_at").defaultNow(),
});

export const calls = pgTable("calls", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  strategyId: varchar("strategy_id").notNull().references(() => strategies.id),
  stockName: text("stock_name").notNull(),
  action: text("action").notNull().default("Buy"),
  buyRangeStart: numeric("buy_range_start"),
  buyRangeEnd: numeric("buy_range_end"),
  targetPrice: numeric("target_price"),
  profitGoal: numeric("profit_goal"),
  stopLoss: numeric("stop_loss"),
  rationale: text("rationale"),
  status: callStatusEnum("status").notNull().default("Active"),
  entryPrice: numeric("entry_price"),
  sellPrice: numeric("sell_price"),
  gainPercent: numeric("gain_percent"),
  callDate: timestamp("call_date").defaultNow(),
  exitDate: timestamp("exit_date"),
  duration: integer("duration"),
  durationUnit: text("duration_unit"),
  theme: text("theme"),
  isPublished: boolean("is_published").default(false),
  publishMode: text("publish_mode").default("draft"),
  trailing_sl_enabled: boolean("trailing_sl_enabled").default(false),
  trailing_sl_type: text("trailing_sl_type").default("PERCENTAGE"),
  trailing_sl_value: text("trailing_sl_value"),
  trailing_sl_highest_price: text("trailing_sl_highest_price"),
  trailing_sl_current_sl: text("trailing_sl_current_sl"),
  trailing_sl_triggered_at: text("trailing_sl_triggered_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const positions = pgTable("positions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  strategyId: varchar("strategy_id").notNull().references(() => strategies.id),
  segment: text("segment").notNull().default("Equity"),
  callPut: text("call_put"),
  buySell: text("buy_sell").default("Buy"),
  symbol: text("symbol"),
  expiry: text("expiry"),
  strikePrice: numeric("strike_price"),
  entryPrice: numeric("entry_price"),
  lots: integer("lots"),
  target: numeric("target"),
  stopLoss: numeric("stop_loss"),
  rationale: text("rationale"),
  status: callStatusEnum("status").notNull().default("Active"),
  isPublished: boolean("is_published").default(false),
  publishMode: text("publish_mode").default("draft"),
  trailing_sl_enabled: boolean("trailing_sl_enabled").default(false),
  trailing_sl_type: text("trailing_sl_type").default("PERCENTAGE"),
  trailing_sl_value: text("trailing_sl_value"),
  trailing_sl_highest_price: text("trailing_sl_highest_price"),
  trailing_sl_current_sl: text("trailing_sl_current_sl"),
  trailing_sl_triggered_at: text("trailing_sl_triggered_at"),
  duration: integer("duration"),
  durationUnit: text("duration_unit"),
  theme: text("theme"),
  enableLeg: boolean("enable_leg").default(false),
  usePercentage: boolean("use_percentage").default(false),
  exitPrice: numeric("exit_price"),
  exitDate: timestamp("exit_date"),
  gainPercent: numeric("gain_percent"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const plans = pgTable("plans", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  advisorId: varchar("advisor_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  code: text("code").notNull(),
  amount: numeric("amount").notNull(),
  durationDays: integer("duration_days"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const subscriptions = pgTable("subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  planId: varchar("plan_id").notNull().references(() => plans.id),
  strategyId: varchar("strategy_id").references(() => strategies.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  advisorId: varchar("advisor_id").notNull().references(() => users.id),
  status: text("status").notNull().default("active"),
  ekycDone: boolean("ekyc_done").default(false),
  riskProfiling: boolean("risk_profiling").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const content = pgTable("content", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  advisorId: varchar("advisor_id").notNull().references(() => users.id),
  title: text("title").notNull(),
  type: text("type").notNull().default("MarketUpdate"),
  body: text("body"),
  attachments: text("attachments").array(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const scores = pgTable("scores", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  advisorId: varchar("advisor_id").notNull().references(() => users.id),
  beginningOfMonth: integer("beginning_of_month"),
  receivedDuring: integer("received_during"),
  resolvedDuring: integer("resolved_during"),
  pendingAtEnd: integer("pending_at_end"),
  pendencyReasons: text("pendency_reasons"),
  month: text("month"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const payments = pgTable("payments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  orderId: text("order_id").notNull().unique(),
  userId: varchar("user_id").notNull().references(() => users.id),
  strategyId: varchar("strategy_id").references(() => strategies.id),
  planId: varchar("plan_id").references(() => plans.id),
  advisorId: varchar("advisor_id").references(() => users.id),
  amount: numeric("amount").notNull(),
  currency: text("currency").default("INR"),
  status: text("status").notNull().default("PENDING"),
  cfOrderId: text("cf_order_id"),
  paymentSessionId: text("payment_session_id"),
  paymentMethod: text("payment_method"),
  cfPaymentId: text("cf_payment_id"),
  subscriptionId: varchar("subscription_id").references(() => subscriptions.id),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at").notNull(),
  used: boolean("used").default(false),
  createdAt: timestamp("created_at").defaultNow(),
});

export const watchlist = pgTable("watchlist", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  itemType: text("item_type").notNull(),
  itemId: varchar("item_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const advisorQuestions = pgTable("advisor_questions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  advisorId: varchar("advisor_id").notNull().references(() => users.id),
  userId: varchar("user_id").references(() => users.id),
  name: text("name").notNull(),
  email: text("email").notNull(),
  phone: text("phone"),
  question: text("question").notNull(),
  answer: text("answer"),
  isRead: boolean("is_read").default(false),
  createdAt: timestamp("created_at").defaultNow(),
  answeredAt: timestamp("answered_at"),
});

export const riskProfiles = pgTable("risk_profiles", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  subscriptionId: varchar("subscription_id").notNull().references(() => subscriptions.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  advisorId: varchar("advisor_id").notNull().references(() => users.id),
  fullName: text("full_name"),
  dateOfBirth: text("date_of_birth"),
  pan: text("pan"),
  residentialStatus: text("residential_status"),
  occupation: text("occupation"),
  dependents: integer("dependents"),
  contactDetails: text("contact_details"),
  nomineeDetails: text("nominee_details"),
  annualIncome: text("annual_income"),
  investibleSurplus: text("investible_surplus"),
  totalFinancialAssets: text("total_financial_assets"),
  totalLiabilities: text("total_liabilities"),
  emergencyFund: text("emergency_fund"),
  affordableLoss: text("affordable_loss"),
  investmentObjective: text("investment_objective"),
  timeHorizon: text("time_horizon"),
  cashFlowNeeds: text("cash_flow_needs"),
  cashFlowDetails: text("cash_flow_details"),
  marketKnowledge: text("market_knowledge"),
  investmentExperience: text("investment_experience").array(),
  yearsOfExperience: text("years_of_experience"),
  pastBehavior: text("past_behavior"),
  portfolioFallReaction: text("portfolio_fall_reaction"),
  expectedReturn: text("expected_return"),
  volatilityComfort: integer("volatility_comfort"),
  riskStatement: text("risk_statement"),
  regulatoryConstraints: boolean("regulatory_constraints").default(false),
  regulatoryConstraintsDetails: text("regulatory_constraints_details"),
  liquidityPreference: text("liquidity_preference"),
  taxBracket: text("tax_bracket"),
  marginUsage: boolean("margin_usage").default(false),
  marginUsageDetails: text("margin_usage_details"),
  sourceOfFunds: text("source_of_funds"),
  fundsEncumbered: boolean("funds_encumbered").default(false),
  multiJurisdiction: boolean("multi_jurisdiction").default(false),
  multiJurisdictionDetails: text("multi_jurisdiction_details"),
  declarationConfirm: boolean("declaration_confirm").default(false),
  consentRiskProfile: boolean("consent_risk_profile").default(false),
  consentMarketRisk: boolean("consent_market_risk").default(false),
  consentPeriodicReview: boolean("consent_periodic_review").default(false),
  capacityScore: integer("capacity_score"),
  toleranceScore: integer("tolerance_score"),
  overallScore: integer("overall_score"),
  riskCategory: text("risk_category"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const ekycVerifications = pgTable("ekyc_verifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  subscriptionId: varchar("subscription_id").notNull().references(() => subscriptions.id),
  userId: varchar("user_id").notNull().references(() => users.id),
  advisorId: varchar("advisor_id").notNull().references(() => users.id),
  verificationType: text("verification_type").notNull(),
  status: text("status").notNull().default("pending"),
  aadhaarRefId: text("aadhaar_ref_id"),
  aadhaarTransactionId: text("aadhaar_transaction_id"),
  aadhaarLast4: text("aadhaar_last4"),
  aadhaarName: text("aadhaar_name"),
  aadhaarDob: text("aadhaar_dob"),
  aadhaarGender: text("aadhaar_gender"),
  aadhaarAddress: text("aadhaar_address"),
  aadhaarPhoto: text("aadhaar_photo"),
  panNumber: text("pan_number"),
  panStatus: text("pan_status"),
  panName: text("pan_name"),
  panCategory: text("pan_category"),
  panAadhaarLinked: boolean("pan_aadhaar_linked"),
  rawResponse: jsonb("raw_response"),
  verifiedAt: timestamp("verified_at"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const pushSubscriptions = pgTable("push_subscriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").references(() => users.id),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const notifications = pgTable("notifications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: text("type").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  data: jsonb("data"),
  targetScope: text("target_scope").notNull().default("all_users"),
  strategyId: varchar("strategy_id").references(() => strategies.id),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertEkycVerificationSchema = createInsertSchema(ekycVerifications).omit({ id: true, createdAt: true });
export const insertPushSubscriptionSchema = createInsertSchema(pushSubscriptions).omit({ id: true, createdAt: true });
export const insertNotificationSchema = createInsertSchema(notifications).omit({ id: true, createdAt: true });

export const insertUserSchema = createInsertSchema(users).omit({ id: true, createdAt: true });
export const insertStrategySchema = createInsertSchema(strategies).omit({ id: true, createdAt: true, modifiedAt: true });
export const insertCallSchema = createInsertSchema(calls).omit({ id: true, createdAt: true });
export const insertPositionSchema = createInsertSchema(positions).omit({ id: true, createdAt: true });
export const insertPlanSchema = createInsertSchema(plans).omit({ id: true, createdAt: true });
export const insertSubscriptionSchema = createInsertSchema(subscriptions).omit({ id: true, createdAt: true });
export const insertContentSchema = createInsertSchema(content).omit({ id: true, createdAt: true });
export const insertScoreSchema = createInsertSchema(scores).omit({ id: true, createdAt: true });
export const insertPaymentSchema = createInsertSchema(payments).omit({ id: true, createdAt: true });
export const insertWatchlistSchema = createInsertSchema(watchlist).omit({ id: true, createdAt: true });
export const insertAdvisorQuestionSchema = createInsertSchema(advisorQuestions).omit({ id: true, createdAt: true, answeredAt: true });
export const insertRiskProfileSchema = createInsertSchema(riskProfiles).omit({ id: true, createdAt: true });

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Strategy = typeof strategies.$inferSelect;
export type InsertStrategy = z.infer<typeof insertStrategySchema>;
export type Call = typeof calls.$inferSelect;
export type InsertCall = z.infer<typeof insertCallSchema>;
export type Position = typeof positions.$inferSelect;
export type InsertPosition = z.infer<typeof insertPositionSchema>;
export type Plan = typeof plans.$inferSelect;
export type InsertPlan = z.infer<typeof insertPlanSchema>;
export type Subscription = typeof subscriptions.$inferSelect;
export type InsertSubscription = z.infer<typeof insertSubscriptionSchema>;
export type Content = typeof content.$inferSelect;
export type InsertContent = z.infer<typeof insertContentSchema>;
export type Score = typeof scores.$inferSelect;
export type InsertScore = z.infer<typeof insertScoreSchema>;
export type Payment = typeof payments.$inferSelect;
export type InsertPayment = z.infer<typeof insertPaymentSchema>;
export type Watchlist = typeof watchlist.$inferSelect;
export type InsertWatchlist = z.infer<typeof insertWatchlistSchema>;
export type AdvisorQuestion = typeof advisorQuestions.$inferSelect;
export type InsertAdvisorQuestion = z.infer<typeof insertAdvisorQuestionSchema>;
export type RiskProfile = typeof riskProfiles.$inferSelect;
export type InsertRiskProfile = z.infer<typeof insertRiskProfileSchema>;
export type EkycVerification = typeof ekycVerifications.$inferSelect;
export type InsertEkycVerification = z.infer<typeof insertEkycVerificationSchema>;
export type PushSubscription = typeof pushSubscriptions.$inferSelect;
export type InsertPushSubscription = z.infer<typeof insertPushSubscriptionSchema>;
export type Notification = typeof notifications.$inferSelect;
export type InsertNotification = z.infer<typeof insertNotificationSchema>;

export const esignAgreements = pgTable("esign_agreements", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id),
  advisorId: varchar("advisor_id").notNull().references(() => users.id),
  strategyId: varchar("strategy_id").notNull().references(() => strategies.id),
  planId: varchar("plan_id").notNull().references(() => plans.id),
  subscriptionId: varchar("subscription_id").references(() => subscriptions.id),
  status: text("status").notNull().default("pending"),
  aadhaarRefId: text("aadhaar_ref_id"),
  aadhaarTransactionId: text("aadhaar_transaction_id"),
  aadhaarLast4: text("aadhaar_last4"),
  aadhaarName: text("aadhaar_name"),
  agreementVersion: text("agreement_version").default("1.0"),
  signedAt: timestamp("signed_at"),
  rawResponse: jsonb("raw_response"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertEsignAgreementSchema = createInsertSchema(esignAgreements).omit({ id: true, createdAt: true });
export type EsignAgreement = typeof esignAgreements.$inferSelect;
export type InsertEsignAgreement = z.infer<typeof insertEsignAgreementSchema>;

export const basketRebalances = pgTable("basket_rebalances", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  strategyId: varchar("strategy_id").notNull().references(() => strategies.id),
  version: integer("version").notNull().default(1),
  effectiveDate: timestamp("effective_date").defaultNow(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const basketConstituents = pgTable("basket_constituents", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  strategyId: varchar("strategy_id").notNull().references(() => strategies.id),
  rebalanceId: varchar("rebalance_id").notNull().references(() => basketRebalances.id),
  symbol: text("symbol").notNull(),
  exchange: text("exchange").default("NSE"),
  weightPercent: numeric("weight_percent").notNull(),
  quantity: integer("quantity"),
  priceAtRebalance: numeric("price_at_rebalance"),
  action: text("action").default("Buy"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const basketRationales = pgTable("basket_rationales", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  strategyId: varchar("strategy_id").notNull().references(() => strategies.id),
  title: text("title").notNull(),
  body: text("body"),
  category: text("category").default("general"),
  attachments: text("attachments").array(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const basketNavSnapshots = pgTable("basket_nav_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  strategyId: varchar("strategy_id").notNull().references(() => strategies.id),
  asOfDate: timestamp("as_of_date").notNull(),
  nav: numeric("nav").notNull(),
  totalReturn: numeric("total_return"),
  dailyReturn: numeric("daily_return"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertBasketRebalanceSchema = createInsertSchema(basketRebalances).omit({ id: true, createdAt: true });
export const insertBasketConstituentSchema = createInsertSchema(basketConstituents).omit({ id: true, createdAt: true });
export const insertBasketRationaleSchema = createInsertSchema(basketRationales).omit({ id: true, createdAt: true });
export const insertBasketNavSnapshotSchema = createInsertSchema(basketNavSnapshots).omit({ id: true, createdAt: true });

export type BasketRebalance = typeof basketRebalances.$inferSelect;
export type InsertBasketRebalance = z.infer<typeof insertBasketRebalanceSchema>;
export type BasketConstituent = typeof basketConstituents.$inferSelect;
export type InsertBasketConstituent = z.infer<typeof insertBasketConstituentSchema>;
export type BasketRationale = typeof basketRationales.$inferSelect;
export type InsertBasketRationale = z.infer<typeof insertBasketRationaleSchema>;
export type BasketNavSnapshot = typeof basketNavSnapshots.$inferSelect;
export type InsertBasketNavSnapshot = z.infer<typeof insertBasketNavSnapshotSchema>;

export const appSettings = pgTable("app_settings", {
  key: varchar("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

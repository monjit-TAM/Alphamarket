import { db } from "./db";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  users, strategies, calls, positions, plans, subscriptions, content, scores, passwordResetTokens, payments,
  watchlist, advisorQuestions, riskProfiles, ekycVerifications, pushSubscriptions, notifications, esignAgreements,
  basketRebalances, basketConstituents, basketRationales, basketNavSnapshots,
  type User, type InsertUser,
  type Strategy, type InsertStrategy,
  type Call, type InsertCall,
  type Position, type InsertPosition,
  type Plan, type InsertPlan,
  type Subscription, type InsertSubscription,
  type Content, type InsertContent,
  type Score, type InsertScore,
  type Payment, type InsertPayment,
  type Watchlist, type InsertWatchlist,
  type AdvisorQuestion, type InsertAdvisorQuestion,
  type RiskProfile, type InsertRiskProfile,
  type EkycVerification, type InsertEkycVerification,
  type PushSubscription, type InsertPushSubscription,
  type Notification, type InsertNotification,
  type EsignAgreement, type InsertEsignAgreement,
  type BasketRebalance, type InsertBasketRebalance,
  type BasketConstituent, type InsertBasketConstituent,
  type BasketRationale, type InsertBasketRationale,
  type BasketNavSnapshot, type InsertBasketNavSnapshot,
} from "@shared/schema";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, data: Partial<User>): Promise<User>;
  deleteUser(id: string): Promise<void>;
  getAdvisors(): Promise<User[]>;
  getAdvisorWithDetails(id: string): Promise<any>;
  getAllUsers(): Promise<User[]>;

  getStrategies(advisorId: string): Promise<Strategy[]>;
  getAllStrategies(): Promise<any[]>;
  getPublishedStrategies(): Promise<any[]>;
  getStrategy(id: string): Promise<any>;
  createStrategy(data: InsertStrategy): Promise<Strategy>;
  updateStrategy(id: string, data: Partial<Strategy>): Promise<Strategy>;
  deleteStrategy(id: string): Promise<void>;

  getCalls(strategyId: string): Promise<Call[]>;
  createCall(data: InsertCall): Promise<Call>;
  updateCall(id: string, data: Partial<Call>): Promise<Call>;

  getPositions(strategyId: string): Promise<Position[]>;
  createPosition(data: InsertPosition): Promise<Position>;
  updatePosition(id: string, data: Partial<Position>): Promise<Position>;
  getCall(id: string): Promise<Call | undefined>;
  getPosition(id: string): Promise<Position | undefined>;
  getActiveCallsByStrategy(strategyId: string): Promise<Call[]>;
  getActivePositionsByStrategy(strategyId: string): Promise<Position[]>;
  getUserSubscriptionForStrategy(userId: string, strategyId: string): Promise<Subscription | undefined>;
  getAllActiveCalls(): Promise<(Call & { strategy?: Strategy })[]>;
  getAllActivePositions(): Promise<(Position & { strategy?: Strategy })[]>;

  getPlans(advisorId: string): Promise<Plan[]>;
  getPlan(id: string): Promise<Plan | undefined>;
  createPlan(data: InsertPlan): Promise<Plan>;
  deletePlan(id: string): Promise<void>;

  getSubscriptions(advisorId: string): Promise<Subscription[]>;
  createSubscription(data: InsertSubscription): Promise<Subscription>;

  getContent(advisorId: string): Promise<Content[]>;
  getContentById(id: string): Promise<(Content & { advisor: { id: string; username: string; companyName: string | null; logoUrl: string | null } }) | null>;
  getPublicContentByType(type: string): Promise<(Content & { advisor: { id: string; username: string; companyName: string | null; logoUrl: string | null } })[]>;
  createContent(data: InsertContent): Promise<Content>;
  deleteContent(id: string): Promise<void>;

  getScores(advisorId: string): Promise<Score[]>;
  createScore(data: InsertScore): Promise<Score>;

  createPasswordResetToken(userId: string, token: string, expiresAt: Date): Promise<any>;
  getPasswordResetToken(token: string): Promise<any>;
  markTokenUsed(tokenId: string): Promise<void>;
  updateUserPassword(userId: string, hashedPassword: string): Promise<void>;

  createPayment(data: InsertPayment): Promise<Payment>;
  getPaymentByOrderId(orderId: string): Promise<Payment | undefined>;
  updatePayment(id: string, data: Partial<Payment>): Promise<Payment>;
  getPaymentsByUser(userId: string): Promise<Payment[]>;
  getPaymentsByAdvisor(advisorId: string): Promise<Payment[]>;
  getPaymentsByStrategy(strategyId: string): Promise<Payment[]>;
  updateSubscription(id: string, data: Partial<Subscription>): Promise<Subscription>;
  getSubscriptionsByUserId(userId: string): Promise<Subscription[]>;
  getCallsByStrategy(strategyId: string): Promise<Call[]>;
  getPositionsByStrategy(strategyId: string): Promise<Position[]>;

  addWatchlistItem(data: InsertWatchlist): Promise<Watchlist>;
  removeWatchlistItem(userId: string, itemType: string, itemId: string): Promise<void>;
  getWatchlistByUser(userId: string): Promise<Watchlist[]>;
  isWatchlisted(userId: string, itemType: string, itemId: string): Promise<boolean>;

  createAdvisorQuestion(data: InsertAdvisorQuestion): Promise<AdvisorQuestion>;
  getQuestionsByAdvisor(advisorId: string): Promise<AdvisorQuestion[]>;
  getUnreadQuestionCount(advisorId: string): Promise<number>;
  updateAdvisorQuestion(id: string, data: Partial<AdvisorQuestion>, advisorId?: string): Promise<AdvisorQuestion | null>;

  createRiskProfile(data: InsertRiskProfile): Promise<RiskProfile>;
  getRiskProfileBySubscription(subscriptionId: string): Promise<RiskProfile | undefined>;
  getRiskProfilesByAdvisor(advisorId: string): Promise<RiskProfile[]>;
  getRiskProfileByUser(userId: string, subscriptionId: string): Promise<RiskProfile | undefined>;
  getSubscription(id: string): Promise<Subscription | undefined>;

  createEkycVerification(data: InsertEkycVerification): Promise<EkycVerification>;
  updateEkycVerification(id: string, data: Partial<EkycVerification>): Promise<EkycVerification>;
  getEkycBySubscription(subscriptionId: string): Promise<EkycVerification | undefined>;
  getEkycBySubscriptionAndType(subscriptionId: string, type: string): Promise<EkycVerification | undefined>;
  getEkycByAdvisor(advisorId: string): Promise<EkycVerification[]>;

  createPushSubscription(data: InsertPushSubscription): Promise<PushSubscription>;
  deletePushSubscription(endpoint: string): Promise<void>;
  getPushSubscriptionsByUser(userId: string): Promise<PushSubscription[]>;
  getAllPushSubscriptions(): Promise<PushSubscription[]>;
  getActiveSubscriptionsByStrategy(strategyId: string): Promise<Subscription[]>;
  getWatchlistUserIdsForStrategy(strategyId: string, excludeSubscriberIds: string[]): Promise<string[]>;
  getPushSubscriptionsForUserIds(userIds: string[]): Promise<PushSubscription[]>;
  createNotification(data: InsertNotification): Promise<Notification>;
  getRecentNotifications(limit?: number): Promise<Notification[]>;

  createEsignAgreement(data: InsertEsignAgreement): Promise<EsignAgreement>;
  updateEsignAgreement(id: string, data: Partial<EsignAgreement>): Promise<EsignAgreement>;
  getEsignAgreement(id: string): Promise<EsignAgreement | undefined>;
  getEsignAgreementByUserAndStrategy(userId: string, strategyId: string, planId: string): Promise<EsignAgreement | undefined>;
  getEsignAgreementBySubscription(subscriptionId: string): Promise<EsignAgreement | undefined>;
  getEsignAgreementsByAdvisor(advisorId: string): Promise<EsignAgreement[]>;

  createBasketRebalance(data: InsertBasketRebalance): Promise<BasketRebalance>;
  getBasketRebalances(strategyId: string): Promise<BasketRebalance[]>;
  getLatestBasketRebalance(strategyId: string): Promise<BasketRebalance | undefined>;
  getBasketRebalance(id: string): Promise<BasketRebalance | undefined>;

  createBasketConstituent(data: InsertBasketConstituent): Promise<BasketConstituent>;
  createBasketConstituents(data: InsertBasketConstituent[]): Promise<BasketConstituent[]>;
  getBasketConstituents(rebalanceId: string): Promise<BasketConstituent[]>;
  getBasketConstituentsByStrategy(strategyId: string): Promise<BasketConstituent[]>;
  getAllBasketConstituents(strategyId: string): Promise<BasketConstituent[]>;
  deleteBasketConstituentsByRebalance(rebalanceId: string): Promise<void>;

  createBasketRationale(data: InsertBasketRationale): Promise<BasketRationale>;
  getBasketRationales(strategyId: string): Promise<BasketRationale[]>;
  deleteBasketRationale(id: string): Promise<void>;

  createBasketNavSnapshot(data: InsertBasketNavSnapshot): Promise<BasketNavSnapshot>;
  getBasketNavSnapshots(strategyId: string): Promise<BasketNavSnapshot[]>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(data: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(data).returning();
    return user;
  }

  async updateUser(id: string, data: Partial<User>): Promise<User> {
    const [user] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return user;
  }

  async deleteUser(id: string): Promise<void> {
    const userStrats = await db.select().from(strategies).where(eq(strategies.advisorId, id));
    for (const s of userStrats) {
      await db.delete(calls).where(eq(calls.strategyId, s.id));
      await db.delete(positions).where(eq(positions.strategyId, s.id));
    }
    await db.delete(strategies).where(eq(strategies.advisorId, id));
    await db.delete(plans).where(eq(plans.advisorId, id));
    await db.delete(content).where(eq(content.advisorId, id));
    await db.delete(scores).where(eq(scores.advisorId, id));
    await db.delete(subscriptions).where(eq(subscriptions.advisorId, id));
    await db.delete(subscriptions).where(eq(subscriptions.userId, id));
    await db.delete(users).where(eq(users.id, id));
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users).orderBy(desc(users.createdAt));
  }

  async getAdvisors(): Promise<User[]> {
    return db.select().from(users).where(and(eq(users.role, "advisor"), eq(users.isApproved, true))).orderBy(desc(users.createdAt));
  }

  async getAdvisorWithDetails(id: string): Promise<any> {
    const [advisor] = await db.select().from(users).where(eq(users.id, id));
    if (!advisor) return null;
    const strats = await db.select().from(strategies).where(eq(strategies.advisorId, id));
    const conts = await db.select().from(content).where(eq(content.advisorId, id)).orderBy(desc(content.createdAt));
    const scrs = await db.select().from(scores).where(eq(scores.advisorId, id)).orderBy(desc(scores.createdAt));
    return { ...advisor, strategies: strats, contents: conts, scores: scrs };
  }

  async getStrategies(advisorId: string): Promise<Strategy[]> {
    return db.select().from(strategies).where(eq(strategies.advisorId, advisorId)).orderBy(desc(strategies.createdAt));
  }

  async getAllStrategies(): Promise<any[]> {
    const strats = await db.select().from(strategies).orderBy(desc(strategies.createdAt));
    const result = [];
    for (const s of strats) {
      const [advisor] = await db.select().from(users).where(eq(users.id, s.advisorId));
      const { password: _, ...safeAdvisor } = advisor || {} as any;
      result.push({ ...s, advisor: safeAdvisor });
    }
    return result;
  }

  async getPublishedStrategies(): Promise<any[]> {
    const strats = await db.select().from(strategies).where(eq(strategies.status, "Published")).orderBy(desc(strategies.createdAt));
    const result = [];
    for (const s of strats) {
      const [advisor] = await db.select().from(users).where(eq(users.id, s.advisorId));
      if (!advisor || !advisor.isApproved) continue;
      const stratCalls = await db.select().from(calls).where(eq(calls.strategyId, s.id));
      const stratPositions = await db.select().from(positions).where(eq(positions.strategyId, s.id));
      const liveCalls = stratCalls.filter((c) => c.status === "Active").length + stratPositions.filter((p) => p.status === "Active").length;
      const { password: _, ...safeAdvisor } = advisor || {} as any;
      result.push({ ...s, advisor: safeAdvisor, liveCalls });
    }
    return result;
  }

  async getStrategy(id: string): Promise<any> {
    const [s] = await db.select().from(strategies).where(eq(strategies.id, id));
    if (!s) return null;
    const [advisor] = await db.select().from(users).where(eq(users.id, s.advisorId));
    return { ...s, advisor };
  }

  async createStrategy(data: InsertStrategy): Promise<Strategy> {
    const [s] = await db.insert(strategies).values(data).returning();
    return s;
  }

  async updateStrategy(id: string, data: Partial<Strategy>): Promise<Strategy> {
    const [s] = await db.update(strategies).set({ ...data, modifiedAt: new Date() }).where(eq(strategies.id, id)).returning();
    return s;
  }

  async deleteStrategy(id: string): Promise<void> {
    await db.delete(calls).where(eq(calls.strategyId, id));
    await db.delete(positions).where(eq(positions.strategyId, id));
    await db.delete(strategies).where(eq(strategies.id, id));
  }

  async getCalls(strategyId: string): Promise<Call[]> {
    return db.select().from(calls).where(eq(calls.strategyId, strategyId)).orderBy(desc(calls.createdAt));
  }

  async createCall(data: InsertCall): Promise<Call> {
    const [c] = await db.insert(calls).values(data).returning();
    return c;
  }

  async updateCall(id: string, data: Partial<Call>): Promise<Call> {
    const [c] = await db.update(calls).set(data).where(eq(calls.id, id)).returning();
    return c;
  }

  async getPositions(strategyId: string): Promise<Position[]> {
    return db.select().from(positions).where(eq(positions.strategyId, strategyId)).orderBy(desc(positions.createdAt));
  }

  async createPosition(data: InsertPosition): Promise<Position> {
    const [p] = await db.insert(positions).values(data).returning();
    return p;
  }

  async updatePosition(id: string, data: Partial<Position>): Promise<Position> {
    const [p] = await db.update(positions).set(data).where(eq(positions.id, id)).returning();
    return p;
  }

  async getCall(id: string): Promise<Call | undefined> {
    const [c] = await db.select().from(calls).where(eq(calls.id, id));
    return c;
  }

  async getPosition(id: string): Promise<Position | undefined> {
    const [p] = await db.select().from(positions).where(eq(positions.id, id));
    return p;
  }

  async getActiveCallsByStrategy(strategyId: string): Promise<Call[]> {
    return db.select().from(calls).where(and(eq(calls.strategyId, strategyId), eq(calls.status, "Active"))).orderBy(desc(calls.createdAt));
  }

  async getActivePositionsByStrategy(strategyId: string): Promise<Position[]> {
    return db.select().from(positions).where(and(eq(positions.strategyId, strategyId), eq(positions.status, "Active"))).orderBy(desc(positions.createdAt));
  }

  async getUserSubscriptionForStrategy(userId: string, strategyId: string): Promise<Subscription | undefined> {
    const [sub] = await db.select().from(subscriptions).where(
      and(eq(subscriptions.userId, userId), eq(subscriptions.strategyId, strategyId), eq(subscriptions.status, "active"))
    );
    return sub;
  }

  async getAllActiveCalls(): Promise<(Call & { strategy?: Strategy })[]> {
    const result = await db.select({
      call: calls,
      strategy: strategies,
    }).from(calls)
      .leftJoin(strategies, eq(calls.strategyId, strategies.id))
      .where(eq(calls.status, "Active"));
    return result.map(r => ({ ...r.call, strategy: r.strategy || undefined }));
  }

  async getAllActivePositions(): Promise<(Position & { strategy?: Strategy })[]> {
    const result = await db.select({
      position: positions,
      strategy: strategies,
    }).from(positions)
      .leftJoin(strategies, eq(positions.strategyId, strategies.id))
      .where(eq(positions.status, "Active"));
    return result.map(r => ({ ...r.position, strategy: r.strategy || undefined }));
  }

  async getPlans(advisorId: string): Promise<Plan[]> {
    return db.select().from(plans).where(eq(plans.advisorId, advisorId)).orderBy(desc(plans.createdAt));
  }

  async getPlan(id: string): Promise<Plan | undefined> {
    const [p] = await db.select().from(plans).where(eq(plans.id, id));
    return p;
  }

  async createPlan(data: InsertPlan): Promise<Plan> {
    const [p] = await db.insert(plans).values(data).returning();
    return p;
  }

  async deletePlan(id: string): Promise<void> {
    await db.delete(plans).where(eq(plans.id, id));
  }

  async getSubscriptions(advisorId: string): Promise<Subscription[]> {
    return db.select().from(subscriptions).where(eq(subscriptions.advisorId, advisorId)).orderBy(desc(subscriptions.createdAt));
  }

  async createSubscription(data: InsertSubscription): Promise<Subscription> {
    const [s] = await db.insert(subscriptions).values(data).returning();
    return s;
  }

  async getContent(advisorId: string): Promise<Content[]> {
    return db.select().from(content).where(eq(content.advisorId, advisorId)).orderBy(desc(content.createdAt));
  }

  async getContentById(id: string) {
    const rows = await db
      .select({
        id: content.id,
        advisorId: content.advisorId,
        title: content.title,
        type: content.type,
        body: content.body,
        attachments: content.attachments,
        createdAt: content.createdAt,
        advisorUsername: users.username,
        advisorCompanyName: users.companyName,
        advisorLogoUrl: users.logoUrl,
      })
      .from(content)
      .innerJoin(users, eq(content.advisorId, users.id))
      .where(eq(content.id, id));

    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      id: r.id,
      advisorId: r.advisorId,
      title: r.title,
      type: r.type,
      body: r.body,
      attachments: r.attachments,
      createdAt: r.createdAt,
      advisor: {
        id: r.advisorId,
        username: r.advisorUsername,
        companyName: r.advisorCompanyName,
        logoUrl: r.advisorLogoUrl,
      },
    };
  }

  async getPublicContentByType(type: string) {
    const rows = await db
      .select({
        id: content.id,
        advisorId: content.advisorId,
        title: content.title,
        type: content.type,
        body: content.body,
        attachments: content.attachments,
        createdAt: content.createdAt,
        advisorUsername: users.username,
        advisorCompanyName: users.companyName,
        advisorLogoUrl: users.logoUrl,
      })
      .from(content)
      .innerJoin(users, eq(content.advisorId, users.id))
      .where(and(eq(content.type, type), eq(users.role, "advisor"), eq(users.isApproved, true)))
      .orderBy(desc(content.createdAt));

    return rows.map((r) => ({
      id: r.id,
      advisorId: r.advisorId,
      title: r.title,
      type: r.type,
      body: r.body,
      attachments: r.attachments,
      createdAt: r.createdAt,
      advisor: {
        id: r.advisorId,
        username: r.advisorUsername,
        companyName: r.advisorCompanyName,
        logoUrl: r.advisorLogoUrl,
      },
    }));
  }

  async createContent(data: InsertContent): Promise<Content> {
    const [c] = await db.insert(content).values(data).returning();
    return c;
  }

  async deleteContent(id: string): Promise<void> {
    await db.delete(content).where(eq(content.id, id));
  }

  async getScores(advisorId: string): Promise<Score[]> {
    return db.select().from(scores).where(eq(scores.advisorId, advisorId)).orderBy(desc(scores.createdAt));
  }

  async createScore(data: InsertScore): Promise<Score> {
    const [s] = await db.insert(scores).values(data).returning();
    return s;
  }

  async createPasswordResetToken(userId: string, token: string, expiresAt: Date): Promise<any> {
    const [t] = await db.insert(passwordResetTokens).values({ userId, token, expiresAt }).returning();
    return t;
  }

  async getPasswordResetToken(token: string): Promise<any> {
    const [t] = await db.select().from(passwordResetTokens).where(eq(passwordResetTokens.token, token));
    return t || null;
  }

  async markTokenUsed(tokenId: string): Promise<void> {
    await db.update(passwordResetTokens).set({ used: true }).where(eq(passwordResetTokens.id, tokenId));
  }

  async updateUserPassword(userId: string, hashedPassword: string): Promise<void> {
    await db.update(users).set({ password: hashedPassword }).where(eq(users.id, userId));
  }

  async createPayment(data: InsertPayment): Promise<Payment> {
    const [p] = await db.insert(payments).values(data).returning();
    return p;
  }

  async getPaymentByOrderId(orderId: string): Promise<Payment | undefined> {
    const [p] = await db.select().from(payments).where(eq(payments.orderId, orderId));
    return p;
  }

  async updatePayment(id: string, data: Partial<Payment>): Promise<Payment> {
    const [p] = await db.update(payments).set(data).where(eq(payments.id, id)).returning();
    return p;
  }

  async getPaymentsByUser(userId: string): Promise<Payment[]> {
    return db.select().from(payments).where(eq(payments.userId, userId)).orderBy(desc(payments.createdAt));
  }

  async getPaymentsByAdvisor(advisorId: string): Promise<Payment[]> {
    return db.select().from(payments).where(eq(payments.advisorId, advisorId)).orderBy(desc(payments.createdAt));
  }

  async getPaymentsByStrategy(strategyId: string): Promise<Payment[]> {
    return db.select().from(payments).where(eq(payments.strategyId, strategyId)).orderBy(desc(payments.createdAt));
  }

  async updateSubscription(id: string, data: Partial<Subscription>): Promise<Subscription> {
    const [s] = await db.update(subscriptions).set(data).where(eq(subscriptions.id, id)).returning();
    return s;
  }

  async getSubscriptionsByUserId(userId: string): Promise<Subscription[]> {
    return db.select().from(subscriptions).where(eq(subscriptions.userId, userId)).orderBy(desc(subscriptions.createdAt));
  }

  async getCallsByStrategy(strategyId: string): Promise<Call[]> {
    return db.select().from(calls).where(eq(calls.strategyId, strategyId)).orderBy(desc(calls.createdAt));
  }

  async getPositionsByStrategy(strategyId: string): Promise<Position[]> {
    return db.select().from(positions).where(eq(positions.strategyId, strategyId)).orderBy(desc(positions.createdAt));
  }

  async addWatchlistItem(data: InsertWatchlist): Promise<Watchlist> {
    const existing = await db.select().from(watchlist).where(
      and(eq(watchlist.userId, data.userId), eq(watchlist.itemType, data.itemType), eq(watchlist.itemId, data.itemId))
    );
    if (existing.length > 0) return existing[0];
    const [w] = await db.insert(watchlist).values(data).returning();
    return w;
  }

  async removeWatchlistItem(userId: string, itemType: string, itemId: string): Promise<void> {
    await db.delete(watchlist).where(
      and(eq(watchlist.userId, userId), eq(watchlist.itemType, itemType), eq(watchlist.itemId, itemId))
    );
  }

  async getWatchlistByUser(userId: string): Promise<Watchlist[]> {
    return db.select().from(watchlist).where(eq(watchlist.userId, userId)).orderBy(desc(watchlist.createdAt));
  }

  async isWatchlisted(userId: string, itemType: string, itemId: string): Promise<boolean> {
    const rows = await db.select().from(watchlist).where(
      and(eq(watchlist.userId, userId), eq(watchlist.itemType, itemType), eq(watchlist.itemId, itemId))
    );
    return rows.length > 0;
  }

  async createAdvisorQuestion(data: InsertAdvisorQuestion): Promise<AdvisorQuestion> {
    const [q] = await db.insert(advisorQuestions).values(data).returning();
    return q;
  }

  async getQuestionsByAdvisor(advisorId: string): Promise<AdvisorQuestion[]> {
    return db.select().from(advisorQuestions).where(eq(advisorQuestions.advisorId, advisorId)).orderBy(desc(advisorQuestions.createdAt));
  }

  async getUnreadQuestionCount(advisorId: string): Promise<number> {
    const result = await db.select({ count: sql<number>`count(*)` }).from(advisorQuestions).where(
      and(eq(advisorQuestions.advisorId, advisorId), eq(advisorQuestions.isRead, false))
    );
    return Number(result[0]?.count || 0);
  }

  async updateAdvisorQuestion(id: string, data: Partial<AdvisorQuestion>, advisorId?: string): Promise<AdvisorQuestion | null> {
    const conditions = [eq(advisorQuestions.id, id)];
    if (advisorId) conditions.push(eq(advisorQuestions.advisorId, advisorId));
    const [q] = await db.update(advisorQuestions).set(data).where(and(...conditions)).returning();
    return q || null;
  }

  async createRiskProfile(data: InsertRiskProfile): Promise<RiskProfile> {
    const [rp] = await db.insert(riskProfiles).values(data).returning();
    return rp;
  }

  async getRiskProfileBySubscription(subscriptionId: string): Promise<RiskProfile | undefined> {
    const [rp] = await db.select().from(riskProfiles).where(eq(riskProfiles.subscriptionId, subscriptionId));
    return rp;
  }

  async getRiskProfilesByAdvisor(advisorId: string): Promise<RiskProfile[]> {
    return db.select().from(riskProfiles).where(eq(riskProfiles.advisorId, advisorId)).orderBy(desc(riskProfiles.createdAt));
  }

  async getRiskProfileByUser(userId: string, subscriptionId: string): Promise<RiskProfile | undefined> {
    const [rp] = await db.select().from(riskProfiles).where(
      and(eq(riskProfiles.userId, userId), eq(riskProfiles.subscriptionId, subscriptionId))
    );
    return rp;
  }

  async getSubscription(id: string): Promise<Subscription | undefined> {
    const [s] = await db.select().from(subscriptions).where(eq(subscriptions.id, id));
    return s;
  }

  async createPushSubscription(data: InsertPushSubscription): Promise<PushSubscription> {
    const existing = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, data.endpoint));
    if (existing.length > 0) {
      const [updated] = await db.update(pushSubscriptions).set({ userId: data.userId, p256dh: data.p256dh, auth: data.auth }).where(eq(pushSubscriptions.endpoint, data.endpoint)).returning();
      return updated;
    }
    const [ps] = await db.insert(pushSubscriptions).values(data).returning();
    return ps;
  }

  async deletePushSubscription(endpoint: string): Promise<void> {
    await db.delete(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint));
  }

  async getPushSubscriptionsByUser(userId: string): Promise<PushSubscription[]> {
    return db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId));
  }

  async getAllPushSubscriptions(): Promise<PushSubscription[]> {
    return db.select().from(pushSubscriptions);
  }

  async getActiveSubscriptionsByStrategy(strategyId: string): Promise<Subscription[]> {
    return db.select().from(subscriptions).where(
      and(eq(subscriptions.strategyId, strategyId), eq(subscriptions.status, "active"))
    );
  }

  async getWatchlistUserIdsForStrategy(strategyId: string, excludeSubscriberIds: string[]): Promise<string[]> {
    const rows = await db.select({ userId: watchlist.userId }).from(watchlist).where(
      and(eq(watchlist.itemType, "strategy"), eq(watchlist.itemId, strategyId))
    );
    const excludeSet = new Set(excludeSubscriberIds);
    return Array.from(new Set(rows.map(r => r.userId).filter(uid => !excludeSet.has(uid))));
  }

  async getPushSubscriptionsForUserIds(userIds: string[]): Promise<PushSubscription[]> {
    if (userIds.length === 0) return [];
    const results: PushSubscription[] = [];
    for (const uid of userIds) {
      const subs = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, uid));
      results.push(...subs);
    }
    return results;
  }

  async createNotification(data: InsertNotification): Promise<Notification> {
    const [n] = await db.insert(notifications).values(data).returning();
    return n;
  }

  async getRecentNotifications(limit = 50): Promise<Notification[]> {
    return db.select().from(notifications).orderBy(desc(notifications.createdAt)).limit(limit);
  }

  async createEkycVerification(data: InsertEkycVerification): Promise<EkycVerification> {
    const [v] = await db.insert(ekycVerifications).values(data).returning();
    return v;
  }

  async updateEkycVerification(id: string, data: Partial<EkycVerification>): Promise<EkycVerification> {
    const [v] = await db.update(ekycVerifications).set(data).where(eq(ekycVerifications.id, id)).returning();
    return v;
  }

  async getEkycBySubscription(subscriptionId: string): Promise<EkycVerification | undefined> {
    const results = await db.select().from(ekycVerifications)
      .where(eq(ekycVerifications.subscriptionId, subscriptionId))
      .orderBy(desc(ekycVerifications.createdAt));
    return results[0];
  }

  async getEkycBySubscriptionAndType(subscriptionId: string, type: string): Promise<EkycVerification | undefined> {
    const results = await db.select().from(ekycVerifications)
      .where(and(
        eq(ekycVerifications.subscriptionId, subscriptionId),
        eq(ekycVerifications.verificationType, type)
      ));
    return results[0];
  }

  async getEkycByAdvisor(advisorId: string): Promise<EkycVerification[]> {
    return db.select().from(ekycVerifications)
      .where(eq(ekycVerifications.advisorId, advisorId))
      .orderBy(desc(ekycVerifications.createdAt));
  }

  async createEsignAgreement(data: InsertEsignAgreement): Promise<EsignAgreement> {
    const [a] = await db.insert(esignAgreements).values(data).returning();
    return a;
  }

  async updateEsignAgreement(id: string, data: Partial<EsignAgreement>): Promise<EsignAgreement> {
    const [a] = await db.update(esignAgreements).set(data).where(eq(esignAgreements.id, id)).returning();
    return a;
  }

  async getEsignAgreement(id: string): Promise<EsignAgreement | undefined> {
    const [a] = await db.select().from(esignAgreements).where(eq(esignAgreements.id, id));
    return a;
  }

  async getEsignAgreementByUserAndStrategy(userId: string, strategyId: string, planId: string): Promise<EsignAgreement | undefined> {
    const results = await db.select().from(esignAgreements)
      .where(and(
        eq(esignAgreements.userId, userId),
        eq(esignAgreements.strategyId, strategyId),
        eq(esignAgreements.planId, planId),
        eq(esignAgreements.status, "signed")
      ))
      .orderBy(desc(esignAgreements.signedAt))
      .limit(1);
    return results[0];
  }

  async getEsignAgreementBySubscription(subscriptionId: string): Promise<EsignAgreement | undefined> {
    const [a] = await db.select().from(esignAgreements)
      .where(eq(esignAgreements.subscriptionId, subscriptionId));
    return a;
  }

  async getEsignAgreementsByAdvisor(advisorId: string): Promise<EsignAgreement[]> {
    return db.select().from(esignAgreements)
      .where(eq(esignAgreements.advisorId, advisorId))
      .orderBy(desc(esignAgreements.createdAt));
  }

  async createBasketRebalance(data: InsertBasketRebalance): Promise<BasketRebalance> {
    const [r] = await db.insert(basketRebalances).values(data).returning();
    return r;
  }

  async getBasketRebalances(strategyId: string): Promise<BasketRebalance[]> {
    return db.select().from(basketRebalances)
      .where(eq(basketRebalances.strategyId, strategyId))
      .orderBy(desc(basketRebalances.version));
  }

  async getLatestBasketRebalance(strategyId: string): Promise<BasketRebalance | undefined> {
    const [r] = await db.select().from(basketRebalances)
      .where(eq(basketRebalances.strategyId, strategyId))
      .orderBy(desc(basketRebalances.version))
      .limit(1);
    return r;
  }

  async getBasketRebalance(id: string): Promise<BasketRebalance | undefined> {
    const [r] = await db.select().from(basketRebalances).where(eq(basketRebalances.id, id));
    return r;
  }

  async createBasketConstituent(data: InsertBasketConstituent): Promise<BasketConstituent> {
    const [c] = await db.insert(basketConstituents).values(data).returning();
    return c;
  }

  async createBasketConstituents(data: InsertBasketConstituent[]): Promise<BasketConstituent[]> {
    if (data.length === 0) return [];
    return db.insert(basketConstituents).values(data).returning();
  }

  async getBasketConstituents(rebalanceId: string): Promise<BasketConstituent[]> {
    return db.select().from(basketConstituents)
      .where(eq(basketConstituents.rebalanceId, rebalanceId))
      .orderBy(desc(basketConstituents.weightPercent));
  }

  async getBasketConstituentsByStrategy(strategyId: string): Promise<BasketConstituent[]> {
    const latest = await this.getLatestBasketRebalance(strategyId);
    if (!latest) return [];
    return this.getBasketConstituents(latest.id);
  }

  async getAllBasketConstituents(strategyId: string): Promise<BasketConstituent[]> {
    return db.select().from(basketConstituents)
      .where(eq(basketConstituents.strategyId, strategyId))
      .orderBy(desc(basketConstituents.createdAt));
  }

  async deleteBasketConstituentsByRebalance(rebalanceId: string): Promise<void> {
    await db.delete(basketConstituents).where(eq(basketConstituents.rebalanceId, rebalanceId));
  }

  async createBasketRationale(data: InsertBasketRationale): Promise<BasketRationale> {
    const [r] = await db.insert(basketRationales).values(data).returning();
    return r;
  }

  async getBasketRationales(strategyId: string): Promise<BasketRationale[]> {
    return db.select().from(basketRationales)
      .where(eq(basketRationales.strategyId, strategyId))
      .orderBy(desc(basketRationales.createdAt));
  }

  async deleteBasketRationale(id: string): Promise<void> {
    await db.delete(basketRationales).where(eq(basketRationales.id, id));
  }

  async createBasketNavSnapshot(data: InsertBasketNavSnapshot): Promise<BasketNavSnapshot> {
    const [s] = await db.insert(basketNavSnapshots).values(data).returning();
    return s;
  }

  async getBasketNavSnapshots(strategyId: string): Promise<BasketNavSnapshot[]> {
    return db.select().from(basketNavSnapshots)
      .where(eq(basketNavSnapshots.strategyId, strategyId))
      .orderBy(basketNavSnapshots.asOfDate);
  }
}

export const storage = new DatabaseStorage();

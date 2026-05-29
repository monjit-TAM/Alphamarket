[1mdiff --git a/server/webhook-format-a.ts b/server/webhook-format-a.ts[m
[1mindex df00e0c..6dfbb95 100644[m
[1m--- a/server/webhook-format-a.ts[m
[1m+++ b/server/webhook-format-a.ts[m
[36m@@ -327,6 +327,7 @@[m [mfunction normalize(data: Record<string, any>): any {[m
 export async function buildFormatAPayload([m
   event: string,[m
   data: Record<string, any>,[m
[32m+[m[32m  brokerName?: string,[m
 ): Promise<any> {[m
   const strategyId = data.strategyId || data.strategy_id;[m
   if (!strategyId) throw new Error("strategyId missing in event data");[m
[36m@@ -337,10 +338,17 @@[m [mexport async function buildFormatAPayload([m
   const isFno = data.type === "FnO" || data.segment === "Option" || data.segment === "Future" || data.segment === "Commodity";[m
   const n = normalize(data);[m
 [m
[31m-  if (isFno) {[m
[31m-    return buildFno(event, n, loaded.strategy, loaded.advisor);[m
[32m+[m[32m  const payload = isFno[m
[32m+[m[32m    ? await buildFno(event, n, loaded.strategy, loaded.advisor)[m
[32m+[m[32m    : await buildEquity(event, n, loaded.strategy, loaded.advisor);[m
[32m+[m
[32m+[m[32m  // Add duration field for Dreamstreet only (integer, number of days)[m
[32m+[m[32m  if (brokerName && brokerName.toLowerCase().includes("dreamstreet") && payload?.data) {[m
[32m+[m[32m    payload.data.duration = n.duration || null;[m
[32m+[m[32m    payload.data.durationUnit = "days";[m
   }[m
[31m-  return buildEquity(event, n, loaded.strategy, loaded.advisor);[m
[32m+[m
[32m+[m[32m  return payload;[m
 }[m
 [m
 export function inferSegment(event: string, data: Record<string, any>): string | null {[m

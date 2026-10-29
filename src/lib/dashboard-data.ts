import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { ActiveMembership } from "@/lib/auth-context";
import { hasPermission } from "@/lib/permissions";
import { getOrderBranchId } from "@/lib/order-access";

export type SalesPoint = { time: string; sales: number };
export type DashboardOrder = { id: string; orderNumber: string; total: string; status: string; paymentMethod: string; createdAt: string };
type Bucket = { bucket: string; total: string; count: string };
const dayMs = 86400000;
export function dashboardPeriod(now = new Date()) {
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const start = new Date(day + "T00:00:00+03:00");
  return { day, start, end: new Date(start.getTime() + dayMs), since: new Date(start.getTime() - 29 * dayMs) };
}
export function dashboardMetrics(rows: Bucket[], now = new Date()) {
  const { day, start } = dashboardPeriod(now);
  const dateAt = (offset: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Istanbul", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(start.getTime() + offset * dayMs));
  const sum = (date: string) => rows.filter(r => r.bucket.startsWith(date)).reduce((a, r) => ({ total: a.total.plus(r.total), count: a.count + Number(r.count) }), { total: new Prisma.Decimal(0), count: 0 });
  const today = sum(day), yesterday = sum(dateAt(-1));
  const average = (value: typeof today) => value.count ? value.total.div(value.count).toDecimalPlaces(2) : new Prisma.Decimal(0);
  const change = (value: Prisma.Decimal, before: Prisma.Decimal) => before.eq(0) ? undefined : value.minus(before).div(before).mul(100).toDecimalPlaces(1).toNumber();
  const days = (count: number) => Array.from({ length: count }, (_, i) => { const date = dateAt(i - count + 1); return { time: date.slice(8) + "." + date.slice(5, 7), sales: sum(date).total.toNumber() }; });
  return {
    total: today.total.toFixed(2), count: today.count, average: average(today).toFixed(2),
    changes: { total: change(today.total, yesterday.total), count: change(new Prisma.Decimal(today.count), new Prisma.Decimal(yesterday.count)), average: change(average(today), average(yesterday)) },
    charts: {
      today: Array.from({ length: 24 }, (_, hour) => { const time = String(hour).padStart(2, "0"); const row = rows.find(r => r.bucket === `${day} ${time}`); return { time: time + ":00", sales: Number(row?.total ?? 0) }; }),
      week: days(7), month: days(30),
    },
  };
}

export async function loadDashboard(actor: ActiveMembership) {
  if (!hasPermission(actor.role, "finance.manage")) throw new Error("DASHBOARD_ACCESS_DENIED");
  const branchId = await getOrderBranchId(actor.organizationId), now = new Date(), period = dashboardPeriod(now);
  const empty = { ...dashboardMetrics([], now), orders: [] as DashboardOrder[], branchId };
  if (!branchId) return empty;
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Bucket[]>`
      SELECT to_char("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Istanbul', 'YYYY-MM-DD HH24') AS bucket,
        SUM(total)::text AS total, COUNT(*)::text AS count
      FROM "Order" WHERE "organizationId"=${actor.organizationId} AND "branchId"=${branchId}
        AND status='COMPLETED' AND "createdAt">=${period.since} AND "createdAt"<${period.end}
      GROUP BY 1 ORDER BY 1
    `;
    const orders = await tx.order.findMany({ where: { organizationId: actor.organizationId, branchId },
      select: { id: true, orderNumber: true, total: true, status: true, paymentMethod: true, createdAt: true },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 5 });
    return { ...dashboardMetrics(rows, now), branchId, orders: orders.map(order => ({ ...order, total: order.total.toFixed(2), createdAt: order.createdAt.toISOString() })) };
  }, { isolationLevel: "RepeatableRead", timeout: 10000 });
}

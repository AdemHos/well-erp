import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { branchScope, branchIdScope, hasAllBranches, allowedBranchIds, hasPermission } from "@/lib/permissions";
import { CashError } from "@/lib/cash-management";
import { dateInput, pagination, text } from "@/lib/current-accounts";
import { customerActor, customerError, customerRecord, type CustomerContext } from "@/lib/customer-service";
import { paymentTotals } from "@/lib/expenses";

const profileSelect = { organizationId: true, id: true, type: true, code: true, name: true, phone: true, email: true, address: true, city: true, district: true, taxOffice: true, taxNumber: true, notes: true, isActive: true, currentAccountId: true, version: true, createdAt: true, updatedAt: true } satisfies Prisma.CustomerSelect;
export async function listCustomers(request: NextRequest) {
  try {
    const actor = await customerActor("customers.read"), params = request.nextUrl.searchParams;
    const { page, limit, skip } = pagination(params), q = text(params.get("q"), "arama", 200), type = params.get("type"), active = params.get("active") ?? "all";
    if (type && !["INDIVIDUAL", "CORPORATE"].includes(type)) throw new CashError("Geçersiz müşteri türü.");
    if (!["true", "false", "all"].includes(active)) throw new CashError("Geçersiz aktiflik filtresi.");
    const where: Prisma.CustomerWhereInput = { organizationId: actor.organizationId, ...(type ? { type: type as "INDIVIDUAL" | "CORPORATE" } : {}), ...(active !== "all" ? { isActive: active === "true" } : {}), ...(q ? { OR: ["name", "code", "phone", "email"].map(field => ({ [field]: { contains: q, mode: "insensitive" } })) } : {}) };
    const result = await prisma.$transaction(async tx => {
      const customers = await tx.customer.findMany({ where, select: { ...profileSelect, currentAccountId: hasPermission(actor.role, "finance.manage") }, orderBy: [{ name: "asc" }, { id: "asc" }], skip, take: limit });
      const count = await tx.customer.count({ where });
      const groups = await tx.customer.groupBy({ by: ["type", "isActive"], where: { organizationId: actor.organizationId }, _count: { _all: true } });
      const countFor = (filter: (row: typeof groups[number]) => boolean) => groups.filter(filter).reduce((n, row) => n + row._count._all, 0);
      return { organizationId: actor.organizationId, customers, permissions: { manage: hasPermission(actor.role, "customers.manage"), finance: hasPermission(actor.role, "finance.manage") }, summary: { total: countFor(() => true), active: countFor(r => r.isActive), individual: countFor(r => r.type === "INDIVIDUAL"), corporate: countFor(r => r.type === "CORPORATE") }, pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) } };
    }, { isolationLevel: "RepeatableRead" });
    return NextResponse.json(result);
  } catch (error) { return customerError(error); }
}
export async function lookupCustomers(request: NextRequest) {
  try {
    const actor = await customerActor("customers.lookup"), q = text(request.nextUrl.searchParams.get("q"), "arama", 100);
    if (!q || q.length < 2) return NextResponse.json({ customers: [] });
    // Phone participates in search, but is deliberately absent from the cashier payload.
    const digits = q.replace(/\D/g, "");
    const customers = await prisma.$queryRaw<{ id: string; name: string; code: string }[]>(Prisma.sql`
      SELECT id,name,code FROM "Customer"
      WHERE "organizationId"=${actor.organizationId} AND "isActive"=true
        AND (POSITION(lower(${q}) IN lower(name))>0 OR POSITION(lower(${q}) IN lower(code))>0
          OR POSITION(${q} IN COALESCE(phone,''))>0
          ${digits.length >= 2 ? Prisma.sql`OR POSITION(${digits} IN regexp_replace(COALESCE(phone,''),'[^0-9]','','g'))>0` : Prisma.empty})
      ORDER BY name,id LIMIT 20
    `);
    return NextResponse.json({ customers });
  } catch (error) { return customerError(error); }
}
export async function customerOptions(request: NextRequest) {
  try {
    const actor = await customerActor("customers.manage");
    if (!hasPermission(actor.role, "finance.manage")) return NextResponse.json({ accounts: [], canFinance: false });
    const p = request.nextUrl.searchParams, q = text(p.get("q"), "cari arama", 100);
    const accounts = await prisma.currentAccount.findMany({ where: { organizationId: actor.organizationId, type: { in: ["CUSTOMER", "BOTH"] }, isActive: true, customer: null, ...(q ? { OR: ["code", "name", "phone", "email", "taxNumber"].map(field => ({ [field]: { contains: q, mode: "insensitive" } })) } : {}) }, select: { id: true, code: true, name: true, phone: true, email: true, address: true, taxOffice: true, taxNumber: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 30 });
    const matches = q && q.length >= 2 ? await prisma.customer.findMany({ where: { organizationId: actor.organizationId, OR: ["code", "name", "phone", "email", "taxNumber"].map(field => ({ [field]: { contains: q, mode: "insensitive" } })) }, select: { id: true, name: true, code: true }, take: 10 }) : [];
    return NextResponse.json({ accounts, matches, canFinance: true });
  } catch (error) { return customerError(error); }
}
export async function getCustomer(request: NextRequest, context: CustomerContext) {
  try {
    const actor = await customerActor("customers.read"), { id } = await context.params, p = request.nextUrl.searchParams;
    const branchId = text(p.get("branchId"), "şube", 200);
    if (branchId && !hasAllBranches(actor) && !allowedBranchIds(actor).includes(branchId)) throw new CashError("Şubeye erişim yetkiniz yok.", 404);
    if (branchId && !await prisma.branch.findFirst({ where: { id: branchId, organizationId: actor.organizationId } })) throw new CashError("Şube bulunamadı.", 404);
    const start = dateInput(p.get("startDate")), end = dateInput(p.get("endDate"), true);
    if (start && end && start > end) throw new CashError("Geçersiz tarih aralığı.");
    const salesPage = Number(p.get("salesPage") ?? 1), invoicePage = Number(p.get("invoicePage") ?? 1);
    if (![salesPage, invoicePage].every(n => Number.isSafeInteger(n) && n > 0 && n <= 1000000)) throw new CashError("Geçersiz sayfalama.");
    const scope = { ...branchScope(actor), ...(branchId ? { branchId } : {}) }, dates = { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) };
    const canFinance = hasPermission(actor.role, "finance.manage"), canOrders = hasPermission(actor.role, "orders.read");
    const result = await prisma.$transaction(async tx => {
      await customerRecord(tx, actor, id);
      const customer = await tx.customer.findFirstOrThrow({ where: { id, organizationId: actor.organizationId }, select: { ...profileSelect, currentAccountId: canFinance } });
      const branches = await tx.branch.findMany({ where: { organizationId: actor.organizationId, ...branchIdScope(actor) }, select: { id: true, name: true }, orderBy: { name: "asc" } });
      const orderWhere: Prisma.OrderWhereInput = { customerId: id, organizationId: actor.organizationId, ...scope, createdAt: dates };
      let sales, statistics;
      if (canOrders) {
        const orders = await tx.order.findMany({ where: orderWhere, select: { id: true, orderNumber: true, createdAt: true, status: true, total: true, paymentMethod: true, branch: { select: { id: true, name: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (salesPage - 1) * 20, take: 20 });
        const count = await tx.order.count({ where: orderWhere });
        const totals = await tx.order.aggregate({ where: { ...orderWhere, status: "COMPLETED" }, _count: { _all: true }, _sum: { total: true }, _max: { createdAt: true } });
        const net = totals._sum.total ?? new Prisma.Decimal(0);
        statistics = { completedCount: totals._count._all, netSpend: net.toString(), averageBasket: totals._count._all ? net.div(totals._count._all).toDecimalPlaces(2).toString() : "0", lastPurchaseAt: totals._max.createdAt };
        sales = { orders: orders.map(o => ({ ...o, netAmount: o.status === "COMPLETED" ? o.total.toString() : "0" })), pagination: { page: salesPage, total: count, totalPages: Math.ceil(count / 20) } };
      }
      let finance;
      if (canFinance) {
        const card = customer.currentAccountId ? await tx.currentAccount.findFirst({ where: { id: customer.currentAccountId, organizationId: actor.organizationId }, select: { id: true, name: true, code: true, isActive: true } }) : null;
        if (card) {
          const groups = await tx.currentAccountEntry.groupBy({ by: ["direction"], where: { currentAccountId: card.id, organizationId: actor.organizationId, ...scope }, _sum: { amount: true } });
          const balance = groups.reduce((n, row) => row.direction === "DEBIT" ? n.plus(row._sum.amount ?? 0) : n.minus(row._sum.amount ?? 0), new Prisma.Decimal(0));
          const where: Prisma.InvoiceWhereInput = { currentAccountId: card.id, organizationId: actor.organizationId, type: "SALES", ...scope, invoiceDate: dates };
          const invoices = await tx.invoice.findMany({ where, select: { id: true, number: true, invoiceDate: true, status: true, grandTotal: true, snapshot: true, branch: { select: { name: true } }, allocations: { where: { payment: { cancelledAt: null } }, select: { amount: true } } }, orderBy: [{ invoiceDate: "desc" }, { id: "desc" }], skip: (invoicePage - 1) * 20, take: 20 });
          const count = await tx.invoice.count({ where });
          finance = { account: card, balance: balance.toString(), invoices: invoices.map(i => ({ id: i.id, number: i.number, invoiceDate: i.invoiceDate, status: i.status, grandTotal: i.grandTotal, branch: i.branch, ...paymentTotals(i.grandTotal, i.allocations) })), pagination: { page: invoicePage, total: count, totalPages: Math.ceil(count / 20) } };
        } else finance = { account: null };
      }
      return { customer, branches, permissions: { manage: hasPermission(actor.role, "customers.manage"), finance: canFinance, orders: canOrders }, ...(sales ? { sales, statistics } : {}), ...(finance ? { finance } : {}) };
    }, { isolationLevel: "RepeatableRead", timeout: 20000 });
    return NextResponse.json(result);
  } catch (error) { return customerError(error); }
}

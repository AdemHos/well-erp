import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { branchScope, branchIdScope, hasPermission } from "@/lib/permissions";
import { CashError } from "@/lib/cash-management";
import { pagination, text } from "@/lib/current-accounts";
import { supplierActor, supplierError, type SupplierContext } from "@/lib/supplier-service";
import { paymentTotals } from "@/lib/expenses";

const profileSelect = { organizationId: true, id: true, code: true, name: true, contactName: true, website: true, phone: true, email: true, address: true, city: true, district: true, taxOffice: true, taxNumber: true, notes: true, isActive: true, currentAccountId: true, version: true, createdAt: true, updatedAt: true } satisfies Prisma.SupplierSelect;
async function balances(tx: Prisma.TransactionClient, organizationId: string, scope: { branchId?: Prisma.StringFilter | string }, currentAccountId?: string) {
  const groups = await tx.currentAccountEntry.groupBy({ by: ["currentAccountId", "direction"], where: { organizationId, ...scope, ...(currentAccountId ? { currentAccountId } : { currentAccount: { supplier: { isNot: null } } }) }, _sum: { amount: true } });
  const result = new Map<string, Prisma.Decimal>();
  for (const row of groups) { const n = result.get(row.currentAccountId) ?? new Prisma.Decimal(0); result.set(row.currentAccountId, row.direction === "DEBIT" ? n.plus(row._sum.amount ?? 0) : n.minus(row._sum.amount ?? 0)); }
  return result;
}
export async function listSuppliers(request: NextRequest) {
  try {
    const actor = await supplierActor("suppliers.read"), params = request.nextUrl.searchParams;
    const { page, limit, skip } = pagination(params), q = text(params.get("q"), "arama", 200), active = params.get("active") ?? "all";
    if (!["true", "false", "all"].includes(active)) throw new CashError("Geçersiz aktiflik filtresi.");
    const canFinance = hasPermission(actor.role, "finance.manage");
    const where: Prisma.SupplierWhereInput = { organizationId: actor.organizationId, ...(active !== "all" ? { isActive: active === "true" } : {}), ...(q ? { OR: ["name", "code", "phone", "email", "contactName", "taxNumber"].map(field => ({ [field]: { contains: q, mode: "insensitive" } })) } : {}) };
    const result = await prisma.$transaction(async tx => {
      const suppliers = await tx.supplier.findMany({ where, select: { ...profileSelect, currentAccountId: canFinance }, orderBy: [{ name: "asc" }, { id: "asc" }], skip, take: limit });
      const count = await tx.supplier.count({ where });
      const total = await tx.supplier.count({ where: { organizationId: actor.organizationId } }), activeCount = await tx.supplier.count({ where: { organizationId: actor.organizationId, isActive: true } });
      const totals = canFinance ? await balances(tx, actor.organizationId, branchScope(actor)) : new Map<string, Prisma.Decimal>();
      const payable = [...totals.values()].reduce((n, v) => v.lt(0) ? n.minus(v) : n, new Prisma.Decimal(0));
      return { organizationId: actor.organizationId, suppliers: suppliers.map(s => ({ ...s, ...(canFinance ? { balance: (totals.get(s.currentAccountId ?? "") ?? new Prisma.Decimal(0)).toString() } : {}) })), permissions: { manage: hasPermission(actor.role, "suppliers.manage"), finance: canFinance }, summary: { total, active: activeCount, ...(canFinance ? { payable: payable.toString() } : {}) }, pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) } };
    }, { isolationLevel: "RepeatableRead" });
    return NextResponse.json(result);
  } catch (error) { return supplierError(error); }
}
export async function supplierOptions(request: NextRequest) {
  try {
    const actor = await supplierActor("suppliers.read"), q = text(request.nextUrl.searchParams.get("q"), "arama", 100);
    const selectedId = text(request.nextUrl.searchParams.get("supplierId"), "tedarikçi", 200);
    const canFinance = hasPermission(actor.role, "finance.manage");
    const search = q ? { OR: ["code", "name", "phone", "email", "taxNumber"].map(field => ({ [field]: { contains: q, mode: "insensitive" } })) } : {};
    const result = await prisma.$transaction(async tx => {
      const accounts = canFinance ? await tx.currentAccount.findMany({ where: { organizationId: actor.organizationId, type: { in: ["SUPPLIER", "BOTH"] }, isActive: true, supplier: null, ...search }, select: { id: true, code: true, name: true, phone: true, email: true, address: true, taxOffice: true, taxNumber: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 30 }) : [];
      const matches = q ? await tx.supplier.findMany({ where: { organizationId: actor.organizationId, ...search }, select: { id: true, name: true, code: true }, take: 10 }) : [];
      const products = await tx.product.findMany({ where: { organizationId: actor.organizationId, isActive: true, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { sku: { contains: q, mode: "insensitive" } }] } : {}) }, select: { id: true, name: true, sku: true, isSellable: true, unit: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 50 });
      const suppliers = canFinance ? await tx.supplier.findMany({ where: { organizationId: actor.organizationId, isActive: true, currentAccount: { is: { isActive: true, type: { in: ["SUPPLIER", "BOTH"] } } }, ...search }, select: { id: true, name: true, code: true, currentAccountId: true }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 50 }) : [];
      if (canFinance && selectedId && !suppliers.some(s => s.id === selectedId)) {
        const selected = await tx.supplier.findFirst({ where: { id: selectedId, organizationId: actor.organizationId, isActive: true, currentAccount: { is: { isActive: true, type: { in: ["SUPPLIER", "BOTH"] } } } }, select: { id: true, name: true, code: true, currentAccountId: true } });
        if (selected) suppliers.unshift(selected);
      }
      return { accounts, matches, products, suppliers, canFinance };
    }, { isolationLevel: "RepeatableRead" });
    return NextResponse.json(result);
  } catch (error) { return supplierError(error); }
}
export async function getSupplier(request: NextRequest, context: SupplierContext) {
  try {
    const actor = await supplierActor("suppliers.read"), { id } = await context.params, p = request.nextUrl.searchParams;
    const branchId = text(p.get("branchId"), "şube", 200);
    const canFinance = hasPermission(actor.role, "finance.manage");
    const pages = ["invoicePage", "paymentPage", "productPage"].map(key => Number(p.get(key) ?? 1));
    if (!pages.every(n => Number.isSafeInteger(n) && n > 0 && n <= 1000000)) throw new CashError("Geçersiz sayfalama.");
    const [invoicePage, paymentPage, productPage] = pages;
    const result = await prisma.$transaction(async tx => {
      if (branchId && !await tx.branch.findFirst({ where: { organizationId: actor.organizationId, AND: [{ id: branchId }, branchIdScope(actor)] }, select: { id: true } })) throw new CashError("Şube bulunamadı veya erişim yetkiniz yok.", 404);
      const supplier = await tx.supplier.findFirst({ where: { id, organizationId: actor.organizationId }, select: { ...profileSelect, currentAccountId: canFinance } });
      if (!supplier) throw new CashError("Tedarikçi bulunamadı veya erişim yetkiniz yok.", 404);
      const scope = { ...branchScope(actor), ...(branchId ? { branchId } : {}) };
      const branches = await tx.branch.findMany({ where: { organizationId: actor.organizationId, ...branchIdScope(actor) }, select: { id: true, name: true }, orderBy: { name: "asc" } });
      const productWhere = { supplierId: id, organizationId: actor.organizationId };
      const products = await tx.supplierProduct.findMany({ where: productWhere, select: { id: true, productId: true, supplierProductCode: true, lastPurchasePrice: canFinance, version: true, product: { select: { id: true, name: true, sku: true, unit: true, isSellable: true, isActive: true } } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20, skip: (productPage - 1) * 20 });
      const productCount = await tx.supplierProduct.count({ where: productWhere });
      let finance;
      if (canFinance) {
        const card = supplier.currentAccountId ? await tx.currentAccount.findFirst({ where: { id: supplier.currentAccountId, organizationId: actor.organizationId }, select: { id: true, name: true, code: true, isActive: true } }) : null;
        if (card) {
          const balance = (await balances(tx, actor.organizationId, scope, card.id)).get(card.id) ?? new Prisma.Decimal(0);
          const where: Prisma.InvoiceWhereInput = { currentAccountId: card.id, organizationId: actor.organizationId, type: "PURCHASE", ...scope };
          const invoices = await tx.invoice.findMany({ where, select: { id: true, number: true, invoiceDate: true, status: true, grandTotal: true, branch: { select: { name: true } }, allocations: { where: { payment: { cancelledAt: null } }, select: { amount: true } } }, orderBy: [{ invoiceDate: "desc" }, { id: "desc" }], skip: (invoicePage - 1) * 20, take: 20 });
          const invoiceCount = await tx.invoice.count({ where });
          const invoiceTotals = await tx.invoice.aggregate({ where: { ...where, status: "ISSUED" }, _sum: { grandTotal: true }, _max: { invoiceDate: true } });
          const allocated = await tx.invoicePaymentAllocation.aggregate({ where: { organizationId: actor.organizationId, ...scope, invoice: { currentAccountId: card.id, type: "PURCHASE", status: "ISSUED" }, payment: { cancelledAt: null } }, _sum: { amount: true } });
          const paymentWhere: Prisma.PaymentWhereInput = { organizationId: actor.organizationId, currentAccountId: card.id, type: { in: ["SUPPLIER_PAYMENT", "PURCHASE_INVOICE_PAYMENT", "EXPENSE_PAYMENT"] }, ...scope };
          const payments = await tx.payment.findMany({ where: paymentWhere, select: { id: true, type: true, amount: true, paidAt: true, cancelledAt: true, reference: true, branch: { select: { name: true } }, financeTransaction: { select: { account: { select: { name: true } } } } }, orderBy: [{ paidAt: "desc" }, { id: "desc" }], skip: (paymentPage - 1) * 20, take: 20 });
          const paymentCount = await tx.payment.count({ where: paymentWhere });
          const paid = await tx.payment.aggregate({ where: { ...paymentWhere, cancelledAt: null }, _sum: { amount: true }, _max: { paidAt: true } });
          finance = { account: card, balance: balance.toString(), openDebt: balance.lt(0) ? balance.negated().toString() : "0", invoices: invoices.map(i => ({ ...i, allocations: undefined, ...paymentTotals(i.grandTotal, i.allocations) })), invoicePagination: { page: invoicePage, total: invoiceCount, totalPages: Math.ceil(invoiceCount / 20) }, payments, paymentPagination: { page: paymentPage, total: paymentCount, totalPages: Math.ceil(paymentCount / 20) }, statistics: { purchaseTotal: (invoiceTotals._sum.grandTotal ?? new Prisma.Decimal(0)).toString(), invoicePaid: (allocated._sum.amount ?? new Prisma.Decimal(0)).toString(), totalPaid: (paid._sum.amount ?? new Prisma.Decimal(0)).toString(), lastPaidAt: paid._max.paidAt, lastInvoiceAt: invoiceTotals._max.invoiceDate } };
        } else finance = { account: null };
      }
      return { supplier, branches, products, productPagination: { page: productPage, total: productCount, totalPages: Math.ceil(productCount / 20) }, permissions: { manage: hasPermission(actor.role, "suppliers.manage"), finance: canFinance }, ...(canFinance ? { finance } : {}) };
    }, { isolationLevel: "RepeatableRead", timeout: 20000 });
    return NextResponse.json(result);
  } catch (error) { return supplierError(error); }
}

export async function listSupplierProducts(request: NextRequest, context: SupplierContext) {
  // Same scoped/paginated shape as detail; no second product query implementation.
  const result = await getSupplier(request, context);
  if (!result.ok) return result;
  const data = await result.json();
  return NextResponse.json({ products: data.products, pagination: data.productPagination });
}

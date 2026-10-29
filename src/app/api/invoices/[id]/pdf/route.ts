import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { currentActor } from "@/lib/current-accounts-service";
import { invoiceError, invoiceRecord, type InvoiceContext } from "@/lib/invoice-service";
import { buildInvoicePdf } from "@/lib/invoice-pdf";
import { withPermission } from "@/lib/rbac";
export const GET = withPermission("finance.manage", async (_request: NextRequest, context: InvoiceContext) => {
  try {
    const actor = await currentActor(), { id } = await context.params;
    const invoice = await prisma.$transaction(tx => invoiceRecord(tx, actor, id), { isolationLevel: "RepeatableRead" });
    const bytes = await buildInvoicePdf(invoice);
    return new NextResponse(Buffer.from(bytes), { headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="commercial-preview-${invoice.id.replace(/[^a-zA-Z0-9_-]/g, "")}.pdf"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return invoiceError(error); }
});
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { branchPolicy } from "@/lib/settings-policy";
import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { AccessError, type ActiveMembership } from "@/lib/auth-context";
import { getCurrentMembership } from "@/lib/current-membership";
import { branchIdScope, branchScope, hasPermission, type Permission } from "@/lib/permissions";
import { writeAudit } from "@/lib/audit";

export const tokenHash = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(32).toString("base64url");
const isToken = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
const openStatuses = ["PENDING", "ACKNOWLEDGED"] as const;
const privateHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
export function qrJson(data: unknown, status = 200) { return NextResponse.json(data, { status, headers: { ...privateHeaders, ...(status === 429 ? { "Retry-After": "60" } : {}) } }); }
export function qrError(error: unknown) {
  if (error instanceof AccessError) return qrJson({ error: error.message }, error.status);
  if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2021", "P2022"].includes(error.code)) return qrJson({ error: "QR servisleri için veritabanı güncellemesi henüz uygulanmadı." }, 503);
  // Never log URLs, request bodies or bearer tokens.
  console.error("QR_SERVICE_ERROR", error instanceof Prisma.PrismaClientKnownRequestError ? error.code : "UnexpectedError");
  return qrJson({ error: "İşlem tamamlanamadı. Lütfen tekrar deneyin." }, 500);
}
export async function qrBody(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) throw new AccessError("JSON veri gönderin.", 415);
  const reader = request.body?.getReader();
  if (!reader) throw new AccessError("İstek verisi gerekli.", 400);
  let text = "", size = 0; const decoder = new TextDecoder();
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.byteLength;
      if (size > 2048) { await reader.cancel(); throw new AccessError("İstek verisi çok büyük.", 413); }
      text += decoder.decode(part.value, { stream: true });
    }
    const body = JSON.parse(text + decoder.decode());
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error();
    return body as Record<string, unknown>;
  } catch (error) { if (error instanceof AccessError) throw error; throw new AccessError("Geçersiz istek verisi.", 400); }
  finally { reader.releaseLock(); }
}
export function onlyKeys(body: Record<string, unknown>, keys: string[]) {
  if (Object.keys(body).some(key => !keys.includes(key))) throw new AccessError("Beklenmeyen istek alanı.", 400);
}
export async function qrActor(permission: Permission) {
  const actor = await getCurrentMembership({ required: true });
  if (!actor) throw new AccessError("Oturum açmanız gerekiyor.", 401);
  if (!hasPermission(actor.role, permission)) throw new AccessError("Bu işlem için yetkiniz yok.", 403);
  return actor;
}
export async function qrBranch(actor: ActiveMembership, branchId: string) {
  const branch = await prisma.branch.findFirst({ where: { AND: [{ id: branchId, organizationId: actor.organizationId }, branchIdScope(actor)] }, select: { id: true, name: true } });
  if (!branch) throw new AccessError("Şube bulunamadı.", 404);
  return branch;
}
export async function getQrSettings(branchId: string) {
  const actor = await qrActor("qr-menu.manage"); await qrBranch(actor, branchId);
  const [settings, tables] = await Promise.all([
    prisma.branchQrMenu.findFirst({ where: { branchId, organizationId: actor.organizationId }, select: { isPublished: true, serviceRequestsEnabled: true, waiterCallEnabled: true, billRequestEnabled: true, publicToken: true } }),
    prisma.restaurantTable.findMany({ where: { organizationId: actor.organizationId, branchId }, select: { id: true, name: true, isActive: true, qrTokenRotatedAt: true }, orderBy: { name: "asc" }, take: 500 }),
  ]);
  return { settings: settings ? { ...settings, menuPath: `/menu/${settings.publicToken}` } : null, tables };
}
export async function saveQrSettings(branchId: string, body: Record<string, unknown>) {
  onlyKeys(body, ["isPublished", "serviceRequestsEnabled", "waiterCallEnabled", "billRequestEnabled"]);
  for (const key of ["isPublished", "serviceRequestsEnabled", "waiterCallEnabled", "billRequestEnabled"]) if (typeof body[key] !== "boolean") throw new AccessError("Ayarlar açık/kapalı olmalıdır.", 400);
  const actor = await qrActor("qr-menu.manage"); await qrBranch(actor, branchId);
  const values = { isPublished: body.isPublished as boolean, serviceRequestsEnabled: body.serviceRequestsEnabled as boolean, waiterCallEnabled: body.waiterCallEnabled as boolean, billRequestEnabled: body.billRequestEnabled as boolean };
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "Branch" WHERE id = ${branchId} AND "organizationId" = ${actor.organizationId} FOR UPDATE`;
    const row = await tx.branchQrMenu.upsert({ where: { branchId }, create: { branchId, organizationId: actor.organizationId, publicToken: newToken(), ...values }, update: values });
    await writeAudit(tx, actor, "QR_MENU_SETTINGS_UPDATED", "BranchQrMenu", row.id, branchId, values);
    return { menuPath: `/menu/${row.publicToken}`, ...values };
  });
}
export async function rotateTableQr(branchId: string, tableId: string, revoke = false) {
  const actor = await qrActor("qr-menu.manage"); await qrBranch(actor, branchId);
  return prisma.$transaction(async tx => {
    // Same lock order as public creation: settings before table.
    await tx.$queryRaw`SELECT id FROM "BranchQrMenu" WHERE "branchId" = ${branchId} AND "organizationId" = ${actor.organizationId} FOR SHARE`;
    const menu = await tx.branchQrMenu.findUnique({ where: { branchId } });
    if (!menu) throw new AccessError("Önce şube QR Menü ayarlarını kaydedin.", 409);
    await tx.$queryRaw`SELECT id FROM "RestaurantTable" WHERE id = ${tableId} AND "branchId" = ${branchId} AND "organizationId" = ${actor.organizationId} FOR UPDATE`;
    const table = await tx.restaurantTable.findFirst({ where: { id: tableId, branchId, organizationId: actor.organizationId } });
    if (!table || (!revoke && !table.isActive)) throw new AccessError("Aktif masa bulunamadı.", 404);
    const token = revoke ? null : newToken();
    await tx.restaurantTable.update({ where: { id: table.id }, data: { qrTokenHash: token ? tokenHash(token) : null, qrTokenRotatedAt: token ? new Date() : null } });
    await writeAudit(tx, actor, revoke ? "TABLE_QR_REVOKED" : "TABLE_QR_ROTATED", "RestaurantTable", table.id, branchId);
    return { menuPath: token ? `/menu/${menu.publicToken}?table=${token}` : null, tableName: table.name };
  });
}

export async function publicMenu(publicToken: string, tableToken?: string | null) {
  if (!isToken(publicToken)) throw new AccessError("Menü bulunamadı.", 404);
  const menu = await prisma.branchQrMenu.findFirst({ where: { publicToken, isPublished: true }, select: { organizationId: true, branchId: true, serviceRequestsEnabled: true, waiterCallEnabled: true, billRequestEnabled: true, organization: { select: { name: true } }, branch: { select: { name: true } } } });
  if (!menu) throw new AccessError("Menü bulunamadı veya yayında değil.", 404);
  const table = isToken(tableToken) ? await prisma.restaurantTable.findFirst({ where: { qrTokenHash: tokenHash(tableToken), organizationId: menu.organizationId, branchId: menu.branchId, isActive: true }, select: { id: true, name: true } }) : null;
  const hasTab = table && menu.serviceRequestsEnabled && menu.billRequestEnabled ? !!await prisma.tab.findFirst({ where: { tableId: table.id, organizationId: menu.organizationId, branchId: menu.branchId, status: "OPEN" }, select: { id: true } }) : false;
  // Existing catalogue is organization-wide; no separate QR price/stock source.
  const products = await prisma.product.findMany({ where: { organizationId: menu.organizationId, isActive: true, isSellable: true }, select: { id: true, name: true, description: true, price: true, category: { select: { name: true } } }, orderBy: [{ name: "asc" }, { id: "asc" }], take: 1001 });
  if (products.length > 1000) throw new AccessError("Menü ürün sınırı aşıldı. İşletme yetkilisine başvurun.", 422);
  return { organizationName: menu.organization.name, branchName: menu.branch.name, tableName: table?.name ?? null, invalidTable: !!tableToken && !table, waiterCallEnabled: !!table && menu.serviceRequestsEnabled && menu.waiterCallEnabled, billRequestEnabled: !!table && menu.serviceRequestsEnabled && menu.billRequestEnabled, hasOpenTab: hasTab, products: products.map(p => ({ id: p.id, name: p.name, description: p.description, price: p.price.toFixed(2), category: p.category?.name ?? "Diğer" })) };
}

// Supplemental process-local protection, bounded memory. Only trust a proxy IP
// header when the deployment explicitly sanitizes it and configures its name.
const buckets = new Map<string, { start: number; count: number }>();
export function publicRequestGuard(request: Request) {
  const origin = request.headers.get("origin");
  if (origin !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") throw new AccessError("İstek kaynağına izin verilmiyor.", 403);
  const header = process.env.QR_TRUSTED_IP_HEADER;
  const ip = header ? request.headers.get(header)?.slice(0, 100) : undefined;
  const key = ip ? tokenHash(ip) : "shared"; const now = Date.now();
  for (const [id, entry] of buckets) if (now - entry.start >= 60000) buckets.delete(id);
  if (!buckets.has(key) && buckets.size >= 4096) throw new AccessError("Çok fazla istek. Biraz sonra tekrar deneyin.", 429);
  const entry = buckets.get(key) ?? { start: now, count: 0 }; entry.count++; buckets.set(key, entry);
  if (entry.count > (ip ? 30 : 300)) throw new AccessError("Çok fazla istek. Bir dakika sonra tekrar deneyin.", 429);
}
export async function createPublicRequest(publicToken: string, body: Record<string, unknown>) {
  onlyKeys(body, ["tableToken", "type"]);
  if (!isToken(publicToken) || !isToken(body.tableToken)) throw new AccessError("Geçersiz masa bağlantısı.", 404);
  if (body.type !== "WAITER_CALL" && body.type !== "BILL_REQUEST") throw new AccessError("Geçersiz talep türü.", 400);
  const hash = tokenHash(body.tableToken), type = body.type;
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM "BranchQrMenu" WHERE "publicToken" = ${publicToken} FOR SHARE`;
    const menu = await tx.branchQrMenu.findUnique({ where: { publicToken } });
    if (!menu?.isPublished || !menu.serviceRequestsEnabled || !(type === "WAITER_CALL" ? menu.waiterCallEnabled : menu.billRequestEnabled)) throw new AccessError("Bu servis talebi şu anda kullanılamıyor.", 404);
    await tx.$queryRaw`SELECT id FROM "RestaurantTable" WHERE "qrTokenHash" = ${hash} AND "organizationId" = ${menu.organizationId} AND "branchId" = ${menu.branchId} FOR UPDATE`;
    const table = await tx.restaurantTable.findFirst({ where: { qrTokenHash: hash, organizationId: menu.organizationId, branchId: menu.branchId, isActive: true } });
    if (!table) throw new AccessError("Masa bağlantısı geçersiz veya masa kullanım dışı.", 404);
    const tab = type === "BILL_REQUEST" ? await tx.tab.findFirst({ where: { tableId: table.id, branchId: menu.branchId, organizationId: menu.organizationId, status: "OPEN" }, orderBy: { openedAt: "desc" }, select: { id: true } }) : null;
    if (type === "BILL_REQUEST") {
      if (!tab) return { noTab: true, message: "Bu masada açık adisyon yok. Hesap talebi oluşturulmadı." };
      // Serialize with checkout/cancellation, then recheck; never change the tab.
      await tx.$queryRaw`SELECT id FROM "Tab" WHERE id = ${tab.id} FOR UPDATE`;
      if (!await tx.tab.findFirst({ where: { id: tab.id, status: "OPEN" }, select: { id: true } })) return { noTab: true, message: "Adisyon kapanmış. Hesap talebi oluşturulmadı." };
    }
    const existing = await tx.serviceRequest.findFirst({ where: { tableId: table.id, type, status: { in: [...openStatuses] } }, select: { id: true, tabId: true } });
    if (existing && type === "BILL_REQUEST" && existing.tabId !== tab?.id) return { noTab: true, message: "Önceki adisyona ait hesap talebi henüz kapatılmamış. Lütfen personelimizle görüşün." };
    if (existing) return { existing: true, message: "Bu talebiniz zaten bekliyor; personelimiz ilgilenecek." };
    // RETURN a rejection instead of throwing after increment, so the counter commits.
    const now = new Date(), fresh = !table.requestWindowStartedAt || now.getTime() - table.requestWindowStartedAt.getTime() >= 60000;
    if (!fresh && table.requestWindowCount >= 6) return { limited: true, message: "Çok fazla talep. Bir dakika sonra tekrar deneyin." };
    await tx.restaurantTable.update({ where: { id: table.id }, data: { requestWindowStartedAt: fresh ? now : table.requestWindowStartedAt, requestWindowCount: fresh ? 1 : table.requestWindowCount + 1 } });
    const last = await tx.serviceRequest.findFirst({ where: { tableId: table.id, type }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
    if (last && now.getTime() - last.createdAt.getTime() < 30000) return { limited: true, message: "Yeni talep için lütfen 30 saniye bekleyin." };
    await tx.serviceRequest.create({ data: { organizationId: menu.organizationId, branchId: menu.branchId, tableId: table.id, tabId: tab?.id, type } });
    return { existing: false, message: type === "WAITER_CALL" ? "Garson çağrınız personele iletildi." : "Hesap talebiniz personele iletildi." };
  }, { timeout: 10000, maxWait: 3000 });
}

export async function listServiceRequests(request: Request) {
  const actor = await qrActor("service-requests.read"), params = new URL(request.url).searchParams;
  if (params.has("organizationId")) throw new AccessError("İşletme filtresi kabul edilmez.", 400);
  const branchId = params.get("branchId"); if (!branchId) throw new AccessError("Şube seçin.", 400);
  await qrBranch(actor, branchId);
  const policy = await branchPolicy(prisma, actor.organizationId, branchId);
  const history = params.get("history") === "true", page = Math.max(1, Math.min(10000, Number(params.get("page")) || 1));
  if (!Number.isInteger(page)) throw new AccessError("Geçersiz sayfa.", 400);
  const where: Prisma.ServiceRequestWhereInput = { AND: [{ organizationId: actor.organizationId, branchId }, branchScope(actor)], status: { in: history ? ["COMPLETED", "CANCELLED"] : [...openStatuses] } };
  const [total, rows, latest] = await prisma.$transaction([
    prisma.serviceRequest.count({ where }),
    prisma.serviceRequest.findMany({ where, orderBy: [{ createdAt: history ? "desc" : "asc" }, { id: "asc" }], take: 50, skip: (page - 1) * 50, select: { id: true, type: true, status: true, createdAt: true, acknowledgedAt: true, completedAt: true, cancelledAt: true, acknowledgedByUserId: true, acknowledgedByProfileId: true, table: { select: { name: true } }, branch: { select: { name: true } }, acknowledgedByUser: { select: { name: true } }, acknowledgedByProfile: { select: { name: true } }, completedByUser: { select: { name: true } }, completedByProfile: { select: { name: true } } } }),
    prisma.serviceRequest.findFirst({ where: { organizationId: actor.organizationId, branchId, type: { in: [...(policy.waiterNotification ? ["WAITER_CALL" as const] : []), ...(policy.billNotification ? ["BILL_REQUEST" as const] : [])] } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true } }),
  ]);
  return { notificationPolicy: { enabled: policy.notificationsEnabled, notificationSound: policy.notificationSound }, total, page, latestId: latest?.id ?? null, pages: Math.max(1, Math.ceil(total / 50)), rows: rows.map(({ acknowledgedByUserId, acknowledgedByProfileId, acknowledgedByUser, acknowledgedByProfile, completedByUser, completedByProfile, ...row }) => ({ ...row, assignedName: acknowledgedByProfile?.name ?? acknowledgedByUser?.name ?? null, completedName: completedByProfile?.name ?? completedByUser?.name ?? null, canFinish: hasPermission(actor.role, "service-requests.manage") && (hasPermission(actor.role, "tables.manage") || (acknowledgedByUserId === actor.userId && (acknowledgedByProfileId ?? null) === (actor.profileId ?? null))) })) };
}
export async function changeServiceRequest(id: string, body: Record<string, unknown>) {
  onlyKeys(body, ["action"]);
  if (!["ACKNOWLEDGE", "COMPLETE", "CANCEL"].includes(String(body.action))) throw new AccessError("Geçersiz işlem.", 400);
  const actor = await qrActor("service-requests.manage");
  return prisma.$transaction(async tx => {
    const where = { id, organizationId: actor.organizationId, ...branchScope(actor) };
    const row = await tx.serviceRequest.findFirst({ where });
    if (!row) throw new AccessError("Talep bulunamadı.", 404);
    const isManager = hasPermission(actor.role, "tables.manage"), owned = row.acknowledgedByUserId === actor.userId && row.acknowledgedByProfileId === (actor.profileId ?? null);
    const at = new Date(); let data: Prisma.ServiceRequestUncheckedUpdateManyInput;
    if (body.action === "ACKNOWLEDGE") {
      if (row.status !== "PENDING") throw new AccessError("Talep başka bir personel tarafından alınmış veya kapatılmış.", 409);
      data = { status: "ACKNOWLEDGED", acknowledgedAt: at, acknowledgedByUserId: actor.userId, acknowledgedByProfileId: actor.profileId ?? null };
    } else {
      if (!openStatuses.includes(row.status as typeof openStatuses[number])) throw new AccessError("Talep zaten kapatılmış.", 409);
      if (body.action === "COMPLETE" && row.status !== "ACKNOWLEDGED") throw new AccessError("Önce talebi üstlenin.", 409);
      if (!isManager && !owned) throw new AccessError("Bu işlem için talebi üstlenmiş olmalısınız.", 403);
      data = body.action === "COMPLETE" ? { status: "COMPLETED", completedAt: at, completedByUserId: actor.userId, completedByProfileId: actor.profileId ?? null } : { status: "CANCELLED", cancelledAt: at, cancelledByUserId: actor.userId, cancelledByProfileId: actor.profileId ?? null };
    }
    const changed = await tx.serviceRequest.updateMany({ where: { ...where, status: row.status, acknowledgedByUserId: row.acknowledgedByUserId, acknowledgedByProfileId: row.acknowledgedByProfileId }, data });
    if (changed.count !== 1) throw new AccessError("Talep başka bir personel tarafından güncellendi. Listeyi yenileyin.", 409);
    await writeAudit(tx, actor, "SERVICE_REQUEST_" + body.action, "ServiceRequest", id, row.branchId);
    return { message: "Talep güncellendi." };
  });
}

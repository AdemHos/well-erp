import { AsyncLocalStorage } from "node:async_hooks";
import type { Role } from "@/generated/prisma/client";

export type ActiveMembership = {
  profileId?: string; profileSessionId?: string;
  id: string; userId: string; organizationId: string; role: Role;
  isActive: boolean; allBranches: boolean; branchAccess: { branchId: string }[];
  organization: { id: string; name: string };
  user: { id: string; email: string; name: string | null; image: string | null };
};
export const membershipContext = new AsyncLocalStorage<ActiveMembership>();
export class AccessError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

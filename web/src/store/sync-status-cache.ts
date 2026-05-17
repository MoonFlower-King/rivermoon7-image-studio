"use client";

import type { SyncStatusResponse } from "@/lib/api";

let cachedSyncStatus: SyncStatusResponse | null = null;

export function getCachedSyncStatus() {
  return cachedSyncStatus;
}

export function setCachedSyncStatus(value: SyncStatusResponse | null) {
  cachedSyncStatus = value;
}

export function clearCachedSyncStatus() {
  cachedSyncStatus = null;
}

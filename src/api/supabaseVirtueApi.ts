import type { HttpVirtueApi, HttpVirtueApiOptions } from "./httpVirtueApi";
import { createHttpVirtueApi } from "./httpVirtueApi";

/**
 * Temporary-provider adapter. Supabase hosts the Edge Function/API boundary;
 * the browser only sees the provider-neutral HTTP contract.
 */
export type SupabaseVirtueApiOptions = HttpVirtueApiOptions & { supabaseProjectUrl?: string; edgeFunctionName?: string };

export function createSupabaseVirtueApi(options: SupabaseVirtueApiOptions): ReturnType<typeof createHttpVirtueApi> {
  const baseUrl = options.baseUrl || (options.supabaseProjectUrl && options.edgeFunctionName ? `${options.supabaseProjectUrl.replace(/\/$/, "")}/functions/v1/${options.edgeFunctionName}` : undefined);
  if (!baseUrl) throw new Error("Supabase API URL is required");
  return createHttpVirtueApi({ ...options, baseUrl });
}

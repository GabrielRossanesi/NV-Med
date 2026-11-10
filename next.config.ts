import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
import { validateSupabaseEnvironment } from "./src/lib/supabase/environment";
import { buildAppOrigin } from "./src/lib/appOrigin";

export default function nextConfig(phase: string): NextConfig {
  const { mode, origin } = validateSupabaseEnvironment(process.env, phase === PHASE_DEVELOPMENT_SERVER);
  const appOrigin = buildAppOrigin(mode, process.env.NEXT_PUBLIC_SITE_URL);
  return {
    env: { NVMED_BUILT_MODE: mode, NVMED_BUILT_SUPABASE_ORIGIN: origin, NVMED_BUILT_APP_ORIGIN: appOrigin },
  };
}

"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { ServiceModeState } from "@/convex/serviceMode";
import { DegradedModeBanner } from "@/components/feedback/DegradedModeBanner";

const DEFAULT_MODE: ServiceModeState = {
  currentMode: 0,
  reason: "all_systems_nominal",
  enteredAt: 0,
  triggers: {
    providerHealthy: true,
    budgetOk: true,
    latencyOk: true,
    circuitBreakerClosed: true,
  },
};

const ServiceModeContext = createContext<ServiceModeState>(DEFAULT_MODE);

export function ServiceModeProvider({ children }: { children: ReactNode }) {
  const mode = useQuery(api.serviceMode.getServiceMode);
  const value = mode ?? DEFAULT_MODE;

  return (
    <ServiceModeContext.Provider value={value}>
      {value.currentMode >= 2 && <DegradedModeBanner mode={value} />}
      {children}
    </ServiceModeContext.Provider>
  );
}

export function useServiceMode() {
  return useContext(ServiceModeContext);
}

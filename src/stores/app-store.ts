"use client";

import { create } from "zustand";

export type PageKey =
  | "overview"
  | "device-list"
  | "device-groups"
  | "product-list"
  | "product-define"
  | "message-queue"
  | "rule-engine"
  | "cloud-dev"
  | "data-analysis"
  | "log-service"
  | "ops-monitor"
  | "device-detail";

interface AppState {
  currentPage: PageKey;
  selectedDeviceId: string | null;
  selectedProductId: string | null;
  sidebarCollapsed: boolean;
  setCurrentPage: (page: PageKey) => void;
  setSelectedDeviceId: (id: string | null) => void;
  setSelectedProductId: (id: string | null) => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
}

export const useAppStore = create<AppState>((set) => ({
  currentPage: "overview",
  selectedDeviceId: null,
  selectedProductId: null,
  sidebarCollapsed: false,
  setCurrentPage: (page) => set({ currentPage: page, selectedDeviceId: null }),
  setSelectedDeviceId: (id) => set({ selectedDeviceId: id, currentPage: id ? "device-detail" : "device-list" }),
  setSelectedProductId: (id) => set({ selectedProductId: id, currentPage: id ? "product-define" : "product-list" }),
  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
}));

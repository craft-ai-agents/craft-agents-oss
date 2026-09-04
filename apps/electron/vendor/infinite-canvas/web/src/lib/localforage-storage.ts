import localforage from "localforage";
import type { StateStorage } from "zustand/middleware";
import { managedCanvasScope } from './managed-canvas';

localforage.config({
    name: managedCanvasScope ? `jonwork-managed-${managedCanvasScope}` : 'infinite-canvas',
    storeName: "app_state",
});

export const localForageStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        try {
            return (await localforage.getItem<string>(name)) || null;
        } catch {
            return window.localStorage.getItem(managedCanvasScope ? `jonwork-managed-${managedCanvasScope}:${name}` : name);
        }
    },
    setItem: async (name, value) => {
        if (typeof window === "undefined") return;
        try {
            await localforage.setItem(name, value);
        } catch {
            window.localStorage.setItem(managedCanvasScope ? `jonwork-managed-${managedCanvasScope}:${name}` : name, value);
        }
    },
    removeItem: async (name) => {
        if (typeof window === "undefined") return;
        try {
            await localforage.removeItem(name);
        } catch {
            window.localStorage.removeItem(managedCanvasScope ? `jonwork-managed-${managedCanvasScope}:${name}` : name);
        }
    },
};

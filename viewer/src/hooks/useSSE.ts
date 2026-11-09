import { useEffect } from "react";
import { useVillageStore, tickLogToFeed } from "../store";
import type { FeedEntry, SSEEvent, VillageInfo, WorldState } from "../types";

const warn = (what: string) => (err: unknown) => console.warn(`[viewer] ${what} failed`, err);

export function useSSE(): void {
  const { setConnected, handleSSEEvent, setWorld, setAvailableTicks, appendHistoricalFeed, setVillages, setActiveVillageId, setNeedsWorldConfig } = useVillageStore();

  useEffect(() => {
    // 1. Load current world state, then the human player's own view (perception, tools) if one exists
    fetch("/api/state")
      .then((r) => r.json())
      .then((state: WorldState) => {
        setWorld(state);
        const store = useVillageStore.getState();
        if (state.player?.created) {
          void store.refreshPlayer().then(() => store.refreshPlayerTools());
        }
      })
      .catch(warn("loading /api/state"));

    // Load village list for multi-village support
    fetch("/api/villages")
      .then((r) => r.json())
      .then((villages: VillageInfo[]) => {
        setVillages(villages);
        if (villages.length > 0) setActiveVillageId(villages[0]!.id);
      })
      .catch(warn("loading /api/villages"));

    // Per-colonist LLM model choices (logs its own errors)
    void useVillageStore.getState().loadAgentModels();
    // War relations between settlements (silently empty when the backend has no war support)
    void useVillageStore.getState().loadWar();

    // 2. Load available tick IDs and seed the feed with recent history
    fetch("/api/ticks")
      .then((r) => r.json())
      .then(async (ticks: string[]) => {
        setAvailableTicks(ticks);
        // Show world config on fresh start (no tick history)
        if (ticks.length === 0) setNeedsWorldConfig(true);
        // Load last 3 ticks into the live feed
        const recent = ticks.slice(-3).reverse();
        const allEntries: FeedEntry[] = [];
        for (const tickId of recent) {
          try {
            const res = await fetch(`/api/tick/${tickId}`);
            const log = await res.json();
            allEntries.push(...tickLogToFeed(log));
          } catch (err) {
            console.warn(`[viewer] skipping ${tickId}`, err);
          }
        }
        appendHistoricalFeed(allEntries);
      })
      .catch(warn("loading /api/ticks"));

    // 3. Connect SSE for live updates
    let es: EventSource | undefined;
    let retryTimeout: ReturnType<typeof setTimeout> | undefined;

    function connect() {
      es = new EventSource("/stream");
      es.onopen = () => setConnected(true);
      es.onmessage = (ev) => {
        try {
          const event = JSON.parse(ev.data) as SSEEvent;
          handleSSEEvent(event);
        } catch (err) {
          console.warn("[viewer] bad SSE message", err);
        }
      };
      es.onerror = () => {
        setConnected(false);
        es?.close();
        retryTimeout = setTimeout(connect, 3000);
      };
    }

    connect();

    return () => {
      es?.close();
      clearTimeout(retryTimeout);
    };
  }, []);
}

"use client";

import { useEffect, useRef, useState } from "react";
import { isStagePayload, type StagePayload } from "./analysis-stage.ts";
import { useSupabaseBrowserClient } from "./supabase/browser.ts";

// Subscribes to the private analysis:<id> progress channel. One read once
// SUBSCRIBED covers broadcasts missed between server render and the socket
// opening — Realtime only creates a client's message partition when it
// connects, so early publishes can be lost. No polling, ever.
export function useAnalysisStage(analysisId: string, enabled: boolean, onPayload: (payload: StagePayload) => void): string | null {
  const { supabase, ready } = useSupabaseBrowserClient();
  const [channelError, setChannelError] = useState<string | null>(null);
  const handlerRef = useRef(onPayload);

  useEffect(() => {
    handlerRef.current = onPayload;
  });

  useEffect(() => {
    if (!enabled || !ready) return;
    // CLOSED also fires on an intentional removeChannel; this flag tells the
    // intentional close from a dropped socket.
    let gone = false;

    const deliver = (payload: StagePayload) => {
      handlerRef.current(payload);
      if (payload.status === "complete" || payload.status === "failed") {
        gone = true;
        void supabase.removeChannel(channel);
      }
    };

    const channel = supabase
      .channel(`analysis:${analysisId}`, { config: { private: true } })
      .on("broadcast", { event: "stage" }, ({ payload }) => {
        if (isStagePayload(payload)) deliver(payload);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          const { data } = await supabase
            .from("analyses")
            .select("status, stage, stage_message, error, stage_updated_at")
            .eq("id", analysisId)
            .single();
          if (!data) return;
          const row = data as {
            status: unknown;
            stage: unknown;
            stage_message: unknown;
            error: unknown;
            stage_updated_at: unknown;
          };
          const candidate = {
            status: row.status,
            stage: row.stage,
            message: row.stage_message,
            error: row.error,
            updated_at: row.stage_updated_at,
          };
          if (isStagePayload(candidate)) deliver(candidate);
        } else if ((status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") && !gone) {
          setChannelError(status);
        }
      });

    return () => {
      gone = true;
      void supabase.removeChannel(channel);
    };
  }, [supabase, analysisId, enabled, ready]);

  return channelError ? `Live updates unavailable (${channelError})` : null;
}

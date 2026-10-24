export const stages = ["fetching", "selecting", "parsing", "labelling", "storing"] as const;
export type Stage = (typeof stages)[number];

export type AnalysisStatus = "queued" | "running" | "complete" | "failed";

export const staleAfterMs = 5 * 60 * 1000;

// Nothing supervises a run: a process that dies mid-parse leaves its stage
// forever, so age is the only signal that separates working from abandoned.
export function isStale(status: string, stageUpdatedAt: string, now: number): boolean {
  const unfinished = status === "queued" || status === "running";
  return unfinished && now - new Date(stageUpdatedAt).getTime() > staleAfterMs;
}

// The trigger publishes this shape, not the row — the page has nothing to
// filter and nothing to interpret.
export type StagePayload = {
  status: AnalysisStatus;
  stage: Stage | null;
  message: string | null;
  error: string | null;
  updated_at: string;
};

export function isStagePayload(value: unknown): value is StagePayload {
  if (typeof value !== "object" || value === null) return false;
  if (!("status" in value && "stage" in value && "message" in value && "error" in value && "updated_at" in value)) return false;
  const { status, stage, message, error, updated_at } = value;
  return (
    (status === "queued" || status === "running" || status === "complete" || status === "failed") &&
    (stage === null || (typeof stage === "string" && (stages as readonly string[]).includes(stage))) &&
    (message === null || typeof message === "string") &&
    (error === null || typeof error === "string") &&
    typeof updated_at === "string"
  );
}

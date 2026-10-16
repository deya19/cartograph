import previewData from "@/lib/preview-data.json";
import type { ParseResult } from "@/lib/parser/types";
import { PreviewCanvas } from "./preview-canvas";

const previewResult = previewData as unknown as ParseResult;

export default function PreviewPage() {
  return <PreviewCanvas result={previewResult} />;
}

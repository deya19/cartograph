"use client";

import { useActionState } from "react";
import { RepositoryUrlField } from "@/components/repository-url-field";
import { analyzeRepository, type AnalyzeFormState } from "./actions";

const initialState: AnalyzeFormState = { error: null };

export function AnalyzeForm() {
  const [state, formAction, pending] = useActionState(analyzeRepository, initialState);

  return (
    <form action={formAction}>
      <RepositoryUrlField error={state.error} pending={pending} />
    </form>
  );
}

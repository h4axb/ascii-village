/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_LLM_API_KEY?: string;
  readonly VITE_LLM_BASE_URL?: string;
  readonly VITE_LLM_MODEL?: string; // legacy single-model fallback
  readonly VITE_LLM_MODEL_FAST?: string; // runtime default (Haiku)
  readonly VITE_LLM_MODEL_SMART?: string; // runtime escape hatch (Sonnet)
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

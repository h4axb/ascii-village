/// <reference types="vite/client" />
// Gives TS the ambient module declarations for Vite's asset imports (`.svg`,
// `.png`, `?raw`, `?url`, …) and for `import.meta.env`. The project imported
// assets fine before this only because everything was JSON (covered by
// tsconfig's resolveJsonModule); the HUD's icon SVGs are the first real asset
// imports.

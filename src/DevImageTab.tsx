// ---------------------------------------------------------------------------
// DEV-ONLY tab: upload a reference image, get 3 transcribed variants back via
// a real vision-LLM call (devImageTranscribe.ts — the one place in this
// tooling that costs real API money, by explicit user request). Each variant
// is editable here (live scale preview, a colour picker per palette key)
// before you copy/download it — nothing is written to disk automatically:
// save the downloaded file into src/data/assets/ and, after a reload, it's in
// the world editor's asset list (src/assets.ts) under "New".
// ---------------------------------------------------------------------------
import { useState } from 'react';
import { ColoredSprite } from './ColoredSprite';
import { transcribeImage } from './devImageTranscribe';
import type { TranscribedVariant } from './devImageTranscribe';

function slugify(s: string): string {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'asset';
}

const VARIANT_LETTERS = ['a', 'b', 'c'];

function download(name: string, text: string) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    // clipboard permission blocked — the download button still works
  }
}

export function DevImageTab() {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [fileName, setFileName] = useState('');
  const [hint, setHint] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [variants, setVariants] = useState<TranscribedVariant[] | null>(null);
  const [groupSlug, setGroupSlug] = useState('');

  const onFile = (file: File) => {
    setFileName(file.name);
    setVariants(null);
    setError(null);
    const reader = new FileReader();
    reader.onload = () => setDataUrl(reader.result as string);
    reader.readAsDataURL(file);
  };

  const generate = async () => {
    if (!dataUrl) return;
    setBusy(true);
    setError(null);
    const res = await transcribeImage(dataUrl, hint || undefined);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setVariants(res.variants);
    setGroupSlug(slugify(res.variants[0]?.name || fileName.replace(/\.[^.]+$/, '')));
  };

  const updateVariant = (i: number, patch: Partial<TranscribedVariant>) => {
    setVariants((vs) => vs && vs.map((v, idx) => (idx === i ? { ...v, ...patch } : v)));
  };

  const updateColor = (i: number, key: string, hex: string) => {
    if (!variants) return;
    updateVariant(i, { palette: { ...variants[i].palette, [key]: hex } });
  };

  const variantSlug = (i: number) => `${groupSlug}-${VARIANT_LETTERS[i]}`;

  const jsonFor = (v: TranscribedVariant) =>
    JSON.stringify(
      {
        generated: {
          source: fileName,
          transcribedBy: 'claude-vision',
          promptVersion: 1,
          generatedAt: new Date().toISOString(),
        },
        scale: v.suggestedScale,
        palette: v.palette,
        sprite: v.sprite,
        colors: v.colors,
        ...(v.solid ? { solid: v.solid } : {}),
      },
      null,
      2,
    );

  return (
    <div className="dev-image-tab">
      <div className="dev-image-cost-note">⚠ generate = a real, paid API call</div>
      <input
        type="file"
        accept="image/*"
        onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
      />
      {dataUrl && <img src={dataUrl} className="dev-image-preview" alt="reference" />}
      <input
        className="dev-image-hint"
        placeholder="optional context, e.g. 'an oak tree, autumn colours'"
        value={hint}
        onChange={(e) => setHint(e.target.value)}
      />
      <button disabled={!dataUrl || busy} onClick={generate} className="dev-asset-dump-btn">
        {busy ? 'generating…' : 'generate 3 variants'}
      </button>
      {error && <div className="dev-asset-warnings">{error}</div>}

      {variants && (
        <>
          <label className="dev-image-group-name">
            asset name
            <input value={groupSlug} onChange={(e) => setGroupSlug(slugify(e.target.value))} />
          </label>
          <div className="dev-image-variants">
            {variants.map((v, i) => (
              <div key={i} className="dev-image-variant">
                <div className="dev-image-variant-head">
                  {v.name} · {variantSlug(i)}
                </div>
                <div className="dev-image-variant-preview-box">
                  <div
                    className="dev-image-variant-preview"
                    style={{ transform: `scale(${Math.min(3, Math.max(0.3, v.suggestedScale * 4))})` }}
                  >
                    <ColoredSprite sprite={v.sprite} colors={v.colors} palette={v.palette} />
                  </div>
                </div>
                <label className="dev-image-scale-row">
                  scale
                  <input
                    type="number"
                    step={0.05}
                    min={0.05}
                    max={4}
                    value={v.suggestedScale}
                    onChange={(e) => updateVariant(i, { suggestedScale: +e.target.value })}
                  />
                  <span className="dev-image-tier">{v.sizeTier}</span>
                </label>
                <div className="dev-image-colors">
                  {Object.entries(v.palette).map(([key, hex]) => (
                    <label key={key} className="dev-image-color-row">
                      <span>{key}</span>
                      <input type="color" value={hex} onChange={(e) => updateColor(i, key, e.target.value)} />
                    </label>
                  ))}
                </div>
                {v.warnings.length > 0 && <div className="dev-asset-warnings">{v.warnings.join(', ')}</div>}
                <div className="dev-asset-ghost-btns">
                  <button onClick={() => copyText(jsonFor(v))}>copy json</button>
                  <button onClick={() => download(`${variantSlug(i)}.json`, jsonFor(v))}>download</button>
                </div>
              </div>
            ))}
          </div>
          <div className="dev-image-manifest">
            Save a downloaded file into <code>src/data/assets/</code> and reload: it shows up in the asset list under
            New, ready to place.
          </div>
        </>
      )}
    </div>
  );
}

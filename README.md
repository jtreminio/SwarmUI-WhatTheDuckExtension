# WhatTheDuck Extension

A SwarmUI extension for performance optimizations and enhancements that are not good enough for the base project.

Use at your own peril!

## Features

### Persistent Civitai Identity Index

WhatTheDuck indexes local checkpoints and LoRAs in `<DataDir>/WhatTheDuck/CivitaiIdentityIndex.json`. It stores Civitai model/version IDs, optional file IDs, algorithm-qualified hashes, publication dates, provenance, and retry state. Atomic writes preserve the index across restarts. Output **Model Hash Overrides** are never used as identity evidence.

The index reconciles once at startup and when SwarmUI refreshes its model list. There is no periodic inventory scan. Extension-owned completion hooks cover checkpoint/LoRA handler refreshes and subsequent metadata resaves, including SwarmUI downloads that resave after refreshing. Model refresh/path-change events also queue reconciliation. These signals are coalesced, processed outside SwarmUI's inventory locks, and retained if reconciliation fails. No core source changes are required. Deleted files stop matching as soon as a batch request checks them; the next model-list refresh removes their stored records. An unchanged sidecar is not reused when replacing an already indexed model file, while a fresh Swarm hash can identify the replacement.

The background worker reads bounded safetensors headers, supported sidecars (`.swarm.json`, `.json`, `.cm-info.json`, `.civitai.info`), and applicable host metadata caches. It prefers structured source IDs, then Swarm's leading `From <a href="https://civitai…">` source link. Arbitrary links in descriptions do not qualify. GGUF files can be identified through sidecars or applicable cached source metadata; GGUF tensor hashes are not used.

Missing identities or publication dates are resolved through public Civitai version/by-hash endpoints. One worker deduplicates lookups and limits concurrency to one request, with at least one second between requests. Pending work is ordered by retry time; an idle worker sleeps until a refresh or the next retry instead of regrouping the inventory. Successful results are reused; a successful response with no publication date remains unordered and is not fetched repeatedly. Missing results are cached for seven days. Other resource-specific HTTP 4xx failures retry after one day without blocking unrelated identities. Transient errors use exponential backoff; HTTP 429/503 respects `Retry-After` and pauses all resolution. Credentials and source descriptions are not persisted or returned. Set server environment variable `SWARM_WTD_CIVITAI_RESOLVE=false` before startup to disable network enrichment while keeping local indexing and matching.

Hash lookups use only the tensor SHA256 already present in SwarmUI's shared `Metadata.Hash` cache, validated against the file's modification time. It is stored as `TensorSHA256`; its first 12 characters are used as `AutoV3`. The index does not import hashes directly from model headers, sidecars, or Civitai responses, and never uses whole-file SHA256 for lookup. Older index records are revalidated under this policy before use. The resolver follows [Civitai's version API](https://github.com/civitai/civitai-developer-docs/blob/main/site/reference/model-versions.md). Files without reliable source IDs or an existing Swarm hash remain explicitly unresolved. The index never computes missing model hashes or rewrites model files/sidecars.

#### Batch matching API

Send an authenticated JSON `POST /API/WhatTheDuckMatchCivitaiVersions`. The route requires Swarm's `FundamentalModelAccess` permission and applies the session user's model-access filter. Only currently registered local files can match. Remote inventories are excluded.

```json
{
  "session_id": "...",
  "items": [
    {
      "modelId": 3023619,
      "modelVersionId": 3439242,
      "modelType": "Checkpoint",
      "publishedAt": 1793370343086
    }
  ]
}
```

`items` contains 0–500 objects. IDs must be positive JSON integers within JavaScript's safe integer range. `modelType` accepts `Checkpoint`, `LoRA`/`LORA`, `LoCon`/`LoCON`, or `DoRA`; the latter types use Swarm's `LoRA` inventory. `publishedAt` is an integer Unix timestamp in **milliseconds**, from 0 through 253402300799999. Omitted or `null` means unknown. ISO strings and fractional values are rejected. An invalid item rejects the entire batch with `error_id: "invalid_civitai_batch"`. Input order and duplicates are preserved. Client observations never create or update local ownership records.

Example response when an earlier version is installed:

```json
{
  "schemaVersion": 1,
  "indexRevision": "opaque-revision",
  "indexState": "ready",
  "coverage": { "localFiles": 1, "identifiedFiles": 1, "unresolvedFiles": 0 },
  "results": [
    {
      "modelId": 3023619,
      "modelVersionId": 3439242,
      "status": "older",
      "ownedVersionIds": [3433581],
      "reason": "earlier_publication"
    }
  ]
}
```

| Status | Meaning | Reason |
| --- | --- | --- |
| `downloaded` | The exact displayed version has an existing, accessible local file. | `exact_version` |
| `older` | Every identified local version of this model has an earlier publication date. | `earlier_publication` |
| `different` | Another version is local, but at least one date is unknown, equal, or newer. | `different_or_unordered_version` |
| `unknown` | No accessible local identity proves a match, or the index is unavailable. | `no_identified_local_version` or `index_unavailable` |

An exact match takes priority over other versions. Ordering uses publication dates only, never IDs, names, filenames, or `modelspec.date`/`createdAt`. `ownedVersionIds` contains sorted, distinct accessible versions. There is deliberately no definitive `not_downloaded` status.

`indexState` is `partial` until startup reconciliation completes or while accessible files lack identity. `ready` means identity coverage is complete for the current inventory snapshot; publication dates may still be unknown. `unavailable` means the service has not initialized or could not load its store; revision and coverage are then `null`. Coverage counts exclude models denied to the session. Counts reflect reconciliation, with additional checks for stale files relevant to the current batch.

`indexRevision` changes when a persisted snapshot changes. It is not an HTTP cache validator: file deletion and access changes can affect a response before reconciliation changes the revision. Clients should re-query visible cards periodically and after inventory changes, and coalesce repeated observations. Ordinary batch requests perform no Civitai requests, metadata scans, or tensor hashing. New files placed outside Swarm's current inventory become visible after Swarm refreshes that inventory.

Restart SwarmUI with the updated extension to register the route. A corrupt or unsupported index is preserved and reported as unavailable in logs/API results. Chrome integration is separate; clients should report a missing route as an extension-version requirement.

### Model Hash Overrides

Open a model's **Edit Metadata** modal, enter an **Override hash**, and click **Save**. Future generated images and videos use that value in `sui_models` metadata when SwarmUI's **Image Metadata Include Model Hash** setting is enabled. Hashes may contain 1–64 hexadecimal characters, optionally prefixed with `0x`; their case and prefix are preserved. Clear the field and save to restore the native hash.

Overrides are shared across users and stored in one file, `<DataDir>/WhatTheDuck/ModelHashOverrides.json` (`Data/` is SwarmUI's default data directory). Entries are keyed by model subtype and relative path, so a checkpoint and LoRA with the same name remain separate. Moving or renaming a model requires setting its override again. Editing overrides requires SwarmUI's model-metadata permission.

Saving only an override does not rewrite the model file or its `.swarm.json` sidecar. Other edits in the modal still use SwarmUI's normal metadata save. Existing outputs are unchanged. The overrides apply to checkpoints, refiners, video models, LoRAs, embeddings, and other models tracked in SwarmUI's output metadata.

### Model Multi-Select and Preset Links

With WhatTheDuck's **Keyboard Navigation** enabled, hover anywhere on a model card and press **C** to enter multi-select and toggle that model's selection. Repeat over other models to add them; press **C** again over a selected model to remove it. Over images, **C** retains its comparison shortcut. Press **Esc** to clear model and image selections and exit multi-select. An open modal or dropdown closes first.

Choose **Set Linked Preset** from the action dropdown, select a preset, and click **Apply** to assign it to every selected model, or choose **(None)** to remove their preset links. SwarmUI's checkmark toggle and image-click selection are also available in model browsers.

If every selected model has the same single linked preset, the picker preselects it. If none have links, it shows **(None)**; mixed or multiple links leave the choice blank.

This updates the same per-user **Linked Preset** setting as the model metadata editor, replacing existing links for the selection. SwarmUI automatically activates linked presets when selecting checkpoints or LoRAs. Other model types can store links, but SwarmUI does not automatically activate them.

### Model Auto-Folders

In WhatTheDuck settings, map model architectures to checkpoint and LoRA subfolders. Each mapping has a **Base folder** choice: **Stable-Diffusion** (the configured checkpoint location, the default for existing mappings) or **diffusion_models** under SwarmUI's configured download model root. The checkpoint subfolder is relative to that base; LoRA subfolders remain relative to the LoRA location.

For example, select `diffusion_models` with checkpoint folder `flux` to save matching models under `diffusion_models/flux`. Safetensors downloads honor the selected base. GGUF downloads always use SwarmUI’s core downloader and its normal destination rules; the base folder setting does not apply to them. Downloads started from a mapping keep that destination when retried. Leave a checkpoint or LoRA folder unset to skip automatic routing for that kind of model.

### Keyboard Navigation

Adds keyboard shortcuts for image navigation and actions:

- **A** - Navigate to previous image
- **D** - Navigate to next image
- **S** - Toggle star/favorite on current image
- **X** - Delete current image (double-tap required within 500ms)
- **Q** - Delete current image (SINGLE-tap)
- **E** - End / interrupt current generation(s)
- **R** - Redo current image with a fresh seed (same as the Redo button)

In the comparison modal, number keys (or their Shift symbols) switch the view:

- **1** / **!** - Side by Side
- **2** / **@** - Horizontal Slide
- **3** / **#** - Vertical Slide
- **4** / **$** - Transparency Overlay
- **5** / **%** - Single View
- **6** / **^** - Switch Image
- **7** / **&** - Toggle Metadata

Can be enabled/disabled in the settings panel.

### Metadata Column Width

SwarmUI's Auto metadata layout moves metadata below the image unless more than 480 px remains beside it. In **Tools → WhatTheDuck Settings**, set **Metadata Column Minimum Width** to 160–960 px. Lower values keep metadata beside the image more often. The setting applies to the current page immediately after saving and is shared across users. SwarmUI's forced Side and Bottom modes are unchanged.

### Prompt Variable Trimming

Adds an opt-in **Trim Prompt Variables** setting. When enabled, values assigned with SwarmUI's `<setvar[...]:...>` prompt tag have leading and trailing whitespace removed after nested prompt tags are resolved. The trimmed value is written back to the current generation's variable dictionary, so both an emitting `<setvar>` and later `<var:...>` references use the same normalized value.

### Output Filename Normalization

Enable **Normalize Output Filenames** in **Tools → WhatTheDuck Settings** to normalize Unicode in generated filenames and subfolders before SwarmUI saves them. This prevents Syncthing from changing an accented filename after saving while the browser still refers to its original spelling. Accents are preserved: for example, Linux saves `Alai\u0308a` as `Alaïa`.

The setting is off by default, shared across users, and applies immediately to future saves. It follows the **SwarmUI server's** platform: NFC on Linux and Windows, NFD on macOS, regardless of which computer runs the browser. Existing files, prompts, and metadata are unchanged. SwarmUI still handles filename collisions and numbering; output files, sidecars, and browser URLs all use the normalized path.

The extension uses a Harmony postfix on `User.BuildImageOutputPath`, before `Session.SaveImage` selects an available filename. ICU4N supplies Unicode normalization because SwarmUI's invariant globalization mode disables `string.Normalize`. These private dependencies are restored and copied when SwarmUI builds the extension; no core source changes are required.

### Redo

Adds a **Redo** entry to the current image's action menu (the "More" dropdown alongside "Upscale 2x", "Refine Image", and "View In History").

Redo regenerates the selected image with a brand-new random seed while keeping every other setting identical to that image — model, CFG, steps, LoRAs, refiner, dimensions, sampler, and the **finalized prompt**.

The key difference from "Reuse Parameters": that button loads the *original* prompt back into the prompt box (so wildcards, MagicPrompt LLM expansion, and macros re-roll on the next generation). Redo instead reuses the *already-finalized* prompt verbatim, so those prompt-time randomizers are **not** re-evaluated — you get the exact same prompt that produced the source image, just a different seed.

The original prompt and original negative prompt are preserved in the new image's metadata. When MagicPrompt is loaded, Redo also preserves every stored MagicPrompt variable, including **MP Prompt**, using the same finalized-prompt replay mechanism as MagicPrompt's **Refine Img** button. These variables remain metadata; they are not evaluated again or used to alter generation settings. MagicPrompt post-filters are not applied a second time.

### Import & Save Comfy Workflow To Server

Adds an **Import & Save To Server** button to the Comfy Workflow tab's button panel, on the Quick Load line, just below "Import From Generate Tab".

It does everything the import button does — the current Generate tab parameters are sent to `API/ComfyGetGeneratedWorkflow` and the resulting workflow is loaded into the Comfy editor — and additionally writes both halves of that exchange to disk on the machine running SwarmUI:

- `<DataDir>/WhatTheDuck/ComfyWorkflows/<timestamp>_payload.json` — the payload that was sent to `ComfyGetGeneratedWorkflow`
- `<DataDir>/WhatTheDuck/ComfyWorkflows/<timestamp>_workflow.json` — the ComfyUI workflow it generated

`<DataDir>` is SwarmUI's data directory (`Data/` by default). Both files are pretty-printed JSON, and the timestamp gets a `-2`, `-3`, ... suffix if you save more than once within the same second. If the graph can't be updated (editor not loaded yet), the files are still saved.

On success the button shows a brief ✓ (the panel's shared notice line is left alone), and the path of both files is copied to your clipboard as:

```
Payload: /path/to/<timestamp>_payload.json, Generated Workflow: /path/to/<timestamp>_workflow.json
```

#### Path Mapping (containers / remote servers)

If SwarmUI sees a different filesystem than your editor does, set **Server Path Prefix** and **Local Path Prefix** in the WhatTheDuck settings panel (🧩 Comfy Workflow Dump). The copied text is rewritten through that pair, while the files are still saved to the real server path. The Server Path Prefix box shows SwarmUI's own base path as its placeholder, so you can see what the server side actually looks like.

With `/workspace` → `~/swarm-data`, a dump saved at `/workspace/Data/WhatTheDuck/ComfyWorkflows/x_payload.json` is copied as `~/swarm-data/Data/WhatTheDuck/ComfyWorkflows/x_payload.json`.

Only whole path segments match (`/workspace` will not match `/workspaces/...`), and paths outside the prefix — or an empty prefix pair — are copied unchanged.

Embedded base64 blobs — init images, masks, anything else Swarm inlines — are cropped out of both files before writing, so a dump of an img2img generation stays a few KB instead of tens of megabytes. Data URIs keep their header and the first 24 characters, then say how much was dropped:

```
"initimage": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg...[truncated, 402 base64 chars]"
```

Bare base64 (no `data:` header) is cropped the same way. The cropped values are deliberately no longer decodable — these dumps are for reading and diffing, not for replaying.

Handy for diffing what Swarm actually builds for a given set of parameters, or for filing bug reports with the exact workflow attached.

## Configuration

Access settings from the **Tools** tab on the Generate page: choose **WhatTheDuck Settings** in the tool dropdown (extension entries are typically near the bottom of that list).

## License

MIT

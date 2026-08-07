🚨  Heads' up: WhatTheDuck will soon lose support for the massive wildcard files.

Instead, you'll want to [Quarry](https://discord.com/channels/1243166023859961988/1515427964748173603).

# WhatTheDuck Extension

A SwarmUI extension for performance optimizations and enhancements that are not good enough for the base project.

Use at your own peril!

## Features

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

### Redo

Adds a **Redo** entry to the current image's action menu (the "More" dropdown alongside "Upscale 2x", "Refine Image", and "View In History").

Redo regenerates the selected image with a brand-new random seed while keeping every other setting identical to that image — model, CFG, steps, LoRAs, refiner, dimensions, sampler, and the **finalized prompt**.

The key difference from "Reuse Parameters": that button loads the *original* prompt back into the prompt box (so wildcards, MagicPrompt LLM expansion, and macros re-roll on the next generation). Redo instead reuses the *already-finalized* prompt verbatim, so those prompt-time randomizers are **not** re-evaluated — you get the exact same prompt that produced the source image, just a different seed.

The original prompt is still preserved: it is recorded as `original_prompt` in the new image's metadata, exactly as the source image had it.

### Import & Save Comfy Workflow To Server

Adds an **Import & Save To Server** button to the Comfy Workflow tab's button panel, right next to "Import From Generate Tab".

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

### Datadump - Large Wildcard File Support

Handles very large wildcard files (gigabytes in size) without impacting SwarmUI's performance. When you click "Refresh Wildcards" in SwarmUI, it normally loads all wildcard files into memory - this can cause issues with extremely large files.

#### How It Works

1. **Separate Directory**: Place your large wildcard files in a dedicated "Datadump" directory (anywhere on your system)
2. **Placeholder Files**: The extension automatically creates small placeholder files in your Wildcards directory, one for each Datadump file
3. **Autocomplete Works**: Because placeholders exist in the Wildcards folder, SwarmUI's autocomplete for `<wildcard:name>` tags works normally
4. **On-Demand Loading**: When you actually use a wildcard, the extension reads from the large Datadump file efficiently without loading it entirely into memory

#### Setup

1. Create a directory for your large wildcard files (e.g., `/data/datadump/`)
2. Place your large `.txt` wildcard files in this directory (subdirectories are supported)
3. On the Generate page, open the **Tools** tab and select **WhatTheDuck Settings** from the tool dropdown (extension tools are usually near the bottom of the list)
4. Check **Enable Datadump**
5. Enter the full path to your Datadump directory in **Datadump Path**
6. Click **Save Settings**

#### Directory Structure Example

```
Datadump Directory (/data/datadump/):
├── large-prompts.txt           (2GB file)
├── massive-tags.txt            (500MB file)
└── categories/
    └── huge-dataset.txt        (1GB file)

Wildcards Directory (managed by SwarmUI):
├── large-prompts.txt           (placeholder - ~50 bytes)
├── massive-tags.txt            (placeholder - ~50 bytes)
├── categories/
│   └── huge-dataset.txt        (placeholder - ~50 bytes)
└── your-normal-wildcards.txt   (your regular files - unaffected)
```

#### Keeping Files in Sync

- **Refresh Datadump**: Click the "🔄 Refresh Datadump" button in settings to:
  - Scan for new files in the Datadump directory
  - Create placeholder files for any new Datadump files
  - Refresh SwarmUI's wildcard list

- **Modified Placeholders**: If you edit a placeholder file in the Wildcards directory, the extension will detect this and show a warning. Modified placeholders will use their local content instead of the Datadump file. To restore Datadump handling, delete the modified placeholder and click Refresh.

- **Never Overwrites**: The extension never overwrites existing files in your Wildcards directory. If a file already exists (placeholder or not), it is left untouched.

#### Important Notes

- Placeholder files contain a comment: `# WhatTheDuck datadump placeholder - do not edit`
- File names in Datadump and Wildcards must match (including subdirectory structure)
- The extension only processes `.txt` files
- Your existing Wildcards files are never modified or deleted

## Configuration

Access settings from the **Tools** tab on the Generate page: choose **WhatTheDuck Settings** in the tool dropdown (extension entries are typically near the bottom of that list).

## License

MIT

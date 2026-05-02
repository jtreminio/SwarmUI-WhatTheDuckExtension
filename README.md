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

Can be enabled/disabled in the settings panel.

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

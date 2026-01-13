# WhatTheDuck Extension

A SwarmUI extension for performance optimizations and enhancements that are not good enough for the base project.

Use at your own peril!

## Features

### Lazy Wildcard Loading

Optimizes memory usage for large wildcard files (default 50MB+) by using lazy loading instead of loading entire files into memory.

- Only stores line byte offsets during indexing
- Reads lines on-demand from disk
- Configurable size threshold via the Settings panel

## Configuration

Access settings via **Utilities -> WhatTheDuck Settings** in the SwarmUI interface.

## License

MIT
